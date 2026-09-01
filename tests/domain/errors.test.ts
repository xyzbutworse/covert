import { describe, expect, it } from "vitest";
import { CovertError, makeFailure, normalizeError } from "@/lib/domain/errors";

/**
 * The CORRECT-FAILURE rule.
 *
 * "It failed" is never a pass. Each adversarial case must resolve to the one
 * invariant that actually stopped it, because the product's explanation to the user
 * and its evidence ledger are both built from that code.
 */
describe("failure normalisation", () => {
  it("extracts the invariant from a Starknet revert string", () => {
    const revert =
      "Transaction execution has failed:\n0x...('NOT_APPROVED')\nError in contract";
    expect(normalizeError(new Error(revert)).code).toBe("NOT_APPROVED");
  });

  it("does not let CLAIMED shadow CLAIM_EXISTS", () => {
    // Longest-match ordering matters: both codes share a prefix.
    expect(normalizeError(new Error("Failure reason: CLAIM_EXISTS")).code).toBe("CLAIM_EXISTS");
    expect(normalizeError(new Error("Failure reason: CLAIMED")).code).toBe("CLAIMED");
  });

  it("distinguishes the two double-spend guards from the authorization guard", () => {
    expect(normalizeError(new Error("POLICY_HAS_CLAIM")).code).toBe("POLICY_HAS_CLAIM");
    expect(normalizeError(new Error("NOT_APPROVED")).code).toBe("NOT_APPROVED");
    expect(normalizeError(new Error("NOT_ADJUDICATOR")).code).toBe("NOT_ADJUDICATOR");
    expect(normalizeError(new Error("NOT_ANON")).code).toBe("NOT_ANON");
  });

  it("maps every contract error class correctly", () => {
    const cases: [string, string][] = [
      ["BAD_SIGNATURE", "authentication"],
      ["BAD_COMMITMENT", "authentication"],
      ["NOT_ADJUDICATOR", "authorization"],
      ["BAD_POOL", "authorization"],
      ["INSOLVENT", "economics"],
      ["EXPIRED", "state"],
      ["NOT_CONFIGURED", "configuration"],
    ];
    for (const [code, cls] of cases) {
      const f = normalizeError(new Error(`reverted with ${code}`));
      expect(f.code, code).toBe(code);
      expect(f.class, code).toBe(cls);
    }
  });

  it("recognises wallet rejections without a code word", () => {
    expect(normalizeError(new Error("User rejected the request")).code).toBe("USER_REFUSED_OP");
    expect(normalizeError({ code: "USER_REFUSED_OP", message: "nope" }).code).toBe("USER_REFUSED_OP");
  });

  it("classifies transport failures as network, not as protocol rejections", () => {
    expect(normalizeError(new Error("fetch failed")).code).toBe("RPC_UNAVAILABLE");
    expect(normalizeError(new Error("request timed out")).code).toBe("CONFIRMATION_TIMEOUT");
    expect(normalizeError(new Error("fetch failed")).class).toBe("network");
  });

  it("marks expected protocol refusals as expected, and unknowns as not", () => {
    expect(normalizeError(new Error("NOT_APPROVED")).expected).toBe(true);
    expect(normalizeError(new Error("something nobody planned for")).expected).toBe(false);
    expect(normalizeError(new Error("something nobody planned for")).code).toBe("UNKNOWN");
  });

  it("always supplies a recovery path — no failure is a dead end", () => {
    const samples = [
      "NOT_APPROVED",
      "INSOLVENT",
      "BAD_SIGNATURE",
      "USER_REFUSED_OP",
      "RPC_UNAVAILABLE",
      "NOT_DEPLOYED",
      "PACKET_MISMATCH",
      "utterly unknown failure",
    ];
    for (const s of samples) {
      const f = normalizeError(new Error(s));
      expect(f.recovery.length, s).toBeGreaterThan(10);
      expect(f.title.length, s).toBeGreaterThan(3);
      expect(f.detail.length, s).toBeGreaterThan(10);
    }
  });

  it("round-trips a CovertError thrown by application code", () => {
    const f = normalizeError(new CovertError("DUPLICATE_IN_FLIGHT"));
    expect(f.code).toBe("DUPLICATE_IN_FLIGHT");
    expect(f.class).toBe("state");
  });

  it("passes an already-normalised failure through unchanged", () => {
    const f = makeFailure("INSOLVENT", "raw text");
    expect(normalizeError(f)).toBe(f);
  });

  it("preserves the raw message for the evidence ledger", () => {
    const raw = "Transaction execution has failed: NOT_APPROVED at 0xabc";
    expect(normalizeError(new Error(raw)).raw).toBe(raw);
  });

  it("treats a revert with no known code as a revert, not as a network error", () => {
    expect(normalizeError(new Error("Transaction reverted for reasons")).code).toBe("TX_REVERTED");
  });
});
