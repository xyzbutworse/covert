# COVERT threat model

| Attack / failure mode | Control | Residual risk |
| --- | --- | --- |
| Direct anonymizer call | `get_caller_address()` and substituted `pool_address` must both equal deployment-pinned STRK20 pool | Wrong pool configured at deployment remains catastrophic; verify before configure. |
| Fake token/policy | Anonymizer pins token and policy addresses and checks calldata against storage | Deployment/configuration error remains possible. |
| Fake policy purchase | Policy accepts purchase only from the one-time configured anonymizer | A compromised configured anonymizer would be trusted by policy. |
| Premium under/overpayment | Tier derives exact premium; policy checks exact `paid_amount`; anonymizer forwards fixed premium | Direct token dust sent to anonymizer can complicate its balance assumptions. |
| Client extends cheap coverage | Purchase ABI has no expiry parameter; contract derives term from tier + block timestamp | Timestamp semantics are Starknet block semantics. |
| Arbitrary payout | Payout is derived from tier in policy and never supplied by frontend/adjudicator | Proof tiers are not actuarial pricing. |
| Over-insurance / reserve exhaustion | New exposure is checked against reserve plus incoming premium; payout also checks current reserve | Simplified proof reserve is not a production capital model. |
| Public policy-commitment griefing | Claim submission verifies bearer signature before setting `policy_has_claim` | Bearer private-key compromise still permits a malicious valid claim submission. |
| Claim substitution / fake reveal | Claim signature binds policy, claim and salted incident hash; verifier recomputes incident + claim commitments and cross-checks onchain state before enabling approval | The verifier packet itself must be transferred through an appropriately private out-of-band channel. |
| Dictionary-guess incident text | Random salt is mixed into incident hash | Weak RNG or leaked salt/plaintext defeats this protection. |
| Fake/unauthorized adjudication | Separate adjudicator role; owner and adjudicator are distinct constructor parameters | Adjudicator compromise can approve invalid pending claims. |
| Adjudicator changes payout | Decision ABI contains no payout input; fixed tier controls amount | Adjudicator still controls binary validity decision. |
| Claim before approval | Redemption requires `DECISION_APPROVED` | None beyond adjudicator trust. |
| Signature cross-action replay | Separate `COVERT_CLAIM_V1` and `COVERT_REDEEM_V1` Poseidon domains | Domain constants must stay consistent between TS and Cairo. |
| Double settlement | `claim_redeemed`, `policy_claimed` and inactive policy state are written before external payout transfer | Starknet transaction atomicity is assumed. |
| Second claim | `policy_has_claim` permanently consumes the policy's claim slot after authenticated submission | Prototype intentionally supports one claim per policy. |
| Expired unused policy keeps exposure locked | Anyone may call `expire_policy` after expiry if no claim exists; exposure released | Submitted pending claims intentionally prevent expiry until decision. |
| Denied claim keeps exposure locked | Denial releases exposure and deactivates policy | A malicious adjudicator can deny legitimate claims. |
| Wrong pool/token at return path | Anonymizer pins pool/token and approves exactly fixed payout | Direct token transfers can strand dust. |
| Public-wallet payout accidentally reveals beneficiary | Policy pays only configured anonymizer; anonymizer returns an `OpenNoteDeposit` to pool | Timing/amount correlation can still suggest relationships. |
| “Private” overclaim | Privacy boundary explicitly states public deposit, events, timing/amount leakage and correlation risk | Users may still misunderstand privacy without reading disclosure. |
| Note spent too early | UI surfaces ~10-block maturity after a fresh shield | RPC block-height lag or wallet-specific behavior can still require retry. |
| Hidden pool fee | UI queries `get_fee_amount`; unknown fee is shown as unavailable, not guessed | Pool interface may change; inability to read fee must block confident cost quotes. |
| Wrong network | Wallet chain ID must be Starknet Mainnet before `WalletAccountV6` is constructed | Wallet/provider bugs remain external dependency. |
| Private-balance permission surprise | Capability detection happens before balance request | Wallet implementations may differ. |
| Frontend fabricates proof | `/proof` reads `strk20.json`; missing hashes stay pending; evidence validator rejects incomplete manifest | A malicious fork can still alter UI; judges should inspect chain links. |
| Browser bearer-key theft/loss | Fresh per-policy key limits blast radius | LocalStorage is not production-grade secure custody/recovery. |

## P0 invariants before mainnet

The following must have executable tests and a successful `scarb build` before deployment:

- non-bearer cannot submit a claim;
- client cannot choose expiry;
- non-adjudicator cannot approve/deny;
- settlement before approval fails;
- bad settlement signature fails;
- replay fails;
- wrong pool/anonymizer fails;
- reserve/exposure accounting remains coherent through buy, deny, expire and settle;
- valid happy path returns exactly the fixed payout.
