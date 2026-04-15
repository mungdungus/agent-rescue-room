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

    print("=" * 60)
    print("  AGENT RESCUE ROOM")
    print("  Production Agent Debugging Field Kit")
    print("=" * 60)
    print(f"\n  Trace: {trace_path}")
    print(f"  Events: {len(raw_trace)}")
    print(f"  Repo: {repo_path}")
    print(f"  LangSmith tracing: {tracing_status}")
    print()

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
            print(f"\n{'─' * 40}")
            print(f"  Node: {node_name}")
            if output:
                result.update(output)

    # Show diagnosis for human review
    diagnosis = result.get("diagnosis")
    if diagnosis:
        print(f"\n{'=' * 60}")
        print("  HUMAN APPROVAL GATE")
        print("  Review the diagnosis before generating evals and debrief")
        print("=" * 60)
        print(f"\n  Confidence: {diagnosis.confidence:.0%}")
        print(f"  Root cause: {diagnosis.root_cause}")
        print(f"\n  Confirmed failures:")
        for c in diagnosis.confirmed_failures:
            print(f"    [{c.confidence:.0%}] {c.failure_type}")
        print(f"\n  Remediation steps:")
        for i, step in enumerate(diagnosis.remediation_steps, 1):
            print(f"    {i}. {step}")
        if diagnosis.dismissed_hypotheses:
            print(f"\n  Dismissed hypotheses:")
            for d in diagnosis.dismissed_hypotheses:
                print(f"    - {d.hypothesis}: {d.reason}")

    # Wait for human approval
    print(f"\n{'─' * 60}")
    approval = input("  Type 'approve' to continue, or 'reject' to stop: ").strip().lower()

    if approval != "approve":
        print("\n  Diagnosis rejected. Pipeline stopped.")
        sys.exit(0)

    print("\n  Approved. Continuing to eval generation and debrief...")

    # Phase 2: Resume execution through evals and debrief
    for event in app.stream(Command(resume=True), config=config):
        for node_name, output in event.items():
            print(f"\n{'─' * 40}")
            print(f"  Node: {node_name}")
            if output:
                result.update(output)

    # Final output
    debrief = result.get("debrief")
    if debrief:
        print(f"\n{'=' * 60}")
        print("  CUSTOMER DEBRIEF")
        print("=" * 60)
        print(f"\n  Summary: {debrief.incident_summary}")
        print(f"\n  Root cause: {debrief.root_cause_plain}")
        print(f"\n  Impact: {debrief.customer_impact}")
        print(f"\n  Fix: {debrief.fix_description}")
        print(f"\n  Prevention:")
        for m in debrief.prevention_measures:
            print(f"    - {m}")
        print(f"\n  Timeline: {debrief.timeline}")

    eval_cases = result.get("eval_cases", [])
    if eval_cases:
        print(f"\n{'=' * 60}")
        print(f"  REGRESSION EVALS ({len(eval_cases)} cases)")
        print("=" * 60)
        for e in eval_cases:
            print(f"\n  [{e.eval_type}] {e.name}")
            print(f"    {e.description}")
            print(f"    Catches: {e.failure_it_catches}")

    print(f"\n{'=' * 60}")
    print("  RESCUE COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    main()
