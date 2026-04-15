"""
Agent Rescue Room — Pipeline Schemas

Pydantic models for every stage of the rescue pipeline.
These define the data contract between graph nodes.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field


# ─── Trace Data ─────────────────────────────────────────────────

class TraceEvent(BaseModel):
    """A single event from a failed agent trace."""
    node: str = Field(description="Graph node that produced this event")
    type: Literal[
        "retrieval", "tool_call", "llm_response",
        "routing", "error", "output"
    ] = Field(description="Event type")
    timestamp: str = Field(description="ISO8601 timestamp")
    input: dict = Field(default_factory=dict, description="Event input data")
    output: dict = Field(default_factory=dict, description="Event output data")
    metadata: dict = Field(default_factory=dict, description="Tokens, latency, model, notes")


# ─── Failure Classification ─────────────────────────────────────

class FailureClassification(BaseModel):
    """A classified failure found in the trace."""
    failure_type: Literal[
        "tool_schema_mismatch",
        "approval_bypass",
        "stale_retrieval",
        "prompt_ambiguity",
        "budget_runaway",
        "state_corruption",
        "swallowed_error",
    ] = Field(description="Category of failure")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence this classification is correct")
    evidence: list[str] = Field(description="Specific trace events or code references supporting this")
    affected_nodes: list[str] = Field(description="Graph nodes involved in this failure")


# ─── Diagnosis ──────────────────────────────────────────────────

class DismissedHypothesis(BaseModel):
    """A hypothesis the tribunal considered and rejected."""
    hypothesis: str
    reason: str


class Diagnosis(BaseModel):
    """Tribunal-validated root cause analysis."""
    root_cause: str = Field(description="Primary root cause in plain language")
    confirmed_failures: list[FailureClassification] = Field(
        description="Failures confirmed after tribunal review"
    )
    dismissed_hypotheses: list[DismissedHypothesis] = Field(
        description="Hypotheses considered and rejected with reasoning"
    )
    remediation_steps: list[str] = Field(
        description="Ordered list of fixes, most impactful first"
    )
    confidence: float = Field(ge=0.0, le=1.0, description="Overall diagnosis confidence")


# ─── Eval Cases ─────────────────────────────────────────────────

class EvalCase(BaseModel):
    """A regression test case generated from the incident."""
    name: str = Field(description="Short test name")
    description: str = Field(description="What this eval checks")
    input_fixture: dict = Field(description="Input state to replay")
    expected_behavior: str = Field(description="What correct behavior looks like")
    failure_it_catches: str = Field(description="Which failure type this prevents")
    eval_type: Literal[
        "routing", "tool_args", "approval_gate",
        "output_quality", "budget", "latency"
    ] = Field(description="Category of eval")


# ─── Customer Debrief ───────────────────────────────────────────

class CustomerDebrief(BaseModel):
    """Plain-English remediation memo for the customer or account team."""
    incident_summary: str = Field(description="What happened, in 2-3 sentences")
    root_cause_plain: str = Field(description="Root cause without jargon")
    customer_impact: str = Field(description="What the customer experienced")
    fix_description: str = Field(description="What was fixed and how")
    prevention_measures: list[str] = Field(description="Steps to prevent recurrence")
    timeline: str = Field(description="When the fix ships and monitoring period")


# ─── Graph State ────────────────────────────────────────────────

class RescueState(TypedDict):
    """State that flows through the rescue pipeline."""
    trace_events: list[TraceEvent]
    incident_brief: str
    repo_path: str
    classifications: list[FailureClassification]
    diagnosis: Optional[Diagnosis]
    eval_cases: list[EvalCase]
    debrief: Optional[CustomerDebrief]
    messages: Annotated[list[BaseMessage], add_messages]
