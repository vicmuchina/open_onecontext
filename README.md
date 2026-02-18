# OpenContext + Law Enforcer

This repository contains the OpenContext system (GCC memory workflow) plus the OpenCode Law Enforcer plugin that actively inspects agent behavior and interrupts when workflow laws are violated.

Start here:
- `PROJECT_BLUEPRINT.md` - purpose, goals, architecture, and operating contracts
- `HOOKS_AND_ENFORCEMENT.md` - exact plugin hook behavior and interruption flow
- `AGENT_WORKFLOW.md` - practical day-to-day workflow for coding agents and humans
- `INSTALLATION.md` - one-command install and local setup
- `opencontext/README.md` - full user and CLI reference
- `SPEC.md` - detailed technical spec
- `IMPLEMENTATION.md` - implementation decisions and scope

Quick install:

```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

Project objective in one line:
- Keep long-running OpenCode work aligned with GCC memory discipline by enforcing checkpoints, failure lookups, MCP usage awareness, and research capture with a watchman model.
