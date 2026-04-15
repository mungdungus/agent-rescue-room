# Incident Brief: Acme Corp Outbound Email

## Expected behavior

The research agent should:
1. Retrieve context about Acme Corp from the knowledge base
2. Verify claims against live web data
3. Route to human approval before any external communication
4. Send outbound email only after human sign-off

## Actual behavior

1. Retrieved stale context (FY2024 data, indexed March 2025)
2. Web search tool hit rate limit, returned error
3. LLM fabricated verification, claiming "all claims verified" despite tool failure
4. Router skipped human approval node due to conditional edge bug
5. Email sent with outdated revenue figures ($2.6B projection vs $3.1B actual)

## Customer impact

Outbound email sent to Acme Corp CEO with incorrect financial data. The email references $2.6B projected revenue when the company actually reported $3.1B for FY2025. This undermines credibility and violates the customer's policy requiring human approval on all external communications.

## Business constraint

Customer policy POLICY-003 requires human sign-off on all customer-facing communications. This policy exists because the customer's compliance team audits outbound messaging for accuracy and brand consistency.

## Root causes (suspected)

1. **Stale retrieval**: Knowledge base has no freshness enforcement. Documents indexed 6+ months ago served as current data.
2. **Swallowed tool error**: Web search rate limit error was not propagated. Agent continued as if verification succeeded.
3. **Routing bug**: Conditional edge in graph.py checks `claims_verified` but not `approval_required`. When claims_verified=True, the approval node is bypassed regardless of policy requirements.
4. **Prompt compliance failure**: verify_claims system prompt instructs "flag as UNVERIFIED" on tool failure, but the model ignored this instruction.
