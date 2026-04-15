---
phase: 01-data-layer
plan: 01
subsystem: data
tags: [langgraph, pydantic, schemas, trace-parsing]

requires:
  - phase: none
    provides: greenfield project
provides:
  - RescueState TypedDict and all pipeline schemas
  - Canned failed trace with 3 compounding failures
  - Fake buggy agent repo for grounding demos
  - Working StateGraph skeleton (6 stub nodes, linear flow)
  - CLI entry point (python -m rescue)
affects: [02-analysis-pipeline, 03-outputs-integration]

tech-stack:
  added: [langchain, langgraph, langchain-google-genai, langsmith, pydantic, python-dotenv]
  patterns: [node-per-module, schema-first design, stub-then-implement]

key-files:
  created:
    - rescue/schemas.py
    - rescue/graph.py
    - rescue/__main__.py
    - data/traces/research-agent-failure.json
    - data/repo/graph.py

key-decisions:
  - "One node per file in rescue/nodes/ for clean isolation"
  - "Ingest node fully implemented (pure Python), all others stubbed"
  - "Trace events use Pydantic validation, graph state uses TypedDict"

patterns-established:
  - "Node signature: def node_name(state: RescueState) -> dict"
  - "Stub nodes return hardcoded data matching schemas"
  - "CLI streams graph execution, then prints formatted output sections"

duration: 15min
started: 2026-04-15T11:00:00Z
completed: 2026-04-15T11:15:00Z
---

# Phase 1 Plan 01: Data layer + graph skeleton

**Canned demo scenario, 6 pipeline schemas, and a working LangGraph StateGraph with stub nodes running end-to-end via CLI.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~15min |
| Tasks | 3 completed |
| Files created | 16 |

## Acceptance criteria results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Trace parses into structured events | Pass | 8 events, 6 types covered |
| AC-2: All schemas validate | Pass | All 6 models import and instantiate |
| AC-3: Graph compiles and runs with stubs | Pass | Full pipeline executes, CLI output clean |

## Accomplishments

- Realistic demo scenario: research agent sends email with stale financial data ($2.6B vs actual $3.1B), skips human approval due to routing bug, swallows tool verification error
- Fake buggy repo with annotated bugs (routing condition, missing error handling, weak prompts) that the rescue pipeline will diagnose
- Schema-first design: all 6 Pydantic models stable enough that Phase 2 node implementations won't require schema changes

## Files created

| File | Purpose |
|------|---------|
| `rescue/__init__.py` | Package init |
| `rescue/schemas.py` | TraceEvent, FailureClassification, Diagnosis, EvalCase, CustomerDebrief, RescueState |
| `rescue/graph.py` | StateGraph: ingest → classify → ground → tribunal → evals → debrief |
| `rescue/__main__.py` | CLI entry point with streaming output |
| `rescue/nodes/__init__.py` | Nodes package init |
| `rescue/nodes/ingest.py` | Trace parser (fully implemented) |
| `rescue/nodes/classify.py` | Failure classifier (stub) |
| `rescue/nodes/ground.py` | Repo grounding engine (stub) |
| `rescue/nodes/tribunal.py` | Tribunal diagnoser (stub) |
| `rescue/nodes/evals.py` | Eval generator (stub) |
| `rescue/nodes/debrief.py` | Customer debrief writer (stub) |
| `data/traces/research-agent-failure.json` | 8-event failed trace |
| `data/incident-brief.md` | Human-readable incident description |
| `data/repo/graph.py` | Buggy agent graph with routing flaw |
| `data/repo/tools.py` | Tools with no error handling |
| `data/repo/prompts.py` | Weak prompt templates |
| `data/repo/README.md` | Agent description |
| `pyproject.toml` | Project config with dependencies |
| `.env.example` | Environment variable template |

## Deviations from plan

### Auto-fixed issues

**1. CLI duplicate output**
- Found during: Task 3 (graph skeleton)
- Issue: `__main__.py` called `app.invoke()` after `app.stream()`, running pipeline twice
- Fix: Accumulated state from stream events instead of re-invoking
- Verification: Clean single-pass output confirmed

**2. Null output handling**
- Found during: Task 3 verification
- Issue: `ground_node` returns empty dict, `result.update(None)` crashed
- Fix: Added null check before update
- Verification: Pipeline runs clean through all 6 nodes

## Next phase readiness

**Ready:**
- All schemas stable for Phase 2 node implementations
- Graph skeleton accepts new node implementations without structural changes
- Existing venv has all dependencies installed
- Demo scenario is realistic enough to discuss in interview

**Concerns:**
- Using shared venv from StackProof demo (should create project-local venv in Phase 3)
- No git repo initialized yet (Phase 3)

**Blockers:** None

---
*Phase: 01-data-layer, Plan: 01*
*Completed: 2026-04-15*
