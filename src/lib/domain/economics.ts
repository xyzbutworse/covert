/**
 * Tier economics — the single client-side mirror of the contract's constants.
 *
 * These values MUST equal the `PREMIUM_n` / `PAYOUT_n` / `TERM_n` constants in
 * cairo/src/covert_policy.cairo. `tests/economics.test.ts` parses the Cairo source
 * and fails if the two ever drift, because a client that quotes a premium the
 * contract rejects produces a BAD_PREMIUM revert the user cannot act on.
 *
 * The client never *chooses* economics. It quotes them so the UI can show a price
 * before signing; the contract derives premium, payout and term from the tier byte.
 */

import type { TierId } from "./types";

export const WEI = 10n ** 18n;

export type Tier = {
  id: TierId;
  name: string;
  premiumWei: bigint;
  payoutWei: bigint;
  termSeconds: number;
  termDays: number;
  blurb: string;
};

export const TIERS: readonly Tier[] = [
  {
    id: 1,
    name: "SIGNAL",
    premiumWei: 10_000_000_000_000_000n, // 0.01 STRK
    payoutWei: 50_000_000_000_000_000n, // 0.05 STRK
    termSeconds: 604_800,
    termDays: 7,
    blurb: "Short-window cover for a single monitored service.",
  },
  {
    id: 2,
    name: "SHIELD",
    premiumWei: 20_000_000_000_000_000n, // 0.02 STRK
    payoutWei: 100_000_000_000_000_000n, // 0.10 STRK
    termSeconds: 1_209_600,
    termDays: 14,
    blurb: "Two-week cover at the standard proof payout.",
  },
  {
    id: 3,
    name: "BLACKOUT",
    premiumWei: 40_000_000_000_000_000n, // 0.04 STRK
    payoutWei: 200_000_000_000_000_000n, // 0.20 STRK
    termSeconds: 2_592_000,
    termDays: 30,
    blurb: "Longest term and largest fixed indemnity in the proof set.",
  },
] as const;

export function tier(id: number): Tier | undefined {
  return TIERS.find((t) => t.id === id);
}

export function requireTier(id: number): Tier {
  const t = tier(id);
  if (!t) throw new Error(`BAD_TIER: no tier ${id}`);
  return t;
}

/** Format wei as STRK. `dp` defaults to 4 — enough to show every proof-tier value exactly. */
export function formatStrk(wei: bigint | null | undefined, dp = 4): string {
  if (wei === null || wei === undefined) return "—";
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / WEI;
  const frac = abs % WEI;
  const fracStr = frac.toString().padStart(18, "0").slice(0, dp).replace(/0+$/, "");
  const body = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return `${negative ? "-" : ""}${body}`;
}

export function formatStrkSigned(wei: bigint | null | undefined, dp = 4): string {
  if (wei === null || wei === undefined) return "—";
  const s = formatStrk(wei, dp);
  return wei > 0n ? `+${s}` : s;
}

/**
 * Parse a user-typed STRK amount into wei without float drift.
 * Returns null for anything that is not a clean non-negative decimal.
 */
export function parseStrk(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > 18) return null;
  const padded = frac.padEnd(18, "0");
  try {
    return BigInt(whole || "0") * WEI + BigInt(padded || "0");
  } catch {
    return null;
  }
}
