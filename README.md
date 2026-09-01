# COVERT

**Get paid for an incident without publishing who got paid.**

COVERT is fixed-payout incident cover for onchain teams on Starknet. You activate
a policy, file a claim when something breaks, and receive the approved payout into
your private STRK20 balance — instead of a public transfer that ties your treasury
to the settlement.

The rules stay public. The beneficiary does not.

---

## The problem

Onchain insurance has an unavoidable tell: the payout. Anyone watching can see
which address received a claim settlement, and from that infer that the address
suffered a loss, what kind, and roughly when. For a treasury or a protocol
operator, filing a claim means publishing an incident report.

Making the *rules* private is the wrong fix — nobody should buy cover from a
protocol whose solvency they cannot check. COVERT keeps every rule public and
removes the beneficiary from the settlement path instead.

## The user's workflow

1. **Shield** — deposit STRK into the STRK20 privacy pool. This step is public and
   COVERT never pretends otherwise.
2. **Activate cover** — choose a fixed tier. Your browser mints a bearer key; the
   contract registers its *public* half. No address is attached to the policy.
3. **Something breaks** — file a claim. The incident description stays offchain;
   only a salted commitment is published, signed by your bearer key.
4. **Adjudication** — you send the reveal privately. The adjudicator recomputes
   its commitments, checks them against the onchain claim, and approves or denies.
   They cannot change what it pays.
5. **Settle** — the fixed payout returns to your STRK20 balance as a note. Before
   approval, the contract refuses to pay at all.

## The moment the product is built around

```
BEFORE      Settlement attempted        →  refused onchain: NOT_APPROVED
WHY         redeem_claim requires claim_decision == APPROVED
INTERVENE   Adjudicator approves the claim
AFTER       The identical action        →  succeeds
RESULT      Public wallet payout: 0 STRK.  Private balance: +fixed payout.
```

COVERT does not disable the settlement button before approval. You can press it,
and the contract refuses. A UI that refuses to try cannot demonstrate that the
protocol refuses.

This has been executed as real transactions — see [Evidence](#evidence).

## Privacy model — stated narrowly

**Public:** your first deposit; that your wallet touches the pool; policy terms,
premium, payout, expiry; reserve and exposure; the salted claim commitment; every
timestamp; the gas you pay.

**Not published:** which wallet controls which policy; what the incident was; a
beneficiary address — there isn't one in the payout path.

**Your public balance is not unchanged.** You pay the settlement transaction's
gas from your public address. The claim is that the *payout* never arrives there,
evidenced by the direction of the transfers inside the settlement transaction.

**Correlation still works.** Three fixed amounts, a small anonymity set and
visible timing make linkage plausible for a determined observer. COVERT breaks a
specific structural link. It is not anonymity.

Full detail: [docs/PRIVACY-MODEL.md](docs/PRIVACY-MODEL.md), [LIMITATIONS.md](LIMITATIONS.md).

## Trust model

| Party | Can | Cannot |
| --- | --- | --- |
| Policyholder | Buy cover, file one claim, draw an approved payout | Choose the payout, extend the term, settle without approval, claim twice |
| Adjudicator | Approve or deny once | Change the payout, touch the reserve, act as owner |
| Owner | Configure the anonymizer once, fund the reserve, withdraw only unbacked reserve | Decide claims, take capital backing a live policy |
| Anyone | Expire lapsed policies, close a claim abandoned past its 72h deadline | Anything needing a bearer signature or a role |

Details and the full invariant list: [SECURITY.md](SECURITY.md).

## Architecture

```
STRK20 pool  ──privacy_invoke──▶  CovertAnonymizer  ──buy/claim/redeem──▶  CovertPolicy
 (pinned)                          (pins pool,                              (terms, reserve,
                                    policy, token)                           adjudication,
                                                                             replay flags)
```

The frontend is event-sourced: every screen reads one append-any-only lifecycle
log, so a policy created in Cover *is* the object Claim, Verify, Reserve, Proof
and History operate on. See [ARCHITECTURE.md](ARCHITECTURE.md).

| Path | What |
| --- | --- |
| `cairo/src/covert_policy.cairo` | Terms, reserve, exposure, bearer auth, adjudication, replay protection |
| `cairo/src/covert_anonymizer.cairo` | Pool-pinned router and `OpenNoteDeposit` return path |
| `src/lib/domain/` | State machines, event projection, reserve accounting, failure mapping |
| `src/lib/covert/operations.ts` | The only layer allowed to change state |
| `src/lib/chain/read.ts` | Chain reads with RPC failover and event reconstruction |
| `src/app/` | Home, Cover, Policy, Claim, Verify, Reserve, History, Proof, Replay |
| `scripts/` | Lifecycle runner, independent verifier, claim-ledger generator |

## Tier economics

Deliberately tiny proof amounts, not commercial pricing.

| Tier | Premium | Fixed payout | Term |
| --- | ---: | ---: | ---: |
| SIGNAL | 0.01 STRK | 0.05 STRK | 7 days |
| SHIELD | 0.02 STRK | 0.10 STRK | 14 days |
| BLACKOUT | 0.04 STRK | 0.20 STRK | 30 days |

Derived onchain from the tier byte. The browser cannot extend a cheap policy or
choose a payout — there is no parameter for either. `tests/domain/economics.test.ts`
parses the Cairo source and fails if the client's table ever drifts from it.

## STRK20 integration

Starknet Wallet API via `WalletAccountV6` (`starknet@10.4.0`,
`@starknet-io/types-js@0.10.3`), gated on `supportedWalletApi >= 0.10.3`:

| Step | STRK20 actions |
| --- | --- |
| Shield | `deposit { token, amount }` |
| Activate cover | `withdraw → anonymizer` + `invoke` |
| File claim | `invoke` (zero-value) |
| Settle | `transfer { amount: "OPEN" }` + `invoke` |

`${poolAddress}` and `${openNoteIds[0]}` are literal protocol placeholders the
wallet substitutes; they are never hex-normalised.

**No claim bond.** The pool's balance rule requires each token's temporary balance
to end at zero, which a zero-value `invoke` satisfies trivially. The authenticated
claim therefore stays a pure STRK20 action rather than routing around the pool
with a public transaction.

**Fees are read, never guessed.** The live pool fee comes from `get_fee_amount`.
If that read fails the UI says "Unavailable — your wallet quotes it at signing".

## Contract addresses

| Network | Policy | Anonymizer | Status |
| --- | --- | --- | --- |
| Starknet Mainnet | — | — | **BLOCKED_BY_EXTERNAL_CREDENTIAL** |

No mainnet deployment exists. This is blocked on a funded account and an RPC
credential, not on unfinished code — see [Deployment](#deployment) and
[LIMITATIONS.md](LIMITATIONS.md). The app reports `NOT_DEPLOYED` on every surface
rather than showing an address that does not exist.

The STRK20 mainnet pool (`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`)
and STRK (`0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`)
are pinned in `src/lib/config.ts`.

## Evidence

The complete lifecycle has been executed as **13 real transactions** against a
real Starknet node, with all 12 assertions holding.

| Claim | Status |
| --- | --- |
| Contracts compile; every stated invariant is tested | **VERIFIED** — 59 snforge tests |
| Full lifecycle executes as real transactions | **VERIFIED** — `evidence/devnet-lifecycle.json` |
| Settlement refused before approval with `NOT_APPROVED` | **VERIFIED** |
| The identical action succeeds after approval | **VERIFIED** |
| Payout never reaches the public address | **VERIFIED** |
| Reserve and exposure reconcile exactly | **VERIFIED** |
| Deployed on Starknet Mainnet | **BLOCKED** |
| Full lifecycle on mainnet through the real pool | **BLOCKED** |

Full ledger with evidence and reproduction commands per row: [EVIDENCE.md](EVIDENCE.md)
(generated — never hand-edited) and the `/proof` surface.

**The devnet run does not prove STRK20's privacy.** On devnet the pool is
`MockStrk20Pool`, which reproduces the pool's calling pattern and none of its
cryptography. What it proves is that COVERT's own contracts behave correctly under
real execution.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Without a deployment configured the app runs and every surface reports
`NOT_DEPLOYED`, pointing at `/replay` for the recorded lifecycle.

### Contracts

```bash
cd cairo
scarb build
snforge test          # 59 passed
```

Requires Scarb 2.18.0 and Starknet Foundry 0.63.0 (see `.tool-versions`).
**Do not deploy if either command fails.**

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Domain unit tests (66) |
| `npm run test:e2e` | Playwright browser lifecycle (17 × 2 viewports) |
| `npm run forge:code` | Static control tripwire (44 controls) |
| `npm run lifecycle` | Execute the full lifecycle on a local devnet |
| `npm run verify -- --artifact evidence/devnet-lifecycle.json` | Independent verification from chain events |
| `npm run ledger` | Regenerate the claim ledger and `EVIDENCE.md` |
| `npm run evidence` | Check `strk20.json` submission completeness |
| `cd cairo && snforge test` | Contract invariants |

### Verification

```bash
# Rebuild the artifact from scratch
starknet-devnet --seed 42 --accounts 5 --port 5050
npm run lifecycle

# Verify it without trusting the frontend or the runner
npm run verify -- --artifact evidence/devnet-lifecycle.json

# Or verify any deployed policy from chain events alone
npm run verify -- --contract 0x... --policy 0x... --rpc https://...
```

The verifier reads Starknet events directly and re-derives the ordering rules
itself — including that approval preceded settlement — reading no browser state.

## Deployment

Mainnet deployment is **BLOCKED_BY_EXTERNAL_CREDENTIAL**: it needs a funded
Starknet account and an RPC key. Everything else is ready.

```bash
cp cairo/.env.deploy.example cairo/.env.deploy   # fill in; never commit
cairo/scripts/00-preflight.sh    # validate env, check funding, estimate cost — sends nothing
cairo/scripts/00-gates.sh        # typecheck, build, tests, contract tests — all must pass
cairo/scripts/01-declare.sh      # declare both classes
cairo/scripts/02-deploy.sh       # deploy both contracts
cairo/scripts/03-configure.sh    # configure anonymizer (once), fund reserve
cairo/scripts/04-readback.sh     # read every value back and compare
cairo/scripts/05-verify-source.sh # optional explorer source verification
```

Requirements: ~7 transactions of gas, plus the reserve capital you choose to lock
(`RESERVE_WEI`). Each script confirms interactively before every mainnet
transaction and supports `--dry-run --detailed` for fee preview.

Afterwards set `NEXT_PUBLIC_COVERT_POLICY_ADDRESS` and
`NEXT_PUBLIC_COVERT_ANONYMIZER_ADDRESS`, then follow
[docs/MAINNET-PROOF.md](docs/MAINNET-PROOF.md) in order.

No private key appears in this repository, in any script output, or in the
frontend bundle. `MockToken` and `MockStrk20Pool` are test infrastructure and must
never be deployed to mainnet.

## Evidence standard

COVERT never ships a fabricated transaction hash, contract address, balance or
verification result. Missing proof stays visibly `PENDING` or `BLOCKED`. Statuses
in the claim ledger are derived from artifacts by a script, so a screen looking
finished cannot promote a claim to verified.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — how it fits together
- [SECURITY.md](SECURITY.md) — trust model and enforced invariants
- [LIMITATIONS.md](LIMITATIONS.md) — what it does not do and cannot yet prove
- [EVIDENCE.md](EVIDENCE.md) — the generated claim ledger
- [DEMO.md](DEMO.md) — exact clicks and expected states
- [docs/PRIVACY-MODEL.md](docs/PRIVACY-MODEL.md), [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md), [docs/MAINNET-PROOF.md](docs/MAINNET-PROOF.md)

## License

MIT.
