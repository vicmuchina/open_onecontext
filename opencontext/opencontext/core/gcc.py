"""Git Context Controller (GCC) core implementation.

This module implements the GCC paper's context management system:
- COMMIT: Checkpoint meaningful progress
- BRANCH: Explore alternatives in isolation
- MERGE: Synthesize divergent paths
- CONTEXT: Retrieve history at any granularity
"""

import hashlib
import os
import subprocess
from datetime import timezone
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from git import Repo


class GCC:
    """Git Context Controller for managing LLM agent context."""

    def __init__(self, project_root: Optional[Path] = None):
        """Initialize GCC.
        
        Args:
            project_root: Root directory of the project. Defaults to current directory.
        """
        self.project_root = Path(project_root) if project_root else Path.cwd()
        self.gcc_dir = self.project_root / ".GCC"
        self.current_branch_file = self.gcc_dir / ".current_branch"
        self.main_file = self.gcc_dir / "main.md"
        self.evolution_file = self.gcc_dir / "evolution.yaml"

    def _get_current_branch(self) -> str:
        """Get the name of the current active branch."""
        if self.current_branch_file.exists():
            return self.current_branch_file.read_text().strip()
        return "main"

    def _set_current_branch(self, branch_name: str) -> None:
        """Set the current active branch."""
        self.current_branch_file.write_text(branch_name)

    def _get_branch_dir(self, branch_name: Optional[str] = None) -> Path:
        """Get the directory for a branch."""
        branch = branch_name or self._get_current_branch()
        return self.gcc_dir / "branches" / branch

    def _generate_hash(self, content: str) -> str:
        """Generate a short hash for commits."""
        return hashlib.sha1(content.encode()).hexdigest()[:7]

    def _default_goal_text(self) -> str:
        """Fallback goal text when no goal source is available."""
        return "Project goal not specified"

    def _goal_candidates(self) -> List[Path]:
        """Common spec/doc files used to infer project goal."""
        candidates = [
            "SPEC.md",
            "spec.md",
            "PROJECT_BLUEPRINT.md",
            "IMPLEMENTATION.md",
            "README.md",
            "readme.md",
        ]
        return [self.project_root / name for name in candidates]

    def _extract_goal_from_markdown(self, path: Path) -> Optional[str]:
        """Extract a concise goal statement from a markdown file."""
        if not path.exists() or not path.is_file():
            return None
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            return None

        lines = [line.strip() for line in text.splitlines()]
        lines = [line for line in lines if line]
        if not lines:
            return None

        # Prefer explicit Goal section.
        for i, line in enumerate(lines):
            if line.lower().startswith("## goal") or line.lower().startswith("# goal"):
                for j in range(i + 1, min(i + 10, len(lines))):
                    candidate = lines[j]
                    if candidate.startswith("#"):
                        break
                    if candidate:
                        return candidate[:300]

        # Otherwise use first heading body line, then first non-heading line.
        for i, line in enumerate(lines):
            if line.startswith("#"):
                for j in range(i + 1, min(i + 10, len(lines))):
                    candidate = lines[j]
                    if candidate and not candidate.startswith("#"):
                        return candidate[:300]
        for line in lines:
            if not line.startswith("#"):
                return line[:300]
        return None

    def _resolve_goal(
        self,
        goal: Optional[str],
        goal_file: Optional[Path] = None,
    ) -> str:
        """Resolve project goal using explicit text, file, or common spec files."""
        if goal and goal.strip():
            return goal.strip()

        if goal_file:
            extracted = self._extract_goal_from_markdown(Path(goal_file))
            if extracted:
                return extracted

        for candidate in self._goal_candidates():
            extracted = self._extract_goal_from_markdown(candidate)
            if extracted:
                return extracted

        return self._default_goal_text()

    def init(
        self,
        project_name: Optional[str] = None,
        goal: Optional[str] = None,
        goal_file: Optional[Path] = None,
    ) -> None:
        """Initialize GCC in the current directory.
        
        Args:
            project_name: Name of the project.
            goal: High-level project objective.
        """
        if self.gcc_dir.exists():
            raise RuntimeError(f"GCC already initialized in {self.gcc_dir}")

        # Create directory structure
        self.gcc_dir.mkdir(parents=True)
        branches_dir = self.gcc_dir / "branches"
        branches_dir.mkdir()
        main_branch_dir = branches_dir / "main"
        main_branch_dir.mkdir()

        # Set current branch
        self._set_current_branch("main")

        # Create main.md
        project_name = project_name or self.project_root.name
        goal = self._resolve_goal(goal=goal, goal_file=goal_file)
        
        main_content = f"""# Project: {project_name}

## Goal
{goal}

## Milestones
- [ ] Initial setup
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Deployment

## Current Status
Project initialized with GCC.

## Notes
Add important architectural decisions and constraints here.
"""
        self.main_file.write_text(main_content)

        # Create evolution.yaml
        evolution_content = {
            "project_name": project_name,
            "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "approaches_history": [],
            "user_sessions": [],
            "performance_trends": [],
        }
        with open(self.evolution_file, "w") as f:
            yaml.dump(evolution_content, f, default_flow_style=False)

        # Create initial branch files
        self._init_branch_files("main", goal)

        print(f"✓ Initialized GCC in {self.gcc_dir}")
        print(f"  Project: {project_name}")
        print(f"  Goal: {goal}")
        print(f"  Active branch: main")

    def _init_branch_files(self, branch_name: str, purpose: str) -> None:
        """Initialize files for a new branch."""
        branch_dir = self._get_branch_dir(branch_name)
        branch_dir.mkdir(parents=True, exist_ok=True)

        # commit.md
        commit_content = f"""## Branch Purpose
{purpose}

## Previous Progress Summary
Branch created. No previous progress.

## Commits

### init - {datetime.utcnow().isoformat()}Z
**Summary:** Branch initialization
**Files Modified:** 
**Description:** Initial creation of branch '{branch_name}'
**Status:** active
"""
        (branch_dir / "commit.md").write_text(commit_content)

        # log.md
        (branch_dir / "log.md").write_text(
            f"# Execution Log - Branch: {branch_name}\n\n## {datetime.utcnow().isoformat()}Z - Init\n"
            f"**Observation:** Branch {branch_name} created\n"
            f"**Thought:** Initializing new branch for: {purpose}\n"
            f"**Action:** Branch initialization\n"
            f"**Result:** Success\n"
        )

        # metadata.yaml
        metadata = self._generate_metadata()
        metadata["branch_name"] = branch_name
        metadata["created_at"] = datetime.utcnow().isoformat() + "Z"
        metadata["current_commit_hash"] = "init"
        
        with open(branch_dir / "metadata.yaml", "w") as f:
            yaml.dump(metadata, f, default_flow_style=False)

    def _generate_metadata(self) -> Dict[str, Any]:
        """Generate metadata for a branch."""
        metadata = {
            "branch_name": "",
            "created_at": "",
            "current_commit_hash": "",
            "file_structure": self._get_file_structure(),
            "environment": self._get_environment_info(),
            "dependencies": self._get_dependencies(),
            "approaches": [],
            "user_feedback": [],
            "performance_metrics": {},
        }
        return metadata

    def _get_file_structure(self) -> Dict[str, Any]:
        """Get the current file structure."""
        structure = {}
        try:
            for item in self.project_root.iterdir():
                if item.name.startswith(".") and item.name != ".GCC":
                    continue
                if item.is_dir():
                    structure[item.name] = [f.name for f in item.iterdir() if f.is_file()][:10]
                else:
                    structure["root"] = structure.get("root", []) + [item.name]
        except Exception:
            pass
        return structure

    def _get_environment_info(self) -> Dict[str, str]:
        """Get environment information."""
        env = {
            "platform": os.uname().sysname if hasattr(os, "uname") else "unknown",
        }
        
        # Try to get Python version
        try:
            result = subprocess.run(
                ["python", "--version"],
                capture_output=True,
                text=True
            )
            env["python_version"] = result.stdout.strip()
        except Exception:
            pass

        # Try to get Node version
        try:
            result = subprocess.run(
                ["node", "--version"],
                capture_output=True,
                text=True
            )
            env["node_version"] = result.stdout.strip()
        except Exception:
            pass

        return env

    def _get_dependencies(self) -> Dict[str, List[str]]:
        """Get project dependencies."""
        deps = {}
        
        # Python dependencies
        req_file = self.project_root / "requirements.txt"
        if req_file.exists():
            deps["python"] = [
                line.strip() for line in req_file.read_text().split("\n")
                if line.strip() and not line.startswith("#")
            ][:20]

        # Node dependencies
        package_file = self.project_root / "package.json"
        if package_file.exists():
            try:
                import json
                pkg = json.loads(package_file.read_text())
                deps["node"] = list(pkg.get("dependencies", {}).keys())[:20]
            except Exception:
                pass

        return deps

    def commit(
        self,
        summary: str,
        approach: Optional[str] = None,
        status: str = "active",
        reason: Optional[str] = None,
        performance: Optional[str] = None,
    ) -> str:
        """Create a checkpoint commit.
        
        Args:
            summary: Commit message describing what was achieved.
            approach: Name of the approach being tested.
            status: Status of the approach (active, abandoned, merged).
            reason: Reason for status (especially for abandoned).
            performance: Performance notes.
            
        Returns:
            The commit hash.
        """
        if not self.gcc_dir.exists():
            raise RuntimeError("GCC not initialized. Run 'opencontext init' first.")

        branch_name = self._get_current_branch()
        branch_dir = self._get_branch_dir()
        
        # Generate commit hash
        commit_hash = self._generate_hash(f"{branch_name}:{summary}:{datetime.utcnow().isoformat()}")
        timestamp = datetime.utcnow().isoformat() + "Z"

        # Update commit.md
        commit_file = branch_dir / "commit.md"
        existing_content = commit_file.read_text() if commit_file.exists() else ""
        
        # Extract previous progress summary (simplified)
        new_commit_entry = f"""
### {commit_hash} - {timestamp}
**Summary:** {summary}
**Files Modified:** (see git diff)
**Description:** {summary}
**Approach:** {approach or "N/A"}
**Status:** {status}
**Performance:** {performance or "N/A"}
"""
        
        commit_file.write_text(existing_content + new_commit_entry)

        # Update metadata.yaml
        metadata_file = branch_dir / "metadata.yaml"
        if metadata_file.exists():
            with open(metadata_file) as f:
                metadata = yaml.safe_load(f) or {}
            
            metadata["current_commit_hash"] = commit_hash
            metadata["file_structure"] = self._get_file_structure()
            
            if approach:
                # Update or add approach
                approaches = metadata.get("approaches", [])
                approach_entry = {
                    "name": approach,
                    "status": status,
                    "commit_hash": commit_hash,
                }
                if reason:
                    approach_entry["reason"] = reason
                if performance:
                    approach_entry["performance_note"] = performance
                
                # Update existing or append
                found = False
                for i, a in enumerate(approaches):
                    if a.get("name") == approach:
                        approaches[i] = approach_entry
                        found = True
                        break
                if not found:
                    approaches.append(approach_entry)
                
                metadata["approaches"] = approaches
            
            with open(metadata_file, "w") as f:
                yaml.dump(metadata, f, default_flow_style=False)

        # Update evolution.yaml if approach provided
        if approach:
            self._update_evolution(approach, status, reason, commit_hash)

        # Create git commit
        self._create_git_commit(f"[GCC] {summary}")

        print(f"✓ Committed: {commit_hash}")
        print(f"  Summary: {summary}")
        print(f"  Branch: {branch_name}")
        if approach:
            print(f"  Approach: {approach} ({status})")

        return commit_hash

    def _update_evolution(
        self,
        approach: str,
        status: str,
        reason: Optional[str],
        commit_hash: str,
    ) -> None:
        """Update evolution.yaml with approach information."""
        if not self.evolution_file.exists():
            return

        with open(self.evolution_file) as f:
            evolution = yaml.safe_load(f) or {}

        approaches_history = evolution.get("approaches_history", [])
        
        # Find or create approach entry
        found = False
        for entry in approaches_history:
            if entry.get("name") == approach:
                entry["commits"] = entry.get("commits", []) + [commit_hash]
                entry["outcome"] = status
                if reason and status == "abandoned":
                    entry["reason"] = reason
                found = True
                break

        if not found:
            approaches_history.append({
                "name": approach,
                "timeline": f"{datetime.utcnow().isoformat()}Z",
                "description": f"Approach: {approach}",
                "commits": [commit_hash],
                "outcome": status,
            })

        evolution["approaches_history"] = approaches_history

        with open(self.evolution_file, "w") as f:
            yaml.dump(evolution, f, default_flow_style=False)

    def _create_git_commit(self, message: str) -> None:
        """Create a git commit with the given message."""
        try:
            repo = Repo(self.project_root)
            if repo.is_dirty() or repo.untracked_files:
                repo.git.add(".GCC/")
                repo.index.commit(message)
        except Exception:
            # Git not initialized or other error - continue without git commit
            pass

    def branch(self, name: str) -> None:
        """Create a new branch.
        
        Args:
            name: Name of the new branch.
        """
        if not self.gcc_dir.exists():
            raise RuntimeError("GCC not initialized. Run 'opencontext init' first.")

        branch_dir = self._get_branch_dir(name)
        if branch_dir.exists():
            raise RuntimeError(f"Branch '{name}' already exists")

        # Copy current metadata as baseline
        current_branch = self._get_current_branch()
        current_metadata = self._get_branch_dir() / "metadata.yaml"
        
        # Create branch
        purpose = f"Exploring alternative approach: {name}"
        self._init_branch_files(name, purpose)
        
        # Copy metadata if exists
        if current_metadata.exists():
            with open(current_metadata) as f:
                metadata = yaml.safe_load(f)
            metadata["branch_name"] = name
            metadata["parent_branch"] = current_branch
            with open(branch_dir / "metadata.yaml", "w") as f:
                yaml.dump(metadata, f, default_flow_style=False)

        # Switch to new branch
        self._set_current_branch(name)

        print(f"✓ Created branch: {name}")
        print(f"  Based on: {current_branch}")
        print(f"  Purpose: {purpose}")

    def switch(self, name: str) -> None:
        """Switch to a different branch.
        
        Args:
            name: Name of the branch to switch to.
        """
        branch_dir = self._get_branch_dir(name)
        if not branch_dir.exists():
            raise RuntimeError(f"Branch '{name}' does not exist")

        self._set_current_branch(name)
        print(f"✓ Switched to branch: {name}")

    def merge(self, branch_name: str) -> None:
        """Merge a branch into the current branch.
        
        Args:
            branch_name: Name of the branch to merge.
        """
        if not self.gcc_dir.exists():
            raise RuntimeError("GCC not initialized. Run 'opencontext init' first.")

        source_branch = self._get_branch_dir(branch_name)
        if not source_branch.exists():
            raise RuntimeError(f"Branch '{branch_name}' does not exist")

        current_branch = self._get_current_branch()
        if branch_name == current_branch:
            raise RuntimeError("Cannot merge branch into itself")

        target_branch = self._get_branch_dir()

        # Read source commit.md
        source_commit_file = source_branch / "commit.md"
        if source_commit_file.exists():
            source_commits = source_commit_file.read_text()

        # Merge commits into target
        target_commit_file = target_branch / "commit.md"
        existing_content = target_commit_file.read_text() if target_commit_file.exists() else ""
        
        merged_content = f"""{existing_content}

## Merge: {branch_name}
{source_commits}
"""
        target_commit_file.write_text(merged_content)

        # Update main.md
        if self.main_file.exists():
            main_content = self.main_file.read_text()
            merge_note = f"\n\n## Merge ({datetime.utcnow().isoformat()}Z)\n"
            f"Merged branch '{branch_name}' into '{current_branch}'"
            self.main_file.write_text(main_content + merge_note)

        # Create git commit
        self._create_git_commit(f"[GCC] Merge branch '{branch_name}'")

        print(f"✓ Merged branch: {branch_name}")
        print(f"  Into: {current_branch}")

    def context(
        self,
        branch: Optional[str] = None,
        commit: Optional[str] = None,
        log: bool = False,
        lines: int = 20,
        metadata_key: Optional[str] = None,
    ) -> str:
        """Retrieve context at varying granularity.
        
        Args:
            branch: Show specific branch context.
            commit: Show specific commit details.
            log: Show execution log.
            lines: Number of log lines to show.
            metadata_key: Show specific metadata segment.
            
        Returns:
            Context information as string.
        """
        if not self.gcc_dir.exists():
            return "GCC not initialized in this directory."

        target_branch = branch or self._get_current_branch()
        branch_dir = self._get_branch_dir(target_branch)

        if not branch_dir.exists():
            return f"Branch '{target_branch}' does not exist."

        # Show specific commit
        if commit:
            commit_file = branch_dir / "commit.md"
            if commit_file.exists():
                content = commit_file.read_text()
                # Find the commit section
                for section in content.split("###"):
                    if section.strip().startswith(commit):
                        return f"###{section}"
            return f"Commit '{commit}' not found."

        # Show log
        if log:
            log_file = branch_dir / "log.md"
            if log_file.exists():
                content = log_file.read_text()
                lines_list = content.split("\n")
                return "\n".join(lines_list[-lines:])
            return "No log available."

        # Show metadata segment
        if metadata_key:
            metadata_file = branch_dir / "metadata.yaml"
            if metadata_file.exists():
                with open(metadata_file) as f:
                    metadata = yaml.safe_load(f)
                return str(metadata.get(metadata_key, "Key not found"))
            return "No metadata available."

        # Show branch context (default)
        commit_file = branch_dir / "commit.md"
        if commit_file.exists():
            content = commit_file.read_text()
            # Show branch purpose and recent commits
            lines_list = content.split("\n")
            result = []
            in_commits = False
            commit_count = 0
            for line in lines_list:
                if "## Branch Purpose" in line or "## Previous Progress" in line:
                    result.append(line)
                elif "## Commits" in line:
                    result.append(line)
                    in_commits = True
                elif in_commits:
                    if line.startswith("###"):
                        commit_count += 1
                        if commit_count <= 5:  # Show last 5 commits
                            result.append(line)
                    elif commit_count <= 5:
                        result.append(line)
            return "\n".join(result)

        return "No context available."

    def status(self) -> str:
        """Get current status.
        
        Returns:
            Status information as string.
        """
        if not self.gcc_dir.exists():
            return "GCC not initialized. Run 'opencontext init' first."

        branch = self._get_current_branch()
        branch_dir = self._get_branch_dir()

        lines = [
            f"Current branch: {branch}",
            f"GCC directory: {self.gcc_dir}",
        ]

        # Get last commit
        commit_file = branch_dir / "commit.md"
        if commit_file.exists():
            content = commit_file.read_text()
            # Find last commit hash
            for line in reversed(content.split("\n")):
                if line.startswith("###"):
                    parts = line.replace("###", "").strip().split(" - ")
                    if len(parts) >= 2:
                        lines.append(f"Last commit: {parts[0]} - {parts[1]}")
                    break

        # Count branches
        branches_dir = self.gcc_dir / "branches"
        if branches_dir.exists():
            branches = [d.name for d in branches_dir.iterdir() if d.is_dir()]
            lines.append(f"Total branches: {len(branches)}")

        return "\n".join(lines)

    def list_branches(self) -> List[str]:
        """List all branches.
        
        Returns:
            List of branch names.
        """
        if not self.gcc_dir.exists():
            return []

        branches_dir = self.gcc_dir / "branches"
        if not branches_dir.exists():
            return []

        current = self._get_current_branch()
        branches = []
        
        for branch_dir in branches_dir.iterdir():
            if branch_dir.is_dir():
                name = branch_dir.name
                marker = "*" if name == current else " "
                branches.append(f"{marker} {name}")

        return branches

    def delete_branch(self, name: str, force: bool = False) -> None:
        """Delete a branch.
        
        Args:
            name: Name of the branch to delete.
            force: Force deletion even if not merged.
        """
        if not self.gcc_dir.exists():
            raise RuntimeError("GCC not initialized.")

        if name == self._get_current_branch():
            raise RuntimeError("Cannot delete current branch. Switch to another branch first.")

        if name == "main" and not force:
            raise RuntimeError("Cannot delete 'main' branch without --force")

        branch_dir = self._get_branch_dir(name)
        if not branch_dir.exists():
            raise RuntimeError(f"Branch '{name}' does not exist.")

        import shutil
        shutil.rmtree(branch_dir)

        print(f"✓ Deleted branch: {name}")

    def add_feedback(self, feedback: str) -> None:
        """Add user feedback.
        
        Args:
            feedback: User feedback text.
        """
        if not self.gcc_dir.exists():
            raise RuntimeError("GCC not initialized.")

        if not self.evolution_file.exists():
            return

        with open(self.evolution_file) as f:
            evolution = yaml.safe_load(f) or {}

        user_sessions = evolution.get("user_sessions", [])
        
        # Add to current session
        if not user_sessions:
            user_sessions.append({
                "session_id": "current",
                "user_feedback": [],
            })

        user_sessions[-1]["user_feedback"].append({
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "feedback": feedback,
            "branch": self._get_current_branch(),
        })

        evolution["user_sessions"] = user_sessions

        with open(self.evolution_file, "w") as f:
            yaml.dump(evolution, f, default_flow_style=False)

        print(f"✓ Added feedback: {feedback[:50]}...")

    def add_benchmark(
        self,
        task: str,
        pass_rate: float,
        notes: Optional[str] = None,
    ) -> None:
        """Add benchmark results.
        
        Args:
            task: Task name (e.g., "SWE-Bench-Lite").
            pass_rate: Pass rate percentage.
            notes: Additional notes.
        """
        if not self.gcc_dir.exists():
            raise RuntimeError("GCC not initialized.")

        if not self.evolution_file.exists():
            return

        with open(self.evolution_file) as f:
            evolution = yaml.safe_load(f) or {}

        trends = evolution.get("performance_trends", [])
        trends.append({
            "date": datetime.utcnow().isoformat() + "Z",
            "task": task,
            "pass_rate": f"{pass_rate}%",
            "notes": notes or "",
        })

        evolution["performance_trends"] = trends

        with open(self.evolution_file, "w") as f:
            yaml.dump(evolution, f, default_flow_style=False)

        print(f"✓ Added benchmark: {task} - {pass_rate}%")
