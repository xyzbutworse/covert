"use client";
import { constants as SNconstants, num } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import {
  ANONYMIZER_ADDRESS,
  OP_BUY,
  OP_CLAIM,
  OP_REDEEM,
  POLICY_ADDRESS,
  STRK,
  STRK20_MAINNET_POOL,
  providers,
  strkToWei,
  TIERS,
} from "@/lib/config";
import { useWallet } from "@/lib/wallet/store";
import type { LocalPolicyKey } from "./types";
import { signClaimSubmission, signRedemption } from "./key";

function requireConfigured() {
  if (BigInt(POLICY_ADDRESS) === 0n || BigInt(ANONYMIZER_ADDRESS) === 0n) {
    throw new Error("COVERT contracts are not configured. Deploy them and set the two NEXT_PUBLIC_COVERT_* addresses.");
  }
}

function requireMainnet() {
  const { chain } = useWallet.getState();
  if (chain !== SNconstants.StarknetChainId.SN_MAIN) {
    throw new Error("COVERT's competition build is mainnet-only. Switch the connected wallet to Starknet Mainnet.");
  }
}

// The STRK20 wallet API rejects actions with typed codes (USER_REFUSED_OP,
// INSUFFICIENT_PRIVATE_BALANCE, NOT_REGISTERED, ...). Map them to human
// guidance so a wallet rejection is never mistaken for an onchain failure.
function friendlyStrk20Error(e: unknown): Error {
  const raw = e as { code?: unknown; message?: string } | undefined;
  const code = String(raw?.code ?? "").toUpperCase();
  const message = raw?.message ?? String(e);
  const m = message.toUpperCase();
  if (code.includes("INSUFFICIENT_PRIVATE_BALANCE") || m.includes("INSUFFICIENT_PRIVATE_BALANCE")) {
    return new Error("Not enough shielded STRK for this action. Shield more, wait for note maturity, then retry.");
  }
  if (code.includes("USER_REFUSED_OP") || m.includes("USER_REFUSED_OP") || m.includes("USER REFUSED")) {
    return new Error("The wallet rejected the transaction. Nothing was submitted.");
  }
  if (code.includes("NOT_REGISTERED") || m.includes("NOT_REGISTERED")) {
    return new Error("This wallet is not registered in the STRK20 privacy pool. Make a shield deposit first.");
  }
  if (code.includes("API_VERSION_NOT_SUPPORTED") || m.includes("API_VERSION_NOT_SUPPORTED")) {
    return new Error("This wallet's STRK20 Wallet API version is too old for COVERT (>= 0.10.3).");
  }
  if (code.includes("PRIVACY_LEAK") || m.includes("PRIVACY_LEAK")) {
    return new Error("COVERT refused an action that would have leaked private state. Review and retry.");
  }
  if (code.includes("INSUFFICIENT_ACCOUNT_BALANCE") || code.includes("INSUFFICIENT_GAS") || m.includes("INSUFFICIENT_ACCOUNT_BALANCE") || m.includes("INSUFFICIENT GAS")) {
    return new Error("The wallet account lacks STRK for gas/fees. Top up the public balance, then retry.");
  }
  return new Error(message);
}

async function boundedWait(tx: string) {
  const { providerIndex } = useWallet.getState();
  const wait = providers[providerIndex].waitForTransaction(tx, { retries: 60, retryInterval: 3000 });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(
    "Transaction was submitted but did not appear at the RPC within 3 minutes. Keep the hash and check Voyager before retrying.",
  )), 180_000));
  await Promise.race([wait, timeout]);
}

async function submit(actions: WALLET_API.STRK20_ACTION[]) {
  const { walletAccount } = useWallet.getState();
  if (!walletAccount) throw new Error("Connect a privacy-capable Starknet wallet first.");
  requireMainnet();
  try {
    const result = await walletAccount.strk20InvokeTransaction(actions);
    const tx = result.transaction_hash;
    await boundedWait(tx);
    return tx;
  } catch (e) { throw friendlyStrk20Error(e); }
}

export async function shield(amountStrk: number) {
  const actions: WALLET_API.STRK20_ACTION[] = [
    { type: "deposit", token: STRK, amount: num.toHex(strkToWei(amountStrk)) },
  ];
  return submit(actions);
}

export async function privateBalances() {
  const { walletAccount } = useWallet.getState();
  if (!walletAccount) throw new Error("Connect a wallet first.");
  requireMainnet();
  return walletAccount.strk20Balances([]);
}

export function extractStrkBalanceWei(input: unknown): bigint | null {
  const target = BigInt(STRK);
  const walk = (value: unknown): bigint | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return null;
    if (Array.isArray(value)) {
      for (const item of value) { const found = walk(item); if (found !== null) return found; }
      return null;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const token = obj.token ?? obj.token_address ?? obj.tokenAddress;
      const amount = obj.balance ?? obj.amount ?? obj.value;
      try {
        if (token !== undefined && BigInt(String(token)) === target && amount !== undefined) return BigInt(String(amount));
      } catch { /* fall through */ }
      for (const [k, v] of Object.entries(obj)) {
        try { if (BigInt(k) === target && (typeof v === "string" || typeof v === "number" || typeof v === "bigint")) return BigInt(v); } catch { /* ignore */ }
        const found = walk(v); if (found !== null) return found;
      }
    }
    return null;
  };
  return walk(input);
}

export async function privateStrkBalanceWei() {
  return extractStrkBalanceWei(await privateBalances());
}

export async function currentBlockNumber() {
  requireMainnet();
  return providers[0].getBlockNumber();
}

export async function poolFeeWei(): Promise<bigint | null> {
  try {
    const result = await providers[0].callContract({
      contractAddress: STRK20_MAINNET_POOL,
      entrypoint: "get_fee_amount",
      calldata: [],
    });
    return result[0] ? BigInt(result[0]) : null;
  } catch {
    // Fee view names have changed during STRK20 development. Never invent a value.
    return null;
  }
}

export async function buyPolicy(key: LocalPolicyKey) {
  requireConfigured();
  const tier = TIERS.find((x) => x.id === key.tier);
  if (!tier) throw new Error("Unknown coverage tier.");
  const premium = strkToWei(tier.premium);
  const actions: WALLET_API.STRK20_ACTION[] = [
    { type: "withdraw", token: STRK, amount: num.toHex(premium), recipient: ANONYMIZER_ADDRESS },
    {
      type: "invoke",
      contract: ANONYMIZER_ADDRESS,
      calldata: [
        OP_BUY,
        STRK,
        "${poolAddress}",
        POLICY_ADDRESS,
        key.commitment,
        key.publicKey,
        num.toHex(key.tier),
        "0x0",
        "0x0",
        "0x0",
      ],
    },
  ];
  return submit(actions);
}

export async function submitClaim(
  key: LocalPolicyKey,
  claimCommitment: string,
  incidentHash: string,
) {
  requireConfigured();
  const sig = signClaimSubmission(key, claimCommitment, incidentHash);
  const actions: WALLET_API.STRK20_ACTION[] = [
    {
      type: "invoke",
      contract: ANONYMIZER_ADDRESS,
      calldata: [
        OP_CLAIM,
        STRK,
        "${poolAddress}",
        POLICY_ADDRESS,
        key.commitment,
        claimCommitment,
        incidentHash,
        sig.r,
        sig.s,
        "0x0",
      ],
    },
  ];
  return submit(actions);
}

export async function redeemClaim(key: LocalPolicyKey, claimCommitment: string) {
  requireConfigured();
  const tier = TIERS.find((x) => x.id === key.tier);
  if (!tier) throw new Error("Unknown coverage tier.");
  const payout = strkToWei(tier.payout);
  const sig = signRedemption(key, claimCommitment, payout);
  const { address } = useWallet.getState();
  if (!address) throw new Error("Connect a wallet first.");
  const actions: WALLET_API.STRK20_ACTION[] = [
    { type: "transfer", token: STRK, amount: "OPEN", recipient: address },
    {
      type: "invoke",
      contract: ANONYMIZER_ADDRESS,
      calldata: [
        OP_REDEEM,
        STRK,
        "${poolAddress}",
        POLICY_ADDRESS,
        key.commitment,
        claimCommitment,
        sig.r,
        sig.s,
        "0x0",
        "${openNoteIds[0]}",
      ],
    },
  ];
  return submit(actions);
}

export async function readAdjudicator() {
  requireConfigured();
  const result = await providers[0].callContract({
    contractAddress: POLICY_ADDRESS,
    entrypoint: "adjudicator",
    calldata: [],
  });
  return result[0] ?? "0x0";
}

export async function readReserveState() {
  requireConfigured();
  const [reserveResult, exposureResult, invokeResult] = await Promise.all([
    providers[0].callContract({ contractAddress: POLICY_ADDRESS, entrypoint: "reserve", calldata: [] }),
    providers[0].callContract({ contractAddress: POLICY_ADDRESS, entrypoint: "exposure", calldata: [] }),
    providers[0].callContract({ contractAddress: ANONYMIZER_ADDRESS, entrypoint: "invoke_count", calldata: [] }),
  ]);
  return {
    reserve: BigInt(reserveResult[0] ?? "0x0"),
    exposure: BigInt(exposureResult[0] ?? "0x0"),
    invokes: BigInt(invokeResult[0] ?? "0x0"),
  };
}

export async function readClaimState(claimCommitment: string) {
  requireConfigured();
  const result = await providers[0].callContract({
    contractAddress: POLICY_ADDRESS,
    entrypoint: "claim_state",
    calldata: [claimCommitment],
  });
  return {
    exists: BigInt(result[0] ?? "0x0") !== 0n,
    policyCommitment: result[1] ?? "0x0",
    incidentHash: result[2] ?? "0x0",
    decision: Number(BigInt(result[3] ?? "0x0")),
    redeemed: BigInt(result[4] ?? "0x0") !== 0n,
  };
}

export async function readPolicyState(policyCommitment: string) {
  requireConfigured();
  const result = await providers[0].callContract({
    contractAddress: POLICY_ADDRESS,
    entrypoint: "policy_state",
    calldata: [policyCommitment],
  });
  return {
    exists: BigInt(result[0] ?? "0x0") !== 0n,
    tier: Number(BigInt(result[1] ?? "0x0")),
    ownerKey: result[2] ?? "0x0",
    expiry: Number(BigInt(result[3] ?? "0x0")),
    active: BigInt(result[4] ?? "0x0") !== 0n,
    claimed: BigInt(result[5] ?? "0x0") !== 0n,
    hasClaim: BigInt(result[6] ?? "0x0") !== 0n,
  };
}

async function publicPolicyAction(entrypoint: "approve_claim" | "deny_claim", claimCommitment: string) {
  requireConfigured();
  requireMainnet();
  const { walletAccount } = useWallet.getState();
  if (!walletAccount) throw new Error("Connect the adjudicator wallet first.");
  try {
    const result = await walletAccount.execute({
      contractAddress: POLICY_ADDRESS,
      entrypoint,
      calldata: [claimCommitment],
    });
    const tx = result.transaction_hash as string;
    await boundedWait(tx);
    return tx;
  } catch (e) { throw friendlyStrk20Error(e); }
}

export async function approveClaim(claimCommitment: string) {
  return publicPolicyAction("approve_claim", claimCommitment);
}

export async function denyClaim(claimCommitment: string) {
  return publicPolicyAction("deny_claim", claimCommitment);
}
