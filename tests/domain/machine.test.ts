import { describe, expect, it } from "vitest";
import {
  advanceClaim,
  advancePolicy,
  canAdvanceClaim,
  canAdvancePolicy,
  claimStatusFromChain,
  isClaimable,
  isClaimTerminal,
  isPolicyTerminal,
  isSettleable,
  policyStatusFromChain,
  settlementBlocker,
} from "@/lib/domain/machine";
import type { ClaimStatus, PolicyStatus } from "@/lib/domain/types";

const ALL_POLICY: PolicyStatus[] = [
  "draft",
  "activating",
  "active",
  "claim_pending",
  "claim_approved",
  "claim_denied",
  "settling",
  "settled",
  "expired",
  "failed",
];

const ALL_CLAIM: ClaimStatus[] = [
  "draft",
  "submitting",
  "under_review",
  "approved",
  "denied",
  "settling",
  "settled",
  "failed",
];

describe("policy state machine", () => {
  it("never leaves a terminal state", () => {
    for (const terminal of ALL_POLICY.filter(isPolicyTerminal)) {
      for (const target of ALL_POLICY) {
        expect(canAdvancePolicy(terminal, target)).toBe(false);
        expect(advancePolicy(terminal, target)).toBe(terminal);
      }
    }
  });

  it("keeps the current state when a transition is illegal", () => {
    // A late chain read must never drag a settled policy backwards.
    expect(advancePolicy("settled", "active")).toBe("settled");
    expect(advancePolicy("active", "settled")).toBe("active");
    expect(advancePolicy("draft", "settled")).toBe("draft");
  });

  it("walks the intended happy path", () => {
    let s: PolicyStatus = "draft";
    for (const next of ["activating", "active", "claim_pending", "claim_approved", "settling", "settled"] as PolicyStatus[]) {
      s = advancePolicy(s, next);
      expect(s).toBe(next);
    }
  });

  it("allows a failed purchase to be a terminal outcome", () => {
    expect(advancePolicy("activating", "failed")).toBe("failed");
    expect(isPolicyTerminal("failed")).toBe(true);
  });

  it("allows an active policy to expire but not to skip to settled", () => {
    expect(advancePolicy("active", "expired")).toBe("expired");
    expect(advancePolicy("active", "settling")).toBe("active");
  });
});

describe("claim state machine", () => {
  it("never leaves a terminal state", () => {
    for (const terminal of ALL_CLAIM.filter(isClaimTerminal)) {
      for (const target of ALL_CLAIM) {
        expect(canAdvanceClaim(terminal, target)).toBe(false);
      }
    }
  });

  it("lets a failed submission be retried, because the slot was never consumed", () => {
    expect(advanceClaim("submitting", "failed")).toBe("failed");
    expect(advanceClaim("failed", "submitting")).toBe("submitting");
  });

  it("cannot jump from under_review straight to settled", () => {
    expect(advanceClaim("under_review", "settled")).toBe("under_review");
  });
});

describe("claimability", () => {
  const now = 1_000_000;

  it("requires an active policy inside its term", () => {
    expect(isClaimable("active", now + 10, now)).toBe(true);
    expect(isClaimable("active", now - 1, now)).toBe(false);
    expect(isClaimable("active", undefined, now)).toBe(false);
    expect(isClaimable("claim_pending", now + 10, now)).toBe(false);
    expect(isClaimable("settled", now + 10, now)).toBe(false);
  });
});

describe("settlement authorization", () => {
  it("is authorised only when the policy is approved and the claim is approved", () => {
    expect(isSettleable("claim_approved", "approved")).toBe(true);
    expect(isSettleable("claim_pending", "approved")).toBe(false);
    expect(isSettleable("claim_approved", "under_review")).toBe(false);
  });

  it("names NOT_APPROVED for a claim still under review", () => {
    // This is the exact invariant the product's central demonstration relies on.
    expect(settlementBlocker("claim_pending", "under_review")).toBe("NOT_APPROVED");
  });

  it("names CLAIMED once settled, so a retry is not mistaken for an authorization problem", () => {
    expect(settlementBlocker("settled", "settled")).toBe("CLAIMED");
  });

  it("names NOT_APPROVED for a denied claim", () => {
    expect(settlementBlocker("claim_denied", "denied")).toBe("NOT_APPROVED");
  });

  it("names CLAIM_MISSING before a claim reaches the chain", () => {
    expect(settlementBlocker("active", "draft")).toBe("CLAIM_MISSING");
    expect(settlementBlocker("active", "submitting")).toBe("CLAIM_MISSING");
    expect(settlementBlocker("active", "failed")).toBe("CLAIM_MISSING");
  });

  it("returns null exactly when settlement should succeed", () => {
    expect(settlementBlocker("claim_approved", "approved")).toBeNull();
  });

  it("blocks a duplicate while one is already in flight", () => {
    expect(settlementBlocker("settling", "settling")).toBe("DUPLICATE_IN_FLIGHT");
  });
});

describe("chain reconciliation", () => {
  it("maps the contract's claim triple onto a status", () => {
    expect(claimStatusFromChain(true, 0, false, "submitting")).toBe("under_review");
    expect(claimStatusFromChain(true, 1, false, "under_review")).toBe("approved");
    expect(claimStatusFromChain(true, 2, false, "under_review")).toBe("denied");
    // redeemed wins over decision: the money has moved.
    expect(claimStatusFromChain(true, 1, true, "approved")).toBe("settled");
  });

  it("keeps local state when the chain has never seen the claim", () => {
    expect(claimStatusFromChain(false, 0, false, "draft")).toBe("draft");
  });

  it("reads a claimed policy as settled", () => {
    const s = policyStatusFromChain(
      { exists: true, active: false, claimed: true, hasClaim: true, expiry: 0 },
      "settled",
      1_000,
      "settling",
    );
    expect(s).toBe("settled");
  });

  it("distinguishes an expired policy from a denied one", () => {
    expect(
      policyStatusFromChain({ exists: true, active: false, claimed: false, hasClaim: false, expiry: 0 }, null, 1_000, "active"),
    ).toBe("expired");
    expect(
      policyStatusFromChain({ exists: true, active: false, claimed: false, hasClaim: true, expiry: 0 }, "denied", 1_000, "claim_pending"),
    ).toBe("claim_denied");
  });

  it("does not downgrade a terminal local state on a bad read", () => {
    const s = policyStatusFromChain(
      { exists: false, active: false, claimed: false, hasClaim: false, expiry: 0 },
      null,
      1_000,
      "settled",
    );
    expect(s).toBe("settled");
  });

  it("reports an approved claim's policy as ready to settle", () => {
    expect(
      policyStatusFromChain({ exists: true, active: true, claimed: false, hasClaim: true, expiry: 9_999 }, "approved", 1_000, "claim_pending"),
    ).toBe("claim_approved");
  });
});
