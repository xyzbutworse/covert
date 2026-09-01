"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { constants as SNconstants } from "starknet";
import { ANONYMIZER_ADDRESS, POLICY_ADDRESS, isDeployed } from "@/lib/config";
import { pingChain } from "@/lib/chain/read";
import { hasStorage } from "@/lib/domain/persistence";
import { useLedger } from "@/lib/domain/store";
import { reconcileAll } from "@/lib/covert/operations";
import { useWallet } from "@/lib/wallet/store";

export type Readiness = {
  storage: boolean;
  deployed: boolean;
  rpc: boolean | null;
  connected: boolean;
  mainnet: boolean;
};

/**
 * One hook every action screen uses to decide what it can offer right now.
 * Returning explicit booleans (rather than a single "ready") lets each screen say
 * precisely which precondition is missing instead of a generic disabled button.
 */
export function useReadiness(): Readiness {
  const connected = useWallet((s) => s.connected);
  const chain = useWallet((s) => s.chain);
  const [rpc, setRpc] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      pingChain()
        .then((ok) => !cancelled && setRpc(ok))
        .catch(() => !cancelled && setRpc(false));
    };
    check();
    const id = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return {
    storage: hasStorage(),
    deployed: isDeployed(),
    rpc,
    connected,
    mainnet: chain === SNconstants.StarknetChainId.SN_MAIN,
  };
}

/**
 * Hydrates the ledger and reconciles against the chain once per session.
 *
 * Mounted in the shell so a page refresh mid-flow always lands on real state:
 * whatever the browser missed while it was closed, the chain still knows.
 */
export function LedgerBoot() {
  const hydrate = useLedger((s) => s.hydrate);
  const hydrated = useLedger((s) => s.hydrated);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated || !isDeployed()) return;
    // Best-effort: a node that is down must not block the UI from rendering.
    reconcileAll().catch(() => undefined);
  }, [hydrated]);

  return null;
}

/**
 * Persistent, honest status strip.
 *
 * Never blocks the page. It states which capability is missing and links to the
 * one action that resolves it, so a first visit with no wallet still shows a
 * usable product rather than an empty shell.
 */
export function SystemBanner() {
  const { storage, deployed, rpc, connected, mainnet } = useReadiness();
  const persistent = useLedger((s) => s.persistent);
  const hydrated = useLedger((s) => s.hydrated);

  const notices: { tone: string; text: React.ReactNode }[] = [];

  if (!deployed) {
    notices.push({
      tone: "warn",
      text: (
        <>
          <b>No live deployment configured.</b> COVERT&apos;s contracts are not set for this build, so
          live actions are unavailable. The complete lifecycle is still inspectable in{" "}
          <Link href="/replay">verified replay</Link>.
        </>
      ),
    });
  }

  if (rpc === false) {
    notices.push({
      tone: "bad",
      text: (
        <>
          <b>No Starknet node reachable.</b> Your local policy history is intact and nothing was lost.
          Reads will resume automatically when a node answers.
        </>
      ),
    });
  }

  if (connected && !mainnet) {
    notices.push({
      tone: "bad",
      text: (
        <>
          <b>Wrong network.</b> COVERT operates on Starknet Mainnet. Switch the wallet&apos;s network and
          reconnect.
        </>
      ),
    });
  }

  if (hydrated && (!storage || !persistent)) {
    notices.push({
      tone: "warn",
      text: (
        <>
          <b>This browser is not storing state.</b> Private browsing or blocked site data means your
          bearer keys will disappear when the tab closes — and with them, control of any policy you
          activate here.
        </>
      ),
    });
  }

  if (!notices.length) return null;

  return (
    <div className="system-banner">
      {notices.map((n, i) => (
        <div key={i} className={`system-notice ${n.tone}`}>
          {n.text}
        </div>
      ))}
    </div>
  );
}

/** Shows which deployment the reader is looking at. Blank when nothing is configured. */
export function DeploymentFooter() {
  if (!isDeployed()) return null;
  return (
    <div className="deployment-footer">
      <span>POLICY</span>
      <code>{POLICY_ADDRESS}</code>
      <span>ANONYMIZER</span>
      <code>{ANONYMIZER_ADDRESS}</code>
    </div>
  );
}
