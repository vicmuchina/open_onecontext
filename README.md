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
The generated guide includes a bootstrap questionnaire (provider URL, API-key env var, project/global runtime scope, and benchmark intent).
4. Watch live watchman I/O (useful for debugging immediately):
```bash
opencontext io
```

After this, use `opencode` normally. The law enforcer runs in the background.

Optional: benchmark model JSON reliability + speed, then auto-configure best model:
```bash
# Chutes
export CHUTES_API_KEY="<your_api_key>"
python3 scripts/chutes_json_benchmark.py \
  --base-url https://llm.chutes.ai/v1 \
  --api-key-env CHUTES_API_KEY \
  --response-format json_object \
  --top 15 \
  --write-runtime .GCC/law-runtime.json

# Any OpenAI-compatible provider
export PROVIDER_API_KEY="<your_api_key>"
python3 scripts/chutes_json_benchmark.py \
  --base-url https://<provider>/v1 \
  --api-key-env PROVIDER_API_KEY \
  --max-models 20 \
  --response-format json_object \
  --top 15 \
  --write-runtime .GCC/law-runtime.json
```

## Documentation Map

- `README.md` - repo entry point and quick navigation.
- `PROJECT_BLUEPRINT.md` - project purpose, goals, architecture, core contracts, and acceptance checklist.
- `HOOKS_AND_ENFORCEMENT.md` - how each OpenCode hook works and how interruption/enforcement is triggered.
- `AGENT_WORKFLOW.md` - day-to-day runbook for agents/humans (session flow, commits, debugging, regression checks).
- `INSTALLATION.md` - install/uninstall, one-command setup, local setup, and troubleshooting.
- `SPEC.md` - detailed technical specification and data model.
- `IMPLEMENTATION.md` - implementation decisions, scope, and behavior guarantees.
- `.GCC/AGENT_GUIDE.txt` - generated per-project plain-text handbook for coding agents (how to configure laws, prompts, providers, and escalation).
- `.GCC/law-policy.txt` - editable natural-language law policy consumed by the watchman model (ships with active balanced defaults).
- `.GCC/law-watchman-system.txt` - editable watchman system prompt (how strict/when to interrupt).
- `.GCC/law-failure-policy.txt` - editable failure-debt policy (actionable failure vs setup noise).
- `.GCC/law-research-policy.txt` - editable research-debt policy (what external findings must be checkpointed).
- `.GCC/law-runtime.json` - optional per-project provider key/model overrides (no repeated env export).
- `opencontext/README.md` - full end-user guide for OpenContext CLI + plugin usage.
- `opencontext/TEST_RESULTS.md` - recorded test runs and verification snapshots.
- `opencontext/docs/SKILL.md` - OpenCode skill instructions for using OpenContext in agent sessions.
- `opencontext/docs/papers/GCC_Paper_2508.00031.md` - local copy/notes of the GCC paper reference.
- `scripts/chutes_json_benchmark.py` - benchmark JSON compliance + tokens/sec across Chutes or any OpenAI-compatible models.

Quick install:

```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

Project objective in one line:
- Keep long-running OpenCode work aligned with GCC memory discipline via watchman-judged enforcement plus high-confidence suggestion-only memory assistance from prior GCC history, sized by a token budget (default 35% of model context, bounded 30-40%).
