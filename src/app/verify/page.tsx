"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TIERS, VOYAGER, formatStrk } from "@/lib/config";
import { readClaimState, readRoles, type ChainClaimState } from "@/lib/chain/read";
import { decideClaim, importPacket, verifyPacketAgainstChain } from "@/lib/covert/operations";
import { verifyIncidentReveal } from "@/lib/covert/key";
import { findReveal } from "@/lib/domain/persistence";
import { sameFelt, short } from "@/lib/domain/ids";
import { useLedger } from "@/lib/domain/store";
import { CLAIM_LABEL } from "@/lib/domain/machine";
import ActionReceipt, { idleReceipt, type Receipt } from "@/components/ActionReceipt";
import StatusPill from "@/components/StatusPill";
import { useReadiness } from "@/components/SystemState";
import { useWallet } from "@/lib/wallet/store";

const DECISION_LABEL = ["PENDING", "APPROVED", "DENIED"];

export default function Verify() {
  const hydrated = useLedger((s) => s.hydrated);
  const projection = useLedger((s) => s.projection);
  const inFlight = useLedger((s) => s.inFlight);
  const address = useWallet((s) => s.address);
  const { connected, mainnet, deployed } = useReadiness();

  const [selected, setSelected] = useState("");
  const [packetText, setPacketText] = useState("");
  const [importReceipt, setImportReceipt] = useState<Receipt>(idleReceipt);
  const [decisionReceipt, setDecisionReceipt] = useState<Receipt>(idleReceipt);
  const [chainState, setChainState] = useState<ChainClaimState | null>(null);
  const [chainError, setChainError] = useState("");
  const [adjudicator, setAdjudicator] = useState("");
  const [denialReason, setDenialReason] = useState("");
  const [chainChecked, setChainChecked] = useState(false);

  // Claims this browser can adjudicate: it must hold the reveal.
  const queue = useMemo(
    () => projection.claims.filter((c) => findReveal(c.claimCommitment)),
    [projection.claims],
  );

  useEffect(() => {
    if (!hydrated) return;
    if (!selected && queue[0]) setSelected(queue[0].id);
  }, [hydrated, queue, selected]);

  useEffect(() => {
    if (!deployed) return;
    readRoles()
      .then((r) => setAdjudicator(r.adjudicator))
      .catch(() => setAdjudicator(""));
  }, [deployed]);

  const claim = selected ? projection.byClaimId.get(selected) : undefined;
  const packet = claim ? findReveal(claim.claimCommitment) : undefined;
  const policy = claim ? projection.byPolicyId.get(claim.policyId) : undefined;
  const tier = TIERS.find((t) => t.id === (packet?.tier ?? policy?.tier));

  const refreshChain = useCallback(async () => {
    if (!claim || !deployed) return;
    setChainChecked(false);
    setChainError("");
    try {
      setChainState(await readClaimState(claim.claimCommitment));
    } catch (e) {
      setChainState(null);
      setChainError((e as Error).message);
    } finally {
      setChainChecked(true);
    }
  }, [claim, deployed]);

  useEffect(() => {
    setChainState(null);
    setDecisionReceipt(idleReceipt);
    setDenialReason("");
    refreshChain();
  }, [selected, refreshChain]);

  // --- the three independent checks an adjudicator must pass -------------
  const reveal = packet ? verifyIncidentReveal(packet) : null;
  const recomputes = Boolean(reveal?.incidentMatches && reveal?.claimMatches);
  const matchesChain = Boolean(
    packet &&
      chainState?.exists &&
      sameFelt(chainState.policyCommitment, packet.policyCommitment) &&
      sameFelt(chainState.incidentHash, packet.incidentHash),
  );
  const isAdjudicator = Boolean(connected && adjudicator && sameFelt(address, adjudicator));
  const pending = chainState?.decision === 0;
  const canDecide = isAdjudicator && mainnet && deployed && recomputes && matchesChain && pending;
  const busy = Boolean(selected && inFlight[`decide:${selected}`]);

  function onImport() {
    const result = importPacket(packetText);
    if (!result.ok) {
      setImportReceipt({ state: "rejected", failure: result.failure });
      return;
    }
    setSelected(result.value!.claimId);
    setPacketText("");
    setImportReceipt({
      state: "success",
      title: "Packet imported and recomputed",
      detail: "The revealed incident reproduces both committed hashes. Now cross-check it against the chain.",
    });
  }

  async function onCrossCheck() {
    if (!claim) return;
    const result = await verifyPacketAgainstChain(claim.id);
    await refreshChain();
    setImportReceipt(
      result.ok
        ? {
            state: "success",
            title: "Reveal matches the onchain claim",
            detail: "This packet describes the claim that was actually filed.",
          }
        : { state: "rejected", failure: result.failure },
    );
  }

  async function onDecide(decision: "approve" | "deny") {
    if (!claim) return;
    setDecisionReceipt({
      state: "pending",
      title: decision === "approve" ? "Approving claim…" : "Denying claim…",
      detail: "Recorded by the dedicated adjudicator role. The payout amount is not yours to change.",
    });
    const result = await decideClaim({
      claimId: claim.id,
      decision,
      reason: decision === "deny" ? denialReason.trim() || undefined : undefined,
    });
    await refreshChain();
    setDecisionReceipt(
      result.ok
        ? {
            state: "success",
            title: decision === "approve" ? "Claim approved" : "Claim denied",
            detail:
              decision === "approve"
                ? "Settlement is now authorised. The claimant can draw the fixed payout into their private balance."
                : "Exposure has been released back to the reserve and the policy is closed.",
            hash: result.txHash,
          }
        : { state: "rejected", failure: result.failure, hash: result.txHash },
    );
  }

  return (
    <section className="product-page">
      <div className="page-head">
        <div>
          <span className="section-kicker">ADJUDICATE</span>
          <h1>
            Decide validity.
            <br />
            Never invent the payout.
          </h1>
        </div>
        <p>
          The adjudicator receives a private reveal out of band, recomputes its commitments, checks them
          against the onchain claim, then approves or denies. A packet that fails either check cannot be
          approved from this interface — and the contract still fixes the payout regardless.
        </p>
      </div>

      {/* ------------------------------------------------ role ----------- */}
      <div className="reserve-split" style={{ marginTop: 0 }}>
        <div className={`reserve-cell ${isAdjudicator ? "good" : ""}`}>
          <span>Your role</span>
          <b>{isAdjudicator ? "ADJUDICATOR" : connected ? "OBSERVER" : "NOT CONNECTED"}</b>
          <small>
            {isAdjudicator
              ? "This wallet matches the adjudicator recorded onchain."
              : connected
                ? "You can inspect and verify, but decisions will be refused with NOT_ADJUDICATOR."
                : "Connect the adjudicator wallet to record a decision."}
          </small>
        </div>
        <div className="reserve-cell">
          <span>Configured adjudicator</span>
          <b style={{ fontSize: 15, fontFamily: "var(--mono)" }}>
            {adjudicator ? short(adjudicator, 12, 8) : deployed ? "UNREADABLE" : "NO DEPLOYMENT"}
          </b>
          <small>Read from the policy contract, not from this build.</small>
        </div>
        <div className="reserve-cell">
          <span>Queue</span>
          <b>{queue.length}</b>
          <small>Claims whose reveal packet is held in this browser.</small>
        </div>
      </div>

      {/* ------------------------------------------------ import --------- */}
      <div className="panel verifier-import">
        <div className="panel-head">
          <span>REVEAL PACKET</span>
          <b>CROSS-BROWSER HANDOFF</b>
        </div>
        <textarea
          rows={5}
          placeholder="Paste the private JSON reveal packet from the claimant"
          value={packetText}
          onChange={(e) => setPacketText(e.target.value)}
          aria-label="Reveal packet JSON"
        />
        <div className="settlement-actions">
          <button className="secondary" onClick={onImport} disabled={!packetText.trim()}>
            Import and recompute
          </button>
          {claim && (
            <button className="ghost" onClick={onCrossCheck} disabled={!deployed}>
              Cross-check against chain
            </button>
          )}
        </div>
        <ActionReceipt receipt={importReceipt} />
        <p className="hint">
          This packet contains the incident text and its salt. It is private material — deliver it out of
          band, not through a public channel.
        </p>
      </div>

      {!hydrated ? (
        <div className="empty">Loading…</div>
      ) : queue.length === 0 ? (
        <div className="panel">
          <div className="panel-head">
            <span>NO CLAIMS TO REVIEW</span>
            <b>EMPTY QUEUE</b>
          </div>
          <p>
            Nothing to adjudicate in this browser yet. Paste a reveal packet above, or open the{" "}
            <Link href="/replay">verified replay</Link> to see a completed adjudication end to end.
          </p>
        </div>
      ) : (
        <div className="verify-layout">
          {/* ---------------------------------------------- queue -------- */}
          <div className="panel">
            <div className="panel-head">
              <span>CLAIM QUEUE</span>
              <b>
                {queue.length} REVEAL{queue.length === 1 ? "" : "S"}
              </b>
            </div>
            <div className="claim-list">
              {queue.map((c) => (
                <button
                  className={selected === c.id ? "active" : ""}
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                >
                  <span>{c.id}</span>
                  <small>{CLAIM_LABEL[c.status]}</small>
                </button>
              ))}
            </div>
          </div>

          {/* ---------------------------------------------- review ------- */}
          <div className="panel verify-card">
            <div className="panel-head">
              <span>CLAIM REVIEW</span>
              <b className={`decision d${chainState?.decision ?? 9}`}>
                {chainState ? DECISION_LABEL[chainState.decision] ?? "UNKNOWN" : chainChecked ? "NOT ONCHAIN" : "READING…"}
              </b>
            </div>

            {!claim || !packet ? (
              <div className="empty">Select or import a claim.</div>
            ) : (
              <>
                <ul className="check-list" style={{ marginBottom: 18 }}>
                  <li className={`check-row ${recomputes ? "pass" : "fail"}`}>
                    <span className="mark">{recomputes ? "✓" : "×"}</span>
                    <div>
                      <b>Reveal reproduces its commitments</b>
                      <p className="hint" style={{ margin: "3px 0 0" }}>
                        Poseidon over the revealed text and salt is recomputed here, independently of the
                        claimant.
                      </p>
                    </div>
                    <em>{recomputes ? "MATCH" : "MISMATCH"}</em>
                  </li>
                  <li className={`check-row ${matchesChain ? "pass" : chainChecked ? "fail" : "pending"}`}>
                    <span className="mark">{matchesChain ? "✓" : chainChecked ? "×" : "·"}</span>
                    <div>
                      <b>Matches the claim recorded onchain</b>
                      <p className="hint" style={{ margin: "3px 0 0" }}>
                        {chainError
                          ? `Chain unreadable: ${chainError}`
                          : "A self-consistent packet can still describe a different incident. This check catches that."}
                      </p>
                    </div>
                    <em>{matchesChain ? "MATCH" : chainChecked ? "MISMATCH" : "READING"}</em>
                  </li>
                  <li className={`check-row ${isAdjudicator ? "pass" : "pending"}`}>
                    <span className="mark">{isAdjudicator ? "✓" : "·"}</span>
                    <div>
                      <b>Connected wallet is the adjudicator</b>
                      <p className="hint" style={{ margin: "3px 0 0" }}>
                        Enforced by the contract as well; this only saves you a failed transaction.
                      </p>
                    </div>
                    <em>{isAdjudicator ? "AUTHORISED" : "NOT AUTHORISED"}</em>
                  </li>
                </ul>

                <dl className="kv">
                  <dt>Claim</dt>
                  <dd title={packet.claimCommitment}>{short(packet.claimCommitment, 14, 8)}</dd>
                  <dt>Policy</dt>
                  <dd title={packet.policyCommitment}>{short(packet.policyCommitment, 14, 8)}</dd>
                  <dt>Fixed payout</dt>
                  <dd>{tier ? `${formatStrk(tier.payoutWei, 2)} STRK` : "—"}</dd>
                  <dt>Settled</dt>
                  <dd>{chainState?.redeemed ? "YES" : "NO"}</dd>
                  {packet.submitTx && (
                    <>
                      <dt>Filing tx</dt>
                      <dd>
                        <a href={`${VOYAGER}/${packet.submitTx}`} target="_blank" rel="noreferrer">
                          {short(packet.submitTx)} ↗
                        </a>
                      </dd>
                    </>
                  )}
                </dl>

                <div className="evidence-reveal">
                  <span>PRIVATE REVEAL</span>
                  <p>{packet.incidentText}</p>
                  <code>salt {short(packet.incidentSalt, 16, 8)}</code>
                  <code>committed {short(packet.incidentHash, 16, 8)}</code>
                  {reveal && !reveal.incidentMatches && (
                    <code>recomputed {short(reveal.recomputedIncidentHash, 16, 8)}</code>
                  )}
                </div>

                {!canDecide && (
                  <div className="integrity-block">
                    {chainState && chainState.decision !== 0
                      ? `ALREADY DECIDED — this claim is ${DECISION_LABEL[chainState.decision]}. A decision is final onchain.`
                      : !recomputes
                        ? "APPROVAL LOCKED — the reveal does not reproduce its own commitments. Request a fresh packet."
                        : !matchesChain
                          ? "APPROVAL LOCKED — the reveal does not match the claim recorded onchain."
                          : !isAdjudicator
                            ? "APPROVAL LOCKED — connect the adjudicator wallet to record a decision."
                            : "APPROVAL LOCKED — a precondition is not met."}
                  </div>
                )}

                {canDecide && (
                  <>
                    <label className="field-label" htmlFor="denial-reason">
                      Reason (recorded locally with a denial)
                    </label>
                    <input
                      id="denial-reason"
                      value={denialReason}
                      onChange={(e) => setDenialReason(e.target.value)}
                      placeholder="e.g. incident falls outside the policy term"
                    />
                  </>
                )}

                <div className="decision-actions">
                  <button className="ghost" disabled={!canDecide || busy} onClick={() => onDecide("deny")}>
                    Deny claim
                  </button>
                  <button className="primary" disabled={!canDecide || busy} onClick={() => onDecide("approve")}>
                    {busy ? "Recording…" : "Approve claim"}
                  </button>
                </div>

                <ActionReceipt receipt={decisionReceipt} />

                {policy && (
                  <div className="inline-actions" style={{ marginTop: 14 }}>
                    <StatusPill label={`POLICY ${policy.id}`} />
                    <Link className="ghost" href={`/policy/${policy.id}`}>
                      Open policy timeline →
                    </Link>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="privacy-note">
        <b>Trust boundary</b>
        <p>
          The adjudicator sees only what the claimant voluntarily revealed, and can only choose approve or
          deny. Policy duration, the fixed payout, reserve accounting and replay protection all belong to the
          contract. If the adjudicator simply disappears, the claim can be closed by anyone after its onchain
          deadline so the reserve is not locked forever.
        </p>
      </div>
    </section>
  );
}
