# Limitations

What COVERT does not do, cannot currently prove, or gets wrong. This document
exists so nothing in the product has to be discovered by a reader who trusted it.

## Not deployed on mainnet

**No COVERT contract is deployed on Starknet Mainnet.** No mainnet transaction
has been executed. This is blocked on a funded account and an RPC credential,
neither of which exists in this workspace — it is not blocked on unfinished code.

Everything needed is ready: `cairo/scripts/00-preflight.sh` validates the
environment and estimates the cost, `00-gates.sh` through `05-verify-source.sh`
perform the deployment, and `docs/MAINNET-PROOF.md` records the order. The
`/proof` surface reports these rows as **BLOCKED**, not pending, and never shows
an address that does not exist.

## The devnet run does not prove STRK20's privacy

`evidence/devnet-lifecycle.json` records 13 real transactions against a real
Starknet node. It proves COVERT's own contracts behave correctly: settlement is
refused before approval and accepted after, the payout is fixed by tier, the
reserve reconciles, and no STRK transfer in the settlement transaction has the
holder's address as its destination.

It proves **nothing** about the real STRK20 pool. On devnet the pool is
`MockStrk20Pool`, which reproduces the pool's calling pattern — funds the
anonymizer, calls `privacy_invoke` as the pinned caller, absorbs the returned
`OpenNoteDeposit` — and none of its cryptography. A "private balance" in that
stand-in is a plain map, fully visible.

The route COVERT's contracts execute is identical in both cases. The privacy of
the pool itself is inherited from STRK20 and is only real on mainnet.

## Privacy: what is actually hidden

**Public, and COVERT says so on every surface that touches it:**

- your first deposit into STRK20;
- the fact that your wallet interacts with the pool at all;
- policy terms, premium, payout, expiry;
- reserve and outstanding exposure;
- the salted claim commitment and the timing of every action;
- the gas you pay, which comes from your public address.

**Not published:**

- which wallet controls which policy — the contract stores a public key, not an
  address;
- what the incident was — only a salted commitment is onchain;
- a beneficiary address — there isn't one in the payout path.

**The public balance is not unchanged.** The settlement transaction is paid for
by the claimant, so their public STRK balance *decreases* by the fee. The claim
is that the payout never arrives there, and the evidence for it is the direction
of the transfers in the settlement transaction, not the balance delta.

**Correlation still works.** Fixed payouts at three distinct amounts, a small
anonymity set, and visible timing make linkage plausible for an observer who
cares. COVERT breaks a specific structural link. It is not anonymity.

## Bearer keys live in localStorage

A policy is controlled by a Stark-curve private key held in browser storage.

- Any script achieving XSS on this origin can steal it and claim the policy.
- Clearing site data destroys it, and the policy becomes permanently unclaimable
  — the contract will keep answering `BAD_SIGNATURE` and nobody can override it.
- Private browsing loses it when the tab closes. The app warns about this
  explicitly when storage is unavailable.
- There is no recovery, no backup, and no server-side copy by design.

`/history` shows how much custody material the browser holds and offers to erase
it, stating the consequence before doing so. A production deployment should move
these keys to a passkey-derived or wallet-derived secret rather than raw
localStorage.

## Adjudication is a trusted role

One address decides every claim. It cannot change the payout, extend a term, or
touch the reserve — but it can deny a valid claim, or approve an invalid one.

The mitigations are bounded rather than complete:

- the adjudicator is separate from the owner and enforced onchain;
- the interface refuses to approve a reveal that does not recompute or does not
  match the onchain claim, but a determined adjudicator can call the contract
  directly and bypass that;
- an abandoned claim can be closed by anyone after `adjudication_window`
  (72 hours), so an absent adjudicator cannot lock reserve capital forever.

That last mechanism has a cost: a claimant whose adjudicator simply goes quiet
loses the claim after 72 hours rather than waiting indefinitely. That trade is
deliberate — permanently frozen reserves are worse — but it is a real downside,
and it has only been exercised against a cheated clock in tests, never over a
real 72-hour window onchain.

A real deployment wants multiple adjudicators, a dispute path, or an attestation
oracle. None of those exist here.

## Economics are proof-sized, not commercial

Premiums of 0.01–0.04 STRK against payouts of 0.05–0.20 STRK are a 5:1 ratio
with no risk model behind it. Real cover needs pricing, correlated-risk limits,
a capital model and reinsurance. COVERT has a reserve check and nothing else.

There is also no incident oracle. "The RPC went down" is asserted by the
claimant and judged by a human.

## Testing gaps

- **Wallet signing is not automated.** The E2E suite drives the UI against a
  seeded ledger. It cannot click through a wallet extension, so the
  wallet-rejection and signature paths are covered by unit tests and manual use
  rather than by browser automation.
- **The devnet run is single-policy.** Multi-policy reserve accounting, reserve
  depletion and expiry-under-load are covered by `snforge`, not by the recorded
  artifact.
- **No fuzzing or formal verification.** The contracts have 59 hand-written
  invariant tests and no external audit.
- **`MockToken` ignores allowances.** It is a test stand-in; the mainnet path
  uses real STRK, where the anonymizer's `approve` calls matter. The devnet run
  uses the real STRK contract, so that path is exercised there.

## Known rough edges

- Reconciliation is best-effort on mount. A policy whose transaction confirmed
  while the browser was closed shows as `activating` until reconciliation runs or
  the user presses **Reconcile with chain**.
- Private balance readings depend on the wallet answering `strk20Balances`. When
  it does not, the UI shows "Unknown" rather than zero, but the settlement delta
  then cannot be measured client-side.
- Policy references (`CVT-XXXX-XXXX`) are a 40-bit projection of the commitment.
  Collisions are astronomically unlikely but not impossible; the commitment is
  the identity, and the reference is only a label.
- The `/policy/[id]` route is server-rendered on demand while every other route
  is static. That is a consequence of the dynamic segment, not a design choice.

## Is STRK20 load-bearing?

The finalization brief asks whether COVERT still delivers its central value if the
private mechanism is removed. Answered honestly: **no.**

Strip STRK20 out and the settlement has to pay an address. That address is onchain,
linked to the claim, and trivially attributable — which is exactly the exposure the
product exists to remove. What remains is ordinary parametric cover with a slightly
obfuscated policy owner and a fully public payout. The headline ("get paid without
publishing who got paid") does not survive the removal.

Two components *are* separable and do independent work, and it would be dishonest
to credit them to STRK20:

- **Bearer-key policies** decouple policy control from the paying wallet and stop
  an observer griefing a public commitment by consuming its claim slot. That holds
  with or without a privacy pool.
- **Public reserve and fixed onchain economics** are a solvency property, not a
  privacy one.

But the settlement privacy — the thing the product is named for — is entirely
STRK20's. COVERT contributes the pinning, the authentication and the adjudication
around it; it does not contribute the privacy itself, and does not claim to.
