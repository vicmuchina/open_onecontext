# OpenContext

Git Context Controller (GCC) for OpenCode - Version control for LLM agent context.

[![Python Version](https://img.shields.io/badge/python-3.9%2B-blue)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Based on:** "Git Context Controller: Manage the Context of LLM-based Agents like Git" (arXiv:2508.00031)

## Start Here (Quick Path)

If you just want this working with minimal reading:

1. Install:
```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```
2. In your project:
```bash
opencontext init --project-name "<name>" --goal-file SPEC.md
opencontext law init
opencontext law doctor
```
3. To let an AI assistant configure everything for you, tell it to read:
- `.GCC/AGENT_GUIDE.txt` (main operator guide)
- `.GCC/law-enforcer.json` (switches/thresholds)
- `.GCC/law-policy.txt` (plain-language rules; already includes an active balanced default policy)
4. Watch live watchman I/O:
```bash
opencontext io
```

## Overview

OpenContext elevates LLM agent context from passive token streams to a navigable, versioned memory hierarchy. Inspired by Git, it provides explicit operations for managing agent memory across long-horizon workflows.

**Key Innovation:** Agents can COMMIT milestones, BRANCH to explore alternatives, MERGE results, and retrieve CONTEXT at varying resolutions - enabling structured reflection and seamless session handoffs.

Repository blueprint docs (root):
- `../PROJECT_BLUEPRINT.md`
- `../HOOKS_AND_ENFORCEMENT.md`
- `../AGENT_WORKFLOW.md`

## Have You Been Experiencing This?

If yes, this system is built for exactly that:
- You give clear instructions at session start, then the agent drifts later.
- It ignores available tools/skills/MCPs until you manually remind it.
- It brute-forces instead of consulting docs or similar repos first.
- After compaction, it forgets key workflow rules and repeats mistakes.
- You spend time babysitting instead of building.

What OpenContext + Law Enforcer changes:
- Continuous supervision, not one-time prompt injection.
- Automatic workflow interruptions when guard rails are violated.
- Checkpoint discipline so important breakthroughs are captured.
- Failure-retry guard so prior attempts are reviewed before retry loops.
- Trace logs so you can verify what the enforcer saw and decided.

## Features

🎯 **Core GCC Operations**
- `commit` - Checkpoint meaningful progress
- `branch` - Explore alternatives in isolation
- `merge` - Synthesize divergent paths
- `context` - Retrieve history at any granularity

🤖 **OpenCode Integration**
- Auto-discovers context on session start
- Continuous Law Enforcer checks (GCC/MCP/research)
- Per-assistant-turn watchman inspection using session transcript + tool traces
- In-session interruption prompts on workflow violations (AI-generated correction prompt)
- Structured watchman/critic parsing (`json_schema` with configurable `json_object` fallback; no free-text interruption)
- Model-judged failure lookup classification (actionable failure vs setup/CLI noise)
- Model-judged research capture classification (checkpoint-worthy insight vs routine exploration)
- Optional model-only gates (`gcc.failureClassifierRequireModelDecision`, `research.captureClassifierRequireModelDecision`, `watchman.requireModelDecision`)
- Trajectory-aware watchman payload (includes GCC commit/log evidence + semantic similar-attempt matches)
- OpenAI-compatible provider configuration (Chutes or any compatible endpoint)
- Context compaction checkpoint enforcement
- Session handoff support

📊 **Rich TUI Dashboard**
- Visual branch browser
- Commit timeline
- Evolution tracking
- Performance metrics

🧬 **Evolution Tracking**
- Document approaches tried
- Track what worked vs. abandoned
- Record user feedback
- Performance metrics per approach

🔗 **Git Integration**
- Automatic git commits
- Branch synchronization
- Full traceability

## Prerequisites

- **Python**: 3.9 or higher
- **Git**: Initialized repository (optional but recommended)
- **OpenCode**: For plugin integration (optional)

## Installation

### One-Command Install (Recommended)

Install everything (CLI, plugin, and skill) with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

Install global + project-local plugin/skill (run from project root):

```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash -s -- --local
```

Or with `wget`:

```bash
wget -qO- https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

This will:
- ✅ Install the `opencontext` CLI tool
- ✅ Install the OpenCode plugin (global)
- ✅ Install the OpenContext skill
- ✅ Set up all necessary directories
- ✅ Provide fallback bootstrap instructions in repo `agent.txt`

### Via pip

```bash
pip install opencontext

# Then setup OpenCode integration
opencontext setup-opencode --global
```

### From Source

```bash
git clone https://github.com/vicmuchina/open_onecontext.git
cd open_onecontext/opencontext
pip install -e .
opencontext setup-opencode --global
```

### Setup OpenCode Plugin

The OpenCode plugin provides continuous Law Enforcer checks for GCC/MCP/research workflow. It must be installed in your OpenCode plugins directory.

#### Option 1: Project-level (Recommended)

Install in your specific project:

```bash
# Create the plugins directory if it doesn't exist
mkdir -p .opencode/plugins

# Copy the plugin
cp $(opencontext plugin-path) .opencode/plugins/opencontext-reminder.js
```

#### Option 2: Global (All Projects)

Install system-wide for all OpenCode projects:

```bash
# Create the global plugins directory if it doesn't exist
mkdir -p ~/.config/opencode/plugins

# Copy the plugin
cp $(opencontext plugin-path) ~/.config/opencode/plugins/opencontext-reminder.js
```

**Note:** The `plugin` array in `opencode.json` is for npm packages only. Local plugins are automatically loaded from:
- `~/.config/opencode/plugins/` (global)
- `.opencode/plugins/` (project-level)

#### Verify Installation

```bash
# Check CLI
opencontext --version

# Check plugin (project-level)
ls -la .opencode/plugins/opencontext-reminder.js

# Check plugin (global)
ls -la ~/.config/opencode/plugins/opencontext-reminder.js

# Check law policy (after opencontext init + opencontext law init)
ls -la .GCC/law-enforcer.json
ls -la .GCC/law-policy.txt
ls -la .GCC/law-watchman-system.txt
ls -la .GCC/law-failure-policy.txt
ls -la .GCC/law-research-policy.txt
ls -la .GCC/AGENT_GUIDE.txt
```

### Plugin Development and Debugging

```bash
# Run plugin integration tests (run-mode)
./scripts/test-opencode-plugin.sh

# Run deterministic research-reminder unit test
node ./scripts/test-opencode-plugin-research.mjs

# Run deterministic law-enforcer interruption test
node ./scripts/test-opencode-plugin-law.mjs

# Run assistant-turn watchman interruption test (model mocked)
node ./scripts/test-opencode-plugin-watchman.mjs

# Run memory-assist suggestion-only test (model mocked)
node ./scripts/test-opencode-plugin-memory-assist.mjs

# Run watchman trace logging test (request/response + tool evidence)
node ./scripts/test-opencode-plugin-trace.mjs

# Run malformed provider-output guard test (must NOT inject prompt)
node ./scripts/test-opencode-plugin-watchman-malformed.mjs

# Run provider-agnostic OpenAI-compatible config test
node ./scripts/test-opencode-plugin-provider-config.mjs

# Run runtime-config key/model override test (no env export required)
node ./scripts/test-opencode-plugin-runtime-config.mjs

# Run planning guard test (prevents checkpoint interruption during plan agent)
node ./scripts/test-opencode-plugin-planning-guard.mjs

# Run custom-rule soft->hard escalation test
node ./scripts/test-opencode-plugin-custom-rules.mjs

# Run failure lookup noise filter + unresolved-debt dedupe test
node ./scripts/test-opencode-plugin-failure-debt-filter.mjs

# Validate law asset generation from CLI (law json + policy + agent guide)
./scripts/test-opencontext-law-assets.sh

# Validate context search/limit behavior used by law-enforcer guidance
./scripts/test-opencontext-context-search.sh

# Run serve-mode plugin test (headless API path)
./scripts/test-opencode-serve-plugin.sh

# Run live watchman trace test (requires CHUTES_API_KEY)
CHUTES_API_KEY=... ./scripts/test-opencode-watchman-trace-live.sh

# Benchmark provider models for JSON compliance + speed (watchman-style tasks)
# Chutes
CHUTES_API_KEY=... python3 ./scripts/chutes_json_benchmark.py --base-url https://llm.chutes.ai/v1 --api-key-env CHUTES_API_KEY --response-format json_object --top 20 --write-runtime .GCC/law-runtime.json
# Any OpenAI-compatible provider
PROVIDER_API_KEY=... python3 ./scripts/chutes_json_benchmark.py --base-url https://<provider>/v1 --api-key-env PROVIDER_API_KEY --max-models 20 --response-format json_object --top 20 --write-runtime .GCC/law-runtime.json

# Manual debug logs
opencode --print-logs --log-level DEBUG run "plugin smoke test"
```

Optional prompt-path assertion mode:

```bash
OPENCONTEXT_ASSERT_TOKEN=OCX_TEST opencode --print-logs --log-level DEBUG run "reply with ok"
```

When enabled, the plugin logs `assert token mode enabled` during system prompt transform.

## Quick Start

After running the one-command install above, you're ready to go:

### 1. Initialize Project

Navigate to your project and initialize GCC:

```bash
cd /path/to/your/project
opencontext init --project-name "MyApp" --goal "Build a web scraper"
# or infer from an existing markdown spec/blueprint:
opencontext init --project-name "MyApp" --goal-file SPEC.md
```

This creates a `.GCC/` directory with:
- `main.md` - Project roadmap
- `branches/main/` - Main branch with commit.md, log.md, metadata.yaml

Goal resolution order during `opencontext init`:
1. `--goal` text
2. `--goal-file` markdown content
3. common files in project root (`SPEC.md`, `spec.md`, `PROJECT_BLUEPRINT.md`, `IMPLEMENTATION.md`, `README.md`)
4. fallback text: `Project goal not specified`

### 2. Start OpenCode

```bash
opencode
```

The plugin automatically loads and will continuously enforce GCC discipline.

### 2.5 Initialize Law Policy

```bash
opencontext law init
opencontext law validate
opencontext law doctor
opencontext law status
opencontext io
opencontext law guide
```

Configure critic/watchman provider (OpenAI-compatible):

```bash
export CHUTES_API_KEY="<your_api_key>"
# Optional model override without editing law file
export OPENCONTEXT_LAW_MODEL_ID="chutesai/Mistral-Small-3.2-24B-Instruct-2506"
```

No-repeat key setup:
- Global file: `~/.config/opencontext/law-runtime.json`
- Project override: `.GCC/law-runtime.json`

Auto-select best model + fallbacks and write runtime config:

```bash
# Project-local runtime
python3 scripts/chutes_json_benchmark.py --base-url https://llm.chutes.ai/v1 --api-key-env CHUTES_API_KEY --response-format json_object --top 15 --write-runtime .GCC/law-runtime.json

# Global runtime (all projects)
python3 scripts/chutes_json_benchmark.py --base-url https://<provider>/v1 --api-key-env <ENV_VAR> --max-models 20 --response-format json_object --top 15 --write-runtime ~/.config/opencontext/law-runtime.json
```

Default `.GCC/law-enforcer.json` uses Chutes (`https://llm.chutes.ai/v1`) but you can switch to any OpenAI-compatible provider:

```json
{
  "critic": {
    "provider": "openai_compatible",
    "baseUrl": "https://<provider-base>/v1",
    "endpointPath": "/chat/completions",
    "authHeader": "authorization",
    "apiKeyPrefix": "Bearer",
    "headers": {},
    "request": {},
    "model": "<provider_model_id>",
    "modelFallbacks": ["<fallback_model_id_1>", "<fallback_model_id_2>"],
    "apiKeyEnv": "CHUTES_API_KEY",
    "modelEnv": "OPENCONTEXT_LAW_MODEL_ID",
    "strictJsonRetryAttempts": 2,
    "responseFormatStrategy": "json_schema_then_json_object"
  }
}
```

Notes:
- `apiKeyEnv` is the env var name used at runtime.
- If your provider does not use `Authorization: Bearer`, change `authHeader` and `apiKeyPrefix`.
- The plugin starts with `response_format: { type: "json_schema", ... }` and can fall back to `{ type: "json_object" }` when configured.
- If provider output is malformed, it retries in stricter JSON-only mode (`critic.strictJsonRetryAttempts`) before skipping enforcement.
- Hard deterministic invariants remain active even when model output is malformed; policy-level checks can stay model-only based on your `*RequireModelDecision` settings.

Decision model (plain terms):
- Failure retry gating is model-judged first (via the failure policy prompt in `.GCC/law-failure-policy.txt`).
- Research capture debt is model-judged first (via `.GCC/law-research-policy.txt`).
- Watchman interruption is model-judged with confidence threshold (`watchman.minConfidence`) and optional model-only mode (`watchman.requireModelDecision`).
- Watchman memory assistance is suggestion-only and confidence-gated (`memoryAssist.minSuggestConfidence`).
- Default watchman system prompt is precision-biased to reduce noise (read-only exploration/setup/CLI noise should not interrupt unless clearly actionable).
- Lightweight pattern checks are only a trigger/fallback safety net.
- If you want model-only judgment (no fallback decisions), set:
  - `gcc.failureClassifierRequireModelDecision: true`
  - `research.captureClassifierRequireModelDecision: true`
  - `watchman.requireModelDecision: true`
- Repeated interruption suppression is state-based dedupe (not regex), to prevent spam loops on the same unresolved violation.

Watchman request/response traces are persisted to:

```bash
.GCC/law-enforcer-trace.jsonl
```

Agent customization files:

```bash
.GCC/law-policy.txt
.GCC/law-watchman-system.txt
.GCC/law-failure-policy.txt
.GCC/law-research-policy.txt
.GCC/AGENT_GUIDE.txt
```

Custom workflow rules (no plugin code edits needed):
- Edit `.GCC/law-enforcer.json` -> `custom.rules`
- Edit `.GCC/law-enforcer.json` -> `custom.escalation`
- Edit `.GCC/law-policy.txt` for natural-language laws
- Edit `.GCC/law-watchman-system.txt` to customize watchman system behavior
- Edit `.GCC/law-failure-policy.txt` to customize failure lookup classification
- Edit `.GCC/law-research-policy.txt` to customize research capture classification
- Rebuild guide after major changes: `opencontext law guide`

### 3. Day-to-Day Workflow with OpenCode

1) Start a project once:

```bash
opencontext init --project-name "MyApp" --goal "Build a web scraper"
# or infer from project docs:
opencontext init --project-name "MyApp" --goal-file SPEC.md
opencontext law init
opencontext law validate
opencontext law doctor
```

2) Start OpenCode normally (interactive) or via server mode:

```bash
opencode
# or
opencode serve --hostname 127.0.0.1 --port 4096 --print-logs --log-level DEBUG
```

3) Work as usual. The plugin continuously enforces:
- checkpoint discipline
- failure lookup before retries
- research capture after docs/GitHub findings
- MCP awareness and usage nudges
- session compaction recovery

4) When the Law Enforcer interrupts, satisfy required actions and continue:

```bash
opencontext context --log --lines 80
opencontext commit -m "Checkpoint after <work>"
# or positional form:
opencontext commit "Checkpoint after <work>"
```

5) Inspect runtime evidence while debugging:

```bash
# OpenCode/plugin logs
opencode --print-logs --log-level DEBUG run "plugin smoke test"

# Law Enforcer watchman request/response (formatted)
opencontext io
# live follow
opencontext law watch --follow
```

6) Plan-agent guard behavior:
- By default, planning phases are not interrupted for checkpoint debt.
- This is controlled by:
  - `gcc.skipCheckpointDuringPlanningAgent`
  - `watchman.skipDuringPlanningAgent`
  - `custom.exemptAgentPatterns`

7) Verify install quickly:

```bash
opencontext --version
opencode --version
opencontext status
opencontext context
```

## Commands

### Core Commands

```bash
# Initialize GCC in current directory
opencontext init [--project-name <name>] [--goal <description>]
# Optional: infer goal text from existing markdown file
opencontext init [--project-name <name>] [--goal-file SPEC.md]

# Create a checkpoint
opencontext commit -m <summary> [--approach <name>] [--status <active|abandoned|merged>]
# or positional:
opencontext commit <summary> [--approach <name>] [--status <active|abandoned|merged>]

# Create isolated branch
opencontext branch <name>

# Merge branch into current
opencontext merge <branch>

# Switch active branch
opencontext switch <branch>

# Show status
opencontext status

# List branches
opencontext list
```

### Context Retrieval

```bash
# Git status-style overview
opencontext context

# Show specific branch
opencontext context --branch main

# Show specific commit
opencontext context --commit abc123

# Show execution log
opencontext context --log [--lines 50]

# Show metadata
opencontext context --metadata file_structure

# Search context
opencontext context --search "authentication" --limit 20

# Export as JSON
opencontext context --export --format json
```

### TUI Dashboard

```bash
# Launch dashboard
opencontext tui [--theme dark|light]
```

### Utility Commands

```bash
# Add user feedback
opencontext feedback "The RAG approach is too slow"

# Record benchmark
opencontext benchmark --task "SWE-Bench-Lite" --pass-rate 40.7

# Tag milestone
opencontext tag milestone-v1

# Delete branch
opencontext delete <branch>
```

## File Structure

```
.GCC/
├── main.md                      # Global project roadmap
├── .current_branch             # Tracks active branch
├── evolution.yaml              # Project evolution tracking
└── branches/
    ├── main/
    │   ├── commit.md           # Commit summaries (3-block format)
    │   ├── log.md              # Execution traces (OTA cycles)
    │   └── metadata.yaml       # File structure, env, deps
    └── feature-branch/
        ├── commit.md
        ├── log.md
        └── metadata.yaml
```

### File Format Reference

#### main.md
```markdown
# Project: <name>

## Goal
<High-level project objective>

## Milestones
- [x] Completed task
- [ ] Pending task

## Current Status
<Current phase and key decisions>

## Notes
<Important architectural decisions>
```

#### commit.md (Per Branch)
```markdown
## Branch Purpose
<Why this branch was created>

## Previous Progress Summary
<Coarse-grained history>

## Commits

### <hash> - <timestamp>
**Summary:** <What was achieved>
**Files Modified:** <List of files>
**Description:** <Detailed narrative>
**Approach:** <Approach name>
**Status:** <active|abandoned|merged>
**Performance:** <Optional metrics>
```

#### log.md (Execution Traces)
```markdown
# Execution Log - Branch: <name>

## <timestamp> - Turn 1
**Observation:** <What was observed>
**Thought:** <Agent's reasoning>
**Action:** <Tool call made>
**Result:** <Execution result>
```

#### metadata.yaml
```yaml
branch_name: <name>
created_at: "<timestamp>"
current_commit_hash: <hash>

file_structure:
  root:
    - file1.py
    - file2.py

environment:
  python_version: "3.11.0"
  platform: "Linux"

dependencies:
  python:
    - requests: "2.31.0"

approaches:
  - name: "Approach Name"
    status: "active"
    commit_hash: "abc123"
    reason: "Why abandoned"  # if applicable

user_feedback: []
performance_metrics: {}
```

#### evolution.yaml (Project-wide)
```yaml
project_name: <name>
created_at: "<timestamp>"

approaches_history:
  - name: "Approach Name"
    timeline: "start - end"
    description: "What was tried"
    outcome: "active|abandoned|merged"
    reason: "Why it was abandoned"
    lessons: "What was learned"

user_sessions:
  - session_id: "<id>"
    user_feedback:
      - "Feedback text"
    key_decisions:
      - "Decision made"

performance_trends:
  - date: "<timestamp>"
    task: "Task name"
    pass_rate: "95%"
```

## OpenCode Plugin Features

The plugin provides a **continuous Law Enforcer** (interrupt + continue):

### 1. Context Compaction Enforcement (Critical)
When OpenCode compacts context:
```
⚠️ Context compacted. Checkpoint required.
💡 opencontext commit -m '<summary>'
💡 opencontext context --log --lines 80
```

### 2. Milestone Checkpoint Enforcement
```
⚖️ Checkpoint debt detected after significant tool activity.
Law Enforcer injects continuation prompt requiring checkpoint.
```

### 3. Research + Failure Debt Enforcement
- Research capture debt is opened by model judgment when external research should be checkpointed.
- Failure lookup debt is opened by model judgment when retries should consult prior attempts first.
- Both are configurable with:
  - `.GCC/law-research-policy.txt`
  - `.GCC/law-failure-policy.txt`

### 4. Auto-Discovery on Session Start
When starting a new session in a GCC project:
```
## GCC Project Context
Active Branch: main
Last commit: "Debugging auth issue" (abc123)
Commits ahead: 3
Approaches: 2 (1 abandoned)

💡 Available commands: opencontext commit, branch, merge, context
📊 Run 'opencontext tui' for visual dashboard
```

### 5. Idle Safety Inspection
```
⏸️ Session idle.
If `watchman.inspectOnIdle=true`, Law Enforcer runs an extra watchman pass.
No fixed checkpoint toast is emitted on idle.
```

### Research + MCP Discipline
- Detects docs/GitHub/arXiv research and requires capture via `opencontext commit`
- Detects likely MCP-relevant phases and reminds/enforces MCP usage
- Requires context lookup before retrying after failure signals

## How the Plugin Works

The OpenCode plugin hooks into OpenCode's event system:

1. **Session Created** (`session.created`)
   - Detects `.GCC/` directory
   - Runs `opencontext context` to get current status
   - Injects context into the system prompt
   - Shows initialization status toast

2. **Context Compacted** (`session.compacted`)
   - Triggered when OpenCode truncates context
   - Records compaction timestamp and recovery context
   - In deterministic mode: opens compaction debt immediately
   - In model modes: watchman judges whether compaction debt should open/clear based on post-alert actions
   - Compaction notice is informational; corrective commands come from watchman/deterministic debt flow, not fixed reminder cadence

3. **Tool Execution** (`tool.execute.after`)
   - Tracks every tool execution
   - Updates debt state, debt transitions, and deterministic/custom rule checks
   - Optional watchman inspection on tool activity when `watchman.inspectToolCalls=true` (default is `false` for lower-noise operation)
   - Tracks research/failure/MCP workflow debts

4. **Message Updated** (`message.updated`)
   - Triggered when assistant output completes
   - Runs watchman inspection on completed assistant turns (`watchman.inspectAssistantTurns=true`)

5. **Session Idle** (`session.idle`)
   - Optional safety inspection pass (`watchman.inspectOnIdle=true`, default is `false`)

### Watchman Response Contract
- Provider API: OpenAI-compatible `POST /chat/completions`
- Request uses structured `response_format` (default `json_schema`, optional fallback `json_object`)
- Required output fields: `violation`, `rule`, `reason`, `correction_prompt`, `confidence`
- Optional output fields: `satisfaction_evidence`, `debt_updates`
  - `debt_updates.pendingCheckpointOverdue`: `open|clear|keep`
  - `debt_updates.pendingCompactionCheckpoint`: `open|clear|keep`
- Optional memory assistance field: `assist` (suggestion-only guidance)
  - `assist.should_suggest`: boolean
  - `assist.confidence`: number
  - `assist.reason`: string
  - `assist.suggestions[]`: `title`, `why_now`, `action`, optional `command`, `memory_refs[]`
- Malformed/free-text responses trigger strict retry first, then are logged as parse errors if still invalid

## Evolution Tracking

Track your agent's learning journey:

```yaml
# evolution.yaml
approaches_history:
  - name: "RAG Memory Experiment"
    timeline: "2025-02-11 - 2025-02-11"
    description: "Prototype retriever-augmented memory"
    outcome: "abandoned"
    reason: "Too fragile, computationally expensive"
    lessons: "Simple solutions often outperform complex ones"
    
  - name: "Summary-based Compression"
    timeline: "2025-02-11 - present"
    description: "Compressed context summaries"
    outcome: "active"
    performance: "40% faster, higher accuracy"

user_sessions:
  - session_id: "sess_001"
    user_feedback:
      - "The RAG approach was too slow for production"
    key_decisions:
      - "Switched from RAG to summary-based approach"
```

## Configuration

### OpenCode Runtime Config
`~/.config/opencode/opencode.json` controls your OpenCode provider/MCP setup.
The OpenContext plugin reads this runtime environment and project `.GCC` law files.

### Law Runtime Config (optional, avoids repeated env exports)
- Global: `~/.config/opencontext/law-runtime.json`
- Project override: `.GCC/law-runtime.json`
- Supports:
  - `critic.apiKey`
  - `critic.model`
  - `critic.modelFallbacks`
  - `critic.responseFormatStrategy`
  - optional provider fields (`baseUrl`, `endpointPath`, `authHeader`, etc.)
- Precedence:
  1. environment variables
  2. project runtime config
  3. global runtime config
  4. `.GCC/law-enforcer.json` defaults

Example `law-runtime.json`:
```json
{
  "critic": {
    "apiKey": "cpk_...",
    "model": "chutesai/Mistral-Small-3.2-24B-Instruct-2506",
    "modelFallbacks": ["NousResearch/Hermes-4-14B", "zai-org/GLM-4.6-FP8"],
    "baseUrl": "https://llm.chutes.ai/v1",
    "endpointPath": "/chat/completions"
  }
}
```

### Law Enforcer Policy (Primary)
`.GCC/law-enforcer.json`:

```json
{
  "gcc": {
    "requireCheckpointEveryTools": 10,
    "checkpointDebtJudgeMode": "model_only",
    "requireFailedAttemptLookup": true,
    "failureLookupPolicyFile": "law-failure-policy.txt",
    "failureClassifierEnabled": true,
    "failureClassifierMinConfidence": 0.7,
    "failureClassifierRequireModelDecision": true,
    "compactionCheckpointRequired": true,
    "compactionDebtJudgeMode": "model_only",
    "skipCheckpointDuringPlanningAgent": true,
    "countReadOnlyToolsForCheckpoint": false
  },
  "research": {
    "requireCaptureOnDocsOrGithub": true,
    "capturePolicyFile": "law-research-policy.txt",
    "captureClassifierEnabled": true,
    "captureClassifierMinConfidence": 0.7,
    "captureClassifierRequireModelDecision": true
  },
  "critic": {
    "provider": "openai_compatible",
    "baseUrl": "https://llm.chutes.ai/v1",
    "endpointPath": "/chat/completions",
    "authHeader": "authorization",
    "apiKeyPrefix": "Bearer",
    "headers": {},
    "request": {},
    "model": "chutesai/Mistral-Small-3.2-24B-Instruct-2506",
    "modelFallbacks": ["NousResearch/Hermes-4-14B", "zai-org/GLM-4.6-FP8", "deepseek-ai/DeepSeek-V3-0324-TEE"],
    "apiKeyEnv": "CHUTES_API_KEY",
    "modelEnv": "OPENCONTEXT_LAW_MODEL_ID",
    "strictJsonRetryAttempts": 2,
    "responseFormatStrategy": "json_schema_then_json_object"
  },
  "watchman": {
    "enabled": true,
    "inspectAssistantTurns": true,
    "inspectToolCalls": false,
    "inspectCompaction": true,
    "inspectOnIdle": false,
    "skipDuringPlanningAgent": true,
    "dedupeSameViolationUntilResolved": true,
    "minConfidence": 0.75,
    "requireModelDecision": true,
    "systemPromptFile": "law-watchman-system.txt",
    "includeRecentAlerts": 12,
    "includeRecentActionsAfterAlerts": 20
  },
  "memoryAssist": {
    "enabled": true,
    "suggestOnly": true,
    "minSuggestConfidence": 0.82,
    "maxCandidates": 8,
    "maxSuggestions": 3,
    "triggers": ["assistant_turn"],
    "includeAbandonedWarnings": true,
    "cooldownSeconds": 120
  },
  "custom": {
    "policyFile": "law-policy.txt",
    "escalation": {
      "mode": "soft_then_hard",
      "softViolationsBeforeInterrupt": 2,
      "hardInterruptThreshold": 3
    },
    "rules": [
      {
        "id": "pty_required_for_dev_server",
        "enabled": true,
        "triggers": ["tool_call"],
        "when": { "commandIncludes": ["npm run dev", "pnpm dev"] },
        "require": {
          "anyTools": ["pty_spawn"],
          "guidance": "Use pty_spawn for long-running dev tasks."
        },
        "interruptAfterViolations": 2
      }
    ]
  },
  "agentGuide": {
    "path": ".GCC/AGENT_GUIDE.txt",
    "includeInWatchmanPayload": true
  }
}
```

Text policy + handbook files:
- `.GCC/law-policy.txt` (natural-language workflow laws)
- `.GCC/law-watchman-system.txt` (editable watchman system prompt)
- `.GCC/law-failure-policy.txt` (editable failure-lookup classifier policy)
- `.GCC/law-research-policy.txt` (editable research-capture classifier policy)
- `.GCC/law-runtime.json` (project-level API key/model/provider overrides)
- `.GCC/AGENT_GUIDE.txt` (full agent-readable setup/customization guide)

Customizing without code changes:
1. Edit `.GCC/law-policy.txt` to define plain-language laws.
2. Edit `.GCC/law-watchman-system.txt` to tune watchman judgment behavior.
3. Edit `.GCC/law-failure-policy.txt` to control actionable-failure classification.
4. Edit `.GCC/law-research-policy.txt` to control what research must be checkpointed.
5. Edit `.GCC/law-enforcer.json` -> `custom.rules` for trigger-based checks.
6. Edit `.GCC/law-enforcer.json` -> `custom.hints` to advertise preferred tools/skills/commands/MCPs.
7. Edit `.GCC/law-enforcer.json` -> `custom.escalation` to tune soft reminder vs hard interruption.
8. Edit `.GCC/law-enforcer.json` -> `memoryAssist` to tune suggestion confidence/cadence.
9. Run `opencontext law validate`, `opencontext law doctor`, and `opencontext law guide`.

## Examples

### Session Handoff Example

**Session 1:**
```bash
# User works with agent...
opencontext commit -m "Session checkpoint - debugging auth issue"
# User ends session
```

**Session 2:**
```bash
# New session starts
# Plugin auto-loads:
# "Last commit: debugging auth issue (abc123)"

# Agent continues seamlessly
opencontext context --log
# Shows previous debugging attempts

opencontext commit -m "Fixed auth bug - wrong password validation"
```

### Branching Example

```bash
# Current approach works but is slow
opencontext branch experiment-caching

# Try adding cache layer...
opencontext commit -m "Added Redis caching" \
  --approach "Redis Cache" \
  --status active

# Test performance...
opencontext benchmark --pass-rate 95 --speed "2x faster"

# Happy with results
opencontext switch main
opencontext merge experiment-caching
```

## Troubleshooting

### Plugin Not Loading

**Problem:** OpenCode plugin not showing reminders

**Solutions:**
1. Verify plugin is in the correct location:
   ```bash
   # Project-level
   ls .opencode/plugins/opencontext-reminder.js
   
   # Or global
   ls ~/.config/opencode/plugins/opencontext-reminder.js
   ```

2. Restart OpenCode after installing the plugin

3. Check OpenCode logs for plugin errors:
   ```bash
   opencode --print-logs
   ```

### Malformed Law Enforcer Output

**Problem:** Interruption prompt text looks truncated or malformed.

**Checks:**
1. Validate law config:
   ```bash
   opencontext law validate
   ```
2. Check trace rows:
   ```bash
   opencontext io
   opencontext law watch -n 20
   ```
3. Confirm provider returns valid structured JSON output for watchman fields:
   - `violation`
   - `rule`
   - `reason`
   - `correction_prompt`
   - `confidence`

Malformed/non-JSON provider output is ignored by design and logged as parse failure.

### Planning Interrupted Too Aggressively

**Problem:** Plan-agent runs are interrupted by checkpoint debt.

**Fix:** Ensure these policy flags are enabled in `.GCC/law-enforcer.json`:
```json
{
  "gcc": {
    "skipCheckpointDuringPlanningAgent": true
  },
  "watchman": {
    "skipDuringPlanningAgent": true
  },
  "custom": {
    "exemptAgentPatterns": ["plan", "planner"]
  }
}
```

### Command Not Found

**Problem:** `opencontext: command not found`

**Solutions:**
1. Verify installation:
   ```bash
   pip show opencontext
   ```

2. Ensure Python scripts directory is in PATH:
   ```bash
   # Add to ~/.bashrc or ~/.zshrc
   export PATH="$HOME/.local/bin:$PATH"
   ```

3. Reinstall:
   ```bash
   pip install --force-reinstall opencontext
   ```

### Git Integration Not Working

**Problem:** Git commits not being created

**Solutions:**
1. Ensure you're in a git repository:
   ```bash
   git status
   ```

2. Check if git is configured:
   ```bash
   git config --global user.name
   git config --global user.email
   ```

3. Check git status manually:
   ```bash
   git log --oneline | grep "\[GCC\]"
   ```

### Context Not Loading

**Problem:** `opencontext context` shows no data

**Solutions:**
1. Verify GCC is initialized:
   ```bash
   ls -la .GCC/
   ```

2. Reinitialize if needed:
   ```bash
   opencontext init --project-name "MyProject"
   ```

### Permission Denied

**Problem:** Cannot write to .GCC/ directory

**Solution:**
```bash
chmod -R u+w .GCC/
```

## API Reference

### Python API

```python
from opencontext import GCC

gcc = GCC()

# Initialize
gcc.init(project_name="MyProject", goal="Build a scraper")

# Commit
gcc.commit("Implemented auth module")

# Branch
gcc.branch("experiment-async")

# Merge
gcc.merge("experiment-async")

# Context
context = gcc.context()
branch_info = gcc.context(branch="main")

# TUI
gcc.tui()
```

## Why OpenContext?

Per the GCC paper research:

- **48.00%** resolution rate on SWE-Bench-Lite (SOTA)
- **40.7%** vs **11.7%** task resolution (GCC vs non-GCC)
- Agents spontaneously adopt disciplined workflows
- Seamless session handoff across different LLMs/machines

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file

## References

1. Wu, J. et al. "Git Context Controller: Manage the Context of LLM-based Agents like Git" arXiv:2508.00031 (2025)
2. OpenCode: https://opencode.ai
3. Git: https://git-scm.com

## Support

- 📖 [Documentation](https://github.com/vicmuchina/open_onecontext#readme)
- 🐛 [Issue Tracker](https://github.com/vicmuchina/open_onecontext/issues)
- 💬 [Discussions](https://github.com/vicmuchina/open_onecontext/discussions)
