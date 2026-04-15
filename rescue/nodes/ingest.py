"""Trace Ingestor — parses failed trace JSON into structured events."""

import json
from rescue.schemas import RescueState, TraceEvent


def ingest_node(state: RescueState) -> dict:
    """Parse raw trace JSON into TraceEvent objects.

    This node is fully implemented (pure Python, no LLM needed).
    It normalizes the trace into the canonical event format.
    """
    raw_events = state.get("trace_events", [])

    # If events are already TraceEvent objects, pass through
    if raw_events and isinstance(raw_events[0], TraceEvent):
        return {"trace_events": raw_events}

    # Parse from dicts (loaded from JSON)
    parsed = [TraceEvent(**event) if isinstance(event, dict) else event for event in raw_events]

    print(f"   Ingested {len(parsed)} trace events")
    event_types = [e.type for e in parsed]
    print(f"   Event types: {', '.join(event_types)}")

    return {"trace_events": parsed}
