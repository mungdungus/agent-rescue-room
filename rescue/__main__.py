"""
Agent Rescue Room — CLI Entry Point

Usage: python -m rescue <trace.json> [--incident <brief.md>] [--repo <path>]
"""

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from langgraph.types import Command

from rescue.display import (
    print_approval_gate,
    print_banner,
    print_completion,
    print_debrief,
    print_evals,
    print_rejected,
    print_stage_header,
    prompt_approval,
    reset_stages,
)
from rescue.graph import build_graph
from rescue.schemas import RescueState

load_dotenv()


def main():
    if len(sys.argv) < 2:
        print("Usage: python -m rescue <trace.json> [--incident <brief.md>] [--repo <path>]")
        sys.exit(1)

    trace_path = Path(sys.argv[1])
    if not trace_path.exists():
        print(f"Error: trace file not found: {trace_path}")
        sys.exit(1)

    # Parse optional args
    incident_path = None
    repo_path = "data/repo"
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == "--incident" and i + 1 < len(args):
            incident_path = args[i + 1]
            i += 2
        elif args[i] == "--repo" and i + 1 < len(args):
            repo_path = args[i + 1]
            i += 2
        else:
            i += 1

    # Load trace
    with open(trace_path) as f:
        raw_trace = json.load(f)

    # Load incident brief
    incident_brief = ""
    if incident_path:
        with open(incident_path) as f:
            incident_brief = f.read()
    else:
        default_brief = trace_path.parent / "incident-brief.md"
        if not default_brief.exists():
            default_brief = Path("data/incident-brief.md")
        if default_brief.exists():
            with open(default_brief) as f:
                incident_brief = f.read()

    # LangSmith tracing
    api_key = os.environ.get("LANGCHAIN_API_KEY")
    if api_key:
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGCHAIN_PROJECT"] = "agent-rescue-room"
        tracing_status = "enabled"
    else:
        tracing_status = "disabled (no LANGCHAIN_API_KEY)"

    # Display banner
    reset_stages()
    print_banner(str(trace_path), len(raw_trace), repo_path, tracing_status)

    # Build graph and configure thread for checkpointing
    app = build_graph()
    config = {"configurable": {"thread_id": "rescue-demo-1"}}

    initial_state: RescueState = {
        "trace_events": raw_trace,
        "incident_brief": incident_brief,
        "repo_path": repo_path,
        "classifications": [],
        "diagnosis": None,
        "eval_cases": [],
        "debrief": None,
        "messages": [],
    }

    # Phase 1: Run through tribunal, then pause at human approval gate
    result = {}
    for event in app.stream(initial_state, config=config):
        for node_name, output in event.items():
            if node_name == "__interrupt__":
                continue
            print_stage_header(node_name)
            if output:
                result.update(output)

    # Show diagnosis for human review
    diagnosis = result.get("diagnosis")
    if diagnosis:
        print_approval_gate(diagnosis)

    # Wait for human approval
    approved = prompt_approval()

    if not approved:
        print_rejected()
        sys.exit(0)

    # Phase 2: Resume execution through evals and debrief
    for event in app.stream(Command(resume=True), config=config):
        for node_name, output in event.items():
            if node_name == "__interrupt__":
                continue
            print_stage_header(node_name)
            if output:
                result.update(output)

    # Final formatted output
    debrief = result.get("debrief")
    if debrief:
        print_debrief(debrief)

    eval_cases = result.get("eval_cases", [])
    if eval_cases:
        print_evals(eval_cases)

    # Show knowledge base status
    from rescue.nodes.learn import load_knowledge
    knowledge = load_knowledge()
    if knowledge:
        from rescue.display import console, EMERALD, SLATE
        console.print(f"  [{SLATE}]Knowledge base: {len(knowledge)} learned patterns[/]")

    print_completion()


if __name__ == "__main__":
    main()
