import { describe, expect, it } from "vitest";
import { accountReserve, project, timelineFor, type TierEconomics } from "@/lib/domain/projection";
import { TIERS } from "@/lib/domain/economics";
import type { LifecycleEvent, LifecycleEventKind } from "@/lib/domain/types";

const ECONOMICS: TierEconomics[] = TIERS.map((t) => ({
  id: t.id,
  name: t.name,
  premiumWei: t.premiumWei,
  payoutWei: t.payoutWei,
  termDays: t.termDays,
}));

let seq = 0;
function ev(
  kind: LifecycleEventKind,
  extra: Partial<LifecycleEvent> = {},
): LifecycleEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    seq,
    ts: 1_700_000_000_000 + seq * 1000,
    kind,
    source: "local",
    ...extra,
  };
}

const P = "CVT-TEST-0001";
const C = "CLM-TEST";

/** The event sequence a real, successful lifecycle produces. */
function fullLifecycle(): LifecycleEvent[] {
  seq = 0;
  return [
    ev("policy.key_created", {
      policyId: P,
      data: {
        commitment: "0x1",
        publicKey: "0x2",
        tier: 1,
        premiumWei: TIERS[0].premiumWei.toString(),
        payoutWei: TIERS[0].payoutWei.toString(),
        termDays: 7,
      },
    }),
    ev("policy.purchase_submitted", { policyId: P, txHash: "0xbuy" }),
    ev("policy.activated", { policyId: P, txHash: "0xbuy", source: "chain", data: { expiresAt: 1_800_000_000 } }),
    ev("claim.drafted", { policyId: P, claimId: C, data: { claimCommitment: "0x9", incidentHash: "0x8" } }),
    ev("claim.submitted", { policyId: P, claimId: C, txHash: "0xclaim" }),
    ev("claim.confirmed", { policyId: P, claimId: C, txHash: "0xclaim", source: "chain" }),
    ev("settlement.attempted", { policyId: P, claimId: C }),
    ev("settlement.rejected", { policyId: P, claimId: C, reason: "NOT_APPROVED", txHash: "0xreject" }),
    ev("claim.approved", { policyId: P, claimId: C, txHash: "0xapprove", source: "chain" }),
    ev("settlement.submitted", { policyId: P, claimId: C, txHash: "0xsettle" }),
    ev("settlement.confirmed", {
      policyId: P,
      claimId: C,
      txHash: "0xsettle",
      source: "chain",
      data: { payoutWei: TIERS[0].payoutWei.toString() },
    }),
  ];
}

describe("event projection", () => {
  it("folds a full lifecycle into one settled policy and one settled claim", () => {
    const p = project(fullLifecycle(), ECONOMICS);
    expect(p.policies).toHaveLength(1);
    expect(p.claims).toHaveLength(1);
    expect(p.policies[0].status).toBe("settled");
    expect(p.claims[0].status).toBe("settled");
    expect(p.policies[0].settlementTx).toBe("0xsettle");
    expect(p.policies[0].claimId).toBe(C);
  });

  it("keeps the refused settlement as evidence rather than discarding it", () => {
    const p = project(fullLifecycle(), ECONOMICS);
    expect(p.claims[0].rejectedSettlements).toBe(1);
  });

  it("is order-independent: shuffled events produce the same result", () => {
    const events = fullLifecycle();
    const shuffled = [...events].sort(() => Math.random() - 0.5);
    const a = project(events, ECONOMICS);
    const b = project(shuffled, ECONOMICS);
    expect(b.policies[0].status).toBe(a.policies[0].status);
    expect(b.claims[0].status).toBe(a.claims[0].status);
    expect(b.claims[0].rejectedSettlements).toBe(a.claims[0].rejectedSettlements);
  });

  it("is idempotent: replaying the same log twice changes nothing", () => {
    const events = fullLifecycle();
    const once = project(events, ECONOMICS);
    const twice = project(events, ECONOMICS);
    expect(twice.policies[0]).toEqual(once.policies[0]);
  });

  it("takes the contract's expiry, never a client-computed one", () => {
    const p = project(fullLifecycle(), ECONOMICS);
    expect(p.policies[0].expiresAt).toBe(1_800_000_000);
  });

  it("leaves the policy claimable when a claim submission fails", () => {
    seq = 0;
    const events = [
      ev("policy.key_created", {
        policyId: P,
        data: { commitment: "0x1", publicKey: "0x2", tier: 1 },
      }),
      ev("policy.purchase_submitted", { policyId: P }),
      ev("policy.activated", { policyId: P, source: "chain", data: { expiresAt: 1_800_000_000 } }),
      ev("claim.drafted", { policyId: P, claimId: C, data: { claimCommitment: "0x9", incidentHash: "0x8" } }),
      ev("claim.submitted", { policyId: P, claimId: C }),
      ev("claim.submit_failed", { policyId: P, claimId: C, reason: "BAD_SIGNATURE" }),
    ];
    const p = project(events, ECONOMICS);
    expect(p.claims[0].status).toBe("failed");
    // The slot was never consumed onchain, so the policy stays active.
    expect(p.policies[0].status).toBe("active");
  });

  it("returns a settling policy to approved when settlement fails at the wallet", () => {
    const events = [
      ...fullLifecycle().slice(0, 10), // through settlement.submitted
      ev("settlement.failed", { policyId: P, claimId: C, reason: "USER_REFUSED_OP" }),
    ];
    const p = project(events, ECONOMICS);
    expect(p.claims[0].status).toBe("approved");
    expect(p.policies[0].status).toBe("claim_approved");
  });

  it("marks a denied claim and closes its policy", () => {
    seq = 0;
    const events = [
      ev("policy.key_created", { policyId: P, data: { commitment: "0x1", publicKey: "0x2", tier: 2 } }),
      ev("policy.purchase_submitted", { policyId: P }),
      ev("policy.activated", { policyId: P, source: "chain", data: { expiresAt: 1_800_000_000 } }),
      ev("claim.drafted", { policyId: P, claimId: C, data: { claimCommitment: "0x9", incidentHash: "0x8" } }),
      ev("claim.submitted", { policyId: P, claimId: C }),
      ev("claim.confirmed", { policyId: P, claimId: C, source: "chain" }),
      ev("claim.denied", { policyId: P, claimId: C, source: "chain", data: { reason: "outside term" } }),
    ];
    const p = project(events, ECONOMICS);
    expect(p.claims[0].status).toBe("denied");
    expect(p.claims[0].denialReason).toBe("outside term");
    expect(p.policies[0].status).toBe("claim_denied");
  });

  it("ignores events for a policy it has never seen", () => {
    seq = 0;
    const p = project([ev("claim.approved", { policyId: "GHOST", claimId: "NOPE" })], ECONOMICS);
    expect(p.policies).toHaveLength(0);
    expect(p.claims).toHaveLength(0);
  });

  it("builds a timeline containing both policy and claim events, oldest first", () => {
    const events = fullLifecycle();
    const t = timelineFor(events, P, C);
    expect(t).toHaveLength(events.length);
    expect(t[0].kind).toBe("policy.key_created");
    expect(t[t.length - 1].kind).toBe("settlement.confirmed");
  });
});

describe("reserve accounting", () => {
  it("counts a settled policy as a settled liability, not as exposure", () => {
    const p = project(fullLifecycle(), ECONOMICS);
    const r = accountReserve(p);
    expect(r.counts.settled).toBe(1);
    expect(r.counts.active).toBe(0);
    expect(r.settledLiabilitiesWei).toBe(TIERS[0].payoutWei);
    expect(r.localExposureWei).toBe(0n);
  });

  it("carries an active policy's payout as outstanding exposure", () => {
    const events = fullLifecycle().slice(0, 3);
    const r = accountReserve(project(events, ECONOMICS));
    expect(r.counts.active).toBe(1);
    expect(r.localExposureWei).toBe(TIERS[0].payoutWei);
    expect(r.premiumsPaidWei).toBe(TIERS[0].premiumWei);
  });

  it("excludes a failed purchase from liabilities entirely", () => {
    seq = 0;
    const events = [
      ev("policy.key_created", {
        policyId: P,
        data: { commitment: "0x1", publicKey: "0x2", tier: 1, premiumWei: TIERS[0].premiumWei.toString(), payoutWei: TIERS[0].payoutWei.toString() },
      }),
      ev("policy.purchase_submitted", { policyId: P }),
      ev("policy.purchase_failed", { policyId: P, reason: "INSOLVENT" }),
    ];
    const r = accountReserve(project(events, ECONOMICS));
    expect(r.counts.failed).toBe(1);
    expect(r.counts.total).toBe(0);
    expect(r.localExposureWei).toBe(0n);
    expect(r.premiumsPaidWei).toBe(0n);
  });

  it("does not count a draft policy that never reached the chain", () => {
    seq = 0;
    const r = accountReserve(
      project([ev("policy.key_created", { policyId: P, data: { commitment: "0x1", publicKey: "0x2", tier: 1 } })], ECONOMICS),
    );
    expect(r.counts.total).toBe(0);
  });

  it("derives solvency from the latest chain observation only", () => {
    seq = 0;
    const events = [
      ev("reserve.observed", { source: "chain", data: { reserveWei: "100", exposureWei: "40", invokes: "3" } }),
      ev("reserve.observed", { source: "chain", data: { reserveWei: "200", exposureWei: "50", invokes: "4" } }),
    ];
    const r = accountReserve(project(events, ECONOMICS));
    expect(r.observed?.reserveWei).toBe(200n);
    expect(r.availableWei).toBe(150n);
    expect(r.solvent).toBe(true);
    expect(r.solvencyRatio).toBe(400);
  });

  it("reports insolvency rather than hiding it", () => {
    seq = 0;
    const r = accountReserve(
      project([ev("reserve.observed", { source: "chain", data: { reserveWei: "10", exposureWei: "40" } })], ECONOMICS),
    );
    expect(r.solvent).toBe(false);
    expect(r.availableWei).toBe(-30n);
  });

  it("reports unknown, not zero, when the chain has never been read", () => {
    const r = accountReserve(project([], ECONOMICS));
    expect(r.observed).toBeNull();
    expect(r.availableWei).toBeNull();
    expect(r.solvent).toBeNull();
  });
});
