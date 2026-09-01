/**
 * Event fold.
 *
 * The ledger is the append-only list of lifecycle events; Policy, Claim and Reserve
 * are *derived* from it. Nothing writes an entity directly. That is what makes
 * History, Proof and reload-recovery fall out for free instead of each screen
 * keeping its own copy of the truth.
 */

import { policyRef, claimRef } from "./ids";
import { advanceClaim, advancePolicy } from "./machine";
import type {
  Claim,
  LifecycleEvent,
  Policy,
  ReserveAccount,
  ReserveObservation,
  TierId,
} from "./types";

export type TierEconomics = {
  id: TierId;
  name: string;
  premiumWei: bigint;
  payoutWei: bigint;
  termDays: number;
};

export type Projection = {
  policies: Policy[];
  claims: Claim[];
  byPolicyId: Map<string, Policy>;
  byClaimId: Map<string, Claim>;
  reserveObservations: ReserveObservation[];
};

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function big(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "string" || typeof v === "number") {
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  }
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length ? v : undefined;
}

/**
 * Fold events into entities.
 *
 * Events are sorted by `seq` first so an out-of-order append (a late chain read, a
 * merged import) still produces a deterministic result.
 */
export function project(events: LifecycleEvent[], tiers: readonly TierEconomics[]): Projection {
  const ordered = [...events].sort((a, b) => a.seq - b.seq || a.ts - b.ts);
  const policies = new Map<string, Policy>();
  const claims = new Map<string, Claim>();
  const reserveObservations: ReserveObservation[] = [];

  const tierOf = (id: number) => tiers.find((t) => t.id === id);

  for (const ev of ordered) {
    const d = ev.data ?? {};

    switch (ev.kind) {
      case "policy.key_created": {
        const commitment = str(d.commitment);
        if (!commitment) break;
        const tierId = (num(d.tier, 2) as TierId);
        const econ = tierOf(tierId);
        const id = ev.policyId ?? policyRef(commitment);
        if (policies.has(id)) break;
        policies.set(id, {
          id,
          commitment,
          publicKey: str(d.publicKey) ?? "0x0",
          tier: tierId,
          status: "draft",
          createdAt: ev.ts,
          premiumWei: big(d.premiumWei) ?? econ?.premiumWei ?? 0n,
          payoutWei: big(d.payoutWei) ?? econ?.payoutWei ?? 0n,
          termDays: num(d.termDays, econ?.termDays ?? 0),
          chainConfirmed: false,
        });
        break;
      }

      case "policy.purchase_submitted": {
        const p = ev.policyId ? policies.get(ev.policyId) : undefined;
        if (!p) break;
        p.status = advancePolicy(p.status, "activating");
        p.purchaseTx = ev.txHash ?? p.purchaseTx;
        break;
      }

      case "policy.activated": {
        const p = ev.policyId ? policies.get(ev.policyId) : undefined;
        if (!p) break;
        p.status = advancePolicy(p.status, "active");
        p.purchaseTx = ev.txHash ?? p.purchaseTx;
        p.activatedAt = p.activatedAt ?? ev.ts;
        const expiry = num(d.expiresAt, 0);
        if (expiry > 0) p.expiresAt = expiry;
        p.chainConfirmed = ev.source !== "local" ? true : p.chainConfirmed;
        p.failureReason = undefined;
        break;
      }

      case "policy.purchase_failed": {
        const p = ev.policyId ? policies.get(ev.policyId) : undefined;
        if (!p) break;
        p.status = advancePolicy(p.status, "failed");
        p.failureReason = ev.reason ?? p.failureReason;
        break;
      }

      case "policy.expired": {
        const p = ev.policyId ? policies.get(ev.policyId) : undefined;
        if (!p) break;
        p.status = advancePolicy(p.status, "expired");
        break;
      }

      case "claim.drafted": {
        const claimCommitment = str(d.claimCommitment);
        const policyId = ev.policyId;
        if (!claimCommitment || !policyId) break;
        const p = policies.get(policyId);
        if (!p) break;
        const id = ev.claimId ?? claimRef(claimCommitment);
        if (!claims.has(id)) {
          claims.set(id, {
            id,
            claimCommitment,
            policyId,
            policyCommitment: p.commitment,
            incidentHash: str(d.incidentHash) ?? "0x0",
            status: "draft",
            createdAt: ev.ts,
            rejectedSettlements: 0,
            chainConfirmed: false,
          });
        }
        p.claimId = id;
        break;
      }

      case "claim.submitted": {
        const c = ev.claimId ? claims.get(ev.claimId) : undefined;
        if (!c) break;
        c.status = advanceClaim(c.status, "submitting");
        c.submitTx = ev.txHash ?? c.submitTx;
        c.submittedAt = c.submittedAt ?? ev.ts;
        break;
      }

      case "claim.confirmed": {
        const c = ev.claimId ? claims.get(ev.claimId) : undefined;
        if (!c) break;
        c.status = advanceClaim(c.status, "under_review");
        c.submitTx = ev.txHash ?? c.submitTx;
        c.chainConfirmed = ev.source !== "local" ? true : c.chainConfirmed;
        c.failureReason = undefined;
        const p = policies.get(c.policyId);
        if (p) p.status = advancePolicy(p.status, "claim_pending");
        break;
      }

      case "claim.submit_failed": {
        const c = ev.claimId ? claims.get(ev.claimId) : undefined;
        if (!c) break;
        c.status = advanceClaim(c.status, "failed");
        c.failureReason = ev.reason ?? c.failureReason;
        // The claim slot was never consumed onchain, so the policy stays claimable.
        break;
      }

      case "claim.approved": {
        const c = ev.claimId ? claims.get(ev.claimId) : undefined;
        if (!c) break;
        c.status = advanceClaim(c.status, "approved");
        c.decidedAt = c.decidedAt ?? ev.ts;
        c.decisionTx = ev.txHash ?? c.decisionTx;
        const p = policies.get(c.policyId);
        if (p) p.status = advancePolicy(p.status, "claim_approved");
        break;
      }

      case "claim.denied": {
        const c = ev.claimId ? claims.get(ev.claimId) : undefined;
        if (!c) break;
        c.status = advanceClaim(c.status, "denied");
        c.decidedAt = c.decidedAt ?? ev.ts;
        c.decisionTx = ev.txHash ?? c.decisionTx;
        c.denialReason = str(d.reason) ?? c.denialReason;
        const p = policies.get(c.policyId);
        if (p) p.status = advancePolicy(p.status, "claim_denied");
        break;
      }

      case "settlement.rejected": {
        const c = ev.claimId ? claims.get(ev.claimId) : undefined;
        if (!c) break;
        // The defining evidence of the product: a settlement the contract refused.
        c.rejectedSettlements += 1;
        break;
      }

      case "settlement.submitted": {
        const c = ev.claimId ? claims.get(ev.claimId) : undefined;
        if (!c) break;
        c.status = advanceClaim(c.status, "settling");
        c.settlementTx = ev.txHash ?? c.settlementTx;
        const p = policies.get(c.policyId);
        if (p) {
          p.status = advancePolicy(p.status, "settling");
          p.settlementTx = ev.txHash ?? p.settlementTx;
        }
        break;
      }

      case "settlement.confirmed": {
        const c = ev.claimId ? claims.get(ev.claimId) : undefined;
        if (!c) break;
        c.status = advanceClaim(c.status, "settled");
        c.settledAt = c.settledAt ?? ev.ts;
        c.settlementTx = ev.txHash ?? c.settlementTx;
        c.chainConfirmed = ev.source !== "local" ? true : c.chainConfirmed;
        const p = policies.get(c.policyId);
        if (p) {
          p.status = advancePolicy(p.status, "settled");
          p.settlementTx = ev.txHash ?? p.settlementTx;
          p.settledAt = p.settledAt ?? ev.ts;
        }
        break;
      }

      case "settlement.failed": {
        const c = ev.claimId ? claims.get(ev.claimId) : undefined;
        if (!c) break;
        // Fall back to the last authorised state so the user can retry.
        c.status = c.status === "settling" ? "approved" : c.status;
        c.failureReason = ev.reason ?? c.failureReason;
        const p = policies.get(c.policyId);
        if (p && p.status === "settling") p.status = "claim_approved";
        break;
      }

      case "reserve.observed": {
        const reserveWei = big(d.reserveWei);
        const exposureWei = big(d.exposureWei);
        if (reserveWei === null || exposureWei === null) break;
        reserveObservations.push({
          ts: ev.ts,
          reserveWei,
          exposureWei,
          invokes: big(d.invokes) ?? 0n,
          source: ev.source,
        });
        break;
      }

      default:
        break;
    }
  }

  const policyList = [...policies.values()].sort((a, b) => b.createdAt - a.createdAt);
  const claimList = [...claims.values()].sort((a, b) => b.createdAt - a.createdAt);

  return {
    policies: policyList,
    claims: claimList,
    byPolicyId: policies,
    byClaimId: claims,
    reserveObservations,
  };
}

/**
 * Reserve accounting.
 *
 * `observed` is contract truth. Everything else is a projection of what this browser
 * has witnessed, and the Reserve screen labels the two differently so a local
 * projection is never mistaken for a chain read.
 */
export function accountReserve(p: Projection): ReserveAccount {
  const observed = p.reserveObservations.length
    ? p.reserveObservations[p.reserveObservations.length - 1]
    : null;

  let settledLiabilitiesWei = 0n;
  let premiumsPaidWei = 0n;
  let localExposureWei = 0n;

  const counts = {
    active: 0,
    claimPending: 0,
    approved: 0,
    denied: 0,
    settled: 0,
    expired: 0,
    failed: 0,
    total: 0,
  };

  for (const policy of p.policies) {
    if (policy.status === "draft") continue; // never reached the chain
    counts.total += 1;

    if (policy.status !== "failed") premiumsPaidWei += policy.premiumWei;

    switch (policy.status) {
      case "active":
        counts.active += 1;
        localExposureWei += policy.payoutWei;
        break;
      case "claim_pending":
        counts.claimPending += 1;
        localExposureWei += policy.payoutWei;
        break;
      case "claim_approved":
      case "settling":
        counts.approved += 1;
        localExposureWei += policy.payoutWei;
        break;
      case "settled":
        counts.settled += 1;
        settledLiabilitiesWei += policy.payoutWei;
        break;
      case "claim_denied":
        counts.denied += 1;
        break;
      case "expired":
        counts.expired += 1;
        break;
      case "failed":
        counts.failed += 1;
        counts.total -= 1; // a failed purchase never became a liability
        break;
      case "activating":
        counts.active += 1;
        localExposureWei += policy.payoutWei;
        break;
      default:
        break;
    }
  }

  const availableWei = observed ? observed.reserveWei - observed.exposureWei : null;
  const solvencyRatio =
    observed === null
      ? null
      : observed.exposureWei === 0n
        ? Infinity
        : Number((observed.reserveWei * 10000n) / observed.exposureWei) / 100;

  return {
    observed,
    availableWei,
    settledLiabilitiesWei,
    premiumsPaidWei,
    localExposureWei,
    solvencyRatio,
    solvent: observed ? observed.reserveWei >= observed.exposureWei : null,
    counts,
  };
}

/** Every event touching one policy, oldest first — the policy timeline. */
export function timelineFor(events: LifecycleEvent[], policyId: string, claimId?: string): LifecycleEvent[] {
  return events
    .filter((e) => e.policyId === policyId || (claimId !== undefined && e.claimId === claimId))
    .sort((a, b) => a.seq - b.seq || a.ts - b.ts);
}
