#!/usr/bin/env python3
"""
Convert StackProof NDJSON scan output to Agent Rescue Room trace format.

Usage:
    python scripts/ndjson-to-trace.py data/traces/stackproof-scan-raw.ndjson
    python scripts/ndjson-to-trace.py data/traces/stackproof-scan-raw.ndjson -o data/traces/stackproof-scan.json
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def ndjson_to_trace(ndjson_path: str, output_path: str | None = None) -> list[dict]:
    events = []
    with open(ndjson_path) as f:
        for line in f:
            line = line.strip()
            if line:
                events.append(json.loads(line))

    trace = []
    base_time = datetime.now(timezone.utc)

    # Map NDJSON events to Rescue Room TraceEvent format
    for i, event in enumerate(events):
        etype = event.get("type", "unknown")
        phase = event.get("phase", "")
        model = event.get("model", "System")
        status = event.get("status", "")
        message = event.get("message", "")
        stats = event.get("stats", {})

        # Determine trace event type
        if etype == "init":
            trace_type = "routing"
            node = "coordinator"
        elif phase in ("fetch_repo", "fetch", "snapshot"):
            trace_type = "retrieval"
            node = "fetch"
        elif phase == "triage":
            trace_type = "routing"
            node = "triage"
        elif phase == "deterministic":
            trace_type = "tool_call"
            node = "deterministic_scanner"
        elif phase == "dual_agent_chunk":
            trace_type = "llm_response"
            node = "dual_agent"
        elif phase == "reconciliation":
            trace_type = "routing"
            node = "reconciler"
        elif phase == "career":
            trace_type = "llm_response"
            node = "career_analyzer"
        elif etype == "result":
            trace_type = "output"
            node = "coordinator"
        elif etype == "error":
            trace_type = "error"
            node = "coordinator"
        elif etype == "progress":
            continue  # Skip progress-only events
        else:
            trace_type = "routing"
            node = phase or "unknown"

        trace_event = {
            "node": node,
            "type": trace_type,
            "timestamp": (base_time.isoformat()).replace("+00:00", "Z"),
            "input": {},
            "output": {},
            "metadata": {
                "model": model,
                "note": message,
            },
        }

        # Add context based on event type
        if stats:
            trace_event["metadata"].update(stats)

        if etype == "result":
            data = event.get("data", {})
            analysis = data.get("analysis", {})
            report = analysis.get("tribunalReport", {})
            meta = report.get("metadata", {})

            trace_event["output"] = {
                "score": report.get("finalScore"),
                "grade": report.get("grade"),
                "findings_count": len(report.get("findings", [])),
                "ai_checks_run": meta.get("aiChecksRun", 0),
                "citations_verified": meta.get("citationsVerified", 0),
                "hallucinations_rejected": meta.get("hallucinationsRejected", 0),
                "agreement_rate": report.get("agreementRate"),
                "analysis_time_ms": meta.get("analysisTimeMs"),
                "finding_sources": {},
            }

            # Count findings by source
            sources = {}
            for f in report.get("findings", []):
                src = f.get("source", "unknown")
                sources[src] = sources.get(src, 0) + 1
            trace_event["output"]["finding_sources"] = sources

            # Include the full findings for diagnosis
            trace_event["output"]["findings"] = report.get("findings", [])
            trace_event["output"]["positives"] = report.get("positives", [])

            # Career packet summary
            career = analysis.get("careerPacket", {})
            skills = career.get("skillsSummary", {})
            total_skills = sum(len(v) for v in skills.values() if isinstance(v, list))
            trace_event["output"]["career_packet"] = {
                "skills_detected": total_skills,
                "primary_bullets": len(career.get("primaryBullets", [])),
                "tier_fit": career.get("companyTierFit", {}).get("recommendedTier"),
                "confidence": career.get("companyTierFit", {}).get("confidence"),
            }

        if etype == "activity" and phase == "dual_agent_chunk":
            trace_event["input"] = {
                "model_role": event.get("modelRole", ""),
                "explainer": event.get("explainer", ""),
            }

        trace.append(trace_event)

    # Write output
    out_path = output_path or ndjson_path.replace("-raw.ndjson", ".json")
    with open(out_path, "w") as f:
        json.dump(trace, f, indent=2)

    print(f"Converted {len(events)} NDJSON events -> {len(trace)} trace events")
    print(f"Output: {out_path}")
    return trace


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/ndjson-to-trace.py <input.ndjson> [-o output.json]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = None
    if "-o" in sys.argv:
        idx = sys.argv.index("-o")
        if idx + 1 < len(sys.argv):
            output_path = sys.argv[idx + 1]

    ndjson_to_trace(input_path, output_path)
