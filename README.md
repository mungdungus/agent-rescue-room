# Agent Rescue Room

![Agent Rescue Room demo](media/demo.gif)

Production agent debugging field kit built with LangGraph.

Takes a failed agent trace, diagnoses what went wrong, generates regression tests, and writes a customer-ready incident memo. A human approval gate pauses the pipeline so you can review the diagnosis before committing to fixes.

## Architecture

```
trace.json ─► ingest ─► classify ─► ground ─► tribunal ─► [approval gate] ─► evals ─► debrief ─► learn
                │           │          │          │              │               │         │         │
            parse raw   categorize   map to    two-agent     human reviews   generate   write    extract
             events     failures    source    challenge/     diagnosis      regression  customer  reusable
                        with LLM     code     validate                      test cases   memo    patterns
```

**7 pipeline stages**, 5 powered by LLM (Gemini), 1 with tool-calling for code analysis, 1 knowledge extractor.

## What it demonstrates

- **LangGraph StateGraph**: typed state flowing through a linear node pipeline
- **interrupt_before**: human-in-the-loop approval gate between diagnosis and remediation
- **Structured output**: Pydantic models as LLM output schemas (with Gemini's top-level object requirement)
- **Tool-calling loop**: grounding engine reads source code files to map failures to specific functions
- **Two-agent pattern**: tribunal node where a proposer and challenger validate the root cause
- **Self-improving knowledge base**: learns failure patterns from each diagnosis, uses them to improve future classification
- **LangSmith tracing**: all LLM calls instrumented when API key is present

## Self-improving pipeline

The `learn` node (Stage 7) extracts reusable failure patterns from each completed diagnosis and persists them to `data/knowledge.json`. On future runs, the classifier loads accumulated patterns to improve detection accuracy.

```
Run 1: diagnoses research agent → learns 3 patterns (silent_tool_failure, gate_bypass, stale_data)
Run 2: diagnoses scan pipeline → loads 3 patterns, learns 2 more (pipeline_bypass, metric_dilution)
Run N: accumulated knowledge improves every classification
```

The knowledge base grows with each incident. Patterns are deduplicated by signal fingerprint.

## Quick start

```bash
git clone https://github.com/mungdungus/agent-rescue-room.git
cd agent-rescue-room

python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Add your GOOGLE_API_KEY to .env

python -m rescue data/traces/research-agent-failure.json
```

## Demo scenario

The included trace (`data/traces/research-agent-failure.json`) is a research agent that:

- Retrieved stale financial data ($2.6B instead of $3.1B)
- Swallowed a verification tool error silently
- Bypassed the required human approval gate
- Drafted and nearly sent an email with wrong numbers

The pipeline catches all four failures, maps them to specific functions in the agent's source code, generates regression tests, and produces a plain-English memo explaining what happened.

## Optional: LangSmith tracing

Add `LANGCHAIN_API_KEY` to your `.env` to see all LLM calls in your LangSmith dashboard under the `agent-rescue-room` project.

## Project structure

```
rescue/
  __main__.py    CLI entry point
  graph.py       LangGraph pipeline with interrupt_before
  schemas.py     Pydantic models for every pipeline stage
  display.py     Rich terminal output (LangChain-cousin palette, square geometry)
  tools.py       File-reading tools for the grounding engine
  nodes/
    ingest.py    Parse raw trace JSON
    classify.py  LLM failure classification (loads learned patterns)
    ground.py    Map failures to source code via tool calls
    tribunal.py  Two-agent challenge pattern for diagnosis
    evals.py     Generate regression test cases
    debrief.py   Write customer remediation memo
    learn.py     Extract and persist novel failure patterns
data/
  traces/        Canned failure scenarios
  incident-brief.md
  repo/          The "broken" agent's source code
```
