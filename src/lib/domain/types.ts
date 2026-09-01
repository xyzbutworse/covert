/**
 * COVERT shared domain model.
 *
 * One vocabulary for every surface. Cover, Claim, Verify, Settle, Reserve, Proof and
 * History all read the same entities derived from the same append-only event log.
 * Nothing in this file talks to a chain or a browser API: it is pure data + rules so
 * it can be unit-tested without a wallet.
 */

/** Coverage tier identifiers. Mirrors `economics()` in cairo/src/covert_policy.cairo. */
export type TierId = 1 | 2 | 3;

/**
 * Policy lifecycle.
 *
 * `draft` .. `activating` are local-only states that exist before the chain knows
 * anything. Everything from `active` onward has an onchain counterpart and is
 * reconciled against `policy_state()` whenever the chain is readable.
 */
export type PolicyStatus =
  | "draft"          // bearer key minted locally; no transaction attempted yet
  | "activating"     // purchase transaction submitted, awaiting confirmation
  | "active"         // confirmed onchain; claimable until expiry
  | "claim_pending"  // a claim exists and is awaiting adjudication
  | "claim_approved" // adjudicator approved; settlement is now authorised
  | "claim_denied"   // adjudicator denied; exposure released, policy closed
  | "settling"       // settlement transaction submitted
  | "settled"        // payout returned privately; policy closed
  | "expired"        // term elapsed with no claim; exposure released
  | "failed";        // purchase never landed; nothing onchain to recover

/**
 * Claim lifecycle. Maps 1:1 onto the contract's
 * (`claim_exists`, `claim_decision`, `claim_redeemed`) triple.
 */
export type ClaimStatus =
  | "draft"        // commitment computed locally, not yet submitted
  | "submitting"   // submission transaction in flight
  | "under_review" // onchain, decision == PENDING
  | "approved"     // onchain, decision == APPROVED, not yet redeemed
  | "denied"       // onchain, decision == DENIED (terminal)
  | "settling"     // redemption transaction in flight
  | "settled"      // onchain, redeemed == true (terminal)
  | "failed";      // submission reverted; the policy's claim slot was not consumed

/** Onchain decision encoding from covert_policy.cairo. */
export const DECISION_PENDING = 0;
export const DECISION_APPROVED = 1;
export const DECISION_DENIED = 2;

/** Terminal states never transition again. */
export const TERMINAL_POLICY_STATES: readonly PolicyStatus[] = [
  "claim_denied",
  "settled",
  "expired",
  "failed",
];
export const TERMINAL_CLAIM_STATES: readonly ClaimStatus[] = ["denied", "settled"];

/**
 * Where a fact came from. This is the LIVE / REPLAY boundary and it is never
 * inferred: a replayed artifact keeps `source: "replay"` forever so no surface can
 * accidentally present captured evidence as a live mainnet result.
 */
export type EventSource = "local" | "chain" | "replay";

export type LifecycleEventKind =
  // funding
  | "funding.shield_submitted"
  | "funding.shield_confirmed"
  | "funding.shield_failed"
  | "funding.note_matured"
  // policy
  | "policy.key_created"
  | "policy.purchase_submitted"
  | "policy.activated"
  | "policy.purchase_failed"
  | "policy.expired"
  // claim
  | "claim.drafted"
  | "claim.submitted"
  | "claim.submit_failed"
  | "claim.confirmed"
  | "claim.packet_exported"
  | "claim.packet_imported"
  | "claim.reveal_verified"
  | "claim.reveal_rejected"
  | "claim.approved"
  | "claim.denied"
  // settlement
  | "settlement.attempted"
  | "settlement.rejected"
  | "settlement.submitted"
  | "settlement.confirmed"
  | "settlement.failed"
  // observations
  | "reserve.observed"
  | "balance.observed";

/**
 * Append-only lifecycle record. `seq` is a monotonic local counter so ordering
 * survives clock skew and same-millisecond writes.
 */
export type LifecycleEvent = {
  id: string;
  seq: number;
  ts: number;
  kind: LifecycleEventKind;
  source: EventSource;
  policyId?: string;
  claimId?: string;
  txHash?: string;
  /** Machine-readable invariant name for failures, e.g. "NOT_APPROVED". */
  reason?: string;
  /** Human sentence shown in timelines. */
  note?: string;
  data?: Record<string, unknown>;
};

/**
 * A policy as the product understands it.
 *
 * `id` is the human reference (CVT-XXXX-NNNN) and is derived deterministically from
 * the commitment, so the same policy has the same label in every browser that holds
 * its packet. `commitment` is the onchain identity.
 */
export type Policy = {
  id: string;
  commitment: string;
  publicKey: string;
  tier: TierId;
  status: PolicyStatus;
  createdAt: number;
  /** Set once the purchase confirms. */
  activatedAt?: number;
  /** Onchain expiry (unix seconds). Derived by the contract, never by the client. */
  expiresAt?: number;
  premiumWei: bigint;
  payoutWei: bigint;
  termDays: number;
  purchaseTx?: string;
  claimId?: string;
  settlementTx?: string;
  settledAt?: number;
  /** Last failure reason if status is "failed". */
  failureReason?: string;
  /** True once chain state has confirmed this policy at least once. */
  chainConfirmed: boolean;
};

export type Claim = {
  id: string;
  claimCommitment: string;
  policyId: string;
  policyCommitment: string;
  incidentHash: string;
  status: ClaimStatus;
  createdAt: number;
  submittedAt?: number;
  decidedAt?: number;
  settledAt?: number;
  submitTx?: string;
  decisionTx?: string;
  settlementTx?: string;
  denialReason?: string;
  failureReason?: string;
  /** Count of settlement attempts that were rejected before approval. */
  rejectedSettlements: number;
  chainConfirmed: boolean;
};

/**
 * The private reveal. This is the material an adjudicator needs and the public must
 * not have. It is stored separately from the ledger and is what
 * `exportPacket`/`importPacket` move between browsers.
 */
export type RevealPacket = {
  version: 2;
  policyId: string;
  policyCommitment: string;
  claimCommitment: string;
  incidentHash: string;
  incidentSalt: string;
  incidentText: string;
  tier: TierId;
  createdAt: number;
  submitTx?: string;
};

/** Bearer material. Never leaves the browser, never enters the ledger or a packet. */
export type PolicySecret = {
  commitment: string;
  privateKey: string;
  publicKey: string;
  salt: string;
  tier: TierId;
  createdAt: number;
};

/** Per-claim reveal salt, held locally by the claimant until they export a packet. */
export type ClaimSecret = {
  claimCommitment: string;
  incidentSalt: string;
  incidentText: string;
};

/** A reserve reading taken from the chain at a point in time. */
export type ReserveObservation = {
  ts: number;
  reserveWei: bigint;
  exposureWei: bigint;
  invokes: bigint;
  source: EventSource;
};

/**
 * Reserve accounting. `reserveWei`/`exposureWei` are chain truth when available;
 * the remaining fields are derived from the local ledger and are labelled as such
 * in the UI so a reader never mistakes a projection for a contract read.
 */
export type ReserveAccount = {
  observed: ReserveObservation | null;
  /** reserve - exposure. Negative would mean the solvency invariant was violated. */
  availableWei: bigint | null;
  /** Sum of payouts actually settled, from the ledger. */
  settledLiabilitiesWei: bigint;
  /** Sum of premiums paid into the pool, from the ledger. */
  premiumsPaidWei: bigint;
  /** Outstanding fixed payout obligations tracked locally. */
  localExposureWei: bigint;
  solvencyRatio: number | null;
  solvent: boolean | null;
  counts: {
    active: number;
    claimPending: number;
    approved: number;
    denied: number;
    settled: number;
    expired: number;
    failed: number;
    total: number;
  };
};

/** Observed balance pair used to prove the public wallet was not the payout target. */
export type BalanceDelta = {
  publicBeforeWei: bigint | null;
  publicAfterWei: bigint | null;
  privateBeforeWei: bigint | null;
  privateAfterWei: bigint | null;
};

export function publicDelta(d: BalanceDelta): bigint | null {
  if (d.publicBeforeWei === null || d.publicAfterWei === null) return null;
  return d.publicAfterWei - d.publicBeforeWei;
}

export function privateDelta(d: BalanceDelta): bigint | null {
  if (d.privateBeforeWei === null || d.privateAfterWei === null) return null;
  return d.privateAfterWei - d.privateBeforeWei;
}
