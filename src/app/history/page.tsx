"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { TIERS, formatStrk } from "@/lib/config";
import { CLAIM_LABEL, POLICY_LABEL, policyTone } from "@/lib/domain/machine";
import { timelineFor } from "@/lib/domain/projection";
import { sensitiveSummary } from "@/lib/domain/persistence";
import { useLedger } from "@/lib/domain/store";
import { reconcileAll } from "@/lib/covert/operations";
import StatusPill from "@/components/StatusPill";
import Timeline from "@/components/Timeline";
import { useReadiness } from "@/components/SystemState";
import type { PolicyStatus } from "@/lib/domain/types";

type Filter = "all" | "open" | "closed";

const OPEN: PolicyStatus[] = ["draft", "activating", "active", "claim_pending", "claim_approved", "settling"];

export default function History() {
  const hydrated = useLedger((s) => s.hydrated);
  const projection = useLedger((s) => s.projection);
  const events = useLedger((s) => s.events);
  const clearEverything = useLedger((s) => s.clearEverything);
  const clearSensitive = useLedger((s) => s.clearSensitive);
  const { deployed } = useReadiness();

  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState<"none" | "keys" | "all">("none");

  const policies = useMemo(() => {
    if (filter === "open") return projection.policies.filter((p) => OPEN.includes(p.status));
    if (filter === "closed") return projection.policies.filter((p) => !OPEN.includes(p.status));
    return projection.policies;
  }, [projection.policies, filter]);

  const custody = hydrated ? sensitiveSummary() : { bearerKeys: 0, reveals: 0, ledgerEvents: 0 };

  async function onReconcile() {
    setReconciling(true);
    await reconcileAll();
    setReconciling(false);
  }

  if (!hydrated) {
    return (
      <section className="product-page">
        <div className="empty">Loading local history…</div>
      </section>
    );
  }

  return (
    <section className="product-page">
      <div className="page-head">
        <div>
          <span className="section-kicker">HISTORY</span>
          <h1>
            Every policy.
            <br />
            Every state it passed through.
          </h1>
        </div>
        <p>
          Reconstructed from this browser&apos;s stored lifecycle events and reconciled against the chain.
          Nothing here is re-derived for display — each entry is a record with its own timestamp and source.
        </p>
      </div>

      <div className="inline-actions" style={{ marginBottom: 22 }}>
        {(["all", "open", "closed"] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? "secondary" : "ghost"} onClick={() => setFilter(f)}>
            {f === "all" ? `All (${projection.policies.length})` : f === "open" ? "Open" : "Closed"}
          </button>
        ))}
        <button className="ghost" onClick={onReconcile} disabled={!deployed || reconciling}>
          {reconciling ? "Reconciling…" : "Reconcile all with chain"}
        </button>
      </div>

      {projection.policies.length === 0 ? (
        <div className="panel">
          <div className="panel-head">
            <span>NOTHING YET</span>
            <b>EMPTY HISTORY</b>
          </div>
          <p>
            No policies have been activated in this browser. History fills in as you use the product — and
            survives reloads, because it is stored as an append-only event log rather than as screen state.
          </p>
          <div className="detail-actions">
            <Link className="primary" href="/cover">
              Activate cover
            </Link>
            <Link className="secondary" href="/replay">
              Watch a completed lifecycle
            </Link>
          </div>
        </div>
      ) : policies.length === 0 ? (
        <div className="empty">No policies match this filter.</div>
      ) : (
        <div className="ledger-table">
          <table>
            <thead>
              <tr>
                <th>Policy</th>
                <th>Tier</th>
                <th>Payout</th>
                <th>Status</th>
                <th>Claim</th>
                <th>Opened</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => {
                const claim = p.claimId ? projection.byClaimId.get(p.claimId) : undefined;
                const isOpen = expanded === p.id;
                return [
                  <tr key={p.id}>
                    <td>
                      <Link href={`/policy/${p.id}`}>
                        <code>{p.id}</code>
                      </Link>
                    </td>
                    <td>{TIERS.find((t) => t.id === p.tier)?.name}</td>
                    <td>{formatStrk(p.payoutWei, 2)} STRK</td>
                    <td>
                      <StatusPill label={POLICY_LABEL[p.status]} tone={policyTone(p.status)} />
                    </td>
                    <td>
                      {claim ? (
                        <>
                          {CLAIM_LABEL[claim.status]}
                          {claim.rejectedSettlements > 0 && (
                            <div className="hint" style={{ margin: 0 }}>
                              {claim.rejectedSettlements} refused settlement
                              {claim.rejectedSettlements === 1 ? "" : "s"}
                            </div>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button className="ghost" onClick={() => setExpanded(isOpen ? null : p.id)}>
                        {isOpen ? "Hide" : "Timeline"}
                      </button>
                    </td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${p.id}-timeline`}>
                      <td colSpan={7}>
                        <Timeline events={timelineFor(events, p.id, p.claimId)} />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------------ custody -------- */}
      <div className="panel-head" style={{ marginTop: 38 }}>
        <span>WHAT THIS BROWSER HOLDS</span>
        <b>LOCAL CUSTODY</b>
      </div>
      <div className="reserve-split" style={{ marginTop: 0 }}>
        <div className="reserve-cell">
          <span>Bearer keys</span>
          <b>{custody.bearerKeys}</b>
          <small>Whoever holds these controls the matching policies. COVERT cannot recover them.</small>
        </div>
        <div className="reserve-cell">
          <span>Reveal packets</span>
          <b>{custody.reveals}</b>
          <small>Incident text and salts. Private, but not custody.</small>
        </div>
        <div className="reserve-cell">
          <span>Ledger events</span>
          <b>{custody.ledgerEvents}</b>
          <small>Public, chain-reconstructable lifecycle records.</small>
        </div>
      </div>

      <div className="danger-zone">
        <b>Erase local material</b>
        <p>
          Removing bearer keys makes every unsettled policy in this browser permanently unclaimable — the
          contract will keep rejecting settlement with BAD_SIGNATURE and nobody can undo that. Public history
          is unaffected and can still be rebuilt from the chain.
        </p>
        {confirmWipe === "none" ? (
          <div className="inline-actions">
            <button className="ghost" onClick={() => setConfirmWipe("keys")}>
              Erase bearer keys and reveals
            </button>
            <button className="ghost" onClick={() => setConfirmWipe("all")}>
              Erase everything
            </button>
          </div>
        ) : (
          <div className="inline-actions">
            <span className="hint" style={{ margin: 0 }}>
              {confirmWipe === "keys"
                ? `Erase ${custody.bearerKeys} bearer key(s) and ${custody.reveals} reveal(s)?`
                : `Erase all local state including ${custody.ledgerEvents} history events?`}
            </span>
            <button
              className="secondary"
              onClick={() => {
                if (confirmWipe === "keys") clearSensitive();
                else clearEverything();
                setConfirmWipe("none");
              }}
            >
              Yes, erase
            </button>
            <button className="ghost" onClick={() => setConfirmWipe("none")}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
