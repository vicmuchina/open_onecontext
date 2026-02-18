# OpenContext + Law Enforcer

This repository contains the OpenContext system (GCC memory workflow) plus the OpenCode Law Enforcer plugin that actively inspects agent behavior and interrupts when workflow laws are violated.

## Documentation Map

- `README.md` - repo entry point and quick navigation.
- `PROJECT_BLUEPRINT.md` - project purpose, goals, architecture, core contracts, and acceptance checklist.
- `HOOKS_AND_ENFORCEMENT.md` - how each OpenCode hook works and how interruption/enforcement is triggered.
- `AGENT_WORKFLOW.md` - day-to-day runbook for agents/humans (session flow, commits, debugging, regression checks).
- `INSTALLATION.md` - install/uninstall, one-command setup, local setup, and troubleshooting.
- `SPEC.md` - detailed technical specification and data model.
- `IMPLEMENTATION.md` - implementation decisions, scope, and behavior guarantees.
- `opencontext/README.md` - full end-user guide for OpenContext CLI + plugin usage.
- `opencontext/TEST_RESULTS.md` - recorded test runs and verification snapshots.
- `opencontext/docs/SKILL.md` - OpenCode skill instructions for using OpenContext in agent sessions.
- `opencontext/docs/papers/GCC_Paper_2508.00031.md` - local copy/notes of the GCC paper reference.

Quick install:

```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

Project objective in one line:
- Keep long-running OpenCode work aligned with GCC memory discipline by enforcing checkpoints, failure lookups, MCP usage awareness, and research capture with a watchman model.
