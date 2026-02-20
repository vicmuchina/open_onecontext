# OpenContext Law Enforcer Implementation

## Goal
Implement a true watchman/inspection workflow in the OpenCode plugin so model behavior is inspected continuously and corrected in-session by an AI critic, not only by static prompt reminders.

Companion docs:
- `PROJECT_BLUEPRINT.md`
- `HOOKS_AND_ENFORCEMENT.md`
- `AGENT_WORKFLOW.md`

External references for structured JSON behavior:
- Chutes docs: https://docs.chutes.ai/
- vLLM structured output reliability threads:
  - https://github.com/vllm-project/vllm/issues/7656
  - https://github.com/vllm-project/vllm/issues/11828

## Current Implementation Target (Active)

This file now tracks the active upgrade work. If session is interrupted, continue from this section.

### Upgrade Name
Model-Judged Debt and Interruption (Research/Failure/Trajectory-Aware)

### Why
Deterministic debt triggers based on simple patterns are brittle in dynamic OpenCode sessions. The enforcer should reason from:

- What the worker is currently trying to do
- What has already been committed in OpenContext
- What similar failures/solutions exist in prior traces

### Locked Decisions

1. Research debt judged by model (policy-driven), not simple regex/keyword matching.
2. Failure debt judged by model (policy-driven), with model-only gate available.
3. Interruption determined by model verdict + confidence threshold.
4. Unresolved-rule dedupe retained to prevent interruption loops.
5. History lookup strategy: recent-first, then semantic expansion.

### Work Breakdown (Execution Order)

1. Spec/docs update first (this file + SPEC.md) before code mutation.
2. Add model-judged research debt path and policy file support.
3. Expand history evidence collection (recent + semantic matches) for judge payload.
4. Refactor interruption path to rely on model judge outputs and confidence gate.
5. Keep deterministic signals as non-authoritative triggers only.
6. Extend trace schema and `law doctor` checks for new policy/evidence fields.
7. Add/adjust tests for:
   - research debt semantic judgment
   - failure debt model-only behavior
   - confidence-gated interrupt behavior
   - dedupe with new-evidence re-interrupt behavior

### Done So Far (Already Implemented)

- Watchman/failure policy prompt files introduced.
- Failure classifier path added with configurable model-only option.
- Unresolved-rule dedupe added for repeated interruptions.
- `opencontext law doctor` added and wired.
- Research classifier path added (`law-research-policy.txt`) with model-only option.
- GCC history evidence (recent + semantic matches) added to classifier/watchman payloads.
- Watchman interruption now uses confidence threshold + model-decision gating.
- Law asset generation/doctor/guide now includes research policy file.

### Remaining

- Run live `opencode`/`opencode serve` smoke loops and tune policy prompts from trace evidence.
- Expand optional semantic-history retrieval depth if required by larger repositories.

### Continuation Checkpoint (2026-02-19)

- Completed priorities 1-3 in this iteration.
- Next session should focus on live enforcement tuning (confidence/prompt calibration), not architecture changes.

## Problem
One-time prompt injection is not sufficient in long coding sessions. Agents often ignore workflow rules while focused on implementation, especially around:
- GCC/OpenContext checkpoint discipline
- Retrieval of failed attempts before retries
- MCP discovery and usage when relevant
- Capturing docs/GitHub research into persistent context

## v2 Solution Overview (Active Watchman)
The plugin stays at `opencontext-reminder.js` for compatibility, but enforcement is upgraded to active inspection:

1. Load law policy from `.GCC/law-enforcer.json` (with backward-compatible YAML fallback)
2. Track session state with recent messages + recent tool activity
3. Continuously inspect behavior during:
   - `session.created` (initial obligations and context)
   - `tool.execute.after` (live workflow drift)
   - `message.updated` assistant completion events
   - `session.idle` (safety pass)
   - `session.compacted` (mandatory recovery path)
4. Pull full session transcript via OpenCode session APIs for inspector context
5. Run AI watchman model on each assistant turn (when enabled) to decide violation/no-violation and generate corrective prompt text
6. Inject corrective continuation in the same session via `client.session.promptAsync`
7. Apply anti-loop controls (cooldowns, same-rule cooldown, max consecutive injections, in-flight guards)
8. Fall back to deterministic rule checks if watchman model is unavailable
9. Require structured JSON-schema responses from watchman/critic (OpenAI-compatible `response_format`), with strict retry on malformed outputs and no free-text fallback interruption

## v3 Solution Overview (User-Programmable Laws)
To avoid hardcoded enforcement and make future customization agent-friendly:

1. Added `custom` section in `.GCC/law-enforcer.json`
   - `custom.rules` for trigger-based checks (`assistant_turn`, `tool_call`, `compaction`, `idle`)
   - `custom.escalation` for soft-then-hard behavior
   - `custom.hints` to advertise preferred tools/skills/commands/MCPs
2. Added `.GCC/law-policy.txt`
   - Natural-language policy file loaded into watchman payload
3. Added `.GCC/law-runtime.json`
   - Project-local provider key/model overrides (no repeated env exports required)
4. Added `.GCC/AGENT_GUIDE.txt`
   - Generated plain-text handbook for coding agents
   - Explains all parameters and edit points
5. Added per-rule counters in session state + trace
   - `law.custom.violation` rows in `.GCC/law-enforcer-trace.jsonl`
6. Added `opencontext law guide`
   - Regenerates `AGENT_GUIDE.txt` from current project law settings
7. Auto-generation on:
   - `opencontext init`
   - `opencontext law init`
   - `opencontext setup-opencode` (project mode with `.GCC`)

## Enforcement Contract
- The watchman can interrupt after an assistant response if policy was violated.
- Correction prompt text is AI-generated when critic is available.
- Provider calls are OpenAI-compatible and configurable (base URL, endpoint path, auth header/prefix, custom headers, request overrides).
- Inspector payload includes:
  - Current law config
  - Latest assistant message text
  - Recent transcript window
  - Recent tool calls and outcomes
  - Session debt flags (checkpoint/failure lookup/research capture)
- Deterministic checks still run for hard requirements (e.g. GCC init, compaction checkpoint).
- Planning guard defaults avoid false interruptions during planner turns:
  - `gcc.skipCheckpointDuringPlanningAgent=true`
  - `watchman.skipDuringPlanningAgent=true`

## Law File
Primary file:
- `.GCC/law-enforcer.json`
- Format: standard JSON config (opencode-style) for easier editing and tooling.

Companion files:
- `.GCC/law-policy.txt` (editable plain-text policy for watchman)
- `.GCC/AGENT_GUIDE.txt` (agent-readable setup/customization handbook)

Trace file:
- `.GCC/law-enforcer-trace.jsonl`
- Contains watchman request/response records plus captured tool-execution evidence used by the inspector.

CLI support:
- `opencontext law init`
- `opencontext law validate`
- `opencontext law status`

## Critic/Watchman Model
Default:
- Provider style: OpenAI-compatible
- Endpoint: `https://llm.chutes.ai/v1`
- Path: `/chat/completions`
- Primary model: `chutesai/Mistral-Small-3.2-24B-Instruct-2506`
- Default fallbacks: `NousResearch/Hermes-4-14B`, `zai-org/GLM-4.6-FP8`, `deepseek-ai/DeepSeek-V3-0324-TEE`
- API key env (default): `CHUTES_API_KEY` (fallback: `OPENCONTEXT_LAW_API_KEY`)
- Optional model override env: `OPENCONTEXT_LAW_MODEL_ID`

Behavior:
- If available: watchman evaluates every assistant turn and returns structured violation JSON plus corrective prompt.
- If unavailable: deterministic rules continue enforcement.
- If response is malformed/non-JSON: retried in strict JSON-only mode, then logged as parse error and ignored for interruption if still invalid.

## Installation Contract
One-command install still installs:
- OpenContext CLI
- OpenCode plugin
- OpenContext skill

Also:
- Installs policy template files
- Initializes `.GCC/law-enforcer.json` for local project installs when `.GCC` exists
- Ships `agent.txt` fallback setup flow for autonomous/manual installation when installer automation fails

## Test Contract
Must pass:
- plugin integration scripts
- deterministic research reminder test
- deterministic interruption test
- new assistant-turn watchman interruption test
- new watchman trace logging test (request/response + tool evidence)
- malformed watchman output guard test (no injection on invalid output)
- provider-agnostic config test (custom endpoint/header + schema request)
- planning guard test (no checkpoint interruption for planner agent)

## Non-Goals (Current)
- Hard stop/block on session completion
- Distributed cloud policy sync
- Multi-agent arbitration beyond current session

## Compatibility
- Plugin filename remains `opencontext-reminder.js`
- Existing log markers remain compatible for current tests
- Graceful behavior remains when `.GCC` is not initialized
