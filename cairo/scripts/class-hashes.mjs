// Compute COVERT contract class hashes from the current scarb build artifacts.
// Usage: node scripts/class-hashes.mjs   (after `scarb build`)
// Run this from cairo/. These hashes are what `sncast declare` submits; they are
// deterministic for the exact build, so record them in the deployment log.
import fs from "node:fs";
import { hash } from "starknet";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
if (!root.endsWith("cairo")) {
  console.error("Run from the cairo/ directory (after scarb build).");
  process.exit(1);
}

const target = `${root}/target/dev`;
for (const name of ["covert_CovertPolicy", "covert_CovertAnonymizer"]) {
  const sierraPath = `${target}/${name}.contract_class.json`;
  const compiledPath = `${target}/${name}.compiled_contract_class.json`;
  if (!fs.existsSync(sierraPath) || !fs.existsSync(compiledPath)) {
    console.error(`Missing artifact for ${name}; run scarb build first.`);
    process.exit(1);
  }
  const sierra = JSON.parse(fs.readFileSync(sierraPath, "utf8"));
  const compiled = JSON.parse(fs.readFileSync(compiledPath, "utf8"));
  console.log(`${name}:`);
  console.log(`  sierra class hash   : ${hash.computeSierraContractClassHash(sierra)}`);
  console.log(`  compiled class hash : ${hash.computeCompiledClassHash(compiled)}`);
}