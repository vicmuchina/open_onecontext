# OpenContext Installation Guide

## One-Command Installation

Install everything (CLI, plugin, skill) with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

Install globally + project-local plugin/skill (run from your project root):

```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash -s -- --local
```

Install local plugin/skill to an explicit project path:

```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash -s -- --local --project-dir /path/to/project
```

Or with wget:

```bash
wget -qO- https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

If installer automation fails, use the agent fallback playbook:

```bash
cat agent.txt
```

Project blueprint docs (repo root):

```bash
cat PROJECT_BLUEPRINT.md
cat HOOKS_AND_ENFORCEMENT.md
cat AGENT_WORKFLOW.md
```

## What Gets Installed

The installer will:

1. ✅ **CLI Tool** - `opencontext` command available system-wide
2. ✅ **OpenCode Plugin** - Installed globally in `~/.config/opencode/plugins/`
3. ✅ **OpenContext Skill** - Installed in `~/.config/opencode/skills/opencontext/`
4. ✅ **Templates** - Stored in `~/.local/share/opencontext/`

## Installation Locations

After installation, you'll find:

```
~/.local/share/opencontext/          # Source code and templates
~/.config/opencode/plugins/          # OpenCode plugin
~/.config/opencode/skills/opencontext/  # OpenContext skill
~/.config/opencontext/law-runtime.json  # Global provider key/model overrides
~/.local/bin/opencontext             # CLI executable (if in PATH)
```

With `--local`, these are also created in your project:

```
/path/to/project/.opencode/plugins/opencontext-reminder.js
/path/to/project/.opencode/skills/opencontext/SKILL.md
/path/to/project/.GCC/law-enforcer.json   # if .GCC already exists
/path/to/project/.GCC/law-policy.txt      # if .GCC already exists
/path/to/project/.GCC/law-watchman-system.txt
/path/to/project/.GCC/law-failure-policy.txt
/path/to/project/.GCC/law-research-policy.txt
/path/to/project/.GCC/law-runtime.json    # provider key/model overrides (project-local)
/path/to/project/.GCC/AGENT_GUIDE.txt     # generated guide for agents
```

### Plugin Loading Note

Local plugin files are auto-loaded by OpenCode from:
- `~/.config/opencode/plugins/` (global)
- `.opencode/plugins/` (project-level)

No `opencode.json` plugin entry is required for local `.js` plugin files.

## Alternative Installation Methods

### Method 2: Via pip

```bash
pip install opencontext

# Setup OpenCode integration
opencontext setup-opencode --global
```

### Method 3: From Source

```bash
git clone https://github.com/vicmuchina/open_onecontext.git
cd open_onecontext/opencontext
pip install -e .
opencontext setup-opencode --global
```

## Post-Installation

### 1. Verify Installation

```bash
# Check CLI
opencontext --version

# Check plugin
ls ~/.config/opencode/plugins/opencontext-reminder.js

# Check skill
ls ~/.config/opencode/skills/opencontext/SKILL.md
```

### 2. Initialize Your First Project

```bash
cd /path/to/your/project
opencontext init --project-name "MyProject" --goal "Project description"
# or derive goal from existing spec file
opencontext init --project-name "MyProject" --goal-file SPEC.md
```

If neither option is set, OpenContext tries `SPEC.md`/`PROJECT_BLUEPRINT.md`/`IMPLEMENTATION.md`/`README.md`, then falls back to: `Project goal not specified`.

### 3. Start OpenCode

```bash
opencode
```

The plugin will automatically:
- Detect `.GCC/` directory
- Show "GCC Context Loaded" notification
- Enforce checkpoint and context-recovery workflow continuously
- Inspect assistant turns with watchman model when configured

### 3.5 Initialize Law Policy

```bash
opencontext law init
opencontext law validate
opencontext law status
opencontext law watch -n 20
opencontext law guide
```

Configure watchman API key for model-based law inspection:

```bash
export CHUTES_API_KEY="<your_api_key>"
# Optional model override (default is chutesai/Mistral-Small-3.2-24B-Instruct-2506)
export OPENCONTEXT_LAW_MODEL_ID="chutesai/Mistral-Small-3.2-24B-Instruct-2506"
```

Set once using config files (no repeated `export`):
- Global: `~/.config/opencontext/law-runtime.json`
- Project: `.GCC/law-runtime.json` (overrides global)

You can also edit `.GCC/law-enforcer.json` for any OpenAI-compatible provider:

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
    "modelFallbacks": ["<fallback_1>", "<fallback_2>"],
    "apiKeyEnv": "CHUTES_API_KEY",
    "strictJsonRetryAttempts": 1,
    "responseFormatStrategy": "json_schema_then_json_object"
  }
}
```

The plugin starts with `response_format.type=json_schema`, then can fall back to `json_object` based on `critic.responseFormatStrategy`.
If output is malformed, it retries in stricter JSON-only mode, then skips enforcement if still invalid.

Watchman trace logs are written to:

```bash
.GCC/law-enforcer-trace.jsonl
```

Use the built-in formatted watcher (short command):

```bash
opencontext law watch -n 20
opencontext law watch --follow
```

Benchmark Chutes models for structured JSON reliability + TPS:

```bash
export CHUTES_API_KEY="<your_api_key>"
python3 scripts/chutes_json_benchmark.py --response-format json_object --top 20
```

Agent-facing handbook and editable policy live in:

```bash
.GCC/AGENT_GUIDE.txt
.GCC/law-policy.txt
.GCC/law-watchman-system.txt
.GCC/law-failure-policy.txt
.GCC/law-research-policy.txt
```

## Setup Commands

### Setup OpenCode Integration

After pip install, you can set up OpenCode integration:

```bash
# Project-level (current directory only)
opencontext setup-opencode

# Global (all projects)
opencontext setup-opencode --global
```

This installs:
- Plugin: `~/.config/opencode/plugins/opencontext-reminder.js`
- Skill: `~/.config/opencode/skills/opencontext/SKILL.md`

## Troubleshooting

### Command not found after install

Add to your shell profile:

```bash
echo 'export PATH="${HOME}/.local/bin:${PATH}"' >> ~/.bashrc
source ~/.bashrc
```

### Plugin not loading in OpenCode

1. Check plugin exists:
   ```bash
   ls ~/.config/opencode/plugins/opencontext-reminder.js
   ```

2. Restart OpenCode

3. Check OpenCode logs:
   ```bash
   opencode --print-logs
   ```

### Reinstall

```bash
# Remove existing installation
rm -rf ~/.local/share/opencontext
rm -f ~/.config/opencode/plugins/opencontext-reminder.js
rm -rf ~/.config/opencode/skills/opencontext

# Reinstall
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

## Quick Start

Once installed, daily workflow is simple:

```bash
# 1. Initialize project (one-time)
opencontext init --project-name "MyApp"

# 2. Work with OpenCode - plugin enforces workflow continuously

# 3. Commit when prompted/enforced
opencontext commit -m "Implemented feature X"

# 4. View status
opencontext status

# 5. Launch dashboard
opencontext tui

# 6. Inspect watchman request/response evidence (formatted)
opencontext law watch -n 20
# live follow
opencontext law watch --follow
```

## Uninstall

```bash
# Remove CLI
pip uninstall opencontext

# Remove plugin and skill
rm -f ~/.config/opencode/plugins/opencontext-reminder.js
rm -rf ~/.config/opencode/skills/opencontext

# Remove source (if installed via install.sh)
rm -rf ~/.local/share/opencontext
```

## Files Installed

### CLI Package
- Python package in `~/.local/lib/python*/site-packages/`
- Executable: `~/.local/bin/opencontext`

### Plugin
- Source: `~/.config/opencode/plugins/opencontext-reminder.js`
- Auto-loaded by OpenCode
- Provides continuous law enforcement (interrupt + continue)

### Skill
- Source: `~/.config/opencode/skills/opencontext/SKILL.md`
- Provides documentation and guidance
- Available to opencode agent

### Templates
- Stored in: `~/.local/share/opencontext/templates/`
- Used for project initialization

## Updates

To update to the latest version:

```bash
# If installed via install.sh
cd ~/.local/share/opencontext
git pull origin main
cd opencontext
pip install -e .

# If installed via pip
pip install --upgrade opencontext
```

## Support

- 📖 Documentation: https://github.com/vicmuchina/open_onecontext#readme
- 🐛 Issues: https://github.com/vicmuchina/open_onecontext/issues
- 💬 Discussions: https://github.com/vicmuchina/open_onecontext/discussions
