"use client";

import { useState } from "react";
import { DocumentIcon, RosetteIcon } from "./SpecimenIcons";

export default function InspectionSpecimen() {
  const [scan, setScan] = useState(50);
  return <div className="inspection-specimen" style={{ "--scan": `${scan}%` } as React.CSSProperties}>
    <div className="specimen-registration" aria-hidden="true"><i/><i/><i/><i/></div>
    <div className="specimen-copy">
      <div className="specimen-wordmark">COVERT</div>
      <span>SECURITY POLICY</span>
      <b>SPECIMEN</b>
    </div>
    <div className="specimen-data">
      <dl>
        <div><dt>Policy class</dt><dd>Fixed incident cover</dd></div>
        <div><dt>Settlement layer</dt><dd>STRK20 open note</dd></div>
        <div><dt>Jurisdiction</dt><dd>Starknet Mainnet</dd></div>
      </dl>
      <p>This specimen proves a settlement path. No beneficiary address is written into the policy payout route.</p>
    </div>
    <div className="specimen-serial"><span>SERIAL NO.</span><b>CVT-7X19-000042</b></div>
    <div className="specimen-stamp"><span>SPECIMEN ROOM</span><b>LOCKED</b></div>
    <div className="copper-medallion" aria-hidden="true"><span>COVERT</span><i/></div>
    <div className="private-channel" aria-label="Private settlement route">
      <span className="channel-instruction">DRAG TO INSPECT</span>
      <div className="route-node"><DocumentIcon/><b>POLICY</b></div>
      <span className="route-line"/>
      <div className="route-node"><RosetteIcon/><b>ANONYMIZER</b></div>
      <span className="route-line"/>
      <div className="route-node"><RosetteIcon/><b>STRK20 OPEN NOTE</b></div>
      <input aria-label="Move inspection slit" type="range" min="35" max="65" value={scan} onChange={(event) => setScan(Number(event.target.value))}/>
    </div>
  </div>;
}
