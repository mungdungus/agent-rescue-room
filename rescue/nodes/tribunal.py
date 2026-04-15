"""Tribunal Diagnoser — two-agent challenge pattern for root cause validation."""

from __future__ import annotations

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from rescue.schemas import Diagnosis, DismissedHypothesis, FailureClassification, RescueState

load_dotenv()

MODEL = "gemini-3.1-flash-lite-preview"

PROPOSER_SYSTEM = """You are a senior incident analyst proposing a root cause diagnosis.

Given classified failures and source code evidence from a failed agent run, produce a diagnosis:

1. root_cause: A clear, specific explanation of what went wrong and why (2-4 sentences)
2. confirmed_failures: The classified failures you believe are valid (copy from input)
3. dismissed_hypotheses: At least 1 alternative explanation you considered and rejected, with reasoning
4. remediation_steps: Specific fixes ordered by impact. Reference function names, files, or patterns to change.
5. confidence: Your confidence in this diagnosis (0.0-1.0)

Be specific. Name functions, files, and line numbers when possible."""

CHALLENGER_SYSTEM = """You are a skeptical reviewer challenging a proposed diagnosis of a failed agent run.

Your job:
1. Review the proposed diagnosis against the original evidence (trace events + source code)
2. Reject any conclusions not directly supported by evidence
3. Add dismissed_hypotheses for theories the proposer may have missed or wrong conclusions they drew
4. Adjust confidence downward if evidence is weak
5. Refine remediation_steps to be more specific or correct ordering

You must produce a complete Diagnosis. Keep what is well-supported, fix what is not.
Always include at least 1 dismissed_hypothesis showing you challenged the analysis."""


def build_evidence_text(state: RescueState) -> str:
    """Compile all evidence for the tribunal."""
    parts = []

    # Classifications
    parts.append("CLASSIFIED FAILURES:")
    for c in state.get("classifications", []):
        cl = c if isinstance(c, dict) else c.model_dump()
        parts.append(f"  - {cl['failure_type']} ({cl['confidence']:.0%})")
        for ev in cl.get("evidence", []):
            parts.append(f"    Evidence: {ev}")
        parts.append(f"    Nodes: {', '.join(cl.get('affected_nodes', []))}")

    # Grounding context from messages
    parts.append("\nGROUNDING EVIDENCE:")
    for msg in state.get("messages", []):
        content = msg.content if hasattr(msg, "content") else str(msg)
        if "GROUNDING" in content.upper() or "repo" in content.lower():
            parts.append(content[:3000])

    # Incident brief
    brief = state.get("incident_brief", "")
    if brief:
        parts.append(f"\nINCIDENT BRIEF:\n{brief[:2000]}")

    return "\n".join(parts)


def tribunal_node(state: RescueState) -> dict:
    """Two-agent diagnosis: proposer suggests, challenger validates."""
    llm = ChatGoogleGenerativeAI(model=MODEL, temperature=0)

    evidence = build_evidence_text(state)

    # Agent 1: Proposer
    print("   Proposer analyzing...")
    proposer_llm = llm.with_structured_output(Diagnosis)
    proposer_messages = [
        SystemMessage(content=PROPOSER_SYSTEM),
        HumanMessage(content=f"Produce a root cause diagnosis from this evidence:\n\n{evidence}"),
    ]
    proposed = proposer_llm.invoke(proposer_messages)

    print(f"   Proposed: {proposed.root_cause[:80]}...")
    print(f"   Proposer confidence: {proposed.confidence:.0%}")

    # Agent 2: Challenger
    print("   Challenger reviewing...")
    challenger_llm = llm.with_structured_output(Diagnosis)

    proposed_text = (
        f"PROPOSED DIAGNOSIS:\n"
        f"Root cause: {proposed.root_cause}\n"
        f"Confidence: {proposed.confidence}\n"
        f"Confirmed failures: {len(proposed.confirmed_failures)}\n"
        f"Remediation steps:\n"
    )
    for i, step in enumerate(proposed.remediation_steps, 1):
        proposed_text += f"  {i}. {step}\n"
    if proposed.dismissed_hypotheses:
        proposed_text += "Dismissed hypotheses:\n"
        for dh in proposed.dismissed_hypotheses:
            dh_dict = dh if isinstance(dh, dict) else dh.model_dump()
            proposed_text += f"  - {dh_dict['hypothesis']}: {dh_dict['reason']}\n"

    challenger_messages = [
        SystemMessage(content=CHALLENGER_SYSTEM),
        HumanMessage(content=(
            f"Challenge this proposed diagnosis. Here is the original evidence and the proposal:\n\n"
            f"ORIGINAL EVIDENCE:\n{evidence}\n\n{proposed_text}"
        )),
    ]
    final_diagnosis = challenger_llm.invoke(challenger_messages)

    # Ensure we have the classifications from the state
    if not final_diagnosis.confirmed_failures:
        final_diagnosis.confirmed_failures = state.get("classifications", [])

    print(f"   Final confidence: {final_diagnosis.confidence:.0%}")
    print(f"   Root cause: {final_diagnosis.root_cause[:80]}...")
    print(f"   Remediation steps: {len(final_diagnosis.remediation_steps)}")
    print(f"   Dismissed: {len(final_diagnosis.dismissed_hypotheses)} hypotheses")

    return {"diagnosis": final_diagnosis}
