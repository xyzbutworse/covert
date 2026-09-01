# Security

## Reporting

Open a GitHub issue for anything non-sensitive. For a vulnerability that could
move funds or deanonymise a policyholder, contact the maintainer privately
first. COVERT is unaudited software handling small proof-sized amounts; treat it
accordingly.

## Trust model

| Party | What they can do | What they cannot do |
| --- | --- | --- |
| **Policyholder** | Hold a bearer key, buy cover, file one claim per policy, draw an approved payout | Choose the payout, extend the term, settle without approval, claim twice |
| **Adjudicator** | Approve or deny a submitted claim, once | Change the payout, touch the reserve, create or expire policies, act as owner |
| **Owner** | Configure the anonymizer once, fund the reserve, withdraw reserve that backs nothing | Decide claims, take capital backing a live policy, alter terms |
| **Anyone** | Expire a lapsed policy, close a claim abandoned past its deadline, read all public state | Anything requiring a bearer signature or a role |
| **STRK20 pool** | Drive `privacy_invoke` on the anonymizer | Reach the policy contract by any other path |

No party can mint a policy, alter economics, or redirect a payout.

## Contract-enforced invariants

Every one of these is enforced in Cairo and covered by `snforge test`. The
frontend re-checks several of them to give better errors; nothing depends on it
doing so.

**Authorisation**

- `buy_policy`, `submit_claim`, `redeem_claim` accept only the configured
  anonymizer (`NOT_ANON`).
- The anonymizer accepts only the deployment-pinned pool, as both caller and
  argument (`BAD_POOL`), routes only to the pinned policy (`BAD_POLICY`), and
  moves only the pinned token (`BAD_TOKEN`).
- `approve_claim` / `deny_claim` are adjudicator-only (`NOT_ADJUDICATOR`).
- `fund_reserve` / `withdraw_surplus` / `configure_anonymizer` are owner-only
  (`NOT_OWNER`).
- The anonymizer can be configured exactly once (`ALREADY_CONFIGURED`).

**Authentication**

- Claim submission and settlement each require a Stark-curve signature from the
  policy's registered bearer key (`BAD_SIGNATURE`).
- Signatures are domain-separated (`COVERT_CLAIM_V1` / `COVERT_REDEEM_V1`), so a
  claim signature cannot be replayed as a settlement authorisation.
- `r` and `s` must be in canonical range with `s <= ORDER/2`, rejecting malleable
  high-s variants.
- The claim commitment must equal `poseidon(policy_commitment, incident_hash)`
  (`BAD_COMMITMENT`), so an arbitrary handle cannot be filed against a policy.

**Economics**

- Premium, payout and term are derived from the tier byte. There is no parameter
  for any of them in any entrypoint.
- Expiry is `get_block_timestamp() + term`, computed onchain.
- Issuance is refused when it would push exposure past the reserve (`INSOLVENT`).
- The anonymizer asserts it holds *exactly* the premium before purchase and
  *exactly* the payout before returning a note (`BAD_INPUT_AMOUNT`), so the route
  cannot be subsidised or short-funded.
- `withdraw_surplus` is bounded by `reserve - exposure`, so capital backing a
  live policy cannot be removed (`NO_SURPLUS`).

**Replay and duplication**

- One policy per commitment (`POLICY_EXISTS`).
- One claim per policy (`POLICY_HAS_CLAIM`), one decision per claim (`DECIDED`),
  one settlement per claim (`CLAIMED`).
- Settlement requires `decision == APPROVED` (`NOT_APPROVED`).

**Liveness**

- A claim left undecided past `adjudication_window` (72h) can be closed by
  anyone, releasing exposure. It cannot be closed early (`NOT_STALE`), and a
  timed-out claim can never settle.

## Client-side security

**Bearer keys are custody.** A policy's private key lives in `localStorage` under
`covert.secrets.v1`. Whoever holds it controls the policy. COVERT cannot recover
it, no server has a copy, and losing it makes the policy permanently unclaimable.
This is the product's largest security weakness and is documented in
[LIMITATIONS.md](LIMITATIONS.md) rather than minimised.

Storage is split into three keys so their properties stay visible:

| Key | Sensitivity | Leak impact |
| --- | --- | --- |
| `covert.ledger.v1` | Public | None — chain-reconstructable |
| `covert.reveals.v1` | Private | Reveals what claims were about |
| `covert.secrets.v1` | **Custody** | **Loss of policy control** |

`/history` reports how much of each is held and offers erasure, stating the
consequence first.

**Reveal packets** contain the incident text and its salt. They must reach the
adjudicator out of band. COVERT never uploads one, and the interface says so
wherever a packet can be copied.

**Signing.** All signatures are produced with `lowS: true`, matching the
contract's canonical-range requirement. Private keys never leave the module that
holds them and are never placed in the ledger, a packet, React state, or a log.

**Network.** The mainnet chain id is checked at connect time and re-checked
before every write. Reads fail over across RPC endpoints; a contract revert is
never retried as if it were a transport error.

## What the frontend is not

The frontend is not authoritative for any onchain claim. `/proof` links to the
independent verifier, and `scripts/verify-lifecycle.mjs` reconstructs a policy's
lifecycle from Starknet events alone — including re-deriving that approval
preceded settlement — without reading browser state.

## Deployment hygiene

- No private key appears in this repository, in any script, in any log, or in
  the frontend bundle. Deploy scripts reference a keystore or an sncast account
  by name only.
- `cairo/.env.deploy` is gitignored and has no committed counterpart with values.
- `MockToken` and `MockStrk20Pool` are test and devnet infrastructure. Deploying
  either to mainnet would be a serious error; `00-preflight.sh` names them
  explicitly for that reason.
- Every deploy script requires interactive confirmation before each mainnet
  transaction and supports `--dry-run --detailed` for fee preview.
