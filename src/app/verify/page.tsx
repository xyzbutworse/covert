"use client";
import { useEffect, useMemo, useState } from "react";
import { approveClaim, denyClaim, readAdjudicator, readClaimState } from "@/lib/covert/actions";
import { loadClaimDrafts, saveClaimDraft, verifyIncidentReveal } from "@/lib/covert/key";
import type { ClaimDraft, TxReceipt as TR } from "@/lib/covert/types";
import TxReceipt from "@/components/TxReceipt";
import { useWallet } from "@/lib/wallet/store";

function sameFelt(a:string|undefined,b:string|undefined){try{return Boolean(a&&b)&&BigInt(a!)===BigInt(b!)}catch{return false}}
function isClaimPacket(x:unknown):x is ClaimDraft{
 if(!x||typeof x!=="object")return false;
 const v=x as Record<string,unknown>;
 return ["policyCommitment","claimCommitment","incidentHash","incidentSalt","incidentText"].every(k=>typeof v[k]==="string")&&typeof v.createdAt==="number";
}

type ChainState={exists:boolean;policyCommitment:string;incidentHash:string;decision:number;redeemed:boolean};

export default function Verify(){
 const [claims,setClaims]=useState<ClaimDraft[]>([]);
 const [selected,setSelected]=useState("");
 const [state,setState]=useState<ChainState|null>(null);
 const [adjudicator,setAdjudicator]=useState("");
 const [receipt,setReceipt]=useState<TR>({state:"idle"});
 const [packetText,setPacketText]=useState("");
 const [packetError,setPacketError]=useState("");
 const address=useWallet(s=>s.address); const connected=useWallet(s=>s.connected);
 useEffect(()=>{const c=loadClaimDrafts();setClaims(c);if(c[0])setSelected(c[0].claimCommitment);readAdjudicator().then(setAdjudicator).catch(()=>{})},[]);
 const claim=useMemo(()=>claims.find(c=>c.claimCommitment===selected),[claims,selected]);
 const authorized=connected&&adjudicator&&sameFelt(address,adjudicator);
 const reveal=useMemo(()=>claim?verifyIncidentReveal(claim):null,[claim]);
 const onchainMatches=Boolean(claim&&state?.exists&&sameFelt(state.policyCommitment,claim.policyCommitment)&&sameFelt(state.incidentHash,claim.incidentHash));
 const revealValid=Boolean(reveal?.incidentMatches&&reveal?.claimMatches&&onchainMatches);
 async function refresh(){if(!selected)return;try{const s=await readClaimState(selected);setState(s)}catch{setState(null)}}
 useEffect(()=>{setState(null);if(selected)refresh()},[selected]);
 function importPacket(){
  setPacketError("");
  try{
   const parsed=JSON.parse(packetText);
   if(!isClaimPacket(parsed))throw new Error("Packet is missing required COVERT reveal fields.");
   const check=verifyIncidentReveal(parsed);
   if(!check.incidentMatches||!check.claimMatches)throw new Error("Reveal package does not reproduce its commitments. Do not approve it.");
   saveClaimDraft(parsed);
   const next=[parsed,...loadClaimDrafts().filter(x=>x.claimCommitment!==parsed.claimCommitment)];
   setClaims(next);setSelected(parsed.claimCommitment);setPacketText("");
  }catch(e:any){setPacketError(e?.message??"Invalid verifier packet.")}
 }
 async function decide(kind:"approve"|"deny"){
  if(!selected||!revealValid)return;
  try{setReceipt({state:"pending",title:kind==="approve"?"Approving claim…":"Denying claim…"});const h=kind==="approve"?await approveClaim(selected):await denyClaim(selected);setReceipt({state:"success",title:kind==="approve"?"Claim approved":"Claim denied",hash:h,detail:"Decision recorded by the dedicated adjudicator role. The payout amount remains fixed by the policy tier."});await refresh()}catch(e:any){setReceipt({state:"error",title:"Decision failed",detail:e.message})}
 }
 const decision=state?.decision===0?"PENDING":state?.decision===1?"APPROVED":state?.decision===2?"DENIED":"UNKNOWN";
 return <section className="product-page">
  <div className="page-head"><div><span className="section-kicker">VERIFY CLAIM</span><h1>Decide validity.<br/>Never invent the payout.</h1></div><p>The verifier receives a private reveal package, recomputes its commitments, checks them against onchain state, then can approve or deny. A mismatched reveal cannot be approved from this interface.</p></div>
  <div className="verifier-import panel"><div className="panel-head"><span>VERIFIER PACKET</span><b>CROSS-BROWSER HANDOFF</b></div><textarea rows={5} placeholder='Paste the private JSON packet from the claimant browser' value={packetText} onChange={e=>setPacketText(e.target.value)}/><div className="settlement-actions"><button className="secondary" onClick={importPacket} disabled={!packetText.trim()}>Import + verify packet</button></div>{packetError&&<div className="error">{packetError}</div>}<p className="muted">This packet contains the incident reveal and salt. Share it with the adjudicator out of band; it is not meant for public storage.</p></div>
  <div className="verify-layout">
   <div className="panel"><div className="panel-head"><span>CLAIM QUEUE</span><b>{claims.length} REVEAL{claims.length===1?"":"S"}</b></div>{claims.length?<div className="claim-list">{claims.map(c=><button className={selected===c.claimCommitment?"active":""} key={c.claimCommitment} onClick={()=>setSelected(c.claimCommitment)}><span>{c.claimCommitment.slice(0,16)}…</span><small>{new Date(c.createdAt).toLocaleString()}</small></button>)}</div>:<div className="empty">No reveal packages yet. Paste the private verifier packet above.</div>}</div>
   <div className="panel verify-card"><div className="panel-head"><span>CLAIM REVIEW</span><b className={`decision d${state?.decision??9}`}>{decision}</b></div>{claim?<><div className="verify-row"><span>Claim commitment</span><code>{claim.claimCommitment}</code></div><div className="verify-row"><span>Policy commitment</span><code>{claim.policyCommitment}</code></div><div className="verify-row"><span>Bearer authentication</span><b>{state?.exists?"ACCEPTED ONCHAIN":"PENDING CHAIN READ"}</b></div><div className="verify-row"><span>Incident reveal</span><b className={reveal?.incidentMatches?"proof-pass":"proof-fail"}>{reveal?.incidentMatches?"COMMITMENT MATCH":"MISMATCH"}</b></div><div className="verify-row"><span>Claim binding</span><b className={reveal?.claimMatches?"proof-pass":"proof-fail"}>{reveal?.claimMatches?"POLICY + INCIDENT MATCH":"MISMATCH"}</b></div><div className="verify-row"><span>Onchain packet</span><b className={onchainMatches?"proof-pass":"proof-fail"}>{onchainMatches?"MATCH":"MISMATCH / PENDING"}</b></div><div className="evidence-reveal"><span>PRIVATE REVEAL</span><p>{claim.incidentText}</p><code>salt {claim.incidentSalt}</code><code>committed hash {claim.incidentHash}</code>{reveal&&!reveal.incidentMatches&&<code>recomputed {reveal.recomputedIncidentHash}</code>}</div><div className="role-check"><span>Connected role</span><b>{authorized?"ADJUDICATOR VERIFIED":connected?"NOT THE ADJUDICATOR":"CONNECT ADJUDICATOR"}</b>{adjudicator&&<code>{adjudicator}</code>}</div>{!revealValid&&<div className="integrity-block">APPROVAL LOCKED — the private reveal must reproduce both commitments and match the onchain claim.</div>}<div className="decision-actions"><button className="ghost" disabled={!authorized||state?.decision!==0||!revealValid} onClick={()=>decide("deny")}>Deny claim</button><button className="primary" disabled={!authorized||state?.decision!==0||!revealValid} onClick={()=>decide("approve")}>Approve claim</button></div><TxReceipt receipt={receipt}/></>:<div className="empty">Select or import a claim.</div>}</div>
  </div>
  <div className="privacy-note"><b>Trust boundary</b><p>The adjudicator sees voluntarily revealed incident evidence and can only choose approve or deny. The contract owns policy duration, ownership, reserve accounting and the fixed payout.</p></div>
 </section>;
}
