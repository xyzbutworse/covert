# COVERT

**Incident cover that pays privately.**

COVERT is fixed-indemnity incident cover for onchain teams. A team can activate cover, file an authenticated incident claim, and receive an approved fixed payout without COVERT publicly linking the protected wallet to the settlement destination.

> **Winner surface:** Public rules. Private beneficiary. Real settlement.

## The product in 10 seconds

1. **Get covered** — activate a fixed coverage tier from a shielded STRK20 balance.
2. **File a claim** — the local policy bearer key authenticates a salted incident commitment.
3. **Get paid** — after adjudication, the fixed payout returns to STRK20 as a private note rather than being sent to the user's public wallet.

The user-facing product stays simple. Underneath it is a deliberately auditable mechanism:

`STRK20 note → COVERT anonymizer → policy engine → authenticated claim → adjudication → COVERT anonymizer → STRK20 open note`

## The moment COVERT is built around

A successful demo must show an observable consequence, not merely a privacy primitive:

- settlement **fails before approval**;
- the adjudicator approves the claim;
- the same settlement action succeeds;
- the policy sends **0 STRK directly to the user's public wallet**;
- the user's STRK20 private balance increases by the fixed payout;
- the beneficiary address is absent from COVERT's public settlement path.

Only after that moment do we explain the STRK20 mechanism that made it possible.

## Privacy boundary

COVERT makes narrow privacy claims.

The initial STRK20 shield/deposit is public. COVERT does **not** claim otherwise. Privacy begins after funds enter the STRK20 pool: the policy contract sees the deployment-pinned COVERT anonymizer rather than the user's normal wallet, and an approved payout is returned to the pool as an `OpenNoteDeposit`.

Timing, amount and low-anonymity-set correlation remain possible. See [`docs/PRIVACY-MODEL.md`](docs/PRIVACY-MODEL.md).

## Mainnet proof tiers

These values are deliberately tiny proof economics for the sprint, not commercial insurance pricing.

| Tier | Premium | Fixed payout | Term |
| --- | ---: | ---: | ---: |
| SIGNAL | 0.01 STRK | 0.05 STRK | 7 days |
| SHIELD | 0.02 STRK | 0.10 STRK | 14 days |
| BLACKOUT | 0.04 STRK | 0.20 STRK | 30 days |

Policy term and payout are derived onchain from the tier. The browser cannot extend a cheap policy or choose a payout amount.

## STRK20 integration

COVERT uses the Starknet Wallet API / `WalletAccountV6` route and a custom `privacy_invoke` anonymizer:

- Wallet Standard discovery and a hard Starknet Mainnet gate;
- Wallet API capability check before private-balance permission;
- `deposit` for the supporting shield transaction;
- note-maturity UX before spending a newly created private note;
- pool fee read from `get_fee_amount` instead of a hardcoded fee;
- `withdraw + invoke` for private policy purchase;
- pool-routed `invoke` for authenticated claim submission;
- `transfer amount: "OPEN" + invoke` for settlement into a new private note.

Wallet placeholders such as `${poolAddress}` and `${openNoteIds[0]}` are literal protocol strings and must not be hex-normalized.

### STRK20 API version and claim-bond decision

- **Wallet API surface:** `starknet@10.4.0` (pinned) with `@starknet-io/types-js@0.10.3`. `WalletAccountV6` routes STRK20 actions through the wallet-standard `starknet:walletApi` feature: `wallet_strk20InvokeTransaction`, `wallet_strk20Balances`, `wallet_strk20PrepareInvoke`. `supportedWalletApi` must report `>= 0.10.3`.
- **Action shapes** (current, verified against `types-js` 0.10.3):
  - `deposit { token, amount }` — public shield.
  - `withdraw { token, amount, recipient }` — funds the anonymizer for purchase.
  - `invoke { contract, calldata }` — calldata items may be felts or the literal placeholders `${poolAddress}` / `${openNoteIds[N]}`.
  - `transfer { token, amount: "OPEN", recipient }` — creates the open note that settlement fills.
- **Invoke-only claim submission is valid — no claim bond is introduced.** The pool's action model groups actions into fixed phases; `InvokeExternal` (the anonymizer invoke) has no effect on the per-token temporary balance, transactions may skip phases, and the only balance rule is that each token's temporary balance ends at exactly zero. A zero-value `invoke` satisfies that trivially. COVERT's authenticated claim therefore stays a pure STRK20 `invoke` (TX-02) instead of routing around STRK20 with a public transaction. Evidence: STRK20-by-Example "Actions, Phases & Proofs" (`InvokeExternal` table row + balance invariant) and the Wallet API `wallet_strk20InvokeTransaction` spec (min 1 action, no value requirement).
- **Fee discovery:** the live pool fee is read from `get_fee_amount` on the mainnet STRK20 pool (`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`, verified by L2BEAT). COVERT never hardcodes or invents a fee; if the read fails the UI shows "Fee unavailable — wallet will quote during execution".
- **Note maturity:** the formally verified pool has no onchain spend-delay ("no frozen-funds states"). COVERT's ~10-block wait after shielding is a UX heuristic so the wallet's discovery service can observe the freshly created note before it is spent.

## Contract security properties

`CovertPolicy` and `CovertAnonymizer` enforce the properties that matter to the proof:

- only the deployment-pinned STRK20 pool can call the anonymizer;
- the anonymizer pins the policy and STRK token;
- the policy can configure its anonymizer only once;
- policy expiry is derived onchain from the selected tier;
- a policy commitment can only be used once;
- claim submission requires a bearer-key signature, so a public commitment cannot be griefed by an observer consuming its claim slot;
- incident commitments are salted in the claimant browser before publication; the verifier recomputes the reveal and locks approval on any mismatch;
- adjudicator and protocol owner are separate roles;
- settlement requires approval plus a second domain-separated bearer signature;
- payout is fixed by tier and cannot be chosen by the adjudicator or frontend;
- claim and policy replay flags prevent double settlement;
- reserve/exposure accounting prevents issuance beyond the configured proof reserve.

See [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) and [`SECURITY.md`](SECURITY.md).

## Architecture

- `src/app/` — product-first Next.js UI: home, cover, claim, verify, reserve and proof.
- `src/lib/covert/actions.ts` — STRK20 and public adjudicator transaction composition.
- `src/lib/covert/key.ts` — local bearer keys, domain-separated signatures, salted incident commitments and verifier-side reveal recomputation.
- `cairo/src/covert_policy.cairo` — fixed-indemnity state, reserve, authentication, adjudication and replay protection.
- `cairo/src/covert_anonymizer.cairo` — pool-only `privacy_invoke` router and `OpenNoteDeposit` return path.
- `docs/` — architecture, privacy model, threat model, mainnet proof ledger and compressed judge demo.
- `strk20.json` — official evidence manifest. It intentionally remains empty until genuine mainnet evidence exists.

## Local development

```bash
npm install
cp .env.example .env.local
npm run typecheck
npm run build
npm run dev
```

Set `NEXT_PUBLIC_PROVIDER_URL` to the Alchemy key/path expected by `src/lib/config.ts`. After mainnet deployment, set the COVERT policy and anonymizer addresses in `.env.local`.

### Cairo

Use Scarb compatible with Cairo 2.18 and a matching Starknet Foundry release:

```bash
cd cairo
scarb build
snforge test
```

**Do not deploy if either command fails.** Test tooling versions must match the `snforge_std` version configured in `Scarb.toml`.

## Mainnet evidence order

The supporting deposit is **TX-00**, not one of the three scored COVERT transactions.

1. **TX-00 — Shield:** deposit enough real STRK into the live STRK20 pool, then wait for the new note to mature.
2. Deploy `CovertPolicy(owner, adjudicator, STRK)` and `CovertAnonymizer(policy, STRK20_POOL, STRK)`; configure the anonymizer once and fund the proof reserve.
3. **TX-01 — Private policy purchase:** STRK20 pool → COVERT anonymizer → COVERT policy; verify `PolicyPurchased`.
4. **TX-02 — Authenticated claim:** STRK20 pool → COVERT anonymizer → COVERT policy; verify `ClaimSubmitted` and bearer authentication.
5. Attempt settlement before approval and preserve the rejection as adversarial proof.
6. Approve from the configured adjudicator account.
7. **TX-03 — Private settlement:** STRK20 pool → anonymizer → policy → anonymizer → `OpenNoteDeposit`; verify `ClaimSettled` and the private balance delta.
8. Put only real successful hashes and deployed addresses into `strk20.json` and `docs/MAINNET-PROOF.md`.
9. Run `npm run evidence` and `npm run forge:code` before recording the final demo.

## Evidence standard

COVERT never ships fabricated transaction hashes, contract addresses, demo URLs or green completion states. Missing proof stays visibly `PENDING` until the corresponding onchain evidence exists.

## License

MIT.
