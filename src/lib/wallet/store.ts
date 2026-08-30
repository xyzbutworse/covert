"use client";
import { create } from "zustand";
import type { WalletAccountV6 } from "starknet";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";

type WalletState = {
  wallet?: WalletWithStarknetFeatures;
  walletAccount?: WalletAccountV6;
  address: string;
  chain: string;
  connected: boolean;
  providerIndex: number;
  setWallet: (wallet: WalletWithStarknetFeatures) => void;
  setWalletAccount: (account: WalletAccountV6) => void;
  setAddress: (address: string) => void;
  setChain: (chain: string) => void;
  setConnected: (connected: boolean) => void;
  setProviderIndex: (index: number) => void;
  reset: () => void;
};

export const useWallet = create<WalletState>((set) => ({
  address: "",
  chain: "",
  connected: false,
  providerIndex: 0,
  setWallet: (wallet) => set({ wallet }),
  setWalletAccount: (walletAccount) => set({ walletAccount }),
  setAddress: (address) => set({ address }),
  setChain: (chain) => set({ chain }),
  setConnected: (connected) => set({ connected }),
  setProviderIndex: (providerIndex) => set({ providerIndex }),
  reset: () => set({ wallet: undefined, walletAccount: undefined, address: "", chain: "", connected: false, providerIndex: 0 }),
}));
