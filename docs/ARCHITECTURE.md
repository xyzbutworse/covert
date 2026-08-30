# COVERT architecture

## Product surface first

COVERT is incident cover for onchain teams that pays an approved claim without publicly linking the protected wallet to the payout destination.

The customer sees only:

`GET COVERED → FILE CLAIM → GET PAID`

The STRK20 machinery is deliberately hidden behind that workflow until the proof surface explains why it works.

## Core hypothesis

If a real user can buy fixed cover from shielded STRK, authenticate an incident claim without revealing the normal wallet, and receive the approved fixed payout as a new STRK20 private note, then COVERT has proven a useful privacy-preserving financial protection workflow rather than a generic private-transfer wrapper.

## Causal mechanism

1. A public wallet deposits STRK into the live STRK20 pool. This deposit is public.
2. After note maturity, the wallet privately spends the exact policy premium to `CovertAnonymizer` and invokes it through STRK20.
3. The anonymizer verifies that both caller and substituted `pool_address` equal the deployment-pinned pool, and that token/policy equal pinned addresses.
4. The anonymizer approves exactly the fixed premium to `CovertPolicy`.
5. `CovertPolicy` pulls the premium, derives expiry and payout from the chosen tier, checks solvency, and stores an opaque policy commitment plus one-time bearer public key.
6. To submit a claim, the browser salts the incident text, creates an incident hash and claim commitment, then signs a domain-separated claim message with the policy bearer key.
7. STRK20 calls the anonymizer, which forwards the authenticated claim to the policy. The policy contract never receives the user's normal wallet address.
8. A separate adjudicator account approves or denies the fixed-indemnity claim. It cannot choose the payout amount.
9. Settlement is intentionally attempted before approval in the demo and must fail.
10. After approval, the bearer signs a separate domain-separated redemption message.
11. `CovertPolicy` marks replay state before transferring the exact fixed payout to the anonymizer.
12. The anonymizer approves the pool for exactly the payout and returns `OpenNoteDeposit { note_id, token, amount }`.
13. STRK20 credits the payout into the wallet's private note set.

## Visible magical moment

The mechanism is not the demo moment. The moment is the consequence:

- before approval: **SETTLEMENT BLOCKED**;
- after approval: **SETTLEMENT COMPLETE**;
- direct public-wallet payout: **0 STRK**;
- STRK20 private balance: **increases by the fixed payout**;
- public beneficiary field: **none**.

Only then should the demo reveal the pool → anonymizer → policy → open-note path.

## Trust boundaries

### STRK20

Provides shielded note ownership, private note spend/creation, pool-mediated execution and the open-note return path. It does not hide the initial shield transaction and does not eliminate timing/amount correlation.

### COVERT policy

Owns fixed economics, onchain expiry, reserve/exposure, claim state, bearer verification, adjudicator decision state and replay protection.

### COVERT anonymizer

Is the single STRK20-facing application identity. It is pinned to one pool, one token and one policy deployment.

### Adjudicator

Decides only whether a committed incident qualifies. It cannot alter tier, expiry or payout. The hackathon prototype therefore proves private settlement and constrained adjudication, not trustless incident truth.

### Browser

Generates and stores a fresh policy bearer key and incident reveal material locally. Loss or compromise of this data can prevent or steal the right to claim; production key custody would need stronger recovery/security design.

## Proof surfaces

`/proof` must be evidence-driven. A property is `VERIFIED` only when backed by an actual mainnet transaction/state read. Until then it remains `PENDING`.

The three scored mainnet transactions are application-native:

- TX-01 private policy purchase;
- TX-02 authenticated claim submission;
- TX-03 private settlement.

TX-00 shield is useful supporting evidence but is not relied upon as one of the three COVERT mechanism proofs.
