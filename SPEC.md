# OpenContext Specification

## Project Overview

OpenContext is an implementation of the Git Context Controller (GCC) paper for OpenCode, providing LLM-based agents with Git-like version control for context management.

**Based on:** "Git Context Controller: Manage the Context of LLM-based Agents like Git" (arXiv:2508.00031)

**Key Innovation:** Elevates context from passive token streams to a navigable, versioned memory hierarchy with explicit operations: COMMIT, BRANCH, MERGE, and CONTEXT.

Blueprint docs for fast onboarding:
- `PROJECT_BLUEPRINT.md`
- `HOOKS_AND_ENFORCEMENT.md`
- `AGENT_WORKFLOW.md`

---

## Architecture

### Three-Layer Design

1. **Plugin Layer** (OpenCode Integration)
   - Location: `.opencode/plugins/opencontext-reminder.js`
   - Provides active Law Enforcer/watchman inspection
   - Auto-discovers existing GCC context on session start
   - Injects context awareness into agent's system prompt
   - Inspects assistant output and tool activity continuously
   - Injects corrective continuation prompts when workflow laws are violated

2. **CLI Tool** (Core GCC Implementation)
   - Command: `opencontext` (alias: `ocx`)
   - Pure Python implementation using Click
   - File-based storage (no external dependencies)
   - Rich TUI dashboard for visual context management

3. **Storage Layer** (`.GCC/` Directory)
   - Human-readable, git-trackable files
   - Three-tier hierarchy: roadmap → commits → traces
   - Evolution tracking with approach history

---

## File Structure

```
.GCC/
├── main.md                      # Global project roadmap
├── .current_branch             # Hidden file tracking active branch
├── evolution.yaml              # Project evolution & approach tracking
└── branches/
    ├── main/
    │   ├── commit.md           # Commit summaries with 3-block format
    │   ├── log.md              # Fine-grained OTA execution traces
    │   └── metadata.yaml       # File structure, env, deps
    └── feature-branch/
        ├── commit.md
        ├── log.md
        └── metadata.yaml
```

### File Formats

#### main.md
Global roadmap shared across all branches:

```markdown
# Project: <name>

## Goal
<High-level project objective>

## Milestones
- [x] Initial setup completed
- [ ] Implement core feature X
- [ ] Add test coverage
- [ ] Deploy to production

## Current Status
<Current phase and key decisions>

## Notes
<Important architectural decisions, constraints>
```

#### commit.md
Structured commit log per branch (3-block format from paper):

```markdown
## Branch Purpose
<Reiteration of overall project goal + specific rationale for this branch>

## Previous Progress Summary
<Coarse-grained summary combining all previous commits>

## Commits

### <hash> - <timestamp>
**Summary:** <Agent-provided commit message>
**Files Modified:** <list of changed files>
**Description:** <Detailed narrative of what was achieved>
**Approach:** <Name of approach being tested>
**Status:** <success|partial|abandoned>
**Performance:** <Optional metrics>

### <hash> - <timestamp>
...
```

#### log.md
Fine-grained execution traces (OTA cycles):

```markdown
# Execution Log - Branch: <name>

## <timestamp> - Turn 1
**Observation:** <What the agent observed>
**Thought:** <Agent's reasoning>
**Action:** <Tool call made>
**Result:** <Tool execution result>

## <timestamp> - Turn 2
...
```

#### metadata.yaml
Structured branch metadata:

```yaml
branch_name: feature-x
created_at: "2025-02-11T22:30:00Z"
current_commit_hash: abc123

file_structure:
  root:
    - src/
      - main.py
      - utils.py
    - tests/
      - test_main.py
    - README.md
    - requirements.txt

environment:
  python_version: "3.11.4"
  node_version: "20.11.0"
  platform: "linux"

dependencies:
  python:
    - requests: "2.31.0"
    - click: "8.1.7"
  node:
    - typescript: "5.3.0"

approaches:
  - name: "RAG-based memory"
    status: "abandoned"
    reason: "Too fragile, computationally expensive"
    commit_hash: "def456"
    performance_note: "Slower resolution, lower success rate"
    lessons_learned: "Prefer summary-based compression for long tasks"
    
  - name: "Summary-based compression"
    status: "active"
    reason: "More reliable for long-horizon tasks"
    commit_hash: "ghi789"
    performance_note: "Faster, better accuracy"

user_feedback:
  - timestamp: "2025-02-11T23:00:00Z"
    feedback: "The RAG approach was too slow"
    action_taken: "Switched to summary-based approach"

performance_metrics:
  last_benchmark: "2025-02-11T23:30:00Z"
  test_pass_rate: "85%"
  average_task_time: "45s"
```

#### evolution.yaml
Project-wide evolution tracking:

```yaml
project_name: MyProject
created_at: "2025-02-11T22:00:00Z"

approaches_history:
  - name: "Initial Implementation"
    timeline: "2025-02-11 - 2025-02-11"
    description: "Basic setup and exploration"
    commits: ["abc123", "def456"]
    outcome: "Successful baseline"
    
  - name: "RAG Memory Experiment"
    timeline: "2025-02-11 - 2025-02-11"
    description: "Prototype retriever-augmented memory system"
    commits: ["ghi789", "jkl012"]
    outcome: "abandoned"
    reason: "Too fragile, computationally expensive, underperformed"
    lessons: "Simple solutions often outperform complex ones"

user_sessions:
  - session_id: "sess_001"
    started: "2025-02-11T22:00:00Z"
    ended: "2025-02-11T23:30:00Z"
    key_decisions:
      - "Switched from RAG to summary-based approach"
    user_feedback:
      - "The RAG approach was too slow for our needs"

performance_trends:
  - date: "2025-02-11"
    metric: "task_resolution_rate"
    value: "40.7%"
    comparison: "+29% vs baseline"
```

---

## CLI Commands

### Core GCC Commands

#### `opencontext init`
Initialize GCC in current directory:
```bash
opencontext init [--project-name <name>] [--goal <description>]
```
Creates `.GCC/` structure with `main.md` and `branches/main/`.

#### `opencontext commit <summary>`
Create a checkpoint:
```bash
opencontext commit "Implemented user authentication module"
```
Actions:
1. Updates `commit.md` with 3-block format
2. Appends to `log.md` since last commit
3. Updates `metadata.yaml` (file structure, env)
4. Updates `main.md` if roadmap changed
5. Creates git commit with message: `[GCC] <summary>`

#### `opencontext branch <name>`
Create isolated exploration workspace:
```bash
opencontext branch experiment-rag-memory
```
Actions:
1. Creates new branch directory
2. Copies current `metadata.yaml` as baseline
3. Initializes empty `log.md`
4. Creates `commit.md` with branch purpose (prompts agent)
5. Updates `.current_branch`

#### `opencontext merge <branch>`
Integrate branch results:
```bash
opencontext merge experiment-rag-memory
```
Actions:
1. Calls `opencontext context --branch <branch>`
2. Updates `main.md` with branch outcome
3. Merges `commit.md` entries with origin tags
4. Merges `log.md` with branch markers
5. Updates `evolution.yaml` with approach results
6. Creates git commit: `[GCC] Merge branch '<branch>'`
7. Optionally deletes merged branch

#### `opencontext context [options]`
Retrieve context at varying granularity:

```bash
# Show git status-style overview
opencontext context

# Show specific branch details
opencontext context --branch main

# Show specific commit
opencontext context --commit abc123

# Show execution log (with scroll)
opencontext context --log [--lines 50]

# Show metadata segment
opencontext context --metadata file_structure

# Search across all context
opencontext context --search "authentication"

# Export context as JSON
opencontext context --export --format json
```

### Utility Commands

#### `opencontext status`
Quick status check:
```bash
opencontext status
# Output:
# Current branch: main
# Last commit: abc123 - "Setup project structure"
# Unlogged turns: 15
# Context size: 45KB
# Reminder: Consider committing recent progress
```

#### `opencontext switch <branch>`
Switch active branch:
```bash
opencontext switch feature-auth
```

#### `opencontext list`
List all branches:
```bash
opencontext list
# Output:
# * main (active)
#   experiment-rag-memory [abandoned]
#   feature-auth [3 commits ahead]
```

#### `opencontext delete <branch>`
Delete branch (with confirmation):
```bash
opencontext delete experiment-rag-memory
```

### TUI Dashboard

#### `opencontext tui`
Launch rich TUI dashboard:
```bash
opencontext tui [--theme dark|light]
```

**Dashboard Views:**
1. **Overview**: Project status, active branch, recent commits
2. **Branches**: Visual branch tree with merge status
3. **Commits**: Timeline with filtering and search
4. **Evolution**: Approach history with performance metrics
5. **Log**: Real-time execution trace viewer

**Navigation:**
- `Tab` / `Shift+Tab`: Switch panels
- `↑↓`: Navigate lists
- `Enter`: View details
- `/`: Search
- `q`: Quit

---

## OpenCode Plugin

### Location
`.opencode/plugins/opencontext-reminder.js` (project-level)
`~/.config/opencode/plugins/opencontext-reminder.js` (global)
`agent.txt` (root fallback install playbook for autonomous/manual setup)

### Law Policy File
`.GCC/law-enforcer.json` (primary policy file)
- JSON format mirrors normal config style used by OpenCode config files.

### Watchman Trace File
`.GCC/law-enforcer-trace.jsonl` (JSONL trace of watchman requests/responses and tool evidence)

### Active Law Enforcer Runtime

The plugin is a continuous watchman. It inspects the active session and can interrupt the worker model if workflow laws are violated.

#### Enforcement Trigger Points
- `session.created`: startup context and policy priming
- `experimental.chat.system.transform`: inject policy contract and active GCC state
- `tool.execute.after`: track action debts and detect immediate workflow violations
- `message.updated` (assistant completion): inspect each full assistant response
- `session.idle`: run a safety inspection pass
- `session.compacted`: enforce checkpoint + recovery path

#### AI Watchman Evaluation
On assistant completion, the plugin collects:
- latest assistant output
- recent transcript window from session APIs
- recent tool calls and outputs
- policy/debt state (checkpoint overdue, failure lookup pending, research capture pending)

That evidence is sent to the configured critic/watchman model through OpenAI-compatible `chat/completions` using `response_format.type=json_schema`.
Required watchman fields:
- `violation` (true/false)
- `rule`
- `reason`
- `correction_prompt` (AI-generated correction text)
- `confidence`

If model output is malformed/non-JSON, plugin retries in strict JSON-only mode (configurable) before skipping enforcement and logging parse failure.
When `violation` is true with valid schema output, the plugin injects `correction_prompt` via `client.session.promptAsync` in the same session, interrupting and redirecting workflow.

#### Provider Configuration
The law policy supports any OpenAI-compatible provider via `.GCC/law-enforcer.json`:
- `critic.baseUrl`
- `critic.endpointPath`
- `critic.authHeader`
- `critic.apiKeyPrefix`
- `critic.headers`
- `critic.request`
- `critic.model`
- `critic.apiKeyEnv`

#### Safety Controls
- global cooldown between injections
- per-rule cooldown
- max consecutive injections per session
- in-flight protection
- deterministic fallback when model checks are unavailable
- planning guard defaults (`gcc.skipCheckpointDuringPlanningAgent`, `watchman.skipDuringPlanningAgent`)

---

## Evolution Tracking System

### Approach Documentation

When abandoning an approach:

```bash
opencontext commit "Abandoned RAG-based memory" \
  --approach "RAG Memory" \
  --status abandoned \
  --reason "Too fragile and computationally expensive" \
  --performance "40% slower, lower accuracy"
```

Updates `metadata.yaml` with:
```yaml
approaches:
  - name: "RAG-based memory"
    status: "abandoned"
    reason: "Too fragile, computationally expensive"
    commit_hash: "abc123"
    performance_note: "40% slower, lower accuracy"
    lessons_learned: "Simple summary-based approach more reliable"
```

### User Feedback Integration

```bash
# User provides feedback
opencontext feedback "The RAG approach is too slow for production"

# Stored in evolution.yaml
user_sessions:
  - session_id: "current"
    user_feedback:
      - timestamp: "..."
        feedback: "The RAG approach is too slow for production"
        context: "experiment-rag-memory branch"
```

### Performance Metrics

```bash
# Record benchmark results
opencontext benchmark \
  --task "SWE-Bench-Lite" \
  --pass-rate 40.7 \
  --baseline 11.7 \
  --notes "GCC vs non-GCC comparison"
```

---

## Git Integration

### Automatic Git Commits

Every `opencontext commit` creates a corresponding git commit:

```bash
# GCC command
opencontext commit "Implemented auth module"

# Creates git commit
# Message: [GCC] Implemented auth module
# Includes: All modified files + .GCC/ directory
```

### Git Tagging

```bash
opencontext tag milestone-v1
# Creates git tag: gcc-milestone-v1
```

### Branch Synchronization

```bash
opencontext branch feature-x
# Creates GCC branch AND git branch: gcc-feature-x
```

---

## Installation

### Via pip

```bash
pip install opencontext
```

### Via npm (wrapper)

```bash
npm install -g opencontext
```

### Setup

```bash
# Initialize in project
opencontext init --project-name "MyProject"

# Install OpenCode plugin
cp opencontext/plugins/opencontext-reminder.js .opencode/plugins/
```

---

## Usage Examples

### Example 1: Starting a New Project

```bash
# Initialize
opencontext init --project-name "MyApp" --goal "Build a web scraper"

# Agent starts working...
# Plugin shows: "📊 Context: 10% full"

# After implementing core feature
opencontext commit "Implemented basic scraping logic"

# Plugin shows: "🎯 5 actions completed. Suggestion: opencontext commit '...'"

# Try alternative approach
opencontext branch experiment-async-scraper

# Work on alternative...

# Abandon approach
opencontext commit "Abandoned async approach" \
  --approach "Async Scraper" \
  --status abandoned \
  --reason "Complexity outweighs benefits"

# Switch back to main
opencontext switch main
opencontext merge experiment-async-scraper

# View evolution
opencontext tui  # Navigate to Evolution tab
```

### Example 2: Session Handoff

```bash
# User ends session
opencontext commit "Session checkpoint - debugging auth issue"

# New session starts...
# Plugin auto-loads context:
# "## GCC Project Context
#  Active Branch: main
#  Last commit: debugging auth issue
#  ..."

# Agent continues seamlessly
opencontext context --log
# Shows previous debugging attempts
```

---

## Configuration

### Global Config
`~/.config/opencontext/config.yaml`:

```yaml
defaults:
  auto_git_commit: true
  context_warning_threshold: 80
  tui:
    theme: dark
    refresh_rate: 1s

law_enforcer:
  mode: interrupt_continue
  watchman:
    run_on_assistant_turn: true
    include_recent_messages: 12
    include_recent_tools: 20
  cooldowns:
    interruption_seconds: 45
    same_rule_seconds: 120
```

### Project Config
`.GCC/config.yaml`:

```yaml
project:
  name: "MyProject"
  goal: "Build a web scraper"
  
git:
  auto_commit: true
  commit_prefix: "[GCC]"
  
metadata:
  auto_track_dependencies: true
  auto_track_file_structure: true
  track_performance: true
```

---

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
branch_context = gcc.context(branch="main")

# TUI
gcc.tui()
```

### JavaScript Plugin API

```javascript
import { OpenContextPlugin } from 'opencontext/plugin';

const plugin = new OpenContextPlugin({
  reminderFrequency: 5,
  showContextStats: true
});

await plugin.install('.opencode/plugins/');
```

---

## Testing Strategy

1. **Unit Tests**: Core GCC operations (commit, branch, merge)
2. **Integration Tests**: Git integration, file I/O
3. **E2E Tests**: Full workflow from init to merge
4. **Plugin Tests**: OpenCode hook integration
5. **TUI Tests**: Rich dashboard navigation

---

## Future Enhancements

1. **Cloud Sync**: Optional cloud backup of .GCC/
2. **Multi-Agent**: Support for team collaboration
3. **AI-Powered Summaries**: LLM-generated commit messages
4. **Visual Diff**: TUI diff view between commits
5. **Export Formats**: PDF, HTML reports of evolution

---

## Success Metrics

Per the GCC paper:
- **Task Resolution**: Target 40%+ improvement on SWE-Bench-like tasks
- **Context Efficiency**: 80%+ reduction in repeated explanations
- **Developer Satisfaction**: Seamless session handoff experience
- **Adoption**: Agent spontaneously commits without prompting

---

## References

1. Wu, J. et al. "Git Context Controller: Manage the Context of LLM-based Agents like Git" arXiv:2508.00031 (2025)
2. OpenCode Plugin System: https://opencode.ai/docs/plugins/
3. Rich TUI Library: https://rich.readthedocs.io/
4. Click CLI Framework: https://click.palletsprojects.com/

---

## License

MIT License - See LICENSE file
