"""
Agent Rescue Room — LangGraph Pipeline

The rescue pipeline: a StateGraph that processes a failed agent trace
through diagnosis, eval generation, and customer debrief.

Flow: ingest → classify → ground → tribunal → [human approval] → evals → debrief
"""

from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.graph import StateGraph, END

from rescue.schemas import RescueState
from rescue.nodes.ingest import ingest_node
from rescue.nodes.classify import classify_node
from rescue.nodes.ground import ground_node
from rescue.nodes.tribunal import tribunal_node
from rescue.nodes.evals import evals_node
from rescue.nodes.debrief import debrief_node
from rescue.nodes.learn import learn_node


def build_graph():
    """Construct the Agent Rescue Room StateGraph with human approval gate."""
    graph = StateGraph(RescueState)

    # Add nodes
    graph.add_node("ingest", ingest_node)
    graph.add_node("classify", classify_node)
    graph.add_node("ground", ground_node)
    graph.add_node("tribunal", tribunal_node)
    graph.add_node("evals", evals_node)
    graph.add_node("debrief", debrief_node)
    graph.add_node("learn", learn_node)

    # Linear flow
    graph.set_entry_point("ingest")
    graph.add_edge("ingest", "classify")
    graph.add_edge("classify", "ground")
    graph.add_edge("ground", "tribunal")
    graph.add_edge("tribunal", "evals")
    graph.add_edge("evals", "debrief")
    graph.add_edge("debrief", "learn")
    graph.add_edge("learn", END)

    # Compile with human approval gate before evals and checkpointer for state persistence
    serde = JsonPlusSerializer(allowed_msgpack_modules=[
        ("rescue.schemas", "TraceEvent"),
        ("rescue.schemas", "FailureClassification"),
        ("rescue.schemas", "Diagnosis"),
        ("rescue.schemas", "DismissedHypothesis"),
        ("rescue.schemas", "EvalCase"),
        ("rescue.schemas", "CustomerDebrief"),
    ])
    checkpointer = MemorySaver(serde=serde)
    return graph.compile(interrupt_before=["evals"], checkpointer=checkpointer)
