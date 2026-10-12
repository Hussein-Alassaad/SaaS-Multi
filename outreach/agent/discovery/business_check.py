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
import re
import time

from agent import config
from agent.analysis import client as claude_client

_log = logging.getLogger("agent.discovery.progress")

# 2026-10-10, owner's instruction: leads must be qualified Lebanese businesses.
# An "unsure" model verdict used to keep the candidate; in the first confirmed
# batch (15/15 saved were "confirmed", none "unsure") the model almost never
# says unsure, so rejecting it costs nearly no yield. An API FAILURE is still
# kept (fail-open) -- that is an outage, not a judgement. Set False to revert.
REJECT_UNSURE = True
# 2026-10-11: an API FAILURE now rejects too (it used to keep the candidate).
# The API balance running out would otherwise silently turn the check off and
# let every unvetted account through. Discovery also pre-flights is_available()
# and skips the night when the check is down. Set False to revert.
REJECT_ON_FAILURE = True

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


# ADDED 2026-10-11/12: STRICT RULE-BASED FALLBACK for when the AI cannot be
# reached (the Anthropic balance ran out on 2026-10-11 and a whole night's
# discovery was skipped, which the owner rightly called a bug-level outcome).
# Used ONLY while the API is down. It is deliberately stricter than the AI: a
# candidate needs BOTH clear Lebanese evidence AND clear business signals, and
# anything that reads like a creator, media page, club or institution is
# rejected -- so an outage costs yield, never quality.
_LEBANON_MARKERS = (
    "lebanon", "lebanese", "liban", "libanais", "beirut", "beyrouth", "tripoli", "jounieh", "byblos",
    "jbeil", "saida", "sidon", "tyre", "zahle", "baalbek", "batroun", "aley", "metn", "keserwan",
    "kesrouan", "chouf", "bekaa", "nabatieh", "antelias", "hamra", "achrafieh", "dbayeh", "zalka",
    "dekwaneh", "sin el fil", "hazmieh", "verdun", "naccache", "broummana", "faraya", "jeita",
    "kaslik", "ghazir", "mansourieh", "bourj hammoud", "jal el dib", "dora", "madeinlebanon",
)
_PHONE_LEBANON_RE = re.compile(r"(\+?961[\s.\-]?\d|\b0?(?:3|70|71|76|78|79|81)[\s.\-]?\d{3}[\s.\-]?\d{3}\b)")
_ARABIC_RE = re.compile("[\u0600-\u06FF]")
_LB_HANDLE_RE = re.compile(r"(^|[._])lb($|[._\d])|\.lb$|[a-z]{3,}lb$|lebanon|leb(?![a-z])")
_BUSINESS_WORDS = (
    "shop", "store", "boutique", "restaurant", "cafe", "coffee", "bakery", "hotel", "resort", "company",
    "co.", "sal", "sarl", "factory", "supplier", "supply", "wholesale", "retail", "trading", "distribut",
    "import", "export", "services", "solutions", "agency", "studio", "clinic", "pharmacy", "salon",
    "showroom", "order now", "delivery", "branch", "since 19", "since 20", "our products", "we offer",
    "equipment", "engineering", "construction", "contracting", "furniture", "garage", "auto", "tires",
    "spare parts", "real estate", "properties", "apartments", "hospital", "school", "academy", "gym",
    "ltd", "group", "industries", "manufactur", "workshop", "printing", "design", "decor", "handmade",
)
_CREATOR_WORDS = (
    "influencer", "blogger", "vlogger", "content creator", "digital creator", "travel guide", "tourism guide",
    "news", "magazine", "podcast", "radio", "meme", "fan page", "fanpage", "community", "municipality",
    "ngo", "foundation", "student club", "university club", "personal brand", "coach", "freelanc",
    "my journey", "lifestyle", "photographer", "model ", "dj ", "explorer", "habibe", "vibes", "quotes",
)


def _system_for(seller_domain: str | None) -> list[dict]:
    """The screening prompt, plus -- when the seller's line of business is known --
    an instruction to also flag COMPETITORS (owner's instruction 2026-10-12: never
    discover, write to or send to a company in the seller's own domain)."""
    if not seller_domain:
        return _SYSTEM
    extra = (
        "\n\nThe business doing this outreach: " + seller_domain + "\n"
        "ALSO include a boolean field \"competitor\" in the JSON object: true if this account is a company "
        "in the SAME line of business as that seller (it sells, installs or services the same kind of thing, "
        "so it is the seller's competitor and not a customer), otherwise false."
    )
    return [{"type": "text", "text": _SYSTEM[0]["text"] + extra}]


def _rule_based_verdict(profile: dict) -> tuple[bool, str]:
    handle = (profile.get("handle") or "").lower()
    name = profile.get("display_name") or ""
    bio = profile.get("bio") or ""
    text = f"{name} {bio} {handle}".lower()

    for word in _CREATOR_WORDS:
        if word in text:
            return False, f"rule-based: reads like a creator/media/community page ({word.strip()!r})"

    lebanese = (
        any(m in text for m in _LEBANON_MARKERS)
        or bool(_PHONE_LEBANON_RE.search(bio))
        or bool(_ARABIC_RE.search(name + bio))
        or bool(_LB_HANDLE_RE.search(handle))
    )
    if not lebanese:
        return False, "rule-based: no clear Lebanese evidence (place, +961 number, Arabic text or .lb handle)"

    business = any(w in text for w in _BUSINESS_WORDS) or "@" in bio or bool(_PHONE_LEBANON_RE.search(bio))
    if not business:
        return False, "rule-based: no clear business signals in the name or bio"
    return True, "rule-based fallback: Lebanese evidence and business signals present"


# After one failed API call, skip the API for a while and go straight to the
# fallback (no point hammering an empty balance once per candidate).
_ai_down_until = 0.0
_AI_DOWN_BACKOFF_SECONDS = 600


def is_available() -> bool:
    """One tiny real API call: True if the model can currently be reached."""
    if not claude_client.is_configured():
        return False
    try:
        claude_client.call_text(_SYSTEM, "ping", config.MODEL_ANALYSIS, max_tokens=5)
        return True
    except Exception as exc:  # noqa: BLE001
        _log.warning("[business_check] availability probe failed: %s", exc)
        return False


def classify(profile: dict) -> tuple[bool, str] | None:
    """
    Returns (True, "category: reason") when the model is confident it IS a
    Lebanese business, (False, "category: reason") when confident it is NOT,
    or None (keep the candidate) on unsure / any failure.
    """
    global _ai_down_until
    if not claude_client.is_configured() or time.time() < _ai_down_until:
        return _rule_based_verdict(profile) if REJECT_ON_FAILURE else None

    user_content = (
        f"Handle: @{profile.get('handle') or 'unknown'}\n"
        f"Display name: {profile.get('display_name') or 'unknown'}\n"
        f"Bio: {(profile.get('bio') or '').strip()[:500] or '(empty)'}\n"
        f"Followers: {profile.get('follower_or_headcount')}\n"
        f"Posts: {profile.get('post_count')}\n"
        f"Sample post caption: {(profile.get('sample_caption') or '').strip()[:300] or '(none)'}"
    )
    try:
        answer = claude_client.call_json(
            _system_for(profile.get("seller_domain")), user_content, config.MODEL_ANALYSIS, max_tokens=200,
        )
    except Exception as exc:  # noqa: BLE001 -- fail open, never block discovery on an AI hiccup
        _log.warning("[business_check] @%s: AI check failed (%s) -- using the strict rule-based fallback", profile.get("handle"), exc)
        _ai_down_until = time.time() + _AI_DOWN_BACKOFF_SECONDS
        return _rule_based_verdict(profile) if REJECT_ON_FAILURE else None

    verdict = str(answer.get("verdict", "")).strip().lower()
    detail = f"{answer.get('category', '?')}: {answer.get('reason', '')}".strip()
    if profile.get("seller_domain") and answer.get("competitor") is True:
        _log.info("[business_check] @%s -> competitor (%s)", profile.get("handle"), detail)
        return False, f"competitor: {detail}"
    _log.info("[business_check] @%s -> %s (%s)", profile.get("handle"), verdict or "invalid", detail)
    if verdict == "no":
        return False, detail
    if verdict == "yes":
        return True, detail
    if verdict == "unsure" and REJECT_UNSURE:
        return False, f"unsure: {detail}"
    return None
