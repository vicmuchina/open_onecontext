# OpenContext Law Enforcer Implementation

## Goal
Implement a continuous Law Enforcer/Criticizer in the OpenContext OpenCode plugin so agents are corrected while working, not only reminded once at session start.

## Problem
Prompt injection alone is frequently ignored during long coding runs. Agents drift away from:
- GCC/OpenContext checkpointing discipline
- MCP awareness and usage
- Capturing research findings into persistent context
- Retrieving previous failed attempts before retrying

## Solution Overview
The plugin remains `opencontext-reminder.js` for compatibility, but behavior is upgraded from reminders to enforcement:

1. Load user laws from `.GCC/law-enforcer.yaml`
2. Track per-session state (tool counts, pending debts, cooldowns)
3. Detect violations continuously during:
   - `session.created`
   - `message.updated`
   - `tool.execute.after`
   - `session.compacted`
   - `session.idle`
4. Interrupt with asynchronous continuation prompts in-session
5. Keep anti-loop safety (cooldowns, max consecutive injections)
6. Keep deterministic fallback if criticizer model is unavailable

## v1 Enforcement Scope
- GCC init enforcement
- Checkpoint enforcement every N tool calls
- Post-compaction checkpoint enforcement
- Failed-attempt lookup enforcement (`opencontext context --search` / `--log`)
- Research capture enforcement (docs/github/arxiv signal)
- MCP awareness + usage nudges when task/tool pattern indicates relevance

## Law File
Primary law file is project-local:
- `.GCC/law-enforcer.yaml`

CLI support:
- `opencontext law init`
- `opencontext law validate`
- `opencontext law status`

## Criticizer Model
Default critic configuration:
- Model: `openai/gpt-oss-120b-TEE`
- Endpoint: OpenAI-compatible (`https://llm.chutes.ai/v1`)
- API key source: env var (`OPENCONTEXT_LAW_API_KEY`)

If unavailable, plugin continues with deterministic rule checks.

## Installation Contract
One-command install continues to install:
- OpenContext CLI
- OpenCode plugin
- OpenContext skill

Additionally:
- install law template into local template directory
- create `.GCC/law-enforcer.yaml` automatically in local project install if `.GCC` exists

## Test Contract
Must pass:
- Existing plugin integration scripts
- Existing research reminder deterministic test
- New deterministic law enforcer test for interruption injection

## Non-Goals (v1)
- Hard-blocking session completion
- Multi-file policy inheritance
- Centralized cloud policy sync

## Compatibility
- Keep plugin filename unchanged: `opencontext-reminder.js`
- Keep existing log signatures used by current test scripts
- Preserve graceful behavior when GCC is not initialized
