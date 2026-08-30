# Cairo invariant suite

`covert_invariants.cairo` is the executable Starknet Foundry suite for the pre-mainnet security gate.
It covers the bugs COVERT most needs to prevent before real STRK enters the contracts:

- protocol-derived policy expiry and fixed tier economics;
- reserve/exposure accounting and expiry release;
- anonymizer-only policy mutation;
- bearer authentication before a claim can consume the one-claim slot;
- policy + incident binding of claim commitments;
- pool-only anonymizer routing;
- exact purchase-balance enforcement (dust/subsidy rejection);
- end-to-end pool-routed policy purchase through both COVERT contracts;
- adjudicator access control.

The repository does **not** claim these tests passed merely because they exist. The authoritative gate is:

```bash
cd cairo
scarb build
snforge test
```

CI runs both commands. Do not deploy to mainnet while either is red. A mainnet happy-path settlement is also required because the real STRK20 pool/open-note return path cannot be fully represented by the mock token in this suite.
