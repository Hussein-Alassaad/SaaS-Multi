"""
AI "is this a Lebanese business?" gate for Instagram discovery.

Added 2026-10-09, owner's complaint after a real night's batch: of 15
Instagram leads only 1 fit. The rest were a Bahrain and a Libya agency, a
1M-follower US creator, a travel guide, a municipality, a nonprofit, and
several individual people. Root cause: qualify_profile()'s Instagram path
only rejects on foreign RED FLAGS, so any account with a quiet bio passes --
nothing ever asked for positive evidence of "a business, in Lebanon".

One cheap Haiku call per candidate that already survived the deterministic
checks. FAILS OPEN: any API error, missing key, empty or unparseable answer,
or an "unsure" verdict returns None and the candidate is kept. The earlier
6-of-167 collapse was caused by a strict hard-reject on weak evidence; this
gate only rejects when the model is confident the account is NOT a Lebanese
business, and names the category.
"""

from __future__ import annotations

import logging

from agent import config
from agent.analysis import client as claude_client

_log = logging.getLogger("agent.discovery.progress")

_SYSTEM = [{
    "type": "text",
    "text": (
        "You screen Instagram accounts for a B2B outreach tool selling to companies based in Lebanon.\n"
        "Decide whether the account is a BUSINESS (a company, shop, agency, clinic, factory, restaurant, "
        "school-as-a-business, etc.) that operates in Lebanon.\n\n"
        "Answer \"no\" ONLY when you are confident it is one of:\n"
        "- an individual person (including a named freelancer, coach, consultant or personal brand)\n"
        "- a creator, influencer, vlogger, meme/fan page, or lifestyle/travel/news/aggregator content page\n"
        "- a government body, municipality, nonprofit, NGO, student club or community group\n"
        "- clearly based outside Lebanon (other country in name, handle or bio, a non-Lebanese country "
        "flag, a foreign country-code like .bh/.ly/.ae/.sa, or an audience clearly in another country)\n\n"
        "A marketing/media/creative AGENCY or company is a business (\"yes\") if it is Lebanese. "
        "Answer \"yes\" when it looks like a real Lebanese business. Answer \"unsure\" if you cannot tell "
        "either way -- do not guess \"no\" on thin information.\n\n"
        "Respond with ONLY a JSON object: "
        "{\"verdict\": \"yes\"|\"no\"|\"unsure\", \"category\": \"<short label>\", \"reason\": \"<one short sentence>\"}"
    ),
}]


def classify(profile: dict) -> tuple[bool, str] | None:
    """
    Returns (is_business, "category: reason") when the model is confident,
    or None (keep the candidate) on unsure / any failure.
    """
    if not claude_client.is_configured():
        return None

    user_content = (
        f"Handle: @{profile.get('handle') or 'unknown'}\n"
        f"Display name: {profile.get('display_name') or 'unknown'}\n"
        f"Bio: {(profile.get('bio') or '').strip()[:500] or '(empty)'}\n"
        f"Followers: {profile.get('follower_or_headcount')}\n"
        f"Posts: {profile.get('post_count')}"
    )
    try:
        answer = claude_client.call_json(_SYSTEM, user_content, config.MODEL_ANALYSIS, max_tokens=200)
    except Exception as exc:  # noqa: BLE001 -- fail open, never block discovery on an AI hiccup
        _log.warning("[business_check] @%s: AI check failed (%s) -- keeping candidate", profile.get("handle"), exc)
        return None

    verdict = str(answer.get("verdict", "")).strip().lower()
    detail = f"{answer.get('category', '?')}: {answer.get('reason', '')}".strip()
    _log.info("[business_check] @%s -> %s (%s)", profile.get("handle"), verdict or "invalid", detail)
    if verdict == "no":
        return False, detail
    return None
