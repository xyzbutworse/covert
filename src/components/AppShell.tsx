import Link from "next/link";
import WalletButton from "./WalletButton";
import SiteNav from "./SiteNav";
import { CovertMark } from "./SpecimenIcons";
export default function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand"><CovertMark/><span>COVERT</span></Link>
      <SiteNav />
      <WalletButton />
    </header>
    <main>{children}</main>
    <footer><span>COVERT / SPECIMEN ROOM</span><span>Public rules. Private beneficiary. Real settlement.</span><span>STARKNET MAINNET</span></footer>
  </div>;
}
