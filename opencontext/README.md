# OpenContext

Git Context Controller (GCC) for OpenCode - Version control for LLM agent context.

[![Python Version](https://img.shields.io/badge/python-3.9%2B-blue)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Based on:** "Git Context Controller: Manage the Context of LLM-based Agents like Git" (arXiv:2508.00031)

## Overview

OpenContext elevates LLM agent context from passive token streams to a navigable, versioned memory hierarchy. Inspired by Git, it provides explicit operations for managing agent memory across long-horizon workflows.

**Key Innovation:** Agents can COMMIT milestones, BRANCH to explore alternatives, MERGE results, and retrieve CONTEXT at varying resolutions - enabling structured reflection and seamless session handoffs.

## Features

🎯 **Core GCC Operations**
- `commit` - Checkpoint meaningful progress
- `branch` - Explore alternatives in isolation
- `merge` - Synthesize divergent paths
- `context` - Retrieve history at any granularity

🤖 **OpenCode Integration**
- Auto-discovers context on session start
- Smart reminders to commit at milestones
- Context compaction warnings
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

## Installation

### Via pip

```bash
pip install opencontext
```

### Via npm (wrapper)

```bash
npm install -g opencontext
```

### Setup OpenCode Plugin

```bash
# Install the reminder plugin
cp $(opencontext plugin-path) .opencode/plugins/opencontext-reminder.js
```

## Quick Start

### 1. Initialize Project

```bash
opencontext init --project-name "MyApp" --goal "Build a web scraper"
```

Creates `.GCC/` directory with:
- `main.md` - Project roadmap
- `branches/main/` - Main branch with commit.md, log.md, metadata.yaml

### 2. Work with Agent

The OpenCode plugin will:
- ✅ Auto-load context on session start
- 💡 Remind you to commit after milestones
- ⚠️ Warn when context is compacted
- 📊 Show context usage statistics

### 3. Commit Progress

```bash
# After implementing a feature
opencontext commit "Implemented basic scraping logic"
```

This:
- Updates commit.md with 3-block format
- Appends execution traces to log.md
- Updates metadata.yaml
- Creates git commit: `[GCC] Implemented basic scraping logic`

### 4. Explore Alternatives

```bash
# Try different approach
opencontext branch experiment-async-scraper

# Work on alternative...
# Decide to abandon
opencontext commit "Abandoned async approach" \
  --approach "Async Scraper" \
  --status abandoned \
  --reason "Complexity outweighs benefits"

# Switch back and merge learnings
opencontext switch main
opencontext merge experiment-async-scraper
```

### 5. View Dashboard

```bash
opencontext tui
```

Launch interactive dashboard to:
- Browse branches and commits
- View evolution history
- Search context
- See performance metrics

## Commands

### Core Commands

```bash
# Initialize GCC in current directory
opencontext init [--project-name <name>] [--goal <description>]

# Create a checkpoint
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
opencontext context --search "authentication"

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

## OpenCode Plugin Features

The plugin provides **constant, contextual reminders**:

### 1. Context Compaction Warning (Critical)
When OpenCode compacts context (losing details):
```
⚠️ Context compacted! Important details may be lost.
💡 Run: opencontext commit '<what was achieved>'
```

### 2. Milestone Reminders (Every 5 actions)
```
🎯 5 actions completed. Suggestion:
opencontext commit "Updated authentication module"
```

### 3. Context Usage Stats
```
📊 Context: 85% full
💡 Consider: opencontext commit '<summary>'
```

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

### 5. Idle Session Reminder
```
⏸️ Session idle with 12 unlogged actions.
💡 Run: opencontext commit '<final summary>'
```

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

### Global Config
`~/.config/opencontext/config.yaml`:

```yaml
defaults:
  auto_git_commit: true
  reminder_frequency: 5
  context_warning_threshold: 80
  tui:
    theme: dark
    refresh_rate: 1s

reminders:
  on_compaction: true
  on_tool_milestones: true
  on_context_usage: true
  on_session_idle: true
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

## Examples

### Session Handoff Example

**Session 1:**
```bash
# User works with agent...
opencontext commit "Session checkpoint - debugging auth issue"
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

opencontext commit "Fixed auth bug - wrong password validation"
```

### Branching Example

```bash
# Current approach works but is slow
opencontext branch experiment-caching

# Try adding cache layer...
opencontext commit "Added Redis caching" \
  --approach "Redis Cache" \
  --status active

# Test performance...
opencontext benchmark --pass-rate 95 --speed "2x faster"

# Happy with results
opencontext switch main
opencontext merge experiment-caching
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
