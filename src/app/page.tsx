import Link from "next/link";
import InspectionSpecimen from "@/components/InspectionSpecimen";
import { ArrowIcon, DocumentIcon, RosetteIcon, ScanIcon } from "@/components/SpecimenIcons";
import manifest from "../../strk20.json";

export default function Home(){
 const evidenceRecorded = manifest.transactions.length >= 3 && manifest.contracts.length >= 2 && Boolean(manifest.demo_video);
 return <>
  <section className="specimen-home">
   <div className="specimen-stage"><InspectionSpecimen/></div>
   <aside className="hero-rail">
    <div className={`evidence-state ${evidenceRecorded?"recorded":"pending"}`}><ScanIcon/><span>{evidenceRecorded?"MAINNET EVIDENCE RECORDED":"MAINNET EVIDENCE PENDING"}</span></div>
    <h1>The claim is public.<br/>The beneficiary is not.</h1>
    <p>Fixed incident cover with approved settlement returned through STRK20 instead of a public beneficiary transfer.</p>
    <div className="hero-actions"><Link className="primary" href="/cover"><span>Activate cover</span><ArrowIcon/></Link><Link className="ghost" href="/proof"><span>Review evidence</span><ScanIcon/></Link></div>
    <dl className="consequence-readings">
     <div><dt>Direct public payout</dt><dd className="copper">0.00 STRK</dd></div>
     <div><dt>Private balance</dt><dd className="mint">+ fixed payout</dd></div>
     <div><dt>Beneficiary</dt><dd className="violet">Not exposed</dd></div>
    </dl>
   </aside>
  </section>
  <section className="evidence-path" aria-labelledby="path-title">
   <header><span>COVERT PATH</span><h2 id="path-title">Three inspected actions.<br/>One private consequence.</h2></header>
   <div className="evidence-strips">
    <article><DocumentIcon/><div><span>Policy specimen</span><h3>Cover activated</h3><p>Fixed economics and the policy commitment remain public.</p></div><b>01</b></article>
    <article><RosetteIcon/><div><span>Bearer authentication</span><h3>Claim filed</h3><p>The incident reveal stays offchain while its salted commitment is verified.</p></div><b>02</b></article>
    <article><ScanIcon size={28}/><div><span>STRK20 return</span><h3>Settlement credited</h3><p>The fixed payout returns as an open note after adjudicator approval.</p></div><b>03</b></article>
   </div>
  </section>
  <section className="privacy-ledger">
   <header><span>Inspection ledger</span><h2>Privacy with an honest boundary.</h2><p>The first shield remains public. COVERT breaks the policyholder-to-beneficiary link only after funds enter STRK20.</p></header>
   <div className="ledger-columns"><div><b>PUBLIC RECORD</b><dl><div><dt>Policy terms</dt><dd>Visible</dd></div><div><dt>Reserve and exposure</dt><dd>Visible</dd></div><div><dt>Claim commitment</dt><dd>Visible</dd></div></dl></div><div><b>PRIVATE RELATIONSHIP</b><dl><div><dt>Policyholder wallet</dt><dd>Not attached</dd></div><div><dt>Incident plaintext</dt><dd>Offchain reveal</dd></div><div><dt>Beneficiary address</dt><dd>Absent</dd></div></dl></div></div>
  </section>
  <section className="closing-docket"><span>COVERT / STRK20</span><h2>Public rules.<br/>Private beneficiary.<br/>Real settlement.</h2><Link href="/cover"><span>Enter specimen room</span><ArrowIcon/></Link></section>
 </>;
}
