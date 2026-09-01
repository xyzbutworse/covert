"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { TIERS, formatStrk } from "@/lib/config";
import { MIN_INCIDENT_CHARS } from "@/lib/covert/key";
import { claimablePolicies, useLedger } from "@/lib/domain/store";
import { fileClaim, packetForClaim, recordPacketExport } from "@/lib/covert/operations";
import { findSecret } from "@/lib/domain/persistence";
import ActionReceipt, { idleReceipt, type Receipt } from "@/components/ActionReceipt";
import { useReadiness } from "@/components/SystemState";

function ClaimForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselected = searchParams.get("policy");

  const hydrated = useLedger((s) => s.hydrated);
  const projection = useLedger((s) => s.projection);
  const inFlight = useLedger((s) => s.inFlight);
  const { connected, mainnet, deployed } = useReadiness();

  const [selected, setSelected] = useState("");
  const [incident, setIncident] = useState("");
  const [receipt, setReceipt] = useState<Receipt>(idleReceipt);
  const [filedClaimId, setFiledClaimId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState("");

  const nowSec = Math.floor(Date.now() / 1000);
  const eligible = useMemo(
    () => claimablePolicies(projection.policies, nowSec).filter((p) => findSecret(p.commitment)),
    [projection.policies, nowSec],
  );

  useEffect(() => {
    if (!hydrated) return;
    if (preselected && eligible.some((p) => p.id === preselected)) {
      setSelected(preselected);
    } else if (!selected && eligible[0]) {
      setSelected(eligible[0].id);
    }
  }, [hydrated, preselected, eligible, selected]);

  const policy = projection.byPolicyId.get(selected);
  const tier = TIERS.find((t) => t.id === policy?.tier);
  const busy = Boolean(selected && inFlight[`claim:${selected}`]);
  const tooShort = incident.trim().length < MIN_INCIDENT_CHARS;

  // Policies that exist but cannot be claimed, with the reason for each.
  const blocked = useMemo(
    () =>
      projection.policies
        .filter((p) => !eligible.some((e) => e.id === p.id))
        .filter((p) => p.status !== "draft" && p.status !== "failed")
        .map((p) => ({
          policy: p,
          reason:
            p.status === "claim_pending"
              ? "A claim is already under review."
              : p.status === "claim_approved" || p.status === "settling"
                ? "Approved — settle it from the policy page."
                : p.status === "settled"
                  ? "Already settled."
                  : p.status === "claim_denied"
                    ? "Claim was denied; the policy is closed."
                    : p.status === "expired"
                      ? "Term ended."
                      : p.expiresAt !== undefined && nowSec > p.expiresAt
                        ? "Term ended."
                        : !findSecret(p.commitment)
                          ? "No bearer key in this browser."
                          : "Not claimable.",
        })),
    [projection.policies, eligible, nowSec],
  );

  async function onFile() {
    if (!policy) return;
    setReceipt({
      state: "pending",
      title: "Committing incident and filing…",
      detail: "The bearer key signs this exact claim before the policy's single claim slot can be consumed.",
    });
    const result = await fileClaim({ policyId: policy.id, incidentText: incident });
    if (!result.ok) {
      setReceipt({
        state: result.failure?.class === "wallet" ? "error" : "rejected",
        failure: result.failure,
        hash: result.txHash,
      });
      return;
    }
    setFiledClaimId(result.value?.id ?? null);
    setReceipt({
      state: "success",
      title: "Claim filed — awaiting adjudication",
      detail: "The incident text stays offchain. Only a salted commitment was published, and the contract authenticated your bearer key.",
      hash: result.txHash,
    });
  }

  async function onCopyPacket() {
    if (!filedClaimId) return;
    const packet = packetForClaim(filedClaimId);
    if (!packet) {
      setCopyState("NO REVEAL STORED");
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
      recordPacketExport(filedClaimId);
      setCopyState("COPIED — SEND PRIVATELY TO THE ADJUDICATOR");
    } catch {
      setCopyState("COPY BLOCKED — SELECT MANUALLY BELOW");
    }
    setTimeout(() => setCopyState(""), 3500);
  }

  if (!hydrated) {
    return <div className="empty">Loading local policy state…</div>;
  }

  return (
    <>
      <div className="step-rail">
        <div className={filedClaimId ? "done" : "active"}>
          <span>01</span>
          <b>File</b>
        </div>
        <div className={filedClaimId ? "active" : ""}>
          <span>02</span>
          <b>Adjudicate</b>
        </div>
        <div>
          <span>03</span>
          <b>Settle privately</b>
        </div>
      </div>

      {eligible.length === 0 ? (
        <div className="panel">
          <div className="panel-head">
            <span>NO CLAIMABLE POLICY</span>
            <b>{projection.policies.length ? "NONE ELIGIBLE" : "NO POLICIES YET"}</b>
          </div>
          <p>
            Filing a claim needs an active, unexpired policy whose bearer key is held in this browser.
            {projection.policies.length ? " None of your policies currently qualify." : ""}
          </p>
          <div className="detail-actions">
            <Link className="primary" href="/cover">
              Activate cover
            </Link>
            {projection.policies.length > 0 && (
              <Link className="secondary" href="/history">
                Review your policies
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="claim-stack">
          <div className="panel">
            <div className="panel-head">
              <span>POLICY</span>
              <b>BEARER AUTHENTICATED</b>
            </div>
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setFiledClaimId(null);
                setReceipt(idleReceipt);
              }}
              aria-label="Select a policy to claim against"
            >
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} — {TIERS.find((t) => t.id === p.tier)?.name} — {formatStrk(p.payoutWei, 2)} STRK
                </option>
              ))}
            </select>
            {policy && (
              <div className="policy-mini">
                <span>Fixed payout</span>
                <b>{formatStrk(policy.payoutWei, 2)} STRK</b>
                <span>Expires</span>
                <b>{policy.expiresAt ? new Date(policy.expiresAt * 1000).toLocaleDateString() : "—"}</b>
                <span>Identity</span>
                <b>NOT ATTACHED</b>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <span>INCIDENT</span>
              <b>SALTED COMMITMENT</b>
            </div>
            <p>
              Describe what happened. The text stays in this browser; only a salted hash of it is published,
              and the salt is what stops an observer guessing a short description from its hash.
            </p>
            <textarea
              value={incident}
              onChange={(e) => setIncident(e.target.value)}
              rows={4}
              placeholder="e.g. sequencer outage suspended settlement for 41 minutes"
              aria-label="Incident description"
            />
            {tooShort && incident.length > 0 && (
              <p className="hint">At least {MIN_INCIDENT_CHARS} characters are needed before this can be committed.</p>
            )}
            <button
              className="primary wide"
              onClick={onFile}
              disabled={!connected || !mainnet || !deployed || !policy || tooShort || busy || Boolean(filedClaimId)}
            >
              {!connected
                ? "Connect wallet first"
                : !mainnet
                  ? "Switch to Starknet Mainnet"
                  : !deployed
                    ? "No deployment configured"
                    : filedClaimId
                      ? "Claim filed"
                      : busy
                        ? "Filing…"
                        : "File authenticated claim"}
            </button>
            <ActionReceipt receipt={receipt} />
          </div>

          {filedClaimId && (
            <div className="panel">
              <div className="panel-head">
                <span>NEXT STEP</span>
                <b>HAND THE REVEAL TO THE ADJUDICATOR</b>
              </div>
              <p>
                The adjudicator cannot judge a hash. Send them the reveal packet privately; they recompute it
                and check it against the onchain claim before they are allowed to approve anything.
              </p>
              <div className="detail-actions">
                <button className="secondary" onClick={onCopyPacket}>
                  {copyState || "Copy reveal packet"}
                </button>
                <button className="primary" onClick={() => router.push(`/policy/${selected}`)}>
                  Open policy {selected} →
                </button>
              </div>
              <p className="hint">
                Settlement lives on the policy page. Try it before approval if you want to see the contract
                refuse it — that refusal is recorded as evidence.
              </p>
            </div>
          )}
        </div>
      )}

      {blocked.length > 0 && (
        <div className="panel" style={{ marginTop: 26 }}>
          <div className="panel-head">
            <span>NOT CLAIMABLE</span>
            <b>{blocked.length}</b>
          </div>
          <ul className="check-list">
            {blocked.map(({ policy: p, reason }) => (
              <li className="check-row pending" key={p.id}>
                <span className="mark">·</span>
                <div>
                  <b>
                    <Link href={`/policy/${p.id}`}>{p.id}</Link>
                  </b>
                  <p className="hint" style={{ margin: "3px 0 0" }}>
                    {reason}
                  </p>
                </div>
                <em>{p.status.replace(/_/g, " ")}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export default function Claim() {
  return (
    <section className="product-page">
      <div className="page-head">
        <div>
          <span className="section-kicker">FILE CLAIM</span>
          <h1>
            Prove the incident.
            <br />
            Keep the beneficiary private.
          </h1>
        </div>
        <p>
          COVERT authenticates the policy&apos;s bearer key before a claim can exist. The adjudicator decides
          whether the incident is valid — they cannot change what it pays.
        </p>
      </div>

      <Suspense fallback={<div className="empty">Loading…</div>}>
        <ClaimForm />
      </Suspense>

      <div className="privacy-note">
        <b>What stays private, precisely</b>
        <p>
          COVERT keeps the incident description offchain and keeps your public address out of the settlement
          path. It does not hide that your wallet interacts with the STRK20 pool, the timing of that
          interaction, or the fixed amount involved. Correlation remains possible.
        </p>
      </div>
    </section>
  );
}
