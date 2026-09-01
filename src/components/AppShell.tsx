import Link from "next/link";
import WalletButton from "./WalletButton";
import SiteNav from "./SiteNav";
import { LedgerBoot, SystemBanner } from "./SystemState";
import { CovertMark } from "./SpecimenIcons";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      {/* Hydrates the lifecycle ledger and reconciles it with the chain once per session. */}
      <LedgerBoot />
      <header className="topbar">
        <Link href="/" className="brand">
          <CovertMark />
          <span>COVERT</span>
        </Link>
        <SiteNav />
        <WalletButton />
      </header>
      <SystemBanner />
      <main>{children}</main>
      <footer>
        <span>COVERT / SPECIMEN ROOM</span>
        <span>
          <Link href="/replay">Verified replay</Link> · Public rules. Private beneficiary. Real settlement.
        </span>
        <span>STARKNET MAINNET</span>
      </footer>
    </div>
  );
}
