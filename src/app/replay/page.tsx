"use client";
import { useState } from "react";
import Link from "next/link";
import { formatStrk } from "@/lib/config";
import { short } from "@/lib/domain/ids";
import {
  DEVNET_LIFECYCLE,
  STEP_NARRATION,
  isUsable,
  networkLabel,
  type LifecycleStep,
} from "@/lib/replay/artifact";

function stepTone(step: LifecycleStep): "good" | "warn" | "bad" {
  if (step.expectRevert) return step.matchedExpectation ? "warn" : "bad";
  return step.status === "succeeded" ? "good" : "bad";
}

export default function Replay() {
  const artifact = DEVNET_LIFECYCLE;
  const usable = isUsable(artifact);
  const [openStep, setOpenStep] = useState<string | null>(null);

  if (!usable) {
    return (
      <section className="product-page">
        <div className="page-head">
          <div>
            <span className="section-kicker">VERIFIED REPLAY</span>
            <h1>No captured lifecycle yet.</h1>
          </div>
          <p>
            This build ships without a recorded execution. Run{" "}
            <code>node scripts/devnet/run-lifecycle.mjs</code> against a local node to capture one. COVERT does
            not ship a hand-written stand-in.
          </p>
        </div>
      </section>
    );
  }

  const payoutWei = BigInt(artifact.policy.payoutWei);
  const privateDelta = BigInt(artifact.balances.privateDelta ?? "0");
  const payoutToPublic = BigInt(artifact.balances.payoutCreditedToPublicWallet ?? "0");
  const feeWei = BigInt(artifact.balances.settlementFeeWei ?? "0");
  const isMainnet = artifact.kind === "MAINNET_EXECUTION";

  return (
    <section className="product-page">
      <div className="page-head">
        <div>
          <span className="section-kicker">VERIFIED REPLAY</span>
          <h1>
            A real lifecycle.
            <br />
            Recorded, not re-enacted.
          </h1>
        </div>
        <p>
          Every hash, revert reason and balance below came from transactions that actually executed. Nothing
          on this page is live, and nothing on it is simulated — it is a recording of a genuine run you can
          reproduce yourself with one command.
        </p>
      </div>

      {/* ------------------------------------------ provenance ---------- */}
      <div className="replay-frame">
        <div className="replay-header">
          <span className="replay-badge">{isMainnet ? "Verified replay — mainnet" : "Verified replay — devnet"}</span>
          <p>{artifact.disclaimer}</p>
        </div>

        <div className="reserve-split" style={{ margin: 0, border: "none" }}>
          <div className="reserve-cell">
            <span>Executed on</span>
            <b style={{ fontSize: 18 }}>{networkLabel(artifact)}</b>
            <small>chain id {artifact.network.chainId} / RPC {artifact.network.specVersion}</small>
          </div>
          <div className="reserve-cell">
            <span>Captured</span>
            <b style={{ fontSize: 18 }}>{new Date(artifact.capturedAt).toLocaleString()}</b>
            <small>{artifact.steps.length} transactions recorded.</small>
          </div>
          <div className="reserve-cell good">
            <span>Verdict</span>
            <b>{artifact.verdict}</b>
            <small>{artifact.checks.filter((c) => c.ok).length} of {artifact.checks.length} assertions held.</small>
          </div>
        </div>
      </div>

      {!isMainnet && (
        <div className="privacy-note" style={{ marginTop: 24 }}>
          <b>What this run does and does not prove</b>
          <p>
            It proves COVERT&apos;s own contracts behave correctly under real execution: settlement is refused
            before approval and accepted after, the payout is fixed by tier, the reserve reconciles, and the
            public wallet is never the payout&apos;s destination. It does not prove anything about the real
            STRK20 pool&apos;s privacy construction — that pool is represented here by a stand-in that
            reproduces its calling pattern only. Mainnet evidence remains outstanding and is tracked in the{" "}
            <Link href="/proof">Proof centre</Link>.
          </p>
        </div>
      )}

      {/* ------------------------------------------ consequence --------- */}
      <div className="panel-head" style={{ marginTop: 34 }}>
        <span>THE OBSERVED CONSEQUENCE</span>
        <b>MEASURED, NOT ASSERTED</b>
      </div>
      <div className="delta-grid">
        <div className="delta-cell">
          <small>Payout credited to the public wallet</small>
          <strong>{formatStrk(payoutToPublic, 2)} STRK</strong>
          <p>
            The wallet still paid {formatStrk(feeWei)} STRK in gas from that address — COVERT does not pretend
            the balance is untouched. What it never received is the payout.
          </p>
        </div>
        <div className="delta-cell private">
          <small>Credited to the private balance</small>
          <strong>+{formatStrk(privateDelta, 2)} STRK</strong>
          <p>Exactly the tier&apos;s fixed payout of {formatStrk(payoutWei, 2)} STRK.</p>
        </div>
        <div className="delta-cell">
          <small>Reserve movement</small>
          <strong>
            −{formatStrk(BigInt(artifact.reserve.beforeWei) - BigInt(artifact.reserve.afterWei), 2)} STRK
          </strong>
          <p>
            Exposure fell from {formatStrk(BigInt(artifact.reserve.exposureBeforeWei), 2)} to{" "}
            {formatStrk(BigInt(artifact.reserve.exposureAfterWei), 2)} STRK.
          </p>
        </div>
      </div>

      {/* ------------------------------------------ settlement route ---- */}
      {artifact.settlementRoute && (
        <>
          <div className="panel-head" style={{ marginTop: 34 }}>
            <span>WHERE THE MONEY ACTUALLY WENT</span>
            <b>STRK TRANSFERS IN THE SETTLEMENT TRANSACTION</b>
          </div>
          <div className="ledger-table">
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Amount</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                {artifact.settlementRoute.strkTransfers.map((t, i) => {
                  const same = (a: string, b: string) => {
                    try {
                      return BigInt(a) === BigInt(b);
                    } catch {
                      return false;
                    }
                  };
                  const meaning = same(t.from, artifact.contracts.policy)
                    ? "Policy pays the anonymizer the fixed payout."
                    : same(t.from, artifact.contracts.anonymizer)
                      ? "Anonymizer returns the payout to the pool, filling the open note."
                      : same(t.from, artifact.roles.holder)
                        ? "The holder pays gas. This is the only STRK leaving their public address."
                        : "Supporting transfer.";
                  return (
                    <tr key={i}>
                      <td>
                        <code>{short(t.from, 10, 6)}</code>
                      </td>
                      <td>
                        <code>{short(t.to, 10, 6)}</code>
                      </td>
                      <td>{formatStrk(BigInt(t.amountWei))} STRK</td>
                      <td>{meaning}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">
            {artifact.settlementRoute.transfersToPublicWallet.length === 0
              ? "No STRK transfer in this transaction has the holder's public address as its destination."
              : "A transfer to the public wallet was observed — inspect it before trusting this run."}
          </p>
        </>
      )}

      {/* ------------------------------------------ step by step -------- */}
      <div className="panel-head" style={{ marginTop: 34 }}>
        <span>THE LIFECYCLE, STEP BY STEP</span>
        <b>{artifact.steps.length} RECORDED TRANSACTIONS</b>
      </div>
      <ol className="replay-steps">
        {artifact.steps.map((step) => {
          const tone = stepTone(step);
          const open = openStep === step.id;
          return (
            <li key={step.id} className={`replay-step ${step.expectRevert ? "reverted" : ""}`}>
              <code>{step.id}</code>
              <div>
                <b>{step.title}</b>
                <p>{STEP_NARRATION[step.id] ?? ""}</p>
                {step.txHash && <span className="hash">{step.txHash}</span>}
                {step.expectRevert && (
                  <p className="hint" style={{ marginTop: 6 }}>
                    Required failure: <code>{step.expectRevert}</code>
                    {step.matchedExpectation ? " — refused for exactly this reason." : " — DID NOT MATCH."}
                  </p>
                )}
                {step.revertReason && (
                  <>
                    <button className="ghost" style={{ marginTop: 8 }} onClick={() => setOpenStep(open ? null : step.id)}>
                      {open ? "Hide raw revert" : "Show raw revert"}
                    </button>
                    {open && (
                      <span className="hash" style={{ whiteSpace: "pre-wrap" }}>
                        {step.revertReason.slice(0, 900)}
                      </span>
                    )}
                  </>
                )}
              </div>
              <span className={`verdict ${tone === "good" ? "VERIFIED" : tone === "warn" ? "PARTIAL" : "BLOCKED"}`}>
                {step.expectRevert ? "REFUSED AS REQUIRED" : step.status.toUpperCase()}
              </span>
            </li>
          );
        })}
      </ol>

      {/* ------------------------------------------ assertions ---------- */}
      <div className="panel-head" style={{ marginTop: 34 }}>
        <span>ASSERTIONS CHECKED BY THE RUN</span>
        <b>{artifact.checks.filter((c) => c.ok).length}/{artifact.checks.length}</b>
      </div>
      <ul className="check-list">
        {artifact.checks.map((c, i) => (
          <li key={i} className={`check-row ${c.ok ? "pass" : "fail"}`}>
            <span className="mark">{c.ok ? "✓" : "×"}</span>
            <div>{c.label}</div>
            <em>{c.ok ? "PASS" : "FAIL"}</em>
          </li>
        ))}
      </ul>

      {/* ------------------------------------------ reproduce ----------- */}
      <div className="panel" style={{ marginTop: 34 }}>
        <div className="panel-head">
          <span>REPRODUCE IT YOURSELF</span>
          <b>DO NOT TRUST THIS PAGE</b>
        </div>
        <p>
          This page renders a JSON artifact. The artifact is only worth something if you can regenerate it, so
          the run is a single command against a node you control.
        </p>
        <div className="evidence-reveal">
          <code>starknet-devnet --seed 42 --accounts 5 --port 5050</code>
          <code>cd cairo &amp;&amp; scarb build &amp;&amp; snforge test</code>
          <code>node scripts/devnet/run-lifecycle.mjs</code>
        </div>
        <p className="hint">
          The script asserts every claim on this page and exits non-zero if any of them stops holding. The raw
          artifact lives at <code>evidence/devnet-lifecycle.json</code>.
        </p>
      </div>

      <div className="deployment-footer">
        <span>POLICY</span>
        <code>{artifact.contracts.policy}</code>
        <span>ANONYMIZER</span>
        <code>{artifact.contracts.anonymizer}</code>
      </div>
      <p className="hint">
        These addresses exist on the recorded network only. Live deployment addresses, when they exist, are
        shown in the <Link href="/proof">Proof centre</Link>.
      </p>
    </section>
  );
}
