---
name: opencontext
description: Git Context Controller (GCC) for OpenCode - Version control for LLM agent context with COMMIT, BRANCH, MERGE, and CONTEXT operations to manage long-horizon workflows.
---

# OpenContext Skill

## Overview

OpenContext implements the Git Context Controller (GCC) paper, providing version control for LLM agent context. It structures agent memory as a navigable, versioned memory hierarchy with explicit operations for checkpointing progress, exploring alternatives, and maintaining context across sessions.

**Based on:** Wu et al. "Git Context Controller: Manage the Context of LLM-based Agents like Git" (arXiv:2508.00031)

## When to Use This Skill

### Use OpenContext when:
- Working on **long-horizon projects** spanning multiple sessions
- Exploring **alternative approaches** that might fail
- Need to **track progress** through meaningful milestones
- Want **seamless session handoff** without re-teaching the model
- Building **complex systems** requiring structured reflection
- Need to **document what worked** vs. what was abandoned
- Collaborating with **multiple agents** or LLMs

### Don't use when:
- One-shot tasks with no continuity needed
- Simple scripts that complete in a single session
- No need to preserve context between sessions

## Core Commands

### 1. COMMIT - Checkpoint Progress

**When to use:** After completing a coherent milestone (implemented feature, fixed bug, completed test)

```bash
# Basic commit
opencontext commit "Implemented user authentication"

# With approach tracking
opencontext commit "Tested RAG-based memory" \
  --approach "RAG Memory" \
  --status abandoned \
  --reason "Too computationally expensive"

# With performance notes
opencontext commit "Optimized database queries" \
  --approach "Query Optimization" \
  --status active \
  --performance "40% faster, all tests passing"
```

**What it does:**
- Records commit in commit.md with 3-block format
- Updates metadata.yaml
- Creates git commit with [GCC] prefix
- Updates evolution tracking

### 2. BRANCH - Explore Alternatives

**When to use:** Want to try a different approach without affecting main work

```bash
# Create branch for alternative approach
opencontext branch experiment-async-processing

# Work on branch...
opencontext commit "Implemented async handler"

# If it works, merge back
opencontext switch main
opencontext merge experiment-async-processing

# Or abandon it
opencontext switch main
opencontext delete experiment-async-processing
```

**What it does:**
- Creates isolated workspace
- Copies current metadata as baseline
- Tracks exploration separately
- Enables safe experimentation

### 3. MERGE - Integrate Results

**When to use:** Branch exploration is complete, time to integrate learnings

```bash
# Switch to target branch
opencontext switch main

# Merge feature branch
opencontext merge experiment-caching

# Documents are merged with origin tags
# Git commit created automatically
```

### 4. CONTEXT - Retrieve History

**When to use:** Need to understand project state, previous work, or specific decisions

```bash
# Current branch overview
opencontext context

# Specific branch
opencontext context --branch main

# Specific commit
opencontext context --commit abc123

# Execution log
opencontext context --log --lines 50

# Specific metadata
opencontext context --metadata approaches

# Search relevant prior attempts/findings
opencontext context --search "failed attempt" --limit 20

# Export as JSON
opencontext context --export --format json
```

### 5. LAW - Configure Enforcer Behavior

**When to use:** Initialize/validate/edit enforcement rules and provider settings for future turns.

```bash
# Create policy + runtime + guide files in .GCC
opencontext law init

# Validate law config structure
opencontext law validate

# Show active enforcement status
opencontext law status

# Regenerate agent handbook in .GCC
opencontext law guide
```

**What it does:**
- Makes enforcement behavior explicit and editable by agents.
- Keeps provider/model config, custom rules, and policy text synchronized.

### 6. HELP - Self-Discovery in Session

```bash
opencontext --help
opencontext context --help
opencontext law --help
```

Use these whenever an agent needs to confirm command purpose or flags before acting.

## Workflow Patterns

### Pattern 1: Session Handoff

**Session 1:**
```bash
# Work on feature...
opencontext commit "Implemented core logic - tests passing"
# End session
```

**Session 2:**
```bash
# Plugin auto-loads context:
# "Last commit: Implemented core logic - tests passing (abc123)"

# Continue work seamlessly
opencontext commit "Added edge case handling"
```

### Pattern 2: Exploration with Abandonment

```bash
# Main approach is working but slow
opencontext commit "Current implementation working - baseline established"

# Try optimization
opencontext branch experiment-caching

# Test caching approach
opencontext commit "Added Redis cache layer" --approach "Redis Cache" --status active

# Test shows it's fragile
opencontext commit "Abandoned Redis approach" \
  --approach "Redis Cache" \
  --status abandoned \
  --reason "Race conditions in concurrent access"

# Return to main
opencontext switch main
opencontext merge experiment-caching  # Merges documentation of what was tried
```

### Pattern 3: Performance Tracking

```bash
# Establish baseline
opencontext benchmark --task "Load Test" --pass-rate 85

# Optimize
opencontext commit "Optimized database queries" --performance "20% improvement"

# Test again
opencontext benchmark --task "Load Test" --pass-rate 92 --notes "Query optimization worked"
```

## File Structure Reference

```
.GCC/
├── main.md                      # Global roadmap & milestones
├── evolution.yaml              # Project evolution tracking
└── branches/
    ├── main/
    │   ├── commit.md           # Commit history (3-block format)
    │   ├── log.md              # OTA execution traces
    │   └── metadata.yaml       # File structure, env, approaches
    └── feature-branch/
        ├── commit.md
        ├── log.md
        └── metadata.yaml
```

## Best Practices

### 1. Commit Granularity
- **Do commit:** After completing coherent milestones
- **Don't commit:** Every single file edit
- **Sweet spot:** 5-10 tool executions or significant milestone

### 2. Approach Documentation
Always document experimental approaches:
```bash
opencontext commit "Tested approach X" \
  --approach "Approach Name" \
  --status abandoned \
  --reason "Why it didn't work"
```

### 3. User Feedback
Record important feedback:
```bash
opencontext feedback "The RAG approach is too slow for production"
```

### 4. Context Compaction Response
When OpenCode compacts context (Law Enforcer warns/intervenes):
```bash
opencontext commit "Context compacted - checkpointing progress"
```

### 5. Law Policy Operations
Use project-local law policy for continuous workflow enforcement:
```bash
opencontext law init
opencontext law validate
opencontext law status
opencontext law guide
```
Editable files for customization:
- `.GCC/law-enforcer.json` (structured rules/provider/escalation)
- `.GCC/law-policy.txt` (plain-language laws)
- `.GCC/AGENT_GUIDE.txt` (agent-readable handbook regenerated by `law guide`)

## Plugin Features

The OpenContext plugin now runs a continuous **Law Enforcer** (interrupt + continue):

### Auto-Discovery
On session start in GCC project:
- Detects `.GCC/` directory
- Loads context automatically
- Shows: "📦 GCC Context Loaded - Branch: main"

### Context Compaction Warning + Enforcement
When OpenCode compacts context:
- ⚠️ Requires a checkpoint + context recovery workflow
- 💡 Enforces: `opencontext commit '<summary>'` then `opencontext context --log --lines 80`

### Milestone Enforcement
After configurable significant tool count:
- 🎯 Detects checkpoint debt
- ⚖️ Can inject corrective continuation prompts into the active session

### Context Usage Monitor
At 80% context usage:
- 📊 Shows usage percentage
- 💡 Suggests commit to preserve progress

### Research and MCP Discipline
- Detects docs/GitHub/arXiv research signals and requires capture in GCC
- Reminds/enforces MCP usage when tool patterns indicate relevance

## Troubleshooting

### Plugin not loading
```bash
# Check plugin exists
ls .opencode/plugins/opencontext-reminder.js

# Or install globally
cp $(opencontext plugin-path) ~/.config/opencode/plugins/
```

### Git commits not created
```bash
# Ensure git is initialized
git status

# Check git config
git config user.name
git config user.email
```

### Command not found
```bash
# Verify installation
which opencontext
opencontext --version

# Reinstall if needed
pip install --force-reinstall opencontext
```

## Quick Reference Card

```bash
# Initialize
opencontext init --project-name "MyApp" --goal "Build scraper"

# Daily workflow
opencontext commit "What was achieved"                    # Basic
opencontext commit "What was achieved" --approach "Name"  # With tracking
opencontext branch experiment-name                         # Explore
opencontext merge experiment-name                          # Integrate
opencontext context                                         # View state
opencontext tui                                             # Dashboard

# Tracking
opencontext feedback "Important feedback"
opencontext benchmark --task "Name" --pass-rate 95
```

## Performance Benefits (from paper)

- **48.00%** resolution on SWE-Bench-Lite (SOTA)
- **40.7%** vs **11.7%** (GCC vs non-GCC) in self-replication
- Agents spontaneously adopt disciplined workflows
- Seamless cross-session handoff

## See Also

- Full README: `/home/vic/Projects/RLM/opencontext/README.md`
- Specification: `/home/vic/Projects/RLM/SPEC.md`
- Paper: `/home/vic/Projects/RLM/opencontext/docs/papers/GCC_Paper_2508.00031.md`
