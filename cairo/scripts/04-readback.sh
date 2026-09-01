#!/usr/bin/env bash
# Step 4: read back all COVERT configuration and economic state onchain.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"

: "${POLICY_ADDRESS:?set POLICY_ADDRESS in cairo/.env.deploy}"
: "${ANON_ADDRESS:?set ANON_ADDRESS in cairo/.env.deploy}"

echo "== CovertPolicy @ ${POLICY_ADDRESS} =="
echo "  owner()       -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function owner)"
echo "  adjudicator() -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function adjudicator)"
echo "  anonymizer()  -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function anonymizer)"
echo "  token()       -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function token)"
echo "  reserve()     -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function reserve)"
echo "  exposure()    -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function exposure)"
echo "  free_reserve() -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function free_reserve)"
echo "  adjudication_window() -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function adjudication_window)"
echo "  quote_tier(1) -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function quote_tier --arguments 1)"
echo "  quote_tier(2) -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function quote_tier --arguments 2)"
echo "  quote_tier(3) -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function quote_tier --arguments 3)"

echo
echo "== CovertAnonymizer @ ${ANON_ADDRESS} =="
echo "  invoke_count() -> $("${SNC[@]}" call --contract-address "${ANON_ADDRESS}" --function invoke_count)"

echo
echo "Expected configuration:"
echo "  owner=${OWNER_ADDRESS}"
echo "  adjudicator=${ADJUDICATOR_ADDRESS}"
echo "  anonymizer=${ANON_ADDRESS}"
echo "  token=${STRK_TOKEN}"
echo "  reserve>=${RESERVE_WEI}"
echo "  exposure=0"
echo "  free_reserve=reserve (nothing outstanding yet)"
echo "  adjudication_window=259200 (72h)"
echo "  quote_tier(1)=(10000000000000000, 50000000000000000, 604800)"
echo "  quote_tier(2)=(20000000000000000, 100000000000000000, 1209600)"
echo "  quote_tier(3)=(40000000000000000, 200000000000000000, 2592000)"
echo
echo "Compare the onchain reads above against these values manually."
echo "The tier quotes must match src/lib/domain/economics.ts exactly; tests/domain/economics.test.ts"
echo "guards the client side of that against cairo/src/covert_policy.cairo."