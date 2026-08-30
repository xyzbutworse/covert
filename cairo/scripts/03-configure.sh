#!/usr/bin/env bash
# Step 3: configure + lock + fund.
#   1) configure_anonymizer(ANON_ADDRESS) once, as OWNER.
#   2) Prove the configuration cannot be replaced (second configure reverts).
#   3) Owner approves the policy to spend RESERVE_WEI STRK.
#   4) fund_reserve(RESERVE_WEI), as OWNER.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"

: "${POLICY_ADDRESS:?set POLICY_ADDRESS in cairo/.env.deploy}"
: "${ANON_ADDRESS:?set ANON_ADDRESS in cairo/.env.deploy}"

echo
echo "=== 3a. configure_anonymizer (once, owner) ==="
echo "   policy.anonymizer -> ${ANON_ADDRESS}"
read -r -p "Confirm configure_anonymizer on Mainnet? [y/N] " yn
if [[ "${yn}" != "y" && "${yn}" != "Y" ]]; then echo "Aborted."; exit 1; fi
CFG_OUT="$("${SNC[@]}" invoke --contract-address "${POLICY_ADDRESS}" --function configure_anonymizer --arguments "${ANON_ADDRESS}" 2>&1 | tee /dev/stderr)"
CFG_TX="$(printf '%s\n' "${CFG_OUT}" | grep -oE '0x[0-9a-fA-F]{20,}' | head -1 || true)"
log_tx "configure_anonymizer" "${MAINNET_RPC_URL}" "${CFG_TX:-?}"

echo
echo "=== 3b. Prove anonymizer cannot be replaced ==="
echo "   Re-invoking configure_anonymizer must REVERT with ALREADY_CONFIGURED."
"${SNC[@]}" invoke --contract-address "${POLICY_ADDRESS}" --function configure_anonymizer --arguments "${ANON_ADDRESS}" 2>&1 \
  | grep -qiE 'ALREADY_CONFIGURED|revert' \
  && echo "   CONFIRMED: second configure reverts (configuration is locked)." \
  || echo "   WARNING: second configure did not visibly revert — investigate before continuing."

echo
echo "=== 3c. Owner approves policy to spend reserve STRK ==="
echo "   STRK.approve(policy=${POLICY_ADDRESS}, amount=${RESERVE_WEI})"
read -r -p "Confirm approve on Mainnet? [y/N] " yn
if [[ "${yn}" != "y" && "${yn}" != "Y" ]]; then echo "Aborted."; exit 1; fi
APPR_OUT="$("${SNC[@]}" invoke --contract-address "${STRK_TOKEN}" --function approve --arguments "${POLICY_ADDRESS} ${RESERVE_WEI} 0" 2>&1 | tee /dev/stderr)"
APPR_TX="$(printf '%s\n' "${APPR_OUT}" | grep -oE '0x[0-9a-fA-F]{20,}' | head -1 || true)"
log_tx "STRK approve" "${MAINNET_RPC_URL}" "${APPR_TX:-?}"

echo
echo "=== 3d. fund_reserve (owner) ==="
echo "   policy.fund_reserve(amount=${RESERVE_WEI})"
read -r -p "Confirm fund_reserve on Mainnet? [y/N] " yn
if [[ "${yn}" != "y" && "${yn}" != "Y" ]]; then echo "Aborted."; exit 1; fi
FUND_OUT="$("${SNC[@]}" invoke --contract-address "${POLICY_ADDRESS}" --function fund_reserve --arguments "${RESERVE_WEI}" 2>&1 | tee /dev/stderr)"
FUND_TX="$(printf '%s\n' "${FUND_OUT}" | grep -oE '0x[0-9a-fA-F]{20,}' | head -1 || true)"
log_tx "fund_reserve" "${MAINNET_RPC_URL}" "${FUND_TX:-?}"

echo
echo "CFG_TX=${CFG_TX:-?}  APPR_TX=${APPR_TX:-?}  FUND_TX=${FUND_TX:-?}"
echo ">> Record all hashes in the deployment log."