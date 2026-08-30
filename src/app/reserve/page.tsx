"use client";
import { useEffect, useState } from "react";
import { ANONYMIZER_ADDRESS, POLICY_ADDRESS, TIERS, WEI } from "@/lib/config";
import { readReserveState } from "@/lib/covert/actions";

const fmt=(v:bigint|null)=>v===null?"PENDING":`${(Number(v)/Number(WEI)).toFixed(4)} STRK`;

export default function Reserve(){
 const [reserve,setReserve]=useState<bigint|null>(null);const [exposure,setExposure]=useState<bigint|null>(null);const [invokes,setInvokes]=useState<bigint|null>(null);const [error,setError]=useState("");
 async function refresh(){try{const s=await readReserveState();setReserve(s.reserve);setExposure(s.exposure);setInvokes(s.invokes);setError("")}catch(e:any){setError(e.message)}}
 useEffect(()=>{refresh()},[]);
 const solvency=reserve!==null&&exposure!==null&&exposure>0n?Number(reserve)*100/Number(exposure):reserve!==null?100:null;
 return <section className="product-page">
  <div className="page-head"><div><span className="section-kicker">PUBLIC RESERVE</span><h1>Private beneficiary.<br/>Public solvency.</h1></div><p>COVERT hides the wallet relationship, not the economic rules. Reserve, fixed exposure, tiers and claim state stay inspectable.</p></div>
  <div className="reserve-hero"><div><span>LIVE CONTRACT RULE</span><strong>RESERVE ≥ OUTSTANDING EXPOSURE</strong><p>New cover reverts if the fixed payout would push exposure beyond available reserve. No frontend override exists.</p><button className="ghost inverse" onClick={refresh}>Refresh onchain state</button></div><div className="ring"><span>{solvency===null?"—":`${Math.floor(solvency)}%`}</span><small>{solvency===null?"awaiting deployment":"solvency"}</small></div></div>
  <div className="live-metrics"><div><span>RESERVE</span><b>{fmt(reserve)}</b></div><div><span>EXPOSURE</span><b>{fmt(exposure)}</b></div><div><span>PRIVATE INVOKES</span><b>{invokes===null?"PENDING":invokes.toString()}</b></div></div>
  {error&&<div className="pending-banner">LIVE STATE PENDING — {error}</div>}
  <div className="table"><div className="tr th"><span>Proof tier</span><span>Premium</span><span>Payout</span><span>Contract term</span></div>{TIERS.map(t=><div className="tr" key={t.id}><b>{t.name}</b><span>{t.premium.toFixed(2)} STRK</span><span>{t.payout.toFixed(2)} STRK</span><span>{t.termDays} days</span></div>)}</div>
  <div className="three"><div className="metric"><span>Policy engine</span><b>{BigInt(POLICY_ADDRESS)===0n?"NOT DEPLOYED":"CONFIGURED"}</b><p>Owns term, reserve, exposure, adjudication state and fixed payout invariants.</p></div><div className="metric"><span>Privacy bridge</span><b>{BigInt(ANONYMIZER_ADDRESS)===0n?"NOT DEPLOYED":"CONFIGURED"}</b><p>Only the pinned STRK20 pool can route private COVERT actions.</p></div><div className="metric"><span>Operator power</span><b>APPROVE / DENY</b><p>The adjudicator cannot choose payout size or extend policy duration.</p></div></div>
 </section>;
}
