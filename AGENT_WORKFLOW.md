# Agent Workflow

This is the practical runbook for daily use.

## One-Time Setup
1. Install:
```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

2. In project:
```bash
opencontext init --project-name "<name>" --goal "<goal>"
# optional: derive goal from existing spec file
opencontext init --project-name "<name>" --goal-file SPEC.md
opencontext law init
opencontext law validate
opencontext law doctor
opencontext law guide
```

3. Set provider key env (default):
```bash
export CHUTES_API_KEY="<key>"

# OR set once in config files (no repeated export):
# ~/.config/opencontext/law-runtime.json
# .GCC/law-runtime.json
```

Before editing provider/model config, ask user for:
- provider base URL
- API key env var name
- project-local vs global runtime target
- whether to run model benchmark + auto-write now

## Start Work Session
- Interactive:
```bash
opencode
```
- Or server mode:
```bash
opencode serve --hostname 127.0.0.1 --port 4096 --print-logs --log-level DEBUG
```

## During Work
- Follow law-enforcer prompts when interruptions occur.
- Watchman check frequency (default):
  - every tool call (`tool.execute.after`)
  - every completed assistant output (`message.updated`)
  - idle/compaction safety passes (`session.idle`, `session.compacted`)
- Commit progress regularly:
```bash
opencontext commit -m "<summary>"
# or positional:
opencontext commit "<summary>"
```
- Before retrying failed work:
```bash
opencontext context --search "<feature/failure>"
opencontext context --log --lines 80
```

## If Research Was Done (docs/GitHub)
Capture it immediately:
```bash
opencontext commit -m "Research findings on <topic>"
# or positional:
opencontext commit "Research findings on <topic>"
```

## If Context Gets Compacted
Do this sequence:
```bash
opencontext commit -m "Post-compaction checkpoint"
# or positional:
opencontext commit "Post-compaction checkpoint"
opencontext context --log --lines 80
```

## Verify Enforcement Is Running
- Check formatted watchman request/response:
```bash
opencontext io
opencontext law watch -n 20
```
- Check law status:
```bash
opencontext law status
opencontext law doctor
```
- Benchmark JSON behavior/speed and auto-write runtime model selection:
```bash
# Chutes
CHUTES_API_KEY="<key>" python3 scripts/chutes_json_benchmark.py --base-url https://llm.chutes.ai/v1 --api-key-env CHUTES_API_KEY --response-format json_object --top 20 --write-runtime .GCC/law-runtime.json

# Any OpenAI-compatible provider
PROVIDER_API_KEY="<key>" python3 scripts/chutes_json_benchmark.py --base-url https://<provider>/v1 --api-key-env PROVIDER_API_KEY --max-models 20 --response-format json_object --top 20 --write-runtime .GCC/law-runtime.json
```

## Tune Provider or Behavior
Edit `.GCC/law-enforcer.json`:
- Provider endpoint/model/auth (`critic.*`)
- Fallback model chain (`critic.modelFallbacks`)
- Response format strategy (`critic.responseFormatStrategy`: `json_schema`, `json_object`, or `json_schema_then_json_object`)
- Strict retry count (`critic.strictJsonRetryAttempts`)
- Planning guards (`gcc.skipCheckpointDuringPlanningAgent`, `watchman.skipDuringPlanningAgent`)
- Custom rules (`custom.rules`) and escalation (`custom.escalation`)

Edit `.GCC/law-policy.txt` for natural-language laws watched continuously by the enforcer model.
Edit `.GCC/law-watchman-system.txt` to customize watchman system behavior and strictness.
Edit `.GCC/law-failure-policy.txt` to customize actionable-failure classification.
Edit `.GCC/law-research-policy.txt` to customize what research must be checkpointed.
If you want model-only judgment (no fallback decisions), set in `.GCC/law-enforcer.json`:
- `gcc.failureClassifierRequireModelDecision: true`
- `research.captureClassifierRequireModelDecision: true`
- `gcc.checkpointDebtJudgeMode: "model_only"`
- `gcc.compactionDebtJudgeMode: "model_only"`
- `watchman.requireModelDecision: true`
Edit `.GCC/law-runtime.json` for project-local API key/model overrides.
Use `.GCC/AGENT_GUIDE.txt` as the full agent-readable customization handbook.

## Recovery If Installer Fails
Use:
- `agent.txt`

## Regression Test Set
Run before pushing major changes:
```bash
node scripts/test-opencode-plugin-law.mjs
node scripts/test-opencode-plugin-research.mjs
node scripts/test-opencode-plugin-watchman.mjs
node scripts/test-opencode-plugin-trace.mjs
node scripts/test-opencode-plugin-watchman-malformed.mjs
node scripts/test-opencode-plugin-provider-config.mjs
node scripts/test-opencode-plugin-planning-guard.mjs
node scripts/test-opencode-plugin-custom-rules.mjs
node scripts/test-opencode-plugin-failure-debt-filter.mjs
node scripts/test-opencode-plugin-runtime-config.mjs
./scripts/test-opencontext-law-assets.sh
./scripts/test-opencontext-context-search.sh
RUN_TIMEOUT_SECONDS=90 ./scripts/test-opencode-plugin.sh
./scripts/test-opencode-serve-plugin.sh
CHUTES_API_KEY=<key> ./scripts/test-opencode-watchman-trace-live.sh
```
