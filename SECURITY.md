# Security policy

COVERT is a hackathon proof of mechanism, not audited insurance infrastructure. Do not deposit material funds.

## Security assumptions

- STRK20 pool and Wallet API are external protocol dependencies.
- The configured adjudicator is trusted to make the binary incident-validity decision.
- The owner is trusted only for initial configuration and reserve funding.
- Browser local storage is used for prototype bearer/reveal material and is not production-grade custody.
- Fixed proof tiers are deliberately tiny and are not actuarial products.

## Hard deployment gates

Mainnet deployment is prohibited until all of the following are true:

1. `scarb build` succeeds with the pinned Cairo/Scarb toolchain.
2. `snforge test` passes the security invariant suite.
3. `npm run typecheck` succeeds.
4. `npm run build` succeeds.
5. Wallet is hard-gated to Starknet Mainnet and STRK20 capability is verified without probing balances first.
6. The pool and STRK token constants are re-verified against current official sources.
7. Contract constructor/configuration addresses are independently read back after deployment.
8. A clean-browser replay succeeds before recording the final demo.

## High-priority properties

- only the pinned STRK20 pool may call `privacy_invoke`;
- only configured anonymizer may create/submit/redeem policy state;
- claim submission and redemption require domain-separated bearer signatures;
- policy duration and payout are protocol-derived;
- only adjudicator may decide claims;
- no claim can settle twice;
- reserve/exposure accounting cannot issue uncovered proof-tier exposure;
- proof UI never claims success without evidence.

## Reporting

For the sprint, report a suspected vulnerability privately to the repository owner before publishing exploit details. Include the affected commit, entrypoint, preconditions and a minimal reproduction.
