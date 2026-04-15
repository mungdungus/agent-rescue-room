"""
Agent Rescue Room — Tools

File-reading tools for the grounding engine.
These let the LLM inspect the customer's agent repo to map failures to source code.
"""

import os
from pathlib import Path

from langchain_core.tools import tool


@tool
def read_repo_file(repo_path: str, file_path: str) -> str:
    """Read a file from the agent repository.

    Args:
        repo_path: Base path to the repository directory
        file_path: Relative path to the file within the repo
    """
    full_path = Path(repo_path) / file_path

    # Security: don't allow path traversal outside repo
    try:
        full_path = full_path.resolve()
        repo_resolved = Path(repo_path).resolve()
        if not str(full_path).startswith(str(repo_resolved)):
            return f"Error: path traversal blocked: {file_path}"
    except Exception:
        return f"Error: invalid path: {file_path}"

    if not full_path.exists():
        return f"Error: file not found: {file_path}"

    content = full_path.read_text()
    if len(content) > 4000:
        content = content[:4000] + f"\n\n... [TRUNCATED — {len(content)} total chars]"

    # Add line numbers
    numbered = []
    for i, line in enumerate(content.split("\n"), 1):
        numbered.append(f"{i:4d} | {line}")

    return f"--- {file_path} ---\n" + "\n".join(numbered)


@tool
def list_repo_files(repo_path: str) -> str:
    """List all files in the agent repository.

    Args:
        repo_path: Base path to the repository directory
    """
    repo = Path(repo_path)
    if not repo.exists():
        return f"Error: repo not found: {repo_path}"

    files = []
    for f in sorted(repo.rglob("*")):
        if f.is_file() and not f.name.startswith("."):
            rel = f.relative_to(repo)
            size = f.stat().st_size
            files.append(f"  {rel} ({size} bytes)")

    return f"Repository: {repo_path}\nFiles ({len(files)}):\n" + "\n".join(files)


GROUNDING_TOOLS = [read_repo_file, list_repo_files]
