"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { STRK20_MAINNET_POOL, VOYAGER, VOYAGER_CONTRACT, formatStrk, isDeployed, POLICY_ADDRESS, ANONYMIZER_ADDRESS } from "@/lib/config";
import { short } from "@/lib/domain/ids";
import { useLedger } from "@/lib/domain/store";
import { DEVNET_LIFECYCLE, isUsable } from "@/lib/replay/artifact";
import ledger from "../../../evidence/claim-ledger.json";
import manifest from "../../../strk20.json";

type Row = {
  category: string;
  claim: string;
  status: "VERIFIED" | "PARTIAL" | "PENDING" | "BLOCKED";
  evidence: string;
  reproduce: string;
  limitation: string;
};

const LEDGER = ledger as unknown as {
  generatedAt: string;
  summary: Record<string, number>;
  cairo: { ran: boolean; passed: number; failed: number };
  rows: Row[];
};

const ORDER: Row["status"][] = ["VERIFIED", "PARTIAL", "PENDING", "BLOCKED"];
const isHash = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{20,}$/.test(v);

export default function Proof() {
  const [filter, setFilter] = useState<Row["status"] | "ALL">("ALL");
  const events = useLedger((s) => s.events);
  const projection = useLedger((s) => s.projection);

  const rows = useMemo(
    () => (filter === "ALL" ? LEDGER.rows : LEDGER.rows.filter((r) => r.status === filter)),
    [filter],
  );

  const mainnetTxs = (manifest.transactions as string[]).filter(isHash);
  const mainnetContracts = (manifest.contracts as string[]).filter(isHash);
  const replay = isUsable(DEVNET_LIFECYCLE) ? DEVNET_LIFECYCLE : null;

  // Evidence produced by this browser's own use of the product.
  const localSettlements = events.filter((e) => e.kind === "settlement.confirmed");
  const localRejections = events.filter((e) => e.kind === "settlement.rejected");

  return (
    <section className="product-page proof-page">
      <div className="page-head">
        <div>
          <span className="section-kicker">PROOF CENTRE</span>
          <h1>
            Don&apos;t trust the pitch.
            <br />
            Inspect the consequence.
          </h1>
        </div>
        <p>
          Every claim COVERT makes is listed below with the artifact behind it and the command that
          regenerates that artifact. Statuses are derived from those files by a script — nothing here is
          promoted to &ldquo;verified&rdquo; because a screen looks finished.
        </p>
      </div>

      {/* ------------------------------------------------ summary -------- */}
      <div className="reserve-split" style={{ marginTop: 0 }}>
        {ORDER.map((status) => (
          <button
            key={status}
            className={`reserve-cell ${status === "VERIFIED" ? "good" : status === "BLOCKED" ? "bad" : ""}`}
            style={{ textAlign: "left", border: "none", cursor: "pointer", font: "inherit", color: "inherit" }}
            onClick={() => setFilter(filter === status ? "ALL" : status)}
          >
            <span>{status}</span>
            <b>{LEDGER.summary[status] ?? 0}</b>
            <small>
              {status === "VERIFIED"
                ? "Backed by a reproducible artifact."
                : status === "PARTIAL"
                  ? "Weaker conditions than claimed."
                  : status === "PENDING"
                    ? "No evidence yet."
                    : "Needs an external credential."}
            </small>
          </button>
        ))}
      </div>

      <p className="hint">
        Ledger generated {new Date(LEDGER.generatedAt).toLocaleString()} by{" "}
        <code>scripts/build-claim-ledger.mjs</code>.{" "}
        {filter !== "ALL" && (
          <button className="ghost" onClick={() => setFilter("ALL")}>
            Clear filter
          </button>
        )}
      </p>

      {/* ------------------------------------------------ ledger --------- */}
      <div className="ledger-table" style={{ marginTop: 18 }}>
        <table>
          <thead>
            <tr>
              <th>Claim</th>
              <th>Status</th>
              <th>Evidence</th>
              <th>How to reproduce</th>
              <th>Limitation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <b>{r.claim}</b>
                  <div className="hint" style={{ margin: "4px 0 0" }}>
                    {r.category}
                  </div>
                </td>
                <td>
                  <span className={`verdict ${r.status}`}>{r.status}</span>
                </td>
                <td>{r.evidence}</td>
                <td>
                  <code>{r.reproduce}</code>
                </td>
                <td>{r.limitation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --------------------------------------- executed lifecycle ------ */}
      <div className="panel-head" style={{ marginTop: 38 }}>
        <span>EXECUTED LIFECYCLE</span>
        <b>{replay ? `${replay.steps.length} REAL TRANSACTIONS` : "NONE CAPTURED"}</b>
      </div>
      {replay ? (
        <>
          <p>
            The complete lifecycle — funding, cover, claim, refused settlement, approval, private settlement,
            reconciliation — has been executed as real transactions on a local Starknet node and recorded.{" "}
            {replay.checks.filter((c) => c.ok).length} of {replay.checks.length} assertions held.
          </p>
          <div className="delta-grid" style={{ marginTop: 16 }}>
            <div className="delta-cell">
              <small>Payout to public wallet</small>
              <strong>{formatStrk(BigInt(replay.balances.payoutCreditedToPublicWallet ?? "0"), 2)} STRK</strong>
              <p>Measured. The wallet still paid its own gas.</p>
            </div>
            <div className="delta-cell private">
              <small>Payout to private balance</small>
              <strong>+{formatStrk(BigInt(replay.balances.privateDelta ?? "0"), 2)} STRK</strong>
              <p>Exactly the tier&apos;s fixed indemnity.</p>
            </div>
            <div className="delta-cell">
              <small>Refused before approval</small>
              <strong>NOT_APPROVED</strong>
              <p>The contract&apos;s own revert reason, not a UI message.</p>
            </div>
          </div>
          <div className="inline-actions" style={{ marginTop: 16 }}>
            <Link className="primary" href="/replay">
              Walk the recorded lifecycle →
            </Link>
          </div>
        </>
      ) : (
        <p>
          No lifecycle artifact is present in this build. Run{" "}
          <code>node scripts/devnet/run-lifecycle.mjs</code> to capture one.
        </p>
      )}

      {/* ------------------------------------------- mainnet ------------- */}
      <div className="panel-head" style={{ marginTop: 38 }}>
        <span>STARKNET MAINNET</span>
        <b>{mainnetContracts.length >= 2 ? "DEPLOYED" : "NOT DEPLOYED"}</b>
      </div>
      <ul className="check-list">
        <li className={`check-row ${mainnetContracts.length >= 2 ? "pass" : "pending"}`}>
          <span className="mark">{mainnetContracts.length >= 2 ? "✓" : "·"}</span>
          <div>
            <b>Contracts deployed on mainnet</b>
            <p className="hint" style={{ margin: "3px 0 0" }}>
              {mainnetContracts.length
                ? mainnetContracts.map((c) => (
                    <a key={c} href={`${VOYAGER_CONTRACT}/${c}`} target="_blank" rel="noreferrer" style={{ marginRight: 12 }}>
                      {short(c)} ↗
                    </a>
                  ))
                : "No mainnet deployment exists. This is blocked on a funded account and an RPC credential, not on unfinished work."}
            </p>
          </div>
          <em>{mainnetContracts.length >= 2 ? "RECORDED" : "BLOCKED"}</em>
        </li>
        {["Private policy purchase", "Authenticated claim", "Private settlement"].map((label, i) => {
          const hash = mainnetTxs[i];
          return (
            <li key={label} className={`check-row ${hash ? "pass" : "pending"}`}>
              <span className="mark">{hash ? "✓" : "·"}</span>
              <div>
                <b>
                  TX-0{i + 1} — {label}
                </b>
                <p className="hint" style={{ margin: "3px 0 0" }}>
                  {hash ? (
                    <a href={`${VOYAGER}/${hash}`} target="_blank" rel="noreferrer">
                      {short(hash)} ↗ — inspect it; a recorded hash is a candidate, not a certification.
                    </a>
                  ) : (
                    "Pending real execution on mainnet."
                  )}
                </p>
              </div>
              <em>{hash ? "RECORDED" : "BLOCKED"}</em>
            </li>
          );
        })}
      </ul>

      <div className="reserve-split">
        <div className="reserve-cell">
          <span>STRK20 pool (mainnet)</span>
          <b style={{ fontSize: 14, fontFamily: "var(--mono)" }}>{short(STRK20_MAINNET_POOL, 12, 8)}</b>
          <small>Pinned at deployment. The anonymizer accepts calls from nothing else.</small>
        </div>
        <div className="reserve-cell">
          <span>Configured policy</span>
          <b style={{ fontSize: 14, fontFamily: "var(--mono)" }}>
            {isDeployed() ? short(POLICY_ADDRESS, 12, 8) : "NOT CONFIGURED"}
          </b>
          <small>From this build&apos;s environment.</small>
        </div>
        <div className="reserve-cell">
          <span>Configured anonymizer</span>
          <b style={{ fontSize: 14, fontFamily: "var(--mono)" }}>
            {isDeployed() ? short(ANONYMIZER_ADDRESS, 12, 8) : "NOT CONFIGURED"}
          </b>
          <small>From this build&apos;s environment.</small>
        </div>
        <div className="reserve-cell">
          <span>Cairo tests</span>
          <b>{LEDGER.cairo.ran ? `${LEDGER.cairo.passed} PASS` : "NOT RUN"}</b>
          <small>{LEDGER.cairo.ran ? `${LEDGER.cairo.failed} failed` : "Run snforge test."}</small>
        </div>
      </div>

      {/* --------------------------------------- your own evidence ------- */}
      {(localSettlements.length > 0 || localRejections.length > 0) && (
        <>
          <div className="panel-head" style={{ marginTop: 38 }}>
            <span>EVIDENCE FROM YOUR OWN USE</span>
            <b>{projection.policies.length} POLICIES IN THIS BROWSER</b>
          </div>
          <ul className="check-list">
            {localRejections.map((e) => (
              <li className="check-row fail" key={e.id}>
                <span className="mark">×</span>
                <div>
                  <b>Settlement refused — {e.reason}</b>
                  <p className="hint" style={{ margin: "3px 0 0" }}>
                    {e.note} ({new Date(e.ts).toLocaleString()})
                  </p>
                </div>
                <em>{e.policyId}</em>
              </li>
            ))}
            {localSettlements.map((e) => (
              <li className="check-row pass" key={e.id}>
                <span className="mark">✓</span>
                <div>
                  <b>Private settlement confirmed</b>
                  <p className="hint" style={{ margin: "3px 0 0" }}>
                    {e.note} ({new Date(e.ts).toLocaleString()})
                  </p>
                </div>
                <em>{e.policyId}</em>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ------------------------------------------- verify it ----------- */}
      <div className="panel" style={{ marginTop: 38 }}>
        <div className="panel-head">
          <span>VERIFY WITHOUT THIS INTERFACE</span>
          <b>INDEPENDENT PATH</b>
        </div>
        <p>
          A frontend should not be the source of truth for anything onchain. This command reconstructs a
          policy&apos;s entire lifecycle from Starknet events alone, using only the contract address — it never
          reads browser state.
        </p>
        <div className="evidence-reveal">
          <code>node scripts/verify-lifecycle.mjs --policy &lt;POLICY_COMMITMENT&gt;</code>
          <code>node scripts/verify-lifecycle.mjs --artifact evidence/devnet-lifecycle.json</code>
        </div>
        <p className="hint">
          It prints the events it found, the state transitions it inferred and whether they are internally
          consistent, then exits non-zero if they are not.
        </p>
      </div>
    </section>
  );
}
