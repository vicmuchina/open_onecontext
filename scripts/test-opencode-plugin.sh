#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_SRC="${ROOT_DIR}/opencontext/opencontext/plugin/opencontext-reminder.js"
PLUGIN_DST="${ROOT_DIR}/.opencode/plugins/opencontext-reminder.js"
GCC_DIR="${ROOT_DIR}/.GCC"
GCC_BACKUP="${ROOT_DIR}/.GCC.__plugin_test_backup__"
RUN_TIMEOUT_SECONDS="${RUN_TIMEOUT_SECONDS:-90}"

HAD_GCC=0

cleanup() {
  if [[ "${HAD_GCC}" -eq 1 && -d "${GCC_BACKUP}" ]]; then
    if [[ -d "${GCC_DIR}" ]]; then
      rm -rf "${GCC_DIR}"
    fi
    mv "${GCC_BACKUP}" "${GCC_DIR}"
  fi
}
trap cleanup EXIT

assert_has() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if rg -q "${pattern}" "${file}"; then
    printf "PASS  %s\n" "${label}"
  else
    printf "FAIL  %s\n" "${label}"
    printf "  pattern: %s\n" "${pattern}"
    printf "  log: %s\n" "${file}"
    exit 1
  fi
}

assert_not_has() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if rg -q "${pattern}" "${file}"; then
    printf "FAIL  %s\n" "${label}"
    printf "  unexpected pattern: %s\n" "${pattern}"
    printf "  log: %s\n" "${file}"
    exit 1
  else
    printf "PASS  %s\n" "${label}"
  fi
}

run_case() {
  local prompt="$1"
  local log_file="$2"
  if ! timeout "${RUN_TIMEOUT_SECONDS}" opencode --print-logs --log-level DEBUG run "${prompt}" >"${log_file}" 2>&1; then
    printf "FAIL  opencode run timed out (%ss): %s\n" "${RUN_TIMEOUT_SECONDS}" "${prompt}" >&2
    printf "  log: %s\n" "${log_file}" >&2
    exit 1
  fi
}

printf "== OpenCode Plugin Integration Test ==\n"
printf "repo: %s\n" "${ROOT_DIR}"

command -v opencode >/dev/null
command -v opencontext >/dev/null

mkdir -p "${ROOT_DIR}/.opencode/plugins"
cp "${PLUGIN_SRC}" "${PLUGIN_DST}"
printf "Installed plugin: %s\n" "${PLUGIN_DST}"

# Case 1: GCC present path.
LOG_A="$(mktemp)"
run_case "Plugin integration test with GCC enabled. Reply with ok." "${LOG_A}"

assert_has "${LOG_A}" "service=plugin path=file://${PLUGIN_DST//\//\\/} loading plugin" "plugin file loaded"
assert_has "${LOG_A}" "service=opencontext\\.plugin .*plugin initialized" "plugin initialized log"
assert_has "${LOG_A}" "service=opencontext\\.plugin .*event session\\.created" "session.created event seen"
assert_has "${LOG_A}" "service=opencontext\\.plugin .*gcc context loaded" "gcc context loaded log"
assert_has "${LOG_A}" "service=opencontext\\.plugin .*system prompt augmented" "system prompt transform ran"
assert_not_has "${LOG_A}" "service=opencontext\\.plugin .*toast unavailable" "no toast API failures"
if rg -q "service=opencontext\\.plugin .*opencontext CLI lookup failed" "${LOG_A}"; then
  printf "WARN  opencontext CLI lookup failed in opencode runtime path (continuing)\n"
else
  printf "PASS  opencontext CLI available in opencode runtime\n"
fi

# Case 2: Tool execution path.
LOG_B="$(mktemp)"
run_case "Use the bash tool to run pwd, then reply with ok." "${LOG_B}"
assert_has "${LOG_B}" "service=opencontext\\.plugin .*hook tool\\.execute\\.after" "tool.execute.after hook ran"
assert_not_has "${LOG_B}" "service=opencontext\\.plugin .*toast unavailable" "no toast API failures during tool run"

# Case 3: GCC missing path (graceful no-op).
if [[ -d "${GCC_DIR}" ]]; then
  HAD_GCC=1
  rm -rf "${GCC_BACKUP}"
  mv "${GCC_DIR}" "${GCC_BACKUP}"
fi

LOG_C="$(mktemp)"
run_case "Plugin no-GCC test. Reply with ok." "${LOG_C}"
assert_has "${LOG_C}" "service=opencontext\\.plugin .*event session\\.created" "session.created event seen without gcc"
assert_has "${LOG_C}" "service=opencontext\\.plugin .*gcc not initialized" "graceful no-gcc log"

printf "\nAll plugin integration checks passed.\n"
printf "Logs:\n"
printf "  gcc-on:  %s\n" "${LOG_A}"
printf "  tool:    %s\n" "${LOG_B}"
printf "  gcc-off: %s\n" "${LOG_C}"
