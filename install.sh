#!/bin/bash
#
# OpenContext One-Command Installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash -s -- --local
#   curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash -s -- --local --project-dir /path/to/project
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/vicmuchina/open_onecontext"
INSTALL_DIR="${HOME}/.local/share/opencontext"
PYTHON_MIN_VERSION="3.9"
START_DIR="$(pwd)"
LOCAL_INSTALL=false
PROJECT_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --local)
            LOCAL_INSTALL=true
            shift
            ;;
        --project-dir)
            if [[ -z "${2:-}" ]]; then
                echo -e "${RED}❌ --project-dir requires a value${NC}"
                exit 1
            fi
            PROJECT_DIR="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}❌ Unknown argument: $1${NC}"
            exit 1
            ;;
    esac
done

if [[ "${LOCAL_INSTALL}" == true && -z "${PROJECT_DIR}" ]]; then
    PROJECT_DIR="${START_DIR}"
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     OpenContext Installer - Git Context Controller     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check Python version
echo -e "${YELLOW}📋 Checking Python version...${NC}"
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python 3 is not installed${NC}"
    echo "Please install Python 3.9 or higher: https://python.org"
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
echo -e "${GREEN}✓ Python ${PYTHON_VERSION} found${NC}"

# Check if Python version is >= 3.9
if python3 -c "import sys; exit(0 if sys.version_info >= (3, 9) else 1)"; then
    echo -e "${GREEN}✓ Python version is compatible${NC}"
else
    echo -e "${RED}❌ Python 3.9 or higher required (found ${PYTHON_VERSION})${NC}"
    exit 1
fi

# Clone or update repository
echo ""
echo -e "${YELLOW}📦 Installing OpenContext...${NC}"

if [ -d "${INSTALL_DIR}" ]; then
    echo "Updating existing installation..."
    cd "${INSTALL_DIR}"
    git pull origin main 2>/dev/null || true
else
    echo "Cloning repository..."
    mkdir -p "$(dirname ${INSTALL_DIR})"
    git clone "${REPO_URL}.git" "${INSTALL_DIR}" 2>/dev/null || {
        echo -e "${YELLOW}⚠️  Could not clone with git, downloading archive...${NC}"
        curl -fsSL "${REPO_URL}/archive/main.tar.gz" | tar -xz -C "$(dirname ${INSTALL_DIR})"
        mv "$(dirname ${INSTALL_DIR})/open_onecontext-main" "${INSTALL_DIR}"
    }
fi

# Install Python package
echo ""
echo -e "${YELLOW}🔧 Installing Python package...${NC}"
cd "${INSTALL_DIR}/opencontext"

# Try pip install with --user first, fallback to regular pip
if pip3 install --user -e . 2>/dev/null; then
    echo -e "${GREEN}✓ Package installed with --user flag${NC}"
elif pip3 install -e . 2>/dev/null; then
    echo -e "${GREEN}✓ Package installed${NC}"
else
    echo -e "${RED}❌ Failed to install Python package${NC}"
    echo "Try running: cd ${INSTALL_DIR}/opencontext && pip3 install -e ."
    exit 1
fi

# Ensure local bin is in PATH
if [[ ":$PATH:" != *":${HOME}/.local/bin:"* ]]; then
    echo ""
    echo -e "${YELLOW}⚠️  ${HOME}/.local/bin is not in your PATH${NC}"
    echo "Add the following to your ~/.bashrc or ~/.zshrc:"
    echo "export PATH=\"\${HOME}/.local/bin:\${PATH}\""
    echo ""
fi

# Install OpenCode plugin
echo ""
echo -e "${YELLOW}🔌 Installing OpenCode plugin...${NC}"

# Create global plugins directory
mkdir -p "${HOME}/.config/opencode/plugins"

# Copy plugin
cp "${INSTALL_DIR}/opencontext/opencontext/plugin/opencontext-reminder.js" \
   "${HOME}/.config/opencode/plugins/"

echo -e "${GREEN}✓ Plugin installed globally${NC}"

# Install skill
echo ""
echo -e "${YELLOW}📚 Installing OpenCode skill...${NC}"

mkdir -p "${HOME}/.config/opencode/skills/opencontext"
cp "${INSTALL_DIR}/opencontext/docs/SKILL.md" \
   "${HOME}/.config/opencode/skills/opencontext/"

echo -e "${GREEN}✓ Skill installed${NC}"

if [[ "${LOCAL_INSTALL}" == true ]]; then
    echo ""
    echo -e "${YELLOW}📁 Installing project-local OpenCode plugin and skill...${NC}"

    if [[ ! -d "${PROJECT_DIR}" ]]; then
        echo -e "${RED}❌ Project directory not found: ${PROJECT_DIR}${NC}"
        exit 1
    fi

    PROJECT_OPENCODE_DIR="${PROJECT_DIR}/.opencode"
    mkdir -p "${PROJECT_OPENCODE_DIR}/plugins"
    mkdir -p "${PROJECT_OPENCODE_DIR}/skills/opencontext"

    cp "${INSTALL_DIR}/opencontext/opencontext/plugin/opencontext-reminder.js" \
       "${PROJECT_OPENCODE_DIR}/plugins/opencontext-reminder.js"
    cp "${INSTALL_DIR}/opencontext/docs/SKILL.md" \
       "${PROJECT_OPENCODE_DIR}/skills/opencontext/SKILL.md"

    echo -e "${GREEN}✓ Project plugin installed: ${PROJECT_OPENCODE_DIR}/plugins/opencontext-reminder.js${NC}"
    echo -e "${GREEN}✓ Project skill installed: ${PROJECT_OPENCODE_DIR}/skills/opencontext/SKILL.md${NC}"
fi

echo ""
echo -e "${BLUE}ℹ️  OpenCode local plugins are auto-loaded from:${NC}"
echo "   • ~/.config/opencode/plugins/ (global)"
echo "   • .opencode/plugins/ (project-level)"
echo "   No opencode.json plugin entry is required for local .js plugin files."

# Create project-level plugin directory structure
echo ""
echo -e "${YELLOW}📁 Creating project plugin structure...${NC}"

mkdir -p "${HOME}/.local/share/opencontext/templates"
cp "${INSTALL_DIR}/opencontext/opencontext/plugin/opencontext-reminder.js" \
   "${HOME}/.local/share/opencontext/templates/"

echo -e "${GREEN}✓ Templates created${NC}"

# Verify installation
echo ""
echo -e "${YELLOW}✅ Verifying installation...${NC}"

# Check if opencontext command works
if command -v opencontext &> /dev/null; then
    VERSION=$(opencontext --version 2>/dev/null || echo "unknown")
    echo -e "${GREEN}✓ opencontext CLI: ${VERSION}${NC}"
else
    echo -e "${YELLOW}⚠️  opencontext command not in PATH yet${NC}"
    echo "   Run: export PATH=\"\${HOME}/.local/bin:\${PATH}\""
fi

# Check plugin
if [ -f "${HOME}/.config/opencode/plugins/opencontext-reminder.js" ]; then
    echo -e "${GREEN}✓ OpenCode plugin installed${NC}"
else
    echo -e "${RED}❌ Plugin installation failed${NC}"
fi

# Check skill
if [ -f "${HOME}/.config/opencode/skills/opencontext/SKILL.md" ]; then
    echo -e "${GREEN}✓ OpenCode skill installed${NC}"
else
    echo -e "${RED}❌ Skill installation failed${NC}"
fi

if [[ "${LOCAL_INSTALL}" == true ]]; then
    if [ -f "${PROJECT_DIR}/.opencode/plugins/opencontext-reminder.js" ]; then
        echo -e "${GREEN}✓ Project-local OpenCode plugin installed${NC}"
    else
        echo -e "${RED}❌ Project-local plugin installation failed${NC}"
    fi

    if [ -f "${PROJECT_DIR}/.opencode/skills/opencontext/SKILL.md" ]; then
        echo -e "${GREEN}✓ Project-local OpenCode skill installed${NC}"
    else
        echo -e "${RED}❌ Project-local skill installation failed${NC}"
    fi
fi

# Success message
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          🎉 OpenContext installed successfully!        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Quick Start:${NC}"
echo ""
echo "  1. Initialize GCC in your project:"
echo "     cd /path/to/your/project"
echo "     opencontext init --project-name \"MyProject\""
echo ""
echo "  2. Start OpenCode (plugin will auto-load):"
echo "     opencode"
echo ""
if [[ "${LOCAL_INSTALL}" == true ]]; then
echo "  Local project integration installed in:"
echo "     ${PROJECT_DIR}/.opencode/plugins/"
echo "     ${PROJECT_DIR}/.opencode/skills/opencontext/"
echo ""
fi
echo "  3. Use GCC commands during development:"
echo "     opencontext commit \"Implemented feature X\""
echo "     opencontext branch experiment-optimization"
echo "     opencontext tui"
echo ""
echo -e "${BLUE}Documentation:${NC}"
echo "  • README: ${INSTALL_DIR}/opencontext/README.md"
echo "  • Skill:  ${HOME}/.config/opencode/skills/opencontext/SKILL.md"
echo "  • Paper:  ${INSTALL_DIR}/opencontext/docs/papers/GCC_Paper_2508.00031.md"
echo ""
echo -e "${YELLOW}Note:${NC} If 'opencontext' command is not found, restart your terminal"
echo "      or run: export PATH=\"\${HOME}/.local/bin:\${PATH}\""
echo ""

exit 0
