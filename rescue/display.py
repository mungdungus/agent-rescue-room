"""
Agent Rescue Room — Rich Display Module

LangChain-cousin palette on a terminal-native canvas. Parrot-green primary,
LangSmith terracotta for failures, warm neutrals extracted from LangChain's
own docs. Square geometry, minimal table chrome. Built to be followable by
a non-technical viewer during a screen share.

Constant names kept for backward compat with __main__.py imports; values
were swapped from the earlier VoltAgent palette.
"""

from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.theme import Theme

# LangChain-cousin palette
EMERALD = "#30a46c"    # LangChain parrot green — brand accent
MINT = "#c6f54a"       # LangChain chartreuse — completion moments
TEAL = "#7dcfff"       # soft cyan — informational
PURPLE = "#818cf8"     # LangGraph diagram purple — kept, plays well with parrot
CHARCOAL = "#3d3a39"   # warm neutral rule / border
SNOW = "#e0d8c8"       # warm off-white body text (Lausanne-friendly)
PARCHMENT = "#b8b3b0"  # secondary body text
SLATE = "#505051"      # extracted from docs.langchain.com
AMBER = "#e0af68"      # warm amber warnings
CORAL = "#e34f3a"      # LangSmith terracotta — errors, failures
SUCCESS = "#30a46c"    # parrot green for healthy / success

theme = Theme({
    "accent": f"bold {EMERALD}",
    "heading": f"bold {SNOW}",
    "body": PARCHMENT,
    "dim": SLATE,
    "warn": AMBER,
    "err": CORAL,
    "ok": SUCCESS,
    "purple": PURPLE,
    "teal": TEAL,
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

_stage_counter = 0


def print_banner(trace_path: str, event_count: int, repo_path: str, tracing_status: str):
    """Print the application header."""
    title = Text()
    title.append("AGENT RESCUE ROOM", style="accent")
    title.append("\n")
    title.append("Production Agent Debugging Field Kit", style="dim")

    info = Text()
    info.append(f"Trace    ", style="dim")
    info.append(f"{trace_path}\n", style="body")
    info.append(f"Events   ", style="dim")
    info.append(f"{event_count}\n", style="body")
    info.append(f"Repo     ", style="dim")
    info.append(f"{repo_path}\n", style="body")
    info.append(f"Tracing  ", style="dim")
    info.append(tracing_status, style="ok" if "enabled" in tracing_status else "dim")

    panel_content = Text()
    panel_content.append_text(title)
    panel_content.append("\n\n")
    panel_content.append_text(info)

    console.print()
    console.print(Panel(
        panel_content,
        border_style=EMERALD,
        box=box.SQUARE,
        padding=(1, 2),
    ))


def print_stage_header(node_name: str):
    """Print a stage header with number and description."""
    global _stage_counter
    _stage_counter += 1
    stage_num = _stage_counter

    name, desc = STAGE_NAMES.get(node_name, (node_name, ""))

    header = Text()
    header.append(f"Stage {stage_num} of {TOTAL_STAGES}", style="accent")
    header.append(f"  {name}", style="heading")
    if desc:
        header.append(f"\n{desc}", style="dim")

    console.print()
    console.print(Panel(
        header,
        border_style=CHARCOAL,
        box=box.SQUARE,
        padding=(0, 2),
    ))


def print_approval_gate(diagnosis):
    """Print the human approval gate with diagnosis summary."""
    console.print()

    # Diagnosis summary
    diag = Text()
    diag.append("Confidence: ", style="dim")
    conf = diagnosis.confidence
    conf_style = "ok" if conf >= 0.7 else "warn" if conf >= 0.4 else "err"
    diag.append(f"{conf:.0%}\n\n", style=conf_style)

    diag.append("Root cause\n", style="dim")
    diag.append(f"{diagnosis.root_cause}\n\n", style="body")

    diag.append("Confirmed failures\n", style="dim")
    for c in diagnosis.confirmed_failures:
        conf_style = "ok" if c.confidence >= 0.7 else "warn" if c.confidence >= 0.4 else "err"
        diag.append(f"  [{c.confidence:.0%}] ", style=conf_style)
        diag.append(f"{c.failure_type}\n", style="body")

    diag.append("\nRemediation steps\n", style="dim")
    for i, step in enumerate(diagnosis.remediation_steps, 1):
        diag.append(f"  {i}. ", style="accent")
        diag.append(f"{step}\n", style="body")

    if diagnosis.dismissed_hypotheses:
        diag.append("\nDismissed hypotheses\n", style="dim")
        for d in diagnosis.dismissed_hypotheses:
            diag.append(f"  x ", style="err")
            diag.append(f"{d.hypothesis}", style="body")
            diag.append(f" ({d.reason})\n", style="dim")

    gate_title = Text()
    gate_title.append("HUMAN APPROVAL GATE", style="accent")
    gate_title.append("  Review the diagnosis before continuing", style="dim")

    console.print(Panel(
        diag,
        title=gate_title,
        title_align="left",
        border_style=EMERALD,
        box=box.SQUARE,
        padding=(1, 2),
    ))


def prompt_approval() -> bool:
    """Prompt user for approval. Returns True if approved."""
    console.print()
    response = console.input(f"[{EMERALD}]  approve[/] or [dim]reject[/]: ").strip().lower()
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
        memo.append(f"  - ", style="accent")
        memo.append(f"{m}\n", style="body")

    memo.append(f"\nTimeline\n", style="dim")
    memo.append(f"{debrief.timeline}", style="body")

    title = Text("CUSTOMER DEBRIEF", style="accent")
    console.print(Panel(
        memo,
        title=title,
        title_align="left",
        border_style=CHARCOAL,
        box=box.SQUARE,
        padding=(1, 2),
    ))


def print_evals(eval_cases: list):
    """Print regression eval cases as a table."""
    console.print()

    table = Table(
        title=f"REGRESSION EVALS  {len(eval_cases)} cases",
        title_style="accent",
        border_style=CHARCOAL,
        box=box.SIMPLE_HEAD,
        padding=(0, 1),
    )
    table.add_column("Type", style="purple", width=16)
    table.add_column("Name", style="heading", no_wrap=False)
    table.add_column("Catches", style="body", width=20)

    for e in eval_cases:
        table.add_row(e.eval_type, e.name, e.failure_it_catches)

    console.print(table)


def print_completion():
    """Print the completion banner."""
    console.print()
    done = Text()
    done.append("RESCUE COMPLETE", style="accent")
    console.print(Panel(
        done,
        border_style=EMERALD,
        box=box.SQUARE,
        padding=(0, 2),
    ))
    console.print()


def print_rejected():
    """Print rejection message."""
    console.print()
    console.print(f"  [{CORAL}]Diagnosis rejected. Pipeline stopped.[/]")
    console.print()


def reset_stages():
    """Reset stage counter (for fresh runs)."""
    global _stage_counter
    _stage_counter = 0
