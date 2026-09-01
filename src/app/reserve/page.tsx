"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ANONYMIZER_ADDRESS, POLICY_ADDRESS, TIERS, formatStrk, isDeployed } from "@/lib/config";
import { readReserveState, readRoles, type ChainReserveState, type ChainRoles } from "@/lib/chain/read";
import { observeReserve } from "@/lib/covert/operations";
import { normalizeError, type NormalizedFailure } from "@/lib/domain/errors";
import { short } from "@/lib/domain/ids";
import { useLedger } from "@/lib/domain/store";

export default function Reserve() {
  const reserve = useLedger((s) => s.reserve);
  const hydrated = useLedger((s) => s.hydrated);

  const [chain, setChain] = useState<ChainReserveState | null>(null);
  const [roles, setRoles] = useState<ChainRoles | null>(null);
  const [failure, setFailure] = useState<NormalizedFailure | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isDeployed()) {
      setFailure(normalizeError(new Error("NOT_DEPLOYED")));
      return;
    }
    setLoading(true);
    try {
      const [state, r] = await Promise.all([readReserveState(), readRoles().catch(() => null)]);
      setChain(state);
      setRoles(r);
      setFailure(null);
      await observeReserve();
    } catch (e) {
      setFailure(normalizeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const available = chain ? chain.reserveWei - chain.exposureWei : null;
  const solvent = chain ? chain.reserveWei >= chain.exposureWei : null;
  const ratio =
    chain === null
      ? null
      : chain.exposureWei === 0n
        ? null
        : Number((chain.reserveWei * 10000n) / chain.exposureWei) / 100;

  // How many more of each tier the current free reserve could actually back.
  const capacity = TIERS.map((t) => ({
    tier: t,
    slots: available === null ? null : available <= 0n ? 0 : Number(available / t.payoutWei),
  }));

  return (
    <section className="product-page">
      <div className="page-head">
        <div>
          <span className="section-kicker">PUBLIC RESERVE</span>
          <h1>
            Private beneficiary.
            <br />
            Public solvency.
          </h1>
        </div>
        <p>
          COVERT hides who is covered, not whether it can pay. Reserve, outstanding exposure and every
          issuance rule stay inspectable — the contract refuses cover it cannot back, and no interface can
          override that.
        </p>
      </div>

      {/* ------------------------------------------- chain truth --------- */}
      <div className="panel-head">
        <span>CONTRACT STATE</span>
        <b>{chain ? "READ FROM CHAIN" : failure ? failure.code : "READING"}</b>
      </div>

      <div className="reserve-split">
        <div className="reserve-cell">
          <span>Reserve</span>
          <b>{chain ? `${formatStrk(chain.reserveWei)} STRK` : "—"}</b>
          <small>Capital held by the policy contract.</small>
          <span className="source-tag chain">CHAIN</span>
        </div>
        <div className="reserve-cell">
          <span>Outstanding exposure</span>
          <b>{chain ? `${formatStrk(chain.exposureWei)} STRK` : "—"}</b>
          <small>Fixed payouts owed on live policies.</small>
          <span className="source-tag chain">CHAIN</span>
        </div>
        <div className={`reserve-cell ${available === null ? "" : available >= 0n ? "good" : "bad"}`}>
          <span>Available to underwrite</span>
          <b>{available === null ? "—" : `${formatStrk(available)} STRK`}</b>
          <small>Reserve minus exposure. New cover is refused past this line.</small>
          <span className="source-tag chain">CHAIN</span>
        </div>
        <div className={`reserve-cell ${solvent === null ? "" : solvent ? "good" : "bad"}`}>
          <span>Solvency</span>
          <b>{solvent === null ? "—" : solvent ? (ratio === null ? "FULLY BACKED" : `${Math.floor(ratio)}%`) : "UNDER"}</b>
          <small>{chain?.exposureWei === 0n ? "No outstanding exposure." : "Reserve as a share of exposure."}</small>
          <span className="source-tag chain">CHAIN</span>
        </div>
      </div>

      {failure && (
        <div className="tx-receipt rejected" role="status">
          <div className="tx-receipt-head">
            <span className="tx-dot" />
            <b>{failure.title}</b>
            <code className="failure-code">{failure.code}</code>
          </div>
          <p>{failure.detail}</p>
          <p className="recovery">
            <span>NEXT</span>
            {failure.recovery}
          </p>
        </div>
      )}

      <div className="inline-actions" style={{ marginTop: 18 }}>
        <button className="ghost" onClick={refresh} disabled={loading}>
          {loading ? "Reading…" : "Refresh onchain state"}
        </button>
        {chain && (
          <span className="hint" style={{ margin: 0 }}>
            {chain.invokes.toString()} private operations routed through the anonymizer.
          </span>
        )}
      </div>

      {/* ------------------------------------------- capacity ------------ */}
      <div className="panel-head" style={{ marginTop: 34 }}>
        <span>UNDERWRITING CAPACITY</span>
        <b>DERIVED FROM CHAIN STATE</b>
      </div>
      <div className="ledger-table">
        <table>
          <thead>
            <tr>
              <th>Tier</th>
              <th>Premium</th>
              <th>Fixed payout</th>
              <th>Term</th>
              <th>Policies the free reserve can still back</th>
            </tr>
          </thead>
          <tbody>
            {capacity.map(({ tier, slots }) => (
              <tr key={tier.id}>
                <td>
                  <b>{tier.name}</b>
                </td>
                <td>{formatStrk(tier.premiumWei, 2)} STRK</td>
                <td>{formatStrk(tier.payoutWei, 2)} STRK</td>
                <td>{tier.termDays} days</td>
                <td>{slots === null ? "—" : slots === 0 ? <span className="verdict BLOCKED">NONE — ISSUANCE WOULD REVERT</span> : slots}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------- local view ---------- */}
      <div className="panel-head" style={{ marginTop: 34 }}>
        <span>THIS BROWSER&apos;S PORTFOLIO</span>
        <b>PROJECTED FROM LOCAL EVENTS</b>
      </div>
      <p className="hint" style={{ marginBottom: 16 }}>
        The figures above are the contract&apos;s. These are this browser&apos;s own lifecycle records, shown
        separately so a local projection is never mistaken for chain truth.
      </p>

      <div className="reserve-split" style={{ marginTop: 0 }}>
        <div className="reserve-cell">
          <span>Active</span>
          <b>{hydrated ? reserve.counts.active : "—"}</b>
          <small>Policies still in term.</small>
          <span className="source-tag local">LOCAL</span>
        </div>
        <div className="reserve-cell">
          <span>Under review</span>
          <b>{hydrated ? reserve.counts.claimPending : "—"}</b>
          <small>Claims awaiting a decision.</small>
          <span className="source-tag local">LOCAL</span>
        </div>
        <div className="reserve-cell">
          <span>Settled</span>
          <b>{hydrated ? reserve.counts.settled : "—"}</b>
          <small>{formatStrk(reserve.settledLiabilitiesWei)} STRK paid out privately.</small>
          <span className="source-tag local">LOCAL</span>
        </div>
        <div className="reserve-cell">
          <span>Closed without payout</span>
          <b>{hydrated ? reserve.counts.denied + reserve.counts.expired : "—"}</b>
          <small>
            {reserve.counts.denied} denied, {reserve.counts.expired} expired.
          </small>
          <span className="source-tag local">LOCAL</span>
        </div>
      </div>

      <div className="reserve-split" style={{ marginTop: 1 }}>
        <div className="reserve-cell">
          <span>Premiums paid</span>
          <b>{formatStrk(reserve.premiumsPaidWei)} STRK</b>
          <small>Across every policy this browser activated.</small>
          <span className="source-tag local">LOCAL</span>
        </div>
        <div className="reserve-cell">
          <span>Your outstanding exposure</span>
          <b>{formatStrk(reserve.localExposureWei)} STRK</b>
          <small>Part of the contract-wide exposure above.</small>
          <span className="source-tag local">LOCAL</span>
        </div>
        <div className="reserve-cell">
          <span>Failed activations</span>
          <b>{reserve.counts.failed}</b>
          <small>Never became a liability; no premium was taken.</small>
          <span className="source-tag local">LOCAL</span>
        </div>
      </div>

      <div className="inline-actions" style={{ marginTop: 18 }}>
        <Link className="ghost" href="/history">
          Open full history →
        </Link>
      </div>

      {/* ------------------------------------------- governance ---------- */}
      <div className="three" style={{ marginTop: 34 }}>
        <div className="metric">
          <span>Policy engine</span>
          <b>{isDeployed() ? short(POLICY_ADDRESS, 10, 6) : "NOT DEPLOYED"}</b>
          <p>Owns term, reserve, exposure, adjudication state and the fixed payout.</p>
        </div>
        <div className="metric">
          <span>Privacy bridge</span>
          <b>{isDeployed() ? short(ANONYMIZER_ADDRESS, 10, 6) : "NOT DEPLOYED"}</b>
          <p>Only the pinned STRK20 pool can drive it, and only toward the pinned policy.</p>
        </div>
        <div className="metric">
          <span>Operator powers</span>
          <b>{roles ? "SEPARATED" : "—"}</b>
          <p>
            The adjudicator can only approve or deny. The owner can fund the reserve and withdraw only reserve
            that backs nothing — never capital behind a live policy.
          </p>
        </div>
      </div>
    </section>
  );
}
