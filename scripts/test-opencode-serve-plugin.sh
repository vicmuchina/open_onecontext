#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_SRC="${ROOT_DIR}/opencontext/opencontext/plugin/opencontext-reminder.js"
PLUGIN_DST="${ROOT_DIR}/.opencode/plugins/opencontext-reminder.js"
PORT="${PORT:-40123}"
ASSERT_TOKEN="${ASSERT_TOKEN:-OCX_ASSERT_$(date +%s)}"
SERVER_LOG="$(mktemp)"
SERVER_PID=""

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

wait_for_server() {
  local attempts=0
  until rg -q "opencode server listening on http://127\\.0\\.0\\.1:${PORT}" "${SERVER_LOG}"; do
    attempts=$((attempts + 1))
    if [[ "${attempts}" -gt 60 ]]; then
      echo "Server did not become ready in time."
      echo "Server log: ${SERVER_LOG}"
      exit 1
    fi
    sleep 0.5
  done
}

wait_for_assistant_text() {
  local sid="$1"
  local attempts=0
  while [[ "${attempts}" -lt 120 ]]; do
    local text
    text="$(curl -s "http://127.0.0.1:${PORT}/session/${sid}/message" \
      | jq -r 'map(select(.info.role=="assistant")) | last | .parts[]? | select(.type=="text") | .text' \
      | tail -n 1 || true)"
    if [[ -n "${text}" && "${text}" != "null" ]]; then
      printf "%s\n" "${text}"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 0.5
  done
  return 1
}

require_cmd opencode
require_cmd curl
require_cmd jq
require_cmd rg

mkdir -p "${ROOT_DIR}/.opencode/plugins"
cp "${PLUGIN_SRC}" "${PLUGIN_DST}"

echo "Starting opencode serve on port ${PORT}..."
OPENCONTEXT_ASSERT_TOKEN="${ASSERT_TOKEN}" \
opencode serve --hostname 127.0.0.1 --port "${PORT}" --print-logs --log-level DEBUG >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

wait_for_server
echo "Server ready. log=${SERVER_LOG}"

SID="$(curl -s -X POST "http://127.0.0.1:${PORT}/session" | jq -r '.id')"
if [[ -z "${SID}" || "${SID}" == "null" ]]; then
  echo "Failed to create session."
  exit 1
fi
echo "Session: ${SID}"

curl -s -X POST "http://127.0.0.1:${PORT}/session/${SID}/message" \
  -H "content-type: application/json" \
  -d '{"parts":[{"type":"text","text":"Reply with the single word READY."}]}' >/dev/null

ASSISTANT_TEXT="$(wait_for_assistant_text "${SID}" || true)"
if [[ -z "${ASSISTANT_TEXT}" ]]; then
  echo "No assistant text found in session output."
  exit 1
fi

echo "Assistant text: ${ASSISTANT_TEXT}"
echo "PASS  assistant produced a response"

if rg -q "service=opencontext\\.plugin .*system prompt augmented" "${SERVER_LOG}"; then
  echo "PASS  system prompt transform logged"
else
  echo "FAIL  system prompt transform log missing"
  exit 1
fi

if rg -q "service=opencontext\\.plugin .*assert token mode enabled" "${SERVER_LOG}"; then
  echo "PASS  assert token mode logged"
else
  echo "FAIL  assert token mode log missing"
  exit 1
fi

echo "Serve-mode plugin prompt injection test passed."
echo "Server log: ${SERVER_LOG}"
