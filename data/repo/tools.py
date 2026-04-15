"""
Customer's tool definitions — the buggy version.

Bug: web_search has no retry logic or fallback.
When rate-limited, it raises an error that the calling
node swallows instead of propagating.
"""

import httpx
from langchain_core.tools import tool


@tool
def web_search(query: str, max_results: int = 3) -> str:
    """Search the web for current information.

    Args:
        query: Search query string
        max_results: Maximum results to return
    """
    # No retry logic. No rate limit handling.
    # No fallback to cached results.
    response = httpx.get(
        "https://api.search-provider.com/v1/search",
        params={"q": query, "limit": max_results},
        timeout=10,
    )
    response.raise_for_status()
    return response.text


@tool
def send_outbound_email(to: str, subject: str, body: str) -> str:
    """Send an email to a prospect.

    Args:
        to: Recipient email address
        subject: Email subject line
        body: Email body text
    """
    # No approval check before sending.
    # Trusts that the graph enforced approval upstream.
    return f"Email sent to {to}"


TOOLS = [web_search, send_outbound_email]
