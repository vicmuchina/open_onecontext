# Project Blueprint

## What This Project Is
OpenContext is a Git-like context controller (GCC) for long-horizon LLM coding work. The Law Enforcer plugin integrates with OpenCode and continuously checks whether the active model is following workflow laws.

## Primary Goals
- Preserve long-term context outside token limits (`.GCC/` memory).
- Enforce disciplined workflow in OpenCode sessions.
- Reduce repeated failures by requiring context lookup before retries.
- Capture useful research and decisions so future sessions can resume fast.

## Non-Goals
- Not a hard task blocker for every action.
- Not a replacement for core OpenCode planning/execution.
- Not cloud policy sync or multi-tenant policy service.

## Core Components
1. OpenContext CLI (`opencontext/.../cli/main.py`)
- Initializes GCC structure.
- Manages commit/branch/merge/context operations.
- Manages law files (`opencontext law init|validate|status`).

2. Law Enforcer Plugin (`opencontext/opencontext/plugin/opencontext-reminder.js`)
- Runs on OpenCode hooks.
- Tracks session debt and behavior.
- Calls watchman/critic model using OpenAI-compatible API.
- Injects correction prompts when policy violations are confirmed.

3. Law Config (`.GCC/law-enforcer.json`)
- Runtime policy and provider settings.
- Controls enforcement cadence, cooldowns, and retry strictness.
- Contains `custom.rules` and `custom.escalation` for user-defined workflow laws.

4. Text Policy (`.GCC/law-policy.txt`)
- Natural-language law instructions consumed by watchman on every inspection.
- Easy to edit by users/agents without changing plugin code.

5. Agent Handbook (`.GCC/AGENT_GUIDE.txt`)
- Generated plain-text guide for coding agents.
- Documents all configurable parameters and day-to-day workflow commands.

6. Trace Log (`.GCC/law-enforcer-trace.jsonl`)
- Verifiable request/response evidence.
- Includes tool-call evidence and watchman verdicts.

## Operating Contract
- Deterministic checks enforce high-priority rules (GCC init, checkpoint debt, compaction debt, failure lookup, research capture).
- Deterministic custom rules can be declared in JSON (`custom.rules`) without hardcoding.
- Watchman model evaluates recent messages + tool calls for policy drift.
- Watchman/critic output must be structured JSON (schema-constrained).
- If model output is malformed, plugin retries in strict JSON-only mode (`strictJsonRetryAttempts`) before skipping enforcement.

## Planning-Mode Contract
Default policy avoids interrupting planning runs for checkpoint debt:
- `gcc.skipCheckpointDuringPlanningAgent = true`
- `watchman.skipDuringPlanningAgent = true`

Read-only commands are not counted as significant checkpoint debt by default:
- `gcc.countReadOnlyToolsForCheckpoint = false`

## Provider Contract (OpenAI-Compatible)
Configured under `critic` in law file:
- `baseUrl`
- `endpointPath`
- `authHeader`
- `apiKeyPrefix`
- `headers`
- `request`
- `model`
- `apiKeyEnv`
- `strictJsonRetryAttempts`

Default provider is Chutes (`https://llm.chutes.ai/v1`) but any compatible provider can be used.

## Source of Truth Files
- High-level intent: `PROJECT_BLUEPRINT.md`
- Hook runtime behavior: `HOOKS_AND_ENFORCEMENT.md`
- Day-to-day operation: `AGENT_WORKFLOW.md`
- Formal technical detail: `SPEC.md`
- Implementation status/history: `IMPLEMENTATION.md`

## Acceptance Checklist for Future Changes
- Plugin still loads in OpenCode (`run` and `serve` paths).
- Malformed watchman output does not inject broken prompts.
- Strict retry path is preserved.
- Planning guard behavior remains enabled by default.
- Trace log includes `tool.execute.after`, `watchman.request`, `watchman.response`.
- Docs updated if any law fields, hooks, or flow change.
