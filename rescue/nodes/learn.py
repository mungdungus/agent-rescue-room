"""
Learn Node — extracts novel failure patterns from each diagnosis and persists
them to a local knowledge base. Future runs incorporate accumulated knowledge
into classification, making the system smarter with every incident.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field

from rescue.display import print_learn_summary
from rescue.schemas import RescueState

load_dotenv()

MODEL = "gemini-3.1-flash-lite-preview"
KNOWLEDGE_PATH = Path(__file__).parent.parent.parent / "data" / "knowledge.json"

LEARN_SYSTEM = """You are a pattern extraction engine for a production agent debugging system. Given a completed diagnosis of a failed agent run, extract reusable failure patterns that would help classify similar failures in the future.

For each pattern:
- pattern_id: short snake_case identifier
- failure_type: the failure category this pattern detects (e.g. swallowed_error, silent_data_loss)
- signal: what to look for in a trace (specific observable indicators)
- context: when this pattern applies (what kind of system, what conditions)
- remediation_hint: one-line fix direction

Only extract patterns that are NOVEL and REUSABLE. Skip anything too specific to this single incident. Focus on patterns that would help identify the same class of bug in a different system.

Return 1-3 patterns. Quality over quantity."""


class LearnedPattern(BaseModel):
    pattern_id: str = Field(description="Short snake_case identifier")
    failure_type: str = Field(description="Failure category this detects")
    signal: str = Field(description="What to look for in a trace")
    context: str = Field(description="When this pattern applies")
    remediation_hint: str = Field(description="One-line fix direction")


class PatternList(BaseModel):
    patterns: list[LearnedPattern] = Field(description="Extracted failure patterns")


def load_knowledge() -> list[dict]:
    """Load accumulated knowledge from disk."""
    if KNOWLEDGE_PATH.exists():
        with open(KNOWLEDGE_PATH) as f:
            return json.load(f)
    return []


def save_knowledge(knowledge: list[dict]) -> None:
    """Persist knowledge to disk."""
    KNOWLEDGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(KNOWLEDGE_PATH, "w") as f:
        json.dump(knowledge, f, indent=2)


def pattern_fingerprint(pattern: LearnedPattern) -> str:
    """Deduplicate patterns by signal content."""
    return sha256(f"{pattern.failure_type}:{pattern.signal}".encode()).hexdigest()[:12]


def learn_node(state: RescueState) -> dict:
    """Extract and persist novel failure patterns from the completed diagnosis."""
    diagnosis = state.get("diagnosis")
    if not diagnosis:
        return {}

    llm = ChatGoogleGenerativeAI(model=MODEL, temperature=0)
    llm_structured = llm.with_structured_output(PatternList)

    failures_text = "\n".join(
        f"- [{c.failure_type}] confidence={c.confidence:.0%}, "
        f"nodes={', '.join(c.affected_nodes)}"
        for c in diagnosis.confirmed_failures
    )

    eval_cases = state.get("eval_cases", [])
    evals_text = "\n".join(
        f"- {e.name}: {e.description} (catches {e.failure_it_catches})"
        for e in eval_cases
    )

    debrief = state.get("debrief")
    debrief_text = ""
    if debrief:
        debrief_text = (
            f"Root cause: {debrief.root_cause_plain}\n"
            f"Fix: {debrief.fix_description}"
        )

    human_input = (
        f"Extract reusable failure patterns from this completed diagnosis:\n\n"
        f"ROOT CAUSE: {diagnosis.root_cause}\n\n"
        f"CONFIRMED FAILURES:\n{failures_text}\n\n"
        f"REMEDIATION:\n" + "\n".join(f"- {s}" for s in diagnosis.remediation_steps) +
        f"\n\nEVAL CASES:\n{evals_text}\n\n"
        f"DEBRIEF:\n{debrief_text}"
    )

    messages = [
        SystemMessage(content=LEARN_SYSTEM),
        HumanMessage(content=human_input),
    ]

    result = llm_structured.invoke(messages)

    # Load existing knowledge and deduplicate
    knowledge = load_knowledge()
    existing_fps = {p.get("fingerprint") for p in knowledge}
    novel_fps: set[str] = set()

    for pattern in result.patterns:
        fp = pattern_fingerprint(pattern)
        if fp not in existing_fps:
            knowledge.append({
                "fingerprint": fp,
                "pattern_id": pattern.pattern_id,
                "failure_type": pattern.failure_type,
                "signal": pattern.signal,
                "context": pattern.context,
                "remediation_hint": pattern.remediation_hint,
                "learned_at": datetime.now(timezone.utc).isoformat(),
                "source_root_cause": diagnosis.root_cause[:200],
            })
            existing_fps.add(fp)
            novel_fps.add(fp)

    save_knowledge(knowledge)

    items = [(p, pattern_fingerprint(p) in novel_fps) for p in result.patterns]
    print_learn_summary(items, total=len(knowledge))

    return {}
