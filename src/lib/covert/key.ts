"use client";
import { ec, hash, num, stark } from "starknet";
import type { ClaimDraft, LocalPolicyKey } from "./types";

const KEY = "covert.policy.keys.v2";
const CLAIMS = "covert.claim.drafts.v1";
const CLAIM_DOMAIN = "0x434f564552545f434c41494d5f5631"; // COVERT_CLAIM_V1
const REDEEM_DOMAIN = "0x434f564552545f52454445454d5f5631"; // COVERT_REDEEM_V1

export function createPolicyKey(tier: number): LocalPolicyKey {
  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const salt = stark.randomAddress();
  // The contract owns policy duration. Expiry is deliberately absent from this commitment.
  const commitment = hash.computePoseidonHashOnElements([publicKey, salt, tier]);
  const item = { commitment, privateKey, publicKey, salt, tier, createdAt: Date.now() };
  const all = loadPolicyKeys();
  localStorage.setItem(KEY, JSON.stringify([item, ...all]));
  return item;
}

export function loadPolicyKeys(): LocalPolicyKey[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

export function signClaimSubmission(
  key: LocalPolicyKey,
  claimCommitment: string,
  incidentHash: string,
) {
  const messageHash = hash.computePoseidonHashOnElements([
    CLAIM_DOMAIN,
    key.commitment,
    claimCommitment,
    incidentHash,
  ]);
  const sig = ec.starkCurve.sign(messageHash, key.privateKey, { lowS: true });
  return { messageHash, r: num.toHex(sig.r), s: num.toHex(sig.s) };
}

export function signRedemption(key: LocalPolicyKey, claimCommitment: string, payoutWei: bigint) {
  const messageHash = hash.computePoseidonHashOnElements([
    REDEEM_DOMAIN,
    key.commitment,
    claimCommitment,
    num.toHex(payoutWei),
  ]);
  const sig = ec.starkCurve.sign(messageHash, key.privateKey, { lowS: true });
  return { messageHash, r: num.toHex(sig.r), s: num.toHex(sig.s) };
}

export function makeIncidentCommitment(policyCommitment: string, incidentText: string) {
  const normalized = incidentText.trim().toLowerCase();
  if (normalized.length < 8) throw new Error("Describe the incident in at least 8 characters.");
  const incidentSalt = stark.randomAddress();
  const textHash = num.toHex(hash.starknetKeccak(normalized));
  // Salt prevents an observer from dictionary-guessing common incident descriptions.
  const incidentHash = hash.computePoseidonHashOnElements([textHash, incidentSalt]);
  const claimCommitment = hash.computePoseidonHashOnElements([policyCommitment, incidentHash]);
  return { incidentHash, incidentSalt, claimCommitment };
}


export function verifyIncidentReveal(draft: Pick<ClaimDraft, "policyCommitment" | "claimCommitment" | "incidentHash" | "incidentSalt" | "incidentText">) {
  const normalized = draft.incidentText.trim().toLowerCase();
  if (normalized.length < 8) {
    return { incidentMatches: false, claimMatches: false, recomputedIncidentHash: "0x0", recomputedClaimCommitment: "0x0" };
  }
  const textHash = num.toHex(hash.starknetKeccak(normalized));
  const recomputedIncidentHash = hash.computePoseidonHashOnElements([textHash, draft.incidentSalt]);
  const recomputedClaimCommitment = hash.computePoseidonHashOnElements([draft.policyCommitment, recomputedIncidentHash]);
  const sameFelt = (a: string, b: string) => { try { return BigInt(a) === BigInt(b); } catch { return false; } };
  return {
    incidentMatches: sameFelt(recomputedIncidentHash, draft.incidentHash),
    claimMatches: sameFelt(recomputedClaimCommitment, draft.claimCommitment),
    recomputedIncidentHash,
    recomputedClaimCommitment,
  };
}

export function saveClaimDraft(draft: ClaimDraft) {
  if (typeof window === "undefined") return;
  const existing = loadClaimDrafts().filter((x) => x.claimCommitment !== draft.claimCommitment);
  localStorage.setItem(CLAIMS, JSON.stringify([draft, ...existing]));
}

export function loadClaimDrafts(): ClaimDraft[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(CLAIMS) ?? "[]"); } catch { return []; }
}
