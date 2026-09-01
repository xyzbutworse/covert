# Mainnet proof ledger

A row becomes VERIFIED only after its Starknet Mainnet transaction has succeeded
and the observed state or event has been independently inspected. Nothing here is
promoted because a screen looks finished.

**Current status: BLOCKED_BY_EXTERNAL_CREDENTIAL.** No COVERT contract is deployed
on Starknet Mainnet and no mainnet transaction has been executed. This needs a
funded Starknet account and an RPC key; it is not blocked on unfinished code.

For what *has* been executed — the complete lifecycle as 13 real transactions on a
local Starknet node — see [`../EVIDENCE.md`](../EVIDENCE.md) and
`evidence/devnet-lifecycle.json`. That artifact proves COVERT's own contracts. It
proves nothing about the real STRK20 pool, which is represented there by a
stand-in.

## Prerequisites

| Item | Needed for | Present? |
| --- | --- | --- |
| Funded Starknet Mainnet account | ~7 transactions of gas | NO |
| Reserve capital in STRK | Backing issued policies (`RESERVE_WEI`) | NO |
| Mainnet RPC endpoint with signing | Declare, deploy, invoke | NO |
| Separate adjudicator account | Role separation | NO |
| Privacy-capable wallet with STRK20 Wallet API >= 0.10.3 | TX-00 … TX-03 | NO |

Run `cairo/scripts/00-preflight.sh` to check all of these against the live chain
and estimate the cost. It sends no transactions.

## Deployment sequence

```bash
cp cairo/.env.deploy.example cairo/.env.deploy   # fill in; never commit
cairo/scripts/00-preflight.sh     # validate env + funding + addresses, estimate fees
cairo/scripts/00-gates.sh         # typecheck, build, npm test, forge:code, scarb, snforge
cairo/scripts/01-declare.sh       # declare CovertPolicy and CovertAnonymizer
cairo/scripts/02-deploy.sh        # deploy both, constructor args from .env.deploy
cairo/scripts/03-configure.sh     # configure_anonymizer (once), approve, fund_reserve
cairo/scripts/04-readback.sh      # read every value back and compare to expectations
cairo/scripts/05-verify-source.sh # optional explorer source verification
```

Every step confirms interactively before each mainnet transaction. Append
`--dry-run --detailed` to any `sncast` command for an exact fee preview.

`MockToken` and `MockStrk20Pool` are test and devnet infrastructure and must never
be deployed to mainnet.

## Deployment record

| Item | Value | Status |
| --- | --- | --- |
| CovertPolicy class hash | — | BLOCKED |
| CovertAnonymizer class hash | — | BLOCKED |
| CovertPolicy address | — | BLOCKED |
| CovertAnonymizer address | — | BLOCKED |
| `configure_anonymizer` tx | — | BLOCKED |
| `fund_reserve` tx | — | BLOCKED |

## Supporting transaction

| ID | Action | Transaction | Purpose | Status |
| --- | --- | --- | --- | --- |
| TX-00 | Shield STRK into the live STRK20 pool | — | Establish a mature shielded balance. This deposit is public. | BLOCKED |

TX-00 is supporting evidence, not one of the three scored COVERT transactions.

## Scored COVERT transactions

| ID | Action | Transaction | COVERT path | STRK20 primitive | Expected event | Status |
| --- | --- | --- | --- | --- | --- | --- |
| TX-01 | Private policy purchase | — | Pool → Anonymizer → Policy | `withdraw` + `invoke` | `PolicyPurchased`; reserve and exposure updated | BLOCKED |
| TX-02 | Authenticated claim | — | Pool → Anonymizer → Policy | `invoke` (zero value) | `ClaimSubmitted`; bearer signature accepted | BLOCKED |
| TX-03 | Private settlement | — | Pool → Anonymizer → Policy → Anonymizer → Pool | `transfer OPEN` + `invoke` | `ClaimSettled`; replay flag set; note credited | BLOCKED |

## Required adversarial evidence

Rejected transactions are supporting proof and never replace the three successful
scored hashes. Each has already been demonstrated on devnet — the mainnet column
records whether it has been reproduced there.

| Attack / invariant | Expected revert | Devnet | Mainnet |
| --- | --- | --- | --- |
| Settlement before approval | `NOT_APPROVED` | **VERIFIED** (NEG-04) | BLOCKED |
| Second settlement of the same claim | `CLAIMED` | **VERIFIED** (NEG-06) | BLOCKED |
| Second claim on the same policy | `POLICY_HAS_CLAIM` | **VERIFIED** (NEG-03) | BLOCKED |
| Non-adjudicator decides a claim | `NOT_ADJUDICATOR` | **VERIFIED** (NEG-05) | BLOCKED |
| Re-using a policy commitment | `POLICY_EXISTS` | **VERIFIED** (NEG-02) | BLOCKED |
| Re-pointing the anonymizer | `ALREADY_CONFIGURED` | **VERIFIED** (NEG-01) | BLOCKED |
| Wrong bearer signature | `BAD_SIGNATURE` | **VERIFIED** (snforge) | BLOCKED |
| Wrong caller / fake pool | `BAD_POOL` or `NOT_ANON` | **VERIFIED** (snforge) | BLOCKED |
| Claim after expiry | `EXPIRED` | **VERIFIED** (snforge) | BLOCKED |
| Issuance beyond reserve | `INSOLVENT` | **VERIFIED** (snforge) | BLOCKED |
| Withdrawing backed reserve | `NO_SURPLUS` | **VERIFIED** (snforge) | BLOCKED |
| Closing a claim before its deadline | `NOT_STALE` | **VERIFIED** (snforge) | BLOCKED |
| Client-chosen expiry | No such parameter exists | **VERIFIED** (source + test) | n/a |
| Adjudicator-chosen payout | No such parameter exists | **VERIFIED** (source + test) | n/a |

## Evidence packet for every completed mainnet row

1. Exact transaction hash and explorer link.
2. Deployed COVERT contract address(es) touched.
3. STRK20 pool address touched.
4. Exact COVERT event(s) emitted, decoded.
5. Before/after state relevant to the claim — including the public balance delta
   *and the fee*, so the payout claim is not confused with an untouched balance.
6. The privacy property demonstrated, stated narrowly.
7. Output of `npm run verify -- --contract <policy> --policy <commitment>`.

A screenshot or video is secondary evidence. It never substitutes for chain
evidence.

## After mainnet execution

1. Put only real, successful hashes and deployed addresses into `strk20.json`.
2. Run `npm run evidence` to check submission completeness.
3. Run `npm run ledger` to regenerate `EVIDENCE.md` — statuses are derived, so a
   mainnet row only flips once the manifest actually contains the hashes.
4. Run `npm run verify` against the deployed contract to confirm the ordering
   rules hold on mainnet, independently of the frontend.
5. Re-run `cairo/scripts/04-readback.sh` and compare every value.
