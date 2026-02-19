#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY_SRC="${ROOT_DIR}/opencontext"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

run_cli() {
  PYTHONWARNINGS="ignore::RuntimeWarning" PYTHONPATH="${PY_SRC}" python3 -m opencontext.cli.main "$@"
}

pushd "${TMP_DIR}" >/dev/null

cat > SPEC.md <<'EOF'
# Sample Spec

## Goal
Build search support for context lookup.
EOF

run_cli init --project-name "ContextSearchTest" --goal-file SPEC.md >/dev/null

SEARCH_OUT="$(run_cli context --search "search support" --limit 5)"
echo "${SEARCH_OUT}" | rg -q "Search results for 'search support'" || {
  echo "FAIL  context --search did not return expected header"
  exit 1
}
echo "${SEARCH_OUT}" | rg -q "SPEC.md|main.md" || {
  echo "FAIL  context --search did not include result rows"
  exit 1
}

popd >/dev/null
echo "PASS  context search and limit options"
