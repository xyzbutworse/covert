/**
 * Browser persistence.
 *
 * COVERT splits stored state into three tiers and keeps them in separate keys so the
 * security properties of each are visible rather than implied:
 *
 *  1. LEDGER  (covert.ledger.v1)  — public, chain-reconstructable lifecycle events.
 *     Losing it costs history, not money: every entry can be rebuilt from Starknet
 *     events given the policy commitment.
 *
 *  2. REVEALS (covert.reveals.v1) — incident text and salt. Private but not
 *     load-bearing for custody. Leaking it reveals what a claim was about; it does
 *     not let anyone move funds.
 *
 *  3. SECRETS (covert.secrets.v1) — policy bearer private keys. This IS custody.
 *     Whoever holds a bearer key can authorise that policy's claim and settlement.
 *     COVERT cannot recover it and no server ever sees it.
 *
 * See SECURITY.md. The prototype keeps tier 3 in localStorage, which is the honest
 * limitation: it is readable by any script that achieves XSS on this origin.
 */

import type { ClaimSecret, LifecycleEvent, PolicySecret, RevealPacket } from "./types";

const LEDGER_KEY = "covert.ledger.v1";
const SECRETS_KEY = "covert.secrets.v1";
const REVEALS_KEY = "covert.reveals.v1";
const SEQ_KEY = "covert.seq.v1";

/** Legacy keys from the pre-ledger build, migrated once then left in place. */
const LEGACY_POLICY_KEYS = "covert.policy.keys.v2";
const LEGACY_CLAIM_DRAFTS = "covert.claim.drafts.v1";
const MIGRATION_FLAG = "covert.migrated.v1";

export function hasStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const probe = "__covert_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    // Private browsing, blocked site data, or a sandboxed frame.
    return false;
  }
}

function readJSON<T>(key: string, fallback: T): T {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): boolean {
  if (!hasStorage()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded. The caller keeps working in memory for this session.
    return false;
  }
}

// ---------------------------------------------------------------- ledger ----

export function loadEvents(): LifecycleEvent[] {
  const raw = readJSON<unknown[]>(LEDGER_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isEvent);
}

export function saveEvents(events: LifecycleEvent[]): boolean {
  return writeJSON(LEDGER_KEY, events);
}

function isEvent(x: unknown): x is LifecycleEvent {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.kind === "string" && typeof v.ts === "number" && typeof v.seq === "number";
}

export function nextSeq(): number {
  const current = Number(readJSON<number>(SEQ_KEY, 0)) || 0;
  const next = current + 1;
  writeJSON(SEQ_KEY, next);
  return next;
}

/** Keep the counter ahead of any imported event so merged ledgers stay ordered. */
export function bumpSeqTo(value: number): void {
  const current = Number(readJSON<number>(SEQ_KEY, 0)) || 0;
  if (value > current) writeJSON(SEQ_KEY, value);
}

// --------------------------------------------------------------- secrets ----

export function loadSecrets(): PolicySecret[] {
  const raw = readJSON<unknown[]>(SECRETS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is PolicySecret =>
      Boolean(x) && typeof x === "object" &&
      typeof (x as PolicySecret).commitment === "string" &&
      typeof (x as PolicySecret).privateKey === "string",
  );
}

export function saveSecret(secret: PolicySecret): boolean {
  const all = loadSecrets().filter((s) => s.commitment !== secret.commitment);
  return writeJSON(SECRETS_KEY, [secret, ...all]);
}

export function findSecret(commitment: string): PolicySecret | undefined {
  return loadSecrets().find((s) => {
    try {
      return BigInt(s.commitment) === BigInt(commitment);
    } catch {
      return s.commitment === commitment;
    }
  });
}

// --------------------------------------------------------------- reveals ----

export function loadReveals(): RevealPacket[] {
  const raw = readJSON<unknown[]>(REVEALS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPacket);
}

export function saveReveal(packet: RevealPacket): boolean {
  const all = loadReveals().filter((r) => r.claimCommitment !== packet.claimCommitment);
  return writeJSON(REVEALS_KEY, [packet, ...all]);
}

export function findReveal(claimCommitment: string): RevealPacket | undefined {
  return loadReveals().find((r) => {
    try {
      return BigInt(r.claimCommitment) === BigInt(claimCommitment);
    } catch {
      return r.claimCommitment === claimCommitment;
    }
  });
}

export function isPacket(x: unknown): x is RevealPacket {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  return (
    ["policyCommitment", "claimCommitment", "incidentHash", "incidentSalt", "incidentText"].every(
      (k) => typeof v[k] === "string" && (v[k] as string).length > 0,
    ) && typeof v.createdAt === "number"
  );
}

export function claimSecretOf(packet: RevealPacket): ClaimSecret {
  return {
    claimCommitment: packet.claimCommitment,
    incidentSalt: packet.incidentSalt,
    incidentText: packet.incidentText,
  };
}

// ------------------------------------------------------------ destructive ----

/**
 * Erase bearer keys and reveals but keep the public ledger.
 *
 * Offered explicitly because the honest thing to tell a user holding bearer keys in
 * localStorage is how to get rid of them. Any unsettled policy becomes permanently
 * unclaimable, which the UI states before calling this.
 */
export function wipeSensitive(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(SECRETS_KEY);
    window.localStorage.removeItem(REVEALS_KEY);
  } catch {
    /* nothing further to do */
  }
}

export function wipeAll(): void {
  if (!hasStorage()) return;
  try {
    for (const k of [LEDGER_KEY, SECRETS_KEY, REVEALS_KEY, SEQ_KEY, MIGRATION_FLAG]) {
      window.localStorage.removeItem(k);
    }
  } catch {
    /* nothing further to do */
  }
}

/** How much custody material this browser currently holds. */
export function sensitiveSummary(): { bearerKeys: number; reveals: number; ledgerEvents: number } {
  return {
    bearerKeys: loadSecrets().length,
    reveals: loadReveals().length,
    ledgerEvents: loadEvents().length,
  };
}

// --------------------------------------------------------------- migration ----

export type LegacyPolicyKey = {
  commitment: string;
  privateKey: string;
  publicKey: string;
  salt: string;
  tier: number;
  createdAt: number;
};

export type LegacyClaimDraft = {
  policyCommitment: string;
  claimCommitment: string;
  incidentHash: string;
  incidentSalt: string;
  incidentText: string;
  createdAt: number;
  submitTx?: string;
};

/**
 * One-shot import of the pre-ledger build's storage.
 *
 * Returns the recovered material so the caller can synthesise the matching ledger
 * events. Existing users keep their policies instead of silently losing them.
 */
export function takeLegacyState(): { keys: LegacyPolicyKey[]; drafts: LegacyClaimDraft[] } | null {
  if (!hasStorage()) return null;
  if (readJSON<boolean>(MIGRATION_FLAG, false)) return null;

  const keys = readJSON<LegacyPolicyKey[]>(LEGACY_POLICY_KEYS, []).filter(
    (k) => k && typeof k.commitment === "string" && typeof k.privateKey === "string",
  );
  const drafts = readJSON<LegacyClaimDraft[]>(LEGACY_CLAIM_DRAFTS, []).filter(
    (d) => d && typeof d.claimCommitment === "string" && typeof d.policyCommitment === "string",
  );

  writeJSON(MIGRATION_FLAG, true);
  if (!keys.length && !drafts.length) return null;
  return { keys, drafts };
}
