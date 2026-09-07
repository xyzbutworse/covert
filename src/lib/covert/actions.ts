"use client";
/**
 * Wallet-facing writes.
 *
 * Every function here composes a transaction and returns its *real outcome*, not
 * just a hash. A Starknet transaction can be included and still revert, so
 * "we got a hash back" is never treated as success anywhere in COVERT.
 *
 * STRK20 action shapes follow the Wallet API (`wallet_strk20InvokeTransaction`):
 *   deposit  { token, amount }                    — public shield
 *   withdraw { token, amount, recipient }         — funds the anonymizer
 *   invoke   { contract, calldata }               — drives privacy_invoke
 *   transfer { token, amount: "OPEN", recipient } — creates the note settlement fills
 *
 * `${poolAddress}` and `${openNoteIds[0]}` are literal protocol placeholders the
 * wallet substitutes. They must never be hex-normalised.
 */

import { constants as SNconstants, num } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import {
  ANONYMIZER_ADDRESS,
  OP_BUY,
  OP_CLAIM,
  OP_REDEEM,
  POLICY_ADDRESS,
  STRK,
  isDeployed,
  requireTier,
} from "@/lib/config";
import { CovertError, fail, normalizeError } from "@/lib/domain/errors";
import { readTxOutcome, waitForTx, type TxOutcome } from "@/lib/chain/read";
import { useWallet } from "@/lib/wallet/store";
import type { PolicySecret } from "@/lib/domain/types";
import { signClaimSubmission, signRedemption } from "./key";

export type SubmitResult = {
  txHash: string;
  outcome: TxOutcome;
};

function requireConfigured() {
  if (!isDeployed()) fail("NOT_DEPLOYED");
}

function requireMainnet() {
  const { chain, connected } = useWallet.getState();
  if (!connected) fail("NOT_CONNECTED");
  if (chain !== SNconstants.StarknetChainId.SN_MAIN) fail("WRONG_NETWORK");
}

function walletAccount() {
  const { walletAccount: account } = useWallet.getState();
  if (!account) fail("NOT_CONNECTED");
  return account;
}

/**
 * Submit STRK20 actions and resolve the real result.
 *
 * A revert is returned rather than thrown, because a reverted settlement before
 * approval is *evidence COVERT wants to keep*, not an error to swallow. Callers
 * decide what a revert means for their step.
 */
async function submit(actions: WALLET_API.STRK20_ACTION[]): Promise<SubmitResult> {
  requireMainnet();
  const account = walletAccount();
  let txHash: string;
  try {
    // Build, prove, and simulate the exact action bundle before asking the
    // wallet to broadcast it. Calldata, balance, and helper failures stop here.
    await account.strk20PrepareInvoke(actions, true);
    const result = await account.strk20InvokeTransaction(actions);
    txHash = result.transaction_hash;
  } catch (e) {
    // Nothing was submitted: wallet refusal, insufficient private balance, etc.
    const norm = normalizeError(e);
    throw new CovertError(norm.code, norm.raw);
  }
  const outcome = await waitForTx(txHash);
  return { txHash, outcome };
}

async function submitPublic(
  contractAddress: string,
  entrypoint: string,
  calldata: string[],
): Promise<SubmitResult> {
  requireMainnet();
  const account = walletAccount();
  let txHash: string;
  try {
    const result = await account.execute({ contractAddress, entrypoint, calldata });
    txHash = result.transaction_hash as string;
  } catch (e) {
    const norm = normalizeError(e);
    throw new CovertError(norm.code, norm.raw);
  }
  const outcome = await waitForTx(txHash);
  return { txHash, outcome };
}

// ------------------------------------------------------------- funding ----

/** Public shield deposit. COVERT never claims this step is private. */
export async function shield(amountWei: bigint): Promise<SubmitResult> {
  if (amountWei <= 0n) fail("BAD_AMOUNT", "Shield amount must be positive.");
  return submit([{ type: "deposit", token: STRK, amount: num.toHex(amountWei) }]);
}

export async function privateBalances() {
  requireMainnet();
  return walletAccount().strk20Balances([]);
}

/**
 * Pull the STRK private balance out of whatever shape the wallet returns.
 * Wallet responses have varied during STRK20 development, so this walks the
 * structure instead of assuming one layout. Returns null when absent — never 0,
 * because "unknown" and "empty" must not look the same in the UI.
 */
export function extractStrkBalanceWei(input: unknown): bigint | null {
  const target = BigInt(STRK);
  const walk = (value: unknown): bigint | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item);
        if (found !== null) return found;
      }
      return null;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const token = obj.token ?? obj.token_address ?? obj.tokenAddress;
      const amount = obj.balance ?? obj.amount ?? obj.value;
      try {
        if (token !== undefined && BigInt(String(token)) === target && amount !== undefined) {
          return BigInt(String(amount));
        }
      } catch {
        /* not a felt; keep walking */
      }
      for (const [k, v] of Object.entries(obj)) {
        try {
          if (BigInt(k) === target && (typeof v === "string" || typeof v === "number" || typeof v === "bigint")) {
            return BigInt(v);
          }
        } catch {
          /* key is not a felt */
        }
        const found = walk(v);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return walk(input);
}

export async function privateStrkBalanceWei(): Promise<bigint | null> {
  try {
    return extractStrkBalanceWei(await privateBalances());
  } catch {
    // A wallet that cannot answer must not block the flow; the UI shows "unknown".
    return null;
  }
}

// -------------------------------------------------------------- policy ----

/** Private policy purchase: withdraw the exact premium to the anonymizer, then invoke. */
export async function buyPolicy(secret: PolicySecret): Promise<SubmitResult> {
  requireConfigured();
  const t = requireTier(secret.tier);
  return submit([
    { type: "withdraw", token: STRK, amount: num.toHex(t.premiumWei), recipient: ANONYMIZER_ADDRESS },
    {
      type: "invoke",
      contract: ANONYMIZER_ADDRESS,
      calldata: [
        OP_BUY,
        STRK,
        "${poolAddress}",
        POLICY_ADDRESS,
        secret.commitment,
        secret.publicKey,
        num.toHex(secret.tier),
        "0x0",
        "0x0",
        "0x0",
      ],
    },
  ]);
}

/**
 * Authenticated claim submission.
 *
 * A pure zero-value `invoke`: the pool's balance rule ends each token's temporary
 * balance at zero, which a zero-value action satisfies trivially. That is why
 * COVERT needs no claim bond and never routes around STRK20 with a public call.
 */
export async function submitClaim(
  secret: PolicySecret,
  claimCommitment: string,
  incidentHash: string,
): Promise<SubmitResult> {
  requireConfigured();
  const sig = signClaimSubmission(secret, claimCommitment, incidentHash);
  return submit([
    {
      type: "invoke",
      contract: ANONYMIZER_ADDRESS,
      calldata: [
        OP_CLAIM,
        STRK,
        "${poolAddress}",
        POLICY_ADDRESS,
        secret.commitment,
        claimCommitment,
        incidentHash,
        sig.r,
        sig.s,
        "0x0",
      ],
    },
  ]);
}

/**
 * Private settlement.
 *
 * `transfer amount: "OPEN"` asks the pool to create an empty note; the anonymizer
 * returns an `OpenNoteDeposit` that fills it. The payout therefore lands in the
 * private balance, and the public address appears nowhere in the payout path.
 */
export async function redeemClaim(secret: PolicySecret, claimCommitment: string): Promise<SubmitResult> {
  requireConfigured();
  requireTier(secret.tier);
  const t = requireTier(secret.tier);
  const sig = signRedemption(secret, claimCommitment, t.payoutWei);
  const { address } = useWallet.getState();
  if (!address) fail("NOT_CONNECTED");
  return submit([
    { type: "transfer", token: STRK, amount: "OPEN", recipient: address },
    {
      type: "invoke",
      contract: ANONYMIZER_ADDRESS,
      calldata: [
        OP_REDEEM,
        STRK,
        "${poolAddress}",
        POLICY_ADDRESS,
        secret.commitment,
        claimCommitment,
        sig.r,
        sig.s,
        "0x0",
        "${openNoteIds[0]}",
      ],
    },
  ]);
}

// ---------------------------------------------------------- adjudication ----

export async function approveClaim(claimCommitment: string): Promise<SubmitResult> {
  requireConfigured();
  return submitPublic(POLICY_ADDRESS, "approve_claim", [claimCommitment]);
}

export async function denyClaim(claimCommitment: string): Promise<SubmitResult> {
  requireConfigured();
  return submitPublic(POLICY_ADDRESS, "deny_claim", [claimCommitment]);
}

// -------------------------------------------------------------- upkeep ----

/** Release exposure for a policy whose term has ended. Permissionless. */
export async function expirePolicy(policyCommitment: string): Promise<SubmitResult> {
  requireConfigured();
  return submitPublic(POLICY_ADDRESS, "expire_policy", [policyCommitment]);
}

/** Close a claim the adjudicator abandoned past its deadline. Permissionless. */
export async function expireStaleClaim(claimCommitment: string): Promise<SubmitResult> {
  requireConfigured();
  return submitPublic(POLICY_ADDRESS, "expire_stale_claim", [claimCommitment]);
}

/** Re-read an existing hash without resubmitting anything. */
export async function checkTx(hash: string): Promise<TxOutcome> {
  return readTxOutcome(hash);
}
