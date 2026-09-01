"use client";
/**
 * Lifecycle operations.
 *
 * The only layer allowed to change COVERT's state. Screens call these; they never
 * touch the chain or the ledger directly. Each operation:
 *
 *   1. refuses to start if an identical action is already in flight,
 *   2. records intent in the ledger before the transaction leaves,
 *   3. resolves the transaction's REAL outcome (a revert is not a success),
 *   4. records the result — including failures, which are evidence, not noise,
 *   5. reconciles against chain state so the projection matches reality.
 *
 * Because every screen reads the projection this produces, a policy activated in
 * Cover is the same object Claim, Verify, Reserve, Proof and History see.
 */

import { claimRef, policyRef, sameFelt } from "@/lib/domain/ids";
import { formatStrk, requireTier } from "@/lib/config";
import { CovertError, normalizeError, type NormalizedFailure } from "@/lib/domain/errors";
import { claimStatusFromChain, policyStatusFromChain, settlementBlocker } from "@/lib/domain/machine";
import { findReveal, findSecret, saveReveal } from "@/lib/domain/persistence";
import { useLedger } from "@/lib/domain/store";
import type { Claim, Policy, RevealPacket, TierId } from "@/lib/domain/types";
import {
  readClaimState,
  readPolicyState,
  readPublicStrkBalance,
  readReserveState,
  type TxOutcome,
} from "@/lib/chain/read";
import { useWallet } from "@/lib/wallet/store";
import {
  approveClaim,
  buyPolicy,
  denyClaim,
  expirePolicy,
  expireStaleClaim,
  privateStrkBalanceWei,
  redeemClaim,
  shield,
  submitClaim,
  type SubmitResult,
} from "./actions";
import { createPolicySecret, makeIncidentCommitment, verifyIncidentReveal } from "./key";

/** What every operation hands back to the UI. Never throws for expected failures. */
export type OperationResult<T = void> = {
  ok: boolean;
  value?: T;
  failure?: NormalizedFailure;
  txHash?: string;
};

function fromError(e: unknown, txHash?: string): OperationResult<never> {
  return { ok: false, failure: normalizeError(e), txHash };
}

/** Turn a reverted transaction into the invariant it violated. */
function failureFromRevert(outcome: TxOutcome): NormalizedFailure {
  return normalizeError(new Error(outcome.revertReason ?? "TX_REVERTED"));
}

async function guarded<T>(key: string, run: () => Promise<OperationResult<T>>): Promise<OperationResult<T>> {
  const ledger = useLedger.getState();
  if (!ledger.beginInFlight(key)) {
    return { ok: false, failure: normalizeError(new CovertError("DUPLICATE_IN_FLIGHT")) };
  }
  try {
    return await run();
  } finally {
    useLedger.getState().endInFlight(key);
  }
}

// ------------------------------------------------------------- funding ----

export async function shieldFunds(amountWei: bigint): Promise<OperationResult<string>> {
  return guarded("shield", async () => {
    const ledger = useLedger.getState();
    ledger.append({
      kind: "funding.shield_submitted",
      note: `Shielding ${formatStrk(amountWei)} STRK. This deposit is public by design.`,
      data: { amountWei: amountWei.toString() },
    });
    try {
      const { txHash, outcome }: SubmitResult = await shield(amountWei);
      if (outcome.status === "reverted") {
        const failure = failureFromRevert(outcome);
        useLedger.getState().append({
          kind: "funding.shield_failed",
          txHash,
          reason: failure.code,
          note: failure.detail,
        });
        return { ok: false, failure, txHash };
      }
      useLedger.getState().append({
        kind: "funding.shield_confirmed",
        txHash,
        source: "chain",
        note: `Shielded ${formatStrk(amountWei)} STRK into the STRK20 pool.`,
        data: { amountWei: amountWei.toString() },
      });
      return { ok: true, value: txHash, txHash };
    } catch (e) {
      const failure = normalizeError(e);
      useLedger.getState().append({ kind: "funding.shield_failed", reason: failure.code, note: failure.detail });
      return { ok: false, failure };
    }
  });
}

// -------------------------------------------------------------- policy ----

/**
 * Activate cover.
 *
 * The bearer key is minted *before* the transaction and recorded as a draft policy,
 * so a purchase that fails leaves a visible failed policy the user can understand
 * instead of an orphaned key with no history.
 */
export async function activateCover(tierId: number): Promise<OperationResult<Policy>> {
  return guarded(`buy:${tierId}`, async () => {
    const t = requireTier(tierId);
    const secret = createPolicySecret(t.id);
    const policyId = policyRef(secret.commitment);
    const ledger = useLedger.getState();

    ledger.append({
      kind: "policy.key_created",
      policyId,
      note: `Bearer key minted in this browser for a ${t.name} policy. COVERT cannot recover it.`,
      data: {
        commitment: secret.commitment,
        publicKey: secret.publicKey,
        tier: t.id,
        premiumWei: t.premiumWei.toString(),
        payoutWei: t.payoutWei.toString(),
        termDays: t.termDays,
      },
    });

    try {
      const { txHash, outcome } = await buyPolicy(secret);
      useLedger.getState().append({
        kind: "policy.purchase_submitted",
        policyId,
        txHash,
        note: `Routing ${formatStrk(t.premiumWei)} STRK through STRK20 to the COVERT anonymizer.`,
      });

      if (outcome.status === "reverted") {
        const failure = failureFromRevert(outcome);
        useLedger.getState().append({
          kind: "policy.purchase_failed",
          policyId,
          txHash,
          reason: failure.code,
          note: failure.detail,
        });
        return { ok: false, failure, txHash };
      }

      // Expiry is contract-derived; read it back rather than computing it here.
      const chain = await readPolicyState(secret.commitment).catch(() => null);
      useLedger.getState().append({
        kind: "policy.activated",
        policyId,
        txHash,
        source: chain ? "chain" : "local",
        note: `${t.name} cover is active. Payout is fixed at ${formatStrk(t.payoutWei)} STRK.`,
        data: chain ? { expiresAt: chain.expiry, tier: chain.tier } : {},
      });

      const policy = useLedger.getState().projection.byPolicyId.get(policyId);
      return { ok: true, value: policy, txHash };
    } catch (e) {
      const failure = normalizeError(e);
      useLedger.getState().append({
        kind: "policy.purchase_failed",
        policyId,
        reason: failure.code,
        note: failure.detail,
      });
      return { ok: false, failure };
    }
  });
}

/** Release the exposure of a policy whose term ended without a claim. */
export async function releaseExpiredPolicy(policyId: string): Promise<OperationResult<string>> {
  return guarded(`expire:${policyId}`, async () => {
    const policy = useLedger.getState().projection.byPolicyId.get(policyId);
    if (!policy) return fromError(new CovertError("POLICY_MISSING"));
    try {
      const { txHash, outcome } = await expirePolicy(policy.commitment);
      if (outcome.status === "reverted") {
        return { ok: false, failure: failureFromRevert(outcome), txHash };
      }
      useLedger.getState().append({
        kind: "policy.expired",
        policyId,
        txHash,
        source: "chain",
        note: `Term ended. ${formatStrk(policy.payoutWei)} STRK of exposure released back to the reserve.`,
      });
      await observeReserve();
      return { ok: true, value: txHash, txHash };
    } catch (e) {
      return fromError(e);
    }
  });
}

// --------------------------------------------------------------- claim ----

export type FileClaimInput = {
  policyId: string;
  incidentText: string;
};

/**
 * File an authenticated claim.
 *
 * Eligibility is checked locally first so the user gets a precise reason instead of
 * paying gas to learn it, but the contract enforces every one of these rules again.
 */
export async function fileClaim(input: FileClaimInput): Promise<OperationResult<Claim>> {
  return guarded(`claim:${input.policyId}`, async () => {
    const state = useLedger.getState();
    const policy = state.projection.byPolicyId.get(input.policyId);
    if (!policy) return fromError(new CovertError("POLICY_MISSING"));

    const secret = findSecret(policy.commitment);
    if (!secret) return fromError(new CovertError("BAD_SIGNATURE", "No bearer key for this policy in this browser."));

    const nowSec = Math.floor(Date.now() / 1000);
    if (policy.status !== "active") return fromError(new CovertError("NO_ELIGIBLE_POLICY"));
    if (policy.expiresAt !== undefined && nowSec > policy.expiresAt) return fromError(new CovertError("EXPIRED"));

    let commitment;
    try {
      commitment = makeIncidentCommitment(policy.commitment, input.incidentText);
    } catch (e) {
      return fromError(e);
    }

    const claimId = claimRef(commitment.claimCommitment);

    // The reveal is stored locally only. It is never put in the ledger, because the
    // ledger is the part of state we treat as publicly reconstructable.
    const packet: RevealPacket = {
      version: 2,
      policyId: policy.id,
      policyCommitment: policy.commitment,
      claimCommitment: commitment.claimCommitment,
      incidentHash: commitment.incidentHash,
      incidentSalt: commitment.incidentSalt,
      incidentText: input.incidentText,
      tier: policy.tier,
      createdAt: Date.now(),
    };
    saveReveal(packet);

    useLedger.getState().append({
      kind: "claim.drafted",
      policyId: policy.id,
      claimId,
      note: "Incident committed with a fresh salt. The description itself stays offchain.",
      data: { claimCommitment: commitment.claimCommitment, incidentHash: commitment.incidentHash },
    });

    try {
      const { txHash, outcome } = await submitClaim(secret, commitment.claimCommitment, commitment.incidentHash);
      useLedger.getState().append({
        kind: "claim.submitted",
        policyId: policy.id,
        claimId,
        txHash,
        note: "Bearer key signed this exact claim before the policy's single claim slot was consumed.",
      });

      if (outcome.status === "reverted") {
        const failure = failureFromRevert(outcome);
        useLedger.getState().append({
          kind: "claim.submit_failed",
          policyId: policy.id,
          claimId,
          txHash,
          reason: failure.code,
          note: failure.detail,
        });
        return { ok: false, failure, txHash };
      }

      useLedger.getState().append({
        kind: "claim.confirmed",
        policyId: policy.id,
        claimId,
        txHash,
        source: "chain",
        note: "Claim recorded onchain and awaiting adjudication.",
      });
      saveReveal({ ...packet, submitTx: txHash });

      const claim = useLedger.getState().projection.byClaimId.get(claimId);
      return { ok: true, value: claim, txHash };
    } catch (e) {
      const failure = normalizeError(e);
      useLedger.getState().append({
        kind: "claim.submit_failed",
        policyId: policy.id,
        claimId,
        reason: failure.code,
        note: failure.detail,
      });
      return { ok: false, failure };
    }
  });
}

// --------------------------------------------------------- adjudication ----

export type DecisionInput = {
  claimId: string;
  decision: "approve" | "deny";
  reason?: string;
};

export async function decideClaim(input: DecisionInput): Promise<OperationResult<string>> {
  return guarded(`decide:${input.claimId}`, async () => {
    const claim = useLedger.getState().projection.byClaimId.get(input.claimId);
    if (!claim) return fromError(new CovertError("CLAIM_MISSING"));

    // A decision recorded against a claim this browser still holds as a draft
    // would be dropped by the state machine. Confirm it from the chain first.
    if (!claim.chainConfirmed) {
      const chain = await readClaimState(claim.claimCommitment).catch(() => null);
      if (chain?.exists) {
        useLedger.getState().append({
          kind: "claim.confirmed",
          policyId: claim.policyId,
          claimId: claim.id,
          source: "chain",
          note: "Claim confirmed onchain before recording a decision.",
        });
      } else {
        return fromError(new CovertError("CLAIM_MISSING", "This claim is not recorded onchain."));
      }
    }

    try {
      const { txHash, outcome } =
        input.decision === "approve"
          ? await approveClaim(claim.claimCommitment)
          : await denyClaim(claim.claimCommitment);

      if (outcome.status === "reverted") {
        return { ok: false, failure: failureFromRevert(outcome), txHash };
      }

      useLedger.getState().append({
        kind: input.decision === "approve" ? "claim.approved" : "claim.denied",
        policyId: claim.policyId,
        claimId: claim.id,
        txHash,
        source: "chain",
        note:
          input.decision === "approve"
            ? "Adjudicator approved the claim. Settlement is now authorised; the payout stays fixed by tier."
            : `Adjudicator denied the claim.${input.reason ? ` Reason: ${input.reason}` : ""}`,
        data: input.reason ? { reason: input.reason } : {},
      });
      await observeReserve();
      return { ok: true, value: txHash, txHash };
    } catch (e) {
      return fromError(e);
    }
  });
}

/** Close a claim the adjudicator abandoned past its onchain deadline. */
export async function timeOutClaim(claimId: string): Promise<OperationResult<string>> {
  return guarded(`timeout:${claimId}`, async () => {
    const claim = useLedger.getState().projection.byClaimId.get(claimId);
    if (!claim) return fromError(new CovertError("CLAIM_MISSING"));
    try {
      const { txHash, outcome } = await expireStaleClaim(claim.claimCommitment);
      if (outcome.status === "reverted") return { ok: false, failure: failureFromRevert(outcome), txHash };
      useLedger.getState().append({
        kind: "claim.denied",
        policyId: claim.policyId,
        claimId: claim.id,
        txHash,
        source: "chain",
        note: "Claim closed after the adjudication deadline elapsed. Exposure returned to the reserve.",
        data: { reason: "Adjudication deadline elapsed" },
      });
      await observeReserve();
      return { ok: true, value: txHash, txHash };
    } catch (e) {
      return fromError(e);
    }
  });
}

// ---------------------------------------------------------- settlement ----

export type SettlementEvidence = {
  publicBeforeWei: bigint | null;
  publicAfterWei: bigint | null;
  privateBeforeWei: bigint | null;
  privateAfterWei: bigint | null;
  payoutWei: bigint;
  txHash?: string;
};

/**
 * Attempt settlement — including deliberately, before approval.
 *
 * COVERT does not hide the failing path behind a disabled button. The user can run
 * settlement whenever they like; the contract decides. A rejection is written to
 * the ledger as `settlement.rejected` with the exact invariant, and that record is
 * what Proof and History later display as adversarial evidence.
 *
 * `predictedBlocker` is only used to warn the user beforehand. It never gates the
 * call, because a UI that refuses to try cannot demonstrate that the *contract*
 * refuses.
 */
export async function attemptSettlement(policyId: string): Promise<OperationResult<SettlementEvidence>> {
  return guarded(`settle:${policyId}`, async () => {
    const state = useLedger.getState();
    const policy = state.projection.byPolicyId.get(policyId);
    if (!policy) return fromError(new CovertError("POLICY_MISSING"));
    const claim = policy.claimId ? state.projection.byClaimId.get(policy.claimId) : undefined;
    if (!claim) return fromError(new CovertError("CLAIM_MISSING"));

    const secret = findSecret(policy.commitment);
    if (!secret) return fromError(new CovertError("BAD_SIGNATURE", "No bearer key for this policy in this browser."));

    const predicted = settlementBlocker(policy.status, claim.status);
    const { address } = useWallet.getState();

    // Capture both balances before, so the delta afterwards is measured, not asserted.
    const publicBeforeWei = address ? await readPublicStrkBalance(address).catch(() => null) : null;
    const privateBeforeWei = await privateStrkBalanceWei();

    useLedger.getState().append({
      kind: "settlement.attempted",
      policyId: policy.id,
      claimId: claim.id,
      note: predicted
        ? `Settlement attempted while the claim is not approved. The contract is expected to refuse with ${predicted}.`
        : "Settlement attempted against an approved claim.",
      data: {
        predictedBlocker: predicted,
        publicBeforeWei: publicBeforeWei?.toString() ?? null,
        privateBeforeWei: privateBeforeWei?.toString() ?? null,
      },
    });

    try {
      const { txHash, outcome } = await redeemClaim(secret, claim.claimCommitment);

      if (outcome.status === "reverted") {
        const failure = failureFromRevert(outcome);
        useLedger.getState().append({
          kind: "settlement.rejected",
          policyId: policy.id,
          claimId: claim.id,
          txHash,
          source: "chain",
          reason: failure.code,
          note: `Settlement refused onchain: ${failure.title}. ${failure.detail}`,
          data: { predictedBlocker: predicted, revertReason: outcome.revertReason ?? null },
        });
        return { ok: false, failure, txHash };
      }

      useLedger.getState().append({
        kind: "settlement.submitted",
        policyId: policy.id,
        claimId: claim.id,
        txHash,
      });

      const publicAfterWei = address ? await readPublicStrkBalance(address).catch(() => null) : null;
      const privateAfterWei = await privateStrkBalanceWei();

      useLedger.getState().append({
        kind: "settlement.confirmed",
        policyId: policy.id,
        claimId: claim.id,
        txHash,
        source: "chain",
        note: `Fixed payout of ${formatStrk(policy.payoutWei)} STRK returned to the STRK20 private balance.`,
        data: {
          payoutWei: policy.payoutWei.toString(),
          publicBeforeWei: publicBeforeWei?.toString() ?? null,
          publicAfterWei: publicAfterWei?.toString() ?? null,
          privateBeforeWei: privateBeforeWei?.toString() ?? null,
          privateAfterWei: privateAfterWei?.toString() ?? null,
        },
      });

      await observeReserve();

      return {
        ok: true,
        txHash,
        value: {
          publicBeforeWei,
          publicAfterWei,
          privateBeforeWei,
          privateAfterWei,
          payoutWei: policy.payoutWei,
          txHash,
        },
      };
    } catch (e) {
      const failure = normalizeError(e);
      // A wallet refusal is not a protocol rejection; keep the two distinguishable.
      useLedger.getState().append({
        kind: failure.class === "wallet" ? "settlement.failed" : "settlement.rejected",
        policyId: policy.id,
        claimId: claim.id,
        reason: failure.code,
        note: failure.detail,
        data: { predictedBlocker: predicted },
      });
      return { ok: false, failure };
    }
  });
}

// ------------------------------------------------------- reconciliation ----

/**
 * Fold chain truth back into the local projection.
 *
 * Called after a reload, after a timeout, and from the Reconcile button. This is
 * what makes a page refresh mid-flow safe: whatever the browser missed, the chain
 * still knows, and the state machine refuses any read that would move a policy
 * backwards.
 */
export async function reconcilePolicy(policyId: string): Promise<OperationResult<Policy>> {
  const state = useLedger.getState();
  const policy = state.projection.byPolicyId.get(policyId);
  if (!policy) return fromError(new CovertError("POLICY_MISSING"));

  try {
    const chainPolicy = await readPolicyState(policy.commitment);
    const claim = policy.claimId ? state.projection.byClaimId.get(policy.claimId) : undefined;

    let chainClaim = null;
    if (claim) {
      chainClaim = await readClaimState(claim.claimCommitment).catch(() => null);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const nextClaimStatus = chainClaim && claim
      ? claimStatusFromChain(chainClaim.exists, chainClaim.decision, chainClaim.redeemed, claim.status)
      : claim?.status ?? null;
    const nextPolicyStatus = policyStatusFromChain(chainPolicy, nextClaimStatus, nowSec, policy.status);

    const appends: Parameters<typeof state.appendMany>[0] = [];

    if (chainPolicy.exists && !policy.chainConfirmed) {
      appends.push({
        kind: "policy.activated",
        policyId,
        source: "chain",
        note: "Recovered from chain state.",
        data: { expiresAt: chainPolicy.expiry, tier: chainPolicy.tier },
      });
    }

    if (claim && chainClaim?.exists && !claim.chainConfirmed) {
      appends.push({
        kind: "claim.confirmed",
        policyId,
        claimId: claim.id,
        source: "chain",
        note: "Recovered from chain state.",
      });
    }

    if (claim && nextClaimStatus === "approved" && claim.status !== "approved" && claim.status !== "settled") {
      appends.push({
        kind: "claim.approved",
        policyId,
        claimId: claim.id,
        source: "chain",
        note: "Approval observed onchain.",
      });
    }
    if (claim && nextClaimStatus === "denied" && claim.status !== "denied") {
      appends.push({
        kind: "claim.denied",
        policyId,
        claimId: claim.id,
        source: "chain",
        note: "Denial observed onchain.",
      });
    }
    if (claim && nextClaimStatus === "settled" && claim.status !== "settled") {
      appends.push({
        kind: "settlement.confirmed",
        policyId,
        claimId: claim.id,
        source: "chain",
        note: "Settlement observed onchain.",
        data: { payoutWei: policy.payoutWei.toString() },
      });
    }
    if (nextPolicyStatus === "expired" && policy.status !== "expired") {
      appends.push({
        kind: "policy.expired",
        policyId,
        source: "chain",
        note: "Policy closed onchain without a claim.",
      });
    }

    if (appends.length) useLedger.getState().appendMany(appends);
    return { ok: true, value: useLedger.getState().projection.byPolicyId.get(policyId) };
  } catch (e) {
    return fromError(e);
  }
}

/** Reconcile every policy that is not already terminal. */
export async function reconcileAll(): Promise<OperationResult<number>> {
  const policies = useLedger.getState().projection.policies.filter(
    (p) => !["settled", "expired", "failed", "claim_denied", "draft"].includes(p.status),
  );
  let reconciled = 0;
  for (const p of policies) {
    const result = await reconcilePolicy(p.id);
    if (result.ok) reconciled += 1;
  }
  await observeReserve().catch(() => undefined);
  return { ok: true, value: reconciled };
}

/** Record a reserve reading. Reserve figures shown as chain truth come from here. */
export async function observeReserve(): Promise<OperationResult<void>> {
  try {
    const state = await readReserveState();
    useLedger.getState().append({
      kind: "reserve.observed",
      source: "chain",
      data: {
        reserveWei: state.reserveWei.toString(),
        exposureWei: state.exposureWei.toString(),
        invokes: state.invokes.toString(),
      },
    });
    return { ok: true };
  } catch (e) {
    return fromError(e);
  }
}

// -------------------------------------------------------------- packets ----

export function packetForClaim(claimId: string): RevealPacket | undefined {
  const claim = useLedger.getState().projection.byClaimId.get(claimId);
  if (!claim) return undefined;
  return findReveal(claim.claimCommitment);
}

export function recordPacketExport(claimId: string): void {
  const claim = useLedger.getState().projection.byClaimId.get(claimId);
  if (!claim) return;
  useLedger.getState().append({
    kind: "claim.packet_exported",
    policyId: claim.policyId,
    claimId: claim.id,
    note: "Private reveal packet exported for out-of-band delivery to the adjudicator.",
  });
}

export type ImportOutcome = {
  packet: RevealPacket;
  claimId: string;
};

/**
 * Import a reveal packet on the adjudicator's side.
 *
 * The packet is verified before it is stored: if recomputing poseidon over the
 * revealed text does not reproduce the committed hashes, it is rejected outright
 * rather than accepted-and-flagged, because a packet that fails this check is not
 * evidence of anything.
 */
export function importPacket(raw: string): OperationResult<ImportOutcome> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fromError(new CovertError("PACKET_MALFORMED", "Not valid JSON."));
  }

  const required = ["policyCommitment", "claimCommitment", "incidentHash", "incidentSalt", "incidentText"];
  const obj = parsed as Record<string, unknown>;
  if (!obj || typeof obj !== "object" || required.some((k) => typeof obj[k] !== "string" || !(obj[k] as string))) {
    return fromError(new CovertError("PACKET_MALFORMED", "Missing required reveal fields."));
  }

  const packet: RevealPacket = {
    version: 2,
    policyId: typeof obj.policyId === "string" ? obj.policyId : policyRef(String(obj.policyCommitment)),
    policyCommitment: String(obj.policyCommitment),
    claimCommitment: String(obj.claimCommitment),
    incidentHash: String(obj.incidentHash),
    incidentSalt: String(obj.incidentSalt),
    incidentText: String(obj.incidentText),
    tier: (typeof obj.tier === "number" ? obj.tier : 2) as TierId,
    createdAt: typeof obj.createdAt === "number" ? obj.createdAt : Date.now(),
    submitTx: typeof obj.submitTx === "string" ? obj.submitTx : undefined,
  };

  const check = verifyIncidentReveal(packet);
  if (!check.incidentMatches || !check.claimMatches) {
    const ledger = useLedger.getState();
    ledger.append({
      kind: "claim.reveal_rejected",
      policyId: packet.policyId,
      claimId: claimRef(packet.claimCommitment),
      reason: "PACKET_MISMATCH",
      note: "Imported packet did not reproduce its own commitments. Not stored.",
    });
    return fromError(new CovertError("PACKET_MISMATCH"));
  }

  saveReveal(packet);

  const claimId = claimRef(packet.claimCommitment);
  const ledger = useLedger.getState();
  const known = ledger.projection.byClaimId.get(claimId);

  if (!known) {
    // The adjudicator has never seen this policy; synthesise the minimum the
    // projection needs so the claim appears in their queue with a real timeline.
    const t = requireTier(packet.tier);
    ledger.appendMany([
      {
        kind: "policy.key_created",
        policyId: packet.policyId,
        note: "Policy reconstructed from an imported reveal packet. No bearer key is held here.",
        data: {
          commitment: packet.policyCommitment,
          publicKey: "0x0",
          tier: t.id,
          premiumWei: t.premiumWei.toString(),
          payoutWei: t.payoutWei.toString(),
          termDays: t.termDays,
          imported: true,
        },
      },
      {
        kind: "claim.drafted",
        policyId: packet.policyId,
        claimId,
        data: { claimCommitment: packet.claimCommitment, incidentHash: packet.incidentHash },
      },
      {
        kind: "claim.packet_imported",
        policyId: packet.policyId,
        claimId,
        txHash: packet.submitTx,
        note: "Reveal packet imported and recomputed successfully.",
      },
    ]);
  } else {
    ledger.append({
      kind: "claim.packet_imported",
      policyId: packet.policyId,
      claimId,
      note: "Reveal packet imported and recomputed successfully.",
    });
  }

  return { ok: true, value: { packet, claimId } };
}

/**
 * Cross-check an imported reveal against the claim actually recorded onchain.
 *
 * Recomputation proves the packet is internally consistent. This proves it
 * describes the claim that was really filed — a packet can be self-consistent and
 * still be about a different incident.
 */
export async function verifyPacketAgainstChain(claimId: string): Promise<
  OperationResult<{ matches: boolean; decision: number; redeemed: boolean }>
> {
  const claim = useLedger.getState().projection.byClaimId.get(claimId);
  if (!claim) return fromError(new CovertError("CLAIM_MISSING"));
  const packet = findReveal(claim.claimCommitment);
  if (!packet) return fromError(new CovertError("PACKET_MALFORMED", "No stored reveal for this claim."));

  try {
    const chain = await readClaimState(claim.claimCommitment);
    if (!chain.exists) {
      return fromError(new CovertError("CLAIM_MISSING", "This claim is not recorded onchain."));
    }
    const matches =
      sameFelt(chain.policyCommitment, packet.policyCommitment) &&
      sameFelt(chain.incidentHash, packet.incidentHash);

    useLedger.getState().append({
      kind: matches ? "claim.reveal_verified" : "claim.reveal_rejected",
      policyId: claim.policyId,
      claimId: claim.id,
      source: "chain",
      reason: matches ? undefined : "PACKET_CHAIN_MISMATCH",
      note: matches
        ? "Reveal recomputed and matched the onchain claim record."
        : "Reveal does not match the claim recorded onchain.",
    });

    if (!matches) return fromError(new CovertError("PACKET_CHAIN_MISMATCH"));

    // An imported claim starts as a local draft. Now that the chain confirms it
    // exists, advance it — otherwise a later approval would be an illegal
    // transition out of "draft" and the adjudicator's own decision would not
    // show up in their projection.
    const confirmed = useLedger.getState().projection.byClaimId.get(claim.id);
    if (confirmed && !confirmed.chainConfirmed) {
      useLedger.getState().append({
        kind: "claim.confirmed",
        policyId: claim.policyId,
        claimId: claim.id,
        source: "chain",
        txHash: packet.submitTx,
        note: "Claim confirmed onchain.",
      });
    }

    // If it was already decided before this browser saw it, record that too, so
    // the queue does not offer a decision the contract will refuse with DECIDED.
    const current = useLedger.getState().projection.byClaimId.get(claim.id);
    if (chain.redeemed && current?.status !== "settled") {
      useLedger.getState().appendMany([
        { kind: "claim.approved", policyId: claim.policyId, claimId: claim.id, source: "chain", note: "Approval observed onchain." },
        { kind: "settlement.confirmed", policyId: claim.policyId, claimId: claim.id, source: "chain", note: "Settlement observed onchain." },
      ]);
    } else if (chain.decision === 1 && current?.status === "under_review") {
      useLedger.getState().append({
        kind: "claim.approved",
        policyId: claim.policyId,
        claimId: claim.id,
        source: "chain",
        note: "Approval observed onchain.",
      });
    } else if (chain.decision === 2 && current?.status === "under_review") {
      useLedger.getState().append({
        kind: "claim.denied",
        policyId: claim.policyId,
        claimId: claim.id,
        source: "chain",
        note: "Denial observed onchain.",
      });
    }

    return { ok: true, value: { matches, decision: chain.decision, redeemed: chain.redeemed } };
  } catch (e) {
    return fromError(e);
  }
}
