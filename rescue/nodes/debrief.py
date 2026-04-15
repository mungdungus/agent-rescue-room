"""Customer Debrief Writer — LLM-powered incident remediation memo."""

from __future__ import annotations

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from rescue.schemas import CustomerDebrief, RescueState

load_dotenv()

MODEL = "gemini-3.1-flash-lite-preview"

DEBRIEF_SYSTEM = """You are a customer success engineer writing an incident remediation memo for an account team. The memo should be understandable by non-technical stakeholders.

Write in clear, direct language. No jargon. The audience is the account manager who needs to explain what happened to the customer.

The memo must cover:
- incident_summary: what happened in 2-3 sentences
- root_cause_plain: the root cause without technical terms
- customer_impact: what the customer experienced
- fix_description: what was fixed and how
- prevention_measures: 3-5 concrete steps to prevent recurrence
- timeline: when the fix ships and monitoring period

Be specific. Reference actual failure details from the diagnosis, not generic statements."""


def debrief_node(state: RescueState) -> dict:
    """Generate customer-ready incident remediation memo using LLM."""
    llm = ChatGoogleGenerativeAI(model=MODEL, temperature=0.2)
    llm_structured = llm.with_structured_output(CustomerDebrief)

    diagnosis = state["diagnosis"]
    eval_cases = state.get("eval_cases", [])

    failures_text = "\n".join(
        f"- [{c.failure_type}] {'; '.join(c.evidence[:2])}"
        for c in diagnosis.confirmed_failures
    )
    evals_text = "\n".join(
        f"- {e.name}: {e.description}"
        for e in eval_cases
    )

    human_input = (
        f"Write a customer remediation memo for this incident:\n\n"
        f"ROOT CAUSE: {diagnosis.root_cause}\n"
        f"CONFIDENCE: {diagnosis.confidence:.0%}\n\n"
        f"CONFIRMED FAILURES:\n{failures_text}\n\n"
        f"REMEDIATION STEPS:\n"
        + "\n".join(f"- {s}" for s in diagnosis.remediation_steps)
        + f"\n\nREGRESSION TESTS ADDED:\n{evals_text}"
    )

    messages = [
        SystemMessage(content=DEBRIEF_SYSTEM),
        HumanMessage(content=human_input),
    ]

    result = llm_structured.invoke(messages)

    print("   Customer debrief generated")
    print(f"   Impact: {result.customer_impact[:80]}...")
    print(f"   Prevention measures: {len(result.prevention_measures)}")

    return {"debrief": result}
