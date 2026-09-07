#!/usr/bin/env bash
# Step 2: deploy both COVERT contracts on Starknet Mainnet.
# Constructor args:
#   CovertPolicy(owner, adjudicator, STRK token)
#   CovertAnonymizer(policy_address, STRK20 pool, STRK token)
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"

: "${POLICY_CLASS_HASH:?set POLICY_CLASS_HASH in cairo/.env.deploy}"
: "${ANON_CLASS_HASH:?set ANON_CLASS_HASH in cairo/.env.deploy}"
verify_addresses

echo
echo "=== Deploying CovertPolicy ==="
echo "   constructor: CovertPolicy(owner=${OWNER_ADDRESS}, adjudicator=${ADJUDICATOR_ADDRESS}, token=${STRK_TOKEN})"
read -r -p "Confirm DEPLOY CovertPolicy on Mainnet? [y/N] " yn
if [[ "${yn}" != "y" && "${yn}" != "Y" ]]; then echo "Aborted."; exit 1; fi
POLICY_DEPLOY_OUT="$(snc deploy --class-hash "${POLICY_CLASS_HASH}" --arguments "${OWNER_ADDRESS} ${ADJUDICATOR_ADDRESS} ${STRK_TOKEN}" 2>&1 | tee /dev/stderr)"
POLICY_ADDRESS="$(printf '%s\n' "${POLICY_DEPLOY_OUT}" | grep -oE 'contract address: 0x[0-9a-fA-F]+' | head -1 | awk '{print $3}')"
POLICY_DEPLOY_TX="$(printf '%s\n' "${POLICY_DEPLOY_OUT}" | grep -oE '0x[0-9a-fA-F]{20,}' | grep -v "${POLICY_ADDRESS}" | head -1 || true)"
log_tx "CovertPolicy deploy" "${MAINNET_RPC_URL}" "${POLICY_DEPLOY_TX:-?}"

echo
echo "=== Deploying CovertAnonymizer ==="
echo "   constructor: CovertAnonymizer(policy=${POLICY_ADDRESS}, pool=${STRK20_POOL}, token=${STRK_TOKEN})"
read -r -p "Confirm DEPLOY CovertAnonymizer on Mainnet? [y/N] " yn
if [[ "${yn}" != "y" && "${yn}" != "Y" ]]; then echo "Aborted."; exit 1; fi
ANON_DEPLOY_OUT="$(snc deploy --class-hash "${ANON_CLASS_HASH}" --arguments "${POLICY_ADDRESS} ${STRK20_POOL} ${STRK_TOKEN}" 2>&1 | tee /dev/stderr)"
ANON_ADDRESS="$(printf '%s\n' "${ANON_DEPLOY_OUT}" | grep -oE 'contract address: 0x[0-9a-fA-F]+' | head -1 | awk '{print $3}')"
ANON_DEPLOY_TX="$(printf '%s\n' "${ANON_DEPLOY_OUT}" | grep -oE '0x[0-9a-fA-F]{20,}' | grep -v "${ANON_ADDRESS}" | head -1 || true)"
log_tx "CovertAnonymizer deploy" "${MAINNET_RPC_URL}" "${ANON_DEPLOY_TX:-?}"

echo
echo "POLICY_ADDRESS=${POLICY_ADDRESS}"
echo "ANON_ADDRESS=${ANON_ADDRESS}"
echo ">> Save these into cairo/.env.deploy and your deployment log."