#!/usr/bin/env python3
"""OpenContext CLI - Main entry point."""

from pathlib import Path
from typing import Optional

import click
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


if __name__ == '__main__':
    cli()
