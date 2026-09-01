"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { NOTE_MATURITY_BLOCKS, TIERS, formatStrk, parseStrk } from "@/lib/config";
import { getBlockNumber, readPoolFee, readTierQuote } from "@/lib/chain/read";
import { activateCover, shieldFunds } from "@/lib/covert/operations";
import { privateStrkBalanceWei } from "@/lib/covert/actions";
import { useLedger, usePolicies } from "@/lib/domain/store";
import ActionReceipt, { idleReceipt, type Receipt } from "@/components/ActionReceipt";
import StatusPill from "@/components/StatusPill";
import { useReadiness } from "@/components/SystemState";
import { POLICY_LABEL, policyTone } from "@/lib/domain/machine";

export default function Cover() {
  const [tierId, setTierId] = useState(2);
  const [shieldAmount, setShieldAmount] = useState("0.10");
  const [shieldReceipt, setShieldReceipt] = useState<Receipt>(idleReceipt);
  const [coverReceipt, setCoverReceipt] = useState<Receipt>(idleReceipt);
  const [feeWei, setFeeWei] = useState<bigint | null>(null);
  const [feeChecked, setFeeChecked] = useState(false);
  const [privateWei, setPrivateWei] = useState<bigint | null>(null);
  const [shieldBlock, setShieldBlock] = useState<number | null>(null);
  const [block, setBlock] = useState<number | null>(null);
  const [quote, setQuote] = useState<{ premiumWei: bigint; payoutWei: bigint; termSeconds: number } | null>(null);
  const [newPolicyId, setNewPolicyId] = useState<string | null>(null);

  const { connected, mainnet, deployed, rpc } = useReadiness();
  const inFlight = useLedger((s) => s.inFlight);
  const policies = usePolicies();
  const tier = useMemo(() => TIERS.find((t) => t.id === tierId)!, [tierId]);

  const activePolicies = policies.filter((p) => p.status === "active" || p.status === "claim_pending");

  // --- pool fee: read it or say so. Never guess. ---------------------------
  useEffect(() => {
    let cancelled = false;
    readPoolFee()
      .then((v) => {
        if (cancelled) return;
        setFeeWei(v);
        setFeeChecked(true);
      })
      .catch(() => !cancelled && setFeeChecked(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // --- contract-quoted economics: the client table is not authoritative ----
  useEffect(() => {
    if (!deployed) return;
    let cancelled = false;
    readTierQuote(tierId)
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
  }, [tierId, deployed]);

  const refreshPrivate = useCallback(() => {
    if (!connected || !mainnet) return;
    privateStrkBalanceWei().then(setPrivateWei).catch(() => setPrivateWei(null));
  }, [connected, mainnet]);

  useEffect(() => {
    refreshPrivate();
  }, [refreshPrivate]);

  // --- note maturity: a UX wait so the wallet can discover the new note ----
  useEffect(() => {
    if (shieldBlock === null) return;
    const tick = () => getBlockNumber().then(setBlock).catch(() => undefined);
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [shieldBlock]);

  const blocksSince = shieldBlock !== null && block !== null ? Math.max(0, block - shieldBlock) : null;
  const noteReady = blocksSince === null || blocksSince >= NOTE_MATURITY_BLOCKS;

  const shieldWei = parseStrk(shieldAmount);
  const shieldBusy = Boolean(inFlight["shield"]);
  const coverBusy = Boolean(inFlight[`buy:${tierId}`]);

  // A quoted mismatch means the deployed contract disagrees with this build.
  const quoteMismatch = quote !== null && (quote.premiumWei !== tier.premiumWei || quote.payoutWei !== tier.payoutWei);

  const enoughPrivate = privateWei === null ? null : privateWei >= tier.premiumWei;

  async function onShield() {
    if (shieldWei === null || shieldWei <= 0n) {
      setShieldReceipt({ state: "error", title: "Enter a valid STRK amount", detail: "Use a plain decimal, e.g. 0.25." });
      return;
    }
    setShieldReceipt({
      state: "pending",
      title: `Shielding ${formatStrk(shieldWei)} STRK…`,
      detail: "This deposit is publicly visible. Privacy begins only once the funds are inside STRK20.",
    });
    const result = await shieldFunds(shieldWei);
    if (!result.ok) {
      setShieldReceipt({ state: result.failure?.class === "wallet" ? "error" : "rejected", failure: result.failure, hash: result.txHash });
      return;
    }
    const b = await getBlockNumber().catch(() => null);
    if (b !== null) {
      setShieldBlock(b);
      setBlock(b);
    }
    setShieldReceipt({
      state: "success",
      title: "Deposit confirmed",
      detail: `The new note needs roughly ${NOTE_MATURITY_BLOCKS} blocks before the wallet can spend it.`,
      hash: result.value,
    });
    refreshPrivate();
  }

  async function onActivate() {
    setCoverReceipt({
      state: "pending",
      title: `Activating ${tier.name}…`,
      detail: "A fresh bearer key is minted in this browser. The contract, not the interface, sets the policy term.",
    });
    const result = await activateCover(tierId);
    if (!result.ok) {
      setCoverReceipt({
        state: result.failure?.class === "wallet" ? "error" : "rejected",
        failure: result.failure,
        hash: result.txHash,
      });
      return;
    }
    setNewPolicyId(result.value?.id ?? null);
    setCoverReceipt({
      state: "success",
      title: `${tier.name} cover is active`,
      detail: `Policy ${result.value?.id} holds a fixed payout of ${formatStrk(tier.payoutWei)} STRK. No public address is attached to it.`,
      hash: result.txHash,
    });
    refreshPrivate();
  }

  const canActivate = connected && mainnet && deployed && noteReady && !coverBusy && !quoteMismatch;

  return (
    <section className="product-page">
      <div className="page-head">
        <div>
          <span className="section-kicker">GET COVERED</span>
          <h1>
            Protect the treasury.
            <br />
            Not the wallet trail.
          </h1>
        </div>
        <p>
          Pick a fixed-payout tier and activate it from your shielded balance. The premium, payout and
          term are public rules held by the contract. The bearer key that controls the policy stays in
          this browser.
        </p>
      </div>

      <div className="two-col">
        {/* ------------------------------------------------ funding ------ */}
        <div className="panel">
          <div className="panel-head">
            <span>PRIVATE FUNDING</span>
            <b>STRK20</b>
          </div>
          <p>
            Fund the private balance the policy flow spends from. This first deposit is public and
            COVERT does not pretend otherwise — privacy starts once the funds are inside the pool.
          </p>

          <label className="field-label" htmlFor="shield-amount">
            Shield amount
          </label>
          <div className="amount-input">
            <input
              id="shield-amount"
              value={shieldAmount}
              onChange={(e) => setShieldAmount(e.target.value)}
              inputMode="decimal"
              aria-invalid={shieldWei === null}
            />
            <span>STRK</span>
          </div>

          <div className="fee-lines">
            <div>
              <span>Pool fee / private operation</span>
              <b>
                {!feeChecked
                  ? "Reading…"
                  : feeWei === null
                    ? "Unavailable — your wallet quotes it at signing"
                    : `${formatStrk(feeWei)} STRK`}
              </b>
            </div>
            <div>
              <span>Fresh-note maturity</span>
              <b>~{NOTE_MATURITY_BLOCKS} blocks</b>
            </div>
            <div>
              <span>Shielded balance</span>
              <b>{privateWei === null ? "Unknown" : `${formatStrk(privateWei)} STRK`}</b>
            </div>
          </div>

          <button className="secondary wide" disabled={!connected || !mainnet || shieldBusy} onClick={onShield}>
            {!connected
              ? "Connect wallet first"
              : !mainnet
                ? "Switch to Starknet Mainnet"
                : shieldBusy
                  ? "Shielding…"
                  : "Fund private balance"}
          </button>
          <ActionReceipt receipt={shieldReceipt} />

          {shieldBlock !== null && (
            <div className={`maturity ${noteReady ? "ready" : "waiting"}`}>
              <span>{noteReady ? "READY TO SPEND" : "PRIVATE NOTE PREPARING"}</span>
              <b>
                {Math.min(blocksSince ?? 0, NOTE_MATURITY_BLOCKS)} / {NOTE_MATURITY_BLOCKS} blocks
              </b>
              <div>
                <i style={{ width: `${Math.min(100, ((blocksSince ?? 0) / NOTE_MATURITY_BLOCKS) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------------------ tiers -------- */}
        <div className="panel">
          <div className="panel-head">
            <span>SELECT PROTECTION</span>
            <b>FIXED INDEMNITY</b>
          </div>

          <div className="tier-list">
            {TIERS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTierId(t.id)}
                className={tierId === t.id ? "tier active" : "tier"}
                aria-pressed={tierId === t.id}
              >
                <div>
                  <b>{t.name}</b>
                  <span>{t.termDays} days</span>
                </div>
                <strong>{formatStrk(t.payoutWei, 2)} STRK</strong>
                <small>{formatStrk(t.premiumWei, 2)} STRK premium</small>
              </button>
            ))}
          </div>

          <div className="quote">
            <span>Premium</span>
            <b>{formatStrk(tier.premiumWei, 2)} STRK</b>
            <span>Fixed payout</span>
            <b>{formatStrk(tier.payoutWei, 2)} STRK</b>
            <span>Policy term</span>
            <b>{tier.termDays} days</b>
          </div>

          {deployed && (
            <p className="hint">
              {quote === null
                ? "Contract quote unavailable right now; the figures above are this build's table."
                : quoteMismatch
                  ? "This build's tier table does not match the deployed contract. Activation is blocked to avoid a guaranteed BAD_PREMIUM revert."
                  : "Verified against the deployed contract's own quote_tier — these are not client-side numbers."}
            </p>
          )}

          {enoughPrivate === false && (
            <p className="hint">
              Shielded balance is below the {formatStrk(tier.premiumWei, 2)} STRK premium. Fund the private
              balance first.
            </p>
          )}

          <button className="primary wide" disabled={!canActivate} onClick={onActivate}>
            {!connected
              ? "Connect wallet first"
              : !mainnet
                ? "Switch to Starknet Mainnet"
                : !deployed
                  ? "No deployment configured"
                  : quoteMismatch
                    ? "Tier table mismatch"
                    : !noteReady
                      ? "Waiting for note maturity"
                      : coverBusy
                        ? "Activating…"
                        : `Activate ${tier.name}`}
          </button>
          <ActionReceipt receipt={coverReceipt} />

          {newPolicyId && (
            <div className="inline-actions" style={{ marginTop: 14 }}>
              <Link className="secondary" href={`/policy/${newPolicyId}`}>
                Open policy {newPolicyId} →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* --------------------------------------------- existing cover ---- */}
      {activePolicies.length > 0 && (
        <>
          <div className="panel-head" style={{ marginTop: 34 }}>
            <span>YOUR COVER</span>
            <b>
              {activePolicies.length} ACTIVE POLIC{activePolicies.length === 1 ? "Y" : "IES"}
            </b>
          </div>
          <div className="policy-grid">
            {activePolicies.map((p) => (
              <Link className="policy-card" key={p.id} href={`/policy/${p.id}`}>
                <div className="policy-card-head">
                  <b>{p.id}</b>
                  <StatusPill label={POLICY_LABEL[p.status]} tone={policyTone(p.status)} />
                </div>
                <div className="policy-card-tier">{TIERS.find((t) => t.id === p.tier)?.name}</div>
                <div className="policy-card-rows">
                  <span>Fixed payout</span>
                  <b>{formatStrk(p.payoutWei, 2)} STRK</b>
                  <span>Expires</span>
                  <b>{p.expiresAt ? new Date(p.expiresAt * 1000).toLocaleDateString() : "—"}</b>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="privacy-note">
        <b>What the contract owns</b>
        <p>
          Premium, payout and term are derived onchain from the tier byte. This interface cannot extend a
          cheap policy, choose a payout, or issue cover the reserve cannot back — the contract rejects all
          three. {rpc === false && "Live figures are stale right now because no node is answering."}
        </p>
      </div>

      <div className="privacy-note">
        <b>Privacy boundary</b>
        <p>
          The shield deposit above is public. What COVERT breaks is the link between the wallet that holds a
          policy and the destination that receives its payout: the policy contract only ever sees the pinned
          anonymizer, and an approved payout returns to STRK20 as a note. Timing, amount and a small
          anonymity set can still correlate. This is not invisibility.
        </p>
      </div>
    </section>
  );
}
