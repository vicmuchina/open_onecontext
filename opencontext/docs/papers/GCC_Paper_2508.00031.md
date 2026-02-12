# Git Context Controller: Manage the Context of LLM-based Agents like Git

**Author:** Junde Wu (University of Oxford)  
**Email:** jundewu@ieee.org  
**arXiv:** 2508.00031  
**Date:** 30 July 2025

---

## Abstract

Large language model (LLM)-based agents have shown impressive capabilities by interleaving internal reasoning with external tool use. However, as these agents are deployed in long-horizon workflows, such as coding for a big, long-term project, context management becomes a critical bottleneck.

We introduce **Git-Context-Controller (GCC)**, a structured context management framework inspired by software version control systems. GCC elevates context from passive token streams to a navigable, versioned memory hierarchy. It structures agent memory as a persistent file system with explicit operations: **COMMIT, BRANCH, MERGE, and CONTEXT**, enabling milestone-based checkpointing, exploration of alternative plans, and structured reflection.

Our approach empowers agents to manage long-term goals, isolate architectural experiments, and recover or hand off memory across sessions and agents. Empirically, agents equipped with GCC achieve state-of-the-art performance on the SWE-Bench-Lite benchmark, resolving **48.00%** of software bugs—outperforming 26 competitive systems. In a self-replication case study, a GCC-augmented agent builds a new CLI agent from scratch, achieving **40.7%** task resolution, compared to only **11.7%** without GCC.

**Code:** https://github.com/theworldofagents/GCC

---

## 1. Introduction

LLM-based agents have been capable of interleaving internal chain-of-thought reasoning with external tool calls (Wu et al., 2025). Such architecture has shown strong performance in decision-making tasks, web interaction, and question answering benchmarks, providing a foundation for more sophisticated agents.

In software engineering domains, frameworks like SWE-Agent (Yang et al., 2024) used similar paradigm by integrating code generation, execution, and test loops to implement iterative software development (e.g., writing, compiling, debugging). Following this idea, production-grade tools such as Anthropic's Claude Code and Google's Gemini CLI bring LLM-based agents to the command line, enabling code completion, debugging, and search within a single session.

However, as LLM agents are increasingly deployed for long-horizon reasoning in complex, large-scale workflows, **context management emerges as a fundamental bottleneck**. A common issue observed in CLI-based usage is that sessions become increasingly slow and costly as context grows, since longer histories are passed as tokens. Yet closing a session and starting a new one typically erases the agent's memory of prior goals, user preferences, and task-specific instruction.

As a result, users are forced to repeatedly "teach" the model from scratch across sessions.

### Current Limitations

Current implementations rely on a few common strategies:

**1. Context Truncation:** The most straightforward is to truncate older context once the token limit is reached. While simple, this risks discarding important historical details—especially problematic when the agent needs to revisit earlier decisions or maintain consistency across multi-step plans.

**2. Context Compression:** A more balanced approach compresses earlier reasoning into high-level summaries or todo-lists, as seen in Claude Code and Gemini CLI. These systems persist abstracted task state (e.g., via a single memory.md) and use summary-based anchors for future reasoning. However, relying on a simple compression means removing the fine-grained details, weakening the agent's ability to ground its actions in specific prior thoughts.

**Current State:** Context is either too verbose to be reusable, or too abstract to support concrete continuation and extension.

### Key Insight

These limitations highlight the need for a more principled and structured approach to how AI agents log, manage, and retrieve context. **Our key insight is that the challenges faced by long-horizon agents closely mirror those encountered by software engineers managing complex, evolving codebases.**

Inspired by the success of Git in software version control, we propose Git-Context-Controller (GCC), an agentic context control mechanism that elevates context management to an explicit abstraction layer.

### GCC Overview

It organizes contextual information as a structured, version-controlled file system, and introduces a set of specialized commands designed to support logging, managing, and retrieving context across agentic workflows.

We implement this design through a standalone Git-Context-Controller, which structures agent context as a version-controlled file system under a unified `.GCC/` directory. Each project maintains a global roadmap (main.md), while each branch contains its own commit summaries, execution traces, and structured metadata.

Agents interact with this controller through a small set of core commands:

- **COMMIT** - to checkpoint meaningful progress
- **BRANCH** - to explore alternate strategies
- **MERGE** - to synthesize divergent reasoning paths
- **CONTEXT** - to retrieve historical information at varying resolutions

These operations are triggered by the agent in response to its evolving internal state—supporting long-horizon planning, compositional reasoning, and reproducible workflows.

### Benefits

1. **Multi-level context retrieval:** Agents can access context at varying levels of detail, from high-level project plans to low-level OTA (Observation–Thought–Action) steps. The system enables seamless navigation across these layers, making it easy to trace and locate any point in the reasoning history.

2. **Isolated exploration via branching:** Each branch acts as a safe workspace for the agent to explore new ideas, make mistakes, or iterate freely without affecting the main plan.

3. **Cross-agent flexibility:** The system allows agents to operate seamlessly across sessions. There is no need to "re-teach" the model when a new session begins. Another agent, based on a different LLM on a different machine, can also pick up exactly where the previous one left off with minimal overhead.

### Contributions

- We propose a novel view of agent memory as a **dynamic, navigable codebase**, complete with log files, branching histories, and metadata. This reframes context not just as passive history but as an evolving, queryable interface that supports both recall and structural reasoning.

- We introduce **GCC**, a structured context management framework for LLM agents that integrates version control semantics—such as COMMIT, BRANCH, and MERGE—into the reasoning loop.

- Equipped LLM-based agents with GCC, it gets empirical **SOTA Results on SWE-Bench**, which outperforms 26 existing systems (open and commercial), achieving **48.00%** resolution.

- We also conduct a case study in which a Claude-powered CLI agent, equipped with GCC, is tasked with building another CLI system from scratch. The GCC-augmented agent outperforms its non-GCC counterpart by a large margin on the SWEBench benchmark (**40.7% vs. 11.7%**), suggesting a pathway toward autonomous agents capable of recursive self-improvement.

---

## 2. Method

The Git-Context-Controller (GCC) is an abstraction layer for agent memory, consisting of a structured file system paired with a series of callable commands that agents use to externalize, organize, and retrieve their reasoning. Inspired by version control systems like Git, GCC transforms the agent's ephemeral context into a persistent, navigable, and semantically meaningful workspace.

Agents interact with the controller through commands such as COMMIT, BRANCH, MERGE, and CONTEXT, which manipulate a directory structure rooted at `.GCC/`.

This structure includes global planning files (main.md), per-branch execution traces (log.md), milestone summaries (commit.md), and metadata (metadata.yaml) capturing architecture and file state.

### 2.1 GCC File System

The Git-Context-Controller organizes agent context into a structured directory rooted at `.GCC/`, reflecting a three-tiered hierarchy of reasoning: high-level planning, commit-level summaries, and fine-grained execution traces.

```
.GCC/
├── main.md                      # Global roadmap
├── branches/
│   └── <branch-name>/
│       ├── commit.md           # Commit summaries
│       ├── log.md              # OTA execution traces
│       └── metadata.yaml       # Branch metadata
```

**main.md** sits at the root and stores the global project roadmap. It records high-level project goals, key milestones, and the to-do list for development. This file is shared across all branches and serves as the canonical source of the project's overall intent.

**commit.md** (per branch) is a structured summary log that captures the evolving progress of the branch. Each time the agent calls COMMIT, the controller appends a new entry following a standardized template with three blocks:

1. **Branch Purpose** - reiteration of the overall project goal and specific rationale
2. **Previous Progress Summary** - coarse-grained summary of branch history
3. **This Commit's Contribution** - detailed narrative of what was achieved

**log.md** stores the fine-grained reasoning trace of the agent's execution. This includes every OTA (Observation–Thought–Action) cycle that occurs between commits.

**metadata.yaml** captures structured meta-level information including file structure, environment configurations, dependency graphs, or module interfaces.

### 2.2 GCC Commands

#### COMMIT <summary>

Called when the agent identifies that recent reasoning has resulted in a coherent and meaningful milestone.

**Actions:**
- Updates commit.md with new entry
- Optionally prompts revision of main.md
- Creates Git commit with agent-authored summary

This mechanism turns a loose sequence of OTA steps into a coherent and retrievable memory unit.

#### BRANCH <name>

Called when the agent detects a meaningful divergence in direction, such as exploring an alternative algorithm or testing a new design hypothesis.

**Actions:**
- Creates empty log.md for new OTA cycles
- Initializes new commit.md with branch purpose
- Enables isolated reasoning sandboxed from mainline

#### MERGE <branch>

Called when a branch has reached a conclusion and its results should be integrated into the main plan.

**Actions:**
- Updates main.md with branch outcome
- Merges commit.md entries with unified structure
- Merges log.md files with origin tags
- Creates Git commit to checkpoint unified memory state

#### CONTEXT <options>

Allows agents to retrieve memory at multiple levels of granularity.

**Options:**
- `CONTEXT` - git status-style snapshot with project purpose and branch list
- `CONTEXT --branch <branch>` - branch purpose and progress summary
- `CONTEXT --commit <hash>` - specific commit entry in full detail
- `CONTEXT --log` - last 20 lines of execution log
- `CONTEXT --metadata <segment>` - specific metadata segment

---

## 3. Experiment

### Datasets

We use the widely adopted **SWE-Bench** benchmark (Jimenez et al., 2024), which assesses the capability to resolve real-world software engineering issues. Each task involves generating a code patch to fix a specific bug.

Our experiments primarily focus on the **SWE-Bench-lite** subset (swe, 2024), a higher-quality and more self-contained collection of 300 tasks.

### Baselines

We compare GCC against **26 state-of-the-art** agent-based systems, spanning both open-source and commercial tools.

### Metrics

We report:
1. **% Resolved** - percentage of tasks successfully fixed
2. **Avg. Cost** - average inference cost per task
3. **Avg. Tokens** - average tokens consumed per query
4. **% Correct Location** - patch localization accuracy at file, function, and line levels

### 3.1 Results and Analysis

**GCC achieves 48.00% resolution on SWE-Bench-Lite**, the highest among all 26 systems:

| Tool | LLM | % Resolved |
|------|-----|------------|
| **Ours (GCC)** | Claude 3.5 S | **48.00%** |
| CodeStory Aide | GPT-4o+ Claude 3.5 S | 43.00% |
| ByteDance MarsCode | NA | 39.33% |
| Honeycomb | NA | 38.33% |
| SWE-agent | Claude 3.5 S | 23.00% |
| AgentLess | GPT-4o | 32.00% |

GCC achieves:
- **44.3%** line-level correctness
- **61.7%** function-level correctness  
- **78.7%** file-level correctness

### 3.2 Case Study: Self-Evolving Agents

We examine a self-replicating experiment where a Claude Code CLI, equipped with GCC, builds another CLI system from scratch.

**Results:**
- Original CLI: **72.7%** resolution
- CLI without GCC: **11.7%** resolution
- **CLI with GCC: 40.7%** resolution

This shows GCC enables **recursive self-improvement** - a 40.7% vs 11.7% difference using the same model and tools.

#### Spontaneous Behaviors Observed

**Commit Behavior:**
The GCC-powered agent spontaneously committed to implementing a write_file function. It:
- Reasoned about limitations of transient output
- Implemented utility in io.py
- Generated test routine
- Only committed after tests passed

This behavior **emerged spontaneously** without explicit prompting - the agent internalized GCC's affordances as cognitive norms.

**Branching Behavior:**
The agent invoked BRANCH to explore a RAG-based memory system. After testing:
- Documented trade-offs (fragile, expensive, underperformed)
- Chose to abandon the approach
- Reverted to mainline

The branching and abandonment decisions emerged organically from interaction with GCC's structural flexibility.

---

## Conclusion

We present **Git-Context-Controller (GCC)**, a structured context management framework that equips LLM-based agents with version control-inspired operations to persist, organize, and retrieve memory across long-horizon workflows.

By treating agent reasoning as a modular, evolving codebase, GCC enables:
- Milestone-based committing
- Architectural branching
- Structured reflection
- Recursive self-improvement

Empirical results show **state-of-the-art performance** on SWE-Bench-Lite (48.00%), and a self-replication case study demonstrates the emergence of **autonomous, self-evolving capabilities**.

**Key Takeaway:** Memory scaffolding is not just model capability, but a key to building autonomous, self-evolving agents.

---

## References

- Wu, J. et al. "Agentic reasoning: A streamlined framework for enhancing llm reasoning with agentic tools." ACL 2025.
- Yang et al. "SWE-agent: Agent-computer interfaces enable automated software engineering." arXiv:2405.15793, 2024.
- Jimenez et al. "SWE-bench: Can language models resolve real-world github issues?" ICLR 2024.

**Paper URL:** https://arxiv.org/abs/2508.00031  
**Code:** https://github.com/theworldofagents/GCC
