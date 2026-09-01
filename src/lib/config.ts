/**
 * Deployment configuration and RPC access.
 *
 * Addresses that are protocol facts (STRK, the STRK20 pool) are pinned here.
 * Addresses that depend on a deployment come from the environment and default to
 * 0x0, which every surface treats as NOT_DEPLOYED rather than pretending to be live.
 */

import { RpcProvider } from "starknet";

/** Official STRK token on Starknet Mainnet. */
export const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** Official STRK20 privacy pool on Starknet Mainnet. */
export const STRK20_MAINNET_POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

const providerKey = process.env.NEXT_PUBLIC_PROVIDER_URL ?? "";

/**
 * Ordered RPC endpoints. Reads try each in turn; a read only fails once every
 * endpoint has failed, which is what turns a flaky node into a retry rather than a
 * broken screen.
 */
export const RPC_URLS: string[] = [
  providerKey ? `https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/${providerKey}` : "",
  process.env.NEXT_PUBLIC_RPC_URL ?? "",
  "https://starknet-rpc.publicnode.com",
].filter(Boolean);

export const providers: RpcProvider[] = RPC_URLS.map((nodeUrl) => new RpcProvider({ nodeUrl }));

/** COVERT deployment. `0x0` means "not deployed"; nothing fabricates an address. */
export const POLICY_ADDRESS = process.env.NEXT_PUBLIC_COVERT_POLICY_ADDRESS ?? "0x0";
export const ANONYMIZER_ADDRESS = process.env.NEXT_PUBLIC_COVERT_ANONYMIZER_ADDRESS ?? "0x0";

/** Which network the configured deployment lives on. Mainnet unless told otherwise. */
export const DEPLOY_NETWORK = (process.env.NEXT_PUBLIC_COVERT_NETWORK ?? "mainnet").toLowerCase();
export const IS_MAINNET_TARGET = DEPLOY_NETWORK === "mainnet";

export const VOYAGER = process.env.NEXT_PUBLIC_VOYAGER_BASE ?? "https://voyager.online/tx";
export const VOYAGER_CONTRACT =
  process.env.NEXT_PUBLIC_VOYAGER_CONTRACT_BASE ?? "https://voyager.online/contract";

export function isDeployed(): boolean {
  try {
    return BigInt(POLICY_ADDRESS) !== 0n && BigInt(ANONYMIZER_ADDRESS) !== 0n;
  } catch {
    return false;
  }
}

/** Anonymizer operation codes, mirroring cairo/src/covert_anonymizer.cairo. */
export const OP_BUY = "0x1";
export const OP_CLAIM = "0x2";
export const OP_REDEEM = "0x3";

/** Blocks COVERT waits after a shield before offering to spend the new note. */
export const NOTE_MATURITY_BLOCKS = 10;

export { TIERS, WEI, formatStrk, formatStrkSigned, parseStrk, tier, requireTier } from "./domain/economics";
