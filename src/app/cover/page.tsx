"use client";
import { useEffect, useMemo, useState } from "react";
import { TIERS, WEI } from "@/lib/config";
import { buyPolicy, currentBlockNumber, poolFeeWei, shield } from "@/lib/covert/actions";
import { createPolicyKey } from "@/lib/covert/key";
import type { TxReceipt as TR } from "@/lib/covert/types";
import TxReceipt from "@/components/TxReceipt";
import { useWallet } from "@/lib/wallet/store";

const fmt = (wei: bigint | null) => wei === null ? "Fee unavailable — wallet will quote during execution" : `${(Number(wei) / Number(WEI)).toFixed(4)} STRK`;

export default function Cover(){
 const [tierId,setTierId]=useState(2);
 const [receipt,setReceipt]=useState<TR>({state:"idle"});
 const [shieldReceipt,setShieldReceipt]=useState<TR>({state:"idle"});
 const [fee,setFee]=useState<bigint|null>(null);
 const [shieldAmount,setShieldAmount]=useState("0.10");
 const [shieldBlock,setShieldBlock]=useState<number|null>(null);
 const [block,setBlock]=useState<number|null>(null);
 const connected=useWallet(s=>s.connected);
 const tier=useMemo(()=>TIERS.find(t=>t.id===tierId)!,[tierId]);
 const blocksSince = shieldBlock !== null && block !== null ? Math.max(0, block-shieldBlock) : null;
 const noteReady = blocksSince === null || blocksSince >= 10;

 useEffect(()=>{if(!connected)return;poolFeeWei().then((v)=>{setFee(v);if(v!==null){const lifecycle=(Number(v)/Number(WEI))*3+tier.premium+0.05;setShieldAmount(Math.max(.1,lifecycle).toFixed(2));}}).catch(()=>setFee(null));},[connected,tier.premium]);
 useEffect(()=>{if(shieldBlock===null)return;const run=()=>currentBlockNumber().then(setBlock).catch(()=>{});run();const id=setInterval(run,10000);return()=>clearInterval(id)},[shieldBlock]);

 async function onShield(){
  const amount=Number(shieldAmount); if(!Number.isFinite(amount)||amount<=0){setShieldReceipt({state:"error",title:"Enter a valid STRK amount"});return;}
  try{setShieldReceipt({state:"pending",title:`Shielding ${amount.toFixed(2)} STRK…`,detail:"A shield deposit is public and may require separate wallet approval. COVERT labels that boundary explicitly."});const h=await shield(amount);const b=await currentBlockNumber();setShieldBlock(b);setBlock(b);setShieldReceipt({state:"success",title:"Deposit confirmed — note maturing",hash:h,detail:"Wait roughly 10 blocks before spending a fresh STRK20 note."});}catch(e:any){setShieldReceipt({state:"error",title:"Shield failed",detail:e.message});}
 }
 async function onBuy(){
  try{const key=createPolicyKey(tier.id);setReceipt({state:"pending",title:"Activating cover…",detail:"The bearer key stays in this browser. Policy duration is computed by the contract, not supplied by the UI."});const h=await buyPolicy(key);setReceipt({state:"success",title:`${tier.name} cover active`,hash:h,detail:`Policy ${key.commitment.slice(0,12)}… is public; the wallet that controls its bearer key is not attached to the policy contract.`});}catch(e:any){setReceipt({state:"error",title:"Cover purchase failed",detail:e.message});}
 }

 return <section className="product-page">
  <div className="page-head"><div><span className="section-kicker">GET COVERED</span><h1>Protect the treasury.<br/>Not the wallet trail.</h1></div><p>Choose a fixed proof tier. COVERT keeps the economics public while the policy is controlled by a fresh bearer key inside the private flow.</p></div>
  <div className="two-col">
   <div className="panel"><div className="panel-head"><span>PRIVATE FUNDING</span><b>STRK20</b></div><p>Fund the private balance used by the policy flow. The initial deposit is public; privacy begins after funds enter STRK20.</p><label className="field-label">Shield amount</label><div className="amount-input"><input value={shieldAmount} onChange={e=>setShieldAmount(e.target.value)} inputMode="decimal"/><span>STRK</span></div><div className="fee-lines"><div><span>Pool fee / private operation</span><b>{fmt(fee)}</b></div><div><span>Fresh-note maturity</span><b>~10 blocks</b></div></div><button className="secondary wide" disabled={!connected} onClick={onShield}>{connected?"Fund private balance":"Connect wallet first"}</button><TxReceipt receipt={shieldReceipt}/>{shieldBlock!==null&&<div className={`maturity ${noteReady?"ready":"waiting"}`}><span>{noteReady?"READY TO SPEND":"PRIVATE NOTE PREPARING"}</span><b>{Math.min(blocksSince??0,10)} / 10 blocks</b><div><i style={{width:`${Math.min(100,((blocksSince??0)/10)*100)}%`}}/></div></div>}</div>
   <div className="panel"><div className="panel-head"><span>SELECT PROTECTION</span><b>MAINNET PROOF TIERS</b></div><div className="tier-list">{TIERS.map(t=><button key={t.id} onClick={()=>setTierId(t.id)} className={tierId===t.id?"tier active":"tier"}><div><b>{t.name}</b><span>{t.termDays} days</span></div><strong>{t.payout.toFixed(2)} STRK</strong><small>{t.premium.toFixed(2)} STRK premium</small></button>)}</div><div className="quote"><span>Premium</span><b>{tier.premium.toFixed(2)} STRK</b><span>Fixed payout</span><b>{tier.payout.toFixed(2)} STRK</b><span>Policy term</span><b>{tier.termDays} days</b></div><button className="primary wide" disabled={!connected||!noteReady} onClick={onBuy}>{!connected?"Connect wallet first":!noteReady?"Wait for note maturity":`Activate ${tier.name}`}</button><TxReceipt receipt={receipt}/></div>
  </div>
  <div className="privacy-note"><b>Proof economics, not commercial insurance</b><p>These deliberately tiny fixed tiers exist to prove the mechanism on mainnet. The contract derives each term from the selected tier and rejects issuance when reserve cannot cover the new fixed exposure.</p></div>
  <div className="privacy-note"><b>Privacy boundary</b><p>Your initial shield deposit is public, and privacy begins only after funds enter STRK20. Timing, amounts and the anonymity set can still correlate, and this demo breaks the identity → payout linkage — it does not promise magical invisibility. The pool fee above is read from the live pool; if it cannot be queried, COVERT does not guess it — your wallet quotes the real fee during execution.</p></div>
 </section>;
}
