import { ProviderInterface, RpcProvider } from "starknet";

export const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const STRK20_MAINNET_POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

const key = process.env.NEXT_PUBLIC_PROVIDER_URL ?? "";
// Mainnet RPC: prefer the configured Alchemy key, fall back to a public RPC so
// the app can read state even before a provider key is configured.
const mainnetRpc = key
  ? `https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/${key}`
  : "https://starknet-rpc.publicnode.com";
export const providers: ProviderInterface[] = [
  new RpcProvider({ nodeUrl: mainnetRpc }),
  new RpcProvider({ nodeUrl: "https://starknet-rpc.publicnode.com" }),
  new RpcProvider({ nodeUrl: `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/${key}` }),
];

export const NETWORKS: Record<number, string> = { 0: "MAINNET", 2: "SEPOLIA" };
export const POLICY_ADDRESS = process.env.NEXT_PUBLIC_COVERT_POLICY_ADDRESS ?? "0x0";
export const ANONYMIZER_ADDRESS = process.env.NEXT_PUBLIC_COVERT_ANONYMIZER_ADDRESS ?? "0x0";
export const VOYAGER = process.env.NEXT_PUBLIC_VOYAGER_BASE ?? "https://voyager.online/tx";

export const TIERS = [
  { id: 1, name: "SIGNAL", premium: 0.01, payout: 0.05, termDays: 7 },
  { id: 2, name: "SHIELD", premium: 0.02, payout: 0.10, termDays: 14 },
  { id: 3, name: "BLACKOUT", premium: 0.04, payout: 0.20, termDays: 30 },
] as const;

export const OP_BUY = "0x1";
export const OP_CLAIM = "0x2";
export const OP_REDEEM = "0x3";

export const WEI = 10n ** 18n;
export function strkToWei(v: number): bigint {
  return BigInt(Math.round(v * 1_000_000)) * WEI / 1_000_000n;
}
