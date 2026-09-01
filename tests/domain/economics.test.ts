import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TIERS, WEI, formatStrk, formatStrkSigned, parseStrk, requireTier, tier } from "@/lib/domain/economics";
import { claimRef, policyRef, sameFelt, short } from "@/lib/domain/ids";

const CAIRO = fs.readFileSync(
  path.resolve(__dirname, "../../cairo/src/covert_policy.cairo"),
  "utf8",
);

function cairoConst(name: string): bigint {
  const m = CAIRO.match(new RegExp(`const ${name}: u\\d+ = (\\d+);`));
  if (!m) throw new Error(`constant ${name} not found in covert_policy.cairo`);
  return BigInt(m[1]);
}

/**
 * The client quotes prices before the user signs. If its table drifts from the
 * contract's constants, every purchase reverts with BAD_PREMIUM and the user is
 * given a price the protocol will not honour. This test is the guard against that.
 */
describe("tier economics mirror the contract", () => {
  it("matches every premium, payout and term in covert_policy.cairo", () => {
    for (const [i, t] of TIERS.entries()) {
      const n = i + 1;
      expect(t.premiumWei, `${t.name} premium`).toBe(cairoConst(`PREMIUM_${n}`));
      expect(t.payoutWei, `${t.name} payout`).toBe(cairoConst(`PAYOUT_${n}`));
      expect(BigInt(t.termSeconds), `${t.name} term`).toBe(cairoConst(`TERM_${n}`));
    }
  });

  it("covers exactly the tiers the contract accepts", () => {
    expect(TIERS.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(CAIRO).toContain("assert(tier >= 1 && tier <= 3, errors::BAD_TIER)");
  });

  it("keeps term days consistent with term seconds", () => {
    for (const t of TIERS) {
      expect(t.termDays * 86_400).toBe(t.termSeconds);
    }
  });

  it("prices every payout above its premium", () => {
    for (const t of TIERS) expect(t.payoutWei).toBeGreaterThan(t.premiumWei);
  });

  it("rejects an unknown tier rather than guessing one", () => {
    expect(tier(4)).toBeUndefined();
    expect(() => requireTier(0)).toThrow(/BAD_TIER/);
  });
});

describe("STRK formatting", () => {
  it("formats whole and fractional amounts exactly", () => {
    expect(formatStrk(WEI)).toBe("1");
    expect(formatStrk(WEI / 2n)).toBe("0.5");
    expect(formatStrk(50_000_000_000_000_000n, 2)).toBe("0.05");
    expect(formatStrk(0n)).toBe("0");
  });

  it("never rounds a payout up into a number the contract will not pay", () => {
    // 0.05 STRK at 2dp must not become 0.06 or 0.1.
    expect(formatStrk(TIERS[0].payoutWei, 2)).toBe("0.05");
    expect(formatStrk(TIERS[2].payoutWei, 2)).toBe("0.2");
  });

  it("distinguishes unknown from zero", () => {
    expect(formatStrk(null)).toBe("—");
    expect(formatStrk(undefined)).toBe("—");
    expect(formatStrk(0n)).toBe("0");
  });

  it("signs deltas so a credit is never mistaken for a debit", () => {
    expect(formatStrkSigned(WEI)).toBe("+1");
    expect(formatStrkSigned(-WEI)).toBe("-1");
    expect(formatStrkSigned(0n)).toBe("0");
  });

  it("parses user input without float drift", () => {
    expect(parseStrk("0.1")).toBe(100_000_000_000_000_000n);
    expect(parseStrk("1")).toBe(WEI);
    expect(parseStrk("0.000000000000000001")).toBe(1n);
    expect(parseStrk("")).toBeNull();
    expect(parseStrk("abc")).toBeNull();
    expect(parseStrk("-1")).toBeNull();
    expect(parseStrk("1.2.3")).toBeNull();
    // More precision than wei can hold must be refused, not truncated.
    expect(parseStrk("0.0000000000000000001")).toBeNull();
  });

  it("round-trips parse and format", () => {
    for (const s of ["0.01", "0.05", "1", "12.345"]) {
      expect(formatStrk(parseStrk(s)!, 18)).toBe(s.replace(/\.?0+$/, "") || "0");
    }
  });
});

describe("references", () => {
  it("derives the same policy reference from the same commitment every time", () => {
    const c = "0x65b170e76ef2b8694d3e17bbc488fc359d7898cff2fe31eb73acefc79603a0c";
    expect(policyRef(c)).toBe(policyRef(c));
    expect(policyRef(c)).toMatch(/^CVT-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it("gives different commitments different references", () => {
    expect(policyRef("0x1")).not.toBe(policyRef("0x2"));
    expect(claimRef("0x1")).not.toBe(claimRef("0x2"));
  });

  it("is padding-insensitive when comparing felts", () => {
    expect(sameFelt("0x01", "0x1")).toBe(true);
    expect(sameFelt("0x1", "0x2")).toBe(false);
    expect(sameFelt(undefined, "0x1")).toBe(false);
    expect(sameFelt("not-a-felt", "0x1")).toBe(false);
  });

  it("shortens without pretending the shortened value is complete", () => {
    const long = `0x${"a".repeat(60)}`;
    expect(short(long)).toContain("…");
    expect(short("0xabc")).toBe("0xabc");
    expect(short(undefined)).toBe("—");
  });
});
