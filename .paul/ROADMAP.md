---
project: Agent Rescue Room
created: 2026-04-15
---

## Milestone v0.1: Working demo

Goal: Deterministic CLI demo that processes a canned failed trace through diagnosis, eval generation, and customer debrief. Runs in under 90 seconds, explainable to a recruiter.

| Phase | Name | Status | Depends on |
|-------|------|--------|------------|
| 1 | Data layer + graph skeleton | Complete | none |
| 2 | Analysis pipeline | Complete | Phase 1 |
| 3 | Outputs + integration | Planning | Phase 2 |

### Phase 1: Data layer + graph skeleton
Create the canned demo scenario (failed research agent trace), define all Pydantic schemas for the pipeline, and build the StateGraph skeleton with stub nodes. Adapt reusable patterns from the StackProof scaffold. Output: graph compiles and runs with stubs, trace data parses cleanly.

### Phase 2: Analysis pipeline
Implement the core analysis nodes: trace ingestor (normalize events), failure classifier (categorize with confidence scores), repo grounding engine (map failures to source code), and tribunal diagnoser (two-agent challenge pattern). Output: given a trace, the pipeline produces a validated diagnosis with evidence.

### Phase 3: Outputs + integration
Implement eval generator (regression fixtures from the incident), customer debrief writer (plain-English memo), human approval gate (interrupt_before). Wire CLI entry point, enable LangSmith tracing, run end-to-end. Create GitHub-ready README. Output: complete demo, push to GitHub.
