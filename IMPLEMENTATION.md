# OpenContext Law Enforcer Implementation

## Goal
Implement a true watchman/inspection workflow in the OpenCode plugin so model behavior is inspected continuously and corrected in-session by an AI critic, not only by static prompt reminders.

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

## Enforcement Contract
- The watchman can interrupt after an assistant response if policy was violated.
- Correction prompt text is AI-generated when critic is available.
- Inspector payload includes:
  - Current law config
  - Latest assistant message text
  - Recent transcript window
  - Recent tool calls and outcomes
  - Session debt flags (checkpoint/failure lookup/research capture)
- Deterministic checks still run for hard requirements (e.g. GCC init, compaction checkpoint).

## Law File
Primary file:
- `.GCC/law-enforcer.json`
- Format: standard JSON config (opencode-style) for easier editing and tooling.

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
- Model: `openai/gpt-oss-120b-TEE`
- API key env (default): `CHUTES_API_KEY` (fallback: `OPENCONTEXT_LAW_API_KEY`)
- Optional model override env: `OPENCONTEXT_LAW_MODEL_ID`

Behavior:
- If available: watchman evaluates every assistant turn and returns structured violation JSON plus corrective prompt.
- If unavailable: deterministic rules continue enforcement.

## Installation Contract
One-command install still installs:
- OpenContext CLI
- OpenCode plugin
- OpenContext skill

Also:
- Installs policy template files
- Initializes `.GCC/law-enforcer.json` for local project installs when `.GCC` exists

## Test Contract
Must pass:
- plugin integration scripts
- deterministic research reminder test
- deterministic interruption test
- new assistant-turn watchman interruption test
- new watchman trace logging test (request/response + tool evidence)

## Non-Goals (Current)
- Hard stop/block on session completion
- Distributed cloud policy sync
- Multi-agent arbitration beyond current session

## Compatibility
- Plugin filename remains `opencontext-reminder.js`
- Existing log markers remain compatible for current tests
- Graceful behavior remains when `.GCC` is not initialized
