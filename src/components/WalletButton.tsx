"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { constants as SNconstants, validateAndParseAddress, walletV6, WalletAccountV6 } from "starknet";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import type { WALLET_API } from "@starknet-io/types-js";
import { providers } from "@/lib/config";
import { useWallet } from "@/lib/wallet/store";

function normalize(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }
const STRK20_WALLET_API_FLOOR = "0.10.3";
function versionAtLeast(version: string, floor: string) {
  const a = version.split(/[.-]/).map((x) => Number(x) || 0);
  const b = floor.split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return true;
}

function friendlyConnectError(e: unknown): string {
  const message = (e as { message?: string })?.message ?? String(e);
  if (/preauthor/i.test(message)) {
    return "This dapp is not authorized in your wallet yet. Open the Ready extension, approve/allow connections for this site (or add it to your authorized sites), then connect again.";
  }
  return message;
}

async function step<T>(label: string, p: Promise<T>): Promise<T> {
  try { return await p; }
  catch (e) {
    const msg = (e as { message?: string })?.message ?? String(e);
    throw new Error(`[${label}] ${msg}`);
  }
}

export default function WalletButton() {
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { connected, address, chain, reset } = useWallet();
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    setWallets(store.getWallets().slice());
    const unsubStore = store.subscribe((next) => setWallets(next.slice()));
    return () => {
      unsubStore();
      if (disposeRef.current) disposeRef.current();
    };
  }, []);

  const pickable = useMemo(() => wallets.filter((w) => {
    const id = normalize(w.name);
    return !id.includes("metamask") && !id.includes("braavos");
  }), [wallets]);

  async function connect(w: WalletWithStarknetFeatures) {
    setBusy(true); setError("");
    try {
      const detectedChain = await step("requestChainId", walletV6.requestChainId(w)) as string;
      if (detectedChain !== SNconstants.StarknetChainId.SN_MAIN) {
        throw new Error("Wrong network. Switch this wallet to Starknet Mainnet, then connect again.");
      }

      // Least-privilege capability detection: do not probe private balances just to detect STRK20.
      const supported = typeof walletV6.supportedWalletApi === "function"
        ? await step("supportedWalletApi", walletV6.supportedWalletApi(w))
        : [];
      if (!Array.isArray(supported) || !supported.some((v) => versionAtLeast(v, STRK20_WALLET_API_FLOOR))) {
        throw new Error(`This wallet does not expose the STRK20 Wallet API required by COVERT (>= ${STRK20_WALLET_API_FLOOR}).`);
      }

      const wa = await step("WalletAccountV6.connect", WalletAccountV6.connect(providers[0], w));
      const accounts = await step("requestAccounts", walletV6.requestAccounts(w));
      if (!Array.isArray(accounts) || !accounts[0]) throw new Error("Wallet did not return an account.");
      const addr = validateAndParseAddress(accounts[0]);
      const perms = await step("getPermissions", walletV6.getPermissions(w)) as WALLET_API.Permission[];
      const ok = perms.includes((await import("@starknet-io/types-js")).WALLET_API.Permission.ACCOUNTS);
      if (!ok) throw new Error("Account permission was not granted.");

      useWallet.setState({
        wallet: w,
        walletAccount: wa,
        address: addr,
        chain: detectedChain,
        connected: true,
        providerIndex: 0,
      });

      // Keep the store in sync when the wallet disconnects, switches account, or
      // switches network, so stale chain/address state can never gate an action.
      const unsub = wa.onChange((change) => {
        const next = (change.accounts ?? []).filter((a) => a && a.address);
        if (!next.length) { useWallet.getState().reset(); return; }
        useWallet.setState({
          address: validateAndParseAddress(next[0].address),
          chain: (change.chains ?? [])[0] ?? useWallet.getState().chain,
          connected: true,
        });
      });
      if (disposeRef.current) disposeRef.current();
      disposeRef.current = unsub;

      setOpen(false);
    } catch (e: any) { setError(friendlyConnectError(e)); }
    finally { setBusy(false); }
  }

  if (connected) return <button className="wallet connected" onClick={reset} title="Disconnect">
    <span className="dot" />
    <span>{address.slice(0,6)}…{address.slice(-4)}</span>
    <small>{chain === SNconstants.StarknetChainId.SN_MAIN ? "MAINNET" : "WRONG NETWORK"}</small>
  </button>;

  return <>
    <button className="wallet" onClick={() => setOpen(true)}>Connect wallet</button>
    {open && <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
      <div className="modal" onClick={(e)=>e.stopPropagation()}>
        <div className="modal-title"><span>Connect on Starknet Mainnet</span><button onClick={()=>setOpen(false)}>×</button></div>
        <p className="muted">COVERT hard-gates mainnet. Privacy support is checked through the Wallet API before any private-balance permission is requested.</p>
        <div className="wallet-list">
          {pickable.length ? pickable.map((w)=><button key={w.name} disabled={busy} onClick={()=>connect(w)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}<img src={w.icon} alt=""/><span>{w.name}</span><b>→</b>
          </button>) : <div className="empty">No compatible Starknet wallet detected. Ready is the demonstrated STRK20 route.</div>}
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </div>}
  </>;
}
