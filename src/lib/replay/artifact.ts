/**
 * Captured lifecycle artifacts.
 *
 * These are recordings of real executions produced by `scripts/devnet/run-lifecycle.mjs`.
 * They are NOT live state and never appear on a live surface: only `/replay` reads
 * them, and every value it renders is labelled with the artifact's own `kind`.
 *
 * The distinction that matters:
 *   DEVNET_EXECUTION — real transactions, real reverts, real balances, local node.
 *   MAINNET_EXECUTION — the same, on Starknet Mainnet.
 * Neither is ever described as the other, and nothing here is hand-written.
 */

import devnet from "../../../evidence/devnet-lifecycle.json";

export type LifecycleStep = {
  id: string;
  title: string;
  expectRevert: string | null;
  status: "succeeded" | "reverted" | "rejected" | "error";
  txHash?: string;
  blockNumber?: number | null;
  actualFee?: string | null;
  revertReason?: string;
  matchedExpectation?: boolean;
  durationMs?: number;
  events?: { from: string; keys: string[]; data: string[] }[];
};

export type StrkTransfer = { from: string; to: string; amountWei: string };

export type LifecycleArtifact = {
  schema: string;
  kind: "DEVNET_EXECUTION" | "MAINNET_EXECUTION";
  disclaimer: string;
  capturedAt: string;
  network: { rpc: string; chainId: string; specVersion: string; name: string };
  contracts: {
    policy: string;
    anonymizer: string;
    poolStub?: string;
    pool?: string;
    strk: string;
    classHashes?: Record<string, string>;
  };
  roles: { owner: string; adjudicator: string; holder: string };
  policy: {
    commitment: string;
    publicKey: string;
    tier: number;
    premiumWei: string;
    payoutWei: string;
    termSeconds: number;
    expiry: number;
  };
  claim: {
    commitment: string;
    incidentHash: string;
    incidentText: string;
    incidentSalt: string;
  };
  balances: Record<string, string>;
  reserve: Record<string, string>;
  settlementRoute?: {
    strkTransfers: StrkTransfer[];
    transfersToPublicWallet: StrkTransfer[];
    transfersFromPublicWallet: StrkTransfer[];
  };
  steps: LifecycleStep[];
  checks: { label: string; ok: boolean }[];
  verdict: "PASS" | "FAIL";
};

/** The captured run shipped with this build. */
export const DEVNET_LIFECYCLE = devnet as unknown as LifecycleArtifact;

/** True when the artifact is a complete, passing run. */
export function isUsable(artifact: LifecycleArtifact | null | undefined): boolean {
  return Boolean(artifact && artifact.steps?.length && artifact.verdict === "PASS");
}

/** Human label for where an artifact was executed. Never says "mainnet" for devnet. */
export function networkLabel(artifact: LifecycleArtifact): string {
  return artifact.kind === "MAINNET_EXECUTION" ? "STARKNET MAINNET" : "LOCAL STARKNET DEVNET";
}

/** Steps that were required to fail, and did. */
export function adversarialSteps(artifact: LifecycleArtifact): LifecycleStep[] {
  return artifact.steps.filter((s) => s.expectRevert !== null);
}

/** Steps that were required to succeed. */
export function positiveSteps(artifact: LifecycleArtifact): LifecycleStep[] {
  return artifact.steps.filter((s) => s.expectRevert === null);
}

export function stepById(artifact: LifecycleArtifact, id: string): LifecycleStep | undefined {
  return artifact.steps.find((s) => s.id === id);
}

/**
 * Plain-language explanation for each step, so a reader who has never seen the
 * contracts can follow what the lifecycle proved.
 */
export const STEP_NARRATION: Record<string, string> = {
  "SETUP-01": "The policy contract is pointed at its anonymizer. This can only ever happen once.",
  "SETUP-02": "The operator funds the reserve that backs every payout.",
  "NEG-01": "Re-pointing the anonymizer is refused — the privacy route cannot be redirected later.",
  "TX-00": "The holder shields STRK into the pool. This deposit is public, and COVERT says so.",
  "TX-01":
    "Cover is activated privately: the pool funds the anonymizer with the exact premium, the anonymizer calls the policy. The policy never sees the holder's address.",
  "NEG-02": "Re-using the same policy commitment is refused, so a policy cannot be duplicated.",
  "TX-02":
    "The claim is filed as a zero-value private invoke, authenticated by the policy's bearer key rather than by the wallet.",
  "NEG-03":
    "A forged bearer signature cannot consume the policy's claim slot, so a public commitment cannot be griefed.",
  "NEG-04":
    "Settlement is attempted before the adjudicator has decided. The contract refuses it. This is the invariant the whole product rests on.",
  "TX-DEC": "The adjudicator — a role separate from the owner — approves the claim.",
  "NEG-05": "The owner attempts the same approval and is refused. Roles are genuinely separated.",
  "TX-03":
    "The identical settlement action is run again and now succeeds. The payout goes policy → anonymizer → pool, and lands in the private balance.",
  "NEG-06": "Settling a second time is refused, so an approved claim cannot be drained twice.",
};
