/**
 * Chain reads with endpoint failover.
 *
 * Every read tries each configured RPC in order and only reports RPC_UNAVAILABLE
 * once all of them have failed. Screens therefore degrade to "cannot reach a node,
 * here is your local state and a retry button" instead of hanging on a spinner.
 *
 * This module is also the independent-verification surface: `fetchCovertEvents`
 * reconstructs a lifecycle from Starknet events alone, without consulting anything
 * the frontend has stored.
 */

import { RpcProvider, selector } from "starknet";
import { ANONYMIZER_ADDRESS, POLICY_ADDRESS, STRK, STRK20_MAINNET_POOL, isDeployed, providers } from "@/lib/config";
import { CovertError, fail, normalizeError } from "@/lib/domain/errors";

export type ChainCallResult = string[];

let lastGoodProvider = 0;

/** The provider index that most recently answered. Surfaced for diagnostics. */
export function activeProviderIndex(): number {
  return lastGoodProvider;
}

export function providerCount(): number {
  return providers.length;
}

async function withFailover<T>(fn: (p: RpcProvider) => Promise<T>): Promise<T> {
  if (!providers.length) fail("RPC_UNAVAILABLE", "No RPC endpoints are configured.");
  const order = [lastGoodProvider, ...providers.map((_, i) => i).filter((i) => i !== lastGoodProvider)];
  let last: unknown;
  for (const index of order) {
    try {
      const value = await fn(providers[index]);
      lastGoodProvider = index;
      return value;
    } catch (e) {
      last = e;
      // A contract-level revert is an answer, not an endpoint failure: stop retrying.
      const norm = normalizeError(e);
      if (norm.class !== "network" || norm.code === "TX_REVERTED") throw e;
    }
  }
  throw new CovertError("RPC_UNAVAILABLE", last instanceof Error ? last.message : String(last));
}

async function call(contractAddress: string, entrypoint: string, calldata: string[] = []): Promise<ChainCallResult> {
  return withFailover((p) => p.callContract({ contractAddress, entrypoint, calldata }));
}

function toBig(v: string | undefined): bigint {
  try {
    return BigInt(v ?? "0x0");
  } catch {
    return 0n;
  }
}

function requireDeployment() {
  if (!isDeployed()) fail("NOT_DEPLOYED");
}

// ------------------------------------------------------------- core reads ----

export type ChainPolicyState = {
  exists: boolean;
  tier: number;
  ownerKey: string;
  expiry: number;
  active: boolean;
  claimed: boolean;
  hasClaim: boolean;
};

export async function readPolicyState(commitment: string): Promise<ChainPolicyState> {
  requireDeployment();
  const r = await call(POLICY_ADDRESS, "policy_state", [commitment]);
  return {
    exists: toBig(r[0]) !== 0n,
    tier: Number(toBig(r[1])),
    ownerKey: r[2] ?? "0x0",
    expiry: Number(toBig(r[3])),
    active: toBig(r[4]) !== 0n,
    claimed: toBig(r[5]) !== 0n,
    hasClaim: toBig(r[6]) !== 0n,
  };
}

export type ChainClaimState = {
  exists: boolean;
  policyCommitment: string;
  incidentHash: string;
  decision: number;
  redeemed: boolean;
};

export async function readClaimState(claimCommitment: string): Promise<ChainClaimState> {
  requireDeployment();
  const r = await call(POLICY_ADDRESS, "claim_state", [claimCommitment]);
  return {
    exists: toBig(r[0]) !== 0n,
    policyCommitment: r[1] ?? "0x0",
    incidentHash: r[2] ?? "0x0",
    decision: Number(toBig(r[3])),
    redeemed: toBig(r[4]) !== 0n,
  };
}

export type ChainReserveState = {
  reserveWei: bigint;
  exposureWei: bigint;
  invokes: bigint;
};

export async function readReserveState(): Promise<ChainReserveState> {
  requireDeployment();
  const [reserve, exposure, invokes] = await Promise.all([
    call(POLICY_ADDRESS, "reserve"),
    call(POLICY_ADDRESS, "exposure"),
    call(ANONYMIZER_ADDRESS, "invoke_count"),
  ]);
  return {
    reserveWei: toBig(reserve[0]),
    exposureWei: toBig(exposure[0]),
    invokes: toBig(invokes[0]),
  };
}

export type ChainRoles = {
  owner: string;
  adjudicator: string;
  anonymizer: string;
  token: string;
};

export async function readRoles(): Promise<ChainRoles> {
  requireDeployment();
  const [owner, adjudicator, anonymizer, token] = await Promise.all([
    call(POLICY_ADDRESS, "owner"),
    call(POLICY_ADDRESS, "adjudicator"),
    call(POLICY_ADDRESS, "anonymizer"),
    call(POLICY_ADDRESS, "token"),
  ]);
  return {
    owner: owner[0] ?? "0x0",
    adjudicator: adjudicator[0] ?? "0x0",
    anonymizer: anonymizer[0] ?? "0x0",
    token: token[0] ?? "0x0",
  };
}

/** Contract-quoted economics. Used to prove the client's tier table is not authoritative. */
export async function readTierQuote(tierId: number): Promise<{ premiumWei: bigint; payoutWei: bigint; termSeconds: number }> {
  requireDeployment();
  const r = await call(POLICY_ADDRESS, "quote_tier", [`0x${tierId.toString(16)}`]);
  return { premiumWei: toBig(r[0]), payoutWei: toBig(r[1]), termSeconds: Number(toBig(r[2])) };
}

/** Public STRK balance of an address — the number that must NOT move on settlement. */
export async function readPublicStrkBalance(address: string): Promise<bigint> {
  const r = await call(STRK, "balance_of", [address]);
  // u256 { low, high }
  return toBig(r[0]) + (toBig(r[1]) << 128n);
}

export async function readPoolFee(): Promise<bigint | null> {
  try {
    const r = await call(STRK20_MAINNET_POOL, "get_fee_amount");
    return r[0] ? toBig(r[0]) : null;
  } catch {
    // Never guess a fee. The UI says so explicitly when this returns null.
    return null;
  }
}

export async function getBlockNumber(): Promise<number> {
  return withFailover((p) => p.getBlockNumber());
}

export async function getBlockTimestamp(): Promise<number> {
  const block = await withFailover((p) => p.getBlock("latest"));
  const ts = (block as { timestamp?: number }).timestamp;
  return typeof ts === "number" ? ts : Math.floor(Date.now() / 1000);
}

/** True when at least one endpoint answers. Drives the offline banner. */
export async function pingChain(): Promise<boolean> {
  try {
    await getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- receipts ----

export type TxOutcome = {
  hash: string;
  status: "succeeded" | "reverted" | "pending" | "unknown";
  revertReason?: string;
  blockNumber?: number;
};

/**
 * Read a transaction's real outcome.
 *
 * A submitted hash is not evidence of success: a Starknet transaction can be
 * included and still revert. COVERT records the revert reason as evidence rather
 * than treating "we got a hash" as a settled claim.
 */
export async function readTxOutcome(hash: string): Promise<TxOutcome> {
  try {
    const receipt = (await withFailover((p) => p.getTransactionReceipt(hash))) as unknown as Record<string, unknown>;
    const value = (receipt.value ?? receipt) as Record<string, unknown>;
    const execution = String(value.execution_status ?? value.executionStatus ?? "");
    const revert = value.revert_reason ?? value.revertReason;
    const blockNumber = typeof value.block_number === "number" ? value.block_number : undefined;

    if (execution === "REVERTED") {
      return { hash, status: "reverted", revertReason: revert ? String(revert) : undefined, blockNumber };
    }
    if (execution === "SUCCEEDED") return { hash, status: "succeeded", blockNumber };
    return { hash, status: "pending", blockNumber };
  } catch (e) {
    const norm = normalizeError(e);
    if (norm.class === "network") throw new CovertError("RPC_UNAVAILABLE", norm.raw);
    return { hash, status: "unknown" };
  }
}

/**
 * Wait for a transaction with a hard ceiling.
 *
 * Never waits forever. On timeout the caller keeps the hash and the UI tells the
 * user to reconcile rather than resubmitting, because a resubmission after a
 * silently-successful transaction is how a policy gets paid for twice.
 */
export async function waitForTx(hash: string, timeoutMs = 180_000): Promise<TxOutcome> {
  const deadline = Date.now() + timeoutMs;
  let delay = 2_000;
  while (Date.now() < deadline) {
    const outcome = await readTxOutcome(hash).catch(() => ({ hash, status: "unknown" as const }));
    if (outcome.status === "succeeded" || outcome.status === "reverted") return outcome;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 8_000);
  }
  throw new CovertError("CONFIRMATION_TIMEOUT", hash);
}

// --------------------------------------------------------------- events ----

export const COVERT_EVENT_NAMES = [
  "AnonymizerConfigured",
  "ReserveFunded",
  "PolicyPurchased",
  "PolicyExpired",
  "ClaimSubmitted",
  "ClaimApproved",
  "ClaimDenied",
  "ClaimSettled",
] as const;

export type CovertEventName = (typeof COVERT_EVENT_NAMES)[number];

const SELECTORS: Record<string, CovertEventName> = Object.fromEntries(
  COVERT_EVENT_NAMES.map((name) => [BigInt(selector.getSelectorFromName(name)).toString(), name]),
) as Record<string, CovertEventName>;

export type CovertChainEvent = {
  name: CovertEventName;
  txHash: string;
  blockNumber: number;
  keys: string[];
  data: string[];
};

/**
 * Pull COVERT's events straight from Starknet.
 *
 * This is the independent path: given only the policy contract address, it
 * reconstructs who was purchased, claimed, decided and settled without reading a
 * single byte of frontend state. `scripts/verify-lifecycle.mjs` runs the same query
 * from Node so a reviewer never has to trust the browser.
 */
export async function fetchCovertEvents(options?: {
  fromBlock?: number;
  toBlock?: number | "latest";
  chunkSize?: number;
  maxChunks?: number;
}): Promise<CovertChainEvent[]> {
  requireDeployment();
  const chunkSize = options?.chunkSize ?? 100;
  const maxChunks = options?.maxChunks ?? 40;
  const out: CovertChainEvent[] = [];
  let continuationToken: string | undefined;

  for (let i = 0; i < maxChunks; i++) {
    const chunk = (await withFailover((p) =>
      p.getEvents({
        address: POLICY_ADDRESS,
        from_block: options?.fromBlock !== undefined ? { block_number: options.fromBlock } : { block_number: 0 },
        to_block: options?.toBlock === undefined || options.toBlock === "latest" ? "latest" : { block_number: options.toBlock },
        chunk_size: chunkSize,
        continuation_token: continuationToken,
      } as never),
    )) as unknown as { events?: unknown[]; continuation_token?: string };

    for (const raw of chunk.events ?? []) {
      const ev = raw as { keys?: string[]; data?: string[]; transaction_hash?: string; block_number?: number };
      const key0 = ev.keys?.[0];
      if (!key0) continue;
      let name: CovertEventName | undefined;
      try {
        name = SELECTORS[BigInt(key0).toString()];
      } catch {
        name = undefined;
      }
      if (!name) continue;
      out.push({
        name,
        txHash: ev.transaction_hash ?? "",
        blockNumber: ev.block_number ?? 0,
        keys: ev.keys ?? [],
        data: ev.data ?? [],
      });
    }

    continuationToken = chunk.continuation_token;
    if (!continuationToken) break;
  }

  return out.sort((a, b) => a.blockNumber - b.blockNumber);
}

/**
 * Decode COVERT events into the fields the History and Proof screens need.
 * Keyed fields land in `keys[1..]`; the rest arrive in `data`.
 */
export function decodeCovertEvent(ev: CovertChainEvent): Record<string, string> {
  const k = ev.keys;
  const d = ev.data;
  switch (ev.name) {
    case "PolicyPurchased":
      return { commitment: k[1] ?? "0x0", tier: d[0] ?? "0x0", expiry: d[1] ?? "0x0", payout: d[2] ?? "0x0" };
    case "PolicyExpired":
      return { commitment: k[1] ?? "0x0", releasedExposure: d[0] ?? "0x0" };
    case "ClaimSubmitted":
      return {
        claimCommitment: k[1] ?? "0x0",
        policyCommitment: k[2] ?? "0x0",
        incidentHash: d[0] ?? "0x0",
      };
    case "ClaimApproved":
      return { claimCommitment: k[1] ?? "0x0", policyCommitment: k[2] ?? "0x0" };
    case "ClaimDenied":
      return {
        claimCommitment: k[1] ?? "0x0",
        policyCommitment: k[2] ?? "0x0",
        releasedExposure: d[0] ?? "0x0",
      };
    case "ClaimSettled":
      return {
        claimCommitment: k[1] ?? "0x0",
        policyCommitment: k[2] ?? "0x0",
        payout: d[0] ?? "0x0",
      };
    case "ReserveFunded":
      return { amount: d[0] ?? "0x0", reserve: d[1] ?? "0x0" };
    case "AnonymizerConfigured":
      return { anonymizer: d[0] ?? "0x0" };
    default:
      return {};
  }
}
