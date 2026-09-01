# Architecture

## The shape of the thing

COVERT is a fixed-indemnity insurance protocol with one unusual property: the
policyholder's public address never appears in the settlement path. Everything
else — pricing, terms, solvency, adjudication — is deliberately public.

```
                        ┌──────────────────────────────┐
   public deposit ─────▶│      STRK20 privacy pool     │
   (visible)            │  (pinned at deployment)      │
                        └───────────┬──────────────────┘
                                    │ privacy_invoke
                                    ▼
                        ┌──────────────────────────────┐
                        │      CovertAnonymizer        │
                        │  pins pool + policy + token  │
                        └───────────┬──────────────────┘
                                    │ buy / claim / redeem
                                    ▼
                        ┌──────────────────────────────┐
                        │        CovertPolicy          │
                        │  terms, reserve, exposure,   │
                        │  bearer auth, adjudication,  │
                        │  replay protection           │
                        └──────────────────────────────┘
```

The policy contract only ever sees the anonymizer. The anonymizer only ever
accepts the pool. So a policy has no address attached to it — only a public key
whose private half lives in a browser.

## Layers

### 1. Contracts (`cairo/src/`)

| Contract | Role |
| --- | --- |
| `covert_policy.cairo` | The protocol. Owns terms, reserve, exposure, claim state, adjudication, replay flags. |
| `covert_anonymizer.cairo` | A pinning layer. Accepts calls only from the deployment-pinned pool, routes only to the pinned policy, moves only the pinned token. |
| `mock_token.cairo` | Test infrastructure. Never deployed to mainnet. |
| `mock_strk20_pool.cairo` | Test and devnet infrastructure. Reproduces the pool's *calling pattern* so the full route can be executed locally. Reproduces none of its privacy construction. Never deployed to mainnet. |

The policy contract holds every invariant that matters. The frontend re-checks
some of them to give better errors, but nothing depends on the frontend
checking anything.

### 2. Chain access (`src/lib/chain/read.ts`)

All reads go through one module with endpoint failover: each configured RPC is
tried in turn, and `RPC_UNAVAILABLE` is only raised when every one has failed. A
contract revert is treated as an *answer* and stops the retry loop — retrying a
revert against another node just wastes time and confuses the error.

`fetchCovertEvents` is the independent reconstruction path: given only a contract
address it rebuilds a policy's history from Starknet events, reading no browser
state. `scripts/verify-lifecycle.mjs` runs the same query from Node.

### 3. Domain model (`src/lib/domain/`)

One vocabulary shared by every surface.

| Module | Responsibility |
| --- | --- |
| `types.ts` | `Policy`, `Claim`, `LifecycleEvent`, `RevealPacket`, `PolicySecret`, `ReserveAccount`. |
| `machine.ts` | Explicit state machines. Illegal transitions are refused, not written. |
| `projection.ts` | Folds the event log into entities and reserve accounting. |
| `errors.ts` | Maps every possible failure to a named invariant with a recovery path. |
| `economics.ts` | The client's mirror of the contract's tier constants, guarded by a test that parses the Cairo source. |
| `persistence.ts` | Three separated storage tiers (below). |
| `store.ts` | The zustand store every screen reads. |
| `ids.ts` | Deterministic human references derived from commitments. |

**The event log is the source of truth.** Nothing writes a `Policy` directly;
screens dispatch events and read a projection. This is why History, Proof and
reload-recovery need no special code — they are all views of the same log.

```
LifecycleEvent[]  ──project()──▶  { policies, claims, reserveObservations }
       ▲                                        │
       │ append()                               │ read
       │                                        ▼
  operations.ts  ◀──────────────────────  every screen
```

### 4. Operations (`src/lib/covert/operations.ts`)

The only layer allowed to change state. Every operation:

1. refuses to start if an identical action is already in flight;
2. records intent before the transaction leaves;
3. resolves the transaction's **real** outcome — a hash is not success, and an
   included-but-reverted transaction is a failure;
4. records the result, including failures, which are evidence rather than noise;
5. reconciles against chain state.

### 5. Surfaces (`src/app/`)

| Route | Purpose |
| --- | --- |
| `/` | The outcome, then the mechanism. |
| `/cover` | Shield funds, choose a tier, activate. |
| `/policy/[id]` | The persistent policy: facts, claim, settlement, adversarial evidence, full timeline. |
| `/claim` | File an authenticated claim against an eligible policy. |
| `/verify` | Adjudicator: import a reveal, recompute it, cross-check the chain, approve or deny. |
| `/reserve` | Contract solvency (chain) and this browser's portfolio (local), labelled separately. |
| `/history` | Every policy, every state, every timeline; plus what custody material this browser holds. |
| `/proof` | The claim ledger: every claim with its status, evidence and reproduction command. |
| `/replay` | A recorded real execution, permanently labelled as a replay. |

## Storage tiers

Three separate keys, because the security properties differ and hiding that
behind one blob would be dishonest.

| Tier | Key | Contents | If it leaks | If it is lost |
| --- | --- | --- | --- | --- |
| Public | `covert.ledger.v1` | Lifecycle events | Nothing private; all of it is chain-reconstructable | History only; rebuildable from chain |
| Private | `covert.reveals.v1` | Incident text and salts | Reveals what claims were about | The adjudicator cannot verify a reveal |
| **Custody** | `covert.secrets.v1` | **Policy bearer private keys** | **Whoever holds one controls that policy** | **The policy is permanently unclaimable** |

`/history` shows exactly how many of each this browser holds and offers to erase
them, stating the consequence first. See [SECURITY.md](SECURITY.md).

## LIVE vs REPLAY

Captured artifacts carry their own `kind` (`DEVNET_EXECUTION` /
`MAINNET_EXECUTION`) and are read only by `/replay`. No live surface imports
them. `LifecycleEvent.source` (`local` / `chain` / `replay`) travels with every
record, and timelines render it, so "the chain told us" and "this browser
recorded it" never look the same.

## The one invariant everything rests on

```cairo
assert(self.claim_decision.read(claim_commitment) == DECISION_APPROVED, errors::NOT_APPROVED);
```

`CovertPolicy::redeem_claim` will not move a single wei before the adjudicator
approves. The product demonstrates this by *offering* settlement before approval
rather than disabling the button — a UI that refuses to try cannot show that the
contract refuses.

## Verification chain

```
cairo/src/*.cairo          ── snforge test ──────────▶  59 contract invariants
        │
        ├── scripts/devnet/run-lifecycle.mjs ────────▶  evidence/devnet-lifecycle.json
        │                                                (13 real transactions)
        │                                                        │
        │                                                        ├─▶ /replay renders it
        │                                                        └─▶ scripts/verify-lifecycle.mjs
        │                                                             re-derives it from chain events
        │
        └── scripts/build-claim-ledger.mjs ──────────▶  evidence/claim-ledger.json + EVIDENCE.md
                                                         (statuses derived, never typed)
```

`src/lib/domain/**` is covered by `npm test`; the browser lifecycle by
`npm run test:e2e`; the controls that no build failure would catch by
`npm run forge:code`.
