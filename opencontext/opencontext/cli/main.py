#!/usr/bin/env python3
"""OpenContext CLI - Main entry point."""

from pathlib import Path
from typing import Dict, List, Optional

import click
import json
import yaml
from rich.console import Console
from rich.panel import Panel
from rich.text import Text

from opencontext.core.gcc import GCC
from opencontext.tui.dashboard import launch_dashboard

console = Console()


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
def init(project_name: Optional[str], goal: Optional[str]):
    """Initialize GCC in current directory."""
    try:
        gcc = GCC()
        gcc.init(project_name=project_name, goal=goal)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        raise click.Abort()


@cli.command()
@click.argument('summary')
@click.option('--approach', '-a', help='Name of the approach being tested')
@click.option('--status', '-s', default='active', 
              type=click.Choice(['active', 'abandoned', 'merged']),
              help='Status of the approach')
@click.option('--reason', '-r', help='Reason for status (especially abandoned)')
@click.option('--performance', '-p', help='Performance notes')
def commit(
    summary: str,
    approach: Optional[str],
    status: str,
    reason: Optional[str],
    performance: Optional[str],
):
    """Create a checkpoint commit.
    
    Example: opencontext commit "Implemented auth module"
    """
    try:
        gcc = GCC()
        gcc.commit(
            summary=summary,
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
    else:
        errors.append("gcc must be a mapping/object.")

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
    else:
        errors.append("watchman must be a mapping/object.")

    return errors


@cli.group()
def law():
    """Manage OpenContext Law Enforcer policy."""
    pass


@law.command("init")
@click.option("--force", is_flag=True, help="Overwrite existing law file")
def law_init(force: bool):
    """Create .GCC/law-enforcer.json from the packaged template."""
    import opencontext
    import shutil

    gcc_dir = Path.cwd() / ".GCC"
    if not gcc_dir.exists():
        console.print("[red]Error: GCC not initialized. Run 'opencontext init' first.[/red]")
        raise click.Abort()

    template_source = Path(opencontext.__file__).parent / "plugin" / "law-enforcer.json"
    if not template_source.exists():
        console.print("[red]Error: Law template not found in package.[/red]")
        raise click.Abort()

    law_path = _default_law_path()
    legacy_path = _legacy_law_path()
    existing_path = law_path if law_path.exists() else legacy_path if legacy_path.exists() else None
    if existing_path and not force:
        console.print(f"[yellow]Law file already exists:[/yellow] {existing_path}")
        console.print("Use --force to overwrite.")
        return

    if existing_path and force and existing_path != law_path:
        try:
            existing_path.unlink()
        except Exception:
            pass

    shutil.copy2(template_source, law_path)
    console.print(f"[green]✓ Law file initialized:[/green] {law_path}")
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
    planning_skip = law_data.get("gcc", {}).get("skipCheckpointDuringPlanningAgent", "unknown")
    critic_enabled = law_data.get("critic", {}).get("enabled", "unknown")
    critic_model = law_data.get("critic", {}).get("model", "unknown")
    critic_base = law_data.get("critic", {}).get("baseUrl", "unknown")
    critic_path = law_data.get("critic", {}).get("endpointPath", "unknown")
    watchman_enabled = law_data.get("watchman", {}).get("enabled", "unknown")
    watchman_turns = law_data.get("watchman", {}).get("inspectAssistantTurns", "unknown")
    watchman_plan_skip = law_data.get("watchman", {}).get("skipDuringPlanningAgent", "unknown")

    status_text = (
        f"Path: {law_path}\n"
        f"Mode: {mode}\n"
        f"Checkpoint cadence: {checkpoint}\n"
        f"Skip checkpoint during planning: {planning_skip}\n"
        f"Critic enabled: {critic_enabled}\n"
        f"Critic model: {critic_model}\n"
        f"Critic endpoint: {critic_base}{critic_path}\n"
        f"Watchman enabled: {watchman_enabled}\n"
        f"Watch assistant turns: {watchman_turns}\n"
        f"Skip watchman during planning: {watchman_plan_skip}"
    )
    console.print(Panel(Text(status_text), title="Law Enforcer Status", border_style="blue"))


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
    law_source = package_dir / "plugin" / "law-enforcer.json"
    skill_source = package_dir.parent / "docs" / "SKILL.md"
    
    if not plugin_source.exists():
        console.print("[red]Error: Plugin source not found[/red]")
        raise click.Abort()
    
    try:
        if global_install:
            # Install globally
            opencode_config = Path.home() / ".config" / "opencode"
            
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
            law_target = gcc_dir / "law-enforcer.json"
            if gcc_dir.exists() and law_source.exists() and not law_target.exists():
                shutil.copy2(law_source, law_target)
                console.print(f"[green]✓ Law file initialized: {law_target}[/green]")
            elif gcc_dir.exists() and law_target.exists():
                console.print(f"[blue]ℹ Law file already exists: {law_target}[/blue]")
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
