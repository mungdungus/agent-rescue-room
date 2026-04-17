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


def _serde():
    return JsonPlusSerializer(allowed_msgpack_modules=[
        ("rescue.schemas", "TraceEvent"),
        ("rescue.schemas", "FailureClassification"),
        ("rescue.schemas", "Diagnosis"),
        ("rescue.schemas", "DismissedHypothesis"),
        ("rescue.schemas", "EvalCase"),
        ("rescue.schemas", "CustomerDebrief"),
    ])


def build_graph(checkpointer=None):
    """Construct the Agent Rescue Room StateGraph with human approval gate.

    Pass a checkpointer for local CLI runs. Leave None when targeting
    LangGraph Platform — the platform injects its own managed checkpointer.
    """
    graph = StateGraph(RescueState)

    graph.add_node("ingest", ingest_node)
    graph.add_node("classify", classify_node)
    graph.add_node("ground", ground_node)
    graph.add_node("tribunal", tribunal_node)
    graph.add_node("evals", evals_node)
    graph.add_node("debrief", debrief_node)
    graph.add_node("learn", learn_node)

    graph.set_entry_point("ingest")
    graph.add_edge("ingest", "classify")
    graph.add_edge("classify", "ground")
    graph.add_edge("ground", "tribunal")
    graph.add_edge("tribunal", "evals")
    graph.add_edge("evals", "debrief")
    graph.add_edge("debrief", "learn")
    graph.add_edge("learn", END)

    return graph.compile(
        interrupt_before=["evals"],
        checkpointer=checkpointer,
    )


def build_local_graph():
    """Compiled graph with in-memory checkpointer for CLI use."""
    return build_graph(checkpointer=MemorySaver(serde=_serde()))


# Exported for langgraph.json → LangGraph Platform / `langgraph dev`.
graph = build_graph()
