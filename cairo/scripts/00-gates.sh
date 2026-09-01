#!/usr/bin/env bash
# Gate 0: every check must be green before any mainnet transaction.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "== npm typecheck =="
(cd "${ROOT_DIR}" && npm run typecheck)
echo "== npm test (domain) =="
(cd "${ROOT_DIR}" && npm test)
echo "== npm build =="
(cd "${ROOT_DIR}" && npm run build)
echo "== npm run test:e2e (browser lifecycle) =="
(cd "${ROOT_DIR}" && npm run test:e2e)
echo "== npm forge:code =="
(cd "${ROOT_DIR}" && npm run forge:code)
echo "== scarb build =="
(cd "${ROOT_DIR}/cairo" && scarb build)
echo "== snforge test =="
(cd "${ROOT_DIR}/cairo" && snforge test)
echo "ALL GATES GREEN."