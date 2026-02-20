# Hooks and Enforcement Reference

This document explains exactly how the OpenCode plugin enforces workflow laws.

## Plugin File
- `opencontext/opencontext/plugin/opencontext-reminder.js`
- Optional runtime provider configs:
  - `~/.config/opencontext/law-runtime.json` (global)
  - `.GCC/law-runtime.json` (project override)

## Hook Coverage
1. `session.created`
- Initializes per-session state.
- Detects whether `.GCC` exists.
- Loads GCC context summary.
- Shows MCP awareness reminder.

2. `experimental.chat.system.transform`
- Injects OpenContext law contract into system prompt.
- Adds GCC branch/last commit summary when available.
- Injects policy text (default balanced baseline + user edits) and tool/skill hints from `.GCC/law-policy.txt` + `custom.hints`.

3. `tool.execute.after`
- Records tool and output in recent evidence.
- Updates checkpoint/failure/research debt plus debt-transition history.
- Failure debt is model-judged first (failure policy).
- Research debt is model-judged first (research policy).
- Runs deterministic violation checks.
- Evaluates user-defined `custom.rules` against tool/command/output context.
- Applies per-rule escalation (soft reminder first, then hard interruption).
- Watchman on tool calls is optional (`watchman.inspectToolCalls=false` by default), configurable.

4. `message.updated` (assistant completion)
- Captures assistant identity/model.
- Runs watchman inspection on completed assistant turns by default (`watchman.inspectAssistantTurns=true`).
- Can emit suggestion-only memory assistance from prior GCC history when confidence is high (`memoryAssist.*`).

5. `session.idle`
- Safety pass when session becomes idle.
- Can run watchman pass (configurable).

6. `session.compacted`
- Records compaction timestamp and recovery context.
- In deterministic compaction mode, opens compaction debt immediately.
- In model-driven compaction mode, watchman decides debt open/clear using interruption history and post-alert actions.

## Evidence Sent to Watchman
- Trigger type
- Latest assistant message summary
- Recent transcript window
- Recent tool-call records
- Recent interruption records + post-alert actions
- Recent debt transitions
- Debt state (checkpoint/research/failure/mcp indicators)
- Custom rule counters
- GCC history evidence (main/commit/log/metadata tails + semantic similar-attempt matches)
- Law summary
- Plain-text policy (`.GCC/law-policy.txt`) and optional agent guide excerpt

## Structured Output Requirements
Watchman must return:
- `violation` (boolean)
- `rule` (string)
- `reason` (string)
- `correction_prompt` (string)
- `confidence` (number)
- Optional:
  - `satisfaction_evidence` (string)
  - `debt_updates` object with `pendingCheckpointOverdue` and `pendingCompactionCheckpoint` (`open|clear|keep`)
  - `assist` object for suggestion-only memory guidance:
    - `should_suggest`, `confidence`, `reason`, `suggestions[]`

Critic must return:
- `enforce` (boolean)
- `reason` (string)

## Malformed Output Handling
- First malformed result: retry with stricter JSON-only instruction.
- Retry count: `critic.strictJsonRetryAttempts`.
- If still malformed: no interruption injected; parse failure logged.

## Interruption Mechanics
- Uses `client.session.promptAsync` (or fallback `prompt`) in same session.
- Respects:
  - global cooldown (`cooldowns.interruptionSeconds`)
  - same-rule cooldown (`cooldowns.sameRuleSeconds`)
  - max consecutive injections (`limits.maxConsecutiveInjections`)

## Planning Guard
To avoid nuisance interruptions during planning:
- `gcc.skipCheckpointDuringPlanningAgent`
- `watchman.skipDuringPlanningAgent`
- `custom.exemptAgentPatterns`

## Debugging Artifacts
- Runtime logs: OpenCode `--print-logs --log-level DEBUG`
- Trace file: `.GCC/law-enforcer-trace.jsonl`
- Key trace events:
  - `tool.execute.after`
  - `law.custom.violation`
  - `watchman.request`
  - `watchman.response`
  - `law.interrupt.request`
  - `law.interrupt.injected`
