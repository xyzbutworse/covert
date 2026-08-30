import { VOYAGER } from "@/lib/config";
import type { TxReceipt as T } from "@/lib/covert/types";
export default function TxReceipt({receipt}:{receipt:T}){
 if(receipt.state==="idle") return null;
 return <div className={`tx-receipt ${receipt.state}`}>
   <div><span className="tx-dot"/><b>{receipt.title}</b></div>
   {receipt.detail && <p>{receipt.detail}</p>}
   {receipt.hash && <a href={`${VOYAGER}/${receipt.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}
 </div>
}
