# OpenContext + Law Enforcer

This repository contains the OpenContext system (GCC memory workflow) plus the OpenCode Law Enforcer plugin that actively inspects agent behavior and interrupts when workflow laws are violated.

## Start Here (Don’t Panic)

If you want fast setup without reading everything:

1. Install in one command:
```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```
2. In your project, initialize:
```bash
opencontext init --project-name "<name>" --goal-file SPEC.md
opencontext law init
opencontext law doctor
```
3. For AI-assisted configuration, point your assistant to:
- `.GCC/AGENT_GUIDE.txt` (primary setup/customization guide)
- then `.GCC/law-enforcer.json` + `.GCC/law-policy.txt` for your custom behavior

After this, use `opencode` normally. The law enforcer runs in the background.

## Documentation Map

- `README.md` - repo entry point and quick navigation.
- `PROJECT_BLUEPRINT.md` - project purpose, goals, architecture, core contracts, and acceptance checklist.
- `HOOKS_AND_ENFORCEMENT.md` - how each OpenCode hook works and how interruption/enforcement is triggered.
- `AGENT_WORKFLOW.md` - day-to-day runbook for agents/humans (session flow, commits, debugging, regression checks).
- `INSTALLATION.md` - install/uninstall, one-command setup, local setup, and troubleshooting.
- `SPEC.md` - detailed technical specification and data model.
- `IMPLEMENTATION.md` - implementation decisions, scope, and behavior guarantees.
- `.GCC/AGENT_GUIDE.txt` - generated per-project plain-text handbook for coding agents (how to configure laws, prompts, providers, and escalation).
- `.GCC/law-policy.txt` - editable natural-language law policy consumed by the watchman model.
- `.GCC/law-watchman-system.txt` - editable watchman system prompt (how strict/when to interrupt).
- `.GCC/law-failure-policy.txt` - editable failure-debt policy (actionable failure vs setup noise).
- `.GCC/law-research-policy.txt` - editable research-debt policy (what external findings must be checkpointed).
- `.GCC/law-runtime.json` - optional per-project provider key/model overrides (no repeated env export).
- `opencontext/README.md` - full end-user guide for OpenContext CLI + plugin usage.
- `opencontext/TEST_RESULTS.md` - recorded test runs and verification snapshots.
- `opencontext/docs/SKILL.md` - OpenCode skill instructions for using OpenContext in agent sessions.
- `opencontext/docs/papers/GCC_Paper_2508.00031.md` - local copy/notes of the GCC paper reference.

Quick install:

```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

Project objective in one line:
- Keep long-running OpenCode work aligned with GCC memory discipline by enforcing checkpoints, model-judged failure/research debts, MCP usage awareness, and trajectory-aware watchman interruptions.
