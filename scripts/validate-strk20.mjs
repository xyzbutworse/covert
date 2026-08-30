import fs from "node:fs";
const data = JSON.parse(fs.readFileSync("strk20.json","utf8"));
const missing=[];
if(!Array.isArray(data.transactions)||data.transactions.length<3) missing.push("at least 3 real Starknet mainnet transaction hashes");
if(!Array.isArray(data.contracts)||data.contracts.length<2) missing.push("the deployed COVERT policy + anonymizer contract addresses");
if(!data.demo_video) missing.push("3-minute demo video URL");
if(missing.length){console.error("COVERT is not submission-ready:\n- "+missing.join("\n- "));process.exit(1)}
if(!data.demo_url) console.warn("Note: demo_url is not populated. Keep it empty only if the hackathon manifest treats it as optional; otherwise add the live product URL.");
console.log("strk20.json has COVERT's minimum scoring evidence populated. Inspect every hash/address before submission; this script does not verify chain semantics.");
