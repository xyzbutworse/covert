#!/usr/bin/env bash
# Shared helpers for the COVERT mainnet deployment.
# Safe by construction: it never contains or prints a private key.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAIRO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${CAIRO_DIR}/.." && pwd)"

# sncast resolves snfoundry.toml and the Scarb package from the working directory,
# so every script must operate from cairo/ regardless of where it was invoked.
cd "${CAIRO_DIR}"

ENV_FILE="${CAIRO_DIR}/.env.deploy"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found. Copy cairo/.env.deploy.example to cairo/.env.deploy and fill it in." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

REQUIRED=(
  MAINNET_RPC_URL STRK_TOKEN STRK20_POOL OWNER_ADDRESS ADJUDICATOR_ADDRESS RESERVE_WEI
)
MISSING=()
for var in "${REQUIRED[@]}"; do
  if [[ -z "${!var:-}" ]]; then MISSING+=("${var}"); fi
done
if [[ "${#MISSING[@]}" -gt 0 ]]; then
  echo "ERROR: missing required variables in ${ENV_FILE}: ${MISSING[*]}" >&2
  exit 1
fi

# sncast splits its flags: account/keystore selection is GLOBAL and must precede the
# subcommand, while --url is a SUBCOMMAND flag and must follow it. Neither ordering
# works as a single command prefix, so every invocation goes through snc(), which
# places each flag on the side sncast expects.
if [[ -n "${DEPLOY_KEYSTORE:-}" && -n "${DEPLOY_ACCOUNT_FILE:-}" ]]; then
  SNC_GLOBAL=(--keystore "${DEPLOY_KEYSTORE}" --account "${DEPLOY_ACCOUNT_FILE}")
elif [[ -n "${DEPLOY_ACCOUNT_NAME:-}" ]]; then
  SNC_GLOBAL=(--account "${DEPLOY_ACCOUNT_NAME}")
else
  echo "ERROR: set either (DEPLOY_KEYSTORE + DEPLOY_ACCOUNT_FILE) or DEPLOY_ACCOUNT_NAME in ${ENV_FILE}." >&2
  exit 1
fi

snc() {
  local sub="$1"; shift
  sncast "${SNC_GLOBAL[@]}" "${sub}" --url "${MAINNET_RPC_URL}" "$@"
}

# Independent address sanity checks before any mainnet transaction.
verify_addresses() {
  echo ">> Verifying configured addresses against the live chain..."
  local strk_symbol
  strk_symbol="$(snc call --contract-address "${STRK_TOKEN}" --function symbol 2>/dev/null || echo '')"
  echo "   STRK token symbol() -> ${strk_symbol:-UNREADABLE}"
  if [[ "${strk_symbol}" != *STRK* ]]; then
    echo "ERROR: STRK token at ${STRK_TOKEN} did not report symbol STRK. Aborting." >&2
    exit 1
  fi
  local pool_fee
  pool_fee="$(snc call --contract-address "${STRK20_POOL}" --function get_fee_amount 2>/dev/null || echo '')"
  echo "   STRK20 pool get_fee_amount() -> ${pool_fee:-UNREADABLE}"
  echo ">> Addresses check OK."
}

# Print a tx for manual verification without logging secrets.
log_tx() {
  local step="$1" url="$2" tx="$3"
  echo "[${step}] tx: ${tx}  (${url})"
}

sncast_here() { printf 'sncast %s <subcommand> --url %s\n' "${SNC_GLOBAL[*]}" "${MAINNET_RPC_URL}"; }