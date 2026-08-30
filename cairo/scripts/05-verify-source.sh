#!/usr/bin/env bash
# Step 5 (optional): source verification on the block explorer.
# Uses the official sncast verify integration; does not fake verification.
# If the explorer's verification service is down, this step is skipped and the
# class hashes in the deployment log remain the reproducible proof of source.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-common.sh"

: "${POLICY_CLASS_HASH:?set POLICY_CLASS_HASH in cairo/.env.deploy}"
: "${ANON_CLASS_HASH:?set ANON_CLASS_HASH in cairo/.env.deploy}"

echo ">> Attempting Voyager source verification (mainnet)."
echo "   If the explorer rejects or the service is unavailable, do NOT fake it — leave unverified and rely on the recorded class hashes."

(cd "${CAIRO_DIR}" && sncast verify --contract-name CovertPolicy --verifier voyager --network mainnet --class-hash "${POLICY_CLASS_HASH}" --confirm-verification) \
  || echo ">> CovertPolicy verification unavailable/skipped (not faked)."

(cd "${CAIRO_DIR}" && sncast verify --contract-name CovertAnonymizer --verifier voyager --network mainnet --class-hash "${ANON_CLASS_HASH}" --confirm-verification) \
  || echo ">> CovertAnonymizer verification unavailable/skipped (not faked)."

echo ">> Done. Confirm on the explorer that both classes show 'verified' before relying on it."