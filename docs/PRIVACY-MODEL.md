# Privacy model

COVERT makes narrow, testable privacy claims. It does not use “private” to mean “nothing is observable.”

## Public by design

- the initial STRK20 shield/deposit transaction, depositor and amount;
- COVERT and STRK20 contract addresses and public call traces;
- fixed proof-tier economics;
- policy commitment, tier, expiry and one-time bearer public key;
- claim commitment and salted incident hash;
- adjudicator decision state;
- reserve and outstanding exposure;
- timing and application-side amounts that are externally visible;
- COVERT events needed for auditability.

## Not directly linked by COVERT after entering STRK20

- the normal wallet identity that spends a mature private note into COVERT;
- a normal public-wallet field on the policy itself;
- a public beneficiary address in `ClaimSettled`;
- a direct `CovertPolicy → user's normal wallet` payout transfer;
- the final payout as a public balance credit to the user's normal wallet; settlement is returned through the STRK20 open-note path.

The STRK20 wallet owns private note discovery and balance state; COVERT does not handle the viewing key.

## What COVERT does not promise

COVERT does not promise perfect anonymity. A watcher can still use timing, unusual amounts, a small anonymity set, external identity information and wallet behavior to form probabilistic correlations.

The proof tiers use repeated fixed amounts partly to avoid a unique arbitrary claim amount becoming a fingerprint, but fixed tiers do not remove correlation risk.

## Bearer authentication

A fresh Stark-curve bearer key is generated locally for each policy. The public key is stored with the opaque policy commitment; the normal Starknet wallet address is not.

Two domain-separated messages are signed:

1. **Claim submission:** `(CLAIM_DOMAIN, policy commitment, claim commitment, incident hash)` — prevents an observer who sees a policy commitment from consuming its one-claim slot.
2. **Settlement:** `(REDEEM_DOMAIN, policy commitment, claim commitment, fixed payout)` — proves the same bearer authorizes redemption and prevents a claim signature being replayed as a settlement signature.

## Incident commitment

The browser normalizes the incident description, hashes it, combines it with a fresh random salt using Poseidon, then derives the claim commitment from the policy commitment and salted incident hash.

The salt and plaintext are kept in the local reveal package for the verifier. Salting prevents trivial dictionary matching of common incident descriptions; it does not make weak or leaked reveal material safe.

## Key custody

The hackathon prototype stores bearer/reveal material in browser local storage to keep the mechanism inspectable and dependency-light. That is a prototype tradeoff, not a production custody design. Clearing browser storage or compromise of the device can destroy or expose claim authority.
