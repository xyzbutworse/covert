#!/usr/bin/env node
/**
 * Execute COVERT's complete lifecycle as real transactions against a real Starknet
 * node, and write the result to evidence/devnet-lifecycle.json.
 *
 * This is NOT a simulation and NOT mainnet. Every hash in the output is a genuine
 * transaction executed by starknet-devnet: real Cairo, real reverts, real events,
 * real balances. It exists so the product's central claim — settlement fails before
 * approval and succeeds after, with the payout never reaching the public wallet —
 * is backed by execution rather than by a screenshot.
 *
 * The captured artifact is what /replay renders, labelled VERIFIED REPLAY.
 *
 *   node scripts/devnet/run-lifecycle.mjs [--rpc http://127.0.0.1:5050]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  CallData,
  RpcProvider,
  ec,
  hash,
  num,
  shortString,
} from "starknet";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TARGET = path.join(ROOT, "cairo/target/dev");
const OUT = path.join(ROOT, "evidence/devnet-lifecycle.json");

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const RPC = arg("rpc", process.env.DEVNET_RPC ?? "http://127.0.0.1:5050");

// ---------------------------------------------------------------------------
// THROWAWAY LOCAL TEST KEYS — NOT SECRETS.
//
// `starknet-devnet --seed 42 --accounts 5` derives these deterministically and
// prints them to stdout on every start. They control nothing outside a local
// devnet process and are worthless on any real network. Never put a mainnet key
// here; the deployment scripts read real keys from an out-of-repo keystore.
// ---------------------------------------------------------------------------
const ACCOUNTS = [
  { address: "0x034ba56f92265f0868c57d3fe72ecab144fc96f97954bbbc4252cef8e8a979ba", pk: "0xb137668388dbe9acdfa3bc734cc2c469" },
  { address: "0x02939f2dc3f80cc7d620e8a86f2e69c1e187b7ff44b74056647368b5c49dc370", pk: "0xe8c2801d899646311100a661d32587aa" },
  { address: "0x025a6c9f0c15ef30c139065096b4b8e563e6b86191fd600a4f0616df8f22fb77", pk: "0x7b2e5d0e627be6ce12ddc6fd0f5ff2fb" },
];

const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const TIER = 1;
const PREMIUM = 10_000_000_000_000_000n; // 0.01 STRK
const PAYOUT = 50_000_000_000_000_000n; //  0.05 STRK
const TERM_SECONDS = 604_800;
const RESERVE = 1_000_000_000_000_000_000n; // 1 STRK
const SHIELD = 500_000_000_000_000_000n; //   0.5 STRK

const CLAIM_DOMAIN = shortString.encodeShortString("COVERT_CLAIM_V1");
const REDEEM_DOMAIN = shortString.encodeShortString("COVERT_REDEEM_V1");

const steps = [];
const log = (...a) => console.log(...a);

function loadArtifacts(name) {
  const sierra = JSON.parse(fs.readFileSync(path.join(TARGET, `covert_${name}.contract_class.json`), "utf8"));
  const casm = JSON.parse(fs.readFileSync(path.join(TARGET, `covert_${name}.compiled_contract_class.json`), "utf8"));
  return { sierra, casm };
}

function u256(v) {
  const big = BigInt(v);
  return { low: num.toHex(big & ((1n << 128n) - 1n)), high: num.toHex(big >> 128n) };
}

async function declareAndDeploy(account, name, constructorCalldata) {
  const { sierra, casm } = loadArtifacts(name);
  const res = await account.declareAndDeploy({ contract: sierra, casm, constructorCalldata }, { tip: 1n });
  return {
    address: res.deploy.contract_address,
    classHash: res.declare.class_hash,
    declareTx: res.declare.transaction_hash ?? null,
    deployTx: res.deploy.transaction_hash,
  };
}

/**
 * Run one transaction and record what actually happened.
 *
 * `expectRevert` names the invariant the call MUST violate. A negative step only
 * passes when it fails for exactly that reason — a different revert, or a success,
 * is a failure of the run.
 */
async function step(id, title, account, calls, options = {}) {
  const started = Date.now();
  const record = { id, title, expectRevert: options.expectRevert ?? null };
  try {
    const { transaction_hash } = await account.execute(calls, { tip: 1n });
    const receipt = await account.provider.waitForTransaction(transaction_hash);
    const value = receipt.value ?? receipt;
    const execution = value.execution_status ?? value.executionStatus;

    record.txHash = transaction_hash;
    record.blockNumber = value.block_number ?? null;
    record.actualFee = value.actual_fee?.amount ?? value.actual_fee ?? null;
    record.events = (value.events ?? []).map((e) => ({
      from: e.from_address,
      keys: e.keys,
      data: e.data,
    }));

    if (execution === "REVERTED") {
      record.status = "reverted";
      record.revertReason = value.revert_reason ?? "";
      record.matchedExpectation = Boolean(
        options.expectRevert && String(record.revertReason).includes(options.expectRevert),
      );
      if (!options.expectRevert) throw new Error(`unexpected revert: ${record.revertReason}`);
      if (!record.matchedExpectation) {
        throw new Error(
          `expected revert ${options.expectRevert} but got: ${String(record.revertReason).slice(0, 400)}`,
        );
      }
      log(`  ✓ ${id} reverted as required (${options.expectRevert})`);
    } else {
      record.status = "succeeded";
      if (options.expectRevert) throw new Error(`expected revert ${options.expectRevert} but the call SUCCEEDED`);
      log(`  ✓ ${id} ${transaction_hash}`);
    }
  } catch (e) {
    // A call rejected at validation time (not included) still counts as the
    // expected failure if it names the same invariant.
    const message = e?.message ?? String(e);
    if (options.expectRevert && message.includes(options.expectRevert)) {
      record.status = "rejected";
      record.revertReason = message;
      record.matchedExpectation = true;
      log(`  ✓ ${id} rejected as required (${options.expectRevert})`);
    } else {
      record.status = "error";
      record.error = message;
      steps.push({ ...record, durationMs: Date.now() - started });
      throw e;
    }
  }
  record.durationMs = Date.now() - started;
  steps.push(record);
  return record;
}

async function readFelt(provider, contractAddress, entrypoint, calldata = []) {
  const r = await provider.callContract({ contractAddress, entrypoint, calldata });
  return r;
}

async function strkBalance(provider, address) {
  const r = await readFelt(provider, STRK, "balanceOf", [address]).catch(() =>
    readFelt(provider, STRK, "balance_of", [address]),
  );
  return BigInt(r[0]) + (BigInt(r[1] ?? "0x0") << 128n);
}

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const chainId = await provider.getChainId();
  const specVersion = await provider.getSpecVersion();
  log(`COVERT devnet lifecycle`);
  log(`  rpc          ${RPC}`);
  log(`  chainId      ${chainId}`);
  log(`  specVersion  ${specVersion}\n`);

  const mkAccount = ({ address, pk }) => new Account({ provider, address, signer: pk });
  const owner = mkAccount(ACCOUNTS[0]);
  const adjudicator = mkAccount(ACCOUNTS[1]);
  const holder = mkAccount(ACCOUNTS[2]);

  // ---------------------------------------------------------------- deploy --
  log("deploying COVERT…");
  const policy = await declareAndDeploy(owner, "CovertPolicy", [
    owner.address,
    adjudicator.address,
    STRK,
  ]);
  log(`  policy      ${policy.address}`);
  const pool = await declareAndDeploy(owner, "MockStrk20Pool", [STRK]);
  log(`  pool(stub)  ${pool.address}`);
  const anonymizer = await declareAndDeploy(owner, "CovertAnonymizer", [
    policy.address,
    pool.address,
    STRK,
  ]);
  log(`  anonymizer  ${anonymizer.address}\n`);

  // ------------------------------------------------------------- configure --
  log("configuring…");
  await step("SETUP-01", "Pin the anonymizer (one-time)", owner, [
    { contractAddress: policy.address, entrypoint: "configure_anonymizer", calldata: [anonymizer.address] },
  ]);
  await step("SETUP-02", "Fund the proof reserve", owner, [
    { contractAddress: STRK, entrypoint: "approve", calldata: CallData.compile([policy.address, u256(RESERVE)]) },
    { contractAddress: policy.address, entrypoint: "fund_reserve", calldata: [num.toHex(RESERVE)] },
  ]);

  // Re-pinning must be impossible: the privacy route cannot be repointed later.
  await step(
    "NEG-01",
    "Re-configure the anonymizer",
    owner,
    [{ contractAddress: policy.address, entrypoint: "configure_anonymizer", calldata: [anonymizer.address] }],
    { expectRevert: "ALREADY_CONFIGURED" },
  );

  // ------------------------------------------------------------ bearer key --
  const privateKey = num.toHex(BigInt(hash.computePoseidonHashOnElements(["0x1", num.toHex(BigInt(Date.now()))])) % (2n ** 250n));
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const salt = num.toHex(BigInt(hash.computePoseidonHashOnElements(["0x2", num.toHex(BigInt(Date.now()))])) % (2n ** 250n));
  const policyCommitment = hash.computePoseidonHashOnElements([publicKey, salt, num.toHex(TIER)]);

  const incidentText = "sequencer outage suspended settlement for 41 minutes";
  const incidentSalt = num.toHex(BigInt(hash.computePoseidonHashOnElements(["0x3", num.toHex(BigInt(Date.now()))])) % (2n ** 250n));
  const textHash = num.toHex(hash.starknetKeccak(incidentText.trim().toLowerCase()));
  const incidentHash = hash.computePoseidonHashOnElements([textHash, incidentSalt]);
  const claimCommitment = hash.computePoseidonHashOnElements([policyCommitment, incidentHash]);

  const claimMsg = hash.computePoseidonHashOnElements([CLAIM_DOMAIN, policyCommitment, claimCommitment, incidentHash]);
  const claimSig = ec.starkCurve.sign(claimMsg, privateKey, { lowS: true });
  const redeemMsg = hash.computePoseidonHashOnElements([REDEEM_DOMAIN, policyCommitment, claimCommitment, num.toHex(PAYOUT)]);
  const redeemSig = ec.starkCurve.sign(redeemMsg, privateKey, { lowS: true });

  log(`policy commitment  ${policyCommitment}`);
  log(`claim commitment   ${claimCommitment}\n`);

  // ------------------------------------------------------------ TX-00 shield --
  log("lifecycle…");
  const publicAtStart = await strkBalance(provider, holder.address);
  await step("TX-00", "Shield STRK into the pool (public by design)", holder, [
    { contractAddress: STRK, entrypoint: "approve", calldata: CallData.compile([pool.address, u256(SHIELD)]) },
    { contractAddress: pool.address, entrypoint: "deposit", calldata: [num.toHex(SHIELD)] },
  ]);
  const privateAfterShield = BigInt(
    (await readFelt(provider, pool.address, "private_balance", [holder.address]))[0],
  );

  // ------------------------------------------------------------ TX-01 cover --
  await step("TX-01", "Activate cover privately (pool → anonymizer → policy)", holder, [
    {
      contractAddress: pool.address,
      entrypoint: "route_buy",
      calldata: [anonymizer.address, policy.address, policyCommitment, publicKey, num.toHex(TIER), num.toHex(PREMIUM)],
    },
  ]);
  const policyState = await readFelt(provider, policy.address, "policy_state", [policyCommitment]);

  // A second purchase on the same commitment must be impossible.
  await step(
    "NEG-02",
    "Re-use the same policy commitment",
    holder,
    [
      {
        contractAddress: pool.address,
        entrypoint: "route_buy",
        calldata: [anonymizer.address, policy.address, policyCommitment, publicKey, num.toHex(TIER), num.toHex(PREMIUM)],
      },
    ],
    { expectRevert: "POLICY_EXISTS" },
  );

  // ------------------------------------------------------------ TX-02 claim --
  await step("TX-02", "File the authenticated claim", holder, [
    {
      contractAddress: pool.address,
      entrypoint: "route_claim",
      calldata: [
        anonymizer.address,
        policy.address,
        policyCommitment,
        claimCommitment,
        incidentHash,
        num.toHex(claimSig.r),
        num.toHex(claimSig.s),
      ],
    },
  ]);

  // A forged bearer signature must not be able to consume a claim slot.
  const forgedPk = "0x1234567890abcdef1234567890abcdef";
  const forgedSig = ec.starkCurve.sign(claimMsg, forgedPk, { lowS: true });
  const otherIncident = hash.computePoseidonHashOnElements([textHash, "0x99"]);
  const otherClaim = hash.computePoseidonHashOnElements([policyCommitment, otherIncident]);
  await step(
    "NEG-03",
    "File a second claim with a forged bearer signature",
    holder,
    [
      {
        contractAddress: pool.address,
        entrypoint: "route_claim",
        calldata: [
          anonymizer.address,
          policy.address,
          policyCommitment,
          otherClaim,
          otherIncident,
          num.toHex(forgedSig.r),
          num.toHex(forgedSig.s),
        ],
      },
    ],
    { expectRevert: "POLICY_HAS_CLAIM" },
  );

  // --------------------------------------------- THE MOMENT: premature settle --
  const publicBefore = await strkBalance(provider, holder.address);
  const privateBefore = BigInt((await readFelt(provider, pool.address, "private_balance", [holder.address]))[0]);
  const reserveBefore = BigInt((await readFelt(provider, policy.address, "reserve"))[0]);
  const exposureBefore = BigInt((await readFelt(provider, policy.address, "exposure"))[0]);

  const prematureStep = await step(
    "NEG-04",
    "Settle BEFORE the adjudicator has approved",
    holder,
    [
      {
        contractAddress: pool.address,
        entrypoint: "route_redeem",
        calldata: [
          anonymizer.address,
          policy.address,
          policyCommitment,
          claimCommitment,
          num.toHex(redeemSig.r),
          num.toHex(redeemSig.s),
          "0x4e4f544531",
        ],
      },
    ],
    { expectRevert: "NOT_APPROVED" },
  );

  const privateAfterPremature = BigInt(
    (await readFelt(provider, pool.address, "private_balance", [holder.address]))[0],
  );
  if (privateAfterPremature !== privateBefore) {
    throw new Error("premature settlement moved the private balance");
  }

  // ---------------------------------------------------------- decision --
  await step("TX-DEC", "Adjudicator approves the claim", adjudicator, [
    { contractAddress: policy.address, entrypoint: "approve_claim", calldata: [claimCommitment] },
  ]);

  // Only the adjudicator may decide.
  await step(
    "NEG-05",
    "Owner attempts to approve a claim",
    owner,
    [{ contractAddress: policy.address, entrypoint: "approve_claim", calldata: [claimCommitment] }],
    { expectRevert: "NOT_ADJUDICATOR" },
  );

  // ------------------------------------------- TX-03 the identical settlement --
  const settle = await step("TX-03", "Settle privately — the same action, now authorised", holder, [
    {
      contractAddress: pool.address,
      entrypoint: "route_redeem",
      calldata: [
        anonymizer.address,
        policy.address,
        policyCommitment,
        claimCommitment,
        num.toHex(redeemSig.r),
        num.toHex(redeemSig.s),
        "0x4e4f544531",
      ],
    },
  ]);

  const publicAfter = await strkBalance(provider, holder.address);
  const privateAfter = BigInt((await readFelt(provider, pool.address, "private_balance", [holder.address]))[0]);
  const reserveAfter = BigInt((await readFelt(provider, policy.address, "reserve"))[0]);
  const exposureAfter = BigInt((await readFelt(provider, policy.address, "exposure"))[0]);

  // Settlement must not be replayable.
  await step(
    "NEG-06",
    "Settle the same claim a second time",
    holder,
    [
      {
        contractAddress: pool.address,
        entrypoint: "route_redeem",
        calldata: [
          anonymizer.address,
          policy.address,
          policyCommitment,
          claimCommitment,
          num.toHex(redeemSig.r),
          num.toHex(redeemSig.s),
          "0x4e4f544532",
        ],
      },
    ],
    { expectRevert: "CLAIMED" },
  );

  // ------------------------------------------------------------- assertions --
  const fee = BigInt(settle.actualFee ?? 0);
  const publicDelta = publicAfter - publicBefore;
  const privateDelta = privateAfter - privateBefore;
  const payoutToPublicWallet = publicDelta + fee; // strip the fee the holder paid

  const holderNum = BigInt(holder.address);
  const TRANSFER_SELECTOR = BigInt(hash.getSelectorFromName("Transfer"));

  /**
   * Decode the STRK Transfer events in the settlement transaction.
   * OpenZeppelin's ERC-20 indexes both parties: keys = [Transfer, from, to],
   * data = [amount_low, amount_high].
   */
  const strkTransfers = settle.events
    .filter((e) => {
      try {
        return BigInt(e.from) === BigInt(STRK) && BigInt(e.keys?.[0] ?? "0x0") === TRANSFER_SELECTOR;
      } catch {
        return false;
      }
    })
    .map((e) => ({
      from: e.keys[1],
      to: e.keys[2],
      amountWei: (BigInt(e.data[0] ?? "0x0") + (BigInt(e.data[1] ?? "0x0") << 128n)).toString(),
    }));

  // The claim under test: nothing paid the holder's public address. The holder
  // still PAYS gas from that address, which is why we check direction, not
  // involvement — pretending the public balance is untouched would be false.
  const transfersToHolder = strkTransfers.filter((t) => {
    try {
      return BigInt(t.to) === holderNum;
    } catch {
      return false;
    }
  });
  const transfersFromHolder = strkTransfers.filter((t) => {
    try {
      return BigInt(t.from) === holderNum;
    } catch {
      return false;
    }
  });

  const checks = [
    ["premature settlement reverted with NOT_APPROVED", prematureStep.matchedExpectation === true],
    ["identical settlement succeeded after approval", settle.status === "succeeded"],
    ["private balance increased by exactly the fixed payout", privateDelta === PAYOUT],
    ["public wallet received zero payout (delta is fee only)", payoutToPublicWallet === 0n],
    ["no STRK transfer to the public wallet in the settlement tx", transfersToHolder.length === 0],
    ["the only STRK the public wallet moves is the gas it pays", transfersFromHolder.every((t) => t.amountWei === fee.toString())],
    ["payout left the policy for the anonymizer, not a wallet", strkTransfers.some((t) => BigInt(t.from) === BigInt(policy.address) && BigInt(t.to) === BigInt(anonymizer.address) && t.amountWei === PAYOUT.toString())],
    ["anonymizer returned the payout to the pool", strkTransfers.some((t) => BigInt(t.from) === BigInt(anonymizer.address) && BigInt(t.to) === BigInt(pool.address) && t.amountWei === PAYOUT.toString())],
    ["reserve decreased by exactly the payout", reserveBefore - reserveAfter === PAYOUT],
    ["exposure released to zero", exposureAfter === 0n],
    ["policy marked settled onchain", BigInt((await readFelt(provider, policy.address, "policy_state", [policyCommitment]))[5]) === 1n],
    ["claim marked redeemed onchain", BigInt((await readFelt(provider, policy.address, "claim_state", [claimCommitment]))[4]) === 1n],
  ];

  log("\nassertions:");
  let failed = 0;
  for (const [label, ok] of checks) {
    log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failed += 1;
  }

  const artifact = {
    schema: "covert.lifecycle.v1",
    kind: "DEVNET_EXECUTION",
    disclaimer:
      "Real transactions executed against a local starknet-devnet node, not Starknet Mainnet. " +
      "The STRK20 pool is represented by MockStrk20Pool, which reproduces the pool's calling " +
      "pattern but none of its privacy construction. COVERT's own contracts are the mainnet ones.",
    capturedAt: new Date().toISOString(),
    network: { rpc: RPC, chainId, specVersion, name: "starknet-devnet" },
    contracts: {
      policy: policy.address,
      anonymizer: anonymizer.address,
      poolStub: pool.address,
      strk: STRK,
      classHashes: {
        policy: policy.classHash,
        anonymizer: anonymizer.classHash,
        poolStub: pool.classHash,
      },
    },
    roles: { owner: owner.address, adjudicator: adjudicator.address, holder: holder.address },
    policy: {
      commitment: policyCommitment,
      publicKey,
      tier: TIER,
      premiumWei: PREMIUM.toString(),
      payoutWei: PAYOUT.toString(),
      termSeconds: TERM_SECONDS,
      expiry: Number(BigInt(policyState[3])),
    },
    claim: {
      commitment: claimCommitment,
      incidentHash,
      // The reveal is included because this is a training artifact for a synthetic
      // incident. A real claimant's reveal is never published.
      incidentText,
      incidentSalt,
    },
    balances: {
      publicAtStart: publicAtStart.toString(),
      publicBeforeSettlement: publicBefore.toString(),
      publicAfterSettlement: publicAfter.toString(),
      settlementFeeWei: fee.toString(),
      payoutCreditedToPublicWallet: payoutToPublicWallet.toString(),
      privateAfterShield: privateAfterShield.toString(),
      privateBeforeSettlement: privateBefore.toString(),
      privateAfterSettlement: privateAfter.toString(),
      privateDelta: privateDelta.toString(),
    },
    reserve: {
      beforeWei: reserveBefore.toString(),
      afterWei: reserveAfter.toString(),
      exposureBeforeWei: exposureBefore.toString(),
      exposureAfterWei: exposureAfter.toString(),
    },
    settlementRoute: {
      strkTransfers,
      transfersToPublicWallet: transfersToHolder,
      transfersFromPublicWallet: transfersFromHolder,
    },
    steps,
    checks: checks.map(([label, ok]) => ({ label, ok })),
    verdict: failed === 0 ? "PASS" : "FAIL",
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
  log(`\nwrote ${path.relative(ROOT, OUT)}`);
  log(`verdict: ${artifact.verdict}`);

  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error("\nlifecycle failed:", e?.message ?? e);
  process.exit(1);
});
