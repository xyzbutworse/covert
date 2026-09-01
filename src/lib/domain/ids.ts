/**
 * Human references.
 *
 * A policy's product-facing name is derived deterministically from its onchain
 * commitment, so the same policy reads as the same CVT-#### in the claimant's
 * browser, in the adjudicator's browser, and in an exported evidence bundle. There
 * is no counter to keep in sync and nothing to collide.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford-ish: no I, L, O, U.

function encode(value: bigint, length: number): string {
  let n = value;
  let out = "";
  for (let i = 0; i < length; i++) {
    out = ALPHABET[Number(n % 32n)] + out;
    n /= 32n;
  }
  return out;
}

function toBig(felt: string): bigint {
  try {
    return BigInt(felt);
  } catch {
    // Non-hex input still needs a stable reference rather than a crash.
    let h = 0n;
    for (const ch of String(felt)) h = (h * 131n + BigInt(ch.charCodeAt(0))) % (1n << 128n);
    return h;
  }
}

/** `CVT-7X19-0042` — stable, readable, derived only from the commitment. */
export function policyRef(commitment: string): string {
  const n = toBig(commitment);
  return `CVT-${encode((n >> 32n) & 0xfffffn, 4)}-${encode(n & 0xffffn, 4)}`;
}

/** `CLM-4KQ2` — claims are always shown next to their policy, so 4 chars is enough. */
export function claimRef(claimCommitment: string): string {
  return `CLM-${encode(toBig(claimCommitment) & 0xfffffn, 4)}`;
}

/** Monotonic, collision-resistant id for ledger events. */
let counter = 0;
export function eventId(): string {
  counter += 1;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `ev_${Date.now().toString(36)}_${counter.toString(36)}_${rand}`;
}

/** Shorten a felt/hash for display without ever implying it is the whole value. */
export function short(value: string | undefined, head = 10, tail = 6): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Compare two felts numerically; tolerates padding differences. */
export function sameFelt(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}
