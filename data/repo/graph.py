"""
Customer's research agent — the buggy version.

Bug: The routing function only checks claims_verified,
ignoring approval_required. This lets the agent skip
human approval when claims are marked as verified.
"""

from typing import Annotated, Literal, Optional, TypedDict
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage


class ResearchState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    company: str
    research_summary: Optional[str]
    claims_verified: bool
    approval_required: bool
    draft_email: Optional[str]
    email_sent: bool


def retrieve_context(state: ResearchState) -> dict:
    """Fetch company data from knowledge base."""
    # Uses vector store retrieval — no freshness filter
    return {"research_summary": "...retrieved from KB..."}


def verify_claims(state: ResearchState) -> dict:
    """Cross-reference claims with live data."""
    # BUG: No error handling for tool failures.
    # If web_search fails, LLM fabricates verification.
    return {"claims_verified": True}


def human_approval(state: ResearchState) -> dict:
    """Human reviews draft before sending."""
    return {}


def draft_email(state: ResearchState) -> dict:
    """Generate outbound email from verified research."""
    return {"draft_email": "...generated email..."}


def send_email(state: ResearchState) -> dict:
    """Send the approved email."""
    return {"email_sent": True}


# BUG: This function only checks claims_verified.
# It should ALSO check approval_required.
def route_after_verify(state: ResearchState) -> Literal["draft_email", "human_approval"]:
    if state.get("claims_verified"):
        return "draft_email"  # Skips approval!
    return "human_approval"


def build_graph():
    graph = StateGraph(ResearchState)

    graph.add_node("retrieve_context", retrieve_context)
    graph.add_node("verify_claims", verify_claims)
    graph.add_node("human_approval", human_approval)
    graph.add_node("draft_email", draft_email)
    graph.add_node("send_email", send_email)

    graph.set_entry_point("retrieve_context")
    graph.add_edge("retrieve_context", "verify_claims")

    # BUG: Should check both claims_verified AND approval_required
    graph.add_conditional_edges("verify_claims", route_after_verify)

    graph.add_edge("human_approval", "draft_email")
    graph.add_edge("draft_email", "send_email")
    graph.add_edge("send_email", END)

    return graph.compile()
