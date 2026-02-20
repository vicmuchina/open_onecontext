#!/usr/bin/env python3
"""OpenContext CLI - Main entry point."""

from pathlib import Path
from textwrap import dedent
from typing import Dict, List, Optional
from collections import deque
import subprocess
import os
import time

import click
import json
import yaml
from rich.console import Console
from rich.panel import Panel
from rich.text import Text

from opencontext.core.gcc import GCC
from opencontext.tui.dashboard import launch_dashboard

console = Console()

LAW_POLICY_FILENAME = "law-policy.txt"
LAW_WATCHMAN_PROMPT_FILENAME = "law-watchman-system.txt"
LAW_FAILURE_POLICY_FILENAME = "law-failure-policy.txt"
LAW_RESEARCH_POLICY_FILENAME = "law-research-policy.txt"
AGENT_GUIDE_FILENAME = "AGENT_GUIDE.txt"
LAW_RUNTIME_FILENAME = "law-runtime.json"


@click.group(invoke_without_command=True)
@click.option('--version', is_flag=True, help='Show version and exit.')
@click.pass_context
def cli(ctx, version):
    """OpenContext - Git Context Controller for OpenCode.
    
    Version control for LLM agent context. Track milestones,
    explore alternatives, and maintain project evolution.
    
    Commands:
      init       Initialize GCC in current directory
      commit     Create a checkpoint commit
      branch     Create a new branch
      merge      Merge a branch into current
      switch     Switch to a different branch
      context    Retrieve context at varying granularity
      status     Show current status
      list       List all branches
      delete     Delete a branch
      feedback   Add user feedback
      benchmark  Record benchmark results
      law        Manage Law Enforcer policy file
      io         Follow watchman request/response logs
      tui        Launch TUI dashboard
    """
    if version:
        from opencontext import __version__
        click.echo(f"OpenContext version {__version__}")
        ctx.exit()
    
    if ctx.invoked_subcommand is None:
        # Show help if no command provided
        click.echo(ctx.get_help())


@cli.command()
@click.option('--project-name', '-n', help='Name of the project')
@click.option('--goal', '-g', help='High-level project objective')
@click.option('--goal-file', type=click.Path(path_type=Path), help='Path to an existing markdown spec/goal file')
def init(project_name: Optional[str], goal: Optional[str], goal_file: Optional[Path]):
    """Initialize GCC in current directory."""
    try:
        gcc = GCC()
        gcc.init(project_name=project_name, goal=goal, goal_file=goal_file)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()

    try:
        assets = _ensure_law_assets(force=False)
        console.print(f"[green]✓ Law config ready:[/green] {assets.get('law', '')}")
        console.print(f"[green]✓ Policy file ready:[/green] {assets.get('policy', '')}")
        console.print(f"[green]✓ Watchman prompt ready:[/green] {assets.get('watchman_prompt', '')}")
        console.print(f"[green]✓ Failure policy ready:[/green] {assets.get('failure_policy', '')}")
        console.print(f"[green]✓ Research policy ready:[/green] {assets.get('research_policy', '')}")
        console.print(f"[green]✓ Runtime config ready:[/green] {assets.get('runtime', '')}")
        console.print(f"[green]✓ Agent guide generated:[/green] {assets.get('guide', '')}")
    except Exception as e:
        console.print(f"[yellow]Warning: failed to generate law helper files automatically: {e}[/yellow]")
        console.print("[yellow]Run 'opencontext law init' after fixing package templates.[/yellow]")


@cli.command()
@click.argument('summary', required=False)
@click.option('--message', '-m', help='Commit summary message (git-style alias for SUMMARY)')
@click.option('--approach', '-a', help='Name of the approach being tested')
@click.option('--status', '-s', default='active', 
              type=click.Choice(['active', 'abandoned', 'merged']),
              help='Status of the approach')
@click.option('--reason', '-r', help='Reason for status (especially abandoned)')
@click.option('--performance', '-p', help='Performance notes')
def commit(
    summary: Optional[str],
    message: Optional[str],
    approach: Optional[str],
    status: str,
    reason: Optional[str],
    performance: Optional[str],
):
    """Create a checkpoint commit.
    
    Examples:
      opencontext commit "Implemented auth module"
      opencontext commit -m "Implemented auth module"
    """
    final_summary = (summary or "").strip()
    if message and message.strip():
        if final_summary:
            console.print("[red]Error: provide either SUMMARY or --message/-m, not both.[/red]")
            raise click.Abort()
        final_summary = message.strip()

    if not final_summary:
        console.print("[red]Error: commit summary is required.[/red]")
        console.print("[yellow]Use either:[/yellow]")
        console.print("  opencontext commit \"<summary>\"")
        console.print("  opencontext commit -m \"<summary>\"")
        raise click.Abort()

    try:
        gcc = GCC()
        gcc.commit(
            summary=final_summary,
            approach=approach,
            status=status,
            reason=reason,
            performance=performance,
        )
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command()
@click.argument('name')
def branch(name: str):
    """Create a new branch.
    
    Example: opencontext branch experiment-async
    """
    try:
        gcc = GCC()
        gcc.branch(name)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command()
@click.argument('branch_name')
def merge(branch_name: str):
    """Merge a branch into the current branch.
    
    Example: opencontext merge experiment-async
    """
    try:
        gcc = GCC()
        gcc.merge(branch_name)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command()
@click.argument('name')
def switch(name: str):
    """Switch to a different branch.
    
    Example: opencontext switch main
    """
    try:
        gcc = GCC()
        gcc.switch(name)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command()
@click.option('--branch', '-b', help='Show specific branch context')
@click.option('--commit', '-c', help='Show specific commit details')
@click.option('--log', '-l', is_flag=True, help='Show execution log')
@click.option('--lines', '-n', default=20, help='Number of log lines to show')
@click.option('--metadata', '-m', help='Show specific metadata segment')
@click.option('--search', '-s', help='Search across all context')
@click.option('--limit', default=20, show_default=True, help='Max search results when using --search')
@click.option('--export', '-e', is_flag=True, help='Export as JSON')
@click.option('--format', '-f', default='json', type=click.Choice(['json', 'yaml']),
              help='Export format')
def context(
    branch: Optional[str],
    commit: Optional[str],
    log: bool,
    lines: int,
    metadata: Optional[str],
    search: Optional[str],
    limit: int,
    export: bool,
    format: str,
):
    """Retrieve context at varying granularity.
    
    Examples:
      opencontext context                    # Show current branch status
      opencontext context -b main           # Show main branch context
      opencontext context -c abc123         # Show specific commit
      opencontext context -l -n 50          # Show last 50 log lines
      opencontext context -m file_structure # Show metadata segment
    """
    try:
        gcc = GCC()
        result = gcc.context(
            branch=branch,
            commit=commit,
            log=log,
            lines=lines,
            metadata_key=metadata,
            search_query=search,
            search_limit=limit,
        )
        
        if export:
            import json
            import yaml as yaml_lib
            
            data = {
                'project_root': str(gcc.project_root),
                'current_branch': gcc._get_current_branch(),
                'context': result,
            }
            
            if format == 'json':
                click.echo(json.dumps(data, indent=2))
            else:
                click.echo(yaml_lib.dump(data, default_flow_style=False))
        else:
            console.print(result)
            
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command()
def status():
    """Show current status."""
    try:
        gcc = GCC()
        result = gcc.status()
        console.print(result)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command('list')
def list_branches():
    """List all branches."""
    try:
        gcc = GCC()
        branches = gcc.list_branches()
        if branches:
            for branch in branches:
                console.print(branch)
        else:
            console.print("[yellow]No branches found.[/yellow]")
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command()
@click.argument('name')
@click.option('--force', '-f', is_flag=True, help='Force deletion')
def delete(name: str, force: bool):
    """Delete a branch.
    
    Example: opencontext delete experiment-branch
    """
    try:
        gcc = GCC()
        gcc.delete_branch(name, force=force)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command()
@click.argument('feedback_text')
def feedback(feedback_text: str):
    """Add user feedback.
    
    Example: opencontext feedback "The RAG approach is too slow"
    """
    try:
        gcc = GCC()
        gcc.add_feedback(feedback_text)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command()
@click.option('--task', '-t', required=True, help='Task name')
@click.option('--pass-rate', '-p', required=True, type=float, help='Pass rate percentage')
@click.option('--notes', '-n', help='Additional notes')
def benchmark(task: str, pass_rate: float, notes: Optional[str]):
    """Record benchmark results.
    
    Example: opencontext benchmark -t "SWE-Bench" -p 40.7
    """
    try:
        gcc = GCC()
        gcc.add_benchmark(task=task, pass_rate=pass_rate, notes=notes)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command()
@click.option('--theme', default='dark', type=click.Choice(['dark', 'light']),
              help='Dashboard theme')
def tui(theme: str):
    """Launch TUI dashboard.
    
    Interactive dashboard to browse branches, commits, and evolution.
    """
    try:
        launch_dashboard(theme=theme)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command()
def plugin_path():
    """Show path to OpenCode plugin file."""
    import opencontext
    plugin_file = Path(opencontext.__file__).parent / "plugin" / "opencontext-reminder.js"
    if plugin_file.exists():
        click.echo(str(plugin_file))
    else:
        console.print("[red]Plugin file not found.[/red]")
        raise click.Abort()


def _default_law_path() -> Path:
    return Path.cwd() / ".GCC" / "law-enforcer.json"


def _legacy_law_path() -> Path:
    return Path.cwd() / ".GCC" / "law-enforcer.yaml"


def _law_policy_path() -> Path:
    return Path.cwd() / ".GCC" / LAW_POLICY_FILENAME


def _law_watchman_prompt_path() -> Path:
    return Path.cwd() / ".GCC" / LAW_WATCHMAN_PROMPT_FILENAME


def _law_failure_policy_path() -> Path:
    return Path.cwd() / ".GCC" / LAW_FAILURE_POLICY_FILENAME


def _law_research_policy_path() -> Path:
    return Path.cwd() / ".GCC" / LAW_RESEARCH_POLICY_FILENAME


def _agent_guide_path() -> Path:
    return Path.cwd() / ".GCC" / AGENT_GUIDE_FILENAME


def _law_runtime_path() -> Path:
    return Path.cwd() / ".GCC" / LAW_RUNTIME_FILENAME


def _default_law_runtime_config() -> Dict:
    return {
        "critic": {
            "apiKey": "",
            "model": "",
            "modelFallbacks": [],
            "baseUrl": "",
            "endpointPath": "",
            "authHeader": "authorization",
            "apiKeyPrefix": "Bearer",
            "headers": {},
            "request": {},
            "apiKeyEnv": "",
            "modelEnv": "",
            "responseFormatStrategy": "",
        }
    }


def _default_law_policy_text() -> str:
    return dedent(
        """\
        OpenContext Law Policy (editable)

        Purpose
        - This file is read by the Law Enforcer watchman model every session.
        - This file ships with a default balanced policy so users can run immediately without custom edits.

        Default Balanced Policy (active immediately)
        1) Keep OpenContext initialized for implementation work.
           - If `.GCC` is missing, initialize before continuing.
        2) Checkpoint meaningful implementation progress with `opencontext commit`.
           - Do not let long coding/test/edit loops run without checkpoints.
        3) Before retrying after actionable failures, consult previous attempts.
           - Use `opencontext context --search` and/or `opencontext context --log --lines 80`.
        4) When docs/GitHub/similar-project research changes implementation direction, checkpoint the findings.
           - Capture external insights so they survive compaction/handoffs.
        5) Prefer relevant MCP tools/skills/structured retrieval when available.
           - Avoid brute-force retries when better context/research tools exist.
        6) For long-running terminal tasks (dev server/watch/repl), use PTY/background tooling.
           - Avoid blocking shell flows when background execution tools are available.
        7) After session compaction, recover workflow state before normal work.
           - Create a checkpoint and retrieve recent context history.
        8) Avoid noisy interruptions for non-actionable workflow noise.
           - Read-only discovery, harmless CLI flag mistakes, and transient setup/network issues should not trigger interruption unless they clearly block implementation.

        Customization Notes
        - Keep rules explicit, short, and testable.
        - Mention concrete tool/skill/command names when needed.
        - Keep one rule per line or short numbered block.
        - You can edit this policy any time; changes apply on next watchman checks.

        Notes
        - JSON rule config lives in .GCC/law-enforcer.json under `custom.rules`.
        - This file is the natural-language watchman policy (default + your custom edits).
        """
    ).strip() + "\n"


def _default_watchman_system_prompt_text() -> str:
    return dedent(
        """\
        You are the OpenContext Law Enforcer Watchman.
        Judge workflow-law compliance using the provided law summary, policy text, agent guide, recent messages, tool evidence, interruption history, action history, and debt flags.
        Return STRICT JSON only matching the required schema exactly.
        You may return debt_updates to open/clear/keep checkpoint and compaction debt.

        Core behavior
        - Do not repeat the exact same interruption for an unresolved violation unless there is new evidence.
        - Use recentInterruptions and postAlertActions to verify whether prior alerts were already satisfied before alerting again.
        - Prioritize actionable implementation workflow violations.
        - Treat setup/environment/CLI-usage noise as non-actionable unless policy explicitly marks it actionable.
        - Interrupt only when there is a clear immediate corrective action the agent can perform.
        - Do not interrupt read-only discovery/exploration steps (listing files, reading docs, checking help/usage) unless policy explicitly marks them actionable.
        - Do not interrupt harmless command mistakes (wrong flag, missing optional tool, transient network/dependency/setup noise) unless repeated behavior clearly blocks implementation progress.
        - Interruption is expensive; when evidence is weak or ambiguous, prefer violation=false and lower confidence.
        - False-positive interruptions are worse than occasional misses; prioritize precision over recall.
        - Prefer waiting for persistent/repeated signals before interrupting on non-critical workflow issues.
        """
    ).strip() + "\n"


def _default_failure_policy_text() -> str:
    return dedent(
        """\
        OpenContext Failure Lookup Policy (editable)

        Purpose
        - Classify whether a detected failure should require `opencontext context` lookup before retry.
        - This text is passed as system policy to the failure classifier model.

        Classification Rules
        - Require lookup (true): actionable implementation failures (tests, build/compiler/runtime errors, tracebacks, assertion failures) where retrying without history is risky.
        - Do NOT require lookup (false): setup/environment/CLI noise (missing option, command not found, missing file during exploration, package manager metadata quirks, network/transient infra failures), unless explicitly marked as critical by the user.

        Output Contract
        - The model must return strict JSON:
          - require_lookup: boolean
          - reason: string
          - confidence: number (0..1)
        """
    ).strip() + "\n"


def _default_research_policy_text() -> str:
    return dedent(
        """\
        OpenContext Research Capture Policy (editable)

        Purpose
        - Decide whether recent research activity should be checkpointed into OpenContext.
        - This policy is passed to the research classifier model.

        Classification
        - require_capture=true when docs/specs/papers/GitHub/similar-project research produced implementation-relevant findings worth preserving.
        - require_capture=false when activity is routine/local exploration without meaningful external research insights.
        - If the activity looks similar to a previously solved hurdle, prefer require_capture=true to prevent repeating mistakes.

        Output contract (strict JSON):
        - require_capture: boolean
        - reason: string
        - confidence: number (0..1)
        """
    ).strip() + "\n"


def _render_agent_guide_text(
    law_path: Path,
    policy_path: Path,
    watchman_prompt_path: Path,
    failure_policy_path: Path,
    research_policy_path: Path,
    runtime_path: Path,
    global_runtime_path: Path,
) -> str:
    return dedent(
        f"""\
        OpenContext Agent Guide
        =======================

        Why This Exists
        - This guide is the source of truth for coding agents working in this repo.
        - It explains how to keep long-running OpenCode sessions aligned with GCC memory discipline.
        - It is generated by OpenContext so agents can bootstrap quickly without rereading the whole codebase.

        System Purpose
        - OpenContext provides project memory in .GCC (commit history + logs + metadata).
        - The Law Enforcer plugin continuously inspects workflow behavior and enforces rules.
        - Enforcement can be deterministic (JSON rules) and model-judged (watchman over policy text).

        Core Files
        - .GCC/main.md: project goal and milestones.
        - .GCC/branches/*/(commit.md, log.md, metadata.yaml): branch memory artifacts.
        - {law_path}: machine-readable law config (JSON).
        - {policy_path}: plain-text workflow law document for watchman judgment (ships with active balanced defaults).
        - {watchman_prompt_path}: editable watchman system prompt (controls judgment style/strictness).
        - {failure_policy_path}: editable failure-lookup classifier policy (actionable vs noise).
        - {research_policy_path}: editable research-capture classifier policy (what must be checkpointed).
        - {runtime_path}: optional project-local provider secret/model overrides.
        - {global_runtime_path}: optional global provider secret/model overrides.
        - .GCC/law-enforcer-trace.jsonl: runtime evidence log for requests/responses/violations.

        Runtime Components
        - Plugin: opencontext-reminder.js (global ~/.config/opencode/plugins or project .opencode/plugins).
        - CLI: opencontext (must be installed and available in PATH).
        - Provider key: env var referenced by `critic.apiKeyEnv`.
        - Provider type: OpenAI-compatible chat completions endpoint.

        Enforcement Lifecycle
        - session.created: initialize state, show GCC/MCP awareness.
        - experimental.chat.system.transform: inject law contract + policy/hints.
        - tool.execute.after: update debt, evaluate deterministic + custom rules.
        - message.updated (assistant completion): run watchman inspection.
        - session.idle: safety pass.
        - session.compacted: enforce checkpoint + context recovery.

        What Watchman Sees
        - Current law config summary.
        - Plain-text policy ({policy_path}).
        - Recent assistant/user messages.
        - Recent tool calls (tool name + command + output snippet).
        - Debt state (checkpoint/research/failure/mcp).
        - Per-rule custom violation counters.

        What Watchman Must Return (strict structured JSON)
        - violation: boolean
        - rule: string
        - reason: string
        - correction_prompt: string
        - confidence: number

        Malformed Output Handling
        - The plugin requests structured JSON output (default `json_schema`, optional `json_object` fallback).
        - If malformed, it retries with stricter instruction (`strictJsonRetryAttempts`) and can fall back by `critic.responseFormatStrategy`.
        - If still malformed, it logs and skips interruption (no broken prompt injection).

        Main Customization Paths (No Plugin Code Changes)
        1) Provider + model config (in {law_path}, section `critic`)
           - baseUrl, endpointPath, authHeader, apiKeyPrefix, headers, request, model, modelFallbacks, apiKeyEnv, modelEnv, responseFormatStrategy.
        1b) Provider key/model without re-exporting env vars:
           - set `critic.apiKey` / `critic.model` in {runtime_path} (project),
             or in {global_runtime_path} (global).
           - precedence: environment vars > project runtime config > global runtime config > law defaults.
        2) Deterministic behavior config
           - gcc.*, mcp.*, research.*, watchman.*
        3) Custom deterministic rules (section `custom.rules`)
           - Trigger-aware, condition-aware checks with required tools/commands.
        4) Custom escalation strategy (section `custom.escalation`)
           - soft_then_hard | hard_only | soft_only.
        5) Natural-language policy updates ({policy_path})
           - Human-readable law text for watchman. Starts with default balanced policy; edit as needed.
        6) Watchman system prompt updates ({watchman_prompt_path})
           - Fine-tune watchman behavior (dedupe and strictness policy).
        7) Failure lookup policy updates ({failure_policy_path})
           - Control when failure lookups are required vs ignored as environment noise.
        8) Research capture policy updates ({research_policy_path})
           - Control when docs/GitHub/similar-project findings must be checkpointed.

        Operator Bootstrap Questions (ask before major work)
        - Which provider should watchman use? (Chutes / OpenAI / other OpenAI-compatible)
        - What base URL should be used? (example: https://llm.chutes.ai/v1)
        - Which API key env var should be used? (example: CHUTES_API_KEY / OPENAI_API_KEY)
        - Should runtime config be project-local ({runtime_path}) or global ({global_runtime_path})?
        - Should we run model benchmark now and auto-write best model/fallbacks?
        - If answers are missing, ask first instead of guessing credentials/routes.

        Model Benchmark + Auto-Configure
        - Chutes example:
          python3 scripts/chutes_json_benchmark.py --base-url https://llm.chutes.ai/v1 --api-key-env CHUTES_API_KEY --response-format json_object --top 15 --write-runtime .GCC/law-runtime.json
        - Generic OpenAI-compatible example:
          python3 scripts/chutes_json_benchmark.py --base-url https://<provider>/v1 --api-key-env <ENV_VAR> --response-format json_object --max-models 20 --top 15 --write-runtime .GCC/law-runtime.json
        - Global runtime write (all projects):
          python3 scripts/chutes_json_benchmark.py ... --write-runtime ~/.config/opencontext/law-runtime.json
        - Script behavior:
          - discovers model IDs from provider model-list endpoint candidates (/models and /v1/models)
          - benchmarks strict watchman-schema JSON compliance + latency + tokens/sec
          - writes best model + fallback chain automatically when --write-runtime is set

        Custom Rule Schema (JSON)
        - id (string, required): stable rule identifier.
        - enabled (bool): whether rule is active.
        - description (string): human intent.
        - severity (string): low|medium|high (advisory metadata).
        - triggers (array): assistant_turn, tool_call, compaction, idle.
        - when (object):
          - taskKeywords: text keywords in command/output/message context.
          - toolIncludes/toolExcludes: tool name filters.
          - commandIncludes/commandRegex: command text filters.
          - assistantIncludes/outputIncludes: textual context filters.
          - debtFlags: pendingCompactionCheckpoint|pendingResearchCapture|pendingFailureLookup|hasViolationDebt|mcpUsed.
        - require (object):
          - anyTools: at least one required tool should appear in recent/current tool usage.
          - anyCommands: at least one required command string should appear.
          - guidance: explicit corrective action text shown in reminders.
        - interruptAfterViolations (int, optional): per-rule hard interruption threshold.

        Escalation Behavior (custom.escalation)
        - mode:
          - soft_then_hard: warn first, interrupt on repeated violations.
          - hard_only: interrupt immediately.
          - soft_only: warnings only.
        - softViolationsBeforeInterrupt: number of soft reminders before hard mode.
        - hardInterruptThreshold: default hard threshold if rule override is absent.
        - reminderCooldownSeconds: minimum interval between reminders for same rule.
        - resetOnCommit: clear rule counters after successful opencontext commit.

        Planning Guard
        - To avoid noisy interruptions during plan phases:
          - gcc.skipCheckpointDuringPlanningAgent = true
          - watchman.skipDuringPlanningAgent = true
          - custom.exemptAgentPatterns includes "plan"/"planner" by default

        Recommended Policy Authoring Style ({policy_path})
        - The file already contains an active balanced baseline policy.
        - Start by tweaking existing rules instead of rewriting from scratch.
        - Use short, testable rules.
        - Prefer explicit "when X, do Y" format.
        - Mention exact tool/skill/command names.
        - Example:
          - If task needs long-running process (dev/watch/repl), use PTY/background tooling (pty_spawn) instead of blocking bash.
          - If a relevant MCP server is available, use it before generic web search.
          - Capture major docs/GitHub findings with opencontext commit.
          - Before retrying after failure, consult opencontext context --search/--log.

        Standard Daily Workflow
        - opencontext init --project-name "<name>" --goal "<goal>"
        - opencontext init --project-name "<name>" --goal-file SPEC.md
        - opencontext law init
        - opencontext law validate
        - opencontext law status
        - opencontext law watch -n 20
        - opencode (or opencode serve --print-logs --log-level DEBUG)
        - opencontext commit "<summary>" at meaningful checkpoints
        - opencontext context --search "<failure/topic>" before retry loops
        - opencontext context --log --lines 80 after compaction or handoff

        Quick Debug Workflow
        - Check plugin/service logs:
          opencode --print-logs --log-level DEBUG run "plugin smoke test"
        - Check trace evidence:
          opencontext io
          opencontext law watch -n 20
          opencontext law watch --follow
        - Validate config:
          opencontext law validate
        - Show active settings:
          opencontext law status
        - Run full health check:
          opencontext law doctor

        Common Misconfigurations
        - Wrong apiKeyEnv value (env var missing at runtime).
        - endpointPath does not match provider API route.
        - Model returns non-JSON despite schema request.
        - Rule conditions too broad causing excessive reminders.
        - Policy mentions tools that are not installed.

        Installation and Repair
        - One command install:
          curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash
        - Local project install:
          curl -fsSL https://raw.githubusercontent.com/vicmuchina/open_onecontext/main/install.sh | bash -s -- --local --project-dir <project_path>
        - Repair project integration:
          opencontext setup-opencode
          opencontext law init
          opencontext law guide

        Regenerate This Guide
        - Run: opencontext law guide
        """
    ).strip() + "\n"


def _get_package_template_path(file_name: str) -> Path:
    import opencontext

    return Path(opencontext.__file__).parent / "plugin" / file_name


def _ensure_law_assets(force: bool = False) -> Dict[str, str]:
    """Create/update law JSON + policy + guide files inside .GCC."""
    import shutil

    gcc_dir = Path.cwd() / ".GCC"
    if not gcc_dir.exists():
        raise RuntimeError("GCC not initialized. Run 'opencontext init' first.")

    results: Dict[str, str] = {}
    law_target = _default_law_path()
    guide_target = _agent_guide_path()
    runtime_target = _law_runtime_path()
    global_runtime_target = Path.home() / ".config" / "opencontext" / LAW_RUNTIME_FILENAME

    law_template = _get_package_template_path("law-enforcer.json")
    policy_template = _get_package_template_path(LAW_POLICY_FILENAME)
    watchman_prompt_template = _get_package_template_path(LAW_WATCHMAN_PROMPT_FILENAME)
    failure_policy_template = _get_package_template_path(LAW_FAILURE_POLICY_FILENAME)
    research_policy_template = _get_package_template_path(LAW_RESEARCH_POLICY_FILENAME)
    runtime_template = _get_package_template_path(LAW_RUNTIME_FILENAME)

    if force or not law_target.exists():
        shutil.copy2(law_template, law_target)
        results["law"] = f"written:{law_target}"
    else:
        results["law"] = f"kept:{law_target}"

    law_data: Dict = {}
    try:
        law_data = _read_law_file(law_target)
    except Exception:
        law_data = {}
    policy_target = _resolve_policy_path_from_law_data(law_data)
    watchman_prompt_target = _resolve_watchman_prompt_path_from_law_data(law_data)
    failure_policy_target = _resolve_failure_policy_path_from_law_data(law_data)
    research_policy_target = _resolve_research_policy_path_from_law_data(law_data)
    policy_target.parent.mkdir(parents=True, exist_ok=True)
    watchman_prompt_target.parent.mkdir(parents=True, exist_ok=True)
    failure_policy_target.parent.mkdir(parents=True, exist_ok=True)
    research_policy_target.parent.mkdir(parents=True, exist_ok=True)

    if force or not policy_target.exists():
        if policy_template.exists():
            shutil.copy2(policy_template, policy_target)
        else:
            policy_target.write_text(_default_law_policy_text(), encoding="utf-8")
        results["policy"] = f"written:{policy_target}"
    else:
        results["policy"] = f"kept:{policy_target}"

    if force or not watchman_prompt_target.exists():
        if watchman_prompt_template.exists():
            shutil.copy2(watchman_prompt_template, watchman_prompt_target)
        else:
            watchman_prompt_target.write_text(_default_watchman_system_prompt_text(), encoding="utf-8")
        results["watchman_prompt"] = f"written:{watchman_prompt_target}"
    else:
        results["watchman_prompt"] = f"kept:{watchman_prompt_target}"

    if force or not failure_policy_target.exists():
        if failure_policy_template.exists():
            shutil.copy2(failure_policy_template, failure_policy_target)
        else:
            failure_policy_target.write_text(_default_failure_policy_text(), encoding="utf-8")
        results["failure_policy"] = f"written:{failure_policy_target}"
    else:
        results["failure_policy"] = f"kept:{failure_policy_target}"

    if force or not research_policy_target.exists():
        if research_policy_template.exists():
            shutil.copy2(research_policy_template, research_policy_target)
        else:
            research_policy_target.write_text(_default_research_policy_text(), encoding="utf-8")
        results["research_policy"] = f"written:{research_policy_target}"
    else:
        results["research_policy"] = f"kept:{research_policy_target}"

    if force or not runtime_target.exists():
        if runtime_template.exists():
            shutil.copy2(runtime_template, runtime_target)
        else:
            runtime_target.write_text(
                json.dumps(_default_law_runtime_config(), indent=2) + "\n",
                encoding="utf-8",
            )
        results["runtime"] = f"written:{runtime_target}"
    else:
        results["runtime"] = f"kept:{runtime_target}"

    guide_target.write_text(
        _render_agent_guide_text(
            law_path=law_target,
            policy_path=policy_target,
            watchman_prompt_path=watchman_prompt_target,
            failure_policy_path=failure_policy_target,
            research_policy_path=research_policy_target,
            runtime_path=runtime_target,
            global_runtime_path=global_runtime_target,
        ),
        encoding="utf-8",
    )
    results["guide"] = f"written:{guide_target}"
    return results


def _resolve_law_path(path: Optional[Path] = None) -> Path:
    if path is not None:
        return path
    primary = _default_law_path()
    if primary.exists():
        return primary
    legacy = _legacy_law_path()
    if legacy.exists():
        return legacy
    return primary


def _read_law_file(law_path: Path) -> Dict:
    with open(law_path, "r", encoding="utf-8") as f:
        raw = f.read()
    if law_path.suffix.lower() == ".json":
        return json.loads(raw or "{}")
    return yaml.safe_load(raw) or {}


def _resolve_policy_path_from_law_data(law_data: Optional[Dict]) -> Path:
    policy_name = LAW_POLICY_FILENAME
    if isinstance(law_data, dict):
        custom = law_data.get("custom", {})
        if isinstance(custom, dict) and isinstance(custom.get("policyFile"), str):
            candidate = custom.get("policyFile", "").strip()
            if candidate:
                policy_name = candidate
    policy_path = Path(policy_name)
    if policy_path.is_absolute():
        return policy_path
    return Path.cwd() / ".GCC" / policy_name


def _resolve_watchman_prompt_path_from_law_data(law_data: Optional[Dict]) -> Path:
    prompt_name = LAW_WATCHMAN_PROMPT_FILENAME
    if isinstance(law_data, dict):
        watchman = law_data.get("watchman", {})
        if isinstance(watchman, dict) and isinstance(watchman.get("systemPromptFile"), str):
            candidate = watchman.get("systemPromptFile", "").strip()
            if candidate:
                prompt_name = candidate
    prompt_path = Path(prompt_name)
    if prompt_path.is_absolute():
        return prompt_path
    return Path.cwd() / ".GCC" / prompt_name


def _resolve_failure_policy_path_from_law_data(law_data: Optional[Dict]) -> Path:
    policy_name = LAW_FAILURE_POLICY_FILENAME
    if isinstance(law_data, dict):
        gcc = law_data.get("gcc", {})
        if isinstance(gcc, dict) and isinstance(gcc.get("failureLookupPolicyFile"), str):
            candidate = gcc.get("failureLookupPolicyFile", "").strip()
            if candidate:
                policy_name = candidate
    policy_path = Path(policy_name)
    if policy_path.is_absolute():
        return policy_path
    return Path.cwd() / ".GCC" / policy_name


def _resolve_research_policy_path_from_law_data(law_data: Optional[Dict]) -> Path:
    policy_name = LAW_RESEARCH_POLICY_FILENAME
    if isinstance(law_data, dict):
        research = law_data.get("research", {})
        if isinstance(research, dict) and isinstance(research.get("capturePolicyFile"), str):
            candidate = research.get("capturePolicyFile", "").strip()
            if candidate:
                policy_name = candidate
    policy_path = Path(policy_name)
    if policy_path.is_absolute():
        return policy_path
    return Path.cwd() / ".GCC" / policy_name


def _read_runtime_critic(path: Path) -> Dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    critic = data.get("critic", data)
    if not isinstance(critic, dict):
        return {}
    return critic


def _validate_law_content(law: Dict) -> List[str]:
    """Return validation errors for law config."""
    errors = []
    if not isinstance(law, dict):
        return ["Top-level law config must be a mapping/object."]

    required_sections = ["mode", "gcc", "mcp", "research", "critic", "watchman"]
    for section in required_sections:
        if section not in law:
            errors.append(f"Missing required top-level section: {section}")

    gcc = law.get("gcc", {})
    if isinstance(gcc, dict):
        if "requireCheckpointEveryTools" in gcc:
            value = gcc.get("requireCheckpointEveryTools")
            if not isinstance(value, (int, float)) or value < 1:
                errors.append("gcc.requireCheckpointEveryTools must be a positive number.")
        if "checkpointDebtJudgeMode" in gcc:
            value = gcc.get("checkpointDebtJudgeMode")
            allowed = {"model_only", "model_first_fallback", "deterministic"}
            if not isinstance(value, str) or value not in allowed:
                errors.append(
                    "gcc.checkpointDebtJudgeMode must be one of: "
                    "model_only, model_first_fallback, deterministic."
                )
        if "failureLookupPolicyFile" in gcc and not isinstance(gcc.get("failureLookupPolicyFile"), str):
            errors.append("gcc.failureLookupPolicyFile must be a string.")
        if "failureClassifierEnabled" in gcc and not isinstance(gcc.get("failureClassifierEnabled"), bool):
            errors.append("gcc.failureClassifierEnabled must be true or false.")
        if "failureClassifierRequireModelDecision" in gcc and not isinstance(
            gcc.get("failureClassifierRequireModelDecision"), bool
        ):
            errors.append("gcc.failureClassifierRequireModelDecision must be true or false.")
        if "failureClassifierMinConfidence" in gcc:
            value = gcc.get("failureClassifierMinConfidence")
            if not isinstance(value, (int, float)) or value < 0 or value > 1:
                errors.append("gcc.failureClassifierMinConfidence must be a number between 0 and 1.")
        if "compactionDebtJudgeMode" in gcc:
            value = gcc.get("compactionDebtJudgeMode")
            allowed = {"model_only", "model_first_fallback", "deterministic"}
            if not isinstance(value, str) or value not in allowed:
                errors.append(
                    "gcc.compactionDebtJudgeMode must be one of: "
                    "model_only, model_first_fallback, deterministic."
                )
    else:
        errors.append("gcc must be a mapping/object.")

    research = law.get("research", {})
    if isinstance(research, dict):
        if "capturePolicyFile" in research and not isinstance(research.get("capturePolicyFile"), str):
            errors.append("research.capturePolicyFile must be a string.")
        if "captureClassifierEnabled" in research and not isinstance(
            research.get("captureClassifierEnabled"), bool
        ):
            errors.append("research.captureClassifierEnabled must be true or false.")
        if "captureClassifierRequireModelDecision" in research and not isinstance(
            research.get("captureClassifierRequireModelDecision"), bool
        ):
            errors.append("research.captureClassifierRequireModelDecision must be true or false.")
        if "captureClassifierMinConfidence" in research:
            value = research.get("captureClassifierMinConfidence")
            if not isinstance(value, (int, float)) or value < 0 or value > 1:
                errors.append("research.captureClassifierMinConfidence must be a number between 0 and 1.")
    else:
        errors.append("research must be a mapping/object.")

    critic = law.get("critic", {})
    if isinstance(critic, dict):
        if "enabled" in critic and not isinstance(critic.get("enabled"), bool):
            errors.append("critic.enabled must be true or false.")
        if "baseUrl" in critic and not isinstance(critic.get("baseUrl"), str):
            errors.append("critic.baseUrl must be a string.")
        if "endpointPath" in critic and not isinstance(critic.get("endpointPath"), str):
            errors.append("critic.endpointPath must be a string.")
        if "headers" in critic and not isinstance(critic.get("headers"), dict):
            errors.append("critic.headers must be an object/mapping.")
        if "request" in critic and not isinstance(critic.get("request"), dict):
            errors.append("critic.request must be an object/mapping.")
        if "modelFallbacks" in critic:
            value = critic.get("modelFallbacks")
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                errors.append("critic.modelFallbacks must be a list of strings.")
        if "responseFormatStrategy" in critic:
            value = critic.get("responseFormatStrategy")
            allowed = {"json_schema", "json_object", "json_schema_then_json_object"}
            if not isinstance(value, str) or value not in allowed:
                errors.append(
                    "critic.responseFormatStrategy must be one of: "
                    "json_schema, json_object, json_schema_then_json_object."
                )
        if "strictJsonRetryAttempts" in critic:
            value = critic.get("strictJsonRetryAttempts")
            if not isinstance(value, (int, float)) or value < 0:
                errors.append("critic.strictJsonRetryAttempts must be a non-negative number.")
    else:
        errors.append("critic must be a mapping/object.")

    watchman = law.get("watchman", {})
    if isinstance(watchman, dict):
        if "enabled" in watchman and not isinstance(watchman.get("enabled"), bool):
            errors.append("watchman.enabled must be true or false.")
        if "inspectOnIdle" in watchman and not isinstance(watchman.get("inspectOnIdle"), bool):
            errors.append("watchman.inspectOnIdle must be true or false.")
        if "skipDuringPlanningAgent" in watchman and not isinstance(watchman.get("skipDuringPlanningAgent"), bool):
            errors.append("watchman.skipDuringPlanningAgent must be true or false.")
        if "dedupeSameViolationUntilResolved" in watchman and not isinstance(
            watchman.get("dedupeSameViolationUntilResolved"), bool
        ):
            errors.append("watchman.dedupeSameViolationUntilResolved must be true or false.")
        if "systemPromptFile" in watchman and not isinstance(watchman.get("systemPromptFile"), str):
            errors.append("watchman.systemPromptFile must be a string.")
        if "minConfidence" in watchman:
            value = watchman.get("minConfidence")
            if not isinstance(value, (int, float)) or value < 0 or value > 1:
                errors.append("watchman.minConfidence must be a number between 0 and 1.")
        if "requireModelDecision" in watchman and not isinstance(
            watchman.get("requireModelDecision"), bool
        ):
            errors.append("watchman.requireModelDecision must be true or false.")
        if "includeRecentAlerts" in watchman:
            value = watchman.get("includeRecentAlerts")
            if not isinstance(value, (int, float)) or value < 1:
                errors.append("watchman.includeRecentAlerts must be a positive number.")
        if "includeRecentActionsAfterAlerts" in watchman:
            value = watchman.get("includeRecentActionsAfterAlerts")
            if not isinstance(value, (int, float)) or value < 1:
                errors.append("watchman.includeRecentActionsAfterAlerts must be a positive number.")
    else:
        errors.append("watchman must be a mapping/object.")

    custom = law.get("custom", {})
    if custom and not isinstance(custom, dict):
        errors.append("custom must be a mapping/object.")
    elif isinstance(custom, dict):
        if "enabled" in custom and not isinstance(custom.get("enabled"), bool):
            errors.append("custom.enabled must be true or false.")
        if "policyFile" in custom and not isinstance(custom.get("policyFile"), str):
            errors.append("custom.policyFile must be a string.")
        escalation = custom.get("escalation", {})
        if escalation and not isinstance(escalation, dict):
            errors.append("custom.escalation must be an object/mapping.")
        elif isinstance(escalation, dict):
            mode = escalation.get("mode")
            if mode is not None and mode not in ["soft_then_hard", "hard_only", "soft_only"]:
                errors.append("custom.escalation.mode must be soft_then_hard, hard_only, or soft_only.")
            for key in [
                "softViolationsBeforeInterrupt",
                "hardInterruptThreshold",
                "reminderCooldownSeconds",
            ]:
                if key in escalation and not isinstance(escalation.get(key), (int, float)):
                    errors.append(f"custom.escalation.{key} must be a number.")
            if "resetOnCommit" in escalation and not isinstance(escalation.get("resetOnCommit"), bool):
                errors.append("custom.escalation.resetOnCommit must be true or false.")

        rules = custom.get("rules", [])
        if rules and not isinstance(rules, list):
            errors.append("custom.rules must be a list.")
        elif isinstance(rules, list):
            for idx, rule in enumerate(rules):
                prefix = f"custom.rules[{idx}]"
                if not isinstance(rule, dict):
                    errors.append(f"{prefix} must be an object.")
                    continue
                if "id" not in rule or not isinstance(rule.get("id"), str) or not rule.get("id").strip():
                    errors.append(f"{prefix}.id is required and must be a non-empty string.")
                if "enabled" in rule and not isinstance(rule.get("enabled"), bool):
                    errors.append(f"{prefix}.enabled must be true or false.")
                if "triggers" in rule:
                    triggers = rule.get("triggers")
                    if not isinstance(triggers, list) or not all(isinstance(t, str) for t in triggers):
                        errors.append(f"{prefix}.triggers must be a list of strings.")
                when = rule.get("when")
                if when is not None and not isinstance(when, dict):
                    errors.append(f"{prefix}.when must be an object.")
                require = rule.get("require")
                if require is not None and not isinstance(require, dict):
                    errors.append(f"{prefix}.require must be an object.")
                if "interruptAfterViolations" in rule and not isinstance(
                    rule.get("interruptAfterViolations"), (int, float)
                ):
                    errors.append(f"{prefix}.interruptAfterViolations must be a number.")

    agent_guide = law.get("agentGuide", {})
    if agent_guide and not isinstance(agent_guide, dict):
        errors.append("agentGuide must be a mapping/object.")
    elif isinstance(agent_guide, dict):
        if "path" in agent_guide and not isinstance(agent_guide.get("path"), str):
            errors.append("agentGuide.path must be a string.")
        if "includeInWatchmanPayload" in agent_guide and not isinstance(
            agent_guide.get("includeInWatchmanPayload"), bool
        ):
            errors.append("agentGuide.includeInWatchmanPayload must be true or false.")

    return errors


def _resolve_trace_path_from_law_data(law_data: Optional[Dict]) -> Path:
    trace_name = "law-enforcer-trace.jsonl"
    if isinstance(law_data, dict):
        observability = law_data.get("observability", {})
        if isinstance(observability, dict):
            candidate = observability.get("traceFile")
            if isinstance(candidate, str) and candidate.strip():
                trace_name = candidate.strip()

    trace_path = Path(trace_name)
    if not trace_path.is_absolute():
        trace_path = Path.cwd() / ".GCC" / trace_name
    return trace_path


def _compact_trace_text(value: object, max_chars: int = 260) -> str:
    if value is None:
        return ""
    text = " ".join(str(value).split())
    if len(text) <= max_chars:
        return text
    return text[: max(0, max_chars - 1)] + "…"


def _render_watchman_event(event: Dict, include_interrupts: bool = False) -> Optional[Dict[str, str]]:
    event_type = str(event.get("type", ""))
    at = str(event.get("at", "unknown-time"))
    session_id = str(event.get("sessionId", "unknown-session"))

    if event_type == "watchman.request":
        evidence = event.get("evidence", {}) if isinstance(event.get("evidence"), dict) else {}
        latest = evidence.get("latestAssistant", {}) if isinstance(evidence.get("latestAssistant"), dict) else {}
        assistant_text = _compact_trace_text(latest.get("text") or "(empty)")
        trigger = _compact_trace_text(event.get("trigger") or "-")
        model = _compact_trace_text(event.get("model") or "-")
        recent_tools = evidence.get("recentToolCalls", [])
        debts = evidence.get("debts", {}) if isinstance(evidence.get("debts"), dict) else {}

        lines: List[str] = [
            f"Session: {session_id}",
            f"Trigger: {trigger}",
            f"Model: {model}",
            f"Assistant: {assistant_text}",
        ]
        if debts:
            lines.append(
                "Debt: "
                f"checkpoint={debts.get('pendingCompactionCheckpoint', False)} "
                f"research={debts.get('pendingResearchCapture', False)} "
                f"failure={debts.get('pendingFailureLookup', False)}"
            )
        if isinstance(recent_tools, list) and recent_tools:
            lines.append("Recent Tools:")
            for item in recent_tools[-6:]:
                if not isinstance(item, dict):
                    continue
                tool = _compact_trace_text(item.get("tool") or "?")
                command_text = _compact_trace_text(item.get("commandText") or item.get("args") or "", 220)
                lines.append(f"  - {tool}: {command_text}")

        return {
            "title": f"Watchman Request · {at}",
            "body": "\n".join(lines),
            "style": "cyan",
        }

    if event_type == "watchman.response":
        verdict = event.get("verdict", {}) if isinstance(event.get("verdict"), dict) else {}
        reason = verdict.get("reason") or verdict.get("error") or "-"
        correction = verdict.get("correctionPrompt") or verdict.get("correction_prompt") or "-"
        model = verdict.get("model") or event.get("model") or "-"

        lines = [
            f"Session: {session_id}",
            f"Trigger: {_compact_trace_text(event.get('trigger') or '-')}",
            f"Model: {_compact_trace_text(model)}",
            f"Available: {verdict.get('available', False)}",
            f"Violation: {verdict.get('violation', False)}",
            f"Rule: {_compact_trace_text(verdict.get('rule') or '-')}",
            f"Confidence: {verdict.get('confidence', '-')}",
            f"Reason: {_compact_trace_text(reason)}",
            f"Correction: {_compact_trace_text(correction)}",
        ]
        return {
            "title": f"Watchman Response · {at}",
            "body": "\n".join(lines),
            "style": "green" if verdict.get("violation") else "blue",
        }

    if include_interrupts and event_type in {"law.interrupt.request", "law.interrupt.injected"}:
        violation = event.get("violation", {}) if isinstance(event.get("violation"), dict) else {}
        prompt_text = event.get("prompt", "") if isinstance(event.get("prompt"), str) else ""
        lines = [
            f"Session: {session_id}",
            f"Rule: {_compact_trace_text(violation.get('rule') or '-')}",
            f"Reason: {_compact_trace_text(violation.get('detail') or '-')}",
        ]
        if prompt_text:
            lines.append(f"Prompt: {_compact_trace_text(prompt_text)}")
        return {
            "title": f"{event_type} · {at}",
            "body": "\n".join(lines),
            "style": "yellow",
        }

    return None


@cli.group()
def law():
    """Manage OpenContext Law Enforcer policy, runtime config, and agent guide files."""
    pass


@law.command("init")
@click.option("--force", is_flag=True, help="Overwrite existing law file")
def law_init(force: bool):
    """Create/refresh .GCC law policy, runtime config, and agent guide files."""
    try:
        assets = _ensure_law_assets(force=force)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()
    except Exception as e:
        console.print(f"[red]Error creating law assets: {e}[/red]")
        raise click.Abort()

    console.print(f"[green]✓ Law file:[/green] {assets.get('law', '')}")
    console.print(f"[green]✓ Policy file:[/green] {assets.get('policy', '')}")
    console.print(f"[green]✓ Watchman prompt:[/green] {assets.get('watchman_prompt', '')}")
    console.print(f"[green]✓ Failure policy:[/green] {assets.get('failure_policy', '')}")
    console.print(f"[green]✓ Research policy:[/green] {assets.get('research_policy', '')}")
    console.print(f"[green]✓ Runtime config:[/green] {assets.get('runtime', '')}")
    console.print(f"[green]✓ Agent guide:[/green] {assets.get('guide', '')}")
    console.print("Validate with: opencontext law validate")


@law.command("validate")
@click.option("--path", "law_path_opt", type=click.Path(path_type=Path), help="Path to law JSON/YAML file")
def law_validate(law_path_opt: Optional[Path]):
    """Validate law policy file syntax and core schema."""
    law_path = _resolve_law_path(law_path_opt)
    if not law_path.exists():
        console.print(f"[red]Error: Law file not found:[/red] {law_path}")
        raise click.Abort()

    try:
        law_data = _read_law_file(law_path)
    except Exception as e:
        console.print(f"[red]Error parsing law file:[/red] {e}")
        raise click.Abort()

    errors = _validate_law_content(law_data)
    if errors:
        console.print("[red]Law validation failed:[/red]")
        for err in errors:
            console.print(f"  - {err}")
        raise click.Abort()

    console.print(f"[green]✓ Law file is valid:[/green] {law_path}")


@law.command("status")
@click.option("--path", "law_path_opt", type=click.Path(path_type=Path), help="Path to law JSON/YAML file")
def law_status(law_path_opt: Optional[Path]):
    """Show Law Enforcer policy status."""
    law_path = _resolve_law_path(law_path_opt)
    exists = law_path.exists()

    if not exists:
        console.print(Panel(
            Text(f"Law file missing: {law_path}\nRun: opencontext law init", style="yellow"),
            title="Law Enforcer Status",
            border_style="yellow"
        ))
        return

    try:
        law_data = _read_law_file(law_path)
    except Exception as e:
        console.print(f"[red]Error parsing law file:[/red] {e}")
        raise click.Abort()

    mode = law_data.get("mode", "unknown")
    checkpoint = law_data.get("gcc", {}).get("requireCheckpointEveryTools", "unknown")
    checkpoint_mode = law_data.get("gcc", {}).get("checkpointDebtJudgeMode", "unknown")
    planning_skip = law_data.get("gcc", {}).get("skipCheckpointDuringPlanningAgent", "unknown")
    failure_policy_file = law_data.get("gcc", {}).get("failureLookupPolicyFile", LAW_FAILURE_POLICY_FILENAME)
    failure_classifier_enabled = law_data.get("gcc", {}).get("failureClassifierEnabled", "unknown")
    failure_classifier_conf = law_data.get("gcc", {}).get("failureClassifierMinConfidence", "unknown")
    failure_classifier_model_only = law_data.get("gcc", {}).get("failureClassifierRequireModelDecision", "unknown")
    critic_enabled = law_data.get("critic", {}).get("enabled", "unknown")
    critic_model = law_data.get("critic", {}).get("model", "unknown")
    critic_fallbacks = law_data.get("critic", {}).get("modelFallbacks", [])
    critic_response_strategy = law_data.get("critic", {}).get("responseFormatStrategy", "json_schema_then_json_object")
    critic_base = law_data.get("critic", {}).get("baseUrl", "unknown")
    critic_path = law_data.get("critic", {}).get("endpointPath", "unknown")
    watchman_enabled = law_data.get("watchman", {}).get("enabled", "unknown")
    watchman_turns = law_data.get("watchman", {}).get("inspectAssistantTurns", "unknown")
    watchman_plan_skip = law_data.get("watchman", {}).get("skipDuringPlanningAgent", "unknown")
    watchman_dedupe = law_data.get("watchman", {}).get("dedupeSameViolationUntilResolved", "unknown")
    watchman_min_conf = law_data.get("watchman", {}).get("minConfidence", "unknown")
    watchman_model_only = law_data.get("watchman", {}).get("requireModelDecision", "unknown")
    watchman_prompt_file = law_data.get("watchman", {}).get("systemPromptFile", LAW_WATCHMAN_PROMPT_FILENAME)
    watchman_alerts = law_data.get("watchman", {}).get("includeRecentAlerts", "unknown")
    watchman_post_alert_actions = law_data.get("watchman", {}).get("includeRecentActionsAfterAlerts", "unknown")
    compaction_mode = law_data.get("gcc", {}).get("compactionDebtJudgeMode", "unknown")
    research_policy_file = law_data.get("research", {}).get("capturePolicyFile", LAW_RESEARCH_POLICY_FILENAME)
    research_classifier_enabled = law_data.get("research", {}).get("captureClassifierEnabled", "unknown")
    research_classifier_conf = law_data.get("research", {}).get("captureClassifierMinConfidence", "unknown")
    research_classifier_model_only = law_data.get("research", {}).get("captureClassifierRequireModelDecision", "unknown")
    custom_enabled = law_data.get("custom", {}).get("enabled", "unknown")
    custom_mode = law_data.get("custom", {}).get("escalation", {}).get("mode", "unknown")
    custom_rules = len(law_data.get("custom", {}).get("rules", []) or [])
    policy_path = _resolve_policy_path_from_law_data(law_data)
    watchman_prompt_path = Path.cwd() / ".GCC" / watchman_prompt_file
    failure_policy_path = Path.cwd() / ".GCC" / failure_policy_file
    research_policy_path = Path.cwd() / ".GCC" / research_policy_file
    runtime_path = _law_runtime_path()
    global_runtime_path = Path.home() / ".config" / "opencontext" / LAW_RUNTIME_FILENAME
    guide_path = law_data.get("agentGuide", {}).get("path", f".GCC/{AGENT_GUIDE_FILENAME}")

    status_text = (
        f"Path: {law_path}\n"
        f"Mode: {mode}\n"
        f"Checkpoint cadence: {checkpoint}\n"
        f"Checkpoint debt mode: {checkpoint_mode}\n"
        f"Skip checkpoint during planning: {planning_skip}\n"
        f"Compaction debt mode: {compaction_mode}\n"
        f"Failure classifier enabled: {failure_classifier_enabled}\n"
        f"Failure classifier min confidence: {failure_classifier_conf}\n"
        f"Failure classifier require model decision: {failure_classifier_model_only}\n"
        f"Critic enabled: {critic_enabled}\n"
        f"Critic model: {critic_model}\n"
        f"Critic fallbacks: {', '.join(critic_fallbacks) if isinstance(critic_fallbacks, list) and critic_fallbacks else 'none'}\n"
        f"Critic response format strategy: {critic_response_strategy}\n"
        f"Critic endpoint: {critic_base}{critic_path}\n"
        f"Watchman enabled: {watchman_enabled}\n"
        f"Watch assistant turns: {watchman_turns}\n"
        f"Skip watchman during planning: {watchman_plan_skip}\n"
        f"Watchman dedupe unresolved violations: {watchman_dedupe}\n"
        f"Watchman min confidence: {watchman_min_conf}\n"
        f"Watchman require model decision: {watchman_model_only}\n"
        f"Watchman recent alerts window: {watchman_alerts}\n"
        f"Watchman post-alert action window: {watchman_post_alert_actions}\n"
        f"Research classifier enabled: {research_classifier_enabled}\n"
        f"Research classifier min confidence: {research_classifier_conf}\n"
        f"Research classifier require model decision: {research_classifier_model_only}\n"
        f"Custom rules enabled: {custom_enabled}\n"
        f"Custom escalation mode: {custom_mode}\n"
        f"Custom rule count: {custom_rules}\n"
        f"Policy file: {policy_path}\n"
        f"Watchman prompt file: {watchman_prompt_path}\n"
        f"Failure policy file: {failure_policy_path}\n"
        f"Research policy file: {research_policy_path}\n"
        f"Runtime file (project): {runtime_path}\n"
        f"Runtime file (global): {global_runtime_path}\n"
        f"Agent guide: {guide_path}"
    )
    console.print(Panel(Text(status_text), title="Law Enforcer Status", border_style="blue"))


@law.command("watch")
@click.option("-n", "--lines", default=20, show_default=True, type=int, help="Number of recent watchman events to show")
@click.option("-f", "--follow", is_flag=True, help="Follow log output live")
@click.option("--include-interrupts", is_flag=True, help="Include law.interrupt.* events")
@click.option("--path", "trace_path_opt", type=click.Path(path_type=Path), help="Path to trace file")
def law_watch(lines: int, follow: bool, include_interrupts: bool, trace_path_opt: Optional[Path]):
    """Show formatted watchman request/response logs (chat-style)."""
    _law_watch_impl(lines=lines, follow=follow, include_interrupts=include_interrupts, trace_path_opt=trace_path_opt)


def _law_watch_impl(lines: int, follow: bool, include_interrupts: bool, trace_path_opt: Optional[Path]) -> None:
    """Internal watch renderer shared by `law watch` and `io`."""
    lines = max(1, lines)

    if trace_path_opt:
        trace_path = trace_path_opt
    else:
        law_data: Dict = {}
        law_path = _resolve_law_path(None)
        if law_path.exists():
            try:
                law_data = _read_law_file(law_path)
            except Exception:
                law_data = {}
        trace_path = _resolve_trace_path_from_law_data(law_data)

    if not trace_path.exists():
        console.print(f"[red]Trace file not found:[/red] {trace_path}")
        console.print("[yellow]Run OpenCode with OpenContext plugin enabled, then try again.[/yellow]")
        raise click.Abort()

    def should_show(event_type: str) -> bool:
        if event_type in {"watchman.request", "watchman.response"}:
            return True
        return include_interrupts and event_type in {"law.interrupt.request", "law.interrupt.injected"}

    def parse_line(raw_line: str) -> Optional[Dict]:
        raw_line = raw_line.strip()
        if not raw_line:
            return None
        try:
            event = json.loads(raw_line)
        except Exception:
            return None
        if not isinstance(event, dict):
            return None
        if not should_show(str(event.get("type", ""))):
            return None
        return event

    def print_event(event: Dict):
        rendered = _render_watchman_event(event, include_interrupts=include_interrupts)
        if not rendered:
            return
        console.print(Panel(Text(rendered["body"]), title=rendered["title"], border_style=rendered["style"]))

    with trace_path.open("r", encoding="utf-8", errors="replace") as f:
        initial_events = deque(maxlen=lines)
        for raw in f:
            event = parse_line(raw)
            if event:
                initial_events.append(event)
        for event in initial_events:
            print_event(event)

        if not follow:
            if not initial_events:
                console.print("[yellow]No watchman events found yet.[/yellow]")
            return

        console.print(f"[blue]Following watchman events from:[/blue] {trace_path}")
        console.print("[dim]Press Ctrl+C to stop.[/dim]")
        try:
            while True:
                raw = f.readline()
                if not raw:
                    time.sleep(0.4)
                    continue
                event = parse_line(raw)
                if event:
                    print_event(event)
        except KeyboardInterrupt:
            console.print("\n[dim]Stopped.[/dim]")
            return


@cli.command("io")
@click.option("-n", "--lines", default=20, show_default=True, type=int, help="Number of recent watchman events to show")
@click.option("-f", "--follow", is_flag=True, default=True, show_default=True, help="Follow log output live")
@click.option("--include-interrupts", is_flag=True, help="Include law.interrupt.* events")
@click.option("--path", "trace_path_opt", type=click.Path(path_type=Path), help="Path to trace file")
def io_watch(lines: int, follow: bool, include_interrupts: bool, trace_path_opt: Optional[Path]):
    """Shortcut for watching formatted watchman I/O."""
    _law_watch_impl(lines=lines, follow=follow, include_interrupts=include_interrupts, trace_path_opt=trace_path_opt)


@law.command("doctor")
@click.option("--path", "law_path_opt", type=click.Path(path_type=Path), help="Path to law JSON/YAML file")
def law_doctor(law_path_opt: Optional[Path]):
    """Run end-to-end health checks for Law Enforcer setup."""
    results: List[Dict[str, str]] = []

    def add(level: str, check: str, detail: str):
        results.append({"level": level, "check": check, "detail": detail})

    gcc_dir = Path.cwd() / ".GCC"
    if gcc_dir.exists():
        add("PASS", "GCC initialized", str(gcc_dir))
    else:
        add("FAIL", "GCC initialized", "Missing .GCC (run: opencontext init)")

    law_path = _resolve_law_path(law_path_opt)
    law_data: Dict = {}
    if law_path.exists():
        try:
            law_data = _read_law_file(law_path)
            add("PASS", "Law file readable", str(law_path))
            validation_errors = _validate_law_content(law_data)
            if validation_errors:
                add("FAIL", "Law schema validation", "; ".join(validation_errors[:5]))
            else:
                add("PASS", "Law schema validation", "ok")
        except Exception as e:
            add("FAIL", "Law file readable", f"{law_path} ({e})")
            law_data = {}
    else:
        add("FAIL", "Law file exists", f"Missing {law_path} (run: opencontext law init)")

    policy_path = _resolve_policy_path_from_law_data(law_data)
    add("PASS" if policy_path.exists() else "WARN", "Policy file", str(policy_path))

    watchman_prompt_name = law_data.get("watchman", {}).get("systemPromptFile", LAW_WATCHMAN_PROMPT_FILENAME)
    watchman_prompt_path = Path(watchman_prompt_name)
    if not watchman_prompt_path.is_absolute():
        watchman_prompt_path = Path.cwd() / ".GCC" / watchman_prompt_name
    add("PASS" if watchman_prompt_path.exists() else "WARN", "Watchman system prompt", str(watchman_prompt_path))

    failure_policy_name = law_data.get("gcc", {}).get("failureLookupPolicyFile", LAW_FAILURE_POLICY_FILENAME)
    failure_policy_path = Path(failure_policy_name)
    if not failure_policy_path.is_absolute():
        failure_policy_path = Path.cwd() / ".GCC" / failure_policy_name
    add("PASS" if failure_policy_path.exists() else "WARN", "Failure lookup policy", str(failure_policy_path))

    research_policy_name = law_data.get("research", {}).get("capturePolicyFile", LAW_RESEARCH_POLICY_FILENAME)
    research_policy_path = Path(research_policy_name)
    if not research_policy_path.is_absolute():
        research_policy_path = Path.cwd() / ".GCC" / research_policy_name
    add("PASS" if research_policy_path.exists() else "WARN", "Research capture policy", str(research_policy_path))

    trace_name = law_data.get("observability", {}).get("traceFile", "law-enforcer-trace.jsonl")
    trace_path = Path.cwd() / ".GCC" / trace_name
    if gcc_dir.exists():
        try:
            trace_path.parent.mkdir(parents=True, exist_ok=True)
            trace_path.touch(exist_ok=True)
            add("PASS", "Trace file writable", str(trace_path))
        except Exception as e:
            add("FAIL", "Trace file writable", f"{trace_path} ({e})")

    runtime_project = _law_runtime_path()
    runtime_global = Path.home() / ".config" / "opencontext" / LAW_RUNTIME_FILENAME
    add("PASS" if runtime_project.exists() else "WARN", "Project runtime config", str(runtime_project))
    add("PASS" if runtime_global.exists() else "WARN", "Global runtime config", str(runtime_global))

    # CLI capability probe for compatibility with plugin suggestions.
    try:
        proc = subprocess.run(
            ["opencontext", "context", "--help"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        help_text = (proc.stdout or "") + "\n" + (proc.stderr or "")
        if proc.returncode == 0:
            add("PASS", "opencontext context command", "help available")
            add("PASS" if "--search" in help_text else "FAIL", "Context search support", "--search")
            add("PASS" if "--log" in help_text else "FAIL", "Context log support", "--log")
            add("PASS" if "--limit" in help_text else "WARN", "Context limit support", "--limit")
        else:
            add("FAIL", "opencontext context command", "failed to run --help")
    except Exception as e:
        add("FAIL", "opencontext context command", str(e))

    global_plugin = Path.home() / ".config" / "opencode" / "plugins" / "opencontext-reminder.js"
    project_plugin = Path.cwd() / ".opencode" / "plugins" / "opencontext-reminder.js"
    if global_plugin.exists() or project_plugin.exists():
        add(
            "PASS",
            "OpenCode plugin install",
            f"global={global_plugin.exists()} project={project_plugin.exists()}",
        )
    else:
        add("WARN", "OpenCode plugin install", "Not found in global/project plugin paths")

    critic = law_data.get("critic", {}) if isinstance(law_data, dict) else {}
    api_key_env = critic.get("apiKeyEnv", "CHUTES_API_KEY")
    env_names: List[str] = []
    if isinstance(api_key_env, str) and api_key_env.strip():
        env_names.append(api_key_env.strip())
    elif isinstance(api_key_env, list):
        env_names.extend([str(v).strip() for v in api_key_env if str(v).strip()])
    env_names.extend(["CHUTES_API_KEY", "OPENAI_API_KEY", "OPENCONTEXT_LAW_API_KEY"])
    env_names = list(dict.fromkeys(env_names))

    project_runtime_critic = _read_runtime_critic(runtime_project)
    global_runtime_critic = _read_runtime_critic(runtime_global)

    api_key_source = ""
    for name in env_names:
        if isinstance(name, str) and name and os.environ.get(name, "").strip():
            api_key_source = f"env:{name}"
            break
    if not api_key_source:
        project_key = str(project_runtime_critic.get("apiKey", "")).strip()
        global_key = str(global_runtime_critic.get("apiKey", "")).strip()
        static_key = str(critic.get("apiKey", "")).strip() if isinstance(critic, dict) else ""
        if project_key:
            api_key_source = f"project_runtime:{runtime_project}"
        elif global_key:
            api_key_source = f"global_runtime:{runtime_global}"
        elif static_key:
            api_key_source = "law_file:critic.apiKey"
    if api_key_source:
        add("PASS", "Critic API key resolution", api_key_source)
    else:
        add("WARN", "Critic API key resolution", "No API key found via env/runtime/law file")

    fail_count = sum(1 for r in results if r["level"] == "FAIL")
    warn_count = sum(1 for r in results if r["level"] == "WARN")
    pass_count = sum(1 for r in results if r["level"] == "PASS")

    lines = [f"[{r['level']}] {r['check']}: {r['detail']}" for r in results]
    summary = f"PASS={pass_count}  WARN={warn_count}  FAIL={fail_count}"
    border = "green" if fail_count == 0 else "red"
    console.print(
        Panel(
            Text(summary + "\n\n" + "\n".join(lines)),
            title="Law Enforcer Doctor",
            border_style=border,
        )
    )

    if fail_count > 0:
        raise click.Abort()


@law.command("guide")
def law_guide():
    """Regenerate .GCC/AGENT_GUIDE.txt based on current law paths."""
    gcc_dir = Path.cwd() / ".GCC"
    if not gcc_dir.exists():
        console.print("[red]Error: GCC not initialized. Run 'opencontext init' first.[/red]")
        raise click.Abort()

    law_path = _resolve_law_path()
    law_data = {}
    if law_path.exists():
        try:
            law_data = _read_law_file(law_path)
        except Exception:
            law_data = {}
    policy_path = _resolve_policy_path_from_law_data(law_data)
    policy_path.parent.mkdir(parents=True, exist_ok=True)
    if not policy_path.exists():
        policy_path.write_text(_default_law_policy_text(), encoding="utf-8")
        console.print(f"[yellow]Policy file was missing and has been created:[/yellow] {policy_path}")

    runtime_path = _law_runtime_path()
    if not runtime_path.exists():
        runtime_path.write_text(
            json.dumps(_default_law_runtime_config(), indent=2) + "\n",
            encoding="utf-8",
        )
        console.print(f"[yellow]Runtime config was missing and has been created:[/yellow] {runtime_path}")

    watchman_prompt_path = _resolve_watchman_prompt_path_from_law_data(law_data)
    if not watchman_prompt_path.exists():
        watchman_prompt_path.write_text(_default_watchman_system_prompt_text(), encoding="utf-8")
        console.print(f"[yellow]Watchman system prompt was missing and has been created:[/yellow] {watchman_prompt_path}")

    failure_policy_path = _resolve_failure_policy_path_from_law_data(law_data)
    if not failure_policy_path.exists():
        failure_policy_path.write_text(_default_failure_policy_text(), encoding="utf-8")
        console.print(f"[yellow]Failure policy file was missing and has been created:[/yellow] {failure_policy_path}")

    research_policy_path = _resolve_research_policy_path_from_law_data(law_data)
    if not research_policy_path.exists():
        research_policy_path.write_text(_default_research_policy_text(), encoding="utf-8")
        console.print(f"[yellow]Research policy file was missing and has been created:[/yellow] {research_policy_path}")

    guide_path = _agent_guide_path()
    guide_path.write_text(
        _render_agent_guide_text(
            law_path=law_path,
            policy_path=policy_path,
            watchman_prompt_path=watchman_prompt_path,
            failure_policy_path=failure_policy_path,
            research_policy_path=research_policy_path,
            runtime_path=runtime_path,
            global_runtime_path=Path.home() / ".config" / "opencontext" / LAW_RUNTIME_FILENAME,
        ),
        encoding="utf-8",
    )
    console.print(f"[green]✓ Agent guide generated:[/green] {guide_path}")


@cli.command('setup-opencode')
@click.option('--global', 'global_install', is_flag=True, help='Install globally for all projects')
def setup_opencode(global_install: bool):
    """Setup OpenCode integration (plugin and skill).
    
    Installs the OpenCode plugin and skill for automatic context management.
    """
    import shutil
    import opencontext
    
    # Get plugin and skill source paths
    package_dir = Path(opencontext.__file__).parent
    plugin_source = package_dir / "plugin" / "opencontext-reminder.js"
    skill_source = package_dir.parent / "docs" / "SKILL.md"
    runtime_source = package_dir / "plugin" / LAW_RUNTIME_FILENAME
    
    if not plugin_source.exists():
        console.print("[red]Error: Plugin source not found[/red]")
        raise click.Abort()
    
    try:
        if global_install:
            # Install globally
            opencode_config = Path.home() / ".config" / "opencode"
            opencontext_config = Path.home() / ".config" / "opencontext"
            
            # Plugin
            plugin_dir = opencode_config / "plugins"
            plugin_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(plugin_source, plugin_dir / "opencontext-reminder.js")
            console.print(f"[green]✓ Plugin installed globally: {plugin_dir}[/green]")
            
            # Skill
            skill_dir = opencode_config / "skills" / "opencontext"
            skill_dir.mkdir(parents=True, exist_ok=True)
            if skill_source.exists():
                shutil.copy2(skill_source, skill_dir / "SKILL.md")
                console.print(f"[green]✓ Skill installed globally: {skill_dir}[/green]")

            opencontext_config.mkdir(parents=True, exist_ok=True)
            runtime_target = opencontext_config / LAW_RUNTIME_FILENAME
            if not runtime_target.exists():
                if runtime_source.exists():
                    shutil.copy2(runtime_source, runtime_target)
                else:
                    runtime_target.write_text(
                        json.dumps(_default_law_runtime_config(), indent=2) + "\n",
                        encoding="utf-8",
                    )
                console.print(f"[green]✓ Runtime config initialized: {runtime_target}[/green]")
            elif runtime_target.exists():
                console.print(f"[blue]ℹ Runtime config already exists: {runtime_target}[/blue]")
        else:
            # Install in current directory (project-level)
            opencode_dir = Path.cwd() / ".opencode"
            
            # Plugin
            plugin_dir = opencode_dir / "plugins"
            plugin_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(plugin_source, plugin_dir / "opencontext-reminder.js")
            console.print(f"[green]✓ Plugin installed in project: {plugin_dir}[/green]")

            # Skill (project-level)
            skill_dir = opencode_dir / "skills" / "opencontext"
            skill_dir.mkdir(parents=True, exist_ok=True)
            if skill_source.exists():
                shutil.copy2(skill_source, skill_dir / "SKILL.md")
                console.print(f"[green]✓ Skill installed in project: {skill_dir}[/green]")

            # Law template in .GCC if project is initialized
            gcc_dir = Path.cwd() / ".GCC"
            if gcc_dir.exists():
                assets = _ensure_law_assets(force=False)
                console.print(f"[green]✓ Law file:[/green] {assets.get('law', '')}")
                console.print(f"[green]✓ Policy file:[/green] {assets.get('policy', '')}")
                console.print(f"[green]✓ Watchman prompt:[/green] {assets.get('watchman_prompt', '')}")
                console.print(f"[green]✓ Failure policy:[/green] {assets.get('failure_policy', '')}")
                console.print(f"[green]✓ Research policy:[/green] {assets.get('research_policy', '')}")
                console.print(f"[green]✓ Runtime config:[/green] {assets.get('runtime', '')}")
                console.print(f"[green]✓ Agent guide:[/green] {assets.get('guide', '')}")
            elif not gcc_dir.exists():
                console.print("[yellow]ℹ GCC not initialized yet. After 'opencontext init', run 'opencontext law init'.[/yellow]")
            
            console.print("\n[yellow]Note:[/yellow] For global installation (all projects), run:")
            console.print("  opencontext setup-opencode --global")
        
        console.print("\n[blue]OpenCode integration ready![/blue]")
        console.print("The plugin now enforces GCC/MCP/research workflow continuously.")
        
    except Exception as e:
        console.print(f"[red]Error setting up OpenCode integration: {e}[/red]")
        raise click.Abort()


if __name__ == '__main__':
    cli()
