"use client";
import { useEffect, useMemo, useState } from "react";
import { TIERS, WEI } from "@/lib/config";
import { loadPolicyKeys, makeIncidentCommitment, saveClaimDraft } from "@/lib/covert/key";
import { privateStrkBalanceWei, readClaimState, redeemClaim, submitClaim } from "@/lib/covert/actions";
import type { ClaimDraft, LocalPolicyKey, TxReceipt as TR } from "@/lib/covert/types";
import TxReceipt from "@/components/TxReceipt";
import { useWallet } from "@/lib/wallet/store";

function strk(wei: bigint | null) { return wei === null ? null : Number(wei) / Number(WEI); }

export default function Claim(){
 const [keys,setKeys]=useState<LocalPolicyKey[]>([]);
 const [selected,setSelected]=useState("");
 const [incident,setIncident]=useState("RPC outage caused a verifiable service interruption");
 const [claimCommitment,setClaimCommitment]=useState("");
 const [incidentSalt,setIncidentSalt]=useState("");
 const [incidentHash,setIncidentHash]=useState("");
 const [submitR,setSubmitR]=useState<TR>({state:"idle"});
 const [redeemR,setRedeemR]=useState<TR>({state:"idle"});
 const [decision,setDecision]=useState<number|null>(null);
 const [before,setBefore]=useState<bigint|null>(null);
 const [after,setAfter]=useState<bigint|null>(null);
 const [draft,setDraft]=useState<ClaimDraft|null>(null);
 const [copyState,setCopyState]=useState("");
 const connected=useWallet(s=>s.connected);

 useEffect(()=>{const k=loadPolicyKeys();setKeys(k);if(k[0])setSelected(k[0].commitment)},[]);
 const key=useMemo(()=>keys.find(k=>k.commitment===selected),[keys,selected]);
 const tier=key?TIERS.find(t=>t.id===key.tier):undefined;

 async function refreshDecision(c=claimCommitment){if(!c)return;try{const state=await readClaimState(c);setDecision(state.exists?state.decision:null);}catch{setDecision(null)}}
 async function file(){
  if(!key)return;
  try{
   const c=makeIncidentCommitment(key.commitment,incident);setClaimCommitment(c.claimCommitment);setIncidentSalt(c.incidentSalt);setIncidentHash(c.incidentHash);
   setSubmitR({state:"pending",title:"Authenticating and filing claim…",detail:"The bearer key signs this exact claim before COVERT will consume the policy's one-claim slot."});
   const h=await submitClaim(key,c.claimCommitment,c.incidentHash);
   const nextDraft={policyCommitment:key.commitment,claimCommitment:c.claimCommitment,incidentHash:c.incidentHash,incidentSalt:c.incidentSalt,incidentText:incident,createdAt:Date.now(),submitTx:h};
   saveClaimDraft(nextDraft);setDraft(nextDraft);
   setSubmitR({state:"success",title:"Claim filed — awaiting review",hash:h,detail:"The incident text stays offchain. The public commitment is salted, and the contract has authenticated the policy bearer."});
   setDecision(0);
  }catch(e:any){setSubmitR({state:"error",title:"Claim submission failed",detail:e.message})}
 }
 async function copyVerifierPacket(){
  if(!draft)return;
  try{await navigator.clipboard.writeText(JSON.stringify({version:1,...draft},null,2));setCopyState("COPIED — SEND PRIVATELY TO VERIFIER");setTimeout(()=>setCopyState(""),2500)}catch{setCopyState("COPY FAILED — COPY THE PACKAGE MANUALLY")}
 }
 async function redeem(){
  if(!key||!claimCommitment)return;
  try{
   setRedeemR({state:"pending",title:"Attempting private settlement…",detail:"Before approval this should fail. After approval, the same action returns the fixed payout into an STRK20 open note."});
   const b=await privateStrkBalanceWei().catch(()=>null);setBefore(b);
   const h=await redeemClaim(key,claimCommitment);
   const a=await privateStrkBalanceWei().catch(()=>null);setAfter(a);
   setRedeemR({state:"success",title:"Claim settled privately",hash:h,detail:"COVERT paid the anonymizer, which returned the fixed payout to STRK20 instead of paying the public wallet directly."});
   await refreshDecision();
  }catch(e:any){setRedeemR({state:"error",title:"SETTLEMENT BLOCKED",detail:e.message});await refreshDecision()}
 }

 const label=decision===0?"PENDING REVIEW":decision===1?"APPROVED":decision===2?"DENIED":"NOT CHECKED";
 const delta=before!==null&&after!==null?after-before:null;
 return <section className="product-page">
  <div className="page-head"><div><span className="section-kicker">FILE CLAIM</span><h1>Prove the incident.<br/>Keep the beneficiary private.</h1></div><p>COVERT authenticates the private policy bearer before a claim exists. The adjudicator decides validity, but cannot change the fixed payout.</p></div>
  <div className="claim-progress"><div className="active"><span>01</span><b>FILE</b></div><div className={decision===1?"active":""}><span>02</span><b>APPROVE</b></div><div className={redeemR.state==="success"?"active":""}><span>03</span><b>GET PAID</b></div></div>
  <div className="claim-stack">
   <div className="panel"><div className="panel-head"><span>POLICY</span><b>BEARER KEY</b></div>{keys.length?<select value={selected} onChange={e=>{setSelected(e.target.value);setClaimCommitment("");setDecision(null);setDraft(null)}}>{keys.map(k=><option key={k.commitment} value={k.commitment}>{k.commitment.slice(0,18)}… / Tier {k.tier}</option>)}</select>:<div className="empty">No local COVERT policy key. Activate cover in this browser first.</div>}{key&&<div className="policy-mini"><span>Fixed payout</span><b>{tier?.payout.toFixed(2)} STRK</b><span>Identity</span><b>NOT ATTACHED</b></div>}</div>
   <div className="panel"><div className="panel-head"><span>INCIDENT</span><b>SALTED COMMITMENT</b></div><textarea value={incident} onChange={e=>setIncident(e.target.value)} rows={4}/><button className="primary wide" onClick={file} disabled={!connected||!key}>File authenticated claim</button><TxReceipt receipt={submitR}/>{claimCommitment&&<div className="reveal-pack"><span>PRIVATE REVEAL PACKAGE — SEND ONLY TO THE VERIFIER</span><code>claim {claimCommitment}</code><code>salt {incidentSalt}</code><code>incident {incident}</code><button className="reveal-copy" onClick={copyVerifierPacket} disabled={!draft}>{copyState||"Copy verifier packet"}</button><small>The packet lets a verifier recompute the salted incident commitment in a separate browser before approving.</small></div>}</div>
   <div className="panel settlement-panel"><div className="panel-head"><span>SETTLEMENT</span><b className={`decision d${decision??9}`}>{label}</b></div><p>Try settlement before approval: it should fail onchain. Once the verifier approves the claim, the exact same action can produce the private payout.</p><div className="settlement-actions"><button className="ghost" onClick={()=>refreshDecision()} disabled={!claimCommitment}>Refresh status</button><button className="secondary" onClick={redeem} disabled={!connected||!key||!claimCommitment}>Receive payout privately</button></div><TxReceipt receipt={redeemR}/></div>
  </div>
  {redeemR.state==="success"&&<div className="magic-moment"><div className="magic-title"><span>CLAIM APPROVED → SETTLEMENT COMPLETE</span><b>THE WALLET TRAIL STOPS HERE.</b></div><div className="magic-grid"><div><small>DIRECT PUBLIC PAYOUT</small><strong>0.00 STRK</strong><p>Policy pays the COVERT anonymizer, not the user's public address.</p></div><div className="private-balance"><small>PRIVATE BALANCE</small><strong>{delta!==null?`+${strk(delta)?.toFixed(4)} STRK`:`+${tier?.payout.toFixed(2)} STRK`}</strong><p>{before!==null&&after!==null?`${strk(before)?.toFixed(4)} → ${strk(after)?.toFixed(4)} STRK`:`Refresh the privacy wallet to inspect the new note.`}</p></div><div><small>BENEFICIARY</small><strong>NOT EXPOSED</strong><p>The settlement destination is represented by the STRK20 note flow.</p></div></div></div>}
  <div className="privacy-note"><b>What privacy means here</b><p>COVERT hides the protected wallet and the payout destination from the public settlement path. It does not hide the initial shield, block timestamps, or that your wallet interacts with the STRK20 pool — timing and amount correlation can still exist.</p></div>
 </section>;
}
