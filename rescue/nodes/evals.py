"""Eval Generator — LLM-powered regression test case generation from diagnosis."""

from __future__ import annotations

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field

from rescue.schemas import EvalCase, RescueState

load_dotenv()

MODEL = "gemini-3.1-flash-lite-preview"

EVALS_SYSTEM = """You are a QA engineer specializing in agentic system regression testing. Given a root cause analysis of a failed agent run, generate regression eval cases that would catch this failure if it happened again.

For each eval case:
- name: short snake_case test name
- description: what this eval checks
- input_fixture: a dict of input state values that reproduce the failure condition
- expected_behavior: what correct behavior looks like
- failure_it_catches: which failure type from the diagnosis this prevents
- eval_type: one of routing, tool_args, approval_gate, output_quality, budget, latency

Generate 4-6 eval cases covering the confirmed failures. Each confirmed failure should have at least one eval. Prioritize evals that catch the most dangerous failures (approval bypass, swallowed errors) over cosmetic ones."""


class EvalCaseList(BaseModel):
    """Wrapper for structured output — Gemini needs a top-level object."""
    eval_cases: list[EvalCase] = Field(
        description="Regression test cases generated from the incident"
    )


def evals_node(state: RescueState) -> dict:
    """Generate regression eval cases from the diagnosed incident using LLM."""
    llm = ChatGoogleGenerativeAI(model=MODEL, temperature=0)
    llm_structured = llm.with_structured_output(EvalCaseList)

    diagnosis = state["diagnosis"]
    failures_text = "\n".join(
        f"- [{c.failure_type}] confidence={c.confidence:.0%}, "
        f"nodes={', '.join(c.affected_nodes)}, "
        f"evidence={'; '.join(c.evidence[:2])}"
        for c in diagnosis.confirmed_failures
    )
    dismissed_text = "\n".join(
        f"- {d.hypothesis} (dismissed: {d.reason})"
        for d in diagnosis.dismissed_hypotheses
    )

    human_input = (
        f"Generate regression eval cases for this diagnosed incident:\n\n"
        f"ROOT CAUSE: {diagnosis.root_cause}\n\n"
        f"CONFIRMED FAILURES:\n{failures_text}\n\n"
        f"DISMISSED HYPOTHESES:\n{dismissed_text}\n\n"
        f"REMEDIATION STEPS:\n"
        + "\n".join(f"- {s}" for s in diagnosis.remediation_steps)
    )

    messages = [
        SystemMessage(content=EVALS_SYSTEM),
        HumanMessage(content=human_input),
    ]

    result = llm_structured.invoke(messages)

    print(f"   Generated {len(result.eval_cases)} regression eval cases")
    for e in result.eval_cases:
        print(f"   [{e.eval_type}] {e.name}: catches {e.failure_it_catches}")

    return {"eval_cases": result.eval_cases}
