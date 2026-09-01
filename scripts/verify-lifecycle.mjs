#!/usr/bin/env node
/**
 * Independent lifecycle verifier.
 *
 * Reconstructs a COVERT policy's lifecycle from Starknet events alone, given only a
 * contract address and a policy commitment. It reads no browser state, trusts no
 * rendered value, and re-derives every ordering rule itself.
 *
 * This exists because a frontend must never be the authority for an onchain claim.
 * If COVERT's UI says a claim was approved before it settled, this script is how you
 * check that independently.
 *
 * Usage:
 *   node scripts/verify-lifecycle.mjs --policy 0x... [--contract 0x...] [--rpc URL]
 *   node scripts/verify-lifecycle.mjs --artifact evidence/devnet-lifecycle.json
 *
 * Exits 0 only when every consistency rule holds.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RpcProvider, selector } from "starknet";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const EVENT_NAMES = [
  "AnonymizerConfigured",
  "ReserveFunded",
  "PolicyPurchased",
  "PolicyExpired",
  "ClaimSubmitted",
  "ClaimApproved",
  "ClaimDenied",
  "ClaimTimedOut",
  "ClaimSettled",
  "ReserveWithdrawn",
];

const SELECTORS = new Map(
  EVENT_NAMES.map((n) => [BigInt(selector.getSelectorFromName(n)).toString(), n]),
);

// Mirrors cairo/src/covert_policy.cairo. Used to check the payout was not chosen.
const TIERS = {
  1: { name: "SIGNAL", premium: 10_000_000_000_000_000n, payout: 50_000_000_000_000_000n, term: 604_800n },
  2: { name: "SHIELD", premium: 20_000_000_000_000_000n, payout: 100_000_000_000_000_000n, term: 1_209_600n },
  3: { name: "BLACKOUT", premium: 40_000_000_000_000_000n, payout: 200_000_000_000_000_000n, term: 2_592_000n },
};

const big = (v) => {
  try {
    return BigInt(v ?? "0x0");
  } catch {
    return 0n;
  }
};
const eq = (a, b) => big(a) === big(b);

function decode(name, keys, data) {
  switch (name) {
    case "PolicyPurchased":
      return { commitment: keys[1], tier: Number(big(data[0])), expiry: big(data[1]), payout: big(data[2]) };
    case "PolicyExpired":
      return { commitment: keys[1], released: big(data[0]) };
    case "ClaimSubmitted":
      return { claim: keys[1], policy: keys[2], incidentHash: data[0] };
    case "ClaimApproved":
      return { claim: keys[1], policy: keys[2] };
    case "ClaimDenied":
      return { claim: keys[1], policy: keys[2], released: big(data[0]) };
    case "ClaimTimedOut":
      return { claim: keys[1], policy: keys[2], released: big(data[0]), deadline: big(data[1]) };
    case "ClaimSettled":
      return { claim: keys[1], policy: keys[2], payout: big(data[0]) };
    case "ReserveFunded":
      return { amount: big(data[0]), reserve: big(data[1]) };
    case "ReserveWithdrawn":
      return { amount: big(data[0]), reserve: big(data[1]), recipient: data[2] };
    case "AnonymizerConfigured":
      return { anonymizer: data[0] };
    default:
      return {};
  }
}

async function fetchEvents(provider, address) {
  const out = [];
  let token;
  for (let i = 0; i < 200; i++) {
    const chunk = await provider.getEvents({
      address,
      from_block: { block_number: 0 },
      to_block: "latest",
      chunk_size: 200,
      continuation_token: token,
    });
    for (const ev of chunk.events ?? []) {
      const name = SELECTORS.get(big(ev.keys?.[0]).toString());
      if (!name) continue;
      out.push({
        name,
        txHash: ev.transaction_hash,
        blockNumber: ev.block_number ?? 0,
        ...decode(name, ev.keys ?? [], ev.data ?? []),
      });
    }
    token = chunk.continuation_token;
    if (!token) break;
  }
  return out.sort((a, b) => a.blockNumber - b.blockNumber);
}

const failures = [];
const passes = [];
function check(label, ok, detail = "") {
  (ok ? passes : failures).push(detail ? `${label} — ${detail}` : label);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

/**
 * The ordering rules COVERT's whole argument depends on. Each one is re-derived
 * from the event stream rather than read from any stored state.
 */
function verifyPolicy(events, policyCommitment) {
  const mine = events.filter(
    (e) =>
      (e.commitment && eq(e.commitment, policyCommitment)) ||
      (e.policy && eq(e.policy, policyCommitment)),
  );

  if (!mine.length) {
    check("policy exists in the event stream", false, "no events reference this commitment");
    return;
  }

  console.log(`\nreconstructed ${mine.length} events for policy ${policyCommitment}:`);
  for (const e of mine) {
    console.log(`  #${e.blockNumber}  ${e.name.padEnd(20)} ${e.txHash ?? ""}`);
  }
  console.log("");

  const purchased = mine.filter((e) => e.name === "PolicyPurchased");
  const submitted = mine.filter((e) => e.name === "ClaimSubmitted");
  const approved = mine.filter((e) => e.name === "ClaimApproved");
  const denied = mine.filter((e) => e.name === "ClaimDenied");
  const timedOut = mine.filter((e) => e.name === "ClaimTimedOut");
  const settled = mine.filter((e) => e.name === "ClaimSettled");
  const expired = mine.filter((e) => e.name === "PolicyExpired");

  check("policy was purchased exactly once", purchased.length === 1, `${purchased.length} PolicyPurchased`);
  check("at most one claim was filed", submitted.length <= 1, `${submitted.length} ClaimSubmitted`);
  check("at most one settlement occurred", settled.length <= 1, `${settled.length} ClaimSettled`);

  const buy = purchased[0];
  if (buy) {
    const tier = TIERS[buy.tier];
    check("tier is one the contract defines", Boolean(tier), `tier ${buy.tier}`);
    if (tier) {
      check(
        "advertised payout equals the tier's fixed payout",
        buy.payout === tier.payout,
        `${buy.payout} vs ${tier.payout}`,
      );
    }
  }

  const claim = submitted[0];
  if (claim) {
    check("claim is bound to this policy", eq(claim.policy, policyCommitment));
    check(
      "claim was filed after the policy was purchased",
      Boolean(buy) && claim.blockNumber >= buy.blockNumber,
      `claim #${claim.blockNumber} vs purchase #${buy?.blockNumber}`,
    );
  }

  const decisions = approved.length + denied.length + timedOut.length;
  check("a claim received at most one decision", decisions <= 1, `${decisions} decisions`);

  const settle = settled[0];
  if (settle) {
    // The single most important rule in the product.
    check("settlement was preceded by an approval", approved.length === 1, `${approved.length} approvals`);
    if (approved[0]) {
      check(
        "approval came before settlement",
        approved[0].blockNumber <= settle.blockNumber,
        `approve #${approved[0].blockNumber} vs settle #${settle.blockNumber}`,
      );
    }
    check("a denied claim was not settled", denied.length === 0);
    check("a timed-out claim was not settled", timedOut.length === 0);
    if (buy && TIERS[buy.tier]) {
      check(
        "settled amount equals the tier's fixed payout",
        settle.payout === TIERS[buy.tier].payout,
        `${settle.payout} vs ${TIERS[buy.tier].payout}`,
      );
    }
    check("settled claim matches the filed claim", Boolean(claim) && eq(settle.claim, claim.claim));
  }

  if (denied.length || timedOut.length) {
    check("a closed claim did not also settle", settled.length === 0);
  }

  if (expired.length) {
    check("an expired policy never filed a claim", submitted.length === 0);
  }
}


/**
 * Re-derive an artifact's conclusions from its raw contents.
 *
 * Deliberately ignores the artifact's own `checks` array. A recording is only
 * evidence if its claims follow from its data; trusting a summary an editor could
 * flip to all-true would make this verifier decorative.
 */
function verifyArtifactInternally(a) {
  const step = (id) => (a.steps ?? []).find((s) => s.id === id);
  const bal = a.balances ?? {};

  const premature = step("NEG-04");
  check(
    "premature settlement is recorded as refused with NOT_APPROVED",
    Boolean(premature) &&
      premature.expectRevert === "NOT_APPROVED" &&
      (premature.status === "reverted" || premature.status === "rejected"),
    premature ? `${premature.status} / ${premature.expectRevert}` : "step missing",
  );

  const settle = step("TX-03");
  check(
    "the settlement after approval is recorded as succeeded",
    Boolean(settle) && settle.status === "succeeded" && settle.expectRevert === null,
    settle ? settle.status : "step missing",
  );

  const decision = step("TX-DEC");
  check("an approval step exists", Boolean(decision) && decision.status === "succeeded");

  // Ordering: approval must appear before the successful settlement.
  if (decision && settle && decision.blockNumber != null && settle.blockNumber != null) {
    check(
      "approval was mined before settlement",
      decision.blockNumber <= settle.blockNumber,
      `approve #${decision.blockNumber} vs settle #${settle.blockNumber}`,
    );
  }

  // Economics: the credited amount must equal the tier's fixed payout.
  const tier = TIERS[a.policy?.tier];
  check("tier is one the contract defines", Boolean(tier), `tier ${a.policy?.tier}`);
  if (tier) {
    check(
      "recorded payout equals the tier's fixed payout",
      big(a.policy.payoutWei) === tier.payout,
      `${a.policy.payoutWei} vs ${tier.payout}`,
    );
    check(
      "private balance moved by exactly the fixed payout",
      big(bal.privateDelta) === tier.payout,
      `${bal.privateDelta} vs ${tier.payout}`,
    );
  }

  check(
    "no payout was credited to the public wallet",
    big(bal.payoutCreditedToPublicWallet) === 0n,
    `${bal.payoutCreditedToPublicWallet}`,
  );

  // Re-derive the public delta rather than trusting the recorded summary field.
  const publicDelta = big(bal.publicAfterSettlement) - big(bal.publicBeforeSettlement);
  const fee = big(bal.settlementFeeWei);
  check(
    "the public balance moved by exactly the fee it paid",
    publicDelta + fee === 0n,
    `delta ${publicDelta}, fee ${fee}`,
  );

  // Reserve accounting.
  const reserveDrop = big(a.reserve?.beforeWei) - big(a.reserve?.afterWei);
  check(
    "reserve fell by exactly the payout",
    tier ? reserveDrop === tier.payout : false,
    `${reserveDrop}`,
  );
  check("exposure was released to zero", big(a.reserve?.exposureAfterWei) === 0n);

  // Settlement route: money left the policy for the anonymizer, and reached the
  // pool. Nothing was sent to the holder.
  const route = a.settlementRoute;
  if (route) {
    const toHolder = (route.strkTransfers ?? []).filter((t) => eq(t.to, a.roles?.holder ?? "0x0"));
    check("no STRK transfer targets the public wallet", toHolder.length === 0, `${toHolder.length} found`);
    check(
      "the payout left the policy contract",
      (route.strkTransfers ?? []).some(
        (t) => eq(t.from, a.contracts?.policy) && eq(t.to, a.contracts?.anonymizer),
      ),
    );
  } else {
    check("settlement route was recorded", false, "settlementRoute missing");
  }

  // Every declared negative step must actually have failed for its stated reason.
  for (const s of a.steps ?? []) {
    if (!s.expectRevert) continue;
    check(
      `${s.id} failed for exactly ${s.expectRevert}`,
      s.matchedExpectation === true && (s.status === "reverted" || s.status === "rejected"),
      s.status,
    );
  }
}

async function main() {
  console.log("COVERT independent lifecycle verifier\n");

  let rpc = arg("rpc", process.env.VERIFY_RPC ?? "");
  let contract = arg("contract", process.env.NEXT_PUBLIC_COVERT_POLICY_ADDRESS ?? "");
  let policies = [];
  let artifact = null;

  const artifactPath = arg("artifact", null);
  if (artifactPath) {
    const full = path.isAbsolute(artifactPath) ? artifactPath : path.join(ROOT, artifactPath);
    if (!fs.existsSync(full)) {
      console.error(`artifact not found: ${artifactPath}`);
      process.exit(2);
    }
    artifact = JSON.parse(fs.readFileSync(full, "utf8"));
    rpc = rpc || artifact.network?.rpc;
    contract = contract || artifact.contracts?.policy;
    policies = [artifact.policy?.commitment].filter(Boolean);
    console.log(`artifact  ${artifactPath}`);
    console.log(`kind      ${artifact.kind}`);
    console.log(`captured  ${artifact.capturedAt}`);
    if (artifact.kind !== "MAINNET_EXECUTION") {
      console.log("note      this artifact records a LOCAL DEVNET run, not Starknet Mainnet.");
    }
  }

  const explicit = arg("policy", null);
  if (explicit) policies = [explicit];

  if (!rpc) rpc = "https://starknet-rpc.publicnode.com";
  if (!contract) {
    console.error("no policy contract address. Pass --contract, --artifact, or set NEXT_PUBLIC_COVERT_POLICY_ADDRESS.");
    process.exit(2);
  }
  if (!policies.length) {
    console.error("no policy commitment. Pass --policy or --artifact.");
    process.exit(2);
  }

  console.log(`rpc       ${rpc}`);
  console.log(`contract  ${contract}\n`);

  const provider = new RpcProvider({ nodeUrl: rpc });

  let events;
  try {
    events = await fetchEvents(provider, contract);
  } catch (e) {
    console.error(`\ncould not read events from the node: ${e?.message ?? e}`);
    if (artifact) {
      // The chain is unreachable. Fall back to checking the recording is
      // self-consistent — but RE-DERIVE the conclusions from the artifact's raw
      // steps and balances rather than trusting its own `checks` array, which an
      // editor could simply set to all-true.
      console.error("\nfalling back to artifact-internal checks. This does NOT re-verify the chain.\n");
      verifyArtifactInternally(artifact);
      console.log(`\n${passes.length} checks passed, ${failures.length} failed.`);
      if (failures.length) {
        console.log("\nfailures:");
        for (const f of failures) console.log(`  - ${f}`);
        process.exit(1);
      }
      console.log("artifact is internally consistent. Re-run with a reachable node to verify it against the chain.");
      process.exit(0);
    }
    process.exit(2);
  }

  console.log(`read ${events.length} COVERT events from the contract.`);

  for (const policy of policies) verifyPolicy(events, policy);

  // Cross-check the artifact's own claims against what the chain just told us.
  if (artifact) {
    console.log("\ncross-checking the artifact against the chain:");
    const settle = events.find(
      (e) => e.name === "ClaimSettled" && eq(e.claim, artifact.claim?.commitment ?? "0x0"),
    );
    check("artifact's settlement appears onchain", Boolean(settle));
    if (settle) {
      check(
        "artifact's payout matches the onchain settled amount",
        settle.payout === BigInt(artifact.policy.payoutWei),
        `${settle.payout} vs ${artifact.policy.payoutWei}`,
      );
    }
  }

  console.log(`\n${passes.length} checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("lifecycle is internally consistent with the chain's own event record.");
}

main().catch((e) => {
  console.error(`verifier error: ${e?.message ?? e}`);
  process.exit(2);
});
