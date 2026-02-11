"""Rich-based TUI Dashboard for OpenContext."""

from pathlib import Path
from typing import Optional

from rich.console import Console
from rich.layout import Layout
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.tree import Tree

from opencontext.core.gcc import GCC

console = Console()


def launch_dashboard(theme: str = "dark") -> None:
    """Launch the TUI dashboard.
    
    Args:
        theme: Color theme ('dark' or 'light').
    """
    try:
        gcc = GCC()
        
        if not gcc.gcc_dir.exists():
            console.print("[red]Error: GCC not initialized. Run 'opencontext init' first.[/red]")
            return
        
        # Simple dashboard implementation
        console.clear()
        
        # Header
        header = Panel(
            Text("OpenContext Dashboard", style="bold cyan", justify="center"),
            border_style="cyan"
        )
        console.print(header)
        console.print()
        
        # Current status
        status = gcc.status()
        console.print(Panel(status, title="Status", border_style="green"))
        console.print()
        
        # Branches
        branches = gcc.list_branches()
        if branches:
            branch_table = Table(title="Branches", show_header=True, header_style="bold magenta")
            branch_table.add_column("Branch", style="cyan")
            
            for branch in branches:
                branch_table.add_row(branch)
            
            console.print(branch_table)
            console.print()
        
        # Recent commits
        current_branch = gcc._get_current_branch()
        branch_dir = gcc._get_branch_dir()
        commit_file = branch_dir / "commit.md"
        
        if commit_file.exists():
            commits_table = Table(title=f"Recent Commits ({current_branch})", show_header=True, header_style="bold yellow")
            commits_table.add_column("Hash", style="cyan", width=10)
            commits_table.add_column("Timestamp", style="dim", width=20)
            commits_table.add_column("Summary", style="white")
            
            content = commit_file.read_text()
            lines = content.split("\n")
            
            for i, line in enumerate(lines):
                if line.startswith("###"):
                    parts = line.replace("###", "").strip().split(" - ")
                    if len(parts) >= 2:
                        commit_hash = parts[0].strip()
                        timestamp = parts[1].strip()
                        
                        # Find summary in next lines
                        summary = ""
                        for j in range(i+1, min(i+5, len(lines))):
                            if lines[j].startswith("**Summary:**"):
                                summary = lines[j].replace("**Summary:**", "").strip()
                                break
                        
                        commits_table.add_row(commit_hash, timestamp, summary)
            
            console.print(commits_table)
            console.print()
        
        # Evolution
        if gcc.evolution_file.exists():
            import yaml
            with open(gcc.evolution_file) as f:
                evolution = yaml.safe_load(f) or {}
            
            approaches = evolution.get("approaches_history", [])
            if approaches:
                evolution_table = Table(title="Approach Evolution", show_header=True, header_style="bold blue")
                evolution_table.add_column("Approach", style="cyan")
                evolution_table.add_column("Status", style="white")
                evolution_table.add_column("Outcome", style="dim")
                
                for approach in approaches:
                    name = approach.get("name", "Unknown")
                    status = approach.get("outcome", "unknown")
                    outcome = approach.get("reason", "")
                    
                    # Color code status
                    if status == "abandoned":
                        status_str = f"[red]{status}[/red]"
                    elif status == "active":
                        status_str = f"[green]{status}[/green]"
                    elif status == "merged":
                        status_str = f"[blue]{status}[/blue]"
                    else:
                        status_str = status
                    
                    evolution_table.add_row(name, status_str, outcome)
                
                console.print(evolution_table)
                console.print()
        
        # Footer
        footer = Panel(
            Text("Press Ctrl+C to exit", style="dim", justify="center"),
            border_style="dim"
        )
        console.print(footer)
        
    except KeyboardInterrupt:
        console.print("\n[yellow]Dashboard closed.[/yellow]")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
