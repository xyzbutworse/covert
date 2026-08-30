# Mainnet proof ledger

Do not turn a planned action into evidence. A row becomes VERIFIED only after its Starknet Mainnet transaction has succeeded and the observed state/event has been independently inspected.

## Supporting transaction

| ID | Action | Transaction | Purpose | Status |
| --- | --- | --- | --- | --- |
| TX-00 | Shield enough real STRK for the lifecycle | PENDING | Establish a mature shielded balance; initial deposit is public | PENDING |

TX-00 is supporting evidence. It is **not** one of the three scored COVERT mechanism transactions.

## Scored COVERT transactions

| ID | Action | Transaction | COVERT path | STRK20 primitive | Expected state/event | Observed state |
| --- | --- | --- | --- | --- | --- | --- |
| TX-01 | Private policy purchase | PENDING | Pool → CovertAnonymizer → CovertPolicy | withdraw + invoke | `PolicyPurchased`; active policy; reserve/exposure updated | PENDING |
| TX-02 | Authenticated claim submission | PENDING | Pool → CovertAnonymizer → CovertPolicy | invoke | `ClaimSubmitted`; pending decision; bearer signature accepted | PENDING |
| TX-03 | Private claim settlement | PENDING | Pool → Anonymizer → Policy → Anonymizer → Pool | OPEN transfer + invoke | `ClaimSettled`; replay state consumed; private note credited | PENDING |

## Required adversarial evidence

Record these separately; rejected transactions/calls are supporting proof and should not replace the three successful scored hashes.

| Attack / invariant | Expected result | Evidence | Status |
| --- | --- | --- | --- |
| Claim submission with wrong bearer signature | Revert `BAD_SIGNATURE` | PENDING | PENDING |
| Settlement before adjudicator approval | Revert `NOT_APPROVED` | PENDING | PENDING |
| Second claim for same policy | Revert `POLICY_HAS_CLAIM` | PENDING | PENDING |
| Second redemption | Revert `CLAIMED` | PENDING | PENDING |
| Wrong caller / fake pool | Revert `BAD_POOL` or `NOT_ANON` | PENDING | PENDING |
| Client attempts custom expiry | No expiry parameter exists in purchase ABI | source + test | PENDING |
| Adjudicator attempts custom payout | No payout parameter exists in decision ABI | source + test | PENDING |

## Evidence packet for every completed mainnet row

For each verified transaction add:

1. exact transaction hash and Voyager link;
2. deployed COVERT contract address(es);
3. STRK20 pool address touched;
4. exact COVERT event(s) emitted;
5. before/after state relevant to the claim;
6. privacy property actually demonstrated, stated narrowly;
7. screenshot/video timestamp only as secondary evidence.

Never use a screenshot as a substitute for chain evidence.
