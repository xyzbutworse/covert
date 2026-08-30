import { STRK20_MAINNET_POOL, VOYAGER } from "@/lib/config";
import manifest from "../../../strk20.json";

const labels=[
 ["TX-01","PRIVATE POLICY PURCHASE","STRK20 → COVERT Anonymizer → PolicyPurchased"],
 ["TX-02","AUTHENTICATED CLAIM","STRK20 → COVERT Anonymizer → ClaimSubmitted"],
 ["TX-03","PRIVATE SETTLEMENT","Policy → Anonymizer → OpenNoteDeposit → STRK20"],
] as const;
const recordedHash=(v:string|undefined)=>Boolean(v&&/^0x[0-9a-fA-F]{20,}$/.test(v));

export default function Proof(){
 const txs=manifest.transactions as string[];
 const recorded=labels.map((_,i)=>recordedHash(txs[i]));
 const allRecorded=recorded.every(Boolean);
 const contractsRecorded=manifest.contracts.length>=2;
 const checks=[
  ["Scored hashes",allRecorded,"Three candidate mainnet transaction hashes are recorded. The hackathon verifier still decides whether they succeeded and touched the live STRK20 pool."],
  ["Declared contracts",contractsRecorded,"COVERT policy and anonymizer addresses are recorded for project-contract traversal checks."],
  ["Authenticated claim candidate",recorded[1],"TX-02 is reserved for the bearer-authenticated claim path."],
  ["Fixed settlement candidate",recorded[2],"TX-03 is reserved for the contract-bounded fixed payout path."],
  ["Private return candidate",recorded[2],"TX-03 is expected to return an OpenNoteDeposit to STRK20; inspect chain evidence rather than trusting this UI."],
 ];
 return <section className="product-page proof-page">
  <div className="page-head"><div><span className="section-kicker">PROOF CENTRE</span><h1>Don't trust the pitch.<br/>Inspect the consequence.</h1></div><p>This page distinguishes recorded evidence from verified evidence. A hash appearing here means it was entered into the official manifest — not that COVERT has self-certified what happened onchain.</p></div>
  <div className="consequence-card"><div><span>DIRECT PUBLIC PAYOUT</span><b>0.00 STRK TARGET</b></div><div className="private"><span>PRIVATE SETTLEMENT</span><b>{recorded[2]?"HASH RECORDED":"PENDING"}</b></div><div><span>BENEFICIARY</span><b>NOT IN POLICY PAYOUT PATH</b></div></div>
  <div className="proof-layout">
   <div className="proof-card"><div className="proof-id">FORGE 1.0 / EVIDENCE STATES</div><h2>{allRecorded&&contractsRecorded?"SUBMISSION EVIDENCE RECORDED":"MAINNET EVIDENCE PENDING"}</h2>{checks.map(([t,ok,d])=><div className={`proof-check ${ok?"recorded":"pending"}`} key={String(t)}><span>{ok?"●":"·"}</span><div><b>{String(t)}</b><p>{String(d)}</p><small>{ok?"RECORDED — INSPECT / VERIFY":"PENDING REAL EXECUTION"}</small></div></div>)}</div>
   <aside className="proof-side"><div><span>NETWORK</span><b>{allRecorded?"STARKNET MAINNET / HASHES RECORDED":"STARKNET MAINNET / TARGET"}</b></div><div><span>STRK20 POOL</span><code>{STRK20_MAINNET_POOL.slice(0,14)}…{STRK20_MAINNET_POOL.slice(-8)}</code></div><div><span>DECLARED CONTRACTS</span><b>{manifest.contracts.length}/2+</b></div><div><span>PUBLIC DEMO</span><b>{manifest.demo_url?"RECORDED":"OPTIONAL / PENDING"}</b></div><div><span>3-MIN VIDEO</span><b>{manifest.demo_video?"RECORDED":"PENDING"}</b></div><p>The official verifier and linked explorer traces are the authority. COVERT does not turn a populated JSON field into a green “verified” badge.</p></aside>
  </div>
  <div className="tx-proof-list">{labels.map(([id,title,path],i)=>{const h=txs[i];const ok=recordedHash(h);return <div className="tx-proof" key={id}><span>{id}</span><div><b>{title}</b><p>{path}</p></div>{ok?<a href={`${VOYAGER}/${h}`} target="_blank" rel="noreferrer">Inspect candidate ↗</a>:<strong>PENDING MAINNET</strong>}</div>})}</div>
  <div className="adversarial-strip"><span>ADVERSARIAL CONTROLS</span><div><b>Payout before approval</b><em>TEST TARGET</em></div><div><b>Invalid bearer signature</b><em>TEST TARGET</em></div><div><b>Duplicate claim</b><em>TEST TARGET</em></div><div><b>Client-set expiry</b><em>CODE-GATED</em></div></div>
 </section>;
}
