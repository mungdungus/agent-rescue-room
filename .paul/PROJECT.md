---
name: Agent Rescue Room
version: 0.1.0
description: LangGraph demo for LangChain Deployed Engineer interview - production agent debugging field kit
created: 2026-04-15
last_updated: 2026-04-17
milestone_status: v0.1 complete
---

## Vision

A LangGraph-powered incident command center that ingests a failed agent trace, diagnoses root cause, generates regression evals, and produces a customer-ready remediation memo. Built to demonstrate deployed-engineer instincts at a LangChain interview.

## Core requirements — all validated

1. ✓ **Trace ingestion** — Phase 2: `rescue/nodes/ingest.py` parses the failed agent run JSON into a canonical event timeline
2. ✓ **Failure classification** — Phase 2: `rescue/nodes/classify.py` categorizes failures (tool schema mismatch, approval bypass, stale retrieval, prompt ambiguity, budget runaway, state corruption) with confidence scores; loads learned patterns from the knowledge base
3. ✓ **Tribunal diagnosis** — Phase 2: `rescue/nodes/tribunal.py` two-agent propose/challenge pattern produces a validated root cause with dismissed hypotheses
4. ✓ **Eval generation** — Phase 3 plan 01: `rescue/nodes/evals.py` generates regression test cases via `EvalCaseList` structured output (Gemini)
5. ✓ **Customer debrief** — Phase 3 plan 01: `rescue/nodes/debrief.py` writes a plain-English remediation memo with incident summary, root cause, customer impact, fix, prevention measures, and timeline
6. ✓ **Human approval gate** — Phase 3 plan 01: `interrupt_before=["evals"]` + `MemorySaver` + `Command(resume=True)` flow; CLI surfaces the diagnosis for approve/reject

## Scope additions shipped (emerged during building)

- ✓ **Grounding engine** — Phase 2: `rescue/nodes/ground.py` with tool-calling loop reads source code to map failures to specific functions
- ✓ **Self-improving knowledge base** — `rescue/nodes/learn.py` extracts reusable failure patterns into `data/knowledge.json`; classifier consumes them on future runs
- ✓ **LangSmith tracing** — env-gated in `rescue/__main__.py`, surfaces status at startup
- ✓ **Second canned demo scenario** — `data/traces/stackproof-scan.json` + `data/stackproof-repo/` fixtures
- ✓ **Rich CLI presentation** — Phase 3 plan 02: `rescue/display.py` with LangChain-cousin palette and square geometry

## Constraints (respected)

- Python only (LangChain's primary ecosystem) ✓
- LangGraph for orchestration ✓
- LangSmith tracing enabled ✓
- Deterministic demo with canned trace data (no live API dependencies) ✓
- Must run from CLI: `python -m rescue <trace.json>` ✓
- Reuse IDE Claude's existing StackProof scaffold where patterns align ✓ (schema structure and tribunal pattern reused; rewritten where domain differed)
- Gemini Flash as default model, model-agnostic design ✓

## Deadline

Friday April 17, 2026 — demo working and explainable. **Met.**

## Key decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-15 | Agent Rescue Room over Agent Migration Analyzer | Maps directly to Deployed Engineer role: diagnosing production failures IS the job |
| 2026-04-15 | Merge StackProof scaffold, don't force it | Reuse tribunal pattern and schema structure where natural; rewrite where domain differs |
| 2026-04-15 | Canned demo, no live APIs | Interview demo must be deterministic and reliable |
| 2026-04-15 | gemini-3.1-flash-lite-preview default | User-specified; free tier; fast |
| 2026-04-15 | Separate repo at ANTIGRAVITY PROJECTS/agent-rescue-room/ | Clean GitHub transfer; no interview-prep artifacts in the demo repo |
| 2026-04-15 | Two LLM calls in tribunal, not a sub-graph | Proposer + challenger within one node function; avoids over-engineering |
| 2026-04-15 | `ClassificationResult` / `EvalCaseList` wrappers | Gemini requires top-level Pydantic object, not a bare list |
| 2026-04-15 | Tool loop in grounding node, not `ToolNode` prebuilt | Clearer for demo explanation, explicit control over max calls |
| 2026-04-15 | Phase 3 split: 03-01 (LLM + gate + tracing), 03-02 (polish + ship) | Keep each plan at 2–3 tasks, separate build from ship |
| 2026-04-15 | `interrupt_before` on `evals` node, not sub-graph | Simpler, more legible on screen share |
| 2026-04-15 | `MemorySaver` (in-process) checkpointer | Adequate for demo; production would need SqliteSaver |
| 2026-04-15 | `JsonPlusSerializer` with allowed msgpack modules | Silences checkpoint deserialization warnings for custom Pydantic types |
| 2026-04-17 | 03-02: implement-direct over design-first | Palette iteration already done in prior session (LangChain-cousin + square geometry) |
| 2026-04-17 | LangChain-cousin CLI palette | Thematic alignment with interview target; parrot-green primary + LangSmith terracotta for errors |

## Existing assets consumed

- StackProof LangGraph scaffold at `demo/stackproof/` — tribunal pattern and schema structure adapted into `rescue/schemas.py` and `rescue/nodes/tribunal.py`
- Pre-existing venv with LangChain stack pre-installed
- Research brief, study guide, mock interview script in parent directory (not vendored)
- Codex spec with 8-module architecture (adapted to 7-node + display module)

---
*Last updated: 2026-04-17 after Phase 3 (milestone v0.1 complete)*
