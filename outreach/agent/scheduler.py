"""
Runs each tenant's accounts at their own configured times.

PORTED 2026-08-20 to be multi-tenant (see PROGRESS.md's dated entry for the
full writeup). Every orchestration function below now loops over
repo.list_active_tenant_ids() -- every tenant with at least one active
LinkedIn or Instagram OutreachAccount row -- and, within each tenant, over
that tenant's own due accounts (see core/account_pool.py). Each tenant's
whole slice of a cycle runs inside `with repo.tenant_scope(tenant_id):`,
which is what lets every downstream call into messaging/*, crm/*,
sending/*, notifications/*, and core/health.py|warmup.py -- none of which
were changed by this port, none of which know tenant_id exists -- resolve
the right tenant's rows without their call signatures changing (see
db/repositories.py's module docstring, "DISCREPANCY FLAGGED" section, for
why that fallback exists).

Error isolation now has ONE MORE level than before the port: one tenant's
failure must not stop other tenants' processing, in addition to the
existing one-account/one-lead/one-message isolation already in place below.

Two ways to use this module:
  - `run_cycle(...)` does the real work for whichever accounts are due right
    now (or a forced list, for manual testing) -- this is what Phase 2 tests.
  - `build_daily_schedule(...)` wires up APScheduler cron jobs at each
    account's real run_time, for the always-on server from Phase 10 onward.
    It is not exercised during local development, where nothing runs a
    permanent background process.

Manual test trigger (what "Hussein can trigger a run" means in Phase 2):

    agent/venv/Scripts/python.exe -m agent.scheduler
"""

from __future__ import annotations

import datetime as dt
import logging
import random
import re
import time

from zoneinfo import ZoneInfo

from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger

from agent import config
from agent.analysis import analyze
from agent.analysis import founder as founder_detection
from agent.analysis import score as scoring
from agent.analysis import whatsapp_detect
from agent.core import account_pool as pool
from agent.core import health
from agent.core import warmup
from agent.core.session import ProxyIpMismatch, SessionManager
from agent.crm import followup
from agent.db import repositories as repo
from agent.discovery import findymail, hunter, icypeas, instagram, linkedin
from agent.discovery.qualify import qualify_profile
from agent.discovery.qualify import _is_agency as _lead_is_agency
from agent.messaging import approval
from agent.messaging import generate as message_generate
from agent.messaging import style as message_style
from agent.notifications import whatsapp_notify
from agent.sending import (
    instagram_reply_check,
    instagram_send,
    linkedin_reply_check,
    linkedin_send,
    whatsapp_reply_check,
    whatsapp_send,
)
from agent.sending.instagram_send import NoExistingThread as InstagramNoExistingThread
from agent.sending.instagram_send import NoMessageButtonAvailable as InstagramNoMessageButtonAvailable
from agent.sending.instagram_send import SessionLoggedOut as InstagramSessionLoggedOut
from agent.sending.instagram_send import _raise_if_logged_out as _raise_if_instagram_logged_out
from agent.sending.linkedin_send import MessageLengthInvalid, NoMessageButtonAvailable, PageMessagingRateLimited
from agent.sending.linkedin_send import NoExistingThread as LinkedInNoExistingThread
from agent.sending.whatsapp_send import WhatsAppNotConfigured

# Phase 2 has no real discovery yet -- this is a harmless, neutral page used
# purely to prove a session can open, navigate, and be health-checked. Phase 3
# replaces this with the actual LinkedIn/Instagram search entry points.
DEFAULT_TEST_URL = "https://example.com"

# LIVE-VERIFIED 2026-09-01: LinkedIn's company search requires a real,
# non-empty text keyword -- an empty niche (even paired with a real
# companyHqGeo facet) returns 0 results, confirmed against a live run.
# Generic filler words ("companies", "company", "business") also returned 0
# in earlier live testing; only genuine industry/sector terms return real
# results. For a tenant configured to target "any type of company" (empty
# settings.target_niche), one of these is picked at random each discovery
# cycle instead of searching with no keyword at all -- see
# _resolve_search_niche() below.
# 2026-09-02, real instruction from the platform owner (Insurance specifically):
# target companies of EVERY type EXCEPT insurance companies themselves --
# insurance is deliberately absent from this list (it's the tenant's own
# industry, not a prospect). Expanded to a real, broad list per the
# owner's explicit ask ("make a list for them" covering trading/software/
# commercial/general/any type) so rotation genuinely reaches a wide mix of
# real Lebanese companies over many runs, not a narrow handful of sectors.
_RANDOM_INDUSTRY_TERMS = [
    "manufacturing",
    "trading",
    "general trading",
    "construction",
    "technology",
    "software",
    "IT services",
    "retail",
    "logistics",
    "real estate",
    "consulting",
    "healthcare",
    "hospitality",
    "education",
    "transportation",
    "commercial",
    "general commercial",
    "engineering",
    "food and beverage",
    "distribution",
    "import export",
    "textile",
    "pharmaceutical",
    "automotive",
    "media",
    "advertising",
    "telecommunications",
    "energy",
    "agriculture",
    "banking",
]


# A configured niche that describes a SERVICE rather than a kind of company
# is a trap on both platforms: it finds the people who sell that service,
# not the companies who buy it. MJivity's real configured niche was "small
# business marketing", which on Instagram returns marketing coaches and
# agencies -- and on LinkedIn returns marketing agencies -- when what
# MJivity actually wants is product brands that need 3D visuals. Confirmed
# 2026-09-13 against its real returned leads (Indian marketing influencers).
# A niche matching one of these is treated as "no usable niche" and the
# tenant's own target_industry list is rotated instead.
_SERVICE_NOT_SECTOR_NICHES = {
    "small business marketing",
    "business marketing",
    "marketing",
    "digital marketing",
    "social media marketing",
    "advertising",
    "branding",
}


def _industry_rotation_terms(target_industry: str) -> list[str]:
    """
    Split a tenant's free-text target_industry into individual searchable
    sector terms.

    A tenant like MJivity configures this as a real list -- "E-commerce
    brands, consumer products, fashion & apparel, cosmetics & beauty,
    jewelry, technology, automotive, ..." -- which is exactly the rotation
    material _RANDOM_INDUSTRY_TERMS provides for the generic case, but
    specific to what this tenant actually sells to. Splitting on commas and
    slashes keeps each sector intact; "&" is dropped because LinkedIn and
    Instagram both treat it as noise, and over-long prose fragments are
    skipped since they are a description, not a search term.
    """
    if not target_industry:
        return []
    parts = re.split(r"[,/;]| and ", target_industry)
    terms: list[str] = []
    for part in parts:
        cleaned = part.replace("&", " ").strip().strip(".")
        cleaned = re.sub(r"\s+", " ", cleaned)
        # Drop parentheticals like "holding companies (multi-brand groups)".
        cleaned = re.sub(r"\s*\([^)]*\)", "", cleaned).strip()
        if 3 <= len(cleaned) <= 40 and len(cleaned.split()) <= 4:
            terms.append(cleaned)
    return terms


def _resolve_search_niche(niche: str, target_industry: str = "") -> str:
    """
    A configured niche is used as-is. An empty niche means "target any type
    of company" -- but LinkedIn's search has no such mode, so this picks a
    real industry term at random instead of searching with an empty
    keyword (which live-verified returns 0 results). Called once per
    discovery cycle, so a fresh random term is picked each run -- over many
    runs this covers a broad mix of industries rather than the same one
    every time.

    A niche that names a SERVICE rather than a sector (see
    _SERVICE_NOT_SECTOR_NICHES) falls back to the tenant's OWN
    target_industry sectors, since that tenant has told us what it sells to
    even though its niche field says what it sells.

    An EMPTY niche deliberately does NOT use target_industry: the owner's
    standing instruction for Zimmar and Insurance is "all companies", and
    those two tenants fill target_industry with facility types ("Offices,
    warehouses, schools") or prose ("Any industry -- targeting is by company
    size"), neither of which is a usable search term. The broad
    _RANDOM_INDUSTRY_TERMS rotation is the correct behavior there.
    """
    if not niche:
        return random.choice(_RANDOM_INDUSTRY_TERMS)
    if niche.strip().lower() not in _SERVICE_NOT_SECTOR_NICHES:
        return niche
    tenant_terms = _industry_rotation_terms(target_industry)
    if tenant_terms:
        return random.choice(tenant_terms)
    return random.choice(_RANDOM_INDUSTRY_TERMS)


# Ordered smallest-to-largest so _resolve_size_buckets can walk it once and
# stop -- must match linkedin.COMPANY_SIZE_FACETS' own keys exactly.
_COMPANY_SIZE_BUCKET_RANGES: list[tuple[str, int, int | None]] = [
    ("1-10", 1, 10),
    ("11-50", 11, 50),
    ("51-200", 51, 200),
    ("201-500", 201, 500),
    ("501-1000", 501, 1000),
    ("1001-5000", 1001, 5000),
    ("5001-10000", 5001, 10000),
    ("10000+", 10001, None),
]


def _resolve_size_buckets(min_company_size: int | None) -> list[str] | None:
    """
    Turns a tenant's exact targetCompanySizeMin (e.g. Insurance's 51) into
    the LinkedIn companySize facet buckets that could contain a match --
    every bucket whose own range reaches at least that minimum. This is a
    coarse PRE-filter only, run server-side by LinkedIn's own search before
    we ever visit a profile -- the exact cutoff is still enforced precisely
    afterward by qualify_profile()'s own headcount check (a bucket can
    contain companies both above and below the real minimum, e.g. "51-200"
    for a minimum of 51 also contains a 60-employee company, which is
    fine, and would contain a 55-employee one too, also fine -- the only
    bucket ever excluded is one that CAN'T contain a qualifying company at
    all).

    None/0 (no minimum configured, e.g. Zimmar after the owner's explicit
    2026-09-12 "all sizes" instruction) returns None -- no facet added at
    all, searches every size, exactly as build_search_url's own docstring
    describes for that case.
    """
    if not min_company_size:
        return None
    return [
        label for label, _low, high in _COMPANY_SIZE_BUCKET_RANGES
        if high is None or high >= min_company_size
    ]

# Exceptions that represent a normal, expected "can't do this one thing"
# outcome rather than a genuine failure worth flagging -- e.g. a LinkedIn
# company page simply not having Page messaging enabled. Used by log_error()
# below so the dashboard's Errors page can separate real problems from
# routine skip reasons by default (see database/007_add_error_log.sql).
_EXPECTED_EXCEPTIONS = (
    NoMessageButtonAvailable,
    MessageLengthInvalid,
    WhatsAppNotConfigured,
    LinkedInNoExistingThread,
    InstagramNoMessageButtonAvailable,
    InstagramNoExistingThread,
)

# Plain stdout logger for real-time discovery progress -- distinct from
# log_error() below, which writes to the DB error_log table for the
# dashboard's Errors page. Added 2026-09-13 after a real 30+ minute
# discovery run showed zero visible progress in the logs, and the owner
# had to ask "how to check where is the real problem" -- there was
# genuinely no way to tell, from the logs alone, whether a long run was
# stuck or just slow. server.py already calls logging.basicConfig(), so
# this logger's output reaches docker logs the same way that one does.
_progress_log = logging.getLogger("agent.discovery.progress")


def log_error(
    stage: str,
    exc: Exception,
    *,
    channel: str | None = None,
    lead_id: str | None = None,
    account_id: str | None = None,
) -> None:
    """
    Record one caught pipeline failure to error_log so it's visible on the
    dashboard's Errors page instead of only existing in an in-memory results
    list that gets discarded the moment the calling function returns --
    every try/except block below already isolates one bad lead/message from
    stopping a whole run, this just stops the exception's details from
    being silently thrown away once that's done. Never itself raises --
    a logging failure must not turn a handled, isolated error into an
    unhandled one that takes down the whole cycle.

    ALSO logs to stdout (2026-09-16): a SessionBusy on Zimmar LinkedIn's
    sending cron was recorded correctly in error_log, but docker logs
    showed nothing at all for that ~4-minute run -- APScheduler saw the
    job function return its normal results list (one `ok: False` entry)
    and logged "executed successfully", so a real, understood failure
    looked from the logs alone like nothing happened. error_log is the
    dashboard's source of truth and stays the primary record; this stdout
    line exists only so `docker logs` isn't silent about the same event.
    """
    try:
        repo.insert_error({
            "stage": stage,
            "channel": channel,
            "lead_id": lead_id,
            "account_id": account_id,
            "error_message": str(exc),
            "is_expected": isinstance(exc, _EXPECTED_EXCEPTIONS),
        })  # tenant_id resolved from the active tenant_scope(...), see repo.insert_error()'s docstring
    except Exception:  # noqa: BLE001 -- logging itself must never crash the pipeline
        pass
    try:
        _progress_log.warning(
            "[%s] %s%s: %s", stage,
            f"account={account_id} " if account_id else "",
            f"lead={lead_id}" if lead_id else "",
            exc,
        )
    except Exception:  # noqa: BLE001 -- logging itself must never crash the pipeline
        pass


def run_cycle(target_url: str = DEFAULT_TEST_URL, force: bool = False) -> list[dict]:
    """
    Run one cycle for whichever accounts are due (or all active accounts, if
    force=True), across every tenant that currently has active Outreach
    accounts. For each account: open an isolated session, visit target_url,
    check its health, and log the outcome as a `runs` row.

    Returns a list of per-account result dicts (each tagged with its
    tenant_id), mainly so a manual test run can print a clear summary of
    what happened to each account.

    Tenant-level isolation: one tenant raising here (e.g. a DB hiccup while
    loading its accounts) is logged and skipped, same as the existing
    per-account try/except inside the loop already isolated one bad account
    from the rest -- this adds the one more level the port asked for so one
    tenant can never take down another tenant's run.
    """
    results = []

    for tenant_id in repo.list_active_tenant_ids():
        try:
            with repo.tenant_scope(tenant_id):
                results.extend(_run_cycle_for_tenant(tenant_id, target_url, force))
        except Exception as exc:  # noqa: BLE001 -- one bad tenant must not stop the others
            try:
                repo.insert_error({
                    "stage": "run_cycle", "error_message": str(exc), "is_expected": False,
                }, tenant_id=tenant_id)
            except Exception:  # noqa: BLE001 -- logging itself must never crash the pipeline
                pass

    return results


def _run_cycle_for_tenant(tenant_id: str, target_url: str, force: bool) -> list[dict]:
    accounts = pool.get_due_accounts(tenant_id, force=force)
    results = []

    if not accounts:
        return results

    today_start = pool.today_start_iso(tenant_id)
    with SessionManager() as sessions:
        for account in accounts:
            # Atomic claim, not the old separate start_run() -- get_due_accounts()'s
            # own has_run_today() check above happened in an earlier, separate
            # query, leaving a real window for a second overlapping process
            # (e.g. server.py's cron firing the same moment a manual test run
            # is in progress) to also see "not run yet" and duplicate this
            # account's work, corrupting the shared browser_profiles session
            # file and doubling its real daily send volume. claim_account_for_run()
            # closes that window with a transaction-scoped advisory lock; None
            # means someone else already claimed this account for today, in
            # which case skip it exactly like "not due" rather than proceeding.
            run = repo.claim_account_for_run(tenant_id, account["id"], today_start, skip_daily_check=force)
            if run is None:
                continue
            try:
                context, page, new_verified_ip = sessions.open(account)
            except ProxyIpMismatch as exc:
                # Hard stop for THIS account only -- see
                # _run_discovery_cycle_for_tenant's identical handling for
                # the full reasoning. The mismatched context is already
                # closed by open() before this exception reaches here.
                repo.finish_run(
                    tenant_id, run["id"], leads_found=0, messages_sent=0,
                    status="error", finished_at_iso=dt.datetime.now(dt.timezone.utc).isoformat(),
                    notes=str(exc),
                )
                results.append({
                    "tenant_id": tenant_id, "account": account["label"], "ok": False,
                    "warning_type": "proxy_ip_mismatch", "reason": str(exc),
                })
                continue
            if new_verified_ip:
                repo.update_account(account["id"], {"verified_proxy_ip": new_verified_ip}, tenant_id)

            try:
                response = page.goto(target_url, timeout=15_000)
            except Exception as exc:  # noqa: BLE001 -- navigation failures are expected/handled
                response = None
                nav_error = str(exc)
            else:
                nav_error = None

            ok, warning_type, reason = health.check_navigation(response)
            if ok:
                ok, warning_type, reason = health.check_page_content(page)

            if not ok and nav_error and warning_type == "navigation_failed":
                # Surface Playwright's actual exception text instead of the
                # generic default, since it's more specific and more useful in
                # the dashboard later.
                reason = nav_error

            sessions.close(account["id"], context)

            finished_at = dt.datetime.now(dt.timezone.utc).isoformat()
            if ok:
                repo.finish_run(
                    tenant_id, run["id"], leads_found=0, messages_sent=0,
                    status="completed", finished_at_iso=finished_at,
                )
            else:
                health.record_warning(account["id"], warning_type, reason)
                account["warning_type"], account["warning_reason"] = warning_type, reason
                whatsapp_notify.notify_account_warning(account)
                repo.finish_run(
                    tenant_id, run["id"], leads_found=0, messages_sent=0,
                    status="error", finished_at_iso=finished_at, notes=reason,
                )

            results.append({
                "tenant_id": tenant_id,
                "account": account["label"],
                "ok": ok,
                "warning_type": warning_type,
                "reason": reason,
            })

    return results


# ADDED 2026-09-19: a company's bio text (Instagram especially, but also a
# LinkedIn About description) sometimes spells out a real contact email
# directly, in plain text, with no click or external lookup needed at all --
# e.g. "Reach us: info@company.com" or "orders@shopname.com for wholesale".
# Real audit that day found Instagram leads NEVER got a chance at an email
# through Hunter (that path is LinkedIn-website-domain-only -- Instagram's
# own website field is structurally empty, see instagram.py's
# extract_profile_data() docstring for why), so this bio scan is the one
# email source that costs nothing extra (no click, no API call, no added
# automation risk) and works for both platforms alike. Deliberately a plain,
# conservative pattern -- no attempt to validate the domain or guess at
# obfuscated forms ("name [at] company [dot] com") since a wrong guess here
# would silently poison a real send later; a bio with no plain email simply
# yields None, same as if this check didn't exist.
_BIO_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def _email_from_bio(bio: str | None) -> str | None:
    """First plain-text email address found in a bio, or None. See
    _BIO_EMAIL_RE's own comment for why this stays a simple, literal match
    rather than trying to catch obfuscated forms."""
    if not bio:
        return None
    match = _BIO_EMAIL_RE.search(bio)
    return match.group(0) if match else None


def _save_if_qualified(
    account: dict, platform: str, profile_url: str, raw_profile: dict, niche: str = ""
) -> bool:
    """
    Shared save step for both platforms: skip if this profile is already
    known, qualify it, and insert into `leads` with status "discovered" if it
    passes. Returns True if a new lead was actually saved.

    Thin wrapper kept for any other/future caller that only needs the bool --
    see _save_if_qualified_with_reasons for the version the discovery loops
    actually use, which also surfaces qualify_profile's `reasons` so a
    rejection is diagnosable from logs alone (2026-09-17, see that function's
    own docstring).
    """
    saved, _reasons = _save_if_qualified_with_reasons(account, platform, profile_url, raw_profile, niche)
    return saved


def _save_if_qualified_with_reasons(
    account: dict, platform: str, profile_url: str, raw_profile: dict, niche: str = "",
    niche_is_random: bool = False,
) -> tuple[bool, list[str]]:
    """
    Same behavior as _save_if_qualified, but also returns qualify_profile's
    `reasons` list so the caller can log WHY a candidate was rejected, not
    just that it was.

    ADDED 2026-09-17: tonight's real niche-mismatch bug (see the call sites
    in _discover_linkedin/_discover_instagram) was hard to diagnose from logs
    alone precisely because a rejection's `reasons` were computed by
    qualify_profile() and then thrown away right here, leaving only "rejected
    by qualify_profile: <name>" with no indication of which check(s) actually
    failed. Returning `reasons` (instead of discarding them on a `qualifies is
    False` return) closes that observability gap going forward.

    Returns (False, []) -- not qualify_profile's reasons -- for the
    already-known-profile short-circuit, since that's a dedupe skip, not a
    qualify_profile rejection; there is nothing to explain.
    """
    if repo.lead_profile_url_exists(account["tenant_id"], profile_url):
        return False, []

    # ADDED 2026-10-04, owner's explicit request: records this company as
    # seen (saved or rejected) regardless of which way qualify_profile()
    # comes out, so neither discovery loop re-spends a profile visit on it
    # within the next 30 days -- see repositories.was_recently_seen's own
    # docstring. Keyed the same way each platform's own discovery loop
    # already keys its candidates: the full profile_url for LinkedIn
    # (matching lead_profile_url_exists's own key just above), the bare
    # @handle for Instagram (matching the EARLIER was_recently_seen check
    # in _discover_instagram's own loop, which runs before the expensive
    # profile visit this function is called after -- same key on both ends
    # so that earlier check and this recording actually agree with each
    # other).
    profile_key = profile_url if platform == "linkedin" else profile_url.rstrip("/").rsplit("/", 1)[-1]

    normalised = {**raw_profile, "platform": platform}
    qualifies, reasons = qualify_profile(normalised, niche, niche_is_random=niche_is_random)
    if not qualifies:
        repo.record_seen_profile(platform, profile_key, "rejected", tenant_id=account["tenant_id"])
        return False, reasons

    repo.record_seen_profile(platform, profile_key, "saved", tenant_id=account["tenant_id"])
    repo.insert_lead(account["tenant_id"], {
        "account_id": account["id"],
        "platform": platform,
        "business_name": raw_profile.get("display_name") or None,
        "profile_url": profile_url,
        "follower_count": raw_profile.get("follower_or_headcount"),
        "website": raw_profile.get("website"),
        # NOTE (2026-08-20 port, real behavior change -- see PROGRESS.md):
        # "bio"/"engagement_sample" have no column on OutreachLead (see
        # db/repositories.py's _LEAD_COLUMNS comment) -- insert_lead()
        # silently drops unknown fields rather than erroring. They're still
        # passed here so the dict shape stays identical to the pre-port
        # version (harmless, just ignored on write), but analysis/*.py
        # (untouched, out of scope) reads lead.get("bio") from a lead
        # re-fetched from the DB in run_analysis_cycle below via
        # leads_by_status() -- that re-fetched row will never have "bio",
        # so analyze.py's bio-dependent analysis now always sees "none
        # available" post-port. Not silently swallowed: flagged here and in
        # PROGRESS.md as a real, intentional-for-now narrowing, not a bug
        # nobody noticed.
        "bio": raw_profile.get("bio"),
        "engagement_sample": raw_profile.get("engagement_sample"),  # Instagram only -- null on LinkedIn leads
        # See _email_from_bio()'s own comment -- a plain-text email in the
        # bio itself, found for free at discovery time, no Hunter call
        # needed. Populating contact_email here directly (rather than only
        # ever setting it in _maybe_find_email's later Hunter-driven lead)
        # means run_message_generation_cycle can draft this lead an email
        # message on its OWN row instead of needing a second linked lead --
        # simpler, and the fastest possible path from "bio has an email" to
        # "message drafted".
        "contact_email": _email_from_bio(raw_profile.get("bio")),
        "status": "discovered",
        "notes": " | ".join(reasons),  # keeps the qualification reasoning on the record
    })
    return True, reasons


def run_discovery_cycle(force: bool = False) -> list[dict]:
    """
    Discover, qualify, and save new leads for whichever accounts are due,
    across every tenant that currently has active Outreach accounts (Phase
    3, ported multi-tenant 2026-08-20).

    Channel gating (per this port's spec point 3): one OutreachAccount row =
    one platform. LinkedIn discovery only runs for an account whose
    platform == "linkedin"; Instagram discovery only for platform ==
    "instagram" -- a tenant that only has an active LinkedIn account no
    longer implicitly also gets Instagram discovery run against it (the
    pre-port version always tried both for every account, since the
    standalone schema didn't have a platform-per-account concept the same
    way). This is confirmed sufficient by AccountHealthClient.tsx, which
    already lets an owner add/remove one account per platform -- no new
    toggle infrastructure was needed, just this gating fix.

    VERIFIED 2026-07-31/08-02: discovery/linkedin.py and discovery/instagram.py's
    scraping selectors were checked against real, live pages using a real
    captured login session (see each module's own docstring for exactly what
    was confirmed and which bugs that testing caught). This orchestration
    itself -- looping tenants and accounts, widening weak searches, per-lead
    error isolation -- has not had a full end-to-end run recorded live since
    this port (that's a separate, still-open item, see PROGRESS.md), not a
    selector-accuracy concern.

    Tenant-level isolation: one tenant raising here is logged and skipped,
    same reasoning as run_cycle() above.
    """
    summary = []

    for tenant_id in repo.list_active_tenant_ids():
        try:
            with repo.tenant_scope(tenant_id):
                if repo.is_tenant_paused():
                    continue
                summary.extend(_run_discovery_cycle_for_tenant(tenant_id, force))
        except Exception as exc:  # noqa: BLE001 -- one bad tenant must not stop the others
            try:
                repo.insert_error({
                    "stage": "discovery", "error_message": str(exc), "is_expected": False,
                }, tenant_id=tenant_id)
            except Exception:  # noqa: BLE001 -- logging itself must never crash the pipeline
                pass

    return summary


def _run_discovery_cycle_for_tenant(tenant_id: str, force: bool) -> list[dict]:
    settings = repo.get_settings(tenant_id) or {}
    business_name = settings.get("business_name") or ""
    configured_niche = settings.get("target_niche") or ""
    niche = _resolve_search_niche(configured_niche, settings.get("target_industry") or "")
    # True for a tenant like Insurance running with no configured niche at
    # all ("any industry") -- lets _discover_linkedin's widening loop pick
    # a FRESH random industry term on a weak/empty result instead of just
    # dropping location and eventually collapsing to a genuinely empty
    # search (which live-verified always returns 0 results). A tenant with
    # a real configured niche (e.g. Zimmar's "Security and building
    # infrastructure integration") keeps the existing behavior untouched --
    # widening THEIR specific niche to a random unrelated industry would be
    # wrong, not helpful.
    # A service-shaped niche (see _SERVICE_NOT_SECTOR_NICHES) is rotated
    # rather than peeled for the same reason an empty one is: peeling "small
    # business marketing" just yields "marketing", which is the very term
    # that surfaced the wrong audience in the first place.
    niche_is_random = (
        not configured_niche
        or configured_niche.strip().lower() in _SERVICE_NOT_SECTOR_NICHES
    )
    location = settings.get("target_location") or ""
    industry = settings.get("target_industry") or ""
    # The tenant's own configured sectors, used to rotate keywords/hashtags
    # on-sector. ONLY for a tenant whose niche names a service rather than a
    # sector (MJivity): an empty-niche tenant means "all companies" and must
    # keep the broad rotation -- see _resolve_search_niche's docstring.
    tenant_terms = (
        _industry_rotation_terms(industry)
        if configured_niche.strip().lower() in _SERVICE_NOT_SECTOR_NICHES
        else []
    )
    # Found stored but never actually enforced in the 2026-09-12 review --
    # OutreachSettings.targetCompanySizeMin (e.g. Insurance's real "100+
    # employees" requirement, Zimmar's "30+") was set on every tenant's
    # settings row but qualify_profile() only ever applied a small,
    # tenant-agnostic penalty for a LOW headcount, never a real per-tenant
    # floor. Threaded through to _save_if_qualified below so a company
    # under the configured minimum is rejected outright, the same way a
    # location mismatch already is.
    min_company_size = settings.get("target_company_size_min")
    # LinkedIn-side coarse pre-filter derived from the same minimum -- see
    # _resolve_size_buckets' own docstring. Does not replace the precise
    # per-profile check above/below; it just stops LinkedIn from returning
    # (and this agent from wasting a visit on) companies whose entire size
    # bucket is below the minimum in the first place.
    size_buckets = _resolve_size_buckets(min_company_size)

    accounts = pool.get_due_accounts(tenant_id, force=force)
    summary = []

    today_start = pool.today_start_iso(tenant_id)
    with SessionManager() as sessions:
        for account in accounts:
            # Atomic claim -- see _run_cycle_for_tenant()'s identical comment
            # above for why this replaces start_run() directly.
            run = repo.claim_account_for_run(tenant_id, account["id"], today_start, skip_daily_check=force)
            if run is None:
                continue
            counts = {"linkedin_found": 0, "linkedin_saved": 0,
                      "instagram_found": 0, "instagram_saved": 0,
                      "errors": [], "skipped_leads": []}

            try:
                context, page, login_error, new_verified_ip = sessions.open_or_login(account)
            except ProxyIpMismatch as exc:
                # Hard stop for THIS account only -- open_or_login() itself
                # refuses to proceed to login when the proxy's real IP
                # doesn't match what this account verified before (see
                # ProxyIpMismatch's own docstring); the mismatched context is
                # already closed by open() before this exception reaches
                # here. Other accounts in this tenant's batch are
                # unaffected -- only letting this propagate past here would
                # abort the whole tenant's cycle, which one account's proxy
                # problem doesn't warrant.
                counts["errors"].append(f"proxy_ip_mismatch: {exc}")
                log_error("proxy_ip_mismatch", exc, account_id=account["id"])
                repo.finish_run(
                    tenant_id, run["id"], leads_found=0, messages_sent=0,
                    status="error", finished_at_iso=dt.datetime.now(dt.timezone.utc).isoformat(),
                    notes=str(exc),
                )
                summary.append({"tenant_id": tenant_id, "account": account["label"], **counts})
                continue

            if new_verified_ip:
                repo.update_account(account["id"], {"verified_proxy_ip": new_verified_ip}, tenant_id)

            if login_error:
                # A credential login was attempted (no saved session existed
                # yet) and failed -- report it to the account row so the
                # tenant sees why in their dashboard (AccountHealthClient's
                # loginStatus/loginError fields), and skip discovery entirely
                # this run rather than proceeding on a context that never
                # actually got logged in.
                repo.update_account(account["id"], {"login_status": "failed", "login_error": login_error}, tenant_id)
                counts["errors"].append(f"login: {login_error}")
                log_error("login", RuntimeError(login_error), channel=account.get("platform"), account_id=account["id"])
            else:
                if account.get("login_email") and account.get("login_password_enc") and account.get("login_status") != "connected":
                    # Either this run's own login attempt just succeeded, or a
                    # saved session from a prior successful login was reused --
                    # either way, credentials exist and nothing failed, so this
                    # account is (still) genuinely connected.
                    repo.update_account(
                        account["id"],
                        {
                            "login_status": "connected",
                            "login_error": None,
                            "login_connected_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                        },
                        tenant_id,
                    )

                if account.get("platform") == "linkedin":
                    _progress_log.info("[%s] starting LinkedIn discovery", account.get("label"))
                    try:
                        _discover_linkedin(account, page, niche, location, industry, counts, min_company_size, niche_is_random, size_buckets, tenant_terms, business_name)
                    except Exception as exc:  # noqa: BLE001 -- a whole-platform failure, not one bad lead
                        counts["errors"].append(f"linkedin: {exc}")
                        log_error("discovery", exc, channel="linkedin", account_id=account["id"])
                    _progress_log.info(
                        "[%s] finished LinkedIn discovery: %d found, %d saved",
                        account.get("label"), counts.get("linkedin_found", 0), counts.get("linkedin_saved", 0),
                    )
                elif account.get("platform") == "instagram":
                    _progress_log.info("[%s] starting Instagram discovery", account.get("label"))
                    try:
                        _discover_instagram(account, page, niche, counts, tenant_terms, business_name, location, niche_is_random)
                    except Exception as exc:  # noqa: BLE001
                        counts["errors"].append(f"instagram: {exc}")
                        log_error("discovery", exc, channel="instagram", account_id=account["id"])
                    _progress_log.info(
                        "[%s] finished Instagram discovery: %d found, %d saved",
                        account.get("label"), counts.get("instagram_found", 0), counts.get("instagram_saved", 0),
                    )
                else:
                    # platform == "email" (or anything else) -- no browser-automation
                    # discovery exists for that channel; the Next.js app owns email entirely.
                    _progress_log.info(
                        "[%s] platform=%r has no browser-automation discovery -- skipping (handled by the Next.js/SES pipeline)",
                        account.get("label"), account.get("platform"),
                    )

            sessions.close(account["id"], context)

            finished_at = dt.datetime.now(dt.timezone.utc).isoformat()
            # Persist the actual search terms tried, not just the errors.
            # Added 2026-09-13: these were collected in `counts` but thrown
            # away at the end of every run, which meant a 0-lead run gave no
            # way to tell whether the search TERM was bad or the candidates
            # were -- the single biggest blocker to diagnosing real
            # 0-result days. Prefixed onto notes so it shows on the Run
            # Status page next to whatever errors occurred.
            terms = counts.get("linkedin_search_terms") or counts.get("instagram_search_terms") or []
            terms_note = f"searched: {terms}" if terms else None
            note_parts = [p for p in (terms_note, " | ".join(counts["errors"]) or None) if p]
            repo.finish_run(
                tenant_id,
                run["id"],
                leads_found=counts["linkedin_saved"] + counts["instagram_saved"],
                messages_sent=0,
                status="error" if counts["errors"] else "completed",
                finished_at_iso=finished_at,
                notes=" || ".join(note_parts) or None,
                skipped_leads=counts["skipped_leads"],
            )

            summary.append({"tenant_id": tenant_id, "account": account["label"], **counts})

    return summary


# A search that comes back with fewer results than this fraction of its
# target count is "weak" -- worth widening the search terms for, rather than
# quietly accepting a thin batch. Never widen past MAX_SEARCH_ATTEMPTS
# rounds; both platforms' widen functions converge to "as wide as it gets"
# in a small, bounded number of steps anyway.
_WEAK_RESULT_FRACTION = 0.5
# Raised from 4 to 10 on 2026-09-13, then 10 to 20 later the same day. Real
# owner question after the first raise still wasn't enough: "we have 80,000
# companies in Lebanon, why can't we find 5?" The honest answer: every
# candidate must pass 6 checks in sequence (location, competitor, agency,
# company size, has-a-Message-button, AI quality score) -- even if each one
# individually only rejects a defensible ~30-35% of real companies, 6
# stacked checks compound to roughly a 90%+ overall rejection rate, so a
# LIVE-CONFIRMED real run visited 8 real candidates and saved 0. 10 rounds
# x ~10 LinkedIn results/page was never enough volume to survive that
# compounding -- 20 rounds doubles the daily candidate ceiling (~100 to
# ~200/account/day) so the funnel has enough raw volume to reach 5 real
# saves even at a low per-candidate pass rate. Paired with loosening two of
# the weakest-justified checks the same day (message-button pre-check,
# strict no-location-signal reject) -- see each's own comment.
_MAX_SEARCH_ATTEMPTS = 20

# Found in the 2026-09-12 review, real owner complaint ("we have millions
# of companies, it's not okay to not reach 5-10/day"): the raw search loop
# above stopped collecting candidates as soon as it hit roughly HALF the
# account's daily limit (_WEAK_RESULT_FRACTION), before location/company-
# size/personal-account qualification had even run -- so a limit of 5 could
# genuinely end with 1-2 real saved leads if half the raw batch got
# filtered out downstream, with no attempt to go find more. This
# multiplies the raw-collection target so qualification has real headroom:
# search for OVERSAMPLE_MULTIPLIER x the daily limit before the loop is
# satisfied, then still cap the final SAVED count at the real daily limit
# (existing `results[:limit]` truncation, untouched) -- this only makes the
# search look harder for candidates, it does not raise how many get sent.
_DISCOVERY_OVERSAMPLE_MULTIPLIER = 3

# A search round returning fewer than this many RAW candidates is treated
# as a bad keyword rather than a real attempt -- see the check's own
# comment in _discover_linkedin for the live evidence behind it.
_MIN_VIABLE_SEARCH_RESULTS = 3

# LIVE-CONFIRMED 2026-09-01: LinkedIn's own companyHqGeo search facet let a
# UK company (ZAM FM LTD, Manchester) through a Lebanon-filtered search --
# and that company's own About page had no "Headquarters" field at all to
# cross-check against (confirmed live: most company pages don't populate
# it), so a field-based check alone can't catch this. What the page DID
# have was its own bio text stating "your trusted partner in Manchester"
# outright -- this scans the bio (already scraped, no extra request) for a
# real foreign place name as a red flag. Deliberately NOT exhaustive (no
# list can name every place on Earth) -- this only needs to catch the
# common case of a company plainly stating a non-Lebanon city/country in
# its own description, same as ZAM FM did.
_FOREIGN_LOCATION_MARKERS = [
    "manchester", "london", "united kingdom", " uk ", "u.k.",
    "united states", "usa", "u.s.a.", "new york", "california",
    "canada", "toronto", "australia", "sydney", "dubai", "abu dhabi",
    "saudi arabia", "riyadh", "jeddah", "egypt", "cairo", "jordan", "amman",
    "france", "paris", "germany", "berlin", "india", "mumbai", "delhi",
    "pakistan", "nigeria", "kenya", "south africa", "singapore",
    # Added 2026-09-13: "Bhavani Consultants - India" listed its HQ as
    # "Kochi, Kerala" and named no country, so none of the markers above
    # matched -- it was only caught by the separate Headquarters-field
    # check. These are the Indian city/state names that actually appeared
    # in real rejected leads, plus the common ones most likely to recur.
    "kochi", "kerala", "bangalore", "bengaluru", "chennai", "hyderabad",
    "pune", "kolkata", "ahmedabad", "gujarat", "maharashtra", "bihar",
    "madhubani", "noida", "gurgaon", "gurugram",
    # Added 2026-10-06, owner's explicit request ("some insta the agent
    # found not in lebanon") after a real night's batch let through
    # non-Lebanese accounts this list simply didn't cover -- deliberately
    # NOT exhaustive (same reasoning as the rest of this list), just
    # widening coverage of GCC/MENA and other common countries real
    # Instagram bios actually state.
    "qatar", "doha", "kuwait", "kuwait city", "bahrain", "manama", "oman",
    "muscat", "yemen", "sanaa", "iraq", "baghdad", "syria", "damascus",
    "turkey", "istanbul", "ankara", "iran", "tehran", "morocco", "rabat",
    "casablanca", "tunisia", "tunis", "algeria", "algiers", "libya",
    "tripoli libya", "sudan", "khartoum", "spain", "madrid", "barcelona",
    "italy", "rome", "milan", "netherlands", "amsterdam", "sweden",
    "stockholm", "switzerland", "zurich", "geneva", "belgium", "brussels",
    "ghana", "accra", "ethiopia", "addis ababa", "bangladesh", "dhaka",
    "sri lanka", "colombo", "nepal", "kathmandu", "philippines", "manila",
    "indonesia", "jakarta", "malaysia", "kuala lumpur", "thailand",
    "bangkok", "vietnam", "hanoi", "china", "beijing", "shanghai",
    "japan", "tokyo", "south korea", "seoul", "brazil", "sao paulo",
    "mexico", "mexico city", "argentina", "buenos aires",
]

# LIVE-CONFIRMED 2026-09-02: the headquarters-field check below originally
# required the literal word "lebanon" to appear in the company's own
# Headquarters text -- real-tested against Insurance's live discovery and
# it wrongly rejected multiple genuine Lebanese companies (Arabia Insurance
# Company: "Beirut, Beirut"; Adir Insurance: "Dora, Jdeidet Metn"; Insurance
# & Investment Consultant s.a.r.l: "Bsalim, Beirut") because LinkedIn's own
# Headquarters field lists a specific city/district, not the country name,
# in the common case. This is the real fix: a maintained list of actual
# Lebanese cities/districts to accept as a match too, not just the literal
# country name. Deliberately not exhaustive (no list can cover every
# village), but covers the major cities/areas real companies list.
_LEBANON_PLACE_MARKERS = [
    "lebanon", "beirut", "jdeidet", "jdeideh", "metn", "dora", "dbayeh",
    "dbaye", "bsalim", "jounieh", "jbeil", "byblos", "tripoli", "sidon",
    "saida", "tyre", "sour", "zahle", "baabda", "hazmieh", "ashrafieh",
    "achrafieh", "hamra", "verdun", "sin el fil", "sinelfil", "mtayleb",
    "bauchrieh", "antelias", "zalka", "jal el dib", "kaslik", "zouk",
    "keserwan", "chouf", "aley", "batroun", "koura",
]

# ADDED 2026-09-19, real owner request ("can we have another way to check
# if lebanese or not not from the bio"): a live-watched Instagram discovery
# run showed a real cost of the strict place-name-only check above -- many
# genuinely small Lebanese business bios never spell out a city name at
# all (no "Beirut", no district), so a real Lebanese business could get
# wrongly rejected right alongside the actual foreign ones this check
# exists to catch. Two additional, independent positive signals, either of
# which is enough on its own:
#
# 1. A Lebanese phone number. Lebanon's country code is +961, and a
#    domestic number written without the country code still has a
#    distinctive local pattern (a 2-digit area/mobile prefix, no 0 leading
#    a +961-prefixed number). Matched loosely on "+961" or "961" followed
#    by 7-8 digits, and separately on a bare local-format number (e.g.
#    "03 123456", "70 123456", "01 123456") -- these area-code-style
#    prefixes are genuinely Lebanon-specific, not a generic phone-number
#    shape any country could produce.
# 2. Arabic script anywhere in the bio. Most small Lebanese businesses
#    write at least part of their bio in Arabic (or Franco-Arabic mixed
#    with Latin script) even when they never name a city -- a foreign
#    account (India, Turkey, US, etc.) essentially never does. This is a
#    STRONG but not perfect signal (Arabic is also written across the rest
#    of the Arabic-speaking world) -- kept as an additional OR, not a
#    replacement for the place-name check, so it only ever WIDENS what
#    counts as "confirmed Lebanese," never narrows it.
_LEBANON_PHONE_RE = re.compile(r"(?:\+?961[\s.\-]?)(\d[\d\s.\-]{6,9}\d)|(?:\b0?(3|70|71|76|78|79|81)[\s.\-]?\d{3}[\s.\-]?\d{3}\b)")
_ARABIC_SCRIPT_RE = re.compile(r"[؀-ۿ]")


def _has_lebanon_phone_or_arabic(text: str) -> bool:
    """True if `text` contains a Lebanese-looking phone number or any
    Arabic-script character -- see the block comment above this function
    for why each is a real, independent positive signal. Used as an
    ADDITIONAL way to confirm a business is Lebanese, alongside (never
    instead of) the place-name check in _LEBANON_PLACE_MARKERS."""
    if not text:
        return False
    return bool(_LEBANON_PHONE_RE.search(text) or _ARABIC_SCRIPT_RE.search(text))


# Maps each city/abbreviation in _FOREIGN_LOCATION_MARKERS to the wider
# regions that contain it, so a tenant targeting a COUNTRY (or a bloc like
# "GCC" / "MENA" / "Europe") isn't told one of its own cities is foreign.
# See _mentions_foreign_location for the real bug this fixes.
_CITY_PARENT_REGIONS: dict[str, tuple[str, ...]] = {
    "manchester": ("united kingdom", "uk", "britain", "england", "europe"),
    "london": ("united kingdom", "uk", "britain", "england", "europe"),
    " uk ": ("united kingdom", "britain", "england", "europe"),
    "u.k.": ("united kingdom", "britain", "england", "europe"),
    "usa": ("united states", "u.s.", "america"),
    "u.s.a.": ("united states", "america"),
    "new york": ("united states", "usa", "u.s.", "america"),
    "california": ("united states", "usa", "u.s.", "america"),
    "toronto": ("canada",),
    "sydney": ("australia",),
    "dubai": ("uae", "united arab emirates", "gcc", "mena"),
    "abu dhabi": ("uae", "united arab emirates", "gcc", "mena"),
    "riyadh": ("saudi arabia", "saudi", "gcc", "mena"),
    "jeddah": ("saudi arabia", "saudi", "gcc", "mena"),
    "cairo": ("egypt", "mena"),
    "amman": ("jordan", "mena"),
    "paris": ("france", "europe"),
    "berlin": ("germany", "europe"),
    "france": ("europe",),
    "germany": ("europe",),
    "mumbai": ("india",),
    "delhi": ("india",),
}


def _mentions_foreign_location(bio: str, configured_location: str) -> str | None:
    """
    Real, deliberately-imperfect safety net -- see _FOREIGN_LOCATION_MARKERS'
    own comment for why this exists and what it can't cover. Returns the
    matched marker text if the bio plainly names a location that isn't the
    tenant's configured target, or None if nothing in the list matched
    (not proof the company IS in the right place -- just that this specific
    check found no red flag). Case-insensitive; only runs when a location
    is actually configured, since there's nothing to contradict otherwise.
    """
    if not configured_location:
        return None
    configured = configured_location.lower()
    bio_lower = f" {bio.lower()} "
    for marker in _FOREIGN_LOCATION_MARKERS:
        if marker in configured:
            continue  # the marker IS the configured location -- not foreign
        # A CITY in a targeted country is not foreign. LIVE-CONFIRMED
        # 2026-09-13: MJivity targets "GCC (UAE, ...), Egypt, Lebanon, ...
        # United States, United Kingdom, Canada, Europe", but the plain
        # substring check above only protected exact country names -- so a
        # company in Dubai, London, New York, Toronto, Paris or Berlin was
        # rejected as "foreign" even though every one of those sits in a
        # country this tenant explicitly targets. That silently rejected
        # MJivity's entire real market.
        parents = _CITY_PARENT_REGIONS.get(marker)
        if parents and any(p in configured for p in parents):
            continue
        if marker in bio_lower:
            return marker.strip()
    return None


# Every tenant needs "don't pitch my own competitors" -- a company selling
# the same thing the tenant sells is the tenant's competitor, not a
# prospect, no matter how well it otherwise qualifies. Originally built for
# Insurance only (2026-09-02, real instruction: never target other
# insurance companies) and generalized 2026-09-13 after Zimmar's real
# overnight leads included linksecurtysystem, guardify.cloud,
# avtrade.integration, and earthlink_telecommunications -- all security/
# telecom/networking companies, i.e. Zimmar's own competitors, because no
# equivalent check had ever existed for Zimmar. Keyed by BUSINESS NAME
# (settings.business_name) rather than a tenant_id lookup table so a new
# tenant gets this for free the moment its own markers are added here,
# with no scheduler.py code change needed elsewhere.
_COMPETITOR_MARKERS_BY_BUSINESS = {
    "partners insurance consultancy": [
        "insurance", "insurer", "reinsurance", "assurance company",
        "takaful", "underwriter", "underwriting",
    ],
    "zimmar": [
        "cctv", "security camera", "security cameras", "surveillance",
        "video surveillance", "access control", "alarm system",
        "alarm systems", "security system", "security systems",
        "security integrator", "security integration", "burglar alarm",
        "intrusion detection", "video monitoring", "security solutions",
    ],
}


# Added 2026-09-13, real owner instruction: "no agencies only companies and
# businesses" -- given specifically about Zimmar and Insurance (both sell to
# a company's own physical premises/insurable operation, which an agency
# reselling a service doesn't have).
#
# REVERSED the same night, real owner reconsideration during a live test:
# "some agencies have good number of employees" -- an agency with a real
# office and real staff genuinely has real premises to protect (Zimmar) and
# a real insurable operation (Insurance/workers' comp/property/liability)
# just like any other company; being an agency doesn't mean it lacks
# physical presence. Owner confirmed explicitly for BOTH tenants: "Yes,
# both -- remove the no-agency rule entirely for both tenants." Left EMPTY
# rather than deleting the mechanism -- _is_agency() and the wiring in both
# discovery loops stay in place (harmless, always False-gated) in case a
# future tenant genuinely needs this rule the way MJivity's own opposite
# preference (agencies ARE its real market, see
# outreach-tenant-targeting-rules memory) shows real per-tenant judgment
# calls exist here.
_AGENCY_EXCLUDED_BUSINESSES: set[str] = set()


def _is_competitor(business_name: str, bio: str, industry: str | None) -> bool:
    """
    True if the LEAD's own bio or LinkedIn-listed industry plainly
    identifies it as a competitor of the tenant currently running discovery
    (`business_name` = this tenant's own settings.business_name, NOT the
    lead's name). Checked against BOTH bio and industry since either can
    carry the signal. Deliberately simple substring matching, same posture
    as _mentions_foreign_location() above: not exhaustive, but catches the
    common, plain case rather than needing an LLM call for every lead.

    A tenant with no entry here (a future tenant not yet added) matches
    nothing -- fails open rather than raising, since a missing entry means
    "not yet configured," not "this tenant has no competitors."
    """
    markers = _COMPETITOR_MARKERS_BY_BUSINESS.get((business_name or "").strip().lower())
    if not markers:
        return False
    haystack = f" {bio.lower()} {(industry or '').lower()} "
    return any(marker in haystack for marker in markers)


def _is_weak(found: int, limit: int) -> bool:
    return found < max(3, int(limit * _WEAK_RESULT_FRACTION))


# Leading words that make a peeled niche term meaningless as a search
# keyword ("and building infrastructure integration").
_NICHE_STOPWORDS = {"and", "or", "the", "a", "an", "of", "for", "in", "with", "&"}


def _next_search_terms(
    search_niche: str, search_location: str, original_location: str,
    niche_is_random: bool, tried_niches: set[str],
    tenant_terms: list[str] | None = None,
) -> tuple[str, str] | None:
    """
    Pick the NEXT (niche, location) pair to search after a round failed to
    produce enough SAVED leads. Returns None when there is genuinely nothing
    new left to try.

    Deliberately does NOT use linkedin.widen_search_terms' drop-the-location
    behavior as its first move. LIVE-CONFIRMED 2026-09-12 (Zimmar): dropping
    a Lebanon-configured tenant's location made LinkedIn return worldwide
    companies, every one of which then failed the post-visit location check
    (Dubai/India/Manchester/Ontario/Yerevan) -- the widening itself
    manufactured the rejects that produced a 0-lead run. For a
    location-scoped tenant, keeping the location and changing the KEYWORD is
    the move that actually opens up new real candidates.
    """
    # 1. A different keyword, same location -- the productive move.
    if niche_is_random:
        # Prefer the tenant's OWN configured sectors when it listed any
        # (MJivity's e-commerce / fashion / cosmetics / jewelry / automotive
        # list), falling back to the generic Lebanese-industry rotation only
        # for a tenant that genuinely targets every industry.
        pool_terms = tenant_terms or _RANDOM_INDUSTRY_TERMS
        untried = [t for t in pool_terms if t not in tried_niches]
        if not untried and tenant_terms:
            untried = [t for t in _RANDOM_INDUSTRY_TERMS if t not in tried_niches]
        if untried:
            return random.choice(untried), original_location
    else:
        # A real configured niche (e.g. Zimmar's "Security and building
        # infrastructure integration"): peel one leading qualifier word off
        # at a time, which yields genuinely broader but still ON-TOPIC terms
        # ("building infrastructure integration" -> "infrastructure
        # integration" -> "integration"), keeping the location intact.
        #
        # Deliberately NOT linkedin.widen_search_terms() here: that function
        # returns ("", "") once the location argument is already empty, so
        # passing "" to isolate the niche-shortening half of it silently
        # yields an empty niche and kills the round. Caught by this file's
        # own unit check before it ever shipped.
        words = search_niche.split()
        while len(words) > 1:
            words = words[1:]
            # Skip a leading stopword: peeling "Security and building ..."
            # one word at a time otherwise burns a whole round on the junk
            # term "and building infrastructure integration".
            while len(words) > 1 and words[0].lower() in _NICHE_STOPWORDS:
                words = words[1:]
            shorter = " ".join(words)
            if shorter not in tried_niches:
                return shorter, original_location
        # Niche fully peeled down and every step already tried -- fall
        # through to the location-drop check below.

    # 2. Only once keywords are exhausted, fall back to dropping the
    # location -- last resort, and only for a tenant that has no location
    # configured to begin with (otherwise every result fails the location
    # check anyway, per the docstring above).
    if not original_location and search_location:
        return search_niche, ""
    return None


def _linkedin_scrape_looks_empty(profile: dict) -> bool:
    """
    True when a LinkedIn /about scrape came back with NOTHING at all -- the
    signature of a page that never finished client-side rendering, not of a
    real company with a thin profile.

    LIVE-CONFIRMED 2026-09-18, the single biggest drag on discovery
    throughput found so far. The droplet is 1 vCPU/1.9GB (see session.py's
    own comment) and _discover_linkedin navigates with
    wait_until="domcontentloaded", which fires as soon as the raw HTML
    document parses -- well before LinkedIn's SPA JS has populated the
    About panel. extract_company_profile() already waits up to 8s for the
    about-module's first <p> to attach, but under real CPU contention that
    wait times out often enough to matter, and the function then returns an
    entirely empty profile.

    qualify_profile() has no way to tell that apart from a genuinely empty
    company page, so it rejected each one "correctly but wrongly" at score
    -6 with an identical all-empty reason list ("Bio is missing / No website
    linked / Zero posts / doesn't mention niche"). Insurance's Sept 18 run:
    161 candidates visited, 5 saved (3.1%), 137 qualify-rejections of which
    96 scored exactly -6 on that identical list and 117/137 (85%) included
    "Bio is missing" -- among them DocShipper, GFS Global Group, Regie
    Libanaise and Advanced Lines Group, all real Lebanese companies with
    real websites, bios and posts. Zimmar's run the same night: 11 visits,
    5 saves (45%). The controlled proof is Insurance's own round 20, whose
    'telecommunications' search happened to render properly: 2 visits, 2
    saves, 0 rejections.

    ALL FOUR fields must be empty for this to fire. A company with a bio but
    no website (or a website but no posts) is a real, partial profile that
    should go to qualification exactly as before -- this must never trigger
    an extra page load on the happy path.
    """
    return (
        not (profile.get("bio") or "").strip()
        and not profile.get("website")
        and not (profile.get("post_count") or 0)
        and not (profile.get("headquarters") or "").strip()
    )


def _discover_linkedin(
    account: dict, page, niche: str, location: str, industry: str, counts: dict,
    min_company_size: int | None = None, niche_is_random: bool = False,
    size_buckets: list[str] | None = None, tenant_terms: list[str] | None = None,
    business_name: str = "",
) -> None:
    limit = warmup.effective_limit(account, "linkedin")
    # Raw-collection target per ROUND, not the final saved count.
    search_target = limit * _DISCOVERY_OVERSAMPLE_MULTIPLIER
    search_niche, search_location = niche, location
    seen_urls: set[str] = set()
    tried_niches: set[str] = set()
    counts["linkedin_search_terms"] = []

    # RESTRUCTURED 2026-09-13 (real owner rule: "if those 15 don't give us
    # 5, go get another 15 after a few minutes"). Before this, search and
    # qualification were two SEPARATE sequential loops: the search loop
    # stopped as soon as it had enough RAW candidates, then qualification
    # ran once over them and whatever survived was the final answer, with no
    # way back. LIVE-CONFIRMED that this produced real 0-lead runs -- Zimmar
    # 2026-09-12 pulled 10 raw candidates (loop satisfied), then all 10 were
    # rejected on location, ending the run at 0 with 3 unused search
    # attempts still on the table. Now one loop does search -> visit ->
    # qualify per round, and only starts another round if the SAVED count is
    # still short, which is what the owner's rule actually asks for.
    _discovery_started_at = time.monotonic()
    for attempt in range(_MAX_SEARCH_ATTEMPTS):
        if counts["linkedin_saved"] >= limit:
            break
        # ADDED 2026-10-04, owner's explicit request: see
        # _PER_ACCOUNT_DISCOVERY_TIME_CAP_SECONDS's own comment for the full
        # reasoning -- this account has run long enough that it must yield
        # the single shared browser slot to the next account in line,
        # regardless of how many search rounds remain unused.
        if time.monotonic() - _discovery_started_at >= _PER_ACCOUNT_DISCOVERY_TIME_CAP_SECONDS:
            _progress_log.info(
                "[%s] LinkedIn: time cap reached (%d saved so far) -- yielding to the next account",
                account.get("label"), counts["linkedin_saved"],
            )
            break
        if attempt > 0:
            next_terms = _next_search_terms(
                search_niche, search_location, location, niche_is_random, tried_niches,
                tenant_terms,
            )
            if next_terms is None:
                break  # genuinely nothing new left to try
            search_niche, search_location = next_terms
            # LIVE-CONFIRMED 2026-09-01: LinkedIn force-logged-out a real
            # account after a burst of back-to-back automated searches with
            # no pause between them. A real person doesn't fire searches
            # back to back; randomizing avoids a uniform, itself-suspicious
            # interval. This is also the owner's "wait some minutes before
            # the next batch" rule -- deliberately longer than the old
            # 15-30s now that a round is a whole search+visit+qualify pass.
            page.wait_for_timeout(random.randint(60_000, 150_000))

        tried_niches.add(search_niche)
        results: list[dict] = []
        counts["linkedin_search_terms"].append({"niche": search_niche, "location": search_location})
        # ADDED 2026-10-04, owner's explicit request: resume from wherever
        # this account last left off searching THIS EXACT term, instead of
        # re-reading page 1 every time -- see repositories.get_search_page's
        # own docstring and linkedin.build_search_url's `page` param for the
        # full reasoning (LinkedIn's &page=N genuinely returns different
        # companies, confirmed live). Keyed on search_niche alone, not
        # location/industry/size too -- those stay constant for a whole
        # tenant across every round, so the niche term is the only thing
        # that actually varies call to call and needs its own counter.
        search_page_num = repo.get_search_page(account["id"], search_niche, tenant_id=account["tenant_id"])
        _progress_log.info(
            "[%s] LinkedIn round %d/%d: searching %r in %r (page %d)",
            account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS, search_niche, search_location, search_page_num,
        )
        page.goto(
            linkedin.build_search_url(search_niche, search_location, industry, size_buckets, page=search_page_num),
            timeout=30_000, wait_until="domcontentloaded",
        )
        # LIVE-CONFIRMED 2026-09-12: no explicit wait existed here at all --
        # LinkedIn's company search results render client-side, well after
        # domcontentloaded fires, the same class of issue instagram.py's own
        # hashtag search already hit and fixed (see that module's docstring:
        # "0 results at 5s, 21 results at 7s" on the identical query). A
        # manual diagnostic run caught this directly: the exact same
        # niche+location search that returned 0 in a real production run
        # returned 10 real companies moments later with a 4s wait added
        # before reading results. This is the likely real explanation for
        # Insurance's intermittent 0-result discovery runs -- not a search
        # or filter problem, a read-too-early problem.
        page.wait_for_timeout(5_000)
        raw_result_count = 0
        for result in linkedin.extract_search_results(page):
            raw_result_count += 1
            url = result.get("profile_url")
            if not url or url in seen_urls:
                continue
            # ADDED 2026-10-04, owner's explicit request: a company already
            # recorded (saved OR rejected) within the last 30 days is
            # skipped here, for free -- no page load, no re-qualify. This
            # is what actually makes the page-jump above pay off: once a
            # term's early pages are fully known, this filters them back
            # out of the candidate list instantly even if the page-jump
            # counter itself ever drifts (e.g. after a code change), so the
            # two mechanisms reinforce each other rather than depending on
            # perfect bookkeeping alone.
            if repo.was_recently_seen("linkedin", url, tenant_id=account["tenant_id"]):
                seen_urls.add(url)
                continue
            seen_urls.add(url)
            results.append(result)
        # Recorded regardless of whether this page had anything NEW (a page
        # that turned out to be all-known-candidates still means "page N is
        # read", so the next call to get_search_page() must still resume at
        # N+1, not re-read N again next time).
        if raw_result_count > 0:
            repo.record_search_page(account["id"], search_niche, search_page_num, tenant_id=account["tenant_id"])

        # A round that surfaced almost nothing means the KEYWORD was bad,
        # not that Lebanon has no companies. LIVE-CONFIRMED 2026-09-13: a
        # direct probe of the same Lebanon geo facet returned 10-11 real
        # Lebanese companies for 'trading', 'construction' and
        # 'manufacturing', while that day's actual Insurance run picked a
        # term that surfaced exactly 1 (an Australian Bosch subsidiary) and
        # then burned its whole round qualifying it. Visiting one dud
        # candidate costs a minute and can't reach the daily target, so
        # skip straight to a different keyword instead of paying for it.
        _progress_log.info(
            "[%s] LinkedIn round %d/%d: %d raw result(s) for %r",
            account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS, len(results), search_niche,
        )
        if len(results) < _MIN_VIABLE_SEARCH_RESULTS and attempt < _MAX_SEARCH_ATTEMPTS - 1:
            counts.setdefault("thin_rounds", []).append(
                {"niche": search_niche, "location": search_location, "results": len(results)}
            )
            _progress_log.info(
                "[%s] LinkedIn round %d/%d: thin (<%d results), moving to next keyword after a pause",
                account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS, _MIN_VIABLE_SEARCH_RESULTS,
            )
            continue

        # Raw candidates from THIS round only. Not truncated to `limit`:
        # the real daily cap is enforced by the saved-count checks, not by
        # pre-filtering how many candidates get a chance to qualify.
        results = results[: max(search_target, limit)]
        counts["linkedin_found"] = counts.get("linkedin_found", 0) + len(results)

        for profile_index, result in enumerate(results):
            if counts["linkedin_saved"] >= limit:
                break
            profile_url = result.get("profile_url")
            if not profile_url:
                continue
            # Pace profile visits apart -- see _sleep_between_profile_visits().
            # Before the FIRST visit is skipped deliberately: the search-widening
            # loop above has already paused 15-30s of its own, so the run doesn't
            # need a third wait before any real work starts.
            if profile_index > 0:
                _sleep_between_profile_visits()
            _progress_log.info(
                "[%s] LinkedIn round %d/%d: visiting candidate %d/%d (%s) -- saved so far: %d/%d",
                account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                profile_index + 1, len(results), result.get("display_name") or profile_url,
                counts["linkedin_saved"], limit,
            )
            try:
                # extract_company_profile() reads the /about subpage specifically
                # (not the bare company page) -- see that function's docstring
                # for why, re-verified 2026-08-03 after the bare page stopped
                # carrying Website/Industry/size info.
                page.goto(profile_url.rstrip("/") + "/about/", timeout=30_000, wait_until="domcontentloaded")
                profile = linkedin.extract_company_profile(page)
                profile["display_name"] = result.get("display_name")

                page.goto(profile_url.rstrip("/") + "/posts/", timeout=30_000, wait_until="domcontentloaded")
                posts_info = linkedin.extract_recent_posts(page)
                profile["post_count"] = posts_info["visible_post_count"]
                profile["recent_activity"] = posts_info["recent_activity"]

                # SCRAPE-FAILURE RETRY, added 2026-09-18 -- see
                # _linkedin_scrape_looks_empty() above for the full live
                # evidence. An all-empty /about scrape means the page never
                # rendered, not that the company is a bad lead, so it must
                # never reach ANY of the checks below as if it were real data.
                # This sits here, before the location/competitor/size checks
                # rather than just before qualification, deliberately: an
                # empty scrape fails those too (a tenant whose location has no
                # verified geo facet rejects it outright at "neither the
                # Headquarters field nor its bio names any Lebanese
                # location"), and recovered data has to flow through every one
                # of them, not only through qualify_profile().
                #
                # Retried ONCE, and only on that exact all-empty signature: a
                # partial or normal scrape falls straight through with no
                # extra page load at all, exactly as before.
                if _linkedin_scrape_looks_empty(profile):
                    _progress_log.info(
                        "[%s] LinkedIn round %d/%d: empty /about scrape, retrying once: %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        result.get("display_name") or profile_url,
                    )
                    # networkidle (not domcontentloaded) is the whole point of
                    # the retry: it waits for LinkedIn's SPA to actually stop
                    # fetching, which is exactly what the first load didn't do.
                    # The explicit wait mirrors extract_company_profile()'s
                    # own anchor -- REAL BUG FOUND AND FIXED 2026-10-04: this
                    # was still waiting on
                    # section.org-about-module__margin-bottom, the exact
                    # selector that 2026-10-01's fix found completely dead
                    # (LinkedIn moved to hashed class names; see
                    # extract_company_profile's own docstring). This retry's
                    # own wait has been silently timing out and doing
                    # nothing useful since that date -- the try/except below
                    # masked it as a harmless no-op rather than a real bug,
                    # since extraction still fell through to the (also
                    # fixed) heading-based read either way. Updated to
                    # page.get_by_role (not a raw CSS tag guess) so this
                    # uses the IDENTICAL, already-proven-live anchor
                    # extract_company_profile()/_bio_paragraph() use for the
                    # real read, not a second, unverified selector guess.
                    try:
                        page.goto(
                            profile_url.rstrip("/") + "/about/",
                            timeout=45_000, wait_until="networkidle",
                        )
                        page.get_by_role("heading", name="Overview").first.wait_for(
                            state="attached", timeout=10_000,
                        )
                    except Exception:  # noqa: BLE001 -- extraction below tolerates a half-loaded page, and a still-empty result is handled as a scrape failure right after
                        pass
                    retried = linkedin.extract_company_profile(page)
                    retried["display_name"] = result.get("display_name")
                    # post_count/recent_activity come from the /posts/ tab, not
                    # from /about -- carry the earlier real read across rather
                    # than letting extract_company_profile()'s own placeholders
                    # (post_count=None, recent_activity=True) overwrite it.
                    retried["post_count"] = profile.get("post_count")
                    retried["recent_activity"] = profile.get("recent_activity")
                    if _linkedin_scrape_looks_empty(retried):
                        # Still nothing after a full networkidle load: log it
                        # as what it actually is. Before this, a rendering
                        # failure was indistinguishable in the progress log
                        # from a genuine qualify rejection, which is precisely
                        # what made a page-timing problem masquerade as a
                        # lead-quality problem for an entire night.
                        counts["skipped_leads"].append({
                            "platform": "linkedin",
                            "identifier": result.get("display_name") or profile_url,
                            "reason": "Scrape failed: LinkedIn /about rendered empty twice -- not a lead-quality rejection.",
                        })
                        _progress_log.info(
                            "[%s] LinkedIn round %d/%d: scrape failed (empty /about after retry): %s",
                            account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                            result.get("display_name") or profile_url,
                        )
                        continue
                    profile = retried
                    _progress_log.info(
                        "[%s] LinkedIn round %d/%d: retry recovered real /about data: %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        result.get("display_name") or profile_url,
                    )

                # LIVE-CONFIRMED 2026-09-01: LinkedIn's own companyHqGeo search
                # facet let a UK company (ZAM FM LTD, Manchester) through a
                # Lebanon-filtered search -- confirmed the exact search URL
                # really did carry the Lebanon facet, so this is bad/stale
                # location data on LinkedIn's own side, not a bug in how the
                # search was built. Two independent, best-effort checks here
                # (neither alone is sufficient -- see each's own comment):
                # (1) the About page's own "Headquarters" field, when present
                # (LIVE-CONFIRMED: often isn't -- ZAM FM's page had none at
                # all, so this check alone would have missed it); (2) scanning
                # the bio text for a known foreign place name
                # (_FOREIGN_LOCATION_MARKERS) -- this is what actually would
                # have caught ZAM FM, whose bio opened with "your trusted
                # partner in Manchester".
                headquarters = (profile.get("headquarters") or "").strip().lower()
                configured_location = (location or "").strip().lower()
                mismatch_reason = None

                # RELAXED 2026-09-13, real owner-confirmed fix: LIVE-CAUGHT
                # tonight, the strict re-check below rejected Dar (Dar
                # Al-Handasah) and Aramex -- two large, famous, genuinely
                # Lebanese-FOUNDED companies -- purely because their
                # LinkedIn Headquarters field lists their current GLOBAL hq
                # (Singapore, Dubai) rather than Beirut, where they
                # started and still operate. Both were surfaced by THIS
                # SAME SEARCH's own companyHqGeo=Lebanon facet -- LinkedIn
                # itself already confirmed a real Lebanon connection before
                # this code ever saw the result, and the stricter
                # Headquarters/bio re-check then threw that confirmation
                # away. When the search was already geo-faceted (true for
                # Zimmar/Insurance, whose configured_location=="lebanon"
                # always resolves via LOCATION_FACETS), trust LinkedIn's own
                # facet and skip the extra re-verification entirely --
                # applying the same location value the search itself
                # already applied a second time, more strictly, was the
                # actual bug, not a real safety net.
                search_used_geo_facet = bool(linkedin.LOCATION_FACETS.get(configured_location))

                if not search_used_geo_facet:
                    # Fallback for a tenant/location LinkedIn has no verified
                    # geo facet ID for (search fell back to free-text
                    # keywords, so LinkedIn never verified location itself)
                    # -- same checks as before, still needed here.
                    if configured_location and headquarters and configured_location not in headquarters:
                        # LIVE-CONFIRMED 2026-09-02: a bare country-name substring
                        # check alone false-positived on real Lebanese companies
                        # whose Headquarters field lists a city/district instead of
                        # the word "Lebanon" (see _LEBANON_PLACE_MARKERS' own
                        # comment for the real examples this caught) -- for a
                        # Lebanon-configured tenant specifically, also accept a
                        # known Lebanese place name as a match before flagging.
                        is_known_lebanon_place = (
                            configured_location == "lebanon"
                            and any(place in headquarters for place in _LEBANON_PLACE_MARKERS)
                        )
                        if not is_known_lebanon_place:
                            mismatch_reason = (
                                f"configured for {location!r}, company's own About page lists "
                                f"headquarters as {profile.get('headquarters')!r}."
                            )

                    if not mismatch_reason:
                        foreign_marker = _mentions_foreign_location(profile.get("bio") or "", location or "")
                        if foreign_marker:
                            mismatch_reason = (
                                f"configured for {location!r}, company's own bio mentions {foreign_marker!r}."
                            )

                # RE-TIGHTENED 2026-09-19, real owner audit (a separate,
                # independent web-search verification of every live Zimmar/
                # Insurance LinkedIn lead): even WITH the geo-facet applied,
                # real false positives got through -- Evans Engineering and
                # Construction (genuinely Kenya-based, zero Lebanon
                # connection), ITT Inc. (US industrial conglomerate, no
                # Lebanon presence at all), Bitarchitects (relocated to
                # Washington DC after the 2020 Beirut Blast, no continuing
                # Lebanon office), First Law International (a Brussels-HQ'd
                # law-firm NETWORK brand -- Lebanon is only represented by an
                # independent member firm, not this entity itself). The
                # geo-facet-trusts-LinkedIn relaxation above (2026-09-13) was
                # solving a real problem (Aramex/Dar Al-Handasah wrongly
                # rejected for showing a foreign HQ despite genuine, current
                # Lebanon branches) but went too far by skipping verification
                # entirely rather than just skipping the HQ-mismatch hard
                # reject specifically. Fix: the has_lebanon_signal check now
                # ALWAYS runs, regardless of search_used_geo_facet -- a
                # company needs at least ONE positive signal (Headquarters
                # field or bio naming an actual Lebanese place) to qualify,
                # which real Lebanon-operating companies (even ones with a
                # foreign global HQ, like Aramex/Dar/DAMAC's Beirut branch)
                # still have via their bio, while a company with literally
                # no Lebanon connection (Evans/ITT/Bitarchitects/First Law)
                # does not. The HQ-mismatch-alone hard reject stays OFF for
                # the geo-facet case (that specific check is what wrongly
                # flagged Aramex/Dar before) -- only the weaker "is there ANY
                # positive signal at all" bar applies here.
                if not mismatch_reason and configured_location == "lebanon":
                    bio_lower = (profile.get("bio") or "").lower()
                    # CONSIDERED and REJECTED 2026-09-19: adding
                    # search_used_geo_facet itself as a 4th OR signal here,
                    # to recover real false-negatives like Arabian
                    # Construction Co. and UNITECH (independently confirmed
                    # genuinely Lebanon-operating, but with English-only
                    # LinkedIn About pages -- no city/phone/Arabic). NOT
                    # done: search_used_geo_facet is computed once from
                    # `linkedin.LOCATION_FACETS.get(configured_location)`,
                    # which is a fixed fact about the SEARCH itself (Lebanon
                    # always has a known facet id), not per-candidate
                    # evidence -- it is True for every single Zimmar/
                    # Insurance candidate this whole session, not just the
                    # ones that are genuinely Lebanese. Using it here would
                    # make has_lebanon_signal always True and silently
                    # revert to tonight's original bug (Evans Engineering,
                    # ITT Inc., Bitarchitects would all pass again). A real
                    # per-candidate version of this idea needs LinkedIn to
                    # expose something like "this specific result's location
                    # facet actually matched," which the current scrape does
                    # not read -- flagging as a genuine open gap rather than
                    # shipping a fix that quietly undoes tonight's real
                    # progress.
                    has_lebanon_signal = (
                        any(place in headquarters or place in bio_lower for place in _LEBANON_PLACE_MARKERS)
                        or _has_lebanon_phone_or_arabic(profile.get("bio") or "")
                    )
                    if not has_lebanon_signal:
                        mismatch_reason = (
                            "configured for 'lebanon', but neither the company's Headquarters "
                            "field, bio location, phone number, nor Arabic text confirms this "
                            "is a Lebanese company."
                        )

                if mismatch_reason:
                    counts["skipped_leads"].append({
                        "platform": "linkedin",
                        "identifier": result.get("display_name") or profile_url,
                        "reason": f"Location mismatch: {mismatch_reason}",
                    })
                    _progress_log.info(
                        "[%s] LinkedIn round %d/%d: rejected (location) %s -- %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        result.get("display_name") or profile_url, mismatch_reason,
                    )
                    continue

                # Own competitors -- see _is_competitor()'s own comment.
                if _is_competitor(business_name, profile.get("bio") or "", profile.get("industry")):
                    counts["skipped_leads"].append({
                        "platform": "linkedin",
                        "identifier": result.get("display_name") or profile_url,
                        "reason": f"Excluded: this company competes with {business_name or 'this tenant'}.",
                    })
                    _progress_log.info(
                        "[%s] LinkedIn round %d/%d: rejected (competitor) %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        result.get("display_name") or profile_url,
                    )
                    continue

                # No agencies -- see _AGENCY_EXCLUDED_BUSINESSES' own comment.
                if (business_name or "").strip().lower() in _AGENCY_EXCLUDED_BUSINESSES and _lead_is_agency(
                    result.get("display_name") or "", profile.get("bio") or ""
                ):
                    counts["skipped_leads"].append({
                        "platform": "linkedin",
                        "identifier": result.get("display_name") or profile_url,
                        "reason": "Excluded: this is an agency, not an operating company/business.",
                    })
                    _progress_log.info(
                        "[%s] LinkedIn round %d/%d: rejected (agency) %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        result.get("display_name") or profile_url,
                    )
                    continue

                # No headcount listed at all -> benefit of the doubt, let it
                # through (owner's explicit call 2026-09-12: reject-on-unknown
                # was shrinking an already-narrow pool, e.g. Insurance's 100+
                # filter, harder than the owner wants). Only a KNOWN headcount
                # below the configured minimum is a real rejection.
                headcount = profile.get("follower_or_headcount")
                if min_company_size and headcount is not None and headcount < min_company_size:
                    counts["skipped_leads"].append({
                        "platform": "linkedin",
                        "identifier": result.get("display_name") or profile_url,
                        "reason": f"Below configured minimum company size: needs {min_company_size}+ employees, company shows {headcount}.",
                    })
                    _progress_log.info(
                        "[%s] LinkedIn round %d/%d: rejected (company size: %s < %s) %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        headcount, min_company_size, result.get("display_name") or profile_url,
                    )
                    continue

                # REMOVED 2026-09-13, real owner decision after live testing:
                # this pre-check (added earlier the same night after
                # TEAMWORK ENERGY failed at send time) turned out to have a
                # ~25% false-reject rate on real, reachable companies
                # (LebEx, Bilani Transportation, OPES Software, Arab
                # Software Company all wrongly rejected) even after two
                # rounds of tuning its render-wait timing (3s, then 6s) --
                # the droplet's CPU contention (see session.py's own
                # comment on the 1.9GB RAM/1 vCPU constraint) makes a fixed
                # wait an unreliable signal. Owner's call: losing real,
                # reachable leads to false rejects here is worse than the
                # actual cost of a genuine no-button lead reaching send
                # time -- linkedin_send.py's send path already catches
                # NoMessageButtonAvailable cleanly (no crash, marks the
                # send failed) rather than silently succeeding or losing
                # the lead, and the Approval queue now shows the SPECIFIC
                # reason ("No Message button", not just a generic "Failed")
                # so the owner can tell the two failure modes apart at a
                # glance -- see outreach-approvals.ts's own comment on
                # sendStatusReason.

                # BUGFIX 2026-09-17, real live-confirmed harm: this used to
                # pass the outer `niche` -- resolved ONCE at the top of the
                # whole discovery cycle (_resolve_search_niche, called from
                # _run_discovery_cycle_for_tenant) -- into qualification, even
                # though `search_niche` (this round's ACTUAL search keyword,
                # which rotates every round for an empty/service niche via
                # _next_search_terms) is what really found this candidate.
                # LIVE-CONFIRMED tonight: Zimmar and Insurance both searched
                # "construction" in one of their rounds and surfaced the same
                # real companies (Arabian Construction Co., UNITECH, Evans
                # Engineering, Regbar, Murex, ITG Holding, Sword Group,
                # NavLink, Falcon Logistics, ...). Zimmar's fixed top-of-run
                # `niche` happened to be "construction" too, so its
                # _mentions_niche check passed; Insurance's fixed top-of-run
                # `niche` had randomly landed on a DIFFERENT, unrelated word,
                # so the identical real candidates all took the -2
                # "bio does not mention the target niche" penalty and were
                # rejected -- purely from this mismatch, not from being bad
                # leads. Passing `search_niche` (this round's real keyword)
                # instead makes qualify-time relevance always match what was
                # actually searched for. For a tenant with a real configured
                # niche this is a no-op: _next_search_terms only ever PEELS
                # that real niche into a still-on-topic substring
                # ("Security and building infrastructure integration" ->
                # "infrastructure integration"), never swaps in an unrelated
                # word, so search_niche and niche stay meaningfully the same
                # topic for those tenants exactly as before.
                qualifies, reasons = _save_if_qualified_with_reasons(
                    account, "linkedin", profile_url, profile, search_niche
                )
                if qualifies:
                    counts["linkedin_saved"] += 1
                    _progress_log.info(
                        "[%s] LinkedIn round %d/%d: SAVED %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        result.get("display_name") or profile_url,
                    )
                else:
                    _progress_log.info(
                        "[%s] LinkedIn round %d/%d: rejected by qualify_profile: %s -- reasons: %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        result.get("display_name") or profile_url, reasons,
                    )
            except Exception as exc:  # noqa: BLE001 -- one bad lead shouldn't stop the rest of the batch
                counts["skipped_leads"].append({
                    "platform": "linkedin",
                    "identifier": result.get("display_name") or profile_url,
                    "reason": str(exc),
                })
                # Added 2026-09-13, real bug found live: this exception path
                # was silently swallowing candidates (a /posts/ page-load
                # timeout, in particular) with no visible trace beyond the
                # DB error_log table -- from the discovery-progress log
                # alone, a candidate lost here looked IDENTICAL to one
                # correctly rejected by qualify_profile, which made a real
                # page-timeout problem look like an over-strict qualify bug.
                _progress_log.info(
                    "[%s] LinkedIn round %d/%d: EXCEPTION on %s -- %s",
                    account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                    result.get("display_name") or profile_url, exc,
                )
                log_error("discovery", exc, channel="linkedin", account_id=account["id"])


# Hashtags that real BUSINESSES tag their own posts with, as opposed to
# hashtags describing a service someone sells. Added 2026-09-13 on the
# owner's explicit instruction ("the hashtags should be related to
# companies, not strictly to cgi or vfx, because we are reaching
# companies"): searching #cgi surfaces other CGI artists showing off their
# work, not the brands who might BUY it. These are the tags a real company
# posts under, so they surface actual businesses.
# REVISED 2026-09-13 after reviewing what these actually returned: the first
# version of this list included "entrepreneur", "business owner", "small
# business" and "startup". On Instagram those are overwhelmingly COACHES,
# consultants and influencers talking ABOUT business -- the exact "we should
# try to not get individuals" problem -- not companies posting their own
# products. Tags kept here are ones a real product business posts under
# while showing its own goods, which is also what makes it a live prospect
# for product visuals, insurance, or security hardware alike.
_BUSINESS_HASHTAG_TERMS = [
    "new collection",
    "new arrival",
    "product launch",
    "now open",
    "our store",
    "showroom",
    "free delivery",
    "order now",
    "shop now",
    "made in lebanon",
    "local business",
    "family business",
    "wholesale",
    "boutique",
    # ADDED 2026-10-04, owner's explicit request for more variety in
    # Instagram discovery results -- LIVE-VERIFIED every one of these
    # (not guessed) via instagram.extract_hashtag_results() against this
    # exact production code path, each returning 21 real raw posts per
    # load, same as the original list above. Location/Lebanon-identity
    # tags rather than business-phrase tags -- a genuinely different pool
    # of real accounts than the phrase-based terms above tend to surface,
    # which is the actual point: more distinct starting points for a
    # search round, not just a longer list of similar terms.
    "beirut",
    "lebanon",
    "beirutlebanon",
    "lebanesebusinesses",
    "lebanonstartup",
    "lebanesebrands",
    "lebanesedesigner",
    "madeinlb",
    "tripoli",
    "jounieh",
    "byblos",
    # ADDED 2026-10-04 (second pass), owner's explicit request ("search for
    # best 30-50 hashtags we find companies through them") -- same
    # live-verification discipline as the first 11 above, all 30
    # confirmed via instagram.extract_hashtag_results() against this exact
    # production code path, each returning 21 real raw posts. Three
    # distinct categories, each a genuinely different pool of real
    # accounts: more Lebanese cities/neighborhoods (beyond the 3 above),
    # business/commerce-identity tags, and sector-specific tags (food,
    # fashion, real estate, etc. -- covers Zimmar/Insurance's broad "any
    # industry" targeting better than the phrase-only tags at the top of
    # this list ever could alone).
    "saida",
    "zahle",
    "baalbek",
    "nabatieh",
    "achrafieh",
    "hamra",
    "jbeil",
    "batroun",
    "kaslik",
    "dbayeh",
    "zalka",
    "antelias",
    "bikfaya",
    "lebanesebusiness",
    "lebanonmarket",
    "beirutmarket",
    "lebanonshopping",
    "beirutshopping",
    "lebanonbrand",
    "supportlebanesebusiness",
    "smalllebanesebusiness",
    "entrepreneurlebanon",
    "startuplebanon",
    "lebanonstore",
    "lebanonshop",
    "onlineshoplebanon",
    "deliverylebanon",
    "lebanesefood",
    "lebanesefashion",
    "lebanesedesign",
    "lebanesejewelry",
    "lebanesecosmetics",
    "lebanesehandmade",
    "lebaneseart",
    "realestatelebanon",
    "constructionlebanon",
    "techlebanon",
]


def _next_hashtag(
    search_niche: str, original_niche: str, tried_tags: set[str],
    tenant_terms: list[str] | None = None,
) -> str | None:
    """
    Pick the next hashtag to try after a round came up short.

    Order: (1) peel a leading qualifier word off the configured niche, which
    keeps the search on-topic while broadening it; (2) once that's exhausted,
    rotate through _BUSINESS_HASHTAG_TERMS, which surface real companies
    rather than people selling the same service (see that list's own
    comment). Returns None when everything has been tried.

    Peeling deliberately STOPS while at least two words remain. Peeling all
    the way down to a single generic word is actively harmful on Instagram:
    MJivity's "small business marketing" degraded to "marketing", and
    #marketing is almost entirely marketing influencers and agencies rather
    than the product brands MJivity is trying to reach. A two-word tag stays
    specific enough to describe a business; the curated list below is a
    better fallback than a one-word tag ever is.
    """
    words = search_niche.split()
    while len(words) > 2:
        words = words[1:]
        while len(words) > 2 and words[0].lower() in _NICHE_STOPWORDS:
            words = words[1:]
        shorter = " ".join(words)
        if shorter not in tried_tags:
            return shorter

    # The tenant's own configured sectors come before the generic list --
    # #jewelry or #cosmetics surfaces actual brands for MJivity far better
    # than any all-purpose business tag can.
    if tenant_terms:
        untried_tenant = [t for t in tenant_terms if t not in tried_tags]
        if untried_tenant:
            return random.choice(untried_tenant)

    untried = [t for t in _BUSINESS_HASHTAG_TERMS if t not in tried_tags]
    if untried:
        return random.choice(untried)
    return None


def _discover_instagram(
    account: dict, page, niche: str, counts: dict,
    tenant_terms: list[str] | None = None, business_name: str = "",
    location: str = "", niche_is_random: bool = False,
) -> None:
    # No min_company_size parameter here on purpose: Instagram's own
    # follower_or_headcount field (instagram.py) is a FOLLOWER count, not
    # an employee count the way LinkedIn's version genuinely is (scraped
    # from the company's About page) -- applying a company-size floor to
    # follower count would filter on social-media popularity, not company
    # size, which is a different and wrong signal. Company-size filtering
    # only makes sense on LinkedIn, where the underlying number is real.
    limit = warmup.effective_limit(account, "instagram")
    # Raw-collection target per ROUND, not the final saved count.
    search_target = limit * _DISCOVERY_OVERSAMPLE_MULTIPLIER
    search_niche = niche
    seen_urls: set[str] = set()
    tried_tags: set[str] = set()
    counts["instagram_search_terms"] = []

    # RESTRUCTURED 2026-09-13, same fix and same reason as
    # _discover_linkedin above: search and qualification used to be two
    # separate sequential loops, so a round whose candidates all got
    # rejected ended the run at 0 with search attempts still unused. One
    # loop now does search -> visit -> qualify per round and only starts
    # another round if the SAVED count is still short.
    _discovery_started_at = time.monotonic()
    for attempt in range(_MAX_SEARCH_ATTEMPTS):
        if counts["instagram_saved"] >= limit:
            break
        # ADDED 2026-10-04, owner's explicit request: same time cap and
        # same reasoning as _discover_linkedin's own copy -- see
        # _PER_ACCOUNT_DISCOVERY_TIME_CAP_SECONDS's comment.
        if time.monotonic() - _discovery_started_at >= _PER_ACCOUNT_DISCOVERY_TIME_CAP_SECONDS:
            _progress_log.info(
                "[%s] Instagram: time cap reached (%d saved so far) -- yielding to the next account",
                account.get("label"), counts["instagram_saved"],
            )
            break
        if attempt > 0:
            next_tag = _next_hashtag(search_niche, niche, tried_tags, tenant_terms)
            if next_tag is None:
                break
            search_niche = next_tag
            # Owner's "wait some minutes before the next batch" rule, and
            # the same anti-burst reasoning as the LinkedIn loop's own
            # wait -- a real person doesn't fire hashtag searches back to
            # back.
            page.wait_for_timeout(random.randint(60_000, 150_000))

        tried_tags.add(search_niche)
        posts: list[dict] = []
        counts["instagram_search_terms"].append(search_niche)
        _progress_log.info(
            "[%s] Instagram round %d/%d: searching hashtag %r",
            account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS, search_niche,
        )
        # RE-VERIFIED live 2026-08-03: Instagram now redirects
        # /explore/tags/<tag>/ to /explore/search/keyword/?q=%23<tag> (a
        # generic search page, confirmed universal across multiple tags, not
        # a per-tag quirk) -- build_hashtag_url's URL itself still gets
        # there, but that page's results render client-side well after
        # domcontentloaded. The original code had no wait at all here, so it
        # was reading the page before any results existed, which is why every
        # discovery run before this fix found 0 Instagram leads regardless of
        # niche. This delay is genuinely inconsistent across real runs --
        # live testing saw 0 results at 5s, 21 results at 7s and 9s on
        # separate attempts, then 0 again at 7s in a later production run --
        # 10s was chosen for more margin, but this remains network-dependent
        # and worth revisiting if 0-result runs keep happening.
        page.goto(instagram.build_hashtag_url(search_niche), timeout=30_000, wait_until="domcontentloaded")
        # REAL BUG FOUND AND FIXED 2026-10-04: checked once per round, right
        # after the navigation that would actually reveal it -- see
        # instagram_send._raise_if_logged_out's own 2026-10-04 update for
        # the full incident (Insurance Instagram hit a real Instagram
        # security checkpoint and silently returned "0 raw posts" for 16
        # different hashtags in a row, burning the whole round budget on an
        # account that was never going to return real results that night).
        # Raised here so the caller sees a clear, specific failure instead
        # of a 0-found/0-saved result indistinguishable from an honest weak
        # night -- propagates up through _discover_instagram and the
        # per-account discovery loop the same way any other real discovery
        # exception already does.
        _raise_if_instagram_logged_out(page, account)
        page.wait_for_timeout(10_000)
        for post in instagram.extract_hashtag_results(page):
            url = post.get("post_url")
            if url and url not in seen_urls:
                seen_urls.add(url)
                posts.append(post)

        _progress_log.info(
            "[%s] Instagram round %d/%d: %d raw post(s) for %r",
            account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS, len(posts), search_niche,
        )
        # Raw candidates from THIS round only; the daily cap is enforced by
        # the saved-count checks, not by pre-filtering the batch.
        posts = posts[: max(search_target, limit)]
        counts["instagram_found"] = counts.get("instagram_found", 0) + len(posts)

        for post_index, post in enumerate(posts):
            if counts["instagram_saved"] >= limit:
                break
            # Same profile-visit pacing as the LinkedIn loop above -- each
            # iteration here navigates to a post AND then to that poster's
            # profile, so an unpaced loop is two rapid page loads per lead.
            if post_index > 0:
                _sleep_between_profile_visits()
            _progress_log.info(
                "[%s] Instagram round %d/%d: visiting candidate %d/%d -- saved so far: %d/%d",
                account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                post_index + 1, len(posts), counts["instagram_saved"], limit,
            )
            try:
                profile_url = instagram.resolve_post_to_profile_url(page, post["post_url"])
                if not profile_url:
                    continue
                # ADDED 2026-10-04, owner's explicit request, Instagram's
                # version of the LinkedIn page-jump fix above: Instagram's
                # hashtag feed has no page-number jump (LIVE-CONFIRMED --
                # it's cursor-based GraphQL pagination, not a URL param),
                # so the same underlying goal (don't re-spend a profile
                # visit on an already-known company) is reached differently
                # here -- skip BEFORE the expensive profile page load
                # (extract_profile() + all the qualification checks after
                # it), right after resolving WHO posted it, which is the
                # earliest point this loop knows the real company identity.
                # The post itself still counted toward this round's raw
                # "found" tally above; only the costly re-visit is skipped.
                handle = profile_url.rstrip("/").rsplit("/", 1)[-1]
                if repo.was_recently_seen("instagram", handle, tenant_id=account["tenant_id"]):
                    continue
                engagement = instagram.extract_post_engagement(page)  # page is still on the post/reel here
                page.goto(profile_url, timeout=30_000, wait_until="domcontentloaded")
                profile = instagram.extract_profile(page)
                profile["engagement_sample"] = engagement
                # FIXED 2026-09-20 -- see instagram.py's
                # _OG_TITLE_DISPLAY_NAME_RE for the real discovery: og:title
                # now genuinely carries the display name (re-verified live,
                # no longer true that it "only has the @username" as this
                # comment previously claimed on 2026-08-03). extract_profile()
                # now returns a real display_name when parseable; only fall
                # back to the bare @handle (from profile_url) when it isn't
                # -- same safety net as before, now just the exception
                # instead of the rule. This is what lets
                # instagram_reply_check.py's business_name-based inbox
                # search actually match a real conversation going forward:
                # Instagram's own inbox list shows the DISPLAY NAME, never
                # the handle, which is exactly why 2 real leads'
                # (fadeltradingcompany, titus.logistics) replies went
                # undetected -- the handle this code used to save literally
                # never appears anywhere in that list.
                # `handle` already computed above for the skip-list check --
                # same value, reused rather than recomputed a second time.
                profile["display_name"] = profile.get("display_name") or handle
                # Own competitors -- see _is_competitor()'s own comment. This
                # check previously only existed on the LinkedIn side, so
                # Zimmar's Instagram discovery had no defense against
                # surfacing other CCTV/security-camera/alarm accounts.
                if _is_competitor(business_name, profile.get("bio") or "", None):
                    counts["skipped_leads"].append({
                        "platform": "instagram",
                        "identifier": profile.get("display_name") or profile_url,
                        "reason": f"Excluded: this account competes with {business_name or 'this tenant'}.",
                    })
                    _progress_log.info(
                        "[%s] Instagram round %d/%d: rejected (competitor) %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        profile.get("display_name") or profile_url,
                    )
                    continue

                # No agencies -- see _AGENCY_EXCLUDED_BUSINESSES' own comment.
                if (business_name or "").strip().lower() in _AGENCY_EXCLUDED_BUSINESSES and _lead_is_agency(
                    profile.get("display_name") or "", profile.get("bio") or ""
                ):
                    counts["skipped_leads"].append({
                        "platform": "instagram",
                        "identifier": profile.get("display_name") or profile_url,
                        "reason": "Excluded: this is an agency, not an operating company/business.",
                    })
                    _progress_log.info(
                        "[%s] Instagram round %d/%d: rejected (agency) %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        profile.get("display_name") or profile_url,
                    )
                    continue

                # OWNER REQUEST 2026-10-07: the foreign-location pre-checks
                # that used to live here (a hard reject on an explicit
                # foreign place name, plus a separate "no Lebanon signal at
                # all" silence-based reject) were REMOVED from this
                # pre-check step -- qualify_profile() now owns Instagram's
                # entire foreign-evidence decision internally (see
                # _has_foreign_evidence in discovery/qualify.py), including
                # the explicit-foreign-mention case this block used to
                # handle here. The silence-based "no Lebanon signal" reject
                # specifically does NOT carry over at all, per the owner's
                # explicit instruction not to disqualify an uncertain/silent
                # bio -- only a POSITIVE foreign signal (place name, non-
                # Lebanese phone country code, or non-English/non-Arabic
                # script) disqualifies now. Doing this inside
                # qualify_profile() (not here) keeps one single place that
                # owns the whole Instagram qualification decision, same
                # reasoning as the niche_is_random fix just above.
                qualifies, reasons = _save_if_qualified_with_reasons(
                    account, "instagram", profile_url, profile, search_niche,
                    niche_is_random=niche_is_random,
                )
                if qualifies:
                    counts["instagram_saved"] += 1
                    _progress_log.info(
                        "[%s] Instagram round %d/%d: SAVED %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        profile.get("display_name") or profile_url,
                    )
                else:
                    _progress_log.info(
                        "[%s] Instagram round %d/%d: rejected by qualify_profile: %s -- reasons: %s",
                        account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                        profile.get("display_name") or profile_url, reasons,
                    )
            except Exception as exc:  # noqa: BLE001 -- one bad lead shouldn't stop the rest of the batch
                counts["skipped_leads"].append({
                    "platform": "instagram",
                    "identifier": post.get("post_url"),
                    "reason": str(exc),
                })
                # See the LinkedIn loop's identical comment above -- a
                # silently swallowed exception here was indistinguishable
                # from a real qualify_profile rejection without this line.
                _progress_log.info(
                    "[%s] Instagram round %d/%d: EXCEPTION on %s -- %s",
                    account.get("label"), attempt + 1, _MAX_SEARCH_ATTEMPTS,
                    post.get("post_url"), exc,
                )
                log_error("discovery", exc, channel="instagram", account_id=account["id"])


def run_analysis_cycle(limit: int | None = None) -> list[dict]:
    """
    Analyze every lead currently sitting at status "discovered", across
    every tenant that currently has active Outreach accounts (Phase 4,
    ported multi-tenant 2026-08-20).

    Task 10 from the spec: the full enriched record is saved to
    client_history BEFORE any message is generated (see
    run_message_generation_cycle() below, Phase 5) -- client_history exists
    permanently, whether or not this lead is ever contacted.

    `limit` caps how many leads are processed PER TENANT in one call --
    useful for a careful first test rather than analysing an entire backlog
    at once.

    Tenant-level isolation: one tenant raising here is logged and skipped,
    same reasoning as run_cycle() above.
    """
    results = []
    for tenant_id in repo.list_active_tenant_ids():
        # start_stage_run/finish_run both write to the RLS-protected
        # outreach_runs table -- LIVE-CONFIRMED 2026-09-01, both must run
        # inside tenant_scope() (the earlier version called
        # start_stage_run before entering it, which real-tested as a hard
        # InsufficientPrivilege from Postgres's own RLS policy, not a
        # Python-level bug).
        with repo.tenant_scope(tenant_id):
            if repo.is_tenant_paused():
                continue
            run = repo.start_stage_run(tenant_id, "analysis")
            try:
                tenant_results = _run_analysis_cycle_for_tenant(tenant_id, limit)
                results.extend(tenant_results)
                ok_count = sum(1 for r in tenant_results if r.get("ok"))
                repo.finish_run(
                    tenant_id, run["id"], leads_found=len(tenant_results), messages_sent=0,
                    status="completed", finished_at_iso=dt.datetime.now(dt.timezone.utc).isoformat(),
                    notes=f"{ok_count}/{len(tenant_results)} leads analyzed successfully." if tenant_results else "No leads to analyze.",
                )
            except Exception as exc:  # noqa: BLE001 -- one bad tenant must not stop the others
                repo.finish_run(
                    tenant_id, run["id"], leads_found=0, messages_sent=0,
                    status="error", finished_at_iso=dt.datetime.now(dt.timezone.utc).isoformat(),
                    notes=str(exc),
                )
                try:
                    repo.insert_error({
                        "stage": "analysis", "error_message": str(exc), "is_expected": False,
                    }, tenant_id=tenant_id)
                except Exception:  # noqa: BLE001 -- logging itself must never crash the pipeline
                    pass
    return results


def _bare_domain(website: str | None) -> str | None:
    """
    "https://www.acmesecurity.com/about" -> "acmesecurity.com". Findymail's
    /search/name endpoint takes a bare domain (per its docs, e.g.
    "tesla.com"), not a full URL -- LinkedIn's captured website field is
    whatever a company put in their profile, which can be either shape.
    Returns None for anything that doesn't parse into a real host, rather
    than passing a garbage value to a paid API call.
    """
    if not website:
        return None
    from urllib.parse import urlparse

    parsed = urlparse(website if "://" in website else f"https://{website}")
    host = parsed.netloc or parsed.path.split("/")[0]
    host = host.removeprefix("www.")
    return host or None


def _maybe_find_email(tenant_id: str, lead: dict, founder_name: str | None) -> bool:
    """
    Best-effort: if this (LinkedIn) lead has a real website, look up an
    email for it and -- if found -- create a SEPARATE, linked
    `email`-platform OutreachLead for the same company (not a field bolted
    onto the LinkedIn lead itself), so the existing per-platform
    message-generation/approval/sending pipeline (run_message_generation_cycle,
    run_sending_cycle) handles it identically to any other email lead, no
    special-casing needed anywhere downstream. Same company, hit on two
    channels -- the tenant's explicit choice (see PROGRESS.md's dated entry
    on this feature).

    Two-tier lookup (2026-09-01, real behavior change -- see this
    function's own body): a known founder/decision-maker name gets a
    targeted person lookup first (Hunter Email Finder); if that's not
    available or comes up empty, falls back to a domain-wide lookup
    (Hunter Domain Search) that needs no name at all -- so a lead with no
    detected founder still gets a real shot at an email lead instead of
    being a dead end. The saved lead's `notes` records which of the two
    actually found it.

    Returns True if at least one email lead was actually saved for this
    company, False otherwise (added 2026-09-27, owner's explicit request:
    the caller uses this to decide whether a LINKEDIN-discovered lead with
    no findable email gets rejected outright -- see
    _run_analysis_cycle_for_tenant's own comment on why that check lives
    there, not here, and why Instagram-discovered leads are deliberately
    exempt).

    Silent no-op (not an error) when: no website, HUNTER_API_KEY isn't
    set, or Hunter genuinely has no match on either tier -- every one of
    these is a normal, expected outcome for SOME leads, not a failure.
    Only a real Hunter API error (bad key, no credits) propagates, so the
    caller's existing per-lead try/except and log_error() isolation
    catches it the same way any other per-lead external-service failure
    already is.
    """
    # Was hard-restricted to platform=="linkedin" only -- removed
    # 2026-09-19. Real audit that day found Zimmar's 44 Instagram leads (its
    # single biggest source) got ZERO shot at an email purely from this
    # gate, not from Hunter failing. This check now only needs a real
    # `website` value, whichever platform found it -- LinkedIn is simply the
    # only platform that currently ever populates one (Instagram's bio-link
    # requires a real click to reveal per instagram.py's own
    # extract_profile_data() docstring, a separate, not-yet-built fix; this
    # change just stops silently discarding the field's value if/when that
    # ever changes, and costs nothing today since it stays empty either way).
    domain = _bare_domain(lead.get("website"))
    if not domain:
        return False

    # Domain-sanity check (2026-09-17, real bad match this fixes): a
    # LinkedIn profile's "website" field is sometimes a bio-link/social
    # platform URL (e.g. https://linktr.ee/KedemosEducation), not the
    # company's own site. Searching Hunter against a bare domain like
    # "linktr.ee" -- for EITHER tier below, person lookup or domain search
    # -- returns an email Hunter has on file for that PLATFORM, unrelated
    # to the actual lead (confirmed: "Kedemos Education" got
    # pooya@linktr.ee this way). Bail out before calling Hunter at all
    # rather than manufacturing a confident-looking but wrong email lead.
    if hunter.is_blocklisted_domain(domain):
        _progress_log.info(
            "[email-lookup] skipping lead=%s: website resolves to generic platform "
            "domain %s, not the company's own site", lead.get("id"), domain,
        )
        return False

    # Hunter is the ACTIVE provider (trialing its 50 free credits/month
    # first, per the tenant's explicit choice -- see discovery/hunter.py's
    # module docstring). Findymail stays wired and importable as the
    # fallback/comparison provider but is not called here; swap this one
    # call if the trial concludes Icypeas or Findymail should be used
    # instead, no other code needs to change either provider's own
    # exception names line up (HunterNotConfigured mirrors
    # FindymailNotConfigured) so this except clause needs no changes on swap.
    #
    # LIVE-CONFIRMED 2026-09-01: this used to require founder_name and
    # return immediately without one -- real behavior change, per the
    # platform owner's explicit request, to give every LinkedIn lead with a
    # real website a SECOND chance at an email lead even when no
    # founder/decision-maker name was ever detected. find_email() (person
    # lookup) stays the first, more targeted try when a name exists;
    # find_company_emails() (domain search, no name needed) is the
    # fallback -- tried only when either no name was found, or the named
    # lookup itself came back with nothing.
    email = None
    found_via = None
    # See config.HUNTER_PAUSED_FOR_ICYPEAS_TRIAL's own docstring: Hunter's
    # API key and code stay fully intact (deploy.sh's regression tests still
    # exercise it directly) -- this flag only skips CALLING it here, for a
    # real, uncontaminated Icypeas-alone trial.
    if not config.HUNTER_PAUSED_FOR_ICYPEAS_TRIAL:
        if founder_name:
            try:
                email = hunter.find_email(founder_name, domain)
            except hunter.HunterNotConfigured:
                pass  # not configured is not fatal here -- Hunter's other tier or Icypeas may still be, see below
            else:
                if email:
                    found_via = f"Hunter Email Finder for {founder_name}"

        if not email:
            try:
                email = hunter.find_company_emails(domain)
            except hunter.HunterNotConfigured:
                pass  # not configured is not fatal here -- Icypeas may still be, see below
            else:
                if email:
                    found_via = "Hunter Domain Search (no founder name identified)"

    # ADDED 2026-09-20, real owner request: a SECOND, independent provider
    # tried only when Hunter found nothing on either of its own two tiers --
    # not a replacement, an additional real chance, so a lead Hunter's
    # database genuinely doesn't have still gets a shot rather than being a
    # dead end. Icypeas is a genuinely different data source than Hunter's
    # own crawled database (see discovery/icypeas.py's own module docstring
    # for the real research behind picking it), so this is a real second
    # opinion, not just re-asking the same underlying data. Kept as a
    # fallback rather than the primary tier until it has real live-verified
    # results to compare against Hunter's own -- see icypeas.py's docstring
    # for what's confirmed-from-docs versus what still needs a real API
    # call to fully verify.
    # ADDED 2026-09-27, owner's explicit request: unlike Hunter above
    # (stops at the first tier that finds anything), Icypeas tries BOTH the
    # founder lookup AND the domain-wide company lookup independently, and
    # saves a SEPARATE email lead for each one that succeeds -- "if only
    # founder okay send, so if both send both, if one send anyways." Only
    # reached when Hunter (tried first, unconditionally, above) found
    # nothing at all -- Icypeas stays the fallback provider, this dual-save
    # behavior doesn't change when it's tried, only what happens once it
    # runs. Both results (when both exist) still count as ONE company
    # discovered toward the day's cap -- warmup.effective_limit() gates how
    # many LinkedIn/Instagram leads get PROCESSED per day, not how many
    # email leads come out the other end of this one call, so two emails
    # for the same company costs nothing extra against that cap.
    found_emails: list[tuple[str, str]] = []  # [(email, found_via), ...]
    if not email:
        if founder_name:
            try:
                founder_email = icypeas.find_email(founder_name, domain)
            except icypeas.IcypeasNotConfigured:
                pass
            else:
                if founder_email:
                    found_emails.append((founder_email, f"Icypeas Email Finder for {founder_name}"))
        try:
            company_email = icypeas.find_company_emails(domain)
        except icypeas.IcypeasNotConfigured:
            pass
        else:
            if company_email and company_email not in {e for e, _ in found_emails}:
                found_emails.append((company_email, "Icypeas Domain Search"))
    elif found_via:
        found_emails.append((email, found_via))

    if not found_emails:
        return False

    accounts = repo.list_accounts(tenant_id)
    email_account = next((a for a in accounts if a.get("platform") == "email" and a.get("status") == "active"), None)

    # ADDED 2026-09-27: a real email being FOUND (found_emails non-empty)
    # and a real email lead actually EXISTING for this company (either
    # saved just now, or already saved by a prior run) are the two things
    # that matter to the caller -- a fresh duplicate-dedup `continue` below
    # is not a failure, since the earlier save already satisfies "this
    # company has a real email lead." True the moment either happens.
    any_email_lead_exists = False
    for candidate_email, candidate_found_via in found_emails:
        # Dedup by the mailto: profile_url (same mechanism discovery
        # already uses for LinkedIn/Instagram profile URLs, see
        # _save_if_qualified) -- a lookup that returns the same email a
        # second time (e.g. a stray re-analysis pass) must not create a
        # duplicate email lead.
        profile_url = f"mailto:{candidate_email}"
        if repo.lead_profile_url_exists(tenant_id, profile_url):
            any_email_lead_exists = True
            continue

        repo.insert_lead(tenant_id, {
            "account_id": email_account["id"] if email_account else None,
            "platform": "email",
            "business_name": lead.get("business_name"),
            "profile_url": profile_url,  # no real "profile" for an email lead -- mailto: URI doubles as both display value and the dedup key
            "website": lead.get("website"),
            "contact_email": candidate_email,
            "status": "discovered",
            "notes": f"Email found via {candidate_found_via}, linked from LinkedIn lead {lead.get('id')}.",
        })
        any_email_lead_exists = True

    return any_email_lead_exists


def _run_analysis_cycle_for_tenant(tenant_id: str, limit: int | None) -> list[dict]:
    leads = repo.leads_by_status("discovered", tenant_id=tenant_id)
    if limit is not None:
        leads = leads[:limit]

    results = []
    for lead in leads:
        try:
            analysis = analyze.analyze_lead(lead)
            founder_result = founder_detection.detect_founder(lead)
            whatsapp_result = whatsapp_detect.detect_whatsapp(lead)
            score_result = scoring.score_lead(lead, analysis)
        except Exception as exc:  # noqa: BLE001 -- one bad lead shouldn't stop the batch
            results.append({"lead": lead.get("business_name"), "ok": False, "error": str(exc)})
            log_error("analysis", exc, lead_id=lead.get("id"), account_id=lead.get("account_id"))
            continue

        update_fields = {
            "company_size": analysis.get("company_size"),
            "revenue_tier": analysis.get("revenue_tier"),
            "industry": analysis.get("industry"),
            "ads_running": analysis.get("ads_running"),
            "social_platforms": analysis.get("social_platforms") or [],
            "weak_points": analysis.get("weak_points") or [],
            "ai_opportunities": analysis.get("ai_opportunities") or [],
            "founder_found": founder_result.get("founder_found", False),
            "founder_name": founder_result.get("founder_name"),
            "founder_source_phrase": founder_result.get("founder_source_phrase"),
            "whatsapp_found": whatsapp_result.get("whatsapp_found", False),
            "whatsapp_number": whatsapp_result.get("whatsapp_number"),
            "score": score_result.get("score"),
            "temperature": score_result.get("temperature"),
            "score_reasoning": score_result.get("score_reasoning"),
            "status": "analyzed",
        }
        repo.update_lead(lead["id"], update_fields)

        # Best-effort, same channel-isolation guarantee as every other
        # per-lead step here: an email-lookup problem for THIS lead must not
        # lose the analysis/scoring work already committed above for it,
        # or stop the rest of the batch.
        email_found = False
        try:
            email_found = _maybe_find_email(tenant_id, lead, founder_result.get("founder_name"))
        except Exception as exc:  # noqa: BLE001 -- e.g. HunterLookupFailed (bad key, no credits)
            log_error("email_lookup", exc, lead_id=lead.get("id"), account_id=lead.get("account_id"))

        # ADDED 2026-09-27, owner's explicit request: a LinkedIn-discovered
        # company with NO findable email is now a dead end, full stop --
        # "we only need to send by email" -- so it's rejected outright
        # rather than proceeding to message generation for a LinkedIn send
        # (LinkedIn sending is separately disabled anyway, but this makes
        # the rule real and explicit rather than relying on that). Deliberately
        # scoped to platform == "linkedin" only: Instagram-discovered leads
        # are EXEMPT per the same instruction ("however insta if not found
        # the email it is okay") -- an Instagram lead with no email still
        # proceeds normally to message generation for its own real,
        # currently-active Instagram send. Overwrites update_fields["status"]
        # (already committed as "analyzed" above) rather than skipping that
        # write entirely, so the lead keeps its real analysis/score data for
        # visibility -- only its STATUS changes, taking it out of
        # leads_by_status("analyzed", ...)'s pool for message generation.
        #
        # REAL BUG FOUND AND FIXED 2026-10-04, live-confirmed: `email_found`
        # only reflects _maybe_find_email()'s own Hunter/Icypeas lookup --
        # it says nothing about _email_from_bio() already having written a
        # real contact_email directly onto THIS lead's own row at discovery
        # time (see _save_if_qualified_with_reasons's own comment on that
        # path, a few hundred lines up). Hikma Pharmaceuticals had
        # contact_email="PV@hikma.com" (found in its LinkedIn bio at
        # discovery) but email_found was still False, so this check wrongly
        # rejected a lead that already had a real, working email -- both a
        # lost lead and a status directly contradicting its own
        # contact_email column. Re-fetching the lead's current contact_email
        # (update_fields above never set it, so `lead`'s original dict is
        # still accurate) before rejecting closes that gap.
        if lead.get("platform") == "linkedin" and not email_found and not lead.get("contact_email"):
            repo.update_lead(lead["id"], {"status": "rejected_no_email"})
            results.append({"lead": lead.get("business_name"), "ok": False, "reason": "LinkedIn lead rejected: no email found"})
            continue

        repo.insert_client_history(tenant_id, {
            "lead_id": lead["id"],
            "business_name": lead.get("business_name"),
            "platform": lead.get("platform"),
            "industry": analysis.get("industry"),
            "score": score_result.get("score"),
            "temperature": score_result.get("temperature"),
            "weak_points": analysis.get("weak_points") or [],
            "founder_found": founder_result.get("founder_found", False),
            "founder_name": founder_result.get("founder_name"),
            "contacted": False,
            "snapshot": {**lead, **update_fields},
        })

        # Fires immediately per-lead, not batched at the end of the cycle --
        # the spec is explicit that a hot lead alert can't wait for the run
        # to finish (see whatsapp_notify.py's module docstring).
        enriched_lead = {**lead, **update_fields}
        if score_result.get("score", 0) >= 8:
            whatsapp_notify.notify_hot_lead(enriched_lead)
        if founder_result.get("founder_found"):
            whatsapp_notify.notify_founder_found(enriched_lead)
        if whatsapp_result.get("whatsapp_found"):
            whatsapp_notify.notify_number_found(enriched_lead)

        results.append({"lead": lead.get("business_name"), "ok": True, **update_fields})

    return results


def run_message_generation_cycle(limit: int | None = None) -> list[dict]:
    """
    Generate outreach messages for every lead currently sitting at status
    "analyzed", across every tenant that currently has active Outreach
    accounts (Phase 5, ported multi-tenant 2026-08-20): one message on the
    lead's discovery platform, plus an additional WhatsApp message if Phase
    4 found a public WhatsApp number -- WhatsApp is always an ADDITIONAL
    channel, never a replacement for the primary one (see
    whatsapp_detect.py's module docstring).

    The active style (direct/discovery) is read once PER TENANT per cycle,
    not once per lead -- style.get_active_style() only rotates on elapsed
    duration, so every lead in the same tenant's batch gets the same style
    (each tenant has its own settings row and therefore its own style/
    rotation clock).

    `limit` caps how many leads are processed PER TENANT in one call, same
    reasoning as run_analysis_cycle's `limit`.

    Tenant-level isolation: one tenant raising here is logged and skipped,
    same reasoning as run_cycle() above.
    """
    results = []
    for tenant_id in repo.list_active_tenant_ids():
        with repo.tenant_scope(tenant_id):
            if repo.is_tenant_paused():
                continue
            run = repo.start_stage_run(tenant_id, "message_generation")
            try:
                tenant_results = _run_message_generation_cycle_for_tenant(limit)
                results.extend(tenant_results)
                ok_count = sum(1 for r in tenant_results if r.get("ok"))
                repo.finish_run(
                    tenant_id, run["id"], leads_found=len(tenant_results), messages_sent=0,
                    status="completed", finished_at_iso=dt.datetime.now(dt.timezone.utc).isoformat(),
                    notes=f"{ok_count}/{len(tenant_results)} leads got a message generated." if tenant_results else "No leads awaiting a message.",
                )
            except Exception as exc:  # noqa: BLE001 -- one bad tenant must not stop the others
                repo.finish_run(
                    tenant_id, run["id"], leads_found=0, messages_sent=0,
                    status="error", finished_at_iso=dt.datetime.now(dt.timezone.utc).isoformat(),
                    notes=str(exc),
                )
                try:
                    repo.insert_error({
                        "stage": "message_generation", "error_message": str(exc), "is_expected": False,
                    }, tenant_id=tenant_id)
                except Exception:  # noqa: BLE001 -- logging itself must never crash the pipeline
                    pass
    return results


def _run_message_generation_cycle_for_tenant(limit: int | None) -> list[dict]:
    leads = repo.leads_by_status("analyzed")

    # Recovery for leads stranded past "analyzed" with no message ever
    # created (found 2026-09-19: 3 real Insurance leads sat untouched for 4
    # days this way -- see stranded_approved_leads_missing_message()'s own
    # docstring for how they get into this state). Reset each one back to
    # "analyzed" first so the untouched loop below treats it exactly like a
    # normal freshly-analyzed lead -- same generation path, same approval
    # gate afterward, nothing special-cased past this point.
    stranded = repo.stranded_approved_leads_missing_message()
    if stranded:
        # ADDED 2026-10-07, real incident: 5 real leads (Noema Consulting,
        # Traincape Technology, PIS Walls and Floors, Human Valoris,
        # logistics Yard) sat stranded in "approved" with zero message rows
        # for 7+ hours across TWO scheduled message_generation runs before
        # this was noticed -- the recovery query itself was correct and
        # caught them instantly the moment it was run manually, but nothing
        # ever logged whether/how many stranded leads a given cycle found,
        # so a run that silently failed to recover anyone (for whatever
        # reason: a mid-batch exception after this point, a tenant_scope
        # mismatch, etc.) looked identical in the logs to a run with no
        # stranded leads at all. This makes every cycle's stranded-recovery
        # outcome visible in `docker logs` without needing a manual DB query
        # to even know there's something to investigate.
        _progress_log.warning(
            "[message_generation] recovering %d stranded lead(s): %s",
            len(stranded), ", ".join(l.get("business_name") or l["id"] for l in stranded),
        )
    for lead in stranded:
        repo.update_lead(lead["id"], {"status": "analyzed"})
        lead["status"] = "analyzed"
    leads = leads + stranded

    if limit is not None:
        leads = leads[:limit]

    active_style = message_style.get_active_style()
    # Read once per tenant per cycle (settings don't change mid-cycle), same
    # reasoning as active_style above -- OutreachSettings.approvalRequired,
    # dashboard-editable (Settings > Contact rules > "Require approval before
    # sending"). Defaults to True (the safe default) if settings can't be
    # read at all, same fallback posture the rest of this module already
    # uses for approval_reminder_hours.
    settings = repo.get_settings() or {}
    approval_required = settings.get("approval_required")
    if approval_required is None:
        approval_required = True
    results = []

    for lead in leads:
        # OWNER DECISION 2026-10-02: LinkedIn sending is permanently disabled
        # (real automation-fingerprint risk, not just a timing bug -- see
        # linkedin_send.py's own history) and now excluded from message
        # GENERATION entirely, not just skipped at send time. Before this,
        # every LinkedIn-discovered lead still got a real channel="linkedin"
        # message drafted and (if it had an email) a second channel="email"
        # one alongside it -- the LinkedIn one could never send, just piled
        # up in the approval queue forever (82 such messages found stuck
        # this way, going back to September). LinkedIn stays fully active
        # for DISCOVERY and email-lookup -- this only changes what channel
        # a LinkedIn-discovered lead's message gets generated on.
        channels = [] if lead.get("platform") == "linkedin" else [lead.get("platform")]
        if lead.get("whatsapp_found"):
            channels.append("whatsapp")
        # ADDED 2026-09-19, same additional-channel pattern as whatsapp_found
        # above: a LinkedIn/Instagram lead whose bio had a plain-text email
        # (see _email_from_bio() at discovery time) now also gets a real
        # email message drafted on the SAME lead row, in addition to its
        # primary-platform message -- not a replacement, same reasoning as
        # WhatsApp: an extra channel is strictly additive, never instead of.
        if lead.get("platform") != "email" and lead.get("contact_email") and "email" not in channels:
            channels.append("email")

        try:
            primary_body = None
            for channel in channels:
                body = message_generate.generate_message(lead, channel, active_style)
                if channel == lead.get("platform"):
                    primary_body = body
                message = repo.insert_message({
                    "lead_id": lead["id"],
                    "channel": channel,
                    "body": body,
                })
                if not approval_required:
                    # Tenant has explicitly turned off the human approval
                    # gate (Settings) -- mark this message approved so it's
                    # eligible for sending, same approval_status a human's
                    # Approve click sets. approved_by is left null (NOT set
                    # to a placeholder string) since OutreachMessage.approvedById
                    # is a real foreign key to User.id -- writing anything
                    # other than a real user id there would violate the FK
                    # constraint outright. The "this was auto-approved, not
                    # a person" fact is what the pipeline-history row below
                    # (changed_by="auto-approved", a plain string field, not
                    # an FK) actually records for the audit trail; a null
                    # approved_by combined with that history entry is enough
                    # to distinguish this from a human approval later if
                    # ever needed. NOT calling approve_message() itself here
                    # -- its _maybe_advance_lead() only fires when the lead
                    # is ALREADY "awaiting_approval", which it isn't yet at
                    # this point in the loop (still "analyzed"), so that
                    # call would silently no-op; the lead's own status
                    # transition is handled explicitly below instead, once,
                    # after every channel's message is in.
                    repo.update_message(message["id"], {
                        "approval_status": "approved",
                        "approved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    })

            # REAL BUG FOUND AND FIXED 2026-10-04, live-confirmed: a LinkedIn
            # lead with no bio-found email and no LinkedIn channel (disabled
            # above) has an EMPTY channels list -- the for-loop above never
            # runs, zero messages are ever created -- yet the code below
            # unconditionally advanced it to "awaiting_approval" regardless.
            # Result: 11 real LinkedIn leads tonight (Bank Audi, CSP
            # Healthcare, Clemenceau Medical Center, etc.) sat in
            # "awaiting_approval" with literally nothing to approve -- same
            # failure shape as the 82-stuck-message incident referenced
            # above, just the LEAD'S status instead of a dead message. Its
            # own linked email lead (created by _maybe_find_email, a
            # SEPARATE OutreachLead row) already carries the real outreach
            # for this company when one exists -- this LinkedIn row itself
            # genuinely has nothing left to do once channels is empty, so it
            # gets its own terminal status instead of the misleading
            # approval-pending one.
            if not channels:
                repo.update_lead(lead["id"], {"status": "no_message_needed"})
                results.append({
                    "lead": lead.get("business_name"), "ok": True,
                    "channels": [], "style": active_style,
                    "note": "no channels to message on -- covered by linked email lead if one exists",
                })
                continue

            new_lead_status = "approved" if not approval_required else "awaiting_approval"
            repo.update_lead(lead["id"], {
                "generated_message": primary_body,
                "message_style_used": active_style,
                "status": new_lead_status,
            })
            if not approval_required:
                repo.record_stage_change(lead["id"], "analyzed", "approved", changed_by="auto-approved")
            results.append({
                "lead": lead.get("business_name"), "ok": True,
                "channels": channels, "style": active_style,
            })
        except Exception as exc:  # noqa: BLE001 -- one bad lead shouldn't stop the batch
            results.append({"lead": lead.get("business_name"), "ok": False, "error": str(exc)})
            log_error("message_generation", exc, lead_id=lead.get("id"), account_id=lead.get("account_id"))

    return results


def run_sending_cycle(limit: int | None = None) -> list[dict]:
    """
    Route every approved, not-yet-sent message to its channel (Phase 7).

    Instagram auto-sends through instagram_send.send_cold_message() -- NOT
    YET LIVE-VERIFIED (see that module's docstring). This replaced the
    original instagram_queue.queue_for_manual_send() manual-only design; the
    platform owner explicitly accepted the higher cold-DM-automation ban
    risk in exchange for the account never being touched from a location
    other than the agent's own consistent proxy. instagram_queue.py is kept
    for its mark_sent() bookkeeping shape reference only and is no longer
    called from this cycle.

    WhatsApp auto-sends through whatsapp_send.send_message() (Twilio's REST
    API) -- if agent/.env's WHATSAPP_* fields are still empty, that call
    raises WhatsAppNotConfigured, which the try/except below turns into a
    normal "ok": False result rather than crashing the cycle.

    LinkedIn auto-sends through linkedin_send.send_message() -- verified
    live 2026-08-03 against real company pages (see that module's
    docstring). Not every lead's page has LinkedIn's Page-messaging feature
    enabled, though; that raises NoMessageButtonAvailable, which the
    try/except below turns into the same normal "ok": False result as a
    missing WhatsApp number does for that channel, rather than crashing the
    cycle.

    `limit` caps how many messages are processed PER TENANT in one call,
    same reasoning as the analysis/message-generation cycles' `limit`.

    Ported multi-tenant 2026-08-20: loops over every tenant with active
    Outreach accounts, same one-more-level tenant isolation as the other
    cycle functions above.
    """
    results = []
    for tenant_id in repo.list_active_tenant_ids():
        with repo.tenant_scope(tenant_id):
            if repo.is_tenant_paused():
                continue
            run = repo.start_stage_run(tenant_id, "sending")
            try:
                tenant_results = _run_sending_cycle_for_tenant(limit, tenant_id=tenant_id)
                results.extend(tenant_results)
                sent_count = sum(1 for r in tenant_results if r.get("ok"))
                repo.finish_run(
                    tenant_id, run["id"], leads_found=0, messages_sent=sent_count,
                    status="completed", finished_at_iso=dt.datetime.now(dt.timezone.utc).isoformat(),
                    notes=f"{sent_count}/{len(tenant_results)} messages sent." if tenant_results else "No approved messages pending.",
                )
            except Exception as exc:  # noqa: BLE001 -- one bad tenant must not stop the others
                repo.finish_run(
                    tenant_id, run["id"], leads_found=0, messages_sent=0,
                    status="error", finished_at_iso=dt.datetime.now(dt.timezone.utc).isoformat(),
                    notes=str(exc),
                )
                try:
                    repo.insert_error({
                        "stage": "sending", "error_message": str(exc), "is_expected": False,
                    }, tenant_id=tenant_id)
                except Exception:  # noqa: BLE001 -- logging itself must never crash the pipeline
                    pass
    return results


def _run_sending_cycle_for_tenant(limit: int | None, account_id: str | None = None, tenant_id: str | None = None) -> list[dict]:
    # Reply-tagged messages (is_reply=True, from "Reply Here") are
    # deliberately excluded here -- run_reply_send_cycle() below picks them
    # up on its own fast ~2-3 min poll instead of waiting for this cycle's
    # normal once-daily cadence, so a reply feels close to real-time. This
    # cycle only ever sees fresh cold-outreach messages.
    messages = [m for m in repo.messages_approved_pending() if not m.get("is_reply")]

    # LIVE-REASONED 2026-09-08: account_id narrows this to ONE account's own
    # messages, so build_daily_schedule() can run each account's cold sends
    # at that account's own configured run_time instead of every tenant's
    # entire message queue firing at one shared clock time (see this
    # function's call sites for the real incident this fixes -- every
    # client's LinkedIn/Instagram sends going out at the exact same minute,
    # every day, forever, which is a stronger automation fingerprint than
    # any single account's own send pattern). messages_approved_pending()
    # doesn't expose account_id directly (it joins leads only for the
    # do_not_contact check, see that function's own docstring), so this
    # resolves it per-message via the lead -- one extra repo.get_lead() per
    # candidate message, on an already-small per-account queue (today's
    # daily limits are 5-15), not a real cost.
    if account_id is not None:
        messages = [m for m in messages if (repo.get_lead(m["lead_id"]) or {}).get("account_id") == account_id]

    # REAL BUG FOUND AND FIXED 2026-09-15: this function had NO daily-limit
    # check at all -- every approved+pending message got sent, however many
    # there were. LIVE-CONFIRMED: one account sent 8 real LinkedIn messages
    # in a single day against its own configured linkedin_daily_limit of 5.
    # warmup.effective_limit() already exists and is used correctly on the
    # DISCOVERY side (caps how many new leads get found per day) but was
    # never applied here on the SENDING side -- the two are separate caps
    # on separate activities and both need enforcing independently. Counts
    # today's real sends per account (cold_sends_today_for_account(),
    # excluding replies -- same reasoning as the is_reply filter just
    # above) and trims the batch to whatever's left of that account's daily
    # allowance. Only meaningful when account_id is known (the daily limit
    # is a property of ONE account, not a whole tenant) -- the
    # tenant-wide call site (run_sending_cycle(), account_id=None) is a
    # legacy/manual path superseded by the per-account scheduling
    # (build_daily_schedule() -- see run_account_sending_cycle's own
    # docstring on why sending moved to per-account jobs), left as-is here.
    if account_id is not None and tenant_id is not None:
        account = repo.get_account(account_id, tenant_id)

        # Second half of the 2026-09-16 paused-account fix (the primary guard
        # is in run_account_sending_cycle() above, which is what the real
        # scheduled jobs call). Repeated here because this function is also
        # reachable from manual/legacy call sites, and the account row is
        # already in hand -- a DB pause must be authoritative on every path
        # into sending, not just the scheduled one. Missing account is
        # treated as not-sendable for the same reason.
        if not account or account.get("status") != "active":
            return []

        if account:
            platform = account.get("platform")
            # sendDailyLimitOverride (2026-09-15): lets Hussein raise just the
            # SENDING cap for an account -- to clear an approved backlog
            # faster -- without also raising warmup.effective_limit(), which
            # would silently speed up DISCOVERY too (a different, separately
            # risky activity that shares nothing with this override). NULL
            # for every account except the handful Hussein explicitly set
            # this on, so this is a no-op everywhere else.
            override = account.get("send_daily_limit_override")
            daily_limit = override if override is not None else warmup.effective_limit(account, platform)
            day_start = pool.today_start_iso(tenant_id)

            # ADDED 2026-10-04, owner's explicit request: follow-ups get
            # their own separate daily cap on Instagram (5/day), on TOP of
            # (not sharing) the existing first-contact cap above -- a
            # follow-up backlog must never compete with fresh leads for the
            # same 10 slots, and a day that already sent 10 first-contact
            # messages should still send up to 5 follow-ups. Scoped to
            # Instagram only: LinkedIn sending is permanently disabled, and
            # email follow-ups go out immediately on approval via the
            # Next.js/Resend pipeline, never through this cap at all.
            if platform == "instagram":
                first_contact = [m for m in messages if not m.get("is_followup")]
                followups = [m for m in messages if m.get("is_followup")]

                already_sent_first = repo.cold_sends_today_for_account_by_followup(
                    account_id, day_start, is_followup=False, tenant_id=tenant_id
                )
                remaining_first = max(0, daily_limit - already_sent_first)

                already_sent_followup = repo.cold_sends_today_for_account_by_followup(
                    account_id, day_start, is_followup=True, tenant_id=tenant_id
                )
                remaining_followup = max(0, _INSTAGRAM_FOLLOWUP_DAILY_LIMIT - already_sent_followup)

                messages = first_contact[:remaining_first] + followups[:remaining_followup]
            else:
                already_sent = repo.cold_sends_today_for_account(account_id, day_start, tenant_id=tenant_id)
                remaining = max(0, daily_limit - already_sent)
                messages = messages[:remaining]

    if limit is not None:
        messages = messages[:limit]

    # ADDED 2026-10-07, owner's explicit request: the fixed 6-13min gap was
    # sized for a 10/day cap (see _SEND_GAP_MIN/MAX_SECONDS's own comment:
    # "10 messages fit within ~2 hours even in the worst case") -- it was
    # never re-checked after the cap rose to 15, and a late scheduled start
    # (see the 2026-10-07 index==0 fix in build_daily_schedule) made the
    # real available time even shorter. Real incident this fixes: Oct 7,
    # Zimmar Instagram started at 9:46 (should have been ~8:00) and only
    # got 11 of 15 approved messages out before running out of real
    # wall-clock time in the 08:00-12:00 window, even though the 15/day cap
    # itself was never the limiting factor. If the fixed 13-min MAX gap
    # genuinely would not fit every message before the window closes, the
    # gap shrinks (toward, but never below, a safe floor) so the whole
    # approved batch actually finishes inside its window -- only ever
    # shrinks the gap, never grows it past the normal 6-13min range.
    # Beirut (config.TIMEZONE), not the server's own local/system timezone
    # -- the sending window itself is defined in Beirut time
    # (_SENDING_WINDOW_START_HOUR/_SENDING_WINDOW_END_HOUR are both "Beirut"
    # per their own names), so the remaining-time calculation has to use
    # the same clock or it would compute a nonsense deadline on a server
    # running in UTC or any other timezone.
    _tz_now = dt.datetime.now(ZoneInfo(config.TIMEZONE))
    window_end_today = _tz_now.replace(hour=_SENDING_WINDOW_END_HOUR, minute=0, second=0, microsecond=0)
    seconds_left_in_window = max(0, (window_end_today - _tz_now).total_seconds())
    non_linkedin_count = sum(1 for m in messages if m.get("channel") != "linkedin")
    gaps_needed = max(0, non_linkedin_count - 1)
    if gaps_needed > 0:
        max_gap_that_fits = seconds_left_in_window / gaps_needed
        effective_gap_max = max(_SEND_GAP_MIN_SECONDS, min(_SEND_GAP_MAX_SECONDS, max_gap_that_fits))
    else:
        effective_gap_max = _SEND_GAP_MAX_SECONDS

    results = []
    for index, message in enumerate(messages):
        # Space COLD sends out instead of firing an account's whole daily
        # allowance in one burst -- see _sleep_between_sends(). Applied here
        # and deliberately NOT in run_reply_send_cycle(): a reply to someone
        # who just messaged you is expected to arrive promptly, and delaying
        # it by up to 25 minutes would make the product feel broken while
        # protecting nothing (replying inside an existing conversation isn't
        # the pattern platforms flag -- unsolicited first contact is).
        #
        # Placed BEFORE each send except the first, so the cycle starts work
        # immediately at its scheduled run_time and no gap is wasted after
        # the final message.
        #
        # REAL BUG FOUND AND FIXED 2026-09-25: this pacing gap exists to
        # avoid a detectable instant-burst pattern on the PLATFORM being
        # sent to -- it protects nothing when the "send" is actually a
        # no-op skip (see the LinkedIn branch below, disabled 2026-09-25).
        # Before this fix, a batch of N pending LinkedIn messages still
        # slept the full 6-13min gap N-1 times even though every single
        # one just appends a "disabled" result and never touches a
        # browser -- live-confirmed hanging a manual test for 4+ minutes
        # with zero real work happening. Channel is read once, before the
        # sleep decision, instead of after it.
        channel = message.get("channel")
        if index > 0 and channel != "linkedin":
            _sleep_between_sends(gap_max_seconds=effective_gap_max)
        try:
            if channel == "instagram":
                # DELIBERATE PRODUCT DECISION: Instagram cold sends used to
                # queue for manual send (instagram_queue.queue_for_manual_send)
                # specifically because automating unsolicited first-contact
                # DMs is Instagram's highest-risk automation pattern -- see
                # instagram_send.py's module docstring for why that tradeoff
                # was explicitly accepted anyway (keeping every send on the
                # agent's own consistent proxy/location, never the account
                # owner's real device).
                instagram_send.send_cold_message(message)
                results.append({
                    "message_id": message["id"], "channel": channel,
                    "ok": True, "action": "sent",
                })
            elif channel == "whatsapp":
                whatsapp_send.send_message(message)
                results.append({
                    "message_id": message["id"], "channel": channel,
                    "ok": True, "action": "sent",
                })
            elif channel == "linkedin":
                # ADDED 2026-09-25, owner's explicit decision: LinkedIn
                # DISCOVERY (finding companies, looking up their real
                # emails via _maybe_find_email) stays ACTIVE -- discovery
                # is unaffected by the Page-messaging block and is a real,
                # working source of email leads. Only the LinkedIn SEND
                # itself is disabled here, so the account's own `status`
                # can stay 'active' (needed for discovery to keep running
                # -- see account_pool.get_due_accounts()'s status=='active'
                # gate) while still never attempting a real LinkedIn
                # message. Left pending (not marked failed) so a future
                # re-enable can pick these messages straight back up.
                results.append({
                    "message_id": message["id"], "channel": channel,
                    "ok": False,
                    "reason": "LinkedIn sending is disabled (owner decision, 2026-09-25) -- message left pending.",
                })
                continue
            else:
                # Unreachable in practice, not a missing feature: repo.messages_approved_pending()
                # only ever queries channel IN ('linkedin', 'instagram', 'whatsapp') -- email is
                # deliberately excluded there since the Next.js app's own SES path (src/lib/
                # outreach/ses.ts) owns sending it entirely, this agent never touches email
                # messages at all. Kept as a defensive branch (a future channel value slipping
                # through here should be a visible "ok": False, not a silent KeyError) rather
                # than an assert, since one malformed message shouldn't crash the whole cycle.
                results.append({
                    "message_id": message["id"], "channel": channel, "ok": False,
                    "reason": f"unrecognized channel {channel!r} -- expected linkedin/instagram/whatsapp",
                })
        except PageMessagingRateLimited as exc:
            # LIVE-CONFIRMED 2026-09-20/21: once LinkedIn's own "reached the
            # limit for starting new conversations with Pages" banner shows
            # up, it stays up for the rest of this account's session -- every
            # remaining Page lead in this batch would hit the identical wall
            # (confirmed: many distinct leads, same run, same banner, both
            # days). Continuing to retry burns the full per-lead timeout on
            # each one AND repeatedly hammers a platform rate limit, which
            # risks looking like exactly the automated-abuse pattern
            # LinkedIn's detection watches for. Mark this one message failed
            # for visibility, then stop trying further LinkedIn Page leads
            # on this account for the rest of THIS run -- tomorrow's run
            # starts fresh and may no longer be capped.
            results.append({"message_id": message["id"], "channel": channel, "ok": False, "error": str(exc)})
            log_error("sending", exc, channel=channel, lead_id=message.get("lead_id"))
            break
        except Exception as exc:  # noqa: BLE001 -- one bad message shouldn't stop the rest
            results.append({"message_id": message["id"], "channel": channel, "ok": False, "error": str(exc)})
            log_error("sending", exc, channel=channel, lead_id=message.get("lead_id"))

    return results


def run_reply_send_cycle() -> list[dict]:
    """
    Delivers tenant-written replies (is_reply=True, from the "Reply Here"
    dashboard page -- src/lib/actions/outreach-replies.ts's
    sendReplyAction()) into each lead's EXISTING conversation thread, on a
    fast poll separate from run_sending_cycle()'s once-daily cadence (see
    build_daily_schedule()'s IntervalTrigger job for this function) so a
    reply feels close to real-time instead of waiting for the next full
    cycle.

    Deliberately calls each channel's send_reply() (thread-reply delivery),
    NOT send_message()/send_cold_message() (fresh connection request / new
    thread) -- a reply must land in the conversation the lead already
    started, not open a new one. Same per-tenant, per-message error
    isolation as _run_sending_cycle_for_tenant() above; email is excluded
    the same way (repo.replies_pending() only ever queries channel IN
    ('linkedin', 'instagram', 'whatsapp'), matching
    messages_approved_pending()'s own scoping).
    """
    results = []
    for tenant_id in repo.list_active_tenant_ids():
        try:
            with repo.tenant_scope(tenant_id):
                results.extend(_run_reply_send_cycle_for_tenant())
        except Exception as exc:  # noqa: BLE001 -- one bad tenant must not stop the others
            try:
                repo.insert_error({
                    "stage": "reply_sending", "error_message": str(exc), "is_expected": False,
                }, tenant_id=tenant_id)
            except Exception:  # noqa: BLE001 -- logging itself must never crash the pipeline
                pass
    return results


def run_reply_detection_poll() -> dict:
    """
    Real gap fixed 2026-09-07: check_linkedin_replies()/check_instagram_
    replies()/check_whatsapp_replies() only ever ran once daily, inside
    run_full_pipeline_cycle() -- live-confirmed the same night, a reply
    genuinely sent on Instagram sat completely undetected for hours with
    nothing to notice it, since nothing re-checked until the next scheduled
    downstream-pipeline run. This is the fast-poll counterpart, same
    reasoning and shape as run_reply_send_cycle() above (which already
    solved the identical problem for DELIVERING a tenant-written reply,
    not detecting an incoming one) -- see build_daily_schedule()'s
    IntervalTrigger job for this function's real cadence.

    Deliberately its own function, not folded into run_reply_send_cycle():
    that function's per-tenant loop already calls repo.replies_pending()
    (SENDING direction) -- mixing SENDING and DETECTING into one loop body
    would make one slow/failing channel's detection block another
    channel's send on the same tick, for no real benefit since they don't
    share any state.
    """
    results: dict[str, dict] = {}
    for tenant_id in repo.list_active_tenant_ids():
        with repo.tenant_scope(tenant_id):
            tenant_result: dict = {}
            try:
                tenant_result["whatsapp"] = whatsapp_reply_check.check_whatsapp_replies()
            except Exception as exc:  # noqa: BLE001 -- e.g. WhatsAppNotConfigured; don't lose the other channels
                tenant_result["whatsapp"] = {"ok": False, "error": str(exc)}
                log_error("reply_check", exc, channel="whatsapp")
            try:
                tenant_result["linkedin"] = linkedin_reply_check.check_linkedin_replies()
            except Exception as exc:  # noqa: BLE001 -- e.g. unverified selector mismatch; don't lose the other channels
                tenant_result["linkedin"] = {"ok": False, "error": str(exc)}
                log_error("reply_check", exc, channel="linkedin")
            try:
                tenant_result["instagram"] = instagram_reply_check.check_instagram_replies()
            except Exception as exc:  # noqa: BLE001 -- e.g. unverified selector mismatch; don't lose the other channels
                tenant_result["instagram"] = {"ok": False, "error": str(exc)}
                log_error("reply_check", exc, channel="instagram")
            results[tenant_id] = tenant_result
    return results


def _run_reply_send_cycle_for_tenant() -> list[dict]:
    messages = repo.replies_pending()

    results = []
    for message in messages:
        channel = message.get("channel")
        try:
            if channel == "instagram":
                instagram_send.send_reply(message)
            elif channel == "whatsapp":
                whatsapp_send.send_message(message)
            elif channel == "linkedin":
                linkedin_send.send_reply(message)
            else:
                results.append({
                    "message_id": message["id"], "channel": channel, "ok": False,
                    "reason": f"unrecognized channel {channel!r} -- expected linkedin/instagram/whatsapp",
                })
                continue
            results.append({"message_id": message["id"], "channel": channel, "ok": True, "action": "sent"})
        except Exception as exc:  # noqa: BLE001 -- one bad reply shouldn't stop the rest
            results.append({"message_id": message["id"], "channel": channel, "ok": False, "error": str(exc)})
            log_error("reply_sending", exc, channel=channel, lead_id=message.get("lead_id"))

    return results


_LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/"
_INSTAGRAM_HOME_URL = "https://www.instagram.com/"


def run_account_health_check_cycle() -> list[dict]:
    """
    Real gap fixed 2026-09-06: linkedin_send.py's/instagram_send.py's own
    _raise_if_logged_out() only ever runs AT THE MOMENT of a real send --
    live-confirmed the same night, an account can sit genuinely logged out
    (dashboard still showing "Connected") for hours with nothing to notice,
    simply because nothing happened to try sending through it in that
    window. This is the periodic counterpart: visits each active,
    currently-"connected" LinkedIn/Instagram account's own feed/home page
    (no send, no lead involved) on a schedule (see
    build_daily_schedule()'s IntervalTrigger job for this function) purely
    to catch a session going bad BETWEEN sends, not just during one.

    Deliberately reuses linkedin_send._raise_if_logged_out() /
    instagram_send._raise_if_logged_out() rather than a third copy of the
    same detection logic -- same reasoning that made those into shared
    per-module helpers in the first place. Only visits accounts already
    "connected" (not_connected/failed/connecting accounts have nothing
    useful to re-check here), and only linkedin/instagram (email has no
    concept of a browser session to go stale; whatsapp's health is a
    separate, already-existing concern).
    """
    results = []
    for tenant_id in repo.list_active_tenant_ids():
        try:
            with repo.tenant_scope(tenant_id):
                for account in pool.load_accounts(tenant_id):
                    if account.get("platform") not in ("linkedin", "instagram"):
                        continue
                    if account.get("login_status") != "connected":
                        continue
                    try:
                        with SessionManager() as sessions:
                            context, page, new_verified_ip = sessions.open(account)
                            if new_verified_ip and not account.get("verified_proxy_ip"):
                                repo.update_account(account["id"], {"verified_proxy_ip": new_verified_ip})
                            try:
                                if account["platform"] == "linkedin":
                                    page.goto(_LINKEDIN_FEED_URL, timeout=30_000, wait_until="domcontentloaded")
                                    linkedin_send._raise_if_logged_out(page, account)
                                else:
                                    page.goto(_INSTAGRAM_HOME_URL, timeout=30_000, wait_until="domcontentloaded")
                                    instagram_send._raise_if_logged_out(page, account)
                            finally:
                                sessions.close(account["id"], context)
                        results.append({"account_id": account["id"], "platform": account["platform"], "ok": True})
                    except (linkedin_send.SessionLoggedOut, instagram_send.SessionLoggedOut) as exc:
                        # Already persisted login_status: "failed" by
                        # _raise_if_logged_out itself -- nothing more to do
                        # here than record the outcome.
                        results.append({"account_id": account["id"], "platform": account["platform"], "ok": False, "reason": str(exc)})
                    except Exception as exc:  # noqa: BLE001 -- a network hiccup here shouldn't be mistaken for a real logout
                        results.append({"account_id": account["id"], "platform": account["platform"], "ok": False, "error": str(exc)})
                        log_error("account_health_check", exc, account_id=account["id"])
        except Exception as exc:  # noqa: BLE001 -- one bad tenant must not stop the others
            try:
                repo.insert_error({
                    "stage": "account_health_check", "error_message": str(exc), "is_expected": False,
                }, tenant_id=tenant_id)
            except Exception:  # noqa: BLE001 -- logging itself must never crash the pipeline
                pass
    return results


def run_approval_reminder_check() -> dict:
    """
    Phase 8's approval reminder trigger, across every tenant that currently
    has active Outreach accounts (ported multi-tenant 2026-08-20): if any
    tenant has a message that's sat "awaiting" longer than that tenant's
    settings.approval_reminder_hours, notify once with the count. Returns a
    dict keyed by tenant_id -> the logged notification (or None if nothing
    was overdue for that tenant).

    Tenant-level isolation: one tenant raising here is logged and skipped,
    same reasoning as run_cycle() above.
    """
    results: dict[str, dict | None] = {}
    for tenant_id in repo.list_active_tenant_ids():
        try:
            with repo.tenant_scope(tenant_id):
                pending = approval.messages_needing_reminder()
                results[tenant_id] = (
                    whatsapp_notify.notify_approval_reminder(len(pending)) if pending else None
                )
        except Exception as exc:  # noqa: BLE001 -- one bad tenant must not stop the others
            try:
                repo.insert_error({
                    "stage": "approval_reminder", "error_message": str(exc), "is_expected": False,
                }, tenant_id=tenant_id)
            except Exception:  # noqa: BLE001 -- logging itself must never crash the pipeline
                pass
            results[tenant_id] = None
    return results


def run_account_sending_cycle(tenant_id: str, account_id: str, limit: int | None = None) -> list[dict]:
    """
    Cold-outreach sending for ONE account, scoped to messages whose lead
    belongs to it -- the per-account counterpart to run_sending_cycle()
    below, meant to be scheduled at THIS account's own run_time rather than
    one shared clock time for every tenant.

    Real incident this fixes, live-reasoned 2026-09-08: build_daily_schedule
    originally called run_sending_cycle() (no account scoping) from ONE
    fixed daily job (_DOWNSTREAM_HOUR/_DOWNSTREAM_MINUTE, 20:00 for every
    tenant) -- so every client's entire day of LinkedIn/Instagram cold
    sends went out at the exact same clock minute, every single day,
    indefinitely. That's a stronger, more mechanical automation fingerprint
    than any single account's own send pattern: the whole point of staggering
    each account's run_time earlier in this session (see AccountHealthClient
    settings) was undone downstream by sending still happening on one shared
    schedule. This function is what build_daily_schedule() now schedules
    once per account instead, right after that account's own discovery run,
    so a given account's cold sends happen in its own morning window and
    never at the same minute another tenant's account sends.

    Still respects the tenant-level pause: a paused tenant's per-account
    sending jobs are no-ops, same as run_sending_cycle()'s own check -- and,
    since 2026-09-16, the per-ACCOUNT status too (see the guard below).
    """
    with repo.tenant_scope(tenant_id):
        if repo.is_tenant_paused():
            return []

        # REAL INCIDENT 2026-09-16: LinkedIn served a security checkpoint on
        # Zimmar's account ("unusual activity / high volume of profile data
        # access") and both that account and its Instagram account were set
        # to status='paused' in the DB. That pause was NOT authoritative for
        # sending: account status was only ever consulted at schedule-BUILD
        # time (build_daily_schedule() below, where the status == "active"
        # filter lives), so jobs registered at the previous boot -- Zimmar's
        # 08:41 and 10:05 Beirut sends -- were still holding a live closure
        # and would have kept sending on a checkpointed account until the
        # next redeploy rebuilt the schedule. Pausing an account has to take
        # effect on the very next run, not at the next process restart.
        #
        # So the status is re-read here, at RUN time, before any browser work
        # or stage_run row -- mirroring how the discovery side has always
        # done it (pool.get_due_accounts(), which skips any account whose
        # status != "active"; core rule R9: a paused account never runs
        # itself back in, resuming is Hussein's manual call).
        #
        # "warned" is blocked alongside "paused" to match the Next.js/email
        # side, which gates on `status === "paused" || status === "warned"`
        # (sendIfEmailChannel in src/lib/actions/outreach-approvals.ts) -- an
        # account auto-warned for e.g. bounce rate must not keep sending on
        # LinkedIn/Instagram just because the block was written for email.
        account = repo.get_account(account_id, tenant_id)
        if not account or account.get("status") != "active":
            return []

        run = repo.start_stage_run(tenant_id, "sending")
        try:
            results = _run_sending_cycle_for_tenant(limit, account_id=account_id, tenant_id=tenant_id)
            sent_count = sum(1 for r in results if r.get("ok"))
            repo.finish_run(
                tenant_id, run["id"], leads_found=0, messages_sent=sent_count,
                status="completed", finished_at_iso=dt.datetime.now(dt.timezone.utc).isoformat(),
                notes=f"{sent_count}/{len(results)} messages sent." if results else "No approved messages pending.",
            )
            return results
        except Exception as exc:  # noqa: BLE001 -- one bad account must not stop this tenant's other accounts
            repo.finish_run(
                tenant_id, run["id"], leads_found=0, messages_sent=0,
                status="error", finished_at_iso=dt.datetime.now(dt.timezone.utc).isoformat(),
                notes=str(exc),
            )
            try:
                repo.insert_error({
                    "stage": "sending", "error_message": str(exc), "is_expected": False, "account_id": account_id,
                }, tenant_id=tenant_id)
            except Exception:  # noqa: BLE001 -- logging itself must never crash the pipeline
                pass
            return []


def run_full_pipeline_cycle() -> dict:
    """
    Runs the shared (not per-account) downstream steps once daily, in spec
    order: analysis -> message generation -> approval-reminder check -> due
    follow-up dispatch. This is what build_daily_schedule() schedules once
    daily (see its docstring for why this isn't per-account, unlike
    discovery and, as of 2026-09-08, sending).

    Cold-outreach SENDING moved OUT of this cycle 2026-09-08 onto
    run_account_sending_cycle(), scheduled per-account at that account's
    own run_time -- see that function's docstring for the real incident
    this fixes (every tenant's sends firing at one shared clock time).
    Analysis and message-generation stay here: neither ever touches
    LinkedIn/Instagram/Instagram directly (they read/score leads and call
    Claude to draft text), so they carry none of the automation-fingerprint
    risk that motivated splitting sending out -- there's no safety reason to
    scatter them across every account's own schedule too, only added
    complexity.

    Reply checking (WhatsApp/LinkedIn/Instagram) moved OUT of this cycle
    2026-09-07 onto its own fast poll -- run_reply_detection_poll(), see
    that function's own docstring for the real gap this fixes (a reply
    sitting undetected for up to 24h waiting on this once-daily cycle).
    Follow-up dispatch staying here, on the daily cadence, is still safe
    despite that split: the fast reply-detection poll runs far more often
    than this daily dispatch, so by the time dispatch_due_followups() runs,
    any reply from today has already had many chances to be detected and
    cancel its own follow-up (reply_detection.handle_reply_detected ->
    followup.cancel_pending) well before this step would otherwise
    generate one for someone who already responded.

    Ported multi-tenant 2026-08-20: run_analysis_cycle/run_message_generation
    _cycle/run_approval_reminder_check each already loop over every active
    tenant internally (see their own docstrings) -- called plainly here,
    same as before the port. The follow-up dispatch step below does NOT loop
    internally (crm/followup.py is out of scope for this port -- it only
    calls repo.*, never the DB directly), so this function wraps it in its
    own per-tenant tenant_scope(...) loop instead.
    """
    # config.MAX_LEADS_PER_CYCLE caps per-tenant Claude-call volume per run --
    # see its own comment in config.py for why this must not be left
    # uncapped (a real production safety valve, not a dev-only brake).
    analysis = run_analysis_cycle(limit=config.MAX_LEADS_PER_CYCLE)
    messages = run_message_generation_cycle(limit=config.MAX_LEADS_PER_CYCLE)
    reminder = run_approval_reminder_check()

    followups_dispatched: dict[str, list] = {}

    for tenant_id in repo.list_active_tenant_ids():
        with repo.tenant_scope(tenant_id):
            try:
                followups_dispatched[tenant_id] = followup.dispatch_due_followups()
            except Exception as exc:  # noqa: BLE001 -- don't lose the steps above over one bad batch
                followups_dispatched[tenant_id] = {"ok": False, "error": str(exc)}
                log_error("followup", exc)

    return {
        "analysis": analysis,
        "messages": messages,
        "approval_reminder": reminder,
        "followups_dispatched": followups_dispatched,
    }


# Fixed daily time for run_full_pipeline_cycle (analysis -> message
# generation -> reminders -> follow-up dispatch).
#
# Moved to 00:30 on 2026-09-16, when discovery moved to the 20:00-24:00
# night window: this cycle GENERATES the messages for leads discovery just
# found, so it has to run after that window closes, not before it opens.
# At the old 20:00 it would have raced the very discovery run it depends
# on, and every newly-found lead's message would have waited a full extra
# day before it even existed to be approved.
#
# 00:30 also puts generated messages in the approval queue overnight, so
# they are reviewable before the 08:00-12:00 sending window the same
# morning -- the shortest honest path from "lead discovered" to "message
# sent" that still keeps a human approval step in the middle.
_DOWNSTREAM_HOUR = 0
_DOWNSTREAM_MINUTE = 30

# SECOND daily run, added 2026-09-19: 00:30 alone left leads stranded up to
# 24h in two real cases -- (1) a discovery job that runs late in the
# 20:00-24:00 window (or overruns past midnight) finds leads AFTER 00:30 has
# already passed for the night, so they sit un-drafted until the NEXT
# night's 00:30; (2) a lead that slips past "analyzed" into "approved"/
# "awaiting_approval" with no message ever created (see
# stranded_approved_leads_missing_message()'s docstring for the real
# Insurance leads found stuck this way) previously had no recovery until
# the next 00:30 either. This second pass at 07:00 -- an hour before the
# 08:00 sending window opens -- gives both cases a second chance same
# morning instead of waiting a full extra day, and reviewers still get an
# hour to approve anything freshly drafted before sending starts.
_DOWNSTREAM_SECOND_HOUR = 7
_DOWNSTREAM_SECOND_MINUTE = 0

# How often run_reply_send_cycle() polls for tenant-written replies waiting
# to go out -- see build_daily_schedule()'s IntervalTrigger job.
#
# RAISED 3 -> 30 on 2026-09-17: at 3 minutes, this and the detection poll
# below together opened a fresh browser session ~20 times an hour, every
# hour, on a 1 vCPU / 1.9GB droplet where a single Chromium instance alone
# uses ~40-45% of available RAM. LIVE-CONFIRMED that morning: Zimmar
# LinkedIn's scheduled sending job failed 3/3 attempts on page-load and
# element-wait timeouts, each one landing within seconds of a reply-poll
# cycle also having a browser open -- real resource contention, not a
# broken selector (the same code had sent successfully the day before).
# 30 minutes cuts these poll-driven browser opens by ~90% for a real cost
# the owner explicitly accepted: a tenant-written reply can now take up to
# ~30 min to actually go out instead of ~3, which is still fine for this
# product's cadence.
_REPLY_POLL_INTERVAL_MINUTES = 30

# How often run_reply_detection_poll() re-checks every "contacted"/"replied"
# lead's real inbox for a new incoming reply -- same reasoning as
# _REPLY_POLL_INTERVAL_MINUTES above. Raised again 2026-09-21 (owner's own
# explicit request) from 30 to 60 minutes: this poll was STILL observed
# competing for the single browser slot with real sending jobs that same
# morning (Insurance LinkedIn's 10:04 run hit three separate "All 1 browser
# session slots are still in use after 300s" waits). A real incoming reply
# can now take up to ~60 min to show up in the dashboard instead of ~30 --
# accepted tradeoff, same direction as the original 3->30 change, for
# further reducing contention with sending.
_REPLY_DETECTION_POLL_INTERVAL_MINUTES = 60

# How often run_account_health_check_cycle() re-visits each connected
# LinkedIn/Instagram account -- hours, not minutes, deliberately: this is
# purely a "is the dashboard's status still true" check with no real work
# behind it, so it doesn't need reply-poll urgency, and a real browser
# visit per connected account per tenant adds up in request volume that's
# worth keeping infrequent for accounts that are, in the overwhelming
# majority of checks, going to come back genuinely fine.
_ACCOUNT_HEALTH_CHECK_INTERVAL_HOURS = 4

# Randomized gap between two consecutive COLD sends in one sending cycle.
#
# Without this, _run_sending_cycle_for_tenant() sent an account's entire
# daily allowance back to back -- 10 cold LinkedIn messages inside a few
# minutes at 08:00, then nothing for 24h. That burst shape is one of the
# clearest automation signals both platforms watch for; a real person
# messaging 10 strangers spreads it across the morning. pacing.human_delay()
# already covers the seconds-scale rhythm WITHIN one send (typing, clicking)
# -- this is the minutes-scale rhythm BETWEEN sends, which nothing covered.
#
# Randomized rather than a fixed gap on purpose: a message every exactly-15
# minutes is its own detectable fingerprint.
#
# TIGHTENED 2026-09-17 (owner's explicit request): the send-limit override
# raised the daily cap to 15/account, but at the original 8-25 min gap (avg
# ~16.5 min), 10 messages average ~2.5 hours end to end -- routinely
# spilling past the owner's intended ~2-hour morning sending window rather
# than reliably finishing inside it. 6-13 min (avg ~9.5 min) puts 10
# messages at ~85 min average, comfortably inside 2 hours even on a
# slower-than-average day, while still varying run to run rather than
# landing on a fixed interval.
# TIGHTENED 2026-10-07, owner's explicit request: 6-13 min (avg ~9.5 min)
# was sized for a 10/day cap. With the cap now 15/day and the window-start
# fix landing sends closer to 8:00, 6-8 min (avg ~7 min) comfortably fits
# 15 messages (14 gaps, ~98 min worst case) well inside the 08:00-12:00
# window with real margin to spare, while still being genuinely randomized
# rather than a fixed interval (itself a bot signal).
_SEND_GAP_MIN_SECONDS = 6 * 60
_SEND_GAP_MAX_SECONDS = 8 * 60

# ADDED 2026-10-04, owner's explicit request: Instagram follow-ups get their
# own separate daily cap, independent of (not sharing) the account's regular
# first-contact daily limit (ig_daily_limit, currently 10) -- see
# _run_sending_cycle_for_tenant's own comment on why they're split instead
# of competing for one shared counter.
_INSTAGRAM_FOLLOWUP_DAILY_LIMIT = 5

# Two non-overlapping daily windows, Beirut time. Sending 08:00-12:00
# (owner's original 2026-09-16 design, unchanged). Discovery widened
# 2026-09-27 (owner's explicit request) from 20:00-24:00 to 20:15-03:00 --
# expressed here in MINUTES past midnight, not whole hours, both because
# 20:15 isn't hour-aligned and because the window now crosses midnight
# (03:00 the next day is minute 1620, past the 1440-per-day mark) --
# _spread_within_window()'s own math already operates in this same linear
# "minutes since midnight" space internally (see that function's own
# 2026-09-27 comment on why hour*60 arithmetic keeps working unmodified
# past 1440, and why only its FINAL returned hour needs `% 24`). Accounts
# are spread evenly across their window rather than all firing at one
# clock time.
#
# Why two separated windows at all: discovery and sending both open a real
# browser session for the SAME account and contend for core/session.py's
# per-account lock. Every previous scheme tied sending to discovery's own
# run_time plus an offset (20 min, then 45), and each time a discovery run
# overran its offset the sending job spent _SESSION_LOCK_TIMEOUT_SECONDS
# (240s) waiting, gave up, and silently sent nothing -- which is exactly
# how a real approved message sat unsent for a full day on 2026-09-16.
# Putting the two activities in windows 8 hours apart removes the
# contention entirely rather than trying to predict how long discovery
# takes on a bad day.
#
# Discovery at night, sending in the morning (not the reverse) is
# deliberate: overnight discovery feeds the 20:00 downstream pipeline
# (analysis -> message generation), so a lead found at night has its
# message generated the same night and is ready for approval before the
# next morning's sending window.
_SENDING_WINDOW_START_HOUR = 8
_SENDING_WINDOW_END_HOUR = 12

# OWNER REQUEST 2026-09-30: discovery windows are now fully SEQUENTIAL per
# tenant rather than interleaved across one shared span -- Zimmar gets the
# first slice of the night entirely to itself, Insurance gets the rest.
# Replaces the older _INSURANCE_DISCOVERY_HOUR anchored-jitter mechanism
# below (kept as dead code history is not needed; the anchored jitter
# existed specifically to dodge Zimmar's discovery times when both tenants
# shared one window -- with tenants now in disjoint windows there is
# nothing left to dodge, so both tenants use the same _spread_within_window
# call, just against their own window).
#
# WIDENED 2026-10-04, owner's explicit request: real multi-day data showed
# a single account's discovery can genuinely take 2-4.5 hours on a real
# night (LinkedIn's qualify-reject cycle is slow; a rejected candidate
# still costs a full page load + pacing delay). With 4 real accounts
# (Zimmar LinkedIn/Instagram, Insurance LinkedIn/Instagram) sharing ONE
# browser slot, the old 20:15-03:00 span (6h45m total) risked the 4th
# account in line never getting a turn at all on a night where the first
# few ran long -- see _PER_ACCOUNT_DISCOVERY_TIME_CAP_SECONDS below, the
# companion fix that actually guarantees every account gets a turn. Widened
# to 18:00-04:00 (10h total), split evenly in half between the two tenants
# (5h each) so each tenant's 2 accounts (2.5h cap apiece) fit its half
# exactly, with no change to the sequential-per-tenant design above.
_ZIMMAR_DISCOVERY_WINDOW_START_MINUTES = 18 * 60 + 15  # 18:15 Beirut
_ZIMMAR_DISCOVERY_WINDOW_END_MINUTES = 23 * 60 + 14  # 23:14 Beirut
_INSURANCE_DISCOVERY_WINDOW_START_MINUTES = 23 * 60 + 14  # 23:14 Beirut
_INSURANCE_DISCOVERY_WINDOW_END_MINUTES = 28 * 60 + 14  # 04:14 Beirut, next calendar day

# ADDED 2026-10-04, owner's explicit request: the real fix for "the 4th
# account never gets a turn" -- a hard wall-clock ceiling on how long ANY
# single account's discovery loop (_discover_linkedin/_discover_instagram)
# may keep searching, independent of _MAX_SEARCH_ATTEMPTS (20 rounds). A
# slow night (lots of qualify-rejects, each still costing a real page load)
# could previously burn all 20 rounds over 4+ real hours; this makes the
# loop stop and move on well before that, even mid-round-budget, so a
# slower-than-usual account never consumes another account's whole slice of
# the night. Deliberately NOT a "nice to reach the target" soft goal --
# once this elapses, the account keeps whatever it already found and quits,
# the same way running out of _MAX_SEARCH_ATTEMPTS already does.
_PER_ACCOUNT_DISCOVERY_TIME_CAP_SECONDS = 2.5 * 60 * 60

# End-of-day sending recovery, added 2026-09-20 -- see
# build_daily_schedule()'s own "SECOND, DAILY safety net" comment for the
# real incident this fixes. 18:00 sits in the middle of the gap between
# the morning sending window closing (12:00) and the night discovery
# window opening (20:00), so it can never collide with either.
_SENDING_RECOVERY_HOUR = 18
_SENDING_RECOVERY_MINUTE = 0


# Minutes-since-midnight ranges that _spread_within_window() must never
# land inside, even by chance. Added 2026-09-17: Insurance's discovery
# anchors (23:00/23:02 +/-10 min) sit INSIDE Zimmar's own 20:00-24:00
# discovery window, and with Zimmar down to just 2 active accounts
# (LinkedIn/Instagram paused that day), its random draws landed at 22:51,
# 23:05, 23:07, and 23:11 across four separate rebuilds -- squarely inside
# Insurance's reserved band. This isn't a rare coincidence: with only 2
# jobs to place evenly across 240 minutes, a wide +/-15 min jitter has a
# real, non-trivial chance of drifting into any given ~24-minute band
# (22:48-23:12) each time the schedule rebuilds. Excluding this band from
# every OTHER tenant's spread (not just Zimmar's -- any future tenant using
# _spread_within_window() inherits the same protection automatically)
# closes the gap at its root instead of hoping jitter avoids it.
_RESERVED_MINUTE_RANGES: list[tuple[int, int]] = []


def _spread_within_window(index: int, total: int, start_minutes: int, end_minutes: int) -> tuple[int, int]:
    """
    Place job `index` of `total` evenly inside [start_minutes, end_minutes)
    (both expressed as minutes since midnight), then jitter it -- so N
    accounts fill the window instead of stacking on one minute, and no
    account sits at the identical wall-clock minute forever (see
    _RUN_TIME_JITTER_MINUTES).

    Clamped to stay strictly inside the window: the jitter must never push
    a job past the boundary, or a "sending" job could drift into the
    discovery window and reintroduce exactly the session-lock contention
    these windows exist to prevent. Also re-drawn (not just re-jittered --
    a fresh random.randint() call, not a clamp) if it lands inside any
    range in _RESERVED_MINUTE_RANGES, so it can't collide with another
    tenant's own reserved/anchored slot -- see that constant's own comment.

    CHANGED 2026-09-27, owner's explicit request: takes minutes-since-
    midnight directly now (not whole hours multiplied by 60 internally),
    both because discovery's new window starts at 20:15 (not hour-aligned)
    and because it now crosses midnight -- `end_minutes` can be passed as
    e.g. 1620 (03:00 the next day, past the 1440-per-day mark) and every
    line below keeps working unmodified, since nothing here cares whether
    the linear minute count exceeds 1440. Only the FINAL hour returned to
    the CronTrigger needs to be a real 0-23 wall-clock hour, via % 24 --
    APScheduler's CronTrigger has no concept of "hour 26," but "hour 2"
    (26 % 24) means exactly the same instant for a job that fires once
    every day regardless of which calendar day a human would call it.
    """
    window_minutes = end_minutes - start_minutes
    # Evenly spaced slots, offset by half a slot so the first job isn't at
    # the very edge of the window and the last isn't at the very end.
    slot = window_minutes // max(total, 1)
    base = start_minutes + slot * index + slot // 2
    earliest = start_minutes
    latest = end_minutes - 1
    for _attempt in range(20):  # bounded re-draw, never an infinite loop
        jittered = base + random.randint(-_RUN_TIME_JITTER_MINUTES, _RUN_TIME_JITTER_MINUTES)
        total_minutes = max(earliest, min(latest, jittered))
        if not any(lo <= total_minutes <= hi for lo, hi in _RESERVED_MINUTE_RANGES):
            hour, minute = divmod(total_minutes, 60)
            return hour % 24, minute
    # Exhausted retries. LIVE-CAUGHT 2026-09-17: with `base` itself landing
    # inside a reserved range (e.g. 2 accounts split 20:00-24:00 puts one
    # slot's center at exactly 23:00, dead center of Insurance's reserved
    # band), 20 re-draws of a +/-15 min jitter around that same bad center
    # can plausibly ALL land back inside it -- and the old fallback to
    # `base` unjittered just re-landed in the reserved zone every time,
    # silently defeating the whole point of this function. Instead, walk
    # outward one minute at a time from `base` in both directions until a
    # minute outside every reserved range (and inside the window) is found
    # -- this always terminates (window_minutes is finite) and always
    # returns a genuinely safe time, unlike re-trying the same bad center.
    for offset in range(1, window_minutes + 1):
        for candidate in (base - offset, base + offset):
            if earliest <= candidate <= latest and not any(
                lo <= candidate <= hi for lo, hi in _RESERVED_MINUTE_RANGES
            ):
                hour, minute = divmod(candidate, 60)
                return hour % 24, minute
    # Every minute in the window is reserved (reserved ranges configured to
    # cover the whole window) -- nothing safe exists to return; this is a
    # misconfiguration, not a runtime fluke, so fail loudly rather than
    # silently schedule inside a reserved band.
    raise RuntimeError(
        f"_spread_within_window({index}, {total}, {start_minutes}, {end_minutes}): "
        f"every minute in this window is covered by _RESERVED_MINUTE_RANGES "
        f"({_RESERVED_MINUTE_RANGES}) -- no safe time exists to schedule."
    )

# Randomized jitter applied to every per-account discovery and sending job's
# scheduled time, re-drawn each time build_daily_schedule() runs.
#
# Without it every account fires at a fixed wall-clock minute (Zimmar 08:00
# discovery / 08:20 sending) every single day, indefinitely -- a real person
# does not start prospecting at exactly 08:00:00 daily for months. The
# per-account staggering added earlier removed the "every tenant at once"
# fingerprint; this removes the "same minute forever" one that remained.
#
# Applied at SCHEDULE-BUILD time, not per-run: APScheduler's CronTrigger
# fires on a fixed expression, so the jitter is baked into each job's cron
# minute when the schedule is constructed. The scheduler process restarting
# (deploy, reboot, crash-restart) re-draws it, which is the intended
# behaviour -- it re-randomizes without needing a moving trigger.
_RUN_TIME_JITTER_MINUTES = 15


# EXPLICIT OWNER REQUEST (2026-09-16): Insurance specifically must run at
# times ANCHORED near a fixed hour every day, not spread across the whole
# window the way every other tenant (Zimmar, mjivity1, future tenants) is
# via _spread_within_window() above. Zimmar is explicitly UNCHANGED by this
# -- only Insurance gets anchored times.
#
# FOLLOW-UP OWNER REQUEST (2026-09-17): the original version of this made
# Insurance's times perfectly FIXED (byte-identical every rebuild), which
# the owner then realized is itself a bot-detection fingerprint -- exactly
# the "same wall-clock minute forever" pattern documented on
# _RUN_TIME_JITTER_MINUTES above as what got Zimmar's LinkedIn account
# checkpointed. Insurance's times are now jittered by +/-10 minutes around
# these anchors, re-drawn on every build_daily_schedule() call same as
# every other tenant's jitter -- see _insurance_jittered_minutes() below.
# The anchors stay put; only the byte-identical-every-day property is gone.
#
# Keyed by business_name (settings.business_name), the same identifier
# messaging/generate.py already uses for Insurance's own fixed message
# templates (see that module's _INSURANCE_BUSINESS_NAME) -- reusing it here
# instead of inventing a second hardcoded tenant_id constant means both
# "this is Insurance" checks in the codebase stay in sync automatically if
# the tenant is ever renamed/recreated.
_INSURANCE_BUSINESS_NAME = "Partners Insurance Consultancy"

# Insurance discovery no longer uses an anchored time (OWNER REQUEST
# 2026-09-30, superseded the old 23:00/23:02 anchors documented in git
# history) -- Insurance's discovery jobs now use the same
# _spread_within_window() mechanism as Zimmar, just against Insurance's own
# disjoint 23:10-03:00 window (see _INSURANCE_DISCOVERY_WINDOW_* above).

# Insurance sending (LinkedIn only) -- owner: anchored time BEFORE 11:00 AM
# Beirut. 10:00 was chosen as a reasonable anchor for the morning slot that
# clears Zimmar's own live-scheduled sending times with comfortable margin
# on both sides, while still leaving room before the 11:00 upper bound the
# owner specified even after +/-10 min jitter (9:50-10:10, re-verified
# against Zimmar's live sending times 2026-09-17: 8:37, 9:46).
_INSURANCE_SENDING_HOUR = 10
_INSURANCE_SENDING_MINUTE = 0

# FOLLOW-UP OWNER REQUEST (2026-09-17): +/-10 minutes for Insurance's three
# anchored times specifically. Deliberately a SEPARATE constant from
# _RUN_TIME_JITTER_MINUTES (=15) above rather than reusing it -- the owner
# asked for exactly 10 minutes here, tighter than the spread-window jitter
# every other tenant gets, so Insurance's times stay clustered near its
# chosen anchors instead of drifting as far as the general-purpose jitter
# would allow.
_INSURANCE_JITTER_MINUTES = 10

# Populates _RESERVED_MINUTE_RANGES (declared up near _spread_within_window,
# before these anchors existed) with Insurance's sending anchor band, widened
# a couple minutes past its own +/-_INSURANCE_JITTER_MINUTES so Zimmar's
# sending spread draw can't land RIGHT next to Insurance's actual jittered
# sending time either (both tenants still share one 08:00-12:00 sending
# window). Module-load-time, not per-build -- this band is fixed regardless
# of how Insurance's own time jitters run to run.
#
# NO discovery entry here anymore (OWNER REQUEST 2026-09-30): Zimmar and
# Insurance discovery now run in disjoint windows (20:00-23:00 vs
# 23:10-03:00, see _ZIMMAR_DISCOVERY_WINDOW_*/_INSURANCE_DISCOVERY_WINDOW_*
# above), so there is no shared window left for a reserved band to protect.
_RESERVED_MINUTE_RANGES.extend([
    (
        _INSURANCE_SENDING_HOUR * 60 + _INSURANCE_SENDING_MINUTE - _INSURANCE_JITTER_MINUTES - 2,
        _INSURANCE_SENDING_HOUR * 60 + _INSURANCE_SENDING_MINUTE + _INSURANCE_JITTER_MINUTES + 2,
    ),
])


def _insurance_jittered_minutes(hour: int, minute: int) -> tuple[int, int]:
    """
    Apply independent +/-_INSURANCE_JITTER_MINUTES jitter to one of
    Insurance's anchored (hour, minute) times, re-drawn fresh each call --
    same "re-drawn every time build_daily_schedule() runs" behaviour as
    _spread_within_window() above, just centered on a fixed anchor instead
    of an evenly-spaced slot.

    Only Insurance's LinkedIn sending job still uses this (OWNER REQUEST
    2026-09-30 moved discovery off anchored jitter entirely, see the comment
    above _INSURANCE_SENDING_HOUR).

    No window-boundary clamping here unlike _spread_within_window(): the
    anchors themselves (23:00/23:02/10:00) already sit with enough margin
    from the 20:00-24:00 / 08:00-12:00 window edges that +/-10 minutes
    cannot push a job across a window boundary.
    """
    total_minutes = hour * 60 + minute + random.randint(-_INSURANCE_JITTER_MINUTES, _INSURANCE_JITTER_MINUTES)
    return divmod(total_minutes, 60)


def _is_insurance_tenant(tenant_id: str) -> bool:
    """
    True if `tenant_id` is Insurance's own tenant -- resolved by
    business_name (see _INSURANCE_BUSINESS_NAME's docstring above) rather
    than a second hardcoded tenant_id constant. get_settings() accepts an
    explicit tenant_id directly (see its own docstring), so no ambient
    tenant_scope() is needed here even though build_daily_schedule() itself
    iterates tenant_ids outside of one.
    """
    settings = repo.get_settings(tenant_id) or {}
    return (settings.get("business_name") or "").strip() == _INSURANCE_BUSINESS_NAME


# Randomized pause between two consecutive PROFILE visits during discovery.
#
# Real gap found 2026-09-08: the widening-search loop above already paused
# 15-30s between search queries (added after LinkedIn force-logged-out a
# real account over back-to-back searches -- see its own comment), but the
# per-profile loops that follow it visited every result's /about/ and
# /posts/ pages (LinkedIn) or post -> profile (Instagram) with no delay at
# all. Rapidly viewing many profiles in sequence is the classic scraping
# fingerprint on both platforms -- arguably watched more closely than
# messaging, since that IS what scrapers do. Same reasoning and shape as
# _sleep_between_sends() below, shorter because browsing several profiles
# in a few minutes is normal human behaviour, whereas sending several cold
# messages that fast is not.
_PROFILE_VISIT_GAP_MIN_SECONDS = 20
_PROFILE_VISIT_GAP_MAX_SECONDS = 75


def _sleep_between_profile_visits() -> float:
    """Block for a random gap between discovery profile visits; returns seconds waited."""
    gap = random.uniform(_PROFILE_VISIT_GAP_MIN_SECONDS, _PROFILE_VISIT_GAP_MAX_SECONDS)
    time.sleep(gap)
    return gap


def _sleep_between_sends(gap_max_seconds: float | None = None) -> float:
    """
    Block for a random inter-send gap, returning the seconds actually
    waited (so callers/tests can assert on real pacing rather than guess).

    `gap_max_seconds` (added 2026-10-07, owner's explicit request) lets the
    caller shrink the upper bound below the normal _SEND_GAP_MAX_SECONDS
    when the fixed gap genuinely would not fit the whole approved batch
    inside the remaining sending window -- see _run_sending_cycle_for_tenant's
    own comment on the real incident this fixes. Never exceeds the normal
    range and never goes below _SEND_GAP_MIN_SECONDS, even if the caller
    passes something smaller -- a gap that's too tight is itself a bot
    signal, same reasoning as the original fixed range.

    Deliberately a plain time.sleep on the scheduler's own worker thread:
    APScheduler runs each job in its own thread, so a cycle sitting idle
    here blocks only itself, not the fast reply-send/reply-detection polls
    that must stay responsive. Making this async or job-splitting instead
    would buy nothing while adding real complexity.
    """
    effective_max = _SEND_GAP_MAX_SECONDS if gap_max_seconds is None else max(_SEND_GAP_MIN_SECONDS, min(_SEND_GAP_MAX_SECONDS, gap_max_seconds))
    gap = random.uniform(_SEND_GAP_MIN_SECONDS, effective_max)
    time.sleep(gap)
    return gap


def build_daily_schedule() -> BackgroundScheduler:
    """
    Wire up the full daily pipeline for the always-on server (Phase 10),
    across every tenant that currently has active Outreach accounts: one
    discovery cron trigger per (tenant, account) pair at that account's own
    configured run_time, replacing run_cycle's Phase 2 placeholder role now
    that Phase 3's real discovery exists (run_cycle itself is untouched and
    still used for the manual test entry point below) -- plus one shared
    downstream-pipeline trigger (run_full_pipeline_cycle) that runs once
    daily and already loops over every active tenant internally.

    Ported multi-tenant 2026-08-20: no longer takes an `accounts` list --
    it discovers tenants and their accounts itself via
    repo.list_active_tenant_ids() + account_pool.load_accounts(tenant_id),
    since this is now a per-tenant, not a fixed, account set. Each job
    closure captures its own tenant_id so a later add_job for a different
    tenant can't shadow an earlier one's discovery run.

    The downstream steps are scheduled just once, not per account, because
    each of them already loops over every tenant AND processes every
    pending record within that tenant in a single pass (see
    run_analysis_cycle/run_message_generation_cycle/run_sending_cycle/
    run_approval_reminder_check's own docstrings) -- unlike discovery, they
    aren't scoped to "this one account's turn" to begin with.

    Returns the scheduler unstarted -- calling code (the always-on server
    process, from Phase 10) decides when to call .start() and keep the
    process alive.
    """
    # Found un-tuned in the 2026-09-09 platform review: this previously ran
    # on APScheduler's implicit defaults (a 10-thread pool nobody chose for
    # this job mix, and no explicit max_instances/misfire_grace_time on any
    # job). Not broken by accident -- max_instances defaults to 1 per job
    # already, so two runs of the SAME job id could never literally overlap
    # -- but relying on an unstated default is fragile, and a job that's
    # still running past its own interval (very plausible for the 3-minute
    # reply polls, which open real Playwright browser sessions per account)
    # would previously misfire silently with no grace window at all. Made
    # explicit below on every job instead of changing behavior.
    scheduler = BackgroundScheduler(
        timezone=config.TIMEZONE,
        executors={"default": ThreadPoolExecutor(max_workers=20)},
        job_defaults={"max_instances": 1, "misfire_grace_time": 60},
    )

    # Every active account across every tenant, collected first so each can
    # be given its own evenly-spaced slot inside the shared windows (see
    # _spread_within_window) -- the old scheme derived each job's time from
    # that account's own configured run_time, which is what allowed
    # discovery and sending for one account to land close together.
    scheduled_accounts: list[tuple[str, str, dict]] = []
    for tenant_id in repo.list_active_tenant_ids():
        # Resolved once per tenant, not per account -- every account for a
        # tenant shares the same scheduling timezone (see
        # OutreachSettings.timezone / repo.get_outreach_timezone()'s own
        # docstring). Falls back to config.TIMEZONE if unset, matching the
        # scheduler-level default above.
        tenant_tz = repo.get_outreach_timezone(tenant_id)
        for account in pool.load_accounts(tenant_id):
            if account.get("status") == "active":
                scheduled_accounts.append((tenant_id, tenant_tz, account))

    # OWNER REQUEST 2026-09-30: LinkedIn sending is permanently disabled (see
    # the "LinkedIn sending is disabled" check inside the sending cycle
    # itself) and now excluded from the schedule entirely rather than
    # scheduling a cron job that fires nightly/morning and does nothing --
    # only Instagram has real work for this cycle (email is sent entirely by
    # the Next.js/Resend pipeline, see the comment below).
    sending_accounts = [
        entry for entry in scheduled_accounts
        if entry[2].get("platform") == "instagram"
    ]

    # Resolved once per distinct tenant_id (not per account) so
    # _is_insurance_tenant's get_settings() call doesn't run twice for
    # Insurance's two accounts (LinkedIn + Email) -- cheap either way, but
    # there's no reason to hit the DB more than once per tenant here.
    _insurance_tenant_cache: dict[str, bool] = {}

    def _is_insurance(tenant_id: str) -> bool:
        if tenant_id not in _insurance_tenant_cache:
            _insurance_tenant_cache[tenant_id] = _is_insurance_tenant(tenant_id)
        return _insurance_tenant_cache[tenant_id]

    # DISCOVERY -- OWNER REQUEST 2026-09-30: fully sequential per tenant.
    # Zimmar's accounts spread across 20:00-23:00 Beirut; Insurance's spread
    # across 23:10-03:00 Beirut. Each tenant is spread independently within
    # its own window (index/count computed per-tenant, not across the full
    # scheduled_accounts list), so Zimmar having e.g. 3 accounts and
    # Insurance having 3 doesn't skew either tenant's spread. Built as two
    # separate (tenant_id, tenant_tz, account, hour, minute) lists up front
    # rather than computing hour/minute inline in a single mixed loop, so
    # each tenant's own enumerate() index is unambiguous.
    _zimmar_accounts = [e for e in scheduled_accounts if not _is_insurance(e[0])]
    _insurance_accounts = [e for e in scheduled_accounts if _is_insurance(e[0])]
    _discovery_schedule: list[tuple[str, str, dict, int, int]] = []
    for index, (tenant_id, tenant_tz, account) in enumerate(_zimmar_accounts):
        if index == 0:
            # OWNER REQUEST 2026-10-04: Zimmar's first discovery job fires
            # right at the window's own start (18:15), not centered in its
            # slot like every other index -- a small +0..jitter so it never
            # fires a few seconds BEFORE the window technically opens.
            hour, minute = divmod(
                _ZIMMAR_DISCOVERY_WINDOW_START_MINUTES
                + random.randint(0, _RUN_TIME_JITTER_MINUTES),
                60,
            )
            hour %= 24
        else:
            hour, minute = _spread_within_window(
                index, len(_zimmar_accounts),
                _ZIMMAR_DISCOVERY_WINDOW_START_MINUTES, _ZIMMAR_DISCOVERY_WINDOW_END_MINUTES,
            )
        _discovery_schedule.append((tenant_id, tenant_tz, account, hour, minute))
    for index, (tenant_id, tenant_tz, account) in enumerate(_insurance_accounts):
        hour, minute = _spread_within_window(
            index, len(_insurance_accounts),
            _INSURANCE_DISCOVERY_WINDOW_START_MINUTES, _INSURANCE_DISCOVERY_WINDOW_END_MINUTES,
        )
        _discovery_schedule.append((tenant_id, tenant_tz, account, hour, minute))

    for tenant_id, tenant_tz, account, hour, minute in _discovery_schedule:

        def _run_discovery_for_this_account(tenant_id: str = tenant_id, account_id: str = account["id"]) -> None:
            # Runs the FULL tenant-wide discovery cycle (run_discovery_cycle
            # already loops over every due account for the tenant and gates
            # linkedin/instagram per account's own platform) -- scheduling
            # granularity is per-account, but the work itself reuses the same
            # tenant-scoped cycle function rather than a separate
            # single-account code path, so there is exactly one discovery
            # implementation, not two.
            run_discovery_cycle()

        scheduler.add_job(
            _run_discovery_for_this_account,
            trigger=CronTrigger(hour=hour, minute=minute, timezone=tenant_tz),
            id=f"discovery-{tenant_id}-{account['id']}",
            name=f"Nightly discovery: tenant {tenant_id} / {account['label']}",
            replace_existing=True,
        )

    # SENDING -- morning window (08:00-12:00 Beirut), LinkedIn/Instagram only.
    # Email is sent entirely by the Next.js/Resend pipeline (see
    # sendIfEmailChannel), never by this Python agent, so an email account
    # simply has nothing for this cycle to do.
    for index, (tenant_id, tenant_tz, account) in enumerate(sending_accounts):
        if _is_insurance(tenant_id):
            # EXPLICIT OWNER REQUEST (2026-09-16), Insurance only -- anchored
            # 10:00 Beirut (before the owner's stated 11:00 upper bound; see
            # _INSURANCE_SENDING_HOUR's own comment for why 10:00 clears
            # Zimmar's live sending times). FOLLOW-UP 2026-09-17: jittered
            # +/-10 min via _insurance_jittered_minutes() rather than fixed
            # (see that function's docstring and _INSURANCE_JITTER_MINUTES
            # above). Zimmar and every other tenant keep the unchanged
            # spread/jitter below.
            send_hour, send_minute = _insurance_jittered_minutes(
                _INSURANCE_SENDING_HOUR, _INSURANCE_SENDING_MINUTE
            )
        elif index == 0:
            # OWNER REQUEST 2026-10-07: the first sending account in the
            # window starts right at its own open (8:00 Beirut +/-15 min),
            # not centered mid-slot like _spread_within_window's default
            # (Zimmar landed at 9:46 before this fix) -- same reasoning and
            # same pattern as the identical Zimmar-discovery-window-start
            # fix from 2026-10-04. Starting late ate directly into the real
            # sending time available before the window closes at 12:00,
            # which is why only 11 of 15 approved messages went out that
            # morning even though the daily cap wasn't the limiting factor.
            send_hour, send_minute = divmod(
                _SENDING_WINDOW_START_HOUR * 60 + random.randint(0, _RUN_TIME_JITTER_MINUTES), 60,
            )
            send_hour %= 24
        else:
            send_hour, send_minute = _spread_within_window(
                index, len(sending_accounts),
                _SENDING_WINDOW_START_HOUR * 60, _SENDING_WINDOW_END_HOUR * 60,
            )

        def _run_sending_for_this_account(tenant_id: str = tenant_id, account_id: str = account["id"]) -> None:
            run_account_sending_cycle(tenant_id, account_id)

        scheduler.add_job(
            _run_sending_for_this_account,
            trigger=CronTrigger(hour=send_hour, minute=send_minute, timezone=tenant_tz),
            id=f"sending-{tenant_id}-{account['id']}",
            name=f"Morning cold-outreach sending: tenant {tenant_id} / {account['label']}",
            replace_existing=True,
        )

        # REAL BUG FOUND AND FIXED 2026-09-20: CronTrigger always computes
        # "next occurrence strictly after now" -- if a redeploy happens
        # AFTER today's send_hour:send_minute has already passed (this
        # session alone: multiple same-morning redeploys each pushed
        # Zimmar's own sending slot to TOMORROW, live-confirmed 43 real
        # approved messages sitting untouched all day while the 8:00-12:00
        # Beirut window was still wide open), the account gets skipped for
        # the ENTIRE day even though the window it belongs to hasn't
        # closed yet. This schedules a ONE-OFF immediate catch-up run
        # (fired ~10-40s from now, staggered per account so a redeploy
        # mid-window doesn't fire every account's catch-up in the same
        # instant -- same spacing reasoning as _spread_within_window)
        # whenever: (1) we're currently inside this tenant's own
        # 08:00-12:00 sending window right now, in ITS timezone, AND (2)
        # today's own send_hour:send_minute has already passed. Condition
        # (2) matters -- an account whose slot is still ahead of us today
        # must NOT get an extra early run on top of its normal one.
        try:
            tz = ZoneInfo(tenant_tz)
        except Exception:  # noqa: BLE001 -- an invalid/unknown tz string must not crash schedule-build; just skip catch-up for this one account
            tz = None
        if tz is not None:
            now_local = dt.datetime.now(tz)
            today_slot = now_local.replace(hour=send_hour, minute=send_minute, second=0, microsecond=0)
            window_start = now_local.replace(hour=_SENDING_WINDOW_START_HOUR, minute=0, second=0, microsecond=0)
            window_end = now_local.replace(hour=_SENDING_WINDOW_END_HOUR, minute=0, second=0, microsecond=0)
            if window_start <= now_local < window_end and now_local > today_slot:
                catch_up_at = now_local + dt.timedelta(seconds=10 + index * 30)
                scheduler.add_job(
                    _run_sending_for_this_account,
                    trigger=DateTrigger(run_date=catch_up_at, timezone=tz),
                    id=f"sending-catchup-{tenant_id}-{account['id']}",
                    name=f"Catch-up (missed today's slot): tenant {tenant_id} / {account['label']}",
                    replace_existing=True,
                )

        # SECOND, DAILY safety net for the case the mid-window catch-up
        # above can't cover: the morning window (08:00-12:00) closes
        # ENTIRELY before any redeploy runs at all that day (live-confirmed
        # 2026-09-20: every one of that day's redeploys happened to land
        # right after each account's own slot had already passed, so the
        # in-window catch-up never got a chance to fire, and 43 real
        # approved messages sat untouched the whole day). Scheduled once
        # daily at _SENDING_RECOVERY_HOUR (18:00 Beirut -- well clear of
        # the 08:00-12:00 window and the 20:00-24:00 discovery window, so
        # it never collides with either), this checks whether this account
        # actually sent its full daily allowance today; if not, it runs the
        # exact same sending cycle once more. run_account_sending_cycle()
        # is naturally safe to call more than once a day -- it only ever
        # picks up still-"approved" messages and re-checks the real
        # per-calendar-day cap (pool.today_start_iso) before sending
        # anything, so this can never double-send past the daily limit.
        def _run_recovery_sending_for_this_account(
            tenant_id: str = tenant_id, account_id: str = account["id"], tenant_tz: str = tenant_tz,
        ) -> None:
            try:
                tz = ZoneInfo(tenant_tz)
            except Exception:  # noqa: BLE001 -- an invalid/unknown tz string must not crash the job; just skip the check and let the normal cap logic decide
                tz = None
            acct = repo.get_account(account_id, tenant_id)
            if not acct or acct.get("status") != "active":
                return
            override = acct.get("send_daily_limit_override")
            daily_limit = override if override is not None else warmup.effective_limit(acct, acct.get("platform"))
            day_start = pool.today_start_iso(tenant_id)
            already_sent = repo.cold_sends_today_for_account(account_id, day_start, tenant_id=tenant_id)
            if already_sent >= daily_limit:
                return  # already sent its full allowance today -- nothing to recover
            run_account_sending_cycle(tenant_id, account_id)

        scheduler.add_job(
            _run_recovery_sending_for_this_account,
            trigger=CronTrigger(hour=_SENDING_RECOVERY_HOUR, minute=_SENDING_RECOVERY_MINUTE, timezone=tenant_tz),
            id=f"sending-recovery-{tenant_id}-{account['id']}",
            name=f"End-of-day recovery (send today's leftover quota if the morning window was missed entirely): tenant {tenant_id} / {account['label']}",
            replace_existing=True,
        )

    # timezone=config.TIMEZONE is load-bearing (added 2026-09-16): without
    # it APScheduler falls back to the scheduler's own default, and since
    # the container's system clock is UTC this job was firing at 20:00 UTC
    # = 23:00 Beirut -- three hours later than intended, every night, with
    # nothing in the logs to show for it. Every other job here already
    # passed an explicit timezone; this one was simply missed.
    scheduler.add_job(
        run_full_pipeline_cycle,
        trigger=CronTrigger(
            hour=_DOWNSTREAM_HOUR, minute=_DOWNSTREAM_MINUTE, timezone=config.TIMEZONE,
        ),
        id="downstream-pipeline",
        name="Daily analysis -> messages -> reminders -> follow-up dispatch",
        replace_existing=True,
    )

    # Second daily pass -- see _DOWNSTREAM_SECOND_HOUR's own comment above
    # for why 00:30 alone isn't enough. Same job function, same tenant loop,
    # just a second scheduled instant; nothing about run_full_pipeline_cycle
    # itself needed to change since every step it calls is already safe to
    # run twice (it only ever touches leads currently sitting at "analyzed",
    # so a lead the first pass already drafted is simply skipped).
    scheduler.add_job(
        run_full_pipeline_cycle,
        trigger=CronTrigger(
            hour=_DOWNSTREAM_SECOND_HOUR, minute=_DOWNSTREAM_SECOND_MINUTE, timezone=config.TIMEZONE,
        ),
        id="downstream-pipeline-second",
        name="Second daily pass: analysis -> messages -> reminders -> follow-up dispatch",
        replace_existing=True,
    )

    # Fast poll for tenant-written replies ("Reply Here") -- deliberately
    # NOT on the once-daily cadence above, so a reply a tenant sends from
    # the dashboard feels close to real-time rather than waiting up to 24h
    # for the next downstream-pipeline run. See run_reply_send_cycle()'s
    # own docstring.
    scheduler.add_job(
        run_reply_send_cycle,
        trigger=IntervalTrigger(minutes=_REPLY_POLL_INTERVAL_MINUTES),
        id="reply-send-poll",
        name="Fast poll: deliver tenant-written replies",
        replace_existing=True,
    )

    # Fast poll for DETECTING an incoming reply (the counterpart to the
    # send-poll above) -- moved off the once-daily downstream-pipeline
    # cadence 2026-09-07, see run_reply_detection_poll()'s own docstring
    # for the real gap this closes.
    scheduler.add_job(
        run_reply_detection_poll,
        trigger=IntervalTrigger(minutes=_REPLY_DETECTION_POLL_INTERVAL_MINUTES),
        id="reply-detection-poll",
        name="Fast poll: detect incoming WhatsApp/LinkedIn/Instagram replies",
        replace_existing=True,
    )

    # Catches a session going bad BETWEEN sends -- see
    # run_account_health_check_cycle()'s own docstring for why this exists
    # as a separate job rather than folding into the sends above (those
    # only ever check the account they're already about to use, on their
    # own schedule, not every connected account on a schedule of its own).
    scheduler.add_job(
        run_account_health_check_cycle,
        trigger=IntervalTrigger(hours=_ACCOUNT_HEALTH_CHECK_INTERVAL_HOURS),
        id="account-health-check",
        name="Periodic check: is each connected LinkedIn/Instagram account still actually logged in",
        replace_existing=True,
    )

    return scheduler


if __name__ == "__main__":
    print(f"Manual test cycle -- {dt.datetime.now():%Y-%m-%d %H:%M:%S}")
    print(f"Target: {DEFAULT_TEST_URL}\n")

    outcomes = run_cycle(force=True)

    if not outcomes:
        print("No active accounts found across any tenant.")
    for outcome in outcomes:
        status = "OK" if outcome["ok"] else f"WARNING ({outcome['warning_type']})"
        print(f"  [{outcome['tenant_id']}] {outcome['account']}: {status}")
        if not outcome["ok"]:
            print(f"    reason: {outcome['reason']}")
