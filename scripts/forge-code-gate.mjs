#!/usr/bin/env node
/**
 * Static control gate.
 *
 * Guards the controls that are easy to delete by accident during a refactor and
 * whose absence would not fail a build: the contract-side invariants, the honesty
 * rules about evidence, and the separation between live and replayed data.
 *
 * This is a tripwire, not a proof. It never replaces `snforge test`, `npm test`,
 * `npm run test:e2e`, or real chain evidence — and it deliberately fails loudly if
 * a control's implementation moves without this file being updated with it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const REQUIRED_FILES = [
  "README.md",
  "SECURITY.md",
  "ARCHITECTURE.md",
  "LIMITATIONS.md",
  "EVIDENCE.md",
  "DEMO.md",
  "docs/PRIVACY-MODEL.md",
  "docs/THREAT-MODEL.md",
  "docs/MAINNET-PROOF.md",
  "cairo/src/covert_policy.cairo",
  "cairo/src/covert_anonymizer.cairo",
  "cairo/tests/covert_invariants.cairo",
  "src/lib/domain/machine.ts",
  "src/lib/domain/projection.ts",
  "src/lib/domain/errors.ts",
  "src/lib/covert/operations.ts",
  "scripts/devnet/run-lifecycle.mjs",
  "scripts/verify-lifecycle.mjs",
  "scripts/build-claim-ledger.mjs",
  "tests/domain/machine.test.ts",
  "tests/e2e/lifecycle.spec.ts",
];

const missingFiles = REQUIRED_FILES.filter((p) => !exists(p));
if (missingFiles.length) {
  console.error("FORGE code gate failed.\nMissing files:\n- " + missingFiles.join("\n- "));
  process.exit(1);
}

const policy = read("cairo/src/covert_policy.cairo");
const anon = read("cairo/src/covert_anonymizer.cairo");
const cairoTests = read("cairo/tests/covert_invariants.cairo");
const key = read("src/lib/covert/key.ts");
const machine = read("src/lib/domain/machine.ts");
const errors = read("src/lib/domain/errors.ts");
const operations = read("src/lib/covert/operations.ts");
const persistence = read("src/lib/domain/persistence.ts");
const verifyPage = read("src/app/verify/page.tsx");
const proofPage = read("src/app/proof/page.tsx");
const replayPage = read("src/app/replay/page.tsx");
const wallet = read("src/components/WalletButton.tsx");
const artifactLoader = read("src/lib/replay/artifact.ts");
const lifecycleScript = read("scripts/devnet/run-lifecycle.mjs");
const verifier = read("scripts/verify-lifecycle.mjs");

/** [ok, label, why it matters if it disappears] */
const CONTROLS = [
  // ---- contract invariants ------------------------------------------------
  [policy.includes("COVERT_CLAIM_V1"), "claim signature domain separator"],
  [policy.includes("COVERT_REDEEM_V1"), "redemption signature domain separator"],
  [
    policy.includes("assert_bearer_signature(msg_hash, owner_key, sig_r, sig_s)"),
    "bearer authentication on claim and redemption",
  ],
  [policy.includes("order_u256 / 2"), "canonical low-s signature bound"],
  [policy.includes("let expiry = get_block_timestamp() + term_seconds"), "contract-derived policy expiry"],
  [
    policy.includes("poseidon_hash_span(array![policy_commitment, incident_hash].span())"),
    "claim commitment bound to policy and incident",
  ],
  [
    policy.includes("assert(self.claim_decision.read(claim_commitment) == DECISION_APPROVED, errors::NOT_APPROVED)"),
    "settlement requires approval (the central invariant)",
  ],
  [policy.includes("claim_redeemed.write(claim_commitment, true)"), "settlement replay flag"],
  [policy.includes("only_adjudicator"), "adjudicator role separate from owner"],
  [policy.includes("fn expire_stale_claim"), "abandoned-claim liveness escape"],
  [policy.includes("assert(get_block_timestamp() > deadline, errors::NOT_STALE)"), "timeout cannot fire early"],
  [
    policy.includes("let surplus = reserve - exposure;") && policy.includes("assert(amount <= surplus, errors::NO_SURPLUS)"),
    "reserve withdrawal bounded by unbacked reserve",
  ],
  [policy.includes("struct ClaimApproved {") && policy.includes("#[key] policy_commitment"), "approval event carries its policy"],
  [anon.includes("assert(get_caller_address() == self.pool.read(), errors::BAD_POOL)"), "anonymizer pins its pool"],
  [anon.includes("balance_u128 == premium"), "exact premium routed on purchase"],
  [anon.includes("balance_u128 == payout"), "exact payout routed on settlement"],

  // ---- contract tests -----------------------------------------------------
  [cairoTests.includes("client controls expiry"), "expiry regression test"],
  [cairoTests.includes("claim slot griefed"), "claim-griefing regression test"],
  [
    cairoTests.includes("pool_routed_lifecycle_fails_before_approval_and_succeeds_after"),
    "end-to-end pool-routed lifecycle test",
  ],
  [cairoTests.includes("premature settlement reason"), "premature settlement asserts its exact reason"],
  [cairoTests.includes("stale_claim_cannot_be_closed_before_its_deadline"), "timeout deadline test"],
  [cairoTests.includes("owner_can_withdraw_only_unbacked_reserve"), "reserve withdrawal bound test"],

  // ---- client-side authentication and privacy -----------------------------
  [key.includes("const incidentSalt = stark.randomAddress()"), "salted incident commitment"],
  [key.includes("verifyIncidentReveal"), "verifier-side reveal recomputation"],
  [key.includes("{ lowS: true }"), "client produces canonical signatures"],
  [wallet.includes("SN_MAIN"), "mainnet hard gate on connect"],
  [
    persistence.includes("SECRETS_KEY") && persistence.includes("LEDGER_KEY") && persistence.includes("REVEALS_KEY"),
    "storage separated into custody / private / public tiers",
  ],
  [persistence.includes("export function wipeSensitive"), "user can erase custody material"],

  // ---- lifecycle integrity ------------------------------------------------
  [machine.includes("export function settlementBlocker"), "settlement precondition is modelled explicitly"],
  [machine.includes('return "NOT_APPROVED"'), "under-review settlement predicts NOT_APPROVED"],
  [errors.includes("NOT_APPROVED:") || errors.includes("NOT_APPROVED: {"), "NOT_APPROVED has user-facing guidance"],
  [/recovery:/.test(errors), "every failure carries a recovery path"],
  [operations.includes('kind: "settlement.rejected"'), "refused settlements are recorded as evidence"],
  [
    operations.includes("beginInFlight") && errors.includes("DUPLICATE_IN_FLIGHT"),
    "duplicate submissions are prevented",
  ],
  [operations.includes("export async function reconcilePolicy"), "chain reconciliation after reload"],

  // ---- honesty about evidence ---------------------------------------------
  [
    verifyPage.includes("APPROVAL LOCKED") && verifyPage.includes("matchesChain"),
    "approval locked until the reveal matches both itself and the chain",
  ],
  [proofPage.includes("BLOCKED"), "proof surface can report blocked claims"],
  [!/VERIFIED ON MAINNET/i.test(proofPage), "proof surface does not self-certify mainnet"],
  [
    artifactLoader.includes('kind: "DEVNET_EXECUTION" | "MAINNET_EXECUTION"'),
    "replay artifacts declare where they were executed",
  ],
  [
    replayPage.includes("Verified replay") &&
      replayPage.includes("networkLabel") &&
      artifactLoader.includes('"LOCAL STARKNET DEVNET"') &&
      replayPage.includes("Recorded, not re-enacted"),
    "replay is labelled and never presented as live",
  ],
  [
    replayPage.includes("artifact.disclaimer"),
    "replay renders the artifact's own provenance disclaimer",
  ],
  [
    lifecycleScript.includes("expectRevert") && lifecycleScript.includes("but the call SUCCEEDED"),
    "negative lifecycle steps fail the run unless they fail correctly",
  ],
  [
    lifecycleScript.includes("transfersToHolder.length === 0"),
    "settlement asserts the public wallet is not the payout destination",
  ],
  [verifier.includes("settlement was preceded by an approval"), "independent verifier re-derives the ordering rule"],
];

const failed = CONTROLS.filter(([ok]) => !ok).map(([, label]) => label);

if (failed.length) {
  console.error("FORGE code gate failed.\nMissing or moved controls:\n- " + failed.join("\n- "));
  console.error("\nIf a control was deliberately restructured, update scripts/forge-code-gate.mjs with it.");
  process.exit(1);
}

console.log(`FORGE static code gate passed: ${CONTROLS.length} controls present, ${REQUIRED_FILES.length} required files.`);
console.log("This is a tripwire only. It does not replace snforge test, npm test, npm run test:e2e, or chain evidence.");
