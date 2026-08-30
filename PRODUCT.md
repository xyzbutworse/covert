# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary audience is STRK20 Private Sprint judges evaluating whether COVERT demonstrates a credible, useful, and narrowly stated privacy mechanism on Starknet Mainnet. The product user represented in the demo is an onchain team or treasury operator purchasing fixed incident cover, filing an authenticated claim, and receiving an approved payout without attaching a public beneficiary wallet to the settlement path.

## Product Purpose

COVERT proves a fixed-indemnity incident-cover lifecycle where policy rules and solvency remain public while policy control and settlement return through STRK20. Success means a reviewer quickly understands the mechanism, sees settlement fail before approval, sees the same action succeed after approval, and verifies that the payout returns as a private note rather than a direct public-wallet transfer.

## Positioning

COVERT is an application-specific private financial-protection workflow. It combines a pool-pinned anonymizer, local bearer authentication, constrained adjudication, fixed onchain economics, reserve accounting, and an STRK20 open-note settlement path.

## Operating Context

The judged flow spans six routes: Home, Cover, Claim, Verify, Reserve, and Proof. The claimant uses a privacy-capable Starknet wallet and keeps bearer and reveal material in the browser. A separate adjudicator receives the private reveal packet out of band, verifies its commitments, and records an approve or deny decision. Reviewers inspect public reserve state, transaction evidence, contract addresses, and the stated privacy boundary.

## Capabilities and Constraints

- Starknet Mainnet only.
- STRK20 Wallet API through WalletAccountV6.
- Initial shielding remains public.
- Private purchase, authenticated claim submission, and private settlement route through the pinned STRK20 pool and COVERT anonymizer.
- Policy tier determines premium, payout, and term onchain.
- The adjudicator chooses approve or deny and does not choose payout value.
- Local bearer keys and incident reveal packets use browser storage in the prototype.
- Mainnet evidence stays pending until real hashes and addresses exist.
- Existing product truth, contract behavior, routes, and evidence honesty must survive the redesign.

## Brand Commitments

The product name is COVERT. The voice is concise, technical, direct, and evidence-led. The interface must feel premium and authored rather than template-driven or AI-generated. Product copy must preserve the narrow privacy claim and avoid invented deployment, transaction, customer, or verification claims.

## Evidence on Hand

- Product architecture and privacy documentation in `docs/`.
- Cairo policy, anonymizer, mock token, deployment scripts, and 46 invariant tests in `cairo/`.
- Next.js application routes and STRK20 wallet integration in `src/`.
- Empty official evidence manifest at `strk20.json`.
- No recorded mainnet transactions, deployed addresses, public demo, or demo video in the current workspace.

## Product Principles

- Lead with the observable settlement consequence.
- Separate verified evidence from targets and pending work.
- Keep public rules and private beneficiary boundaries legible.
- Make the claimant, adjudicator, and reviewer roles unmistakable.
- Preserve user signing authority and local bearer-key custody.

## Accessibility & Inclusion

The web interface must remain keyboard usable, responsive across desktop and mobile, readable under reduced motion, and clear without relying on color alone.
