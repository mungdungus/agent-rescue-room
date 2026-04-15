# Research Agent

Automated prospect research and outbound email generation.

## Flow

1. **Retrieve context** from company knowledge base
2. **Verify claims** against live web data
3. **Human approval** before sending (required by POLICY-003)
4. **Draft email** from verified research
5. **Send email** to prospect

## Requirements

- All external communications require human sign-off (POLICY-003)
- Financial data must be verified against current sources
- Tool failures must be surfaced, not swallowed
