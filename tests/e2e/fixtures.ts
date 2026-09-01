import type { Page } from "@playwright/test";

/**
 * Seeded lifecycle state for browser tests.
 *
 * COVERT's ledger is an append-only event log in localStorage, so a complete
 * lifecycle can be planted and the UI's reconstruction of it verified without a
 * wallet extension. What this cannot cover is wallet signing itself; that gap is
 * recorded in LIMITATIONS.md rather than papered over.
 *
 * The commitments below are the ones produced by the real devnet run, so the
 * derived references match the artifact.
 */

export const LEDGER_KEY = "covert.ledger.v1";
export const SECRETS_KEY = "covert.secrets.v1";
export const REVEALS_KEY = "covert.reveals.v1";
export const SEQ_KEY = "covert.seq.v1";
export const MIGRATION_FLAG = "covert.migrated.v1";

export const POLICY_COMMITMENT =
  "0x65b170e76ef2b8694d3e17bbc488fc359d7898cff2fe31eb73acefc79603a0c";
export const CLAIM_COMMITMENT =
  "0x50be95a7d77de260201bda9e682768e4812f5359648109a063c9ef880771dd9";

/** Mirrors `policyRef` / `claimRef` in src/lib/domain/ids.ts. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function encode(value: bigint, length: number): string {
  let n = value;
  let out = "";
  for (let i = 0; i < length; i++) {
    out = ALPHABET[Number(n % 32n)] + out;
    n /= 32n;
  }
  return out;
}
export function policyRef(commitment: string): string {
  const n = BigInt(commitment);
  return `CVT-${encode((n >> 32n) & 0xfffffn, 4)}-${encode(n & 0xffffn, 4)}`;
}
export function claimRef(commitment: string): string {
  return `CLM-${encode(BigInt(commitment) & 0xfffffn, 4)}`;
}

export const POLICY_ID = policyRef(POLICY_COMMITMENT);
export const CLAIM_ID = claimRef(CLAIM_COMMITMENT);

const TIER_1 = { premiumWei: "10000000000000000", payoutWei: "50000000000000000", termDays: 7 };
const BASE_TS = 1_756_000_000_000;

type Stage = "active" | "under_review" | "refused" | "approved" | "settled";

function event(seq: number, kind: string, extra: Record<string, unknown> = {}) {
  return {
    id: `seed_${seq}`,
    seq,
    ts: BASE_TS + seq * 60_000,
    kind,
    source: "local",
    policyId: POLICY_ID,
    ...extra,
  };
}

/**
 * Build the event log for a lifecycle stopped at `stage`.
 * Each stage is a prefix of the next, exactly as a real run accumulates.
 */
export function ledgerFor(stage: Stage) {
  const events: Record<string, unknown>[] = [
    event(1, "policy.key_created", {
      note: "Bearer key minted in this browser for a SIGNAL policy.",
      data: {
        commitment: POLICY_COMMITMENT,
        publicKey: "0x2",
        tier: 1,
        premiumWei: TIER_1.premiumWei,
        payoutWei: TIER_1.payoutWei,
        termDays: TIER_1.termDays,
      },
    }),
    event(2, "policy.purchase_submitted", { txHash: "0xbuy" }),
    event(3, "policy.activated", {
      txHash: "0xbuy",
      source: "chain",
      note: "SIGNAL cover is active.",
      // Far future so the policy never reads as expired during a test run.
      data: { expiresAt: Math.floor(Date.now() / 1000) + 600_000, tier: 1 },
    }),
  ];

  if (stage === "active") return events;

  events.push(
    event(4, "claim.drafted", {
      claimId: CLAIM_ID,
      data: { claimCommitment: CLAIM_COMMITMENT, incidentHash: "0x8" },
    }),
    event(5, "claim.submitted", { claimId: CLAIM_ID, txHash: "0xclaim" }),
    event(6, "claim.confirmed", {
      claimId: CLAIM_ID,
      txHash: "0xclaim",
      source: "chain",
      note: "Claim recorded onchain and awaiting adjudication.",
    }),
  );

  if (stage === "under_review") return events;

  events.push(
    event(7, "settlement.attempted", {
      claimId: CLAIM_ID,
      note: "Settlement attempted while the claim is not approved.",
      data: { predictedBlocker: "NOT_APPROVED" },
    }),
    event(8, "settlement.rejected", {
      claimId: CLAIM_ID,
      txHash: "0xreject",
      source: "chain",
      reason: "NOT_APPROVED",
      note: "Settlement refused onchain: Settlement refused — claim is not approved.",
    }),
  );

  if (stage === "refused") return events;

  events.push(
    event(9, "claim.approved", {
      claimId: CLAIM_ID,
      txHash: "0xapprove",
      source: "chain",
      note: "Adjudicator approved the claim.",
    }),
  );

  if (stage === "approved") return events;

  events.push(
    event(10, "settlement.submitted", { claimId: CLAIM_ID, txHash: "0xsettle" }),
    event(11, "settlement.confirmed", {
      claimId: CLAIM_ID,
      txHash: "0xsettle",
      source: "chain",
      note: "Fixed payout of 0.05 STRK returned to the STRK20 private balance.",
      data: {
        payoutWei: TIER_1.payoutWei,
        publicBeforeWei: "1000000000000000000",
        publicAfterWei: "999000000000000000",
        privateBeforeWei: "400000000000000000",
        privateAfterWei: "450000000000000000",
      },
    }),
    event(12, "reserve.observed", {
      source: "chain",
      data: { reserveWei: "950000000000000000", exposureWei: "0", invokes: "3" },
    }),
  );

  return events;
}

export const SECRET = {
  commitment: POLICY_COMMITMENT,
  // Test-only key. It authorises nothing: no contract is configured in the E2E build.
  privateKey: "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80",
  publicKey: "0x2",
  salt: "0x3",
  tier: 1,
  createdAt: BASE_TS,
};

export const REVEAL = {
  version: 2,
  policyId: POLICY_ID,
  policyCommitment: POLICY_COMMITMENT,
  claimCommitment: CLAIM_COMMITMENT,
  incidentHash: "0x8",
  incidentSalt: "0x7",
  incidentText: "sequencer outage suspended settlement for 41 minutes",
  tier: 1,
  createdAt: BASE_TS,
  submitTx: "0xclaim",
};

/** Plant state before the app boots, so hydration reads it on first render. */
export async function seed(page: Page, stage: Stage) {
  const events = ledgerFor(stage);
  await page.addInitScript(
    ({ events, secret, reveal, keys }) => {
      try {
        window.localStorage.setItem(keys.ledger, JSON.stringify(events));
        window.localStorage.setItem(keys.secrets, JSON.stringify([secret]));
        window.localStorage.setItem(keys.reveals, JSON.stringify([reveal]));
        window.localStorage.setItem(keys.seq, JSON.stringify(events.length));
        window.localStorage.setItem(keys.migration, JSON.stringify(true));
      } catch {
        /* storage blocked; the app's own banner covers this case */
      }
    },
    {
      events,
      secret: SECRET,
      reveal: REVEAL,
      keys: {
        ledger: LEDGER_KEY,
        secrets: SECRETS_KEY,
        reveals: REVEALS_KEY,
        seq: SEQ_KEY,
        migration: MIGRATION_FLAG,
      },
    },
  );
}

/** Start from a genuinely empty browser — the first-visit case. */
export async function seedEmpty(page: Page) {
  await page.addInitScript((flag) => {
    try {
      window.localStorage.clear();
      window.localStorage.setItem(flag, JSON.stringify(true));
    } catch {
      /* nothing to clear */
    }
  }, MIGRATION_FLAG);
}
