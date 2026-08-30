# COVERT — 3-minute judge demo

The demo leads with product consequence. STRK20 is revealed only after the judge has seen why the product matters.

## 0:00–0:10 — one sentence

“COVERT is incident cover for onchain teams that pays claims without revealing the protected wallet or payout wallet.”

Show the homepage. Do not explain anonymizers, commitments or open notes yet.

## 0:10–0:30 — active protection

Open an already active SIGNAL policy:

- protection: fixed proof-tier payout;
- policy: ACTIVE;
- beneficiary identity: not stored on the policy;
- reserve: funded.

State once: “The initial STRK20 deposit is public; COVERT's privacy claim starts after funds enter the pool.”

## 0:30–0:55 — file the incident

On `/claim`, submit the prepared incident.

Show:

- policy bearer authenticated;
- salted incident commitment created;
- claim state becomes **PENDING REVIEW**.

Open TX-02 only briefly if needed. The judge should remain focused on the workflow.

## 0:55–1:10 — visible failure

Click **Receive payout privately** before approval.

The product must show:

**SETTLEMENT BLOCKED — claim not approved.**

This is deliberate adversarial evidence, not a demo accident.

## 1:10–1:25 — constrained adjudication

Switch to `/verify` while connected as the configured adjudicator.

Show:

- policy active;
- bearer authentication already passed;
- private verifier packet imported from the claimant browser;
- incident + salt recomputed into the exact public commitments;
- onchain claim binding matches the packet;
- fixed payout that the adjudicator cannot edit.

Click **Approve claim**.

## 1:25–1:55 — the magic moment

Return to `/claim`, refresh status and click **Receive payout privately** again.

Hold on the result:

- **DIRECT PUBLIC PAYOUT: 0.00 STRK**
- **PRIVATE BALANCE: + fixed payout**
- **BENEFICIARY: NOT EXPOSED BY COVERT**

Say: “The exact action that failed before approval now succeeded, but COVERT never paid my public wallet. The settlement returned to my STRK20 private balance.”

This is the moment. Give it several seconds.

## 1:55–2:20 — reveal the mechanism

Now explain why:

`STRK20 pool → CovertAnonymizer → CovertPolicy → CovertAnonymizer → OpenNoteDeposit → STRK20 private note`

Open TX-03 on Voyager. Point to the COVERT contract events and the absence of a direct policy → user public-wallet payout.

## 2:20–2:45 — proof centre

Open `/proof`.

Show the three real scored transactions:

- TX-01 — private policy purchase;
- TX-02 — authenticated claim submission;
- TX-03 — private settlement.

Show that hashes are labelled **recorded**, not self-certified as verified. Open the explorer/official verifier for actual chain semantics. Missing evidence remains pending.

## 2:45–2:55 — adversarial proof

Flash the security matrix:

- claim without bearer signature — BLOCKED;
- settlement before approval — BLOCKED;
- replay — BLOCKED;
- frontend-chosen expiry — IMPOSSIBLE;
- adjudicator-chosen payout — IMPOSSIBLE.

## 2:55–3:00 — close

“Public rules. Private beneficiary. Real settlement.”

End on the COVERT mark and mainnet proof status.
