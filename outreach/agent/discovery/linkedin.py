"""
LinkedIn search and profile reading. Target 30/account/day.

Reads company name, description, headcount, website. Adapts its search terms
when results come back weak -- agentic, not fixed.

============================================================================
VERIFIED against real, live LinkedIn pages -- 2026-07-31, RE-VERIFIED 2026-08-03
============================================================================
Two very different situations, found by inspecting real pages rather than
guessing:

  1. Search (build_search_url / extract_search_results) has NO public
     equivalent -- confirmed both the /about company subpage and the search
     results page hard-redirect anonymous visits to a login page. Verified
     with a real captured login session instead: search itself works fine
     once authenticated, but the results page uses deeply auto-generated,
     non-semantic CSS classes (the same pattern Instagram uses) that are
     useless to select on and will keep changing. The href pattern
     (`/company/<slug>/`) is the only stable part -- each company appears
     3x in the markup (image link, name link, follow-button link), so this
     dedupes on the URL and keeps whichever occurrence actually has text.
  2. Profile reading (extract_company_profile) -- **RE-VERIFIED 2026-08-03,
     selectors changed.** The 2026-07-31 claim that `data-test-id="about-us__*"`
     attributes existed on the bare company page was found to be stale during
     a real supervised discovery run: LinkedIn had redesigned this page and
     those attributes no longer exist anywhere on it (confirmed empty via
     `eval_on_selector_all('[data-test-id]', ...)`). extract_company_profile()'s
     own docstring has the full current selector detail; the short version:
     this function now expects `page` to be on the **`/about`** subpage, not
     the bare page (the bare page is missing the Website/Industry/size info
     entirely) -- scheduler.py's caller was updated to navigate there. The
     original claim that `/about` "redirects anonymous visits to login" turned
     out to only ever have been about *anonymous* visits; every real call site
     here is authenticated (agent/core/session.py), so that redirect never
     actually applied to this codebase's own usage -- confirmed live: `/about`
     renders full real content when logged in. Fixed one real bug found this
     way: the website link's href is a `linkedin.com/redir/redirect?url=...`
     wrapper, not the site itself -- the original code returned that wrapper
     URL verbatim.
============================================================================
"""

from __future__ import annotations

import re
from urllib.parse import quote, unquote

from playwright.sync_api import Page

SEARCH_URL = "https://www.linkedin.com/search/results/companies/"

# Facet IDs confirmed 2026-08-02 against a real, authenticated search --
# found by applying each filter through LinkedIn's own UI (Locations /
# Industry dropdowns on the company search results page) and reading the
# facet parameter LinkedIn added to the URL, e.g. companyHqGeo=["101834488"]
# for Lebanon. Only entries confirmed this exact way go here. This is a
# small, growing lookup, not an exhaustive list of LinkedIn's facet IDs --
# add more the same way (apply the filter live, read the resulting URL) as
# new target_location/target_industry values come up.
LOCATION_FACETS = {
    "lebanon": "101834488",
}
INDUSTRY_FACETS = {
    "food and beverage": "34",
    "food and beverage services": "34",
}

# Documented LinkedIn company-size facet buckets (Microsoft's Marketing API
# reference -- companySize/facetCompanySize), NOT yet independently
# live-verified against a real browser session the way LOCATION_FACETS'
# Lebanon entry was (apply the filter by hand, read the resulting URL).
# Added 2026-09-12 on the owner's explicit go-ahead to ship from
# documentation rather than wait for manual verification, since it follows
# the identical URL pattern (`facet=["value"]`) as the already-confirmed
# companyHqGeo facet. If real search results ever look wrong for a
# size-filtered tenant, verify these letter codes against a real manual
# search before assuming the rest of the query is at fault.
COMPANY_SIZE_FACETS = {
    "1-10": "B",
    "11-50": "C",
    "51-200": "D",
    "201-500": "E",
    "501-1000": "F",
    "1001-5000": "G",
    "5001-10000": "H",
    "10000+": "I",
}

_COMPANY_HREF_RE = re.compile(r"^https://www\.linkedin\.com/company/[^/?]+/?")
_REDIRECT_URL_RE = re.compile(r"[?&]url=([^&]*)")
_ACTIVITY_URN_RE = re.compile(r'data-urn="(urn:li:activity:[^"]*)"')
# RE-VERIFIED 2026-08-03: the actor sub-description's inner <span> now
# carries `aria-hidden="true"` (confirmed against a real post on Wooden
# Bakery's Posts tab) -- the original regex assumed a bare `<span>` with no
# attributes and silently matched nothing once LinkedIn added it, making
# every real post read as having no relative-time text.
_POST_TIME_RE = re.compile(r'update-components-actor__sub-description[^>]*>\s*<span[^>]*><!---->(\d+[a-zA-Z]+)')
_RELATIVE_TIME_RE = re.compile(r"^(\d+)(h|d|w|mo|yr)$")


# A configured location longer than this (or containing commas) is a
# multi-region targeting policy, not something to paste into a search box.
# See the fallback branch in build_search_url for the real case behind it.
_MAX_LOCATION_KEYWORD_LENGTH = 30


def build_search_url(
    niche: str, location: str, industry: str = "", size_buckets: list[str] | None = None,
    page: int = 1,
) -> str:
    """
    Build a LinkedIn company-search URL from the dashboard's niche/location/
    industry settings.

    Uses a precise facet parameter (LOCATION_FACETS/INDUSTRY_FACETS above)
    whenever `location`/`industry` matches a verified entry -- exactly what
    LinkedIn's own UI produces when you apply that filter by hand. Anything
    not in those two small lookups still works, just folded into the
    free-text `keywords` parameter instead, same as before this was verified.

    `size_buckets` is a list of COMPANY_SIZE_FACETS keys (e.g.
    ["51-200", "201-500"]) to OR together as one companySize facet --
    LinkedIn's own multi-select size filter works this way (bracket array
    of letter codes), not as several separate exact-match filters. Pass
    None/empty to search every size (no facet added at all), which is
    exactly what an unfiltered "any size" tenant like Zimmar needs.

    `page` (ADDED 2026-10-04, owner's explicit request): LinkedIn's company
    search genuinely supports jumping straight to a results page via
    `&page=N` -- LIVE-CONFIRMED (same niche/location, page=1 vs page=2
    returned 10 entirely different companies, zero overlap). Defaults to 1
    (omitted from the URL entirely at that value, matching every existing
    caller/test that built a URL before this parameter existed) so
    discovery can resume from wherever repositories.get_search_page() says
    this (account, search_term) pair last left off, instead of re-reading
    the same first page every time the same term comes up again.
    """
    keyword_parts = [niche]
    facet_params: dict[str, str] = {}

    geo_id = LOCATION_FACETS.get(location.strip().lower()) if location else None
    if geo_id:
        facet_params["companyHqGeo"] = f'["{geo_id}"]'
    elif location:
        # Only fold a SHORT location into the free-text keywords. A tenant
        # can legitimately configure a long multi-region target -- MJivity's
        # is "GCC (UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman), Egypt,
        # Lebanon, MENA region, United States, United Kingdom, Canada,
        # Europe" -- and appending all 129 characters to the query made
        # LinkedIn search for that literal phrase, which matches nothing.
        # LIVE-CONFIRMED 2026-09-13. A long list like that is a targeting
        # policy, not a search term: the per-profile location check
        # (scheduler._mentions_foreign_location) is what actually enforces
        # it, so dropping it from the query here loses no filtering.
        if len(location) <= _MAX_LOCATION_KEYWORD_LENGTH and "," not in location:
            keyword_parts.append(location)

    industry_id = INDUSTRY_FACETS.get(industry.strip().lower()) if industry else None
    if industry_id:
        facet_params["industryCompanyVertical"] = f'["{industry_id}"]'
    elif industry:
        # Added 2026-09-13, real bug caught live: Zimmar's target_industry
        # is deliberately verbose prose ("Offices, warehouses, retail,
        # schools, factories, residential complexes, hospitality;
        # individuals or families setting up a new house; real estate
        # developers...") -- a targeting POLICY, not a search term (same
        # exact situation the location guard above already documents and
        # fixes for a long/comma-separated location). Before this guard,
        # that entire sentence was appended straight into the `keywords`
        # query param, which LIVE-CONFIRMED produced 0 results across
        # EVERY SINGLE niche term tried (logistics, trading, engineering,
        # transportation, distribution, manufacturing, real estate, general
        # commercial, agriculture, IT services -- all 10/10 search rounds
        # in one real run) even though the exact same niche+location
        # combination, tested moments later with industry dropped, returned
        # 10 real results and a page showing "643 results" for 'trading'
        # alone. A long or comma-containing industry string is a policy for
        # the per-profile checks to enforce, not a keyword LinkedIn's search
        # can match against.
        if len(industry) <= _MAX_LOCATION_KEYWORD_LENGTH and "," not in industry and ";" not in industry:
            keyword_parts.append(industry)

    if size_buckets:
        size_codes = [COMPANY_SIZE_FACETS[b] for b in size_buckets if b in COMPANY_SIZE_FACETS]
        if size_codes:
            codes_json = ",".join(f'"{c}"' for c in size_codes)
            facet_params["companySize"] = f"[{codes_json}]"

    query = " ".join(part for part in keyword_parts if part).strip()
    origin = "FACETED_SEARCH" if facet_params else "GLOBAL_SEARCH_HEADER"
    url = f"{SEARCH_URL}?keywords={quote(query)}&origin={origin}"
    for key, value in facet_params.items():
        url += f"&{key}={quote(value)}"
    if page and page > 1:
        url += f"&page={page}"
    return url


def widen_search_terms(niche: str, location: str) -> tuple[str, str]:
    """
    Agentic adaptation: called when a search comes back with too few results.
    Drops the location first (the more restrictive term), then would drop
    niche specificity on a second retry if the caller loops. Returns the new
    (niche, location) to search with -- a real, working decision function,
    independent of any LinkedIn-specific markup.
    """
    if location:
        return niche, ""  # widen: search the niche everywhere, not just one place
    return "", ""  # already as wide as it gets


def extract_search_results(page: Page) -> list[dict]:
    """
    Reads each company card on a loaded search-results page. Verified
    2026-07-31 against a real authenticated search (see module docstring):
    matches on the href pattern directly rather than any containing element
    or CSS class, since none are stable. Each company's URL appears multiple
    times in the raw markup (image link + name link + follow-button link) --
    deduped here, keeping the occurrence that actually has the company name
    as its text.

    ============================================================================
    RE-VERIFIED live 2026-08-03 -- the dedup rule below was wrong in practice.
    A real supervised discovery run caught every saved lead's display_name
    holding the ENTIRE card's text ("Wooden Bakery Wooden Bakery Food and
    Beverage ServicesBeirutFollowWooden Bakery was founded in..."), not just
    the company name. The original rule ("first truthy text wins, keep it")
    assumed the *wrong* occurrence would have *empty* text (e.g. an image-only
    link) -- but LinkedIn's outer card-wrapping `<a>` (which wraps the image,
    the name, the whole description, and the follower count all in one link)
    also has non-empty text, and Playwright's locator order returned it before
    the inner name-only `<a>`. Confirmed via raw HTML inspection: the real
    name-only link is nested *inside* that outer one
    (`<a href="...wooden-bakery/">Wooden Bakery</a>`, no other text). Since
    the wrapper's text is always a superset of the name link's shorter text,
    keeping the SHORTEST non-empty occurrence per URL reliably picks the real
    name instead of the whole card.
    ============================================================================

    Returns raw dicts: {profile_url, display_name, headline_or_bio}.
    headline_or_bio is always None -- no stable subtitle/tagline element was
    found on the search card itself, and it's not needed downstream anyway:
    extract_company_profile() below reads the real description directly off
    each company's own page once discover_companies() visits it.
    """
    results: dict[str, str | None] = {}
    links = page.locator("a[href*='linkedin.com/company/']")

    for i in range(links.count()):
        href = _safe_attr(links.nth(i), "href")
        if not href or not _COMPANY_HREF_RE.match(href):
            continue
        url = href.split("?")[0].rstrip("/") + "/"
        name = _safe_text(links.nth(i))
        if not name:
            continue
        existing = results.get(url)
        if existing is None or len(name) < len(existing):
            results[url] = name

    return [
        {"profile_url": url, "display_name": name, "headline_or_bio": None}
        for url, name in results.items()
        if name  # a company with no text occurrence anywhere is unusable -- skip it
    ]


def extract_company_profile(page: Page) -> dict:
    """
    Reads a company's LinkedIn **`/about`** page: description, employee
    count, and website link. Returns the normalised shape
    discovery/qualify.py's qualify_profile() expects.

    ============================================================================
    REAL BUG FOUND AND FIXED 2026-09-30: `section.org-about-module__margin-
    bottom` (below, the container every extraction here used to anchor on)
    now matches ZERO elements -- confirmed live against a real, fully-loaded,
    authenticated `/about` page (Ogilvy's; screenshot showed the real Overview
    text, Website/Industry/Headquarters/Company-size fields, all visibly
    present and correct) where the selector still returned nothing. This is
    what silently turned 3 full discovery rounds (~25 real candidates) into
    100% "empty /about scrape" failures that same night -- not a proxy issue,
    not a LinkedIn block (the page loaded perfectly, status 200, real title,
    real content), purely this selector going stale. LinkedIn has moved to
    fully hashed/atomic-CSS class names throughout this page (`auymff`,
    `auyio3`, etc. -- confirmed via live DOM inspection, clearly auto-
    generated and NOT the kind of name a human would write or LinkedIn would
    keep stable across a deploy), so `section.org-about-module__margin-bottom`
    and every per-field `<dt>/<dd>` pair the old code anchored on are both
    gone completely: the about-page fields no longer use `<dl>/<dt>/<dd>` at
    all, just a `<p>Label</p>` followed by a sibling `<div>` holding the
    value.

    Current real structure (`/about`, authenticated, confirmed live
    2026-09-30 against Ogilvy's real page):
      - the bio is the first `<p>` that follows the "Overview" heading
        (`page.get_by_role("heading", name="Overview")`, itself stable since
        it's matched on the heading's accessible name/role, not any class).
      - Website/Industry/Company size/Headquarters each render as a bare
        `<p>` containing the exact label text, whose PARENT's next sibling
        `<div>` holds the value (a link for Website, plain text for the
        others) -- matched here by finding the `<p>` with that exact text,
        then reading its parent's following-sibling. No `<dt>/<dd>` anywhere
        on the current page.
    ============================================================================
    """
    # LIVE-CONFIRMED 2026-09-01 (still true after the 2026-09-30 selector
    # rewrite above): scheduler.py's caller only waits for
    # wait_until="domcontentloaded" before calling this function, which fires
    # once the raw HTML document parses, well before LinkedIn's client-side
    # JS has actually populated the page's real content (this page is a
    # heavy SPA). Wait once, here, for the Overview heading specifically to
    # exist, not just the document shell.
    try:
        page.get_by_role("heading", name="Overview").first.wait_for(state="attached", timeout=8_000)
    except Exception:  # noqa: BLE001 -- fall through to extraction below regardless; _safe_text tolerates missing text
        pass

    description = _safe_text(_bio_paragraph(page))

    # Was `about_section.locator("dd a").first` -- blindly grabbed whichever
    # <a> happened to render FIRST anywhere in the whole About <dl>, with no
    # check it was actually the Website field. REAL BUG found 2026-09-19:
    # for companies whose About page lists a Phone field before (or instead
    # of) Website, this grabbed a `tel:+961...` link as the "website" --
    # confirmed live for 2 real Zimmar leads (FOOD RETAIL SAL, FRC -
    # Franchise Retail Concept), silently poisoning every downstream Hunter
    # email lookup for them (a phone number obviously has no domain to
    # search). _field_value_after_label() (2026-09-30 replacement for the
    # old _dd_after_label(), same reasoning) is scoped to the actual
    # "Website" label so a Phone/other field rendering first can never be
    # mistaken for it again.
    website = _unwrap_redirect(_safe_attr(_field_value_after_label(page, "Website").locator("a").first, "href"))
    size_text = _safe_text(_field_value_after_label(page, "Company size"))
    # LIVE-ADDED 2026-09-01: LinkedIn's own companyHqGeo search facet
    # (build_search_url above) let a UK company (ZAM FM LTD) through a
    # Lebanon-filtered search -- real, confirmed via the exact search URL
    # actually used, so this is bad/stale data on LinkedIn's own side, not
    # a bug in how that facet param gets built. This reads the About page's
    # own "Headquarters" field as a second, independent location signal --
    # scheduler.py's _discover_linkedin() checks it against the tenant's
    # configured target_location before saving a lead, catching exactly
    # this class of mismatch instead of trusting LinkedIn's search filter
    # alone.
    headquarters = _safe_text(_field_value_after_label(page, "Headquarters"))
    # 2026-09-02: added alongside headquarters, same field-label pattern --
    # scheduler.py's _discover_linkedin() checks this (and the bio) to skip
    # a lead that's actually an insurance company (Insurance's own explicit
    # exclusion: never target other insurance companies).
    industry = _safe_text(_field_value_after_label(page, "Industry"))

    return {
        "platform": "linkedin",
        "bio": description or "",
        "has_website": bool(website),
        "website": website,
        "headquarters": headquarters or "",
        "industry": industry or "",
        "follower_or_headcount": _parse_headcount(size_text),
        "post_count": None,       # this function doesn't visit the Posts tab -- see extract_recent_posts()
        "recent_activity": True,  # placeholder; scheduler.py overwrites both fields with extract_recent_posts()'s real read
    }


def _bio_paragraph(page: Page):
    """
    2026-09-30: the bio's first stable anchor once `section.org-about-module
    __margin-bottom` went dead (see extract_company_profile's docstring) --
    the FIRST `<p>` that comes after the page's "Overview" heading, matched
    by the heading's accessible role/name rather than any class (LinkedIn
    has moved this whole page to hashed, auto-generated class names that are
    useless and unstable to select on directly -- confirmed live 2026-09-30).
    """
    return page.get_by_role("heading", name="Overview").first.locator("xpath=following::p[1]")


def _field_value_after_label(page: Page, label_text: str):
    """
    2026-09-30 replacement for the old `_dd_after_label()`: the About page no
    longer renders Website/Industry/Company size/Headquarters as `<dt>/<dd>`
    pairs at all (confirmed live -- zero `<dt>` elements anywhere on the
    page). Each field is now a bare `<p>` containing the exact label text,
    followed by a SIBLING `<div>` (of the label `<p>`'s own parent `<div>`)
    that holds the value -- confirmed live against Ogilvy's real page:
    `<div><p>Website</p></div><div><a href="...">...</a></div>`. XPath is the
    only way to say "the next sibling of this label's parent" without a
    stable class/attribute to anchor on; `get_by_text(..., exact=True)`
    avoids partial-text false matches (e.g. "Website" inside some unrelated
    longer string elsewhere on the page).
    """
    label = page.get_by_text(label_text, exact=True).first
    return label.locator("xpath=../following-sibling::*[1]")


def extract_recent_posts(page: Page) -> dict:
    """
    Reads a company's Posts tab (linkedin.com/company/<slug>/posts/) for how
    many posts are visible without scrolling and how recently the newest one
    went up. Verified 2026-07-31 against a real authenticated fetch of
    Nike's Posts tab -- this tab hard-redirects anonymous visits straight to
    LinkedIn's login page (confirmed separately with a plain HTTP request,
    got a 302 to /uas/login), so unlike extract_company_profile() above,
    this only works when `page` already has a real logged-in session -- true
    for every real call site in this codebase (agent/core/session.py always
    restores a logged-in account's session before discovery runs), just not
    for an anonymous verification fetch.

    `visible_post_count` is NOT a lifetime total -- it's genuinely just how
    many post entries rendered on this page view (3, without scrolling, in
    testing). LinkedIn's actual lifetime total sits buried in an internal
    API pagination JSON blob that would be easy to misidentify (multiple
    similarly-shaped paging blocks exist on the same page for unrelated
    things) and give false confidence in a wrong number -- counting the
    real, visible posts is the honest signal, even though it's a smaller one.

    `recent_activity` reads the newest post's relative timestamp (LinkedIn's
    own '10h' / '2d' / '1w' / '3mo' format, confirmed against three real
    posts in order) rather than a post-count threshold, since a company with
    only one visible post from 10 hours ago is obviously more active than
    one with three posts all from a year ago.
    """
    # LIVE-CONFIRMED 2026-09-01: the same class of bug as
    # extract_company_profile()'s bio-timing fix above, but hitting
    # page.content() itself this time -- scheduler.py's caller only waits
    # for wait_until="domcontentloaded" before calling this function, so the
    # Posts tab's SPA content can still be client-side navigating when
    # page.content() runs, which Playwright surfaces as
    # "Unable to retrieve content because the page is navigating and
    # changing the content" rather than returning partial/stale HTML.
    # Waiting for the feed container to attach isn't enough on its own
    # (confirmed live: the exception still fired occasionally right after),
    # so this also retries page.content() itself a couple of times with a
    # short pause -- cheap and bounded, since a genuinely stuck page would
    # keep failing and just fall through to an empty result below.
    try:
        page.locator("main").first.wait_for(state="attached", timeout=8_000)
    except Exception:  # noqa: BLE001 -- fall through to the retry loop below regardless
        pass

    content = ""
    for attempt in range(3):
        try:
            content = page.content()
            break
        except Exception:  # noqa: BLE001 -- Playwright's own transient "page is navigating" error
            if attempt == 2:
                content = ""
            else:
                page.wait_for_timeout(1_000)

    urns = list(dict.fromkeys(_ACTIVITY_URN_RE.findall(content)))  # de-dupe, keep order
    times = _POST_TIME_RE.findall(content)
    newest = times[0] if times else None

    return {
        "visible_post_count": len(urns),
        "most_recent_relative_time": newest,
        "recent_activity": _is_recent_relative_time(newest),
    }


def _is_recent_relative_time(text: str | None) -> bool:
    """
    LinkedIn's relative post timestamps ('10h', '2d', '1w', '3mo', '1yr').
    Treated as "recent" within roughly the last two months -- hours, days,
    and weeks are always recent; months only up to 2; years never.
    """
    if not text:
        return False
    match = _RELATIVE_TIME_RE.match(text.strip())
    if not match:
        return False
    value, unit = int(match.group(1)), match.group(2)
    if unit in ("h", "d", "w"):
        return True
    if unit == "mo":
        return value <= 2
    return False  # "yr"


def _unwrap_redirect(href: str | None) -> str | None:
    """
    LinkedIn wraps outbound website links in its own redirect URL
    (linkedin.com/redir/redirect?url=<encoded target>&...) rather than
    linking the real site directly. Verified 2026-07-31 against Nike's real
    website link -- without this, the raw href saved would be LinkedIn's
    wrapper, not the business's actual site.
    """
    if not href:
        return None
    match = _REDIRECT_URL_RE.search(href)
    return unquote(match.group(1)) if match else href


def _parse_headcount(text: str | None) -> int | None:
    """
    LinkedIn shows headcount as a range like '51-200 employees' or an
    open-ended '10,001+ employees'. Genuinely tested below with real sample
    strings -- this parsing logic doesn't touch the live page, only the text
    once it's already been read.
    """
    if not text:
        return None
    numbers = re.findall(r"[\d,]+", text)
    if not numbers:
        return None
    # Take the lower bound of a range (or the '+' floor) as a conservative estimate.
    return int(numbers[0].replace(",", ""))


def _safe_text(locator) -> str | None:
    """
    inner_text() waits for the element to be visible by default, which can
    hang for tens of seconds on hidden/off-screen matches (ad panels, footer
    links, related-page suggestions -- a real search page has plenty of
    `a[href*='linkedin.com/company/']` matches beyond the visible company
    cards). text_content() reads the DOM directly with no visibility wait,
    which is all this needs -- the caller only wants the link's text, not
    confirmation it's interactable.
    """
    try:
        text = locator.text_content(timeout=2_000)
        return text.strip() if text else None
    except Exception:  # noqa: BLE001 -- a missing element is expected, not exceptional
        return None


def _safe_attr(locator, attr: str) -> str | None:
    try:
        return locator.get_attribute(attr, timeout=2_000)
    except Exception:  # noqa: BLE001
        return None


# REMOVED 2026-09-13: has_message_button() used to run at discovery time
# to pre-reject a lead with no working Message button (added after
# TEAMWORK ENERGY failed at send time), but proved to have a ~25%
# false-reject rate on real, reachable companies (LebEx, Bilani
# Transportation, OPES Software, Arab Software Company) even after two
# rounds of tuning its render-wait timing -- the droplet's real CPU
# contention (see session.py's own comment on its 1.9GB RAM/1 vCPU
# constraint) makes a fixed client-side-render wait an unreliable signal.
# Owner's call: losing real leads to false rejects here is worse than a
# genuine no-button lead reaching send time, where
# linkedin_send.py's own NoMessageButtonAvailable is already caught
# cleanly (marks the send failed, doesn't crash) and the owner can now see
# the SPECIFIC reason in the Approval queue rather than a generic
# "Failed" -- see outreach-approvals.ts's own comment on sendStatusReason.
