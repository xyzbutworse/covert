"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  ["/cover", "Cover"],
  ["/claim", "Claim"],
  ["/verify", "Verify"],
  ["/reserve", "Reserve"],
  ["/history", "History"],
  ["/proof", "Proof"],
] as const;

export default function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label="Primary navigation">
      {items.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
