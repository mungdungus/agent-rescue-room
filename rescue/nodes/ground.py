"""Repo Grounding Engine — maps failures to source code using file-reading tools."""

from __future__ import annotations

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from rescue.schemas import RescueState
from rescue.tools import GROUNDING_TOOLS

load_dotenv()

MODEL = "gemini-3.1-flash-lite-preview"
MAX_TOOL_CALLS = 5

GROUND_SYSTEM = """You are a code forensics specialist. You receive classified agent failures and must map each failure to its root cause in the source code.

You have tools to list and read files in the agent's repository. Use them to:
1. List the repo files to understand the codebase structure
2. Read files that are likely related to the classified failures
3. For each failure, identify the specific function, line number, and code pattern that caused it

Be precise: name the function, reference the line, explain what the code does wrong.
After reading the relevant files, provide a grounding summary that maps each failure to source code."""


def ground_node(state: RescueState) -> dict:
    """Map classified failures to source code using tool-calling loop."""
    llm = ChatGoogleGenerativeAI(model=MODEL, temperature=0)
    llm_with_tools = llm.bind_tools(GROUNDING_TOOLS)

    # Build the input message
    classifications_text = []
    for c in state.get("classifications", []):
        cl = c if isinstance(c, dict) else c.model_dump()
        classifications_text.append(
            f"- {cl['failure_type']} (confidence: {cl['confidence']:.0%})\n"
            f"  Evidence: {'; '.join(cl['evidence'][:2])}\n"
            f"  Affected nodes: {', '.join(cl['affected_nodes'])}"
        )

    human_msg = (
        f"Map these classified failures to source code in the repo at '{state['repo_path']}':\n\n"
        + "\n".join(classifications_text)
        + "\n\nStart by listing the repo files, then read the relevant ones."
    )

    messages = [
        SystemMessage(content=GROUND_SYSTEM),
        HumanMessage(content=human_msg),
    ]

    # Tool-calling loop
    tool_map = {t.name: t for t in GROUNDING_TOOLS}
    tool_calls_made = 0

    for _ in range(MAX_TOOL_CALLS + 2):  # extra iterations for final response
        response = llm_with_tools.invoke(messages)
        messages.append(response)

        if not hasattr(response, "tool_calls") or not response.tool_calls:
            break

        if tool_calls_made >= MAX_TOOL_CALLS:
            break

        for tc in response.tool_calls:
            tool_fn = tool_map.get(tc["name"])
            if tool_fn:
                result = tool_fn.invoke(tc["args"])
                from langchain_core.messages import ToolMessage
                messages.append(ToolMessage(content=str(result), tool_call_id=tc["id"]))
                tool_calls_made += 1
                print(f"   Tool: {tc['name']}({', '.join(f'{k}={v!r}' for k,v in tc['args'].items() if k != 'repo_path')})")

    # Extract the final grounding summary
    final_content = response.content if response.content else "Grounding analysis complete."
    print(f"   Grounding complete ({tool_calls_made} tool calls)")

    # Add grounding context to messages for the tribunal
    grounding_msg = HumanMessage(content=f"REPO GROUNDING ANALYSIS:\n{final_content}")

    return {"messages": [grounding_msg]}
