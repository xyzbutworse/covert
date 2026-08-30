#!/usr/bin/env bash
# Step 1: declare both COVERT contracts on Starknet Mainnet.
# Requires a wallet confirmation for each DECLARE transaction.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"

verify_addresses
echo ">> Ready to DECLARE. Each command below requires a wallet confirmation."
echo ">> To preview the fee without sending anything, append: --dry-run --detailed"

echo
echo "=== Declaring CovertPolicy ==="
read -r -p "Confirm DECLARE CovertPolicy on Mainnet? [y/N] " yn
if [[ "${yn}" != "y" && "${yn}" != "Y" ]]; then echo "Aborted."; exit 1; fi
POLICY_DECLARE_OUT="$("${SNC[@]}" declare --contract-name CovertPolicy 2>&1 | tee /dev/stderr)"
POLICY_CLASS_HASH="$(printf '%s\n' "${POLICY_DECLARE_OUT}" | grep -iEo 'class hash: 0x[0-9a-fA-F]+' | head -1 | awk '{print $3}')"
POLICY_DECLARE_TX="$(printf '%s\n' "${POLICY_DECLARE_OUT}" | grep -iEo 'transaction hash: 0x[0-9a-fA-F]+' | head -1 | awk '{print $3}')"
log_tx "CovertPolicy declare" "${MAINNET_RPC_URL}" "${POLICY_DECLARE_TX:-?}"

echo
echo "=== Declaring CovertAnonymizer ==="
read -r -p "Confirm DECLARE CovertAnonymizer on Mainnet? [y/N] " yn
if [[ "${yn}" != "y" && "${yn}" != "Y" ]]; then echo "Aborted."; exit 1; fi
ANON_DECLARE_OUT="$("${SNC[@]}" declare --contract-name CovertAnonymizer 2>&1 | tee /dev/stderr)"
ANON_CLASS_HASH="$(printf '%s\n' "${ANON_DECLARE_OUT}" | grep -iEo 'class hash: 0x[0-9a-fA-F]+' | head -1 | awk '{print $3}')"
ANON_DECLARE_TX="$(printf '%s\n' "${ANON_DECLARE_OUT}" | grep -iEo 'transaction hash: 0x[0-9a-fA-F]+' | head -1 | awk '{print $3}')"
log_tx "CovertAnonymizer declare" "${MAINNET_RPC_URL}" "${ANON_DECLARE_TX:-?}"

echo
echo "POLICY_CLASS_HASH=${POLICY_CLASS_HASH}"
echo "ANON_CLASS_HASH=${ANON_CLASS_HASH}"
echo ">> Save these into cairo/.env.deploy and your deployment log."