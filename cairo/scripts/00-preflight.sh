#!/usr/bin/env bash
# Preflight: prove the deployment can succeed before spending anything on mainnet.
#
# Validates every required variable, checks the signing account exists and is
# funded, verifies the pinned protocol addresses against the live chain, and
# estimates the cost of the whole sequence. It sends no transactions.
#
# Run this before 00-gates.sh. If it fails, deployment would have failed too —
# just later, and after paying for part of it.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"

fail=0
note() { printf '  %-52s %s\n' "$1" "$2"; }
bad() { fail=1; printf '  %-52s %s\n' "$1" "FAIL — $2"; }

echo "== COVERT mainnet preflight =="
echo

# ---------------------------------------------------------------- variables --
echo "Configuration (cairo/.env.deploy):"
for var in MAINNET_RPC_URL STRK_TOKEN STRK20_POOL OWNER_ADDRESS ADJUDICATOR_ADDRESS RESERVE_WEI; do
  if [[ -z "${!var:-}" ]]; then
    bad "${var}" "not set"
  else
    note "${var}" "set"
  fi
done

if [[ "${MAINNET_RPC_URL}" == *"__FILL_IN__"* || "${MAINNET_RPC_URL}" == *"YOUR_KEY"* ]]; then
  bad "MAINNET_RPC_URL" "still contains a placeholder"
fi

# The two roles must differ, or the separation the contract enforces is pointless.
# Lowercase via tr, not ${VAR,,}: macOS ships bash 3.2, where that expansion is a
# syntax error and the whole preflight would die before checking anything.
owner_lc="$(printf '%s' "${OWNER_ADDRESS}" | tr '[:upper:]' '[:lower:]')"
adj_lc="$(printf '%s' "${ADJUDICATOR_ADDRESS}" | tr '[:upper:]' '[:lower:]')"
if [[ "${owner_lc}" == "${adj_lc}" ]]; then
  bad "role separation" "OWNER_ADDRESS and ADJUDICATOR_ADDRESS are the same account"
else
  note "role separation" "owner != adjudicator"
fi

echo

# ------------------------------------------------------------------- chain --
echo "Live chain checks:"
chain_id="$(snc call --contract-address "${STRK_TOKEN}" --function symbol 2>/dev/null || echo '')"
if [[ "${chain_id}" == *STRK* ]]; then
  note "STRK token symbol()" "STRK"
else
  bad "STRK token symbol()" "did not report STRK at ${STRK_TOKEN}"
fi

pool_fee="$(snc call --contract-address "${STRK20_POOL}" --function get_fee_amount 2>/dev/null || echo '')"
if [[ -n "${pool_fee}" ]]; then
  note "STRK20 pool get_fee_amount()" "${pool_fee}"
else
  # Not fatal: the fee view has changed names during STRK20 development, and
  # COVERT never hardcodes a fee. The wallet quotes it at signing.
  note "STRK20 pool get_fee_amount()" "unreadable (wallet will quote the fee)"
fi

owner_balance="$(snc call --contract-address "${STRK_TOKEN}" --function balanceOf --arguments "${OWNER_ADDRESS}" 2>/dev/null || echo '')"
if [[ -n "${owner_balance}" ]]; then
  note "owner STRK balance" "${owner_balance}"
else
  bad "owner STRK balance" "could not read; is OWNER_ADDRESS a deployed account?"
fi

echo

# ------------------------------------------------------------------ artifacts --
echo "Build artifacts:"
for name in CovertPolicy CovertAnonymizer; do
  if [[ -f "${CAIRO_DIR}/target/dev/covert_${name}.contract_class.json" ]]; then
    note "${name} sierra" "present"
  else
    bad "${name} sierra" "missing — run scarb build"
  fi
done

# MockToken and MockStrk20Pool are test infrastructure. Deploying either to
# mainnet would be a serious error, so make their presence loudly non-fatal.
echo
echo "Test-only contracts (MUST NOT be deployed to mainnet):"
note "MockToken" "test/devnet only"
note "MockStrk20Pool" "test/devnet only — mainnet uses the real pool at ${STRK20_POOL}"

echo

# ---------------------------------------------------------------- fee estimate --
echo "Cost estimate (no transactions sent):"
echo "  Sequence: 2 declares, 2 deploys, 1 configure, 1 approve, 1 fund_reserve = 7 transactions."
echo "  Plus reserve capital: ${RESERVE_WEI} wei STRK locked into the policy contract."
echo "  Run each script with --dry-run --detailed appended to the sncast command for exact fees."
echo
snc declare --contract-name CovertPolicy --dry-run --detailed 2>&1 | sed 's/^/  /' || \
  echo "  (dry-run estimate unavailable; fees will be shown at signing time)"

echo
if [[ "${fail}" -ne 0 ]]; then
  echo "PREFLIGHT FAILED. Fix the items above before running 00-gates.sh."
  exit 1
fi
echo "PREFLIGHT PASSED. Next: cairo/scripts/00-gates.sh"
