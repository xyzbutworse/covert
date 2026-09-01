# Demo

Two paths. The first needs nothing but a browser. The second needs a local
Starknet node and shows the same lifecycle executing as real transactions.

Neither path fabricates anything. If a step cannot run, the interface says so and
names what is missing.

---

## Path A — Verified replay (2 minutes, no wallet, no funds)

The recorded lifecycle. Every hash, revert reason and balance came from
transactions that actually executed on a local Starknet node.

```bash
npm install
npm run build && npm start
```

Open <http://localhost:3000>.

| # | Do this | Expect to see | Why it matters |
| --- | --- | --- | --- |
| 1 | Land on `/` | *"Get paid for an incident without publishing who got paid."* Under it: payout to public wallet **0 STRK**, payout to private balance **+0.05 STRK** | The outcome first. Those two figures were measured during the recorded run, not written by hand. |
| 2 | Click **See a real lifecycle** | `/replay`, badged **VERIFIED REPLAY — DEVNET** with the artifact's own disclaimer | It never claims to be live or to be mainnet. |
| 3 | Read *The observed consequence* | Public wallet payout 0 STRK, noting the wallet still paid gas; private balance +0.05 STRK; exposure released | The honest version of the claim: the payout never arrives, the balance is not untouched. |
| 4 | Read *Where the money actually went* | Three STRK transfers: policy → anonymizer, anonymizer → pool, holder → sequencer (gas) | The payout path contains contracts. It contains no beneficiary address. |
| 5 | Find step **NEG-04** | *Settle BEFORE the adjudicator has approved* — **REFUSED AS REQUIRED**, `NOT_APPROVED`. Click **Show raw revert** | The contract refused. Not an animation. |
| 6 | Find step **TX-DEC**, then **TX-03** | Adjudicator approves; the identical settlement now **SUCCEEDED** | Same calldata, different outcome. Approval is the only thing that changed. |
| 7 | Scroll to *Assertions checked by the run* | 12 of 12 passed | The run exits non-zero if any of them stops holding. |
| 8 | Go to `/proof` | The claim ledger: VERIFIED / PENDING / BLOCKED with evidence and a reproduction command per row | Mainnet rows read **BLOCKED**, not pending. Nothing self-certifies. |

**The point of step 5 and 6:** COVERT does not disable the settlement button
before approval. It lets you press it, and the contract refuses. A UI that
refuses to try cannot demonstrate that the protocol refuses.

---

## Path B — Execute it yourself (5 minutes, local node)

Re-runs everything above from scratch and regenerates the artifact.

```bash
# 1. contracts compile and every invariant holds
cd cairo && scarb build && snforge test && cd ..
#    → Tests: 59 passed, 0 failed

# 2. a real Starknet node
starknet-devnet --seed 42 --accounts 5 --port 5050

# 3. the full lifecycle, as real transactions
node scripts/devnet/run-lifecycle.mjs
```

Watch the output:

```
  ✓ TX-00 0x...        shield (public by design)
  ✓ TX-01 0x...        cover activated privately
  ✓ NEG-02 rejected as required (POLICY_EXISTS)
  ✓ TX-02 0x...        authenticated claim
  ✓ NEG-03 rejected as required (POLICY_HAS_CLAIM)
  ✓ NEG-04 rejected as required (NOT_APPROVED)   ← the moment
  ✓ TX-DEC 0x...       adjudicator approves
  ✓ NEG-05 rejected as required (NOT_ADJUDICATOR)
  ✓ TX-03 0x...        the identical settlement succeeds
  ✓ NEG-06 rejected as required (CLAIMED)

  PASS  premature settlement reverted with NOT_APPROVED
  PASS  identical settlement succeeded after approval
  PASS  private balance increased by exactly the fixed payout
  PASS  public wallet received zero payout (delta is fee only)
  PASS  no STRK transfer to the public wallet in the settlement tx
  ...
  verdict: PASS
```

A negative step only passes when it fails for **exactly** the named reason. A
different revert, or a success, fails the whole run.

Then verify it without trusting the script or the UI:

```bash
node scripts/verify-lifecycle.mjs --artifact evidence/devnet-lifecycle.json
```

This reads Starknet events directly and re-derives the ordering rules itself —
including that approval preceded settlement, and that the settled amount equals
the tier's fixed payout. It reads no browser state and no artifact field for its
conclusions.

Refresh `/replay` to see the new run rendered.

---

## Path C — Drive the product (needs a deployment)

Only possible once COVERT is deployed and `NEXT_PUBLIC_COVERT_*` are set. Without
that, every screen reports `NOT_DEPLOYED` and points at the replay instead. See
[LIMITATIONS.md](LIMITATIONS.md) for why mainnet is blocked.

With a deployment configured:

1. **`/cover`** — Shield STRK, wait ~10 blocks for the note to mature, choose a
   tier, activate. A policy `CVT-XXXX-XXXX` appears.
2. **`/policy/CVT-…`** — The persistent policy: terms, expiry, claim slot, full
   timeline. Survives reload.
3. **`/claim`** — Select the policy, describe the incident, file. Only a salted
   commitment goes onchain. Copy the reveal packet.
4. **Second browser → `/verify`** — Paste the packet. It recomputes locally, then
   cross-checks the chain. Approval stays locked until both pass *and* the
   connected wallet is the adjudicator.
5. **Back on `/policy/…`** — Press **Attempt settlement anyway** before approval.
   It fails with `NOT_APPROVED`, and the refusal is recorded under *Adversarial
   evidence*.
6. **Adjudicator approves.**
7. **Press settlement again.** Same action, now succeeds.
8. **`/policy/…`** shows the measured before/after: payout to public wallet
   0 STRK, private balance +payout.
9. **`/reserve`** — exposure released, reserve reduced by exactly the payout.
10. **`/history`** — the complete timeline, and what custody material the browser
    holds.
11. **`/proof`** — the ledger updates with your own evidence.

---

## What a skeptical reader should check

- **Press the settlement button before approval.** It is not disabled. The
  contract is what stops you.
- **Read `/proof` for anything marked BLOCKED.** Mainnet deployment is blocked on
  a credential, and the ledger says so rather than leaving it ambiguous.
- **Run the verifier.** `scripts/verify-lifecycle.mjs` does not trust the
  frontend, the artifact, or the run script.
- **Break a reveal packet.** Edit one character of `incidentText` and import it
  on `/verify`. It is rejected with `PACKET_MISMATCH` and cannot be approved.
- **Reload mid-flow.** State is an append-only event log; nothing is lost.
- **Check what the privacy claim actually says.** Every surface that makes it
  also states that the first deposit is public, that gas comes from the public
  address, and that correlation remains possible.
