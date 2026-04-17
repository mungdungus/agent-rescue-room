---
project: Agent Rescue Room
created: 2026-04-15
last_updated: 2026-04-17
---

## Milestone v0.1: Working demo — ✅ COMPLETE

Goal: Deterministic CLI demo that processes a canned failed trace through diagnosis, eval generation, and customer debrief. Runs in under 90 seconds, explainable to a recruiter.

**Status:** 3 of 3 phases complete · all plans unified · public GitHub repo live at `github.com/mungdungus/agent-rescue-room`

| Phase | Name | Status | Plans | Completed | Depends on |
|-------|------|--------|-------|-----------|------------|
| 1 | Data layer + graph skeleton | ✅ Complete | 1/1 | 2026-04-15 | none |
| 2 | Analysis pipeline | ✅ Complete | 1/1 | 2026-04-15 | Phase 1 |
| 3 | Outputs + integration | ✅ Complete | 2/2 | 2026-04-17 | Phase 2 |

### Phase 1: Data layer + graph skeleton — ✅ Complete
Created the canned demo scenario (failed research agent trace), defined all Pydantic schemas for the pipeline, and built the StateGraph skeleton with stub nodes. Adapted reusable patterns from the StackProof scaffold. **Output:** graph compiles and runs with stubs, trace data parses cleanly.

### Phase 2: Analysis pipeline — ✅ Complete
Implemented the core analysis nodes: trace ingestor (normalize events), failure classifier (categorize with confidence scores), repo grounding engine (map failures to source code via tool calls), and tribunal diagnoser (two-agent challenge pattern). **Output:** given a trace, the pipeline produces a validated diagnosis with evidence.

### Phase 3: Outputs + integration — ✅ Complete
**Plan 01:** Implemented eval generator (regression fixtures from the incident), customer debrief writer (plain-English memo), human approval gate (`interrupt_before` + `MemorySaver` + `Command(resume)`). Wired CLI entry point and enabled LangSmith tracing. Scope additions landed post-plan: self-improving knowledge base (`learn` node), StackProof scan scenario, LangSmith 403 fix.

**Plan 02:** LangChain-cousin CLI palette and square-geometry panels in `rescue/display.py`. README accuracy pass (7-stage architecture diagram, correct palette reference). Public GitHub push.

**Output:** complete demo, pushed to GitHub, screen-share ready for the Friday interview.

## Next

Milestone v0.1 meets the interview deadline. Open options after the interview:

- **v0.2 — Hardening**: persistent checkpointer, real LangSmith integration beyond toggling, live-trace ingestion from LangSmith API, packaging polish (pyproject.toml rich dep + floor reconciliation)
- **v0.2 — Scope**: additional demo scenarios, more failure taxonomies, integration with a chat-UI front-end
- **Pause and ship** as-is — the v0.1 artifact is already interview-ready

No milestone scoped yet beyond v0.1.
