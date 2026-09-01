"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TIERS, VOYAGER, formatStrk, formatStrkSigned } from "@/lib/config";
import { CLAIM_LABEL, POLICY_LABEL, policyTone, settlementBlocker } from "@/lib/domain/machine";
import { short } from "@/lib/domain/ids";
import { useLedger } from "@/lib/domain/store";
import { makeFailure } from "@/lib/domain/errors";
import {
  attemptSettlement,
  packetForClaim,
  recordPacketExport,
  reconcilePolicy,
  releaseExpiredPolicy,
  timeOutClaim,
} from "@/lib/covert/operations";
import { findSecret } from "@/lib/domain/persistence";
import ActionReceipt, { idleReceipt, type Receipt } from "@/components/ActionReceipt";
import StatusPill from "@/components/StatusPill";
import Timeline from "@/components/Timeline";
import { useReadiness } from "@/components/SystemState";
import { timelineFor } from "@/lib/domain/projection";

export default function PolicyDetail() {
  const params = useParams<{ id: string }>();
  const policyId = params?.id;

  const hydrated = useLedger((s) => s.hydrated);
  const projection = useLedger((s) => s.projection);
  const events = useLedger((s) => s.events);
  const inFlight = useLedger((s) => s.inFlight);
  const { connected, mainnet, deployed } = useReadiness();

  const [receipt, setReceipt] = useState<Receipt>(idleReceipt);
  const [copyState, setCopyState] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const policy = policyId ? projection.byPolicyId.get(policyId) : undefined;
  const claim = policy?.claimId ? projection.byClaimId.get(policy.claimId) : undefined;
  const tier = TIERS.find((t) => t.id === policy?.tier);

  const timeline = useMemo(
    () => (policyId ? timelineFor(events, policyId, policy?.claimId) : []),
    [events, policyId, policy?.claimId],
  );

  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  const hasBearerKey = Boolean(policy && findSecret(policy.commitment));
  const settleBusy = Boolean(policyId && inFlight[`settle:${policyId}`]);

  // What the contract would refuse right now. Used to warn, never to block.
  const blocker = policy && claim ? settlementBlocker(policy.status, claim.status) : null;
  const blockerFailure = blocker ? makeFailure(blocker) : null;

  const expired = policy?.expiresAt !== undefined && nowSec > policy.expiresAt;
  const settlementEvidence = useMemo(
    () => timeline.filter((e) => e.kind === "settlement.rejected"),
    [timeline],
  );
  // Gate the settlement result on the PROJECTED state, not on the presence of a
  // settlement event. An event the state machine rejected — a forged one, or a
  // stale duplicate — must not be able to render a success panel for a policy
  // that did not actually settle.
  const settledForReal = policy?.status === "settled" && claim?.status === "settled";
  const confirmed = useMemo(
    () => (settledForReal ? timeline.find((e) => e.kind === "settlement.confirmed") : undefined),
    [timeline, settledForReal],
  );

  async function onReconcile() {
    if (!policyId) return;
    setReconciling(true);
    const result = await reconcilePolicy(policyId);
    setReconciling(false);
    setReceipt(
      result.ok
        ? { state: "success", title: "Reconciled with chain state", detail: "Local history now matches what the contract reports." }
        : { state: "error", failure: result.failure },
    );
  }

  async function onSettle() {
    if (!policyId) return;
    setReceipt({
      state: "pending",
      title: "Requesting settlement…",
      detail: blocker
        ? `The contract is expected to refuse this with ${blocker}. The attempt and its reason will be kept as evidence.`
        : "Routing the fixed payout back into STRK20 as a private note.",
    });
    const result = await attemptSettlement(policyId);
    if (!result.ok) {
      setReceipt({
        state: result.failure?.class === "wallet" ? "error" : "rejected",
        failure: result.failure,
        hash: result.txHash,
      });
      return;
    }
    setReceipt({
      state: "success",
      title: "Settled privately",
      detail: "The payout went to the anonymizer and returned to STRK20. Your public address is absent from that path.",
      hash: result.txHash,
    });
  }

  async function onExpire() {
    if (!policyId) return;
    setReceipt({ state: "pending", title: "Releasing exposure…" });
    const result = await releaseExpiredPolicy(policyId);
    setReceipt(
      result.ok
        ? { state: "success", title: "Exposure released", detail: "The reserve no longer carries this policy.", hash: result.txHash }
        : { state: "rejected", failure: result.failure, hash: result.txHash },
    );
  }

  async function onTimeOut() {
    if (!claim) return;
    setReceipt({ state: "pending", title: "Closing abandoned claim…" });
    const result = await timeOutClaim(claim.id);
    setReceipt(
      result.ok
        ? { state: "success", title: "Claim closed after deadline", detail: "Exposure returned to the reserve.", hash: result.txHash }
        : { state: "rejected", failure: result.failure, hash: result.txHash },
    );
  }

  async function onCopyPacket() {
    if (!claim) return;
    const packet = packetForClaim(claim.id);
    if (!packet) {
      setCopyState("NO REVEAL STORED IN THIS BROWSER");
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
      recordPacketExport(claim.id);
      setCopyState("COPIED — SEND PRIVATELY TO THE ADJUDICATOR");
    } catch {
      setCopyState("COPY BLOCKED — SELECT THE PACKET MANUALLY");
    }
    setTimeout(() => setCopyState(""), 3500);
  }

  if (!hydrated) {
    return (
      <section className="product-page">
        <div className="empty">Loading local policy state…</div>
      </section>
    );
  }

  if (!policy) {
    return (
      <section className="product-page">
        <div className="page-head">
          <div>
            <span className="section-kicker">POLICY</span>
            <h1>Not found in this browser.</h1>
          </div>
          <p>
            COVERT policies are controlled by a bearer key held locally. If you activated this policy in a
            different browser or profile, open it there.
          </p>
        </div>
        <div className="inline-actions">
          <Link className="primary" href="/cover">
            Activate cover
          </Link>
          <Link className="secondary" href="/history">
            See all local policies
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="product-page">
      <div className="page-head">
        <div>
          <span className="section-kicker">POLICY {policy.id}</span>
          <h1>
            {tier?.name} cover.
            <br />
            {formatStrk(policy.payoutWei, 2)} STRK fixed payout.
          </h1>
        </div>
        <p>{tier?.blurb} Everything below is derived from stored lifecycle events and the contract itself.</p>
      </div>

      <div className="inline-actions" style={{ marginBottom: 22 }}>
        <StatusPill label={POLICY_LABEL[policy.status]} tone={policyTone(policy.status)} />
        {claim && <StatusPill label={`CLAIM ${CLAIM_LABEL[claim.status]}`} tone={claim.status === "denied" ? "bad" : claim.status === "settled" ? "good" : "live"} />}
        {!hasBearerKey && <StatusPill label="NO BEARER KEY HERE" tone="warn" title="This browser cannot authorise actions on this policy." />}
        {expired && policy.status === "active" && <StatusPill label="TERM ELAPSED" tone="warn" />}
      </div>

      <div className="detail-grid">
        {/* ---------------------------------------------- facts ---------- */}
        <div>
          <div className="panel-head">
            <span>POLICY RECORD</span>
            <b>{policy.chainConfirmed ? "CHAIN CONFIRMED" : "LOCAL ONLY"}</b>
          </div>
          <dl className="kv">
            <dt>Reference</dt>
            <dd>{policy.id}</dd>
            <dt>Tier</dt>
            <dd>{tier?.name}</dd>
            <dt>Premium</dt>
            <dd>{formatStrk(policy.premiumWei, 2)} STRK</dd>
            <dt>Fixed payout</dt>
            <dd>{formatStrk(policy.payoutWei, 2)} STRK</dd>
            <dt>Term</dt>
            <dd>{policy.termDays} days</dd>
            <dt>Activated</dt>
            <dd>{policy.activatedAt ? new Date(policy.activatedAt).toLocaleString() : "—"}</dd>
            <dt>Expires</dt>
            <dd>{policy.expiresAt ? new Date(policy.expiresAt * 1000).toLocaleString() : "—"}</dd>
            <dt>Commitment</dt>
            <dd title={policy.commitment}>{short(policy.commitment, 14, 8)}</dd>
            <dt>Beneficiary</dt>
            <dd>NOT ATTACHED</dd>
            {policy.purchaseTx && (
              <>
                <dt>Purchase</dt>
                <dd>
                  <a href={`${VOYAGER}/${policy.purchaseTx}`} target="_blank" rel="noreferrer">
                    {short(policy.purchaseTx)} ↗
                  </a>
                </dd>
              </>
            )}
          </dl>

          <div className="detail-actions">
            <button className="ghost" onClick={onReconcile} disabled={!deployed || reconciling}>
              {reconciling ? "Reconciling…" : "Reconcile with chain"}
            </button>
            {policy.status === "active" && !expired && (
              <Link className="primary" href={`/claim?policy=${policy.id}`}>
                File a claim
              </Link>
            )}
            {policy.status === "active" && expired && (
              <button className="secondary" onClick={onExpire} disabled={!connected || !mainnet || !deployed}>
                Release exposure
              </button>
            )}
          </div>
        </div>

        {/* ---------------------------------------------- claim ---------- */}
        <div>
          <div className="panel-head">
            <span>CLAIM</span>
            <b>{claim ? CLAIM_LABEL[claim.status] : "NONE FILED"}</b>
          </div>

          {!claim && (
            <>
              <p className="hint">
                This policy still holds its single claim slot. A claim can only be filed by whoever holds the
                bearer key, which is what stops an observer consuming the slot to grief you.
              </p>
              {policy.status === "active" && !expired && (
                <div className="detail-actions">
                  <Link className="primary" href={`/claim?policy=${policy.id}`}>
                    File a claim
                  </Link>
                </div>
              )}
            </>
          )}

          {claim && (
            <>
              <dl className="kv">
                <dt>Reference</dt>
                <dd>{claim.id}</dd>
                <dt>Filed</dt>
                <dd>{claim.submittedAt ? new Date(claim.submittedAt).toLocaleString() : "—"}</dd>
                <dt>Decision</dt>
                <dd>{CLAIM_LABEL[claim.status]}</dd>
                <dt>Commitment</dt>
                <dd title={claim.claimCommitment}>{short(claim.claimCommitment, 14, 8)}</dd>
                {claim.rejectedSettlements > 0 && (
                  <>
                    <dt>Refused settlements</dt>
                    <dd>{claim.rejectedSettlements}</dd>
                  </>
                )}
                {claim.denialReason && (
                  <>
                    <dt>Reason</dt>
                    <dd>{claim.denialReason}</dd>
                  </>
                )}
              </dl>

              <div className="detail-actions">
                <button className="ghost" onClick={onCopyPacket}>
                  {copyState || "Copy reveal packet"}
                </button>
                {claim.status === "under_review" && (
                  <button className="ghost" onClick={onTimeOut} disabled={!connected || !mainnet || !deployed}>
                    Close after deadline
                  </button>
                )}
              </div>
              <p className="hint">
                The reveal packet contains the incident text and its salt. Send it to the adjudicator out of
                band — it is not meant for public storage, and COVERT never publishes it.
              </p>
            </>
          )}
        </div>
      </div>

      {/* ------------------------------------------- settlement ---------- */}
      {claim && claim.status !== "denied" && (
        <div className="panel settlement-panel" style={{ marginTop: 26 }}>
          <div className="panel-head">
            <span>SETTLEMENT</span>
            <b className={`decision d${claim.status === "approved" || claim.status === "settled" ? 1 : 0}`}>
              {blocker ? `BLOCKED — ${blocker}` : "AUTHORISED"}
            </b>
          </div>

          {blockerFailure && claim.status !== "settled" && (
            <p>
              {blockerFailure.detail} You can still run it: COVERT does not hide the refusal behind a disabled
              button, because the point is that the <em>contract</em> refuses, not the interface.
            </p>
          )}

          {claim.status === "approved" && (
            <p>
              The adjudicator has approved this claim. The identical settlement action that was refused before
              will now succeed.
            </p>
          )}

          <div className="settlement-actions">
            <button
              className="secondary"
              onClick={onSettle}
              disabled={!connected || !mainnet || !deployed || !hasBearerKey || settleBusy || claim.status === "settled"}
            >
              {claim.status === "settled"
                ? "Already settled"
                : settleBusy
                  ? "Settling…"
                  : blocker
                    ? "Attempt settlement anyway"
                    : "Receive payout privately"}
            </button>
          </div>

          <ActionReceipt receipt={receipt} />
        </div>
      )}

      {/* ------------------------- the before/after consequence ---------- */}
      {confirmed && (
        <div className="magic-moment" style={{ marginTop: 26 }}>
          <div className="magic-title">
            <span>APPROVED → SETTLED PRIVATELY</span>
            <b>THE WALLET TRAIL STOPS HERE.</b>
          </div>
          <div className="delta-grid">
            <div className="delta-cell">
              <small>PAID TO YOUR PUBLIC WALLET</small>
              <strong>
                {(() => {
                  const before = confirmed.data?.publicBeforeWei;
                  const after = confirmed.data?.publicAfterWei;
                  if (typeof before !== "string" || typeof after !== "string") return "0.00 STRK";
                  // Any decrease is gas the wallet paid, never a payout it received.
                  const delta = BigInt(after) - BigInt(before);
                  return delta > 0n ? `${formatStrkSigned(delta)} STRK` : "0.00 STRK";
                })()}
              </strong>
              <p>
                The policy pays the anonymizer, never your address. Your public balance still moves by the gas
                you paid — COVERT does not claim otherwise.
              </p>
            </div>
            <div className="delta-cell private">
              <small>CREDITED TO PRIVATE BALANCE</small>
              <strong>
                {(() => {
                  const before = confirmed.data?.privateBeforeWei;
                  const after = confirmed.data?.privateAfterWei;
                  if (typeof before !== "string" || typeof after !== "string") {
                    return `+${formatStrk(policy.payoutWei, 2)} STRK`;
                  }
                  return `${formatStrkSigned(BigInt(after) - BigInt(before))} STRK`;
                })()}
              </strong>
              <p>Measured from the wallet&apos;s reported private balance before and after settlement.</p>
            </div>
            <div className="delta-cell">
              <small>BENEFICIARY</small>
              <strong>NOT EXPOSED</strong>
              <p>The settlement path contains the pool and the anonymizer. It does not contain a beneficiary address.</p>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------- adversarial evidence ---------------- */}
      {settlementEvidence.length > 0 && (
        <div className="panel" style={{ marginTop: 26 }}>
          <div className="panel-head">
            <span>ADVERSARIAL EVIDENCE</span>
            <b>
              {settlementEvidence.length} REFUSED ATTEMPT{settlementEvidence.length === 1 ? "" : "S"}
            </b>
          </div>
          <p>
            Settlement was requested before it was authorised and the contract refused. These records are kept
            deliberately: they are the proof that approval is enforced onchain rather than in the interface.
          </p>
          <ul className="check-list">
            {settlementEvidence.map((e) => (
              <li className="check-row fail" key={e.id}>
                <span className="mark">×</span>
                <div>
                  <b>{new Date(e.ts).toLocaleString()}</b>
                  <p className="hint" style={{ margin: "3px 0 0" }}>
                    {e.note}
                  </p>
                  {e.txHash && (
                    <a href={`${VOYAGER}/${e.txHash}`} target="_blank" rel="noreferrer" className="hint">
                      {short(e.txHash)} ↗
                    </a>
                  )}
                </div>
                <em>{e.reason}</em>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --------------------------------------------- timeline ---------- */}
      <div className="panel" style={{ marginTop: 26 }}>
        <div className="panel-head">
          <span>COMPLETE TIMELINE</span>
          <b>{timeline.length} EVENTS</b>
        </div>
        <Timeline events={timeline} emptyLabel="No recorded events for this policy." />
      </div>
    </section>
  );
}
