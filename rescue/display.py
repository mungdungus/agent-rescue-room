"""
Agent Rescue Room — Rich Display Module

LangChain AI Platform electric-cyan palette on dark-navy canvas. Primary
accent is brand cyan (#00BFFF). Body text follows the #93B3B3 → #666666 →
#333333 gray hierarchy from the design handoff guide. Rounded panel borders
approximate the platform's 8px border-radius. Original constant names
(EMERALD, SLATE, CORAL, ...) are retained as aliases for __main__.py
backward compatibility.
"""

from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.theme import Theme

# LangChain AI Platform palette
ACCENT = "#00BFFF"       # electric cyan — primary brand accent
ACCENT_SOFT = "#7EDAFF"  # lighter cyan — completion moments
INFO = "#5EC7E8"         # informational cyan
BLUE_VIOLET = "#8BA7FF"  # LangGraph-style blue-violet, plays with cyan
MIST = "#93B3B3"         # light gray — body text
SUBTLE = "#666666"       # subtle gray — metadata, labels
MUTED = "#333333"        # muted gray — separators, ghost text
SNOW_WHITE = "#E6F3FF"   # near-white cyan-tinted — headings
WARN_AMBER = "#E0AF68"   # amber — warnings
ERR_CORAL = "#FF6B6B"    # coral-red — errors / rejections

# Backward-compat aliases for __main__.py and any downstream imports
EMERALD = ACCENT
MINT = ACCENT_SOFT
TEAL = INFO
PURPLE = BLUE_VIOLET
CHARCOAL = MUTED
SNOW = SNOW_WHITE
PARCHMENT = MIST
SLATE = SUBTLE
AMBER = WARN_AMBER
CORAL = ERR_CORAL
SUCCESS = ACCENT

theme = Theme({
    "accent": f"bold {ACCENT}",
    "accent.soft": ACCENT_SOFT,
    "heading": f"bold {SNOW_WHITE}",
    "body": MIST,
    "dim": SUBTLE,
    "ghost": MUTED,
    "warn": WARN_AMBER,
    "err": ERR_CORAL,
    "ok": ACCENT,
    "purple": BLUE_VIOLET,
    "teal": INFO,
})

console = Console(theme=theme)

TOTAL_STAGES = 7
STAGE_NAMES = {
    "ingest": ("Trace Ingestor", "Parsing raw trace events"),
    "classify": ("Failure Classifier", "Categorizing failures with LLM"),
    "ground": ("Grounding Engine", "Mapping failures to source code"),
    "tribunal": ("Tribunal Diagnoser", "Two-agent root cause validation"),
    "evals": ("Eval Generator", "Building regression test cases"),
    "debrief": ("Debrief Writer", "Drafting customer remediation memo"),
    "learn": ("Knowledge Extractor", "Learning patterns for future diagnoses"),
}

STAGE_MARKER = "◆"
BULLET = "▸"
CONNECTOR = "│"
DISMISS = "✕"

_stage_counter = 0


def _confidence_bar(value: float, width: int = 16) -> Text:
    """Render a confidence bar using block characters and semantic color."""
    clamped = max(0.0, min(1.0, value))
    filled = int(round(clamped * width))
    empty = width - filled
    style = "ok" if clamped >= 0.7 else "warn" if clamped >= 0.4 else "err"
    bar = Text()
    bar.append("█" * filled, style=style)
    bar.append("░" * empty, style="ghost")
    bar.append(f"  {clamped:.0%}", style="body")
    return bar


def _connector():
    """Thin vertical connector between stages to suggest pipeline flow."""
    console.print(Text(f"  {CONNECTOR}", style="ghost"))


def print_banner(trace_path: str, event_count: int, repo_path: str, tracing_status: str):
    """Print the application header."""
    title = Text()
    title.append(f"{STAGE_MARKER}  AGENT RESCUE ROOM", style="accent")
    title.append("\n")
    title.append("Production Agent Debugging Field Kit", style="dim")

    info = Text()
    info.append("Trace    ", style="dim")
    info.append(f"{trace_path}\n", style="body")
    info.append("Events   ", style="dim")
    info.append(f"{event_count}\n", style="body")
    info.append("Repo     ", style="dim")
    info.append(f"{repo_path}\n", style="body")
    info.append("Tracing  ", style="dim")
    info.append(tracing_status, style="ok" if "enabled" in tracing_status else "ghost")

    panel_content = Text()
    panel_content.append_text(title)
    panel_content.append("\n\n")
    panel_content.append_text(info)

    console.print()
    console.print(Panel(
        panel_content,
        border_style=ACCENT,
        box=box.ROUNDED,
        padding=(1, 2),
    ))


def print_stage_header(node_name: str):
    """Print a stage header with number, name, and pipeline connector."""
    global _stage_counter
    _stage_counter += 1
    stage_num = _stage_counter

    name, desc = STAGE_NAMES.get(node_name, (node_name, ""))

    if stage_num > 1:
        _connector()

    header = Text()
    header.append(f"{STAGE_MARKER}  Stage {stage_num} of {TOTAL_STAGES}", style="accent")
    header.append(f"  {name}", style="heading")
    if desc:
        header.append(f"\n{desc}", style="dim")

    console.print(Panel(
        header,
        border_style=MUTED,
        box=box.ROUNDED,
        padding=(0, 2),
    ))


def print_approval_gate(diagnosis):
    """Print the human approval gate with diagnosis summary."""
    console.print()

    diag = Text()
    diag.append("Confidence  ", style="dim")
    diag.append_text(_confidence_bar(diagnosis.confidence))
    diag.append("\n\n")

    diag.append("Root cause\n", style="dim")
    diag.append(f"{diagnosis.root_cause}\n\n", style="body")

    diag.append("Confirmed failures\n", style="dim")
    for c in diagnosis.confirmed_failures:
        conf_style = "ok" if c.confidence >= 0.7 else "warn" if c.confidence >= 0.4 else "err"
        diag.append(f"  {BULLET} ", style=conf_style)
        diag.append(f"[{c.confidence:.0%}] ", style=conf_style)
        diag.append(f"{c.failure_type}\n", style="body")

    diag.append("\nRemediation steps\n", style="dim")
    for i, step in enumerate(diagnosis.remediation_steps, 1):
        diag.append(f"  {i}. ", style="accent")
        diag.append(f"{step}\n", style="body")

    if diagnosis.dismissed_hypotheses:
        diag.append("\nDismissed hypotheses\n", style="dim")
        for d in diagnosis.dismissed_hypotheses:
            diag.append(f"  {DISMISS} ", style="err")
            diag.append(f"{d.hypothesis}", style="ghost")
            diag.append(f"  ({d.reason})\n", style="ghost")

    gate_title = Text()
    gate_title.append(f"{STAGE_MARKER}  HUMAN APPROVAL GATE", style="accent")
    gate_title.append("  Review the diagnosis before continuing", style="dim")

    console.print(Panel(
        diag,
        title=gate_title,
        title_align="left",
        border_style=ACCENT,
        box=box.ROUNDED,
        padding=(1, 2),
    ))


def prompt_approval() -> bool:
    """Prompt user for approval. Returns True if approved."""
    console.print()
    response = console.input(
        f"  [{ACCENT}][bold]{BULLET}[/bold] approve[/]  [dim]or[/]  [{ERR_CORAL}]reject[/]: "
    ).strip().lower()
    return response == "approve"


def print_debrief(debrief):
    """Print the customer debrief as a formatted memo."""
    console.print()

    memo = Text()
    memo.append("Incident summary\n", style="dim")
    memo.append(f"{debrief.incident_summary}\n\n", style="body")

    memo.append("Root cause\n", style="dim")
    memo.append(f"{debrief.root_cause_plain}\n\n", style="body")

    memo.append("Customer impact\n", style="dim")
    memo.append(f"{debrief.customer_impact}\n\n", style="body")

    memo.append("Fix\n", style="dim")
    memo.append(f"{debrief.fix_description}\n\n", style="body")

    memo.append("Prevention measures\n", style="dim")
    for m in debrief.prevention_measures:
        memo.append(f"  {BULLET} ", style="accent")
        memo.append(f"{m}\n", style="body")

    memo.append("\nTimeline\n", style="dim")
    memo.append(f"{debrief.timeline}", style="body")

    title = Text(f"{STAGE_MARKER}  CUSTOMER DEBRIEF", style="accent")
    console.print(Panel(
        memo,
        title=title,
        title_align="left",
        border_style=MUTED,
        box=box.ROUNDED,
        padding=(1, 2),
    ))


def print_evals(eval_cases: list):
    """Print regression eval cases as a table."""
    console.print()

    table = Table(
        title=f"{STAGE_MARKER}  REGRESSION EVALS  {len(eval_cases)} cases",
        title_style="accent",
        border_style=MUTED,
        box=box.SIMPLE_HEAD,
        padding=(0, 1),
    )
    table.add_column("Type", style="purple", width=16)
    table.add_column("Name", style="heading", no_wrap=False)
    table.add_column("Catches", style="body", width=22)

    for e in eval_cases:
        table.add_row(e.eval_type, e.name, e.failure_it_catches)

    console.print(table)


def print_completion():
    """Print the completion banner."""
    console.print()
    done = Text()
    done.append(f"{STAGE_MARKER}  ", style="accent")
    done.append("RESCUE COMPLETE", style="accent")
    console.print(Panel(
        done,
        border_style=ACCENT,
        box=box.ROUNDED,
        padding=(0, 2),
    ))
    console.print()


def print_rejected():
    """Print rejection message."""
    console.print()
    console.print(f"  [{ERR_CORAL}]{DISMISS} Diagnosis rejected. Pipeline stopped.[/]")
    console.print()


def reset_stages():
    """Reset stage counter (for fresh runs)."""
    global _stage_counter
    _stage_counter = 0
