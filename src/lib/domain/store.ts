"use client";
/**
 * The one store every COVERT surface reads.
 *
 * Cover, Claim, Verify, Reserve, Proof and History all mount this. There are no
 * page-local copies of a policy or a claim: a screen either dispatches an event or
 * reads a projection. That is what makes "policy CVT-… created in Cover appears in
 * Claim, changes in Verify, closes in Settlement" true by construction rather than
 * by three screens agreeing to write the same shape.
 */

import { create } from "zustand";
import { claimRef, eventId, policyRef } from "./ids";
import { TIERS } from "./economics";
import {
  accountReserve,
  project,
  timelineFor,
  type Projection,
  type TierEconomics,
} from "./projection";
import {
  bumpSeqTo,
  hasStorage,
  loadEvents,
  loadSecrets,
  nextSeq,
  saveEvents,
  takeLegacyState,
  wipeAll,
  wipeSensitive,
} from "./persistence";
import type {
  Claim,
  LifecycleEvent,
  LifecycleEventKind,
  Policy,
  PolicySecret,
  ReserveAccount,
  TierId,
} from "./types";

const TIER_ECONOMICS: TierEconomics[] = TIERS.map((t) => ({
  id: t.id,
  name: t.name,
  premiumWei: t.premiumWei,
  payoutWei: t.payoutWei,
  termDays: t.termDays,
}));

export type AppendInput = {
  kind: LifecycleEventKind;
  policyId?: string;
  claimId?: string;
  txHash?: string;
  reason?: string;
  note?: string;
  source?: LifecycleEvent["source"];
  data?: Record<string, unknown>;
};

/**
 * Keys for in-flight operations. A second identical action is refused while the
 * first is unconfirmed, which is what stops a double-click from paying twice.
 */
export type InFlightKey = string;

type LedgerState = {
  hydrated: boolean;
  /** False when localStorage is unavailable; the session still works, in memory. */
  persistent: boolean;
  events: LifecycleEvent[];
  projection: Projection;
  reserve: ReserveAccount;
  inFlight: Record<InFlightKey, number>;

  hydrate: () => void;
  append: (input: AppendInput) => LifecycleEvent;
  appendMany: (inputs: AppendInput[]) => void;
  /** Merge foreign events (an imported evidence bundle) without duplicating ids. */
  merge: (events: LifecycleEvent[]) => number;

  beginInFlight: (key: InFlightKey) => boolean;
  endInFlight: (key: InFlightKey) => void;
  isInFlight: (key: InFlightKey) => boolean;

  clearSensitive: () => void;
  clearEverything: () => void;
};

const EMPTY_PROJECTION: Projection = {
  policies: [],
  claims: [],
  byPolicyId: new Map(),
  byClaimId: new Map(),
  reserveObservations: [],
};

function recompute(events: LifecycleEvent[]) {
  const projection = project(events, TIER_ECONOMICS);
  return { projection, reserve: accountReserve(projection) };
}

export const useLedger = create<LedgerState>((set, get) => ({
  hydrated: false,
  persistent: false,
  events: [],
  projection: EMPTY_PROJECTION,
  reserve: accountReserve(EMPTY_PROJECTION),
  inFlight: {},

  hydrate: () => {
    if (get().hydrated) return;
    const persistent = hasStorage();
    let events = loadEvents();

    // Bring forward anything the pre-ledger build stored, once.
    const legacy = takeLegacyState();
    if (legacy) {
      const migrated: LifecycleEvent[] = [];
      let seq = events.reduce((m, e) => Math.max(m, e.seq), 0);

      for (const key of legacy.keys) {
        const id = policyRef(key.commitment);
        const t = TIERS.find((x) => x.id === key.tier);
        seq += 1;
        migrated.push({
          id: eventId(),
          seq,
          ts: key.createdAt,
          kind: "policy.key_created",
          source: "local",
          policyId: id,
          note: "Recovered from a previous COVERT build in this browser.",
          data: {
            commitment: key.commitment,
            publicKey: key.publicKey,
            tier: key.tier,
            premiumWei: (t?.premiumWei ?? 0n).toString(),
            payoutWei: (t?.payoutWei ?? 0n).toString(),
            termDays: t?.termDays ?? 0,
            migrated: true,
          },
        });
      }

      for (const draft of legacy.drafts) {
        const policyId = policyRef(draft.policyCommitment);
        const cid = claimRef(draft.claimCommitment);
        seq += 1;
        migrated.push({
          id: eventId(),
          seq,
          ts: draft.createdAt,
          kind: "claim.drafted",
          source: "local",
          policyId,
          claimId: cid,
          note: "Recovered from a previous COVERT build in this browser.",
          data: { claimCommitment: draft.claimCommitment, incidentHash: draft.incidentHash, migrated: true },
        });
        if (draft.submitTx) {
          seq += 1;
          migrated.push({
            id: eventId(),
            seq,
            ts: draft.createdAt,
            kind: "claim.submitted",
            source: "local",
            policyId,
            claimId: cid,
            txHash: draft.submitTx,
            data: { migrated: true },
          });
        }
      }

      if (migrated.length) {
        events = [...events, ...migrated];
        bumpSeqTo(seq);
        saveEvents(events);
      }
    }

    // Keep the sequence counter ahead of anything already stored.
    bumpSeqTo(events.reduce((m, e) => Math.max(m, e.seq), 0));

    set({ hydrated: true, persistent, events, ...recompute(events) });
  },

  append: (input) => {
    const ev: LifecycleEvent = {
      id: eventId(),
      seq: nextSeq(),
      ts: Date.now(),
      source: input.source ?? "local",
      kind: input.kind,
      policyId: input.policyId,
      claimId: input.claimId,
      txHash: input.txHash,
      reason: input.reason,
      note: input.note,
      data: input.data,
    };
    const events = [...get().events, ev];
    saveEvents(events);
    set({ events, ...recompute(events) });
    return ev;
  },

  appendMany: (inputs) => {
    if (!inputs.length) return;
    const now = Date.now();
    const created = inputs.map((input) => ({
      id: eventId(),
      seq: nextSeq(),
      ts: now,
      source: input.source ?? ("local" as const),
      kind: input.kind,
      policyId: input.policyId,
      claimId: input.claimId,
      txHash: input.txHash,
      reason: input.reason,
      note: input.note,
      data: input.data,
    }));
    const events = [...get().events, ...created];
    saveEvents(events);
    set({ events, ...recompute(events) });
  },

  merge: (incoming) => {
    const known = new Set(get().events.map((e) => e.id));
    const fresh = incoming.filter((e) => e && typeof e.id === "string" && !known.has(e.id));
    if (!fresh.length) return 0;
    const events = [...get().events, ...fresh];
    bumpSeqTo(events.reduce((m, e) => Math.max(m, e.seq), 0));
    saveEvents(events);
    set({ events, ...recompute(events) });
    return fresh.length;
  },

  beginInFlight: (key) => {
    if (get().inFlight[key]) return false;
    set((s) => ({ inFlight: { ...s.inFlight, [key]: Date.now() } }));
    return true;
  },

  endInFlight: (key) => {
    set((s) => {
      const next = { ...s.inFlight };
      delete next[key];
      return { inFlight: next };
    });
  },

  isInFlight: (key) => Boolean(get().inFlight[key]),

  clearSensitive: () => {
    wipeSensitive();
    set({});
  },

  clearEverything: () => {
    wipeAll();
    set({ events: [], hydrated: true, ...recompute([]) });
  },
}));

// ------------------------------------------------------------- selectors ----

export function usePolicies(): Policy[] {
  return useLedger((s) => s.projection.policies);
}

export function useClaims(): Claim[] {
  return useLedger((s) => s.projection.claims);
}

export function usePolicy(id: string | undefined): Policy | undefined {
  return useLedger((s) => (id ? s.projection.byPolicyId.get(id) : undefined));
}

export function useClaim(id: string | undefined): Claim | undefined {
  return useLedger((s) => (id ? s.projection.byClaimId.get(id) : undefined));
}

export function useTimeline(policyId: string | undefined, claimId?: string): LifecycleEvent[] {
  const events = useLedger((s) => s.events);
  if (!policyId) return [];
  return timelineFor(events, policyId, claimId);
}

/** Policies a claim can currently be filed against. */
export function claimablePolicies(policies: Policy[], nowSec: number): Policy[] {
  return policies.filter(
    (p) => p.status === "active" && p.expiresAt !== undefined && nowSec <= p.expiresAt,
  );
}

/** Policies whose term has elapsed but whose exposure has not been released yet. */
export function expirablePolicies(policies: Policy[], nowSec: number): Policy[] {
  return policies.filter(
    (p) => p.status === "active" && p.expiresAt !== undefined && nowSec > p.expiresAt,
  );
}

export function claimForPolicy(projection: Projection, policyId: string): Claim | undefined {
  const p = projection.byPolicyId.get(policyId);
  if (!p?.claimId) return undefined;
  return projection.byClaimId.get(p.claimId);
}

/** Bearer keys held by this browser. Read on demand; never kept in React state. */
export function heldSecrets(): PolicySecret[] {
  return loadSecrets();
}

export function tierIdOf(value: number): TierId {
  return (value === 1 || value === 2 || value === 3 ? value : 2) as TierId;
}
