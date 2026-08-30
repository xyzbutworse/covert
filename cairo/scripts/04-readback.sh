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
echo "  quote_tier(1) -> $("${SNC[@]}" call --contract-address "${POLICY_ADDRESS}" --function quote_tier --arguments 1)"

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
echo "Compare the onchain reads above against these values manually."