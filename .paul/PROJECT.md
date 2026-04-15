---
name: Agent Rescue Room
version: 0.1.0
description: LangGraph demo for LangChain Deployed Engineer interview - production agent debugging field kit
created: 2026-04-15
---

## Vision

A LangGraph-powered incident command center that ingests a failed agent trace, diagnoses root cause, generates regression evals, and produces a customer-ready remediation memo. Built to demonstrate deployed-engineer instincts at a LangChain interview.

## Core requirements

1. **Trace ingestion**: Parse a failed agent run (JSON) into a canonical event timeline
2. **Failure classification**: Categorize the failure (tool schema mismatch, approval bypass, stale retrieval, prompt ambiguity, budget runaway, state corruption)
3. **Tribunal diagnosis**: Two-agent review pattern (propose root cause, challenge weak evidence)
4. **Eval generation**: Convert the incident into replay fixtures and regression checks
5. **Customer debrief**: Plain-English remediation memo suitable for account team
6. **Human approval gate**: Demonstrate LangGraph interrupt_before for governance

## Constraints

- Python only (LangChain's primary ecosystem)
- LangGraph for orchestration (demonstrate the product)
- LangSmith tracing enabled (show observability awareness)
- Deterministic demo with canned trace data (no live API dependencies during demo)
- Must run from CLI: `python -m rescue <trace.json>`
- Reuse IDE Claude's existing StackProof scaffold where patterns align (don't force it)
- Gemini Flash as default model (free tier, fast), but model-agnostic design

## Deadline

Friday April 17, 2026. Demo must be working and explainable by Thursday night.

## Existing assets

- StackProof LangGraph scaffold at `demo/stackproof/` (StateGraph, schemas, tools, evaluate)
- venv with langchain, langgraph, langsmith, langchain_google_genai already installed
- Research brief, study guide, mock interview script in parent directory
- Codex spec with 8-module architecture and demo flow
