"""Failure Classifier — LLM-powered failure categorization from trace events."""

from __future__ import annotations

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field

from rescue.schemas import FailureClassification, RescueState

load_dotenv()

MODEL = "gemini-3.1-flash-lite-preview"

CLASSIFY_SYSTEM = """You are a production agent failure analyst. You receive a sequence of trace events from a failed agent run and must classify every distinct failure you find.

Failure types you can assign:
- tool_schema_mismatch: Tool was called with wrong arguments or returned unexpected schema
- approval_bypass: A required human approval step was skipped
- stale_retrieval: Retrieved data was outdated or no longer accurate
- prompt_ambiguity: A prompt instruction was ignored or misinterpreted by the model
- budget_runaway: Token or cost budget was exceeded
- state_corruption: Agent continued operating on corrupted or invalid state
- swallowed_error: An error occurred but was not propagated, allowing the agent to continue incorrectly

For each failure found:
- Assign the most specific failure_type from the list above
- Set confidence between 0.0 and 1.0
- Provide evidence: quote specific event details (node names, error messages, timestamps)
- List affected_nodes: which graph nodes were involved

Only classify failures you can support with evidence from the trace. Do not speculate."""


class ClassificationResult(BaseModel):
    """Wrapper for structured output containing multiple classifications."""
    classifications: list[FailureClassification] = Field(
        description="All failures identified in the trace"
    )


def format_trace_for_llm(state: RescueState) -> str:
    """Format trace events as readable text for LLM analysis."""
    lines = ["TRACE EVENTS:", ""]
    for i, event in enumerate(state["trace_events"]):
        e = event if isinstance(event, dict) else event.model_dump()
        lines.append(f"Event {i+1}:")
        lines.append(f"  Node: {e['node']}")
        lines.append(f"  Type: {e['type']}")
        lines.append(f"  Timestamp: {e['timestamp']}")

        if e.get("input"):
            inp = e["input"]
            for k, v in inp.items():
                lines.append(f"  Input.{k}: {v}")

        if e.get("output"):
            out = e["output"]
            for k, v in out.items():
                val = str(v)
                if len(val) > 300:
                    val = val[:300] + "..."
                lines.append(f"  Output.{k}: {val}")

        if e.get("metadata", {}).get("note"):
            lines.append(f"  Note: {e['metadata']['note']}")

        lines.append("")

    return "\n".join(lines)


def classify_node(state: RescueState) -> dict:
    """Classify failures in the trace using LLM with structured output."""
    llm = ChatGoogleGenerativeAI(model=MODEL, temperature=0)
    llm_structured = llm.with_structured_output(ClassificationResult)

    trace_text = format_trace_for_llm(state)

    incident = state.get("incident_brief", "")
    human_input = f"Analyze this failed agent trace and classify all failures:\n\n{trace_text}"
    if incident:
        human_input += f"\n\nINCIDENT BRIEF:\n{incident}"

    messages = [
        SystemMessage(content=CLASSIFY_SYSTEM),
        HumanMessage(content=human_input),
    ]

    result = llm_structured.invoke(messages)

    print(f"   Classified {len(result.classifications)} failures")
    for c in result.classifications:
        print(f"   [{c.confidence:.0%}] {c.failure_type} in {', '.join(c.affected_nodes)}")

    return {"classifications": result.classifications}
