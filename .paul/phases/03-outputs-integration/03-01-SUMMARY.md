---
phase: 03-outputs-integration
plan: 01
subsystem: api
tags: [langgraph, gemini, interrupt_before, langsmith, structured-output]

requires:
  - phase: 02-analysis-pipeline
    provides: ingest/classify/ground/tribunal nodes, EvalCase and CustomerDebrief schemas, LLM patterns (structured output via Pydantic wrappers, tool loops in nodes, two-agent tribunal)
provides:
  - LLM-powered evals node (regression test case generator from actual diagnosis)
  - LLM-powered debrief node (customer memo writer from actual diagnosis)
  - Human-in-the-loop approval gate between tribunal and evals (interrupt_before)
  - LangSmith tracing instrumentation for all LLM calls
  - MemorySaver checkpointer wired into the graph
affects: [03-02 rich CLI wrapper, README, GitHub push]

tech-stack:
  added: [langgraph.checkpoint.memory.MemorySaver, langgraph.types.Command]
  patterns: [interrupt_before approval gate, Command(resume=True) for graph resumption, EvalCaseList wrapper for Gemini structured output]

key-files:
  created: []
  modified:
    - rescue/nodes/evals.py
    - rescue/nodes/debrief.py
    - rescue/graph.py
    - rescue/__main__.py

key-decisions:
  - "EvalCaseList wrapper for Gemini structured output (Gemini requires top-level Pydantic object, not bare list)"
  - "Simple interrupt_before on evals node rather than sub-graph for approval gate"
  - "MemorySaver (in-process) as checkpointer — adequate for demo, not production"
  - "LangSmith tracing auto-activates from env vars, no per-node changes"

patterns-established:
  - "Wrapper Pydantic model when Gemini needs a list of structured items"
  - "interrupt_before + thread_id + Command(resume) as the canonical human-in-loop pattern"
  - "Tracing status surfaced to CLI so demo viewers can see whether LangSmith is live"

duration: ~4h (one-day Phase 3 Plan 01 sprint)
started: 2026-04-15
completed: 2026-04-15T15:00:00-05:00
---

# Phase 3 Plan 01: Outputs + Integration Summary

**LLM-powered evals and debrief nodes wired in with a human approval gate via interrupt_before, plus LangSmith tracing — completes the 6-node pipeline end-to-end on real LLM output.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~4 hours |
| Started | 2026-04-15 |
| Completed | 2026-04-15 |
| Tasks | 3 auto + 1 human-verify checkpoint, all resolved |
| Files modified | 4 |
| Auto-verify | 22/22 (build 4/4, pipeline 9/9, gate 9/9) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: LLM-powered eval generation | Pass | evals.py produces EvalCase list derived from diagnosis.root_cause + confirmed_failures; wrapped in EvalCaseList for Gemini |
| AC-2: LLM-powered debrief generation | Pass | debrief.py produces CustomerDebrief memo from diagnosis + eval_cases; reflects actual LLM output, not hardcoded text |
| AC-3: Human approval gate | Pass | interrupt_before=["evals"] pauses graph after tribunal; __main__.py prints diagnosis and waits for approve/reject; Command(resume=True) continues execution |
| AC-4: LangSmith tracing | Pass | __main__.py sets LANGCHAIN_TRACING_V2 and LANGCHAIN_PROJECT when LANGCHAIN_API_KEY present; prints enabled/disabled status at startup |

## Accomplishments

- All 6 pipeline nodes now produce real LLM output — no stubs remaining
- interrupt_before gate is the demo's marquee pattern: governance + HITL in an agentic system
- Auto-verified 22/22 without manual intervention — build, pipeline, and gate all green
- LangSmith tracing is transparent to the nodes (env-driven), activates cleanly when key present

## Task Commits

Tasks were bundled into a single bulk commit rather than atomic per-task, which deviates from the template:

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Task 1: LLM evals + debrief | `b33c95f` | feat | Replaced stub nodes with ChatGoogleGenerativeAI + structured output |
| Task 2: Approval gate | `b33c95f` | feat | interrupt_before=["evals"], MemorySaver checkpointer, Command(resume) in CLI |
| Task 3: LangSmith tracing | `b33c95f` | feat | Env-var activation in __main__.py with status print |

Bulk commit: `b33c95f feat: Agent Rescue Room through Phase 3 plan 01`. Contains Phase 1 + 2 + 3.01 work bundled from the initial repo push.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `rescue/nodes/evals.py` | Modified | Stub → LLM eval generator using EvalCaseList wrapper for Gemini |
| `rescue/nodes/debrief.py` | Modified | Stub → LLM memo writer using CustomerDebrief as direct structured output |
| `rescue/graph.py` | Modified | Added interrupt_before=["evals"] and MemorySaver checkpointer to compile() |
| `rescue/__main__.py` | Modified | Split stream() into pre-gate and post-resume phases; added approval prompt, LangSmith env setup, tracing status line |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| EvalCaseList wrapper around list[EvalCase] | Gemini's structured output requires top-level Pydantic object, not bare list | Future nodes returning list results must wrap; pattern reused for knowledge extraction in post-03-01 work |
| interrupt_before (not sub-graph) for gate | Simpler, more legible on screen share for the interview demo | Keeps graph linear and topology clear at a glance |
| MemorySaver, not a persistent checkpointer | In-process is adequate for demo and CLI; no state needs to survive process restart | Demo-scoped; production would require SqliteSaver or equivalent |
| Tracing activated by env-var presence | No per-node changes, zero code coupling to LangSmith | Enables/disables cleanly from .env; status surfaced at startup |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions (post-03-01, pre-UNIFY) | 4 | Demo-strengthening, no scope creep into 03-01 AC |
| Deferred | 0 | — |

**Total impact:** All AC met on schedule. Additional work shipped between the 03-01 commit and this UNIFY; documented below so the record is accurate.

### Scope Additions (shipped after plan 03-01 commit)

These were not in 03-01 scope but landed before this UNIFY. Logged here rather than back-dating the plan.

**1. Self-improving knowledge base — `learn` node (Stage 7)**
- **Commit:** `7694828 feat: self-improving knowledge base with learn node`
- **What:** New `rescue/nodes/learn.py` extracts reusable failure patterns from each diagnosis into `data/knowledge.json`; classifier loads accumulated patterns on future runs
- **Why added:** Strong interview signal — shows pipeline that improves over time, not just a one-shot flow
- **Scope fit:** Not in 03-01, but complements 03-01's output nodes naturally. Could be folded into 03-02 or a retroactive 03-1b.

**2. StackProof scan scenario + expanded failure taxonomy**
- **Commit:** `684423a feat: StackProof scan scenario + expanded failure taxonomy`
- **What:** Second canned demo in `data/traces/stackproof-scan.json` + `data/stackproof-repo/` fixtures; broader classification categories
- **Why added:** Second demo scenario hardens the "canned, no live APIs" decision — can show two distinct failures in the interview

**3. LangSmith 403 fix**
- **Commit:** `25f40d2 fix: disable LangSmith tracing by default to prevent 403 errors`
- **What:** Tracing only activates when LANGCHAIN_API_KEY *and* account permissions are present
- **Why:** Discovered during end-to-end runs; silent 403s were flooding logs

**4. README + clone URL fix**
- **Commits:** `14cb941 fix: correct clone URL in README`, `937389c feat: rich CLI display, README, and requirements for demo`
- **What:** README draft and requirements.txt shipped ahead of plan 03-02; rich CLI display.py (first pass, VoltAgent palette) was put in place
- **Why:** Continuous work between plans; 03-02 will consolidate the design pass (LangChain-cousin palette swap in progress)

### Deferred Items

None. All in-scope work completed.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Gemini rejected bare `list[EvalCase]` as structured output | Introduced EvalCaseList wrapper (root-level Pydantic object); pattern reused later for knowledge extraction |
| LangSmith 403 errors without permissions flooded output | Post-03-01 fix (`25f40d2`) gated tracing behind key *and* successful auth |

## Next Phase Readiness

**Ready:**
- All 6 nodes operational on real LLM output
- Approval gate and tracing visible in CLI — story for the interview is complete
- Two demo scenarios available (`research-agent-failure.json`, `stackproof-scan.json`)

**Concerns:**
- `937389c` shipped a first-pass rich CLI display ahead of 03-02's "design-first checkpoint" — 03-02 should refine rather than rebuild
- learn node shipped without its own plan/summary — one-off; acceptable for demo-scoped project but a plan should cover it if this becomes anything beyond a demo

**Blockers:** None.

---
*Phase: 03-outputs-integration, Plan: 01*
*Completed: 2026-04-15*
