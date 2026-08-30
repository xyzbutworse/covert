import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
export const metadata: Metadata = {
 title: "COVERT — Private incident coverage on Starknet",
 description: "Fixed-indemnity incident coverage with private policyholder identity and shielded STRK20 settlement.",
};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="en"><body>
  <template aria-hidden="true" dangerouslySetInnerHTML={{__html:`<!--
THESIS: COVERT is a high-security policy specimen under live examination, refusing the generic privacy dashboard.
OWN-WORLD: Mineral navy, frost paper, security violet, oxidized copper, mint validation ink, guilloche geometry, and square instrument controls.
STORY: See the public policy, inspect the hidden settlement route, activate cover, then verify every pending or recorded proof.
FIRST VIEWPORT: An oversized split policy specimen owns the left field; a draggable inspection slit reveals the private route; the action rail occupies the right.
FORM: Specimen Room, grounded direction 7, seed 027b52f3.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`}}/>
  <AppShell>{children}</AppShell>
 </body></html>;
}
