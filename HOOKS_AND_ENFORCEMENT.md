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
- Injects custom policy text and tool/skill hints from `.GCC/law-policy.txt` + `custom.hints`.

3. `tool.execute.after`
- Records tool and output in recent evidence.
- Updates checkpoint/failure/research debt.
- Runs deterministic violation checks.
- Evaluates user-defined `custom.rules` against tool/command/output context.
- Applies per-rule escalation (soft reminder first, then hard interruption).
- Optionally runs watchman check.

4. `message.updated` (assistant completion)
- Captures assistant identity/model.
- Runs watchman inspection on completed assistant turns.

5. `session.idle`
- Safety pass when session becomes idle.
- Can run watchman pass (configurable).

6. `session.compacted`
- Marks compaction debt.
- Enforces immediate checkpoint + context recovery path.

## Evidence Sent to Watchman
- Trigger type
- Latest assistant message summary
- Recent transcript window
- Recent tool-call records
- Debt state (checkpoint/research/failure/mcp indicators)
- Custom rule counters
- Law summary
- Plain-text policy (`.GCC/law-policy.txt`) and optional agent guide excerpt

## Structured Output Requirements
Watchman must return:
- `violation` (boolean)
- `rule` (string)
- `reason` (string)
- `correction_prompt` (string)
- `confidence` (number)

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
