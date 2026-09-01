"use client";
/**
 * Bearer keys, commitments and reveals.
 *
 * A COVERT policy is controlled by a Stark-curve keypair minted in the browser, not
 * by the wallet that paid for it. That indirection is the whole point: the policy
 * contract registers a public key, so nothing onchain links the policy to the
 * address that bought it. The private half never leaves this device and COVERT
 * cannot recover it.
 *
 * Storage lives in `domain/persistence`; this module is pure cryptography plus the
 * one call that mints and persists a new bearer key.
 */

import { ec, hash, num, stark } from "starknet";
import { requireTier } from "@/lib/config";
import { CovertError } from "@/lib/domain/errors";
import { findSecret, saveSecret } from "@/lib/domain/persistence";
import type { PolicySecret, RevealPacket, TierId } from "@/lib/domain/types";

/** Domain separators. Identical to the felt constants in covert_policy.cairo. */
const CLAIM_DOMAIN = "0x434f564552545f434c41494d5f5631"; // 'COVERT_CLAIM_V1'
const REDEEM_DOMAIN = "0x434f564552545f52454445454d5f5631"; // 'COVERT_REDEEM_V1'

export const MIN_INCIDENT_CHARS = 8;

/**
 * Mint a bearer key for a new policy.
 *
 * The commitment is poseidon(publicKey, salt, tier). Expiry is deliberately absent:
 * the contract derives the term from the tier, so a client cannot commit to a
 * duration it would like to have.
 */
export function createPolicySecret(tierId: number): PolicySecret {
  const t = requireTier(tierId);
  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const salt = stark.randomAddress();
  const commitment = hash.computePoseidonHashOnElements([publicKey, salt, num.toHex(t.id)]);
  const secret: PolicySecret = {
    commitment,
    privateKey,
    publicKey,
    salt,
    tier: t.id as TierId,
    createdAt: Date.now(),
  };
  saveSecret(secret);
  return secret;
}

/** Recompute a commitment from its parts — used to prove a secret matches a policy. */
export function commitmentFor(publicKey: string, salt: string, tier: number): string {
  return hash.computePoseidonHashOnElements([publicKey, salt, num.toHex(tier)]);
}

export function secretFor(commitment: string): PolicySecret | undefined {
  return findSecret(commitment);
}

export function signClaimSubmission(secret: PolicySecret, claimCommitment: string, incidentHash: string) {
  const messageHash = hash.computePoseidonHashOnElements([
    CLAIM_DOMAIN,
    secret.commitment,
    claimCommitment,
    incidentHash,
  ]);
  // lowS keeps every signature canonical; the contract rejects high-s variants.
  const sig = ec.starkCurve.sign(messageHash, secret.privateKey, { lowS: true });
  return { messageHash, r: num.toHex(sig.r), s: num.toHex(sig.s) };
}

export function signRedemption(secret: PolicySecret, claimCommitment: string, payoutWei: bigint) {
  const messageHash = hash.computePoseidonHashOnElements([
    REDEEM_DOMAIN,
    secret.commitment,
    claimCommitment,
    num.toHex(payoutWei),
  ]);
  const sig = ec.starkCurve.sign(messageHash, secret.privateKey, { lowS: true });
  return { messageHash, r: num.toHex(sig.r), s: num.toHex(sig.s) };
}

export type IncidentCommitment = {
  incidentHash: string;
  incidentSalt: string;
  claimCommitment: string;
};

/**
 * Commit to an incident without publishing it.
 *
 * The salt is what stops an observer dictionary-guessing a short, common incident
 * description from its public hash. The claim commitment binds the incident to this
 * specific policy, which the contract re-derives and enforces.
 */
export function makeIncidentCommitment(policyCommitment: string, incidentText: string): IncidentCommitment {
  const normalized = incidentText.trim().toLowerCase();
  if (normalized.length < MIN_INCIDENT_CHARS) throw new CovertError("INCIDENT_TOO_SHORT");
  const incidentSalt = stark.randomAddress();
  const textHash = num.toHex(hash.starknetKeccak(normalized));
  const incidentHash = hash.computePoseidonHashOnElements([textHash, incidentSalt]);
  const claimCommitment = hash.computePoseidonHashOnElements([policyCommitment, incidentHash]);
  return { incidentHash, incidentSalt, claimCommitment };
}

export type RevealCheck = {
  incidentMatches: boolean;
  claimMatches: boolean;
  recomputedIncidentHash: string;
  recomputedClaimCommitment: string;
};

/**
 * Verifier-side recomputation.
 *
 * The adjudicator does not take the claimant's word for anything: they re-derive
 * poseidon over the revealed text and salt and compare against what the claimant
 * committed to. A mismatch means the packet was altered after filing, and the UI
 * refuses to let it be approved.
 */
export function verifyIncidentReveal(
  input: Pick<RevealPacket, "policyCommitment" | "claimCommitment" | "incidentHash" | "incidentSalt" | "incidentText">,
): RevealCheck {
  const normalized = input.incidentText.trim().toLowerCase();
  if (normalized.length < MIN_INCIDENT_CHARS) {
    return {
      incidentMatches: false,
      claimMatches: false,
      recomputedIncidentHash: "0x0",
      recomputedClaimCommitment: "0x0",
    };
  }
  const textHash = num.toHex(hash.starknetKeccak(normalized));
  const recomputedIncidentHash = hash.computePoseidonHashOnElements([textHash, input.incidentSalt]);
  const recomputedClaimCommitment = hash.computePoseidonHashOnElements([
    input.policyCommitment,
    recomputedIncidentHash,
  ]);
  const same = (a: string, b: string) => {
    try {
      return BigInt(a) === BigInt(b);
    } catch {
      return false;
    }
  };
  return {
    incidentMatches: same(recomputedIncidentHash, input.incidentHash),
    claimMatches: same(recomputedClaimCommitment, input.claimCommitment),
    recomputedIncidentHash,
    recomputedClaimCommitment,
  };
}
