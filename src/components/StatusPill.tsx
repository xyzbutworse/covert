export default function StatusPill({label, tone="neutral"}:{label:string,tone?:"neutral"|"good"|"warn"}){
 return <span className={`status ${tone}`}>{label}</span>;
}
