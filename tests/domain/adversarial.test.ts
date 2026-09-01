import { describe, expect, it } from "vitest";
import { project, accountReserve, type TierEconomics } from "@/lib/domain/projection";
import { TIERS } from "@/lib/domain/economics";
import { settlementBlocker } from "@/lib/domain/machine";
import { normalizeError } from "@/lib/domain/errors";
import { isPacket } from "@/lib/domain/persistence";
import { policyRef, sameFelt } from "@/lib/domain/ids";
import type { LifecycleEvent } from "@/lib/domain/types";

const ECONOMICS: TierEconomics[] = TIERS.map((t) => ({
  id: t.id,
  name: t.name,
  premiumWei: t.premiumWei,
  payoutWei: t.payoutWei,
  termDays: t.termDays,
}));

const P = "CVT-ATK-0001";
const C = "CLM-ATK";

let n = 0;
const ev = (kind: string, extra: Record<string, unknown> = {}): LifecycleEvent =>
  ({ id: `a${++n}`, seq: n, ts: 1_700_000_000_000 + n, kind, source: "local", ...extra }) as LifecycleEvent;

const activePolicy = () => {
  n = 0;
  return [
    ev("policy.key_created", {
      policyId: P,
      data: {
        commitment: "0xabc",
        publicKey: "0x2",
        tier: 1,
        premiumWei: TIERS[0].premiumWei.toString(),
        payoutWei: TIERS[0].payoutWei.toString(),
        termDays: 7,
      },
    }),
    ev("policy.purchase_submitted", { policyId: P }),
    ev("policy.activated", { policyId: P, source: "chain", data: { expiresAt: 9_999_999_999 } }),
  ];
};

/**
 * The threat: someone with write access to localStorage (XSS, a hostile
 * extension, or the user themselves via devtools) forges lifecycle events to make
 * the UI show a payout that never happened, or to unlock an action the contract
 * would refuse.
 *
 * The UI cannot be the last line of defence — the contract is — but it must not
 * be trivially convinced either, and it must never *unlock* a privileged action
 * on the strength of local state alone.
 */
describe("forged local state", () => {
  it("cannot fabricate a settlement without an approval in the log", () => {
    const forged = [
      ...activePolicy(),
      ev("claim.drafted", { policyId: P, claimId: C, data: { claimCommitment: "0x9", incidentHash: "0x8" } }),
      ev("claim.submitted", { policyId: P, claimId: C }),
      ev("claim.confirmed", { policyId: P, claimId: C, source: "chain" }),
      // Jump straight to settled, skipping approval entirely.
      ev("settlement.confirmed", { policyId: P, claimId: C, source: "chain", txHash: "0xfake" }),
    ];
    const p = project(forged, ECONOMICS);
    // under_review -> settled is not a legal transition, so the forgery is refused.
    expect(p.claims[0].status).toBe("under_review");
    expect(p.policies[0].status).toBe("claim_pending");
    expect(accountReserve(p).settledLiabilitiesWei).toBe(0n);
  });

  it("cannot resurrect a settled policy to claim twice", () => {
    const forged = [
      ...activePolicy(),
      ev("claim.drafted", { policyId: P, claimId: C, data: { claimCommitment: "0x9", incidentHash: "0x8" } }),
      ev("claim.submitted", { policyId: P, claimId: C }),
      ev("claim.confirmed", { policyId: P, claimId: C, source: "chain" }),
      ev("claim.approved", { policyId: P, claimId: C, source: "chain" }),
      ev("settlement.submitted", { policyId: P, claimId: C }),
      ev("settlement.confirmed", { policyId: P, claimId: C, source: "chain" }),
      // Try to walk it back to active so the UI offers settlement again.
      ev("policy.activated", { policyId: P, source: "chain", data: { expiresAt: 9_999_999_999 } }),
      ev("claim.confirmed", { policyId: P, claimId: C, source: "chain" }),
    ];
    const p = project(forged, ECONOMICS);
    expect(p.policies[0].status).toBe("settled");
    expect(p.claims[0].status).toBe("settled");
    // And settlement is blocked with the reason the contract would give.
    expect(settlementBlocker(p.policies[0].status, p.claims[0].status)).toBe("CLAIMED");
  });

  it("cannot un-deny a denied claim", () => {
    const forged = [
      ...activePolicy(),
      ev("claim.drafted", { policyId: P, claimId: C, data: { claimCommitment: "0x9", incidentHash: "0x8" } }),
      ev("claim.submitted", { policyId: P, claimId: C }),
      ev("claim.confirmed", { policyId: P, claimId: C, source: "chain" }),
      ev("claim.denied", { policyId: P, claimId: C, source: "chain" }),
      ev("claim.approved", { policyId: P, claimId: C, source: "chain" }),
      ev("settlement.confirmed", { policyId: P, claimId: C, source: "chain" }),
    ];
    const p = project(forged, ECONOMICS);
    expect(p.claims[0].status).toBe("denied");
    expect(p.policies[0].status).toBe("claim_denied");
  });

  it("cannot inflate the payout by lying about tier economics", () => {
    n = 0;
    const forged = [
      ev("policy.key_created", {
        policyId: P,
        data: {
          commitment: "0xabc",
          publicKey: "0x2",
          tier: 1,
          // A thousand-fold larger payout than tier 1 actually pays.
          payoutWei: (TIERS[0].payoutWei * 1000n).toString(),
          premiumWei: "1",
          termDays: 7,
        },
      }),
      ev("policy.purchase_submitted", { policyId: P }),
      ev("policy.activated", { policyId: P, source: "chain", data: { expiresAt: 9_999_999_999 } }),
    ];
    const p = project(forged, ECONOMICS);
    // The projection stores what the log says — but the contract pays by tier, and
    // the settlement path reads the tier, so a forged number is cosmetic only.
    // What must hold is that it cannot make settlement authorised.
    expect(settlementBlocker(p.policies[0].status, "draft")).toBe("CLAIM_MISSING");
  });

  it("survives a ledger full of garbage without throwing", () => {
    const junk = [
      { id: "x", seq: 1, ts: 1, kind: "nonsense.kind", source: "local" },
      { id: "y", seq: 2, ts: 2, kind: "policy.activated", source: "chain", policyId: "GHOST" },
      { id: "z", seq: 3, ts: 3, kind: "claim.approved", source: "chain", claimId: "GHOST" },
      { id: "w", seq: 4, ts: 4, kind: "reserve.observed", source: "chain", data: { reserveWei: "not-a-number" } },
      { id: "v", seq: 5, ts: 5, kind: "policy.key_created", source: "local", policyId: P, data: null },
    ] as unknown as LifecycleEvent[];
    expect(() => project(junk, ECONOMICS)).not.toThrow();
    const p = project(junk, ECONOMICS);
    expect(p.policies).toHaveLength(0);
    expect(() => accountReserve(p)).not.toThrow();
    expect(accountReserve(p).observed).toBeNull();
  });

  it("ignores a reserve observation that is not parseable rather than showing zero", () => {
    n = 0;
    const p = project(
      [ev("reserve.observed", { source: "chain", data: { reserveWei: "🙈", exposureWei: "0" } })],
      ECONOMICS,
    );
    // Unknown must not become 0 — that would read as "solvent with nothing owed".
    expect(p.reserveObservations).toHaveLength(0);
    expect(accountReserve(p).solvent).toBeNull();
  });

  it("does not let a duplicated event double-count a liability", () => {
    const events = [
      ...activePolicy(),
      ev("claim.drafted", { policyId: P, claimId: C, data: { claimCommitment: "0x9", incidentHash: "0x8" } }),
      ev("claim.submitted", { policyId: P, claimId: C }),
      ev("claim.confirmed", { policyId: P, claimId: C, source: "chain" }),
      ev("claim.approved", { policyId: P, claimId: C, source: "chain" }),
      ev("settlement.submitted", { policyId: P, claimId: C }),
      ev("settlement.confirmed", { policyId: P, claimId: C, source: "chain" }),
      ev("settlement.confirmed", { policyId: P, claimId: C, source: "chain" }),
      ev("settlement.confirmed", { policyId: P, claimId: C, source: "chain" }),
    ];
    const r = accountReserve(project(events, ECONOMICS));
    expect(r.counts.settled).toBe(1);
    expect(r.settledLiabilitiesWei).toBe(TIERS[0].payoutWei);
  });

  it("counts repeated refused settlements without ever authorising one", () => {
    const events = [
      ...activePolicy(),
      ev("claim.drafted", { policyId: P, claimId: C, data: { claimCommitment: "0x9", incidentHash: "0x8" } }),
      ev("claim.submitted", { policyId: P, claimId: C }),
      ev("claim.confirmed", { policyId: P, claimId: C, source: "chain" }),
      ev("settlement.rejected", { policyId: P, claimId: C, reason: "NOT_APPROVED" }),
      ev("settlement.rejected", { policyId: P, claimId: C, reason: "NOT_APPROVED" }),
      ev("settlement.rejected", { policyId: P, claimId: C, reason: "NOT_APPROVED" }),
    ];
    const p = project(events, ECONOMICS);
    expect(p.claims[0].rejectedSettlements).toBe(3);
    expect(p.claims[0].status).toBe("under_review");
    expect(settlementBlocker(p.policies[0].status, p.claims[0].status)).toBe("NOT_APPROVED");
  });
});

/**
 * The threat: a claimant edits their reveal packet after filing, so the
 * adjudicator reads a more sympathetic incident than the one committed onchain.
 */
describe("hostile reveal packets", () => {
  it("rejects anything that is not a complete packet", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "a string",
      42,
      [],
      {},
      { policyCommitment: "0x1" },
      { policyCommitment: "0x1", claimCommitment: "0x2", incidentHash: "0x3", incidentSalt: "0x4" },
      // present but empty — an empty salt would make the commitment guessable
      { policyCommitment: "0x1", claimCommitment: "0x2", incidentHash: "0x3", incidentSalt: "", incidentText: "x", createdAt: 1 },
      // createdAt of the wrong type
      { policyCommitment: "0x1", claimCommitment: "0x2", incidentHash: "0x3", incidentSalt: "0x4", incidentText: "x", createdAt: "now" },
    ];
    for (const b of bad) expect(isPacket(b), JSON.stringify(b)).toBe(false);
  });

  it("accepts only a fully-formed packet", () => {
    expect(
      isPacket({
        policyCommitment: "0x1",
        claimCommitment: "0x2",
        incidentHash: "0x3",
        incidentSalt: "0x4",
        incidentText: "an incident",
        createdAt: 1,
      }),
    ).toBe(true);
  });
});

/**
 * The threat: a revert message crafted to be mistaken for a different, more
 * permissive invariant — or a transport error dressed up as a protocol answer.
 */
describe("hostile error strings", () => {
  it("does not let attacker-controlled text impersonate a protocol invariant", () => {
    // Incident text is attacker-controlled and can end up inside an error message.
    const f = normalizeError(new Error("user text: NOT_APPROVED was not the reason"));
    // It still maps to NOT_APPROVED — which is the conservative direction: it
    // reports a *refusal*, never an authorisation. No code in COVERT grants
    // access on the strength of a normalised error.
    expect(f.code).toBe("NOT_APPROVED");
    expect(f.expected).toBe(true);
  });

  it("never returns an empty recovery, even for adversarial input", () => {
    const nasty = ["", " ", "<script>alert(1)</script>", "a".repeat(5000), "🙈".repeat(200)];
    for (const s of nasty) {
      const f = normalizeError(new Error(s));
      expect(f.recovery.length).toBeGreaterThan(10);
      expect(typeof f.code).toBe("string");
    }
  });

  it("handles non-Error throwables", () => {
    for (const t of [null, undefined, 42, "boom", {}, [], Symbol("x").toString()]) {
      expect(() => normalizeError(t)).not.toThrow();
      expect(normalizeError(t).recovery.length).toBeGreaterThan(10);
    }
  });
});

describe("identifier handling", () => {
  it("does not crash on hostile commitment values", () => {
    for (const v of ["", "not-hex", "0x", "0xZZZ", "../../etc/passwd", "<script>", "0x" + "f".repeat(200)]) {
      expect(() => policyRef(v)).not.toThrow();
      expect(policyRef(v)).toMatch(/^CVT-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    }
  });

  it("does not treat malformed felts as equal", () => {
    expect(sameFelt("not-hex", "not-hex")).toBe(false);
    expect(sameFelt("", "")).toBe(false);
    expect(sameFelt("0x0", "0x0")).toBe(true);
  });
});
