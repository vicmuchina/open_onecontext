# OpenContext Installation Guide

## One-Command Installation

Install everything (CLI, plugin, skill) with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

Or with wget:

```bash
wget -qO- https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
```

## What Gets Installed

The installer will:

1. ✅ **CLI Tool** - `opencontext` command available system-wide
2. ✅ **OpenCode Plugin** - Installed globally in `~/.config/opencode/plugins/`
3. ✅ **OpenContext Skill** - Installed in `~/.config/opencode/skills/opencontext/`
4. ✅ **Templates** - Stored in `~/.local/share/opencontext/`
5. ✅ **Config Update** - Adds OpenContext to plugin list in `~/.config/opencode/opencode.json`

## Installation Locations

After installation, you'll find:

```
~/.local/share/opencontext/          # Source code and templates
~/.config/opencode/plugins/          # OpenCode plugin
~/.config/opencode/skills/opencontext/  # OpenContext skill
~/.config/opencode/opencode.json     # Updated with OpenContext metadata
~/.local/bin/opencontext             # CLI executable (if in PATH)
```

### Config File Update

The installer adds OpenContext to the plugin array in your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "opencode-antigravity-auth@latest",
    "opencode-skills",
    "opencode-supermemory@latest",
    "opencode-pty",
    "opencontext"
  ]
}
```

This registers OpenContext with OpenCode's plugin system.

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
```

### 3. Start OpenCode

```bash
opencode
```

The plugin will automatically:
- Detect `.GCC/` directory
- Show "GCC Context Loaded" notification
- Start reminding you to commit at milestones

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

# 2. Work with OpenCode - plugin auto-reminds you

# 3. Commit when prompted
opencontext commit "Implemented feature X"

# 4. View status
opencontext status

# 5. Launch dashboard
opencontext tui
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
- Provides contextual reminders

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
