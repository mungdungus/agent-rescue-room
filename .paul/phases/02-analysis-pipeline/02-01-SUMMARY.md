---
phase: 02-analysis-pipeline
plan: 01
subsystem: ai-pipeline
tags: [langgraph, gemini, structured-output, tool-calling, tribunal-pattern]

requires:
  - phase: 01-data-layer
    provides: RescueState schemas, canned trace, graph skeleton with stubs
provides:
  - LLM-powered failure classifier with structured output
  - File-reading tool-calling grounding engine
  - Two-agent tribunal diagnoser (proposer + challenger)
affects: [03-outputs-integration]

tech-stack:
  added: []
  patterns: [structured-output-via-pydantic-wrapper, tool-calling-loop-in-node, two-agent-within-one-node]

key-files:
  created:
    - rescue/tools.py
  modified:
    - rescue/nodes/classify.py
    - rescue/nodes/ground.py
    - rescue/nodes/tribunal.py

key-decisions:
  - "gemini-3.1-flash-lite-preview as default model across all nodes"
  - "ClassificationResult wrapper model for structured output (Gemini needs top-level object)"
  - "Tool loop inside ground_node, not ToolNode prebuilt (clearer for demo)"
  - "Two sequential LLM calls in tribunal, not a sub-graph"

patterns-established:
  - "load_dotenv() at module level, MODEL constant per file"
  - "format_trace_for_llm() converts Pydantic objects to readable text"
  - "Tool loop: max 5 calls, break on no tool_calls in response"
  - "Proposer confidence > challenger confidence (challenger adjusts down)"

duration: 12min
started: 2026-04-15T11:20:00Z
completed: 2026-04-15T11:32:00Z
---

# Phase 2 Plan 01: Analysis pipeline

**Three LLM-powered nodes replacing stubs: classifier finds 4 failures, grounding reads 4 repo files, tribunal produces 95% confidence diagnosis with 2 dismissed hypotheses.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~12min |
| Tasks | 3 completed |
| Files created | 1 (rescue/tools.py) |
| Files modified | 3 (classify.py, ground.py, tribunal.py) |

## Acceptance criteria results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Classifier produces real classifications | Pass | 4 failures found (stale_retrieval, swallowed_error, prompt_ambiguity, approval_bypass) |
| AC-2: Grounding maps failures to source code | Pass | 4 tool calls, read graph.py + tools.py + prompts.py |
| AC-3: Tribunal produces validated diagnosis | Pass | 95% confidence, 4 remediation steps, 2 dismissed hypotheses |

## Accomplishments

- Classifier found a 4th failure (prompt_ambiguity) beyond the 3 designed into the trace, showing the LLM analysis adds genuine value over the hardcoded stubs
- Tribunal pattern works as designed: proposer at 100% confidence, challenger pushed it to 95% and added dismissed hypotheses

## Deviations from plan

None. Plan executed as written.

## Next phase readiness

**Ready:**
- Full analysis pipeline produces real LLM output end-to-end
- Evals and debrief nodes still stub but graph runs clean
- Phase 3 replaces those last 2 stubs, adds human-in-loop, LangSmith, and README

**Concerns:**
- Full pipeline takes ~15-20 seconds with 3 LLM calls + tool loop. Acceptable for demo but worth noting.
- Using shared venv still (should create project-local venv or at least document the dependency)

**Blockers:** None

---
*Phase: 02-analysis-pipeline, Plan: 01*
*Completed: 2026-04-15*
