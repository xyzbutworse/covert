# COVERT — Starknet Mainnet deployment runbook

Reproducible, secret-safe deployment of `CovertPolicy` and `CovertAnonymizer`.
No private key is ever stored in this repository. All signing happens through an
encrypted keystore (or Ledger) referenced only by path from `cairo/.env.deploy`.

**Do not deploy unless every gate in [Gate 0](#gate-0-required-checks) is green.**

## Mainnet constants (independently verified)

| Constant | Address | Verification |
| --- | --- | --- |
| STRK token | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | Voyager "Official STRK token" / StarkGate; `starknet-io/starknet-addresses` bridged_tokens |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` | L2BEAT STRK-20 entry; Voyager contract page |

`scripts/deploy-common.sh` re-checks the STRK token `symbol()` and the pool
`get_fee_amount()` against the live chain before any transaction is signed.

## Toolchain

- Scarb `2.18.0` (`.tool-versions`)
- Starknet Foundry `0.63.0` (`snforge`, `sncast`)
- `starknet@10.4.0` for the frontend; `starknet.js` is also used offline to
  compute the exact class hashes from the build artifacts.

## Roles

- `owner` — configures the anonymizer once and funds the reserve. Use the deployer account, or a dedicated control account.
- `adjudicator` — approve/deny claims only. Cannot set tier, expiry, payout, or touch the reserve.

## Reproduce from a clean checkout

```bash
git clone <repo> && cd <repo>
# Toolchain via asdf (see .tool-versions)
asdf install
# Frontend deps + gates
npm ci --no-audit --no-fund
npm run typecheck
npm run build
npm run forge:code
# Cairo gates
cd cairo
scarb build
snforge test
```

### Gate 0: required checks (must all be green)

```bash
cairo/scripts/00-gates.sh
```

Expected green: `typecheck`, `build`, `forge:code`, `scarb build`, `snforge test` (59 tests).

## Account setup (once, secret-safe)

Option A — encrypted keystore (recommended):

```bash
# Prompts for the private key and a password; the key is never written to disk in clear.
starkli signer keystore from-key ~/.covert/deployer.keystore
# Fetch the account JSON (address + public key only, no secret).
starkli account fetch <DEPLOYER_ADDRESS> --output ~/.covert/deployer_account.json --rpc <MAINNET_RPC>
```

Option B — Ledger hardware wallet:

```bash
sncast account create --name covert-deployer --ledger-account-id 0 --url <MAINNET_RPC>
```

## Configuration

```bash
cp cairo/.env.deploy.example cairo/.env.deploy
# Fill: MAINNET_RPC_URL, DEPLOY_KEYSTORE, DEPLOY_ACCOUNT_FILE (or DEPLOY_ACCOUNT_NAME),
# OWNER_ADDRESS, ADJUDICATOR_ADDRESS, RESERVE_WEI (default 1 STRK).
# .env.deploy is gitignored.
```

## Steps (each signs a real mainnet transaction)

### Step 1 — Declare

```bash
cairo/scripts/01-declare.sh
```

Two `DECLARE` transactions. After each confirmation, copy the class hash and tx
hash into `cairo/.env.deploy` and the log. Dry-run fee preview (sends nothing):

```bash
cd cairo
sncast --url $MAINNET_RPC_URL --keystore ~/.covert/deployer.keystore --account ~/.covert/deployer_account.json \
  declare --contract-name CovertPolicy --dry-run --detailed
```

Offline class hashes (recompute from the exact build before declaring):

- `CovertPolicy` sierra class hash: `0x18b68b6b3dfeb7f836ce404f6dc7a4921808faffb9c81cac73672ec2f62dd3`
- `CovertAnonymizer` sierra class hash: `0x7fc2600c5d4763acdb7711454c633e7ae97e730d9908b86b13442c0ca6fb5e8`

> These hashes correspond to the current `cairo/src` exactly. Any source change
> invalidates them; recompute with `scripts/class-hashes.mjs` (offline) before declaring.

### Step 2 — Deploy

```bash
cairo/scripts/02-deploy.sh
```

- `CovertPolicy(owner, adjudicator, STRK)`
- `CovertAnonymizer(policy_address, STRK20_POOL, STRK)`

Record both contract addresses and deploy tx hashes.

### Step 3 — Configure, lock, fund

```bash
cairo/scripts/03-configure.sh
```

1. `configure_anonymizer(anonymizer)` once, as owner. Expected state transition:
   `anonymizer_configured: false → true`, `anonymizer: 0 → ANON_ADDRESS`, emits `AnonymizerConfigured`.
2. Lock proof: a dry-run of a second `configure_anonymizer` call must revert
   `ALREADY_CONFIGURED`. The script does not broadcast this rejected call.
3. `STRK.approve(policy, RESERVE_WEI)` from owner.
4. `fund_reserve(RESERVE_WEI)` from owner. Expected state:
   `reserve_amount: 0 → RESERVE_WEI`, emits `ReserveFunded`.

### Step 4 — Read back onchain state

```bash
cairo/scripts/04-readback.sh
```

Reads and compares: `owner`, `adjudicator`, `anonymizer`, `token`, `reserve`,
`exposure` (must be `0`), and `invoke_count` (must be `0`).

### Step 5 — Explorer source verification (optional, never faked)

```bash
cairo/scripts/05-verify-source.sh
```

Uses `sncast verify --verifier voyager --network mainnet`. If the explorer's
verification service is unavailable or rejects, the step is skipped and the
recorded class hashes remain the reproducible source proof. Do not claim
"verified" on the explorer unless the explorer actually reports it.

## Deployment log template

Copy into `docs/` after deployment. Every field must be a real value from the live chain.

```text
# COVERT mainnet deployment log

Network:             Starknet Mainnet
RPC:                 <provider and endpoint used>
Compiler version:    cairo: 2.18.0 (scarb)
Scarb version:       2.18.0
Foundry version:     0.63.0
STRK token:          0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
STRK20 pool:         0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
Owner:               <0x...>
Adjudicator:         <0x...>

CovertPolicy
  class hash:        <0x...>
  declare tx:        <0x...>
  address:           <0x...>
  deploy tx:         <0x...>

CovertAnonymizer
  class hash:        <0x...>
  declare tx:        <0x...>
  address:           <0x...>
  deploy tx:         <0x...>

configure_anonymizer
  tx:                <0x...>
  lock proof (revert): <expected ALREADY_CONFIGURED, tx/hash or observation>

STRK approve (owner -> policy, RESERVE_WEI)
  tx:                <0x...>

fund_reserve (RESERVE_WEI)
  tx:                <0x...>
  reserve amount:    <wei>

Readback (must match expected):
  owner=...  adjudicator=...  anonymizer=...  token=...  reserve=...  exposure=0  invoke_count=0

Timestamp:           <UTC ISO 8601>
Git commit:          <commit SHA of the deployed sources>
Frontend env:        NEXT_PUBLIC_COVERT_POLICY_ADDRESS=<policy>
                     NEXT_PUBLIC_COVERT_ANONYMIZER_ADDRESS=<anonymizer>
Explorer verification: <verified | unverified (class hashes are the proof)>
```

## One-way trust graph

```text
CovertPolicy(owner, adjudicator, STRK)
          ↓ address
CovertAnonymizer(policy, STRK20_POOL, STRK)
          ↓ address
CovertPolicy.configure_anonymizer(anonymizer)   [ONE TIME — cannot be replaced]
```

## Evidence rule

Never insert a contract address into `strk20.json` before it exists on Starknet
Mainnet, and never insert a transaction hash before the transaction is
successful and inspectable. TX-00 shield is supporting evidence; the three
scored hashes are COVERT-native TX-01 purchase, TX-02 claim, TX-03 settlement.
