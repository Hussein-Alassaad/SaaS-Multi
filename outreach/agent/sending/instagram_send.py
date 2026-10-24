"""
Sends messages on Instagram via the account's own session -- both the
AI-prepared first cold message (approved by a human on the "Instagram"
dashboard page) and replies (typed by a human on "Reply Here").

============================================================================
NOT YET LIVE-VERIFIED -- built against Instagram's known/publicly-documented
DOM structure, same first-pass approach linkedin_send.py originally took
before ITS live verification (see that module's own docstring history).
Every selector below is a reasonable inference, not a confirmed one --
WATCH THIS CLOSELY against a real connected test account before trusting
either path (cold send or reply) unattended, same caution this codebase
applies to every other browser-automation module. Expect to find and fix
real selector mismatches on the first live run, same as
sending/linkedin_reply_check.py's own docstring documents happening there
three separate times.

DELIBERATE PRODUCT DECISION (not a default): earlier versions of this
codebase kept ALL Instagram sending manual (human opens the real app,
copy-pastes, sends) specifically because automating unsolicited cold DMs is
Instagram's highest-risk automation pattern for a ban. This module changes
that -- both the cold message AND replies are now agent-delivered, so the
account is never touched from a different location/IP than the agent's own
consistent proxy. That tradeoff (automation risk vs. location-consistency
risk) was made explicitly by the platform owner, not assumed by this code.
============================================================================

APPROACH: mirrors linkedin_send.py's shape closely --
  - send_cold_message(): opens the lead's profile_url, clicks Message,
    types, sends. This is the ORIGINAL AI-prepared message -- a human still
    approves it (Approval Queue / Instagram dashboard page), this module
    only replaces the "you copy-paste it by hand" step with "the agent
    performs the actual send."
  - send_reply(): opens the existing DM thread (matched by business_name,
    same approach as linkedin_reply_check.py's _open_thread_for_lead) and
    sends into it.
"""

from __future__ import annotations

import datetime as dt

from playwright.sync_api import Page

from agent.core.pacing import human_delay, human_type
from agent.core.session import SessionManager
from agent.crm import pipeline
from agent.db import repositories as repo
from agent.messaging import approval
from agent.sending import attachments
# Shared, single definition of "has the send click already happened, and what
# is safe to write to the DB afterwards" -- see sending/delivery.py's own
# module docstring for the real double-send vectors these close. Imported
# rather than duplicated so no channel can drift away from the one invariant
# the owner is emphatic about: a delivered message is never sent twice.
from agent.sending.delivery import Delivery, settle_after_failure

INSTAGRAM_INBOX_URL = "https://www.instagram.com/direct/inbox/"
_HOME_URL = "https://www.instagram.com/"

# LIVE-CONFIRMED 2026-09-06: the original substring selector
# ("div[role='button']:has-text('Message')") matched the wrong element --
# Instagram's own top-nav Messages/DM-inbox icon renders as
# div[role='button'] with text "1\nMessages" (unread badge + label), which
# is a substring superset of "Message" and appears EARLIER in DOM order
# than the real per-profile Message button, so .first grabbed the nav icon
# every time. Real profile page dump (hussein._.alassaad, 994 followers):
# the genuine button is div[role='button'] with EXACT text "Message",
# scoped inside <header>, sitting alongside "Follow" as sibling buttons --
# scoping to header AND requiring an exact text match (not substring) is
# what actually disambiguates it from the nav icon.
_PROFILE_MESSAGE_BUTTON_SELECTOR = "header div[role='button']:text-is('Message')"

# LIVE-CONFIRMED 2026-09-06: the original selector assumed the composer
# would carry an aria-label or placeholder -- the real element has NEITHER
# (page dump: div[contenteditable='true'] with no aria-label, no
# placeholder, no other identifying attribute). It's the ONLY
# contenteditable element on the page once the DM panel is open (confirmed:
# exactly 1 match), so matching plain contenteditable=true is sufficient
# and more robust than guessing at attributes Instagram doesn't actually
# set.
_COMPOSER_SELECTOR = "div[contenteditable='true']"
# LIVE-CONFIRMED 2026-09-06: there is no text-labeled Send button at all --
# the real control is an icon-only paper-plane button, an
# svg[aria-label='Send'] nested inside the clickable element. Playwright
# resolves a click on the svg to its actual pointer target automatically
# (same as clicking any nested icon), so targeting the svg directly is
# reliable and doesn't depend on guessing the wrapping element's tag/role.
_SEND_BUTTON_SELECTOR = "svg[aria-label='Send']"
# NOT yet live-verified -- Instagram's DM composer attach/media picker,
# same inference approach as _COMPOSER_SELECTOR above.
_ATTACHMENT_BUTTON_SELECTOR = "svg[aria-label='Attach a photo or video'], div[role='button'][aria-label*='attach' i]"

# LIVE-CONFIRMED 2026-09-06: the inbox's conversation rows carry NO
# role='listitem' anywhere in the DOM (confirmed: 0 matches on a real
# inbox with several real threads visible) -- the actual clickable row is
# 10 ancestor levels up from the name text, a div[role='button'] with
# tabindex='0'. Matched by visible text the same way
# linkedin_reply_check.py matches business_name, since Instagram's own
# conversation-list DOM has no stable per-thread identifier exposed
# either.
CONVERSATION_LIST_ITEM_SELECTOR = "div[role='button']"


# ADDED 2026-10-14. ROOT CAUSE of the "Locator.click: Timeout 10000ms exceeded" errors on older chats (MOPIVU, La Vie
# Restaurant & Venue, Voltmax, Franco Banetti, Engineering guru, Factories with Mahdi -- the same ones on every poll):
# Instagram's inbox list is VIRTUALIZED. Only ~10 rows exist in the page at a time; older chats are not in the DOM at all
# until you scroll to them, and scrolling recycles the rows again. Live-confirmed 2026-10-14: at the top of the inbox
# "MOPIVU" matched 0 elements, after a few scroll steps it matched 1, and two steps later it was gone again. The old code
# waited for the row, then clicked it a moment later -- by which time the row had been recycled, so the click timed out
# (twice, on a fresh page load each time, which is why retrying never helped). Fix: scroll the list like a person would
# and click the moment the row is on screen, in one step, so there is no gap for the row to disappear in.
_LIST_SCROLL_X, _LIST_SCROLL_Y = 270, 600  # inside the conversation list column
_LIST_SCROLL_STEP_PX = 600
_MAX_LIST_SCROLL_STEPS = 45
_LIST_SCROLL_WAIT_MS = 1_200


def _visible_rows_signature(page: Page) -> str:
    """The text of the rows currently on screen -- used to notice when scrolling stops changing anything (end of list)."""
    try:
        return str(page.evaluate(
            """() => Array.from(document.querySelectorAll("div[role='button']"))
                .filter(e => e.getBoundingClientRect().height > 50)
                .map(e => (e.innerText || '').slice(0, 40)).join('|')"""
        ))
    except Exception:  # noqa: BLE001 -- a failed read just means "can't tell", scrolling carries on
        return ""


def click_conversation(page: Page, business_name: str) -> bool:
    """
    Scrolls the inbox list until the lead's row is on screen and clicks it immediately. True if it was clicked, False if
    the end of the list was reached without finding it (a real "no such chat", same meaning as before).
    """
    # The list needs a moment to render at all; wait for any row (this is what the old per-lead wait_for also did).
    try:
        page.wait_for_selector(CONVERSATION_LIST_ITEM_SELECTOR, state="visible", timeout=15_000)
    except Exception:  # noqa: BLE001 -- an empty inbox / slow load: fall through, the loop below finds nothing and returns False
        pass
    unchanged = 0
    previous = None
    for step in range(_MAX_LIST_SCROLL_STEPS + 1):
        item = page.locator(CONVERSATION_LIST_ITEM_SELECTOR, has_text=business_name).first
        try:
            if item.is_visible():
                item.scroll_into_view_if_needed(timeout=3_000)
                item.click(timeout=3_000)
                return True
        except Exception:  # noqa: BLE001 -- the row was recycled between the check and the click; keep scrolling
            pass
        if step == _MAX_LIST_SCROLL_STEPS:
            break
        signature = _visible_rows_signature(page)
        unchanged = unchanged + 1 if signature == previous else 0
        if unchanged >= 3:
            break  # three scrolls in a row showed the same rows: that is the end of the list
        previous = signature
        page.mouse.move(_LIST_SCROLL_X, _LIST_SCROLL_Y)
        page.mouse.wheel(0, _LIST_SCROLL_STEP_PX)
        page.wait_for_timeout(_LIST_SCROLL_WAIT_MS)
    return False


class NoMessageButtonAvailable(RuntimeError):
    """
    Raised when a lead's Instagram profile has no reachable Message action
    (private account with no accepted follow, business account with DMs
    restricted, etc.) -- a normal, expected "can't send this way" outcome,
    same treatment as linkedin_send.py's identically-named exception.
    """


class NoExistingThread(RuntimeError):
    """
    Raised when a reply is queued for a lead with no existing Instagram DM
    thread to reply into -- same normal-outcome treatment as
    linkedin_send.py's NoExistingThread.
    """


class SessionLoggedOut(RuntimeError):
    """
    Raised when a saved session is no longer actually authenticated on
    Instagram's side -- see linkedin_send.py's identically-named exception
    for the full reasoning (same real gap, same fix, both channels hit it
    live the same night).
    """


def _raise_if_logged_out(page: Page, account: dict) -> None:
    """
    LIVE-CONFIRMED 2026-09-06: a genuinely logged-out Instagram session
    redirects any real navigation to /accounts/login/ -- this is what
    actually caught MJivity's Instagram account tonight (URL observed:
    .../accounts/login/?next=...%2Fdirect%2Finbox%2F...). Unlike LinkedIn's
    company-page case, no separate "no redirect, just different chrome"
    behavior has been observed for Instagram profile/inbox URLs, but this
    is intentionally still a small, single-purpose check (not folded into
    a shared cross-platform helper) in case that turns out to differ by
    URL shape the same way LinkedIn's did.

    REAL BUG FOUND AND FIXED 2026-10-04: a THIRD, distinct URL pattern --
    /auth_platform/logged_in_redirect/...?...__coig_challenge_redirected=1
    -- is Instagram's own account-level security checkpoint, not a plain
    logout. LIVE-CONFIRMED on Insurance Instagram: every single page
    (hashtag search, the bare homepage, even a random profile) redirected
    through this exact pattern, and _discover_instagram's own loop had no
    way to tell "this account is checkpointed" apart from "this hashtag
    genuinely has zero posts" -- it burned all 16 search rounds (~30+
    minutes) retrying different hashtags against a fully blocked account
    before giving up with 0 found, 0 saved. Caught here the same way the
    plain-logout case is, so callers (including discovery, once wired in)
    get the same clear SessionLoggedOut signal instead of a silent
    zero-results result that looks identical to an honest weak night.
    """
    if "/accounts/login" in page.url:
        repo.update_account(account["id"], {"login_status": "failed", "login_error": "Session logged out on Instagram -- reconnect via the extension."})
        raise SessionLoggedOut(
            f"Account {account.get('label') or account['id']} is no longer logged in on Instagram "
            f"(redirected to {page.url})."
        )
    # ADDED 2026-10-24, real incident: after one test send Instagram started redirecting every page of the Website Offer account to
    # /accounts/suspended/ ("Confirm you're human to use your profile"). This check did not know that URL, so each of the next 9 sends
    # looked like "no reachable Message button", was marked failed for good, and the account kept being hit for over an hour. Now it is
    # a checkpoint like the one below, AND the account is paused on the spot so nothing else opens a session on it.
    if any(marker in page.url for marker in ("/accounts/suspended", "/accounts/disabled", "/challenge/")):
        repo.update_account(account["id"], {
            "login_status": "failed",
            "login_error": "Instagram is asking this account to confirm it is human (suspended/challenge page) -- clear it on a real device first.",
            "status": "paused",
            "warning_type": "challenge",
            "warning_reason": "Instagram showed a human-verification / suspended page. The agent paused this account; resume only after the owner has cleared it.",
        })
        raise SessionLoggedOut(
            f"Account {account.get('label') or account['id']} is on Instagram's human-verification page "
            f"(redirected to {page.url}); the account was paused."
        )
    if "coig_challenge_redirected" in page.url or "/auth_platform/" in page.url:
        repo.update_account(account["id"], {"login_status": "failed", "login_error": "Instagram served a security checkpoint on this account -- clear it by logging in directly on a real device, then reconnect via the extension."})
        raise SessionLoggedOut(
            f"Account {account.get('label') or account['id']} hit an Instagram security checkpoint "
            f"(redirected to {page.url})."
        )


def send_cold_message(message: dict) -> dict:
    """
    Sends the AI-prepared first message to a lead's Instagram profile.
    Human-approved content (Approval Queue), agent-performed delivery --
    see module docstring for why this replaced the old copy-paste-by-hand
    flow. Mirrors linkedin_send.send_message()'s bookkeeping exactly:
    send_status/sent_at/sent_via_account, contact_count/first_contacted_at,
    the pipeline move to "contacted", client_history.
    """
    lead = repo.get_lead(message["lead_id"])
    if not lead or not lead.get("profile_url"):
        raise ValueError(f"Message {message['id']} has no lead profile_url to send to.")

    body = approval.active_body(message)
    account = repo.get_account(lead["account_id"])
    if not account:
        raise ValueError(f"Lead {lead['id']} has no owning account to send from.")

    # Claimed BEFORE the real send attempt, not after -- see
    # repo.claim_message_for_sending's own docstring for the duplicate-send
    # bug this closes (a crash between a successful real send and the old
    # after-the-fact "sent" write would leave the row looking untouched, and
    # the next cycle would send it again for real).
    if repo.claim_message_for_sending(message["id"]) is None:
        raise ValueError(f"Message {message['id']} is no longer pending -- already claimed or sent.")

    delivery = Delivery()
    try:
        with SessionManager() as sessions:
            context, page, new_verified_ip = sessions.open(account)
            if new_verified_ip and not account.get("verified_proxy_ip"):
                repo.update_account(account["id"], {"verified_proxy_ip": new_verified_ip})
            try:
                page.goto(lead["profile_url"], timeout=30_000, wait_until="domcontentloaded")
                _raise_if_logged_out(page, account)
                _send_from_profile(page, lead, body, delivery)
            finally:
                sessions.close(account["id"], context)
    except NoMessageButtonAvailable as exc:
        # PERMANENT failure -- see linkedin_send.py's identical handler for
        # the full reasoning. A lead with no reachable Message button will
        # never grow one on a later retry, so this is marked "failed" with
        # a persisted reason instead of silently reset to "pending" forever.
        # Raised strictly before any send click, so the delivered guard below
        # is belt-and-braces, not expected to fire.
        if delivery.delivered:
            settle_after_failure(message, delivery, exc, channel="instagram")
        else:
            repo.update_message(message["id"], {
                "send_status": "failed",
                "send_failure_reason": str(exc),
            })
        raise
    except Exception as exc:
        # The real send attempt failed -- release the claim back to 'pending'
        # ONLY if the send click provably never happened. This try block also
        # encloses sessions.close(), which runs AFTER the click and can raise;
        # resetting a delivered message here re-sent it for real next cycle.
        # See linkedin_send.Delivery for the full write-up.
        settle_after_failure(message, delivery, exc, channel="instagram")
        raise

    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    updated_message = repo.update_message(message["id"], {
        "send_status": "sent",
        "sent_at": now_iso,
        "sent_via_account": account["id"],
    })

    contact_updates = {"contact_count": (lead.get("contact_count") or 0) + 1}
    if not lead.get("first_contacted_at"):
        contact_updates["first_contacted_at"] = now_iso
    repo.update_lead(message["lead_id"], contact_updates)

    pipeline.move_stage(message["lead_id"], "contacted", changed_by="agent")
    repo.mark_client_history_contacted(message["lead_id"])

    return updated_message


def send_reply(message: dict) -> dict:
    """
    Delivers a tenant-written reply into the lead's existing Instagram DM
    thread. Does NOT touch contact_count/first_contacted_at/pipeline stage
    -- those already happened on the original cold send; see
    linkedin_send.send_reply()'s docstring for the identical reasoning.

    Handles message["attachment_url"] the same way linkedin_send.send_reply()
    does -- download to temp file, attach via Instagram's own file-picker
    button before typing the body, clean up after. Attachment-picker
    selector is NOT yet live-verified.
    """
    lead = repo.get_lead(message["lead_id"])
    if not lead:
        raise ValueError(f"Message {message['id']} has no lead to send to.")

    business_name = lead.get("business_name") or ""
    body = approval.active_body(message)
    attachment_url = message.get("attachment_url")
    attachment_path = None
    account = repo.get_account(lead["account_id"])
    if not account:
        raise ValueError(f"Lead {lead['id']} has no owning account to send from.")

    # REAL DOUBLE-SEND VECTOR, found and fixed 2026-09-16 -- see
    # linkedin_send.send_reply()'s identical claim for the full write-up
    # (same bug, both reply paths, same fix): this function had NO claim at
    # all and wrote 'sent' only after the send click, so any failure after
    # delivery left the row at 'pending' for repo.replies_pending() to
    # re-select on the ~3-minute reply poll, unbounded by the daily cap.
    if repo.claim_message_for_sending(message["id"]) is None:
        raise ValueError(f"Message {message['id']} is no longer pending -- already claimed or sent.")

    delivery = Delivery()
    try:
        if attachment_url:
            attachment_path = attachments.download_attachment(attachment_url, message.get("attachment_name"))

        # LIVE-CONFIRMED 2026-09-06: the inbox list row shows the person's
        # DISPLAY NAME ("Hussein Alassaad"), not their @handle
        # ("hussein._.alassaad") -- confirmed live: filtering by the
        # display name matched the real row (count=1), filtering by the
        # handle parsed from profile_url matched nothing (count=0). An
        # earlier version of this fix assumed the opposite and was wrong.
        # business_name is the best available proxy for the real display
        # name for a well-formed lead; fall back to the handle only if
        # business_name is empty, since some match is better than none.
        profile_url = lead.get("profile_url") or ""
        handle = profile_url.rstrip("/").rsplit("/", 1)[-1] if profile_url else ""
        match_text = business_name or handle

        with SessionManager() as sessions:
            context, page, new_verified_ip = sessions.open(account)
            if new_verified_ip and not account.get("verified_proxy_ip"):
                repo.update_account(account["id"], {"verified_proxy_ip": new_verified_ip})
            try:
                # Real, likely-contributing factor found 2026-09-07: every
                # send_reply() attempt tonight lost its session specifically
                # here, at the inbox -- send_cold_message()'s very similar
                # code (same SessionManager pattern, same account, same
                # night) never did, and its first navigation is to a public
                # PROFILE page, not straight into the messaging inbox. A
                # brand-new browser context whose very first request is
                # /direct/inbox/ has no browsing history at all before
                # hitting the platform's highest-risk-for-abuse surface --
                # not how a real person actually arrives at their DMs (home
                # feed first, at least a glance, then messages). Landing on
                # the home feed first and pausing before continuing to the
                # inbox is a real, structural difference from every attempt
                # that failed tonight, not a guaranteed fix -- flagged
                # honestly as NOT yet live-verified, since every account
                # available was already degraded by the time this was
                # written.
                page.goto(_HOME_URL, timeout=30_000, wait_until="domcontentloaded")
                _raise_if_logged_out(page, account)
                human_delay(1.5, 3.5)
                page.goto(INSTAGRAM_INBOX_URL, timeout=30_000, wait_until="domcontentloaded")
                _raise_if_logged_out(page, account)
                # Scrolls the (virtualized) inbox list to the chat and clicks it in one step -- see click_conversation().
                if not click_conversation(page, match_text):
                    raise NoExistingThread(
                        f"No existing Instagram conversation found for {match_text or lead.get('profile_url')}."
                    )

                box = page.locator(_COMPOSER_SELECTOR).first
                box.wait_for(state="visible", timeout=10_000)

                if attachment_path:
                    human_delay()
                    with page.expect_file_chooser() as fc_info:
                        page.locator(_ATTACHMENT_BUTTON_SELECTOR).first.click()
                    fc_info.value.set_files(str(attachment_path))
                    human_delay()

                if body:
                    human_delay()
                    human_type(box, body)
                human_delay()
                page.locator(_SEND_BUTTON_SELECTOR).first.click()
                # The reply is now out. Nothing below may ever cause a retry.
                delivery.mark()
            finally:
                sessions.close(account["id"], context)
    except Exception as exc:
        # Release the claim back to 'pending' ONLY if the send click provably
        # never happened -- sessions.close() and the attachment cleanup both
        # run after the click and both can raise. See linkedin_send.Delivery.
        if attachment_path:
            try:
                attachments.cleanup_attachment(attachment_path)
            except Exception:  # noqa: BLE001 -- a leftover temp file must never block the status write below
                pass
        settle_after_failure(message, delivery, exc, channel="instagram")
        raise
    # Deliberately not a `finally` any more -- a cleanup error on the success
    # path used to escape before the 'sent' write below, leaving a genuinely
    # delivered reply stuck at 'sending'.
    if attachment_path:
        try:
            attachments.cleanup_attachment(attachment_path)
        except Exception:  # noqa: BLE001
            pass

    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    return repo.update_message(message["id"], {
        "send_status": "sent",
        "sent_at": now_iso,
        "sent_via_account": account["id"],
    })


def _send_from_profile(page: Page, lead: dict, body: str, delivery: Delivery) -> None:
    # LIVE-CONFIRMED 2026-09-06: page.goto()'s wait_until="domcontentloaded"
    # fires as soon as the HTML skeleton parses, well before Instagram's
    # client-side JS has actually rendered the profile header -- an instant
    # .count() check right after navigation reads an empty page and always
    # raised NoMessageButtonAvailable, even though the real button appears
    # correctly within a couple seconds. wait_for() waits for the real
    # render instead of an arbitrary sleep, and still fails clearly (same
    # exception) if the button genuinely never shows up.
    message_button = page.locator(_PROFILE_MESSAGE_BUTTON_SELECTOR).first
    try:
        message_button.wait_for(state="visible", timeout=15_000)
    except Exception as exc:  # noqa: BLE001 -- Playwright's TimeoutError, re-raised as our own domain exception
        raise NoMessageButtonAvailable(
            f"{lead.get('business_name') or lead['profile_url']} has no reachable Message button on Instagram."
        ) from exc

    human_delay()
    message_button.click()
    box = page.locator(_COMPOSER_SELECTOR).first
    # REAL BUG FOUND AND FIXED 2026-10-01: the original 10s timeout here had
    # NO fallback at all (unlike the Message button's own 15s wait three
    # lines up, which at least raises a clear domain exception) -- a raw
    # Playwright TimeoutError propagated straight up and the whole send
    # attempt died. LIVE-CONFIRMED this was genuinely marginal, not a broken
    # selector: a direct live reproduction against a real profile (Nike)
    # through this exact account's own proxy found the Message
    # button/composer flow worked correctly end-to-end, just sometimes
    # needing closer to 15s for the DM panel's open animation to finish
    # rendering the composer -- this hit Insurance Instagram specifically
    # twice in one morning (two different real leads, both over a slower
    # residential-proxy connection than Zimmar's), while Zimmar's own sends
    # that same morning had no composer failures at all on the identical
    # code. Doubled the timeout to 20s (now the more generous of the two
    # waits in this function, matching the message button's own margin) AND
    # added one bounded retry -- a fresh click can nudge a panel that's
    # stuck mid-animation, cheap and safe since clicking an already-open
    # Message button a second time is a no-op on Instagram's real UI.
    try:
        box.wait_for(state="visible", timeout=20_000)
    except Exception:  # noqa: BLE001 -- Playwright's own TimeoutError, retried once below
        message_button.click()
        box.wait_for(state="visible", timeout=20_000)
    human_delay()
    human_type(box, body)
    human_delay()
    page.locator(_SEND_BUTTON_SELECTOR).first.click()
    # The message is now out. Nothing below this line may ever cause a retry.
    delivery.mark()
