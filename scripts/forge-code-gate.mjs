import fs from "node:fs";

const required = [
  "SECURITY.md",
  "docs/ARCHITECTURE.md",
  "docs/PRIVACY-MODEL.md",
  "docs/THREAT-MODEL.md",
  "docs/MAINNET-PROOF.md",
  "docs/DEMO-SCRIPT.md",
  "src/app/verify/page.tsx",
  "src/app/proof/page.tsx",
  "cairo/src/covert_policy.cairo",
  "cairo/src/covert_anonymizer.cairo",
];
const missing = required.filter((p) => !fs.existsSync(p));

const policy = fs.readFileSync("cairo/src/covert_policy.cairo", "utf8");
const key = fs.readFileSync("src/lib/covert/key.ts", "utf8");
const proof = fs.readFileSync("src/app/proof/page.tsx", "utf8");
const wallet = fs.readFileSync("src/components/WalletButton.tsx", "utf8");
const tests = fs.readFileSync("cairo/tests/covert_invariants.cairo", "utf8");
const anon = fs.readFileSync("cairo/src/covert_anonymizer.cairo", "utf8");
const verify = fs.readFileSync("src/app/verify/page.tsx", "utf8");
const claim = fs.readFileSync("src/app/claim/page.tsx", "utf8");

const assertions = [
  [policy.includes("COVERT_CLAIM_V1"), "claim signature domain"],
  [policy.includes("COVERT_REDEEM_V1"), "redemption signature domain"],
  [policy.includes("assert_bearer_signature(msg_hash, owner_key, sig_r, sig_s)"), "bearer authentication"],
  [policy.includes("let expiry = get_block_timestamp() + term_seconds"), "onchain-derived expiry"],
  [policy.includes("only_adjudicator"), "separate adjudicator gate"],
  [policy.includes("claim_redeemed.write(claim_commitment, true)"), "settlement replay flag"],
  [policy.includes("poseidon_hash_span(array![policy_commitment, incident_hash].span())"), "claim commitment binding"],
  [policy.includes("order_u256 / 2"), "canonical low-s signature gate"],
  [key.includes("incidentSalt = stark.randomAddress()"), "salted incident commitment"],
  [wallet.includes("SN_MAIN"), "mainnet hard gate"],
  [proof.includes("PENDING"), "evidence-driven pending proof state"],
  [anon.includes("balance_u128 == premium"), "exact anonymizer purchase balance"],
  [tests.includes("claim slot griefed"), "claim-griefing regression test"],
  [tests.includes("client controls expiry"), "expiry regression test"],
  [key.includes("verifyIncidentReveal"), "verifier reveal recomputation"],
  [verify.includes("APPROVAL LOCKED") && verify.includes("onchainMatches"), "approval integrity lock"],
  [claim.includes("Copy verifier packet"), "cross-browser verifier packet"],
  [proof.includes("RECORDED — INSPECT / VERIFY") && !proof.includes("VERIFIED / STARKNET"), "non-self-certifying proof labels"],
];
const failed = assertions.filter(([ok]) => !ok).map(([, label]) => label);

if (missing.length || failed.length) {
  console.error("FORGE 1.0 code gate failed.");
  if (missing.length) console.error("Missing files:\n- " + missing.join("\n- "));
  if (failed.length) console.error("Missing controls:\n- " + failed.join("\n- "));
  process.exit(1);
}

console.log("FORGE 1.0 static code gate passed. This is not a substitute for npm build, scarb build, snforge test, or mainnet evidence.");
