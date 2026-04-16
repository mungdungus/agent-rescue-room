# Incident: StackProof Dual-Agent Scan Returns Zero AI Findings

## What happened
Production scan of `mungdungus/agent-rescue-room` (public repo, 33 files, Python/LangGraph project) completed in 121 seconds with a score of 85/B. However, all 8 findings came from deterministic regex scanning. The dual AI agents (gemini-2.5-pro + gemini-2.5-flash) returned zero findings despite running for the full duration.

## Evidence
- `aiChecksRun: 0` in tribunal metadata
- `citationsVerified: 0`
- `hallucinationsRejected: 0`
- All findings have `source: deterministic`
- Career packet completely empty (0 skills, 0 bullets, default tier)
- Agreement rate shows 100% but only because deterministic findings auto-agree

## Expected behavior
Dual agents should identify security issues, code quality concerns, and architecture patterns in the actual Python source code (schemas, graph construction, LLM prompts, tool definitions). The career analyzer should detect LangGraph, LangChain, Gemini, and structured output skills.

## User-reported pattern
"We have not gotten good results from scans yet." This suggests the zero-AI-findings problem is systemic, not specific to this repo.

## Suspected causes
1. AI agents return JSON but `normalizeFindings()` drops all findings due to missing required fields
2. v2 prompt + `enforceSharedContract` rejects findings missing `evidence_status`, `confidence`, or `claim_type`
3. `responseMimeType: 'application/json'` may interact poorly with new Gemini models
4. Career prompt may not handle Python/AI-framework repos well
