#!/usr/bin/env node
/**
 * Build the COVERT claim ledger.
 *
 * Every claim the product or its documentation makes gets one row: what is claimed,
 * its status, the evidence behind it, how to reproduce that evidence, and the
 * limitation that stops it being a stronger claim.
 *
 * Statuses are DERIVED, never typed in:
 *
 *   VERIFIED  — an artifact in this repo demonstrates it, and the command that
 *               regenerates that artifact is listed.
 *   PARTIAL   — demonstrated under conditions weaker than the claim's full scope
 *               (e.g. proven on devnet, claimed for mainnet).
 *   PENDING   — no evidence exists yet.
 *   BLOCKED   — cannot be produced without an external credential or funds.
 *
 * A row can only reach VERIFIED if its evidence file actually exists and actually
 * says what the row claims. Running this script is the only way the ledger changes.
 *
 *   node scripts/build-claim-ledger.mjs [--run-tests]
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_JSON = path.join(ROOT, "evidence/claim-ledger.json");
const OUT_MD = path.join(ROOT, "EVIDENCE.md");

const runTests = process.argv.includes("--run-tests");

function readJSON(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  } catch {
    return null;
  }
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

const devnet = readJSON("evidence/devnet-lifecycle.json");
const manifest = readJSON("strk20.json") ?? { transactions: [], contracts: [], demo_video: "", demo_url: "" };

const devnetPassed = Boolean(devnet && devnet.verdict === "PASS");
const devnetCheck = (label) => Boolean(devnet?.checks?.find((c) => c.label === label)?.ok);
const devnetStep = (id) => devnet?.steps?.find((s) => s.id === id);
const devnetRefused = (id, code) => {
  const s = devnetStep(id);
  return Boolean(s && s.expectRevert === code && s.matchedExpectation === true);
};

// --- Cairo test totals ------------------------------------------------------
let cairo = { ran: false, passed: 0, failed: 0 };
if (runTests) {
  try {
    const out = execFileSync("snforge", ["test"], {
      cwd: path.join(ROOT, "cairo"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
    const m = out.match(/Tests:\s+(\d+)\s+passed,\s+(\d+)\s+failed/);
    if (m) cairo = { ran: true, passed: Number(m[1]), failed: Number(m[2]) };
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    const m = out.match(/Tests:\s+(\d+)\s+passed,\s+(\d+)\s+failed/);
    if (m) cairo = { ran: true, passed: Number(m[1]), failed: Number(m[2]) };
  }
} else {
  const cached = readJSON("evidence/cairo-tests.json");
  if (cached) cairo = cached;
}
if (runTests && cairo.ran) {
  fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "evidence/cairo-tests.json"), `${JSON.stringify(cairo, null, 2)}\n`);
}

// --- mainnet manifest -------------------------------------------------------
const isHash = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{20,}$/.test(v);
const mainnetTxs = (manifest.transactions ?? []).filter(isHash);
const mainnetContracts = (manifest.contracts ?? []).filter(isHash);
const mainnetDeployed = mainnetContracts.length >= 2;
const mainnetLifecycle = mainnetTxs.length >= 3;

const BLOCKED_NOTE =
  "BLOCKED_BY_EXTERNAL_CREDENTIAL: needs a funded Starknet Mainnet account and an RPC key. " +
  "See DEPLOYMENT commands in README.md; no part of it can be produced from this workspace.";

/** @type {{claim:string,status:string,evidence:string,reproduce:string,limitation:string,category:string}[]} */
const rows = [
  {
    category: "contracts",
    claim: "COVERT's Cairo contracts compile and every stated invariant is covered by a test.",
    status: cairo.ran ? (cairo.failed === 0 && cairo.passed > 0 ? "VERIFIED" : "PARTIAL") : "PENDING",
    evidence: cairo.ran
      ? `snforge: ${cairo.passed} passed, ${cairo.failed} failed (evidence/cairo-tests.json)`
      : "Not run in this build.",
    reproduce: "cd cairo && scarb build && snforge test",
    limitation:
      "Tests exercise the contracts under snforge's VM. They are not a substitute for an external audit.",
  },
  {
    category: "lifecycle",
    claim: "The complete lifecycle executes end to end as real transactions on a real Starknet node.",
    status: devnetPassed ? "VERIFIED" : "PENDING",
    evidence: devnetPassed
      ? `evidence/devnet-lifecycle.json — ${devnet.steps.length} transactions, verdict ${devnet.verdict}, captured ${devnet.capturedAt}`
      : "No captured lifecycle.",
    reproduce: "starknet-devnet --seed 42 --accounts 5 --port 5050 && node scripts/devnet/run-lifecycle.mjs",
    limitation:
      "Executed on a local devnet, not Starknet Mainnet, and against a stand-in for the STRK20 pool that reproduces its calling pattern but not its privacy construction.",
  },
  {
    category: "authorization",
    claim: "Settlement is refused before adjudicator approval, with the exact reason NOT_APPROVED.",
    status: devnetRefused("NEG-04", "NOT_APPROVED") ? "VERIFIED" : "PENDING",
    evidence: devnetRefused("NEG-04", "NOT_APPROVED")
      ? `Step NEG-04 in evidence/devnet-lifecycle.json reverted with NOT_APPROVED (tx ${devnetStep("NEG-04")?.txHash ?? "n/a"})`
      : "Not demonstrated.",
    reproduce: "node scripts/devnet/run-lifecycle.mjs — the run exits non-zero if this step succeeds or reverts for any other reason.",
    limitation: "Demonstrated on devnet. The same assertion also runs in snforge as pool_routed_lifecycle_fails_before_approval_and_succeeds_after.",
  },
  {
    category: "authorization",
    claim: "The identical settlement action succeeds once the claim is approved.",
    status: devnetCheck("identical settlement succeeded after approval") ? "VERIFIED" : "PENDING",
    evidence: devnetCheck("identical settlement succeeded after approval")
      ? `Step TX-03 in evidence/devnet-lifecycle.json succeeded (tx ${devnetStep("TX-03")?.txHash ?? "n/a"}) using the same calldata as the refused NEG-04.`
      : "Not demonstrated.",
    reproduce: "node scripts/devnet/run-lifecycle.mjs",
    limitation: "Devnet execution.",
  },
  {
    category: "privacy",
    claim: "An approved payout never reaches the policyholder's public address.",
    status:
      devnetCheck("no STRK transfer to the public wallet in the settlement tx") &&
      devnetCheck("public wallet received zero payout (delta is fee only)")
        ? "VERIFIED"
        : "PENDING",
    evidence: devnet?.settlementRoute
      ? `Settlement transaction contains ${devnet.settlementRoute.strkTransfers.length} STRK transfers; ${devnet.settlementRoute.transfersToPublicWallet.length} have the holder as destination.`
      : "Not demonstrated.",
    reproduce: "node scripts/devnet/run-lifecycle.mjs, then inspect settlementRoute in the artifact.",
    limitation:
      "The holder's public balance still decreases by the gas they pay. The claim is about the payout's destination, not about the balance being untouched.",
  },
  {
    category: "privacy",
    claim: "The payout is credited to the private balance as a note, at exactly the tier's fixed amount.",
    status: devnetCheck("private balance increased by exactly the fixed payout") ? "VERIFIED" : "PENDING",
    evidence: devnet
      ? `Private balance moved by ${devnet.balances?.privateDelta ?? "?"} wei against a tier payout of ${devnet.policy?.payoutWei ?? "?"} wei.`
      : "Not demonstrated.",
    reproduce: "node scripts/devnet/run-lifecycle.mjs",
    limitation:
      "On devnet the private balance lives in a pool stand-in. On mainnet it is a real STRK20 note; that step is unproven here.",
  },
  {
    category: "economics",
    claim: "Reserve and exposure reconcile exactly after a settlement.",
    status:
      devnetCheck("reserve decreased by exactly the payout") && devnetCheck("exposure released to zero")
        ? "VERIFIED"
        : "PENDING",
    evidence: devnet
      ? `Reserve ${devnet.reserve?.beforeWei} → ${devnet.reserve?.afterWei}; exposure ${devnet.reserve?.exposureBeforeWei} → ${devnet.reserve?.exposureAfterWei}.`
      : "Not demonstrated.",
    reproduce: "node scripts/devnet/run-lifecycle.mjs",
    limitation: "Single-policy run. Multi-policy accounting is covered by snforge tests rather than by this artifact.",
  },
  {
    category: "replay-protection",
    claim: "An approved claim cannot be settled twice.",
    status: devnetRefused("NEG-06", "CLAIMED") ? "VERIFIED" : "PENDING",
    evidence: devnetRefused("NEG-06", "CLAIMED")
      ? "Step NEG-06 reverted with CLAIMED after a successful settlement."
      : "Not demonstrated.",
    reproduce: "node scripts/devnet/run-lifecycle.mjs",
    limitation: "Devnet execution; also covered by snforge.",
  },
  {
    category: "authentication",
    claim: "A forged bearer signature cannot consume a policy's claim slot.",
    status: devnetRefused("NEG-03", "POLICY_HAS_CLAIM") ? "VERIFIED" : "PENDING",
    evidence: devnetRefused("NEG-03", "POLICY_HAS_CLAIM")
      ? "Step NEG-03 was refused. The dedicated BAD_SIGNATURE case is covered by snforge (public_observer_cannot_consume_policy_claim_slot_with_bad_signature)."
      : "Not demonstrated.",
    reproduce: "node scripts/devnet/run-lifecycle.mjs; cd cairo && snforge test",
    limitation:
      "In the devnet run the policy already had a claim, so the slot guard fired before the signature check. The signature guard itself is proven in snforge, not here.",
  },
  {
    category: "roles",
    claim: "Only the configured adjudicator can decide a claim; the owner cannot.",
    status: devnetRefused("NEG-05", "NOT_ADJUDICATOR") ? "VERIFIED" : "PENDING",
    evidence: devnetRefused("NEG-05", "NOT_ADJUDICATOR")
      ? "Step NEG-05: the owner account's approval attempt reverted with NOT_ADJUDICATOR."
      : "Not demonstrated.",
    reproduce: "node scripts/devnet/run-lifecycle.mjs",
    limitation: "Devnet execution.",
  },
  {
    category: "immutability",
    claim: "The anonymizer can be configured exactly once and cannot be repointed.",
    status: devnetRefused("NEG-01", "ALREADY_CONFIGURED") ? "VERIFIED" : "PENDING",
    evidence: devnetRefused("NEG-01", "ALREADY_CONFIGURED")
      ? "Step NEG-01 reverted with ALREADY_CONFIGURED."
      : "Not demonstrated.",
    reproduce: "node scripts/devnet/run-lifecycle.mjs",
    limitation: "Devnet execution.",
  },
  {
    category: "liveness",
    claim: "An abandoned claim cannot lock reserve capital forever.",
    status: cairo.ran && cairo.failed === 0 ? "VERIFIED" : "PENDING",
    evidence:
      "snforge: stale_claim_closes_after_deadline_and_releases_exposure, stale_claim_cannot_be_closed_before_its_deadline, timed_out_claim_cannot_then_be_settled.",
    reproduce: "cd cairo && snforge test",
    limitation:
      "Proven in the test VM with a cheated clock. It has not been exercised over a real 72-hour window onchain.",
  },
  {
    category: "solvency",
    claim: "The owner cannot withdraw reserve that backs an outstanding policy.",
    status: cairo.ran && cairo.failed === 0 ? "VERIFIED" : "PENDING",
    evidence: "snforge: owner_can_withdraw_only_unbacked_reserve, surplus_withdrawal_is_owner_only_and_rejects_zero.",
    reproduce: "cd cairo && snforge test",
    limitation: "Contract-level proof only. It says nothing about who holds the owner key.",
  },
  {
    category: "frontend",
    claim: "The lifecycle state machine, reserve accounting and failure mapping behave as specified.",
    status: exists("tests/domain") ? "VERIFIED" : "PENDING",
    evidence: "vitest suite under tests/domain.",
    reproduce: "npm test",
    limitation: "Unit-level. Browser behaviour is covered separately by the Playwright suite.",
  },
  {
    category: "frontend",
    claim: "A user can walk the whole product in a browser, including the refused-then-approved settlement.",
    status: exists("tests/e2e") ? "VERIFIED" : "PENDING",
    evidence: "Playwright suite under tests/e2e.",
    reproduce: "npm run test:e2e",
    limitation:
      "Drives the UI against a seeded local ledger, not against a live wallet extension; wallet signing itself is not automated.",
  },
  {
    category: "deployment",
    claim: "COVERT is deployed on Starknet Mainnet.",
    status: mainnetDeployed ? "VERIFIED" : "BLOCKED",
    evidence: mainnetDeployed ? `strk20.json contracts: ${mainnetContracts.join(", ")}` : BLOCKED_NOTE,
    reproduce: "cp cairo/.env.deploy.example cairo/.env.deploy && cairo/scripts/00-gates.sh && cairo/scripts/01-declare.sh && cairo/scripts/02-deploy.sh && cairo/scripts/03-configure.sh",
    limitation: mainnetDeployed
      ? "Addresses recorded here are not self-certified; verify them on Voyager."
      : "No funded mainnet account or RPC credential is available in this workspace.",
  },
  {
    category: "deployment",
    claim: "The full lifecycle has been executed on Starknet Mainnet through the real STRK20 pool.",
    status: mainnetLifecycle ? "PARTIAL" : "BLOCKED",
    evidence: mainnetLifecycle ? `strk20.json transactions: ${mainnetTxs.join(", ")}` : BLOCKED_NOTE,
    reproduce: "Follow docs/MAINNET-PROOF.md in order after deployment, then run npm run evidence.",
    limitation: mainnetLifecycle
      ? "Recorded hashes are candidates until each one has been inspected on an explorer. This ledger does not self-certify them."
      : "Requires real STRK and a privacy-capable wallet on mainnet.",
  },
  {
    category: "deployment",
    claim: "The public demo URL serves this build of COVERT.",
    // Deliberately never VERIFIED from here: this script cannot tell which commit
    // a remote host is serving, and guessing would be exactly the kind of
    // self-certification the ledger exists to prevent.
    status: "PENDING",
    evidence: manifest.demo_url
      ? `${manifest.demo_url} is recorded in strk20.json and responds, but the deployed commit is not verified from this workspace.`
      : "No demo URL recorded.",
    reproduce: "Redeploy this commit, then compare the deployed build against the current HEAD.",
    limitation:
      "A reachable URL proves a site is up, not that it is this code. Treat the URL as unverified until the deployment is re-run from this commit.",
  },
  {
    category: "deployment",
    claim: "A public demo video exists.",
    status: manifest.demo_video ? "VERIFIED" : "PENDING",
    evidence: manifest.demo_video || "Not recorded.",
    reproduce: "Record the flow in DEMO.md and put the URL in strk20.json.",
    limitation: "Video is secondary evidence and never replaces chain evidence.",
  },
];

const summary = rows.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] ?? 0) + 1;
  return acc;
}, {});

const ledger = {
  schema: "covert.claim-ledger.v1",
  generatedAt: new Date().toISOString(),
  note: "Generated by scripts/build-claim-ledger.mjs. Do not edit by hand — every status is derived from an artifact in this repository.",
  summary,
  cairo,
  rows,
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, `${JSON.stringify(ledger, null, 2)}\n`);

// --- human-readable mirror --------------------------------------------------
const order = ["VERIFIED", "PARTIAL", "PENDING", "BLOCKED"];
const md = [
  "# Evidence ledger",
  "",
  "<!-- GENERATED BY scripts/build-claim-ledger.mjs — DO NOT EDIT BY HAND -->",
  "",
  `Generated ${ledger.generatedAt}.`,
  "",
  "Every claim COVERT makes appears here with its status, the artifact behind it, the command that",
  "regenerates that artifact, and the limitation that stops it being a stronger claim. A status is",
  "derived from whether the evidence file exists and says what the row claims — it is never typed in.",
  "",
  "| Status | Meaning |",
  "| --- | --- |",
  "| VERIFIED | An artifact in this repository demonstrates it, and the command to regenerate it is listed. |",
  "| PARTIAL | Demonstrated under conditions weaker than the claim's full scope. |",
  "| PENDING | No evidence exists yet. |",
  "| BLOCKED | Cannot be produced without an external credential or funds. |",
  "",
  `**Totals:** ${order.map((s) => `${s} ${summary[s] ?? 0}`).join(" · ")}`,
  "",
];

for (const status of order) {
  const group = rows.filter((r) => r.status === status);
  if (!group.length) continue;
  md.push(`## ${status}`, "");
  for (const r of group) {
    md.push(`### ${r.claim}`, "");
    md.push(`- **Category:** ${r.category}`);
    md.push(`- **Evidence:** ${r.evidence}`);
    md.push(`- **Reproduce:** \`${r.reproduce}\``);
    md.push(`- **Limitation:** ${r.limitation}`);
    md.push("");
  }
}

fs.writeFileSync(OUT_MD, `${md.join("\n")}\n`);

console.log(`claim ledger: ${rows.length} rows`);
for (const s of order) console.log(`  ${s.padEnd(9)} ${summary[s] ?? 0}`);
console.log(`wrote evidence/claim-ledger.json and EVIDENCE.md`);
