#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-40217}"

if [[ -z "${CHUTES_API_KEY:-}" ]]; then
  echo "CHUTES_API_KEY is required for live watchman trace test."
  exit 1
fi

TMP_PROJ="$(mktemp -d)"
SERVER_LOG="$(mktemp)"
SERVER_PID=""

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

mkdir -p "${TMP_PROJ}/.opencode/plugins"
cp "${ROOT_DIR}/opencontext/opencontext/plugin/opencontext-reminder.js" \
  "${TMP_PROJ}/.opencode/plugins/opencontext-reminder.js"

(
  cd "${TMP_PROJ}"
  opencontext init --project-name "TraceLive" --goal "Verify watchman trace" >/dev/null 2>&1
  cp "${ROOT_DIR}/opencontext/opencontext/plugin/law-enforcer.json" ".GCC/law-enforcer.json"
)

(
  cd "${TMP_PROJ}"
  opencode serve --hostname 127.0.0.1 --port "${PORT}" --print-logs --log-level DEBUG >"${SERVER_LOG}" 2>&1
) &
SERVER_PID=$!

for _ in $(seq 1 80); do
  if rg -q "opencode server listening on http://127\\.0\\.0\\.1:${PORT}" "${SERVER_LOG}"; then
    break
  fi
  sleep 0.25
done

SESSION_ID="$(curl -s -X POST "http://127.0.0.1:${PORT}/session" | jq -r '.id')"
if [[ -z "${SESSION_ID}" || "${SESSION_ID}" == "null" ]]; then
  echo "Failed to create session."
  exit 1
fi

curl -s -X POST "http://127.0.0.1:${PORT}/session/${SESSION_ID}/message" \
  -H "content-type: application/json" \
  -d '{"parts":[{"type":"text","text":"Use bash tool to run pwd and ls, then reply DONE."}]}' >/dev/null

sleep 20

TRACE_FILE="${TMP_PROJ}/.GCC/law-enforcer-trace.jsonl"
if [[ ! -f "${TRACE_FILE}" ]]; then
  echo "FAIL  trace file missing: ${TRACE_FILE}"
  exit 1
fi

python3 - <<'PY' "${TRACE_FILE}"
import json
import sys

trace_file = sys.argv[1]
rows = []
with open(trace_file, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))

tool_rows = [r for r in rows if r.get("type") == "tool.execute.after"]
req_rows = [r for r in rows if r.get("type") == "watchman.request"]
resp_rows = [r for r in rows if r.get("type") == "watchman.response"]
req_with_tools = [
    r for r in req_rows
    if isinstance(r.get("evidence", {}).get("recentToolCalls"), list)
    and len(r.get("evidence", {}).get("recentToolCalls")) > 0
]

if not tool_rows:
    print("FAIL  no tool.execute.after entries in trace")
    raise SystemExit(1)
if not req_rows:
    print("FAIL  no watchman.request entries in trace")
    raise SystemExit(1)
if not resp_rows:
    print("FAIL  no watchman.response entries in trace")
    raise SystemExit(1)
if not req_with_tools:
    print("FAIL  no watchman.request entry contains recentToolCalls evidence")
    raise SystemExit(1)

print("PASS  live trace contains tool + request/response evidence")
PY

echo "PASS  live watchman trace test"
echo "project: ${TMP_PROJ}"
echo "trace:   ${TRACE_FILE}"
echo "server:  ${SERVER_LOG}"
