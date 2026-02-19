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

run_cli init --project-name "LawAssetsTest" --goal "Validate law asset generation"

[[ -f ".GCC/law-enforcer.json" ]] || { echo "FAIL  missing .GCC/law-enforcer.json"; exit 1; }
[[ -f ".GCC/law-policy.txt" ]] || { echo "FAIL  missing .GCC/law-policy.txt"; exit 1; }
[[ -f ".GCC/law-runtime.json" ]] || { echo "FAIL  missing .GCC/law-runtime.json"; exit 1; }
[[ -f ".GCC/AGENT_GUIDE.txt" ]] || { echo "FAIL  missing .GCC/AGENT_GUIDE.txt"; exit 1; }

run_cli law validate
run_cli law guide

[[ -s ".GCC/AGENT_GUIDE.txt" ]] || { echo "FAIL  AGENT_GUIDE.txt is empty"; exit 1; }
grep -q "custom.rules" ".GCC/AGENT_GUIDE.txt" || {
  echo "FAIL  AGENT_GUIDE.txt missing custom.rules guidance"
  exit 1
}
grep -q "law-runtime.json" ".GCC/AGENT_GUIDE.txt" || {
  echo "FAIL  AGENT_GUIDE.txt missing runtime config guidance"
  exit 1
}

popd >/dev/null
echo "PASS  law assets generated + validated"
