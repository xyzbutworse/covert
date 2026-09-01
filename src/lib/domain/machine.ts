/**
 * Explicit lifecycle state machines.
 *
 * Every status change in COVERT goes through `advancePolicy` / `advanceClaim`. An
 * illegal transition is refused here rather than being silently written, which is
 * what stops a page from inventing a state its own screen happens to want.
 *
 * Pure module: no chain, no storage, no React.
 */

import {
  DECISION_APPROVED,
  DECISION_DENIED,
  DECISION_PENDING,
  TERMINAL_CLAIM_STATES,
  TERMINAL_POLICY_STATES,
  type ClaimStatus,
  type PolicyStatus,
} from "./types";

/** Allowed policy transitions. Anything absent is rejected. */
const POLICY_TRANSITIONS: Record<PolicyStatus, readonly PolicyStatus[]> = {
  draft: ["activating", "failed"],
  activating: ["active", "failed", "activating"],
  // A confirmed policy can be claimed, run out its term, or be re-read as active.
  active: ["claim_pending", "expired", "active"],
  claim_pending: ["claim_approved", "claim_denied", "claim_pending", "active", "expired"],
  claim_approved: ["settling", "claim_approved", "settled"],
  settling: ["settled", "claim_approved", "settling"],
  // Terminal.
  claim_denied: [],
  settled: [],
  expired: [],
  failed: [],
};

/**
 * Allowed claim transitions.
 *
 * `submitting -> failed` is the recoverable path: the submission reverted, so the
 * policy's claim slot was never consumed and the claimant may file again.
 */
const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  draft: ["submitting", "failed"],
  submitting: ["under_review", "failed", "submitting"],
  under_review: ["approved", "denied", "under_review"],
  approved: ["settling", "approved", "settled"],
  settling: ["settled", "approved", "settling"],
  denied: [],
  settled: [],
  failed: ["submitting"],
};

export function canAdvancePolicy(from: PolicyStatus, to: PolicyStatus): boolean {
  return POLICY_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canAdvanceClaim(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Apply a transition, or keep the current state if the move is illegal.
 *
 * Returning the unchanged state (rather than throwing) is deliberate: reconciliation
 * folds noisy, out-of-order chain reads into local state, and a late read must never
 * be able to drag a settled policy backwards.
 */
export function advancePolicy(from: PolicyStatus, to: PolicyStatus): PolicyStatus {
  return canAdvancePolicy(from, to) ? to : from;
}

export function advanceClaim(from: ClaimStatus, to: ClaimStatus): ClaimStatus {
  return canAdvanceClaim(from, to) ? to : from;
}

export function isPolicyTerminal(s: PolicyStatus): boolean {
  return TERMINAL_POLICY_STATES.includes(s);
}

export function isClaimTerminal(s: ClaimStatus): boolean {
  return TERMINAL_CLAIM_STATES.includes(s);
}

/** A policy is claimable only in these states, and only before expiry. */
export function isClaimable(status: PolicyStatus, expiresAt: number | undefined, nowSec: number): boolean {
  if (status !== "active") return false;
  if (expiresAt === undefined) return false;
  return nowSec <= expiresAt;
}

/** Settlement is authorised only once the adjudicator has approved. */
export function isSettleable(policyStatus: PolicyStatus, claimStatus: ClaimStatus): boolean {
  return policyStatus === "claim_approved" && claimStatus === "approved";
}

/**
 * The precondition COVERT deliberately demonstrates failing.
 *
 * Returns the invariant a settlement attempt would violate right now, or null when
 * the attempt should succeed. The UI uses this to *predict* the rejection; the
 * contract is what actually enforces it.
 */
export function settlementBlocker(policyStatus: PolicyStatus, claimStatus: ClaimStatus): string | null {
  if (claimStatus === "settled" || policyStatus === "settled") return "CLAIMED";
  if (claimStatus === "denied" || policyStatus === "claim_denied") return "NOT_APPROVED";
  if (claimStatus === "draft" || claimStatus === "failed") return "CLAIM_MISSING";
  if (claimStatus === "submitting") return "CLAIM_MISSING";
  if (claimStatus === "under_review") return "NOT_APPROVED";
  if (policyStatus === "expired") return "POLICY_MISSING";
  if (isSettleable(policyStatus, claimStatus)) return null;
  if (claimStatus === "settling" || policyStatus === "settling") return "DUPLICATE_IN_FLIGHT";
  return "NOT_APPROVED";
}

/** Map the contract's `claim_decision` + `claim_redeemed` onto a claim status. */
export function claimStatusFromChain(
  exists: boolean,
  decision: number,
  redeemed: boolean,
  local: ClaimStatus,
): ClaimStatus {
  if (!exists) {
    // The chain has never seen it. Keep local pre-chain states; do not invent one.
    return local === "under_review" || local === "approved" || local === "denied" || local === "settled"
      ? local
      : local;
  }
  if (redeemed) return "settled";
  if (decision === DECISION_APPROVED) return "approved";
  if (decision === DECISION_DENIED) return "denied";
  if (decision === DECISION_PENDING) return "under_review";
  return local;
}

/** Map the contract's `policy_state` tuple onto a policy status. */
export function policyStatusFromChain(
  chain: { exists: boolean; active: boolean; claimed: boolean; hasClaim: boolean; expiry: number },
  claimStatus: ClaimStatus | null,
  nowSec: number,
  local: PolicyStatus,
): PolicyStatus {
  if (!chain.exists) {
    // Never downgrade a locally-known settled/denied policy because of a bad read.
    return isPolicyTerminal(local) ? local : local === "activating" ? "activating" : local;
  }
  if (chain.claimed) return "settled";
  if (!chain.active) {
    // Inactive with a claim means the claim was denied; inactive without one means expired.
    if (chain.hasClaim && claimStatus === "denied") return "claim_denied";
    if (chain.hasClaim) return "claim_denied";
    return "expired";
  }
  if (chain.hasClaim) {
    if (claimStatus === "approved") return "claim_approved";
    if (claimStatus === "settling") return "settling";
    return "claim_pending";
  }
  if (nowSec > chain.expiry) return "active"; // still active onchain until expire_policy runs
  return "active";
}

/** Plain-language label for a policy status. */
export const POLICY_LABEL: Record<PolicyStatus, string> = {
  draft: "DRAFT",
  activating: "ACTIVATING",
  active: "ACTIVE",
  claim_pending: "CLAIM UNDER REVIEW",
  claim_approved: "APPROVED — READY TO SETTLE",
  claim_denied: "CLAIM DENIED",
  settling: "SETTLING",
  settled: "SETTLED",
  expired: "EXPIRED",
  failed: "ACTIVATION FAILED",
};

export const CLAIM_LABEL: Record<ClaimStatus, string> = {
  draft: "DRAFT",
  submitting: "SUBMITTING",
  under_review: "UNDER REVIEW",
  approved: "APPROVED",
  denied: "DENIED",
  settling: "SETTLING",
  settled: "SETTLED",
  failed: "SUBMISSION FAILED",
};

/** Which UI tone a status carries. Used for the status pill, never for logic. */
export function policyTone(s: PolicyStatus): "neutral" | "good" | "warn" | "bad" | "live" {
  switch (s) {
    case "active": return "good";
    case "settled": return "good";
    case "claim_approved": return "good";
    case "activating":
    case "settling":
    case "claim_pending": return "live";
    case "expired": return "warn";
    case "claim_denied":
    case "failed": return "bad";
    default: return "neutral";
  }
}
