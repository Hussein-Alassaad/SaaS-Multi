#!/usr/bin/env bash
#
# Deploy the Python agent to the droplet, correctly.
#
# WHY THIS EXISTS
# ---------------
# `docker restart nexaris-agent` does NOT pick up a newly built image. A
# container stays bound to the image it was CREATED from, so a rebuild plus a
# restart silently keeps running the old code -- no error, no warning, and the
# deploy looks completely successful. That happened for real on 2026-09-13:
# several rounds of discovery/qualification fixes were built into the image
# but never actually ran, which is why lead quality did not improve.
#
# The only correct sequence is: copy -> build -> RECREATE the container ->
# verify the new code is really loaded. This script does all four, refuses to
# continue if any step fails, and rolls back automatically if the new
# container does not come up healthy.
#
# Usage (from the outreach/ directory):
#   bash deploy.sh                 # deploy + verify
#   bash deploy.sh --verify-only   # just re-run the checks, change nothing
#
set -euo pipefail

DROPLET="root@159.89.101.209"
REMOTE_DIR="/root/nexaris-agent/outreach"
ENV_FILE="/root/nexaris-agent/.agent.env"
IMAGE="nexaris-agent:latest"
CONTAINER="nexaris-agent"
VOLUME="nexaris-browser-profiles"

say()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()   { printf '   \033[32mOK\033[0m   %s\n' "$*"; }
fail() { printf '   \033[31mFAIL\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------------------
# The verification block. Runs INSIDE the container, so it proves what the
# agent will actually execute -- not what is sitting on disk. Every check here
# corresponds to a real bug that was live in production at some point.
# ---------------------------------------------------------------------------
read -r -d '' VERIFY_PY <<'PYEOF' || true
import sys
from agent.discovery import linkedin, qualify, hunter, business_check
from agent import scheduler as sch
_real_classify = business_check.classify
business_check.classify = lambda p: None  # no live API calls in the regression suite; AI-gate tests below swap in fakes
from agent.core import session as sess
from agent.sending import linkedin_send, instagram_send, linkedin_reply_check, instagram_reply_check

failures = []
def check(label, cond):
    print(("   OK   " if cond else "   FAIL ") + label)
    if not cond:
        failures.append(label)

mj = ("GCC (UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman), Egypt, Lebanon, "
      "MENA region, United States, United Kingdom, Canada, Europe")

# A tenant's long multi-region targeting policy must never be pasted into the
# LinkedIn keyword box -- it matches nothing.
check("long multi-region location kept out of search keywords",
      "Saudi" not in linkedin.build_search_url("software", mj, "", ["51-200"]))
check("Lebanon resolves to the verified geo facet",
      "companyHqGeo" in linkedin.build_search_url("trading", "Lebanon", "", ["11-50"]))
check("company size facet is applied",
      "companySize" in linkedin.build_search_url("trading", "Lebanon", "", ["11-50"]))

# A tenant must never reject the markets it actually targets.
check("MJivity target cities are not treated as foreign",
      all(sch._mentions_foreign_location(b, mj) is None for b in
          ["agency in Dubai", "studio in London", "Toronto consultancy",
           "New York agency", "team in Berlin", "Paris design house"]))
check("Indian locations rejected for a Lebanon tenant",
      all(sch._mentions_foreign_location(b, "Lebanon") for b in
          ["CCTV in Kochi, Kerala", "Bengaluru startup", "office in Noida",
           "Gurugram IT", "Ahmedabad, Gujarat"]))
check("Lebanese locations accepted for a Lebanon tenant",
      all(sch._mentions_foreign_location(b, "Lebanon") is None for b in
          ["company in Beirut", "Jounieh Lebanon", "Tripoli manufacturer"]))

# This constant, applied to LinkedIn, silently became an EMPLOYEE floor and
# rejected the entire 51-99 band -- exactly Insurance's target.
check("no LinkedIn follower floor (it was really an employee floor)",
      not hasattr(qualify, "MIN_LINKEDIN_FOLLOWERS_HARD"))

def profile(**kw):
    p = dict(display_name="Acme Trading SAL",
             bio="We import and distribute industrial equipment across Lebanon since 1998.",
             has_website=True, post_count=6, recent_activity=True,
             follower_or_headcount=None, platform="linkedin")
    p.update(kw)
    return p

check("LinkedIn 11-400 employee range all qualifies",
      all(qualify.qualify_profile(profile(follower_or_headcount=h), "trading")[0]
          for h in [11, 25, 51, 75, 99, 150, 400]))

def ig(followers):
    return qualify.qualify_profile(profile(
        platform="instagram", display_name="Beirut Home Decor",
        bio="Furniture showroom in Beirut. Delivery across Lebanon. Shop now.",
        follower_or_headcount=followers, post_count=40), "furniture")[0]

# OWNER REQUEST 2026-10-07: Instagram qualification was stripped down to
# two questions only -- foreign evidence, and personal-account -- so the
# follower-count floor no longer applies there at all (see
# discovery/qualify.py's own 2026-10-07 comment on qualify_profile's new
# Instagram branch). A real Lebanese business's follower count, post
# count, website, and bio content no longer disqualify it on Instagram.
check("Instagram no longer has a follower-count floor (owner request 2026-10-07: simplified to foreign-evidence + personal-account only)",
      ig(90) and ig(299) and ig(300) and ig(1200))

# Quality gates the owner asked for: no posts / no presence / dormant --
# LINKEDIN ONLY as of 2026-10-07 (Instagram's own equivalents were removed
# the same day as the follower-floor above, same reasoning).
#
# OWNER DECISION 2026-10-04: the zero-post hard reject is LinkedIn-ONLY of
# the two original candidates -- a real LinkedIn company page is routinely
# maintained by someone who never posts on it, and two consecutive weak
# discovery nights (Zimmar 0/96, Insurance 1 saved) had this hard reject as
# the single most common rejection reason on BOTH platforms. A LinkedIn
# zero-post page still carries the existing -2 SOFT score penalty, it just
# no longer gets thrown out outright for that one signal alone.
check("zero-post Instagram page is NO LONGER hard-rejected (owner request 2026-10-07: simplified to foreign-evidence + personal-account only)",
      qualify.qualify_profile(profile(platform="instagram", display_name="Beirut Home Decor", bio="Furniture showroom in Beirut. Delivery across Lebanon.", post_count=0, recent_activity=False, follower_or_headcount=1000), "")[0])
check("zero-post LinkedIn page no longer carries the hard-reject reason (2026-10-04 owner decision)",
      not any("Hard reject: 0 posts" in r for r in qualify.qualify_profile(profile(platform="linkedin", post_count=0, recent_activity=False), "")[1]))
# ADDED 2026-10-09: AI "is this a Lebanese business" gate on Instagram.
_ig = dict(platform="instagram", display_name="Beirut Home Decor", bio="Furniture showroom in Beirut. Delivery across Lebanon.", post_count=40, recent_activity=True, follower_or_headcount=5000, handle="someaccount")
business_check.classify = lambda p: (False, "travel page: content page about Lebanon, not a business")
_ok, _why = qualify.qualify_profile(profile(**_ig), "")
check("Instagram candidate the AI confidently calls NOT a Lebanese business is rejected, with the AI reason recorded",
      (not _ok) and any("AI check" in r and "travel page" in r for r in _why))
business_check.classify = lambda p: None
check("Instagram candidate the AI is unsure about (None) is KEPT -- fail-open, no repeat of the 6-of-167 collapse",
      qualify.qualify_profile(profile(**_ig), "")[0])
def _boom(p): raise RuntimeError("api down")
business_check.classify = _real_classify
_orig_call = business_check.claude_client.call_json
business_check.claude_client.call_json = lambda *a, **k: _boom(None)
import inspect
_fail = business_check.classify(dict(_ig))
check("when the AI call fails, a clearly Lebanese business is still accepted by the strict rule-based fallback (a night is no longer lost to an empty API balance)",
      business_check.REJECT_ON_FAILURE is True and _fail is not None and _fail[0] is True and _fail[1].startswith("rule-based"))
business_check._ai_down_until = 0
_bad = business_check.classify(dict(_ig, display_name="Lebanon Explorer", bio="Travel guide to Lebanon", handle="lebanon_explorer"))
check("...while a creator / travel page is still rejected by the fallback", _bad is not None and _bad[0] is False)
business_check._ai_down_until = 0
_thin = business_check.classify(dict(_ig, display_name="Sunny Page", bio="hello world", handle="sunny"))
check("...and an account with no Lebanese evidence is rejected by the fallback", _thin is not None and _thin[0] is False and "Lebanese" in _thin[1])
business_check._ai_down_until = 0
_foreign = business_check.classify(dict(_ig, display_name="Madrid Furniture Showroom", bio="Furniture showroom in Madrid", handle="madridfurniture"))
check("...and a foreign business is rejected by the fallback", _foreign is not None and _foreign[0] is False)
business_check._ai_down_until = 0
_orig_text = business_check.claude_client.call_text
business_check.claude_client.call_text = lambda *a, **k: _boom(None)
check("is_available() is False when the API cannot be reached, and discovery then RUNS on the rule-based fallback instead of skipping the night",
      business_check.is_available() is False and "is_available()" in inspect.getsource(sch._discover_instagram)
      and "rule-based fallback" in inspect.getsource(sch._discover_instagram) and "raise RuntimeError" not in inspect.getsource(sch._discover_instagram))
business_check.claude_client.call_text = _orig_text
business_check.claude_client.call_json = lambda *a, **k: {"verdict": "no", "category": "creator", "reason": "vlogger"}
_v = business_check.classify(dict(_ig))
check("a confident 'no' verdict from the model is returned as a rejection", _v is not None and _v[0] is False)
business_check.claude_client.call_json = lambda *a, **k: {"verdict": "unsure", "category": "?", "reason": "thin bio"}
_uns = business_check.classify(dict(_ig))
check("an 'unsure' verdict IS a rejection now (owner: must be qualified Lebanese businesses), while an API failure is still kept",
      business_check.REJECT_UNSURE is True and _uns is not None and _uns[0] is False)
business_check.claude_client.call_json = lambda *a, **k: {"verdict": "yes", "category": "agency", "reason": "Lebanese agency"}
_yes = business_check.classify(dict(_ig))
check("a 'yes' verdict is returned as a confirmed business, not a rejection", _yes is not None and _yes[0] is True)
business_check.claude_client.call_json = _orig_call
check("Instagram handle with a foreign country suffix (.bh / .ly) is rejected without any AI call",
      all(not qualify.qualify_profile(profile(**{**_ig, "handle": h}), "")[0] for h in ("mirrormedia.bh", "pro_media.ly", "agency.ae")))
business_check.classify = lambda p: None  # these two tests are about the suffix rule, not the AI call
check("Instagram handle ending in .lb (Lebanon) is NOT rejected by the suffix rule",
      qualify.qualify_profile(profile(**{**_ig, "handle": "waredmedialb.lb"}), "")[0])
check("plain handles with no country suffix are not rejected by the suffix rule",
      qualify.qualify_profile(profile(**{**_ig, "handle": "oradigitalmedia"}), "")[0])
# ADDED 2026-10-09: Instagram search efficiency (owner: "guarantee 15/day, search well").
import inspect
check("a no-sector tenant's first Instagram term is anchored to its target country (#engineeringlebanon, not global #engineering)",
      sch._instagram_search_terms("engineering", [], True, "Lebanon")[0] == "engineering lebanon")
_first, _pool = sch._instagram_search_terms("media", None, True, "Lebanon, UAE")
check("the rotation pool mixes country-anchored industry tags with the curated Lebanese business tags",
      "automotive lebanon" in _pool and "made in lebanon" in _pool and not any("," in t for t in _pool))
check("a tenant WITH its own sector terms (MJivity) is left exactly as before",
      sch._instagram_search_terms("jewelry", ["jewelry", "cosmetics"], True, "Lebanon") == ("jewelry", ["jewelry", "cosmetics"]))
check("a tenant with a real configured niche is left exactly as before",
      sch._instagram_search_terms("bakery", None, False, "Lebanon") == ("bakery", None))
check("a term already naming the country is not double-anchored",
      sch._instagram_search_terms("lebanon food", [], True, "Lebanon")[0] == "lebanon food")
_f_dead, _p_dead = sch._instagram_search_terms("pharmaceutical", [], True, "Lebanon")
check("tags verified dead on Instagram are never used as the first term or in the rotation pool",
      "pharmaceutical" not in _f_dead and not any(x.startswith(("pharmaceutical", "general trading", "general commercial", "consulting ")) for x in _p_dead))
_f_j, _p_j = sch._instagram_search_terms("media", [], True, "Lebanon")
check("junk-prone abstract-sector tags (media/advertising/banking/telecommunications/education) are never used as the first term or in the pool",
      _f_j != "media lebanon"
      and not any(x in _p_j for x in ("media lebanon", "advertising lebanon", "banking lebanon", "telecommunications lebanon", "education lebanon"))
      and "automotive lebanon" in _p_j and "technology lebanon" in _p_j)
_src = inspect.getsource(sch._discover_instagram)
check("Instagram discovery rejects foreign-suffix handles BEFORE paying for a profile visit",
      "_foreign_handle_suffix(handle)" in _src and _src.index("_foreign_handle_suffix(handle)") < _src.index("instagram.extract_profile(page)"))
check("Instagram discovery abandons a hashtag after repeated zero-save profile visits",
      "_TAG_ABANDON_AFTER_VISITS" in _src and sch._TAG_ABANDON_AFTER_VISITS == 6)
check("Instagram discovery carries a short night's gap into the next night's target (capped), skipped during warm-up",
      "count_account_leads_between" in _src and sch._MAX_SHORTFALL_CARRY == 0 and "ig_daily_limit" in _src
      and callable(sch.repo.count_account_leads_between))
check("the save loop stops at the carried-forward target, not the bare daily limit",
      _src.count('counts["instagram_saved"] >= target') >= 2 and 'counts["instagram_saved"] >= limit' not in _src)
business_check.classify = lambda p: (True, "agency: Lebanese agency")
_ok_c, _why_c = qualify.qualify_profile(profile(**_ig), "")
check("a confident 'yes' is recorded as CONFIRMED in the lead's notes", _ok_c and any("confirmed Lebanese business" in r for r in _why_c))
business_check.classify = lambda p: None
_ok_u, _why_u = qualify.qualify_profile(profile(**_ig), "")
check("an unsure/failed AI answer is recorded as UNSURE (kept), distinguishable from confirmed", _ok_u and any("unsure or unavailable" in r for r in _why_u))
_dm_calls = []
business_check.classify = lambda p: _dm_calls.append(1)
_ok_dm, _why_dm = qualify.qualify_profile(profile(**{**_ig, "can_message": False}), "")
check("an Instagram account with no Message button is rejected, and the AI is not even called", (not _ok_dm) and not _dm_calls and any("Message button" in r for r in _why_dm))
business_check.classify = lambda p: None
check("can_message=None (could not tell) does NOT reject -- fail-open", qualify.qualify_profile(profile(**{**_ig, "can_message": None}), "")[0])
check("can_message=True is kept", qualify.qualify_profile(profile(**{**_ig, "can_message": True}), "")[0])
_cap_seen = []
business_check.claude_client.call_json = lambda s, u, m, max_tokens=0: (_cap_seen.append(u), {"verdict": "unsure"})[1]
business_check.classify = _real_classify
business_check.classify(dict(_ig, sample_caption="Fresh bread baked daily in Beirut"))
check("the AI business check is given the post caption as context", any("Fresh bread baked daily in Beirut" in u for u in _cap_seen))
business_check.claude_client.call_json = _orig_call
business_check.classify = lambda p: None
_dsrc = inspect.getsource(sch._discover_instagram)
check("Instagram discovery probes the Message button and captures the caption on each profile it visits",
      "_profile_has_message_button(page)" in _dsrc and "extract_post_caption(page)" in _dsrc)
import datetime as _qdt
def _bt(h, m): return _qdt.datetime(2026, 10, 10, h, m)
check("the hourly reply poll SKIPS during the sending window and the 20 min before it (06:10-12:59)",
      all(sch._reply_poll_should_skip(_bt(h, m)) for h, m in ((6, 10), (7, 20), (8, 11), (10, 0), (12, 29), (12, 44))))
check("the hourly reply poll SKIPS during the discovery window and the 40 min before it (17:20-04:00, including after midnight)",
      all(sch._reply_poll_should_skip(_bt(h, m)) for h, m in ((17, 20), (18, 3), (21, 0), (23, 59), (0, 30), (3, 59))))
check("the hourly reply poll still RUNS in the free gaps (04:00-06:09 and 13:20-17:19 when no sending cycle is running)",
      not any(sch._reply_poll_should_skip(_bt(h, m)) for h, m in ((4, 0), (5, 30), (6, 9), (13, 20), (14, 0), (15, 55), (16, 30), (17, 19))))
check("the hourly reply poll SKIPS from the morning sending straight through to the Website Offer sending start (06:10-13:19)",
      all(sch._reply_poll_should_skip(_bt(h, m)) for h, m in ((12, 45), (12, 59), (13, 0), (13, 15), (13, 19))))
sch._sending_cycles_running = 1
check("the hourly reply poll SKIPS for as long as a sending cycle is really running, at any hour (the Website Offer window is 13:00-17:50)",
      all(sch._reply_poll_should_skip(_bt(h, m)) for h, m in ((14, 30), (15, 55), (16, 30), (17, 10))))
sch._sending_cycles_running = 0
_orig_inner_send = sch._run_account_sending_cycle
def _boom_send(*a, **k): raise RuntimeError("boom")
sch._run_account_sending_cycle = _boom_send
try:
    sch.run_account_sending_cycle("t", "a")
except RuntimeError:
    pass
sch._run_account_sending_cycle = _orig_inner_send
check("a finished or crashed sending cycle gives the browser back to the reply poll (counter released)",
      sch._sending_cycles_running == 0 and not sch._reply_poll_should_skip(_bt(15, 30)))
check("run_reply_detection_poll can still be forced past the quiet windows",
      "force" in inspect.signature(sch.run_reply_detection_poll).parameters)
# ADDED 2026-10-10: Instagram-only, 08:00-11:50 sending.
check("Zimmar's sending window is 06:30 to 12:50 Beirut (owner 2026-10-17), before Website Offer's 13:00 start",
      sch._SENDING_WINDOW_START_MINUTES == 6 * 60 + 30 and sch._SENDING_WINDOW_END_MINUTES == 12 * 60 + 50
      and sch._SENDING_WINDOW_END_MINUTES < sch._WEBSITE_SENDING_WINDOW_START_MINUTES)
_zlatest = 6 * 60 + 30 + sch._RUN_TIME_JITTER_MINUTES
check("30 new + 20 follow-ups = 50 sends: 49 gaps at the 6-minute minimum fit between the latest start (06:45) and 12:50",
      49 * sch._SEND_GAP_MIN_SECONDS <= (sch._SENDING_WINDOW_END_MINUTES - _zlatest) * 60)
_fl_orig = sch.repo.get_settings
sch.repo.get_settings = lambda tid=None: {"business_name": {"z": "Zimmar", "w": "Website Offer"}.get(tid, "Other")}
check("the Instagram follow-up cap is 5/day for Zimmar and Website Offer, 15 for every other campaign, separate from the new-lead cap",
      sch._instagram_followup_limit("z") == 5 and sch._instagram_followup_limit("w") == 5 and sch._instagram_followup_limit("x") == 15
      and sch._INSTAGRAM_FOLLOWUP_DAILY_LIMIT == 15)
sch.repo.get_settings = _fl_orig
check("30 cold sends at the longest gap (29 gaps) fit between the latest start (06:45) and the window end",
      29 * sch._SEND_GAP_MAX_SECONDS <= (sch._SENDING_WINDOW_END_MINUTES - _zlatest) * 60)
check("email messages are no longer generated (even for a lead with an email in its bio)",
      sch._EMAIL_OUTREACH_ENABLED is False
      and "_EMAIL_OUTREACH_ENABLED and" in inspect.getsource(sch._run_message_generation_cycle_for_tenant))
check("end-of-day recovery runs just after the window (12:55), nowhere near the 18:00 discovery start",
      sch._SENDING_RECOVERY_HOUR == 12 and sch._SENDING_RECOVERY_MINUTE == 55)
# ADDED 2026-10-11: follow-up dispatch.
from agent.crm import followup as _fu
_fjobs = [j for j in sch.build_daily_schedule().get_jobs() if j.id == "followup-dispatch-poll"]
check("a fast follow-up dispatcher job is scheduled (the button used to wait for the 00:30/07:00 pipeline)",
      len(_fjobs) == 1 and sch._FOLLOWUP_POLL_INTERVAL_MINUTES == 2)
check("follow-ups are written only 13:00-17:00 Beirut (every 2 min = up to 120 in the window), outside it the poll does nothing",
      sch._followup_dispatch_in_window(_bt(13, 0)) and sch._followup_dispatch_in_window(_bt(16, 59))
      and not sch._followup_dispatch_in_window(_bt(12, 59)) and not sch._followup_dispatch_in_window(_bt(17, 0))
      and not sch._followup_dispatch_in_window(_bt(3, 0)))
check("each follow-up tick writes at most ONE message (and stops after a single failure)",
      "limit=1" in inspect.getsource(sch.run_followup_dispatch_poll)
      and "limit is not None" in inspect.getsource(_fu.dispatch_due_followups))
check("follow-ups are only dispatched on Instagram (LinkedIn and email are off)", _fu._FOLLOWUP_CHANNELS == {"instagram"})
_dsrc2 = inspect.getsource(_fu.dispatch_due_followups)
check("dispatch cancels duplicate follow-ups and honors the max-contacts cap instead of generating a second message",
      "_has_open_followup_message" in _dsrc2 and "max_contacts_per_lead" in _dsrc2 and "_FOLLOWUP_CHANNELS" in _dsrc2)
# ADDED 2026-10-11: Zimmar follow-ups are a fixed "interested or not?" note.
from agent.messaging import generate as _gen
_fu_text = _gen._ZIMMAR_FOLLOWUP_TEMPLATE.format(greeting_name="Acme Trading")
check("the Zimmar follow-up is short (one greeting line and one small paragraph) and addresses the lead by name",
      _fu_text.startswith("Hi Acme Trading,") and len(_fu_text) < 120 and _fu_text.count("\n\n") == 1)
check("the Zimmar follow-up contains NO dashes of any kind (owner's instruction)",
      not any(c in _gen._ZIMMAR_FOLLOWUP_TEMPLATE for c in ("-", "\u2013", "\u2014", "\u2012")))
check("the Zimmar follow-up only asks whether they are interested: no website, security pitch, or 'circling back' wording",
      "interested" in _fu_text.lower()
      and not any(w in _fu_text.lower() for w in ("website", "circling", "network", "camera", "cctv", "security", "zimmar")))
check("generate_followup_message returns the fixed Zimmar text without calling the AI",
      "_ZIMMAR_FOLLOWUP_TEMPLATE.format" in inspect.getsource(_gen.generate_followup_message)
      and inspect.getsource(_gen.generate_followup_message).index("_ZIMMAR_FOLLOWUP_TEMPLATE.format") < inspect.getsource(_gen.generate_followup_message).index("claude_client.call_text"))
# ADDED 2026-10-11: the reply poll must never block sending/discovery.
check("a job waits up to 45 minutes for the browser slot instead of giving up after 5 (owner: when the reply check finishes, everything continues)",
      sess._GLOBAL_SESSION_LOCK_TIMEOUT_SECONDS == 45 * 60)
check("the reply poll's next hard stop is 06:25 before sending, 12:55 before the afternoon sending and 17:55 before discovery, rolling to tomorrow's 06:25",
      sch._reply_poll_deadline(_bt(4, 37)) == _bt(6, 25) and sch._reply_poll_deadline(_bt(6, 24)) == _bt(6, 25)
      and sch._reply_poll_deadline(_bt(6, 25)) == _bt(12, 55) and sch._reply_poll_deadline(_bt(12, 54)) == _bt(12, 55)
      and sch._reply_poll_deadline(_bt(13, 37)) == _bt(17, 55)
      and sch._reply_poll_deadline(_bt(17, 56)) == _qdt.datetime(2026, 10, 11, 6, 25))
check("every reply poll is bounded by that deadline and the Instagram check actually honors it between leads",
      "deadline_ts" in inspect.getsource(sch.run_reply_detection_poll)  # since 2026-10-15 handed to the isolated runner, which is also killed at the deadline
      and "time.time() >= deadline_ts" in inspect.getsource(instagram_reply_check.check_instagram_replies))
# ADDED 2026-10-12: analysis must not stall Instagram leads when the AI is down.
check("an AI outage (empty balance, bad key, unreachable) is recognised, an ordinary error is not",
      sch._is_ai_outage(RuntimeError("Your credit balance is too low to access the Anthropic API"))
      and not sch._is_ai_outage(ValueError("could not parse JSON")))
_asrc = inspect.getsource(sch._run_analysis_cycle_for_tenant)
check("analysis lets an Instagram lead continue unanalyzed during an AI outage (fixed templates need no analysis); other failures still skip the lead",
      '_is_ai_outage(exc)' in _asrc and 'lead.get("platform") == "instagram"' in _asrc and "continue" in _asrc)
# ADDED 2026-10-12: Zimmar's IT/technology "same domain" exclusion.
check("IT / tech / software / POS / computer companies are treated as Zimmar's competitors (TechVision-type accounts are never discovered)",
      all(sch._is_competitor("Zimmar", bio, None, lead_name=nm) for bio, nm in (
          ("IT solutions and CCTV", "TechVision Lb techvisionlb"),
          ("Hardware & Software development | Marketing", "Canard.tech canard.tech"),
          ("One Ecosystem. Powering businesses", "Hamster POS hamster_pos"),
          ("", "Atlas Computer Lebanon atlascomputer.lb"),
          ("Smart Solutions for Modern Businesses: Software, POS Systems", "BRAIN STORE brainstore.lb"),
          ("Web Development | SMM", "AXIS MEDIA axismediame"))))
check("real non-IT Lebanese businesses are NOT flagged as competitors",
      not any(sch._is_competitor("Zimmar", bio, None, lead_name=nm) for bio, nm in (
          ("FMCG distributor in Lebanon", "DSGGROUP dsg_grouplb"),
          ("Made in Lebanon energy drink", "TRIPLE WORLD triple.world"),
          ("Delivery all over Lebanon, premium packaging", "professional packaging one professionalpackagingone"),
          ("Shop anywhere, ship to Lebanon", "Wasel wasel_lb"),
          ("Franchiser of multiple brands in the region", "Calia Group calia.group"),
          ("Delivery to ALL LEBANON", "American Center Outlet americancenter_outlet"))))
check("the competitor rule is Zimmar-only: another tenant is unaffected by the IT markers",
      not sch._is_competitor("Some Other Tenant", "IT solutions", None, lead_name="TechVision"))
# ADDED 2026-10-12: AI competitor judgement + guards at every stage.
business_check._ai_down_until = 0
_seen_sys = []
business_check.claude_client.call_json = lambda s, u, m, max_tokens=0: (_seen_sys.append(s[0]["text"]), {"verdict": "yes", "competitor": True, "category": "IT company", "reason": "sells POS software"})[1]
_cv = _real_classify(dict(_ig, seller_domain="Zimmar sells IT and network security reviews."))
check("the AI check is told what the seller sells and rejects a company it flags as a competitor, even if it is a real Lebanese business",
      _cv is not None and _cv[0] is False and _cv[1].startswith("competitor") and "ALSO include a boolean field" in _seen_sys[-1])
_nc = _real_classify(dict(_ig))
check("without a seller description the competitor flag is not applied (other tenants unaffected)",
      _nc is not None and _nc[0] is True and "ALSO include a boolean field" not in _seen_sys[-1])
business_check.claude_client.call_json = _orig_call
business_check._ai_down_until = 0
check("Zimmar's seller description is wired into discovery and the bio is kept in the lead's notes for later re-checks",
      "seller_domain" in inspect.getsource(sch._save_if_qualified_with_reasons)
      and '" | Bio: "' in inspect.getsource(sch._save_if_qualified_with_reasons)
      and "zimmar" in sch._SELLER_DOMAIN_BY_BUSINESS)
check("a competitor is blocked at message-writing, at follow-up dispatch AND at send time",
      "_competitor_reason(lead)" in inspect.getsource(sch._run_message_generation_cycle_for_tenant)
      and "_competitor_reason(repo.get_lead" in inspect.getsource(sch._run_sending_cycle_for_tenant)
      and "skip_reason=_competitor_reason" in inspect.getsource(sch.run_followup_dispatch_poll)
      and "skip_reason" in inspect.getsource(_fu.dispatch_due_followups))
_li_calls = []
business_check.classify = lambda p: _li_calls.append(1)
qualify.qualify_profile(profile(), "trading")
check("LinkedIn qualification never calls the AI gate (Instagram-only)", not _li_calls)
business_check.classify = lambda p: None

check("LinkedIn page with no website and no real bio still rejected (unchanged, LinkedIn-only now)",
      not qualify.qualify_profile(profile(bio="", has_website=False), "")[0])
check("LinkedIn page with posts but dormant still rejected (unchanged, LinkedIn-only now)",
      not qualify.qualify_profile(profile(recent_activity=False), "")[0])

# Instagram individuals vs real businesses. "co" used to match as a bare
# substring, so ali.coach / nour.cosmetics / sami.coffee all read as
# businesses and skipped the individual filter entirely.
individuals = ["ali.coach", "nour.cosmetics", "mike.cooking", "sara.content",
               "rami_coder", "sami.coffee", "maya.cooks", "omar.records",
               "karim.consultant", "anthony_fitness", "moustapha.jaafer",
               "sarah_influencer", "mike.blogger", "ahmad_creator",
               "anthony_elhachem", "moustaphachaaban", "gpt.mike", "jaafer_3d",
               # LIVE-CAUGHT 2026-09-13 in the real compressed test cycle:
               # "realestate" is a genuine _BUSINESS_TRADE_WORDS entry, which
               # made the business-word override claim this real-estate
               # agent's personal content page as a "business" before the
               # X_with_Y personal-brand check ever ran.
               "realestate_with_julia", "paisa_with_preeti"]
businesses = ["anthony.security.systems", "beiruthomedecor", "zimmar.tech",
              "cedarindustrial", "ab.art.pro", "guardify.cloud",
              "ali_trading_co", "cedar.gym", "acme.inc", "beirut.llc",
              "khalil.company", "tony.restaurant", "sami.cafe", "rami.studio",
              "maya.clinic", "ali.electric", "omar.cctv.systems",
              "karim.engineering", "hassan.auto.parts", "ali.aluminum",
              "sami.contracting",
              # a real trade-word company handle must still pass despite the
              # X_with_Y check now running first
              "acme.realestate.lb"]
# Search-term targeting. A tenant whose niche names a SERVICE ("small
# business marketing") must rotate its own target sectors instead, or it
# finds the people who sell that service rather than companies who buy it.
MJ_IND = ("E-commerce brands, consumer products, fashion & apparel, cosmetics & beauty, "
          "jewelry, technology, automotive, architecture & real estate, restaurants & "
          "hospitality, advertising agencies, marketing agencies, creative agencies, "
          "consulting agencies, holding companies (multi-brand groups)")
ZIM_IND = "Offices, warehouses, retail, schools, factories, residential complexes, hospitality"

mj_draws = {sch._resolve_search_niche("small business marketing", MJ_IND) for _ in range(50)}
check("MJivity rotates its own sectors, never 'small business marketing'",
      "small business marketing" not in mj_draws and len(mj_draws) > 3)

# Zimmar/Insurance mean "all companies". Their target_industry holds facility
# types and prose, which are not usable search terms -- they must keep the
# broad industry rotation.
zim_draws = {sch._resolve_search_niche("", ZIM_IND) for _ in range(50)}
check("empty-niche tenant keeps the broad all-industry rotation",
      not (zim_draws & {"Offices", "schools", "warehouses", "residential complexes"}))
check("a real sector niche is passed through untouched",
      sch._resolve_search_niche("dental clinics", "") == "dental clinics")

# Instagram fallback tags must not be influencer/coach territory.
banned = {"entrepreneur", "business owner", "small business", "startup"}
check("Instagram fallback hashtags avoid influencer/coach tags",
      not (set(sch._BUSINESS_HASHTAG_TERMS) & banned))

missed = [h for h in individuals if not qualify._looks_like_personal_handle(h)]
falsepos = [h for h in businesses if qualify._looks_like_personal_handle(h)]
check("all %d Instagram individuals detected%s" % (
        len(individuals), "" if not missed else " -- MISSED: %s" % missed),
      not missed)
check("all %d real businesses pass%s" % (
        len(businesses), "" if not falsepos else " -- FLAGGED: %s" % falsepos),
      not falsepos)

# Own-competitor exclusion, added 2026-09-13 after real overnight leads
# included Zimmar's own CCTV/security-camera/telecom competitors
# (linksecurtysystem, guardify.cloud, avtrade.integration) -- no such check
# had ever existed for Zimmar, only Insurance.
check("Zimmar's own security/CCTV competitors are excluded",
      sch._is_competitor("zimmar", "CCTV and video surveillance systems installer", None)
      and sch._is_competitor("zimmar", "Access control and alarm systems", None)
      and not sch._is_competitor("zimmar", "Trading company importing electronics", None))
check("Insurance's own competitor exclusion still works (regression)",
      sch._is_competitor("Partners Insurance Consultancy", "leading reinsurance broker", None)
      and not sch._is_competitor("Partners Insurance Consultancy", "quality assurance testing lab", None))

# Concrete-business-signal hard reject, added 2026-09-13 (owner: "the bio
# should have signals that it is a business or company... need 9/10
# qualified leads"). Real leads this closes: drfood.worldwide (2M
# followers), c.big.moe (123K), ab.art.pro -- all had a bio, heavy
# activity, and no website, but nothing said what the business actually
# sells or does. Must NOT reject a plain real bio with no exact phrase
# match ("Cedar Furniture, Beirut") -- that was a real overtightening bug
# caught before this shipped.
_vague_leads = [
    ("drfood.worldwide", "Follow for daily food content and recipes worldwide"),
    ("c.big.moe", "Big moe here, living my best life"),
    ("ab.art.pro", "Art is life. DM for collabs"),
]
_plain_real_leads = [
    ("cedar.furniture.beirut", "Cedar Furniture, Beirut"),
    ("newbiz.cafe", "Cafe in Hamra. Fresh coffee daily."),
    ("sparrowcarriers", "Sparrow Carriers - trusted shipping and delivery across Lebanon"),
]
_vague_still_pass = [n for n, b in _vague_leads
                      if qualify.qualify_profile(profile(display_name=n, bio=b, has_website=False), "")[0]]
_plain_rejected = [n for n, b in _plain_real_leads
                    if not qualify.qualify_profile(profile(display_name=n, bio=b, has_website=False), "")[0]]
check("vague high-follower non-businesses are rejected%s" % (
        "" if not _vague_still_pass else " -- STILL PASS: %s" % _vague_still_pass),
      not _vague_still_pass)
check("plain real small-business bios still pass (not overtightened)%s" % (
        "" if not _plain_rejected else " -- WRONGLY REJECTED: %s" % _plain_rejected),
      not _plain_rejected)

# Message templates must read as English even when the scrape failed to read
# the company name. LIVE-CONFIRMED 2026-09-13: the "there" fallback produced
# "Worth a quick check on there's setup?" and "brands like there?", which
# would have been sent to real prospects verbatim.
import re as _re
from agent.messaging import generate as _gen
from agent.db import repositories as _repo

_BROKEN = _re.compile(r"there's setup|like there\b|noticed there\b|there doesn", _re.I)
_TENANTS = [("cmt0o0yr30002f9p5t3eb269f", ["linkedin", "instagram"]),
            ("cmt4i8jxh000crao9ekd6pe08", ["linkedin"]),
            ("cmt4t0xv000046pkmm7ue1qhz", ["instagram"])]
_broken = []
for _tid, _plats in _TENANTS:
    try:
        with _repo.tenant_scope(_tid):
            for _plat in _plats:
                for _bn in ("Cedar Industrial SAL", None):
                    _body = _gen.generate_message(
                        {"business_name": _bn, "platform": _plat,
                         "weak_points": ["no group benefit"]}, _plat, "discovery")
                    if _BROKEN.search(_body):
                        _broken.append("%s/%s/name=%s" % (_tid[:8], _plat, _bn))
    except Exception as _exc:
        _broken.append("%s: %s" % (_tid[:8], _exc))
check("outreach templates read as English even with no company name%s" % (
        "" if not _broken else " -- BROKEN: %s" % _broken),
      not _broken)

# LinkedIn's Page inbox hard-rejects anything outside 25-750 chars. The
# generation-time guard (_enforce_channel_length) originally covered ONLY
# the AI-generated path -- generate_message() returned the FIXED templates
# early, before the guard ever ran. Twice now a template quietly grew past
# 750 (Zimmar 2026-09-13, Insurance 2026-09-16) and the failure only
# surfaced as MessageLengthInvalid at SEND time, after a human had already
# approved and queued the message -- 12 + 5 real Insurance messages sat
# unsendable in the queue because of it. The guard now runs on every
# return path. Tested with a deliberately long real-world company name,
# which is exactly what pushed the pre-fix templates over the limit.
_LONG_NAME = "Advanced Construction Technology Services International Holding SAL"
_over = []
for _tid, _plats in _TENANTS:
    try:
        with _repo.tenant_scope(_tid):
            for _plat in _plats:
                for _wp in ([], ["no group employee benefit"]):
                    _b = _gen.generate_message(
                        {"business_name": _LONG_NAME, "platform": _plat, "weak_points": _wp},
                        _plat, "discovery")
                    _limit = _gen._CHANNEL_MAX_CHARS.get(_plat)
                    if _limit is not None and len(_b) > _limit:
                        _over.append("%s/%s/wp=%d: %d chars" % (_tid[:8], _plat, len(_wp), len(_b)))
    except Exception as _exc:
        _over.append("%s: %s" % (_tid[:8], _exc))
check("every fixed template renders within its channel limit, even with a very long company name%s" % (
        "" if not _over else " -- OVER LIMIT: %s" % _over),
      not _over)
# Structural check: the guard must be applied to the template paths, not
# just happen to be unnecessary today. generate_message() must have exactly
# ONE return, and it must be the length-guarded one -- an early `return
# _<tenant>_fixed_template(...)` is precisely the regression this catches.
import inspect as _gm_inspect
_gm_src = _gm_inspect.getsource(_gen.generate_message)
check("generate_message() has a single length-guarded exit (no early return bypasses _enforce_channel_length)",
      _gm_src.count("return ") == 1 and "return _enforce_channel_length(body, channel)" in _gm_src)

# Strict Lebanon-only location, added 2026-09-13 after real leads in Dubai
# and Australia slipped through for Zimmar/Insurance. Two rules: (1) a bio
# naming a known foreign place is always a reject, (2) for a
# Lebanon-configured tenant, a bio with NO Lebanese place name at all is
# ALSO a reject now (owner: "we do not need outside lebanon... yes" to
# rejecting on no signal) -- previously an empty/ambiguous location got the
# benefit of the doubt.
check("Dubai bio flagged as foreign for a Lebanon-configured tenant",
      sch._mentions_foreign_location("Leading security provider based in Dubai, UAE", "lebanon") is not None)
check("Australia bio flagged as foreign for a Lebanon-configured tenant",
      sch._mentions_foreign_location("Proudly serving Sydney and Melbourne since 2010", "lebanon") is not None)
check("a real Beirut bio is NOT flagged as foreign",
      sch._mentions_foreign_location("Your trusted partner in Beirut, Lebanon", "lebanon") is None)
check("strict mode: a bio with no Lebanese place name at all has no positive signal",
      not any(p in "Solar panel installer for homes and offices".lower() for p in sch._LEBANON_PLACE_MARKERS))
check("strict mode: a real Beirut-mentioning bio DOES have a positive signal",
      any(p in "Solar panel installer for homes and offices in Beirut".lower() for p in sch._LEBANON_PLACE_MARKERS))

# LinkedIn's headquarters-check and bio-scan used to be if/else -- the bio
# was only scanned when Headquarters was blank, so a Headquarters field that
# merely existed (regardless of content) skipped the bio check entirely.
# Confirmed by reading scheduler.py's own _discover_linkedin source: both
# checks must now be reachable, not mutually exclusive.
import inspect as _inspect
_linkedin_src = _inspect.getsource(sch)
check("LinkedIn's foreign-bio scan is NOT gated behind an empty Headquarters field (structural regression check)",
      "if not mismatch_reason:\n                        foreign_marker = _mentions_foreign_location" in _linkedin_src)

# RELAXED 2026-09-13, real bug caught live in the actual A-to-Z cycle: the
# strict re-check rejected Dar (Dar Al-Handasah) and Aramex -- two large,
# famous, genuinely Lebanese-founded companies -- purely because their
# LinkedIn Headquarters field lists their current GLOBAL hq (Singapore,
# Dubai), not Beirut where they started and still operate. Both were
# surfaced by the search's OWN companyHqGeo=Lebanon facet -- LinkedIn had
# already confirmed a real Lebanon connection, and the stricter re-check
# then threw that confirmation away. Fix: when the search itself used a
# verified geo facet (true for any configured_location LOCATION_FACETS
# recognizes, e.g. "lebanon"), trust it and skip the extra
# Headquarters/bio re-verification -- only fall back to the strict check
# for a location LinkedIn has no facet ID for.
check("LinkedIn has a verified geo facet ID for 'lebanon' (what the relaxed-check decision is keyed on)",
      linkedin.LOCATION_FACETS.get("lebanon") is not None)
check("_discover_linkedin's source actually checks LOCATION_FACETS before applying the strict re-check (regression check)",
      "search_used_geo_facet = bool(linkedin.LOCATION_FACETS.get(configured_location))" in _linkedin_src)

# Real owner question after everything above still wasn't enough: "we have
# 80,000 companies in Lebanon, why can't we find 5?" Answer: 6 checks
# stacked in sequence compound their rejection rates -- a LIVE run visited
# 8 real candidates and saved 0 even with every earlier bug fixed. Raised
# from 10 to 20 search rounds/day (doubles daily candidate volume) and
# loosened the two weakest-justified checks (this file's own checks below
# cover the message-button wait-timing fix and the Instagram
# no-signal-at-all hard reject being downgraded to a soft qualify_profile
# signal) -- owner-approved: "both bro" (loosen filters AND raise volume).
check("max search rounds raised to 20 (was 10) to survive 6 stacked filters compounding",
      sch._MAX_SEARCH_ATTEMPTS == 20)
check("Instagram's old hard 'no Lebanese signal in bio' reject is gone (relaxed to a soft qualify_profile signal)",
      "no positive signal this is a Lebanese account" not in _inspect.getsource(sch._discover_instagram))
# OWNER REQUEST 2026-10-07: Instagram's foreign-location decision moved
# INTO qualify_profile() (see _has_foreign_evidence in discovery/qualify.py)
# -- the standalone "rejected (foreign location: ...)" pre-check that used
# to live directly in _discover_instagram is gone, replaced by
# qualify_profile() owning the whole decision in one place. Checked via the
# real function below instead of grepping _discover_instagram's source.
check("Instagram's foreign-location hard reject moved into qualify_profile() (still catches real Dubai/Australia leads)",
      not qualify.qualify_profile(
          {"platform": "instagram", "display_name": "Some Business",
           "bio": "Proudly serving customers in Dubai, UAE since 2015.",
           "has_website": True, "post_count": 40, "recent_activity": True,
           "follower_or_headcount": 500},
      )[0])
# OWNER REQUEST 2026-10-07 (two rounds of clarification, final answer): a
# Lebanese phone number ANYWHERE in the bio overrides a foreign phone
# number also being present -- "if we have 2 numbers one of them lebanese
# we should qualify." A bio with BOTH a Lebanese and a foreign phone number
# must still qualify (the Lebanese number is the deciding evidence); a bio
# with ONLY a foreign number (no Lebanese one at all) must still reject.
check("a bio listing BOTH a Lebanese (+961) and a foreign (+91) phone number still qualifies (Lebanese number overrides)",
      qualify.qualify_profile(
          {"platform": "instagram", "display_name": "Beirut Spice Traders",
           "bio": "Call us: +961 3 123456 or our other branch at +91 98765 43210.",
           "has_website": True, "post_count": 40, "recent_activity": True,
           "follower_or_headcount": 500},
      )[0])
check("a bio with ONLY a foreign phone number (no Lebanese one) still rejects",
      not qualify.qualify_profile(
          {"platform": "instagram", "display_name": "Some Business",
           "bio": "Call our office: +91 98765 43210.",
           "has_website": True, "post_count": 40, "recent_activity": True,
           "follower_or_headcount": 500},
      )[0])
# has_message_button() and its discovery-time wiring were REMOVED
# 2026-09-13 (owner's own call after two rounds of render-wait tuning
# still hit a ~25% false-reject rate on real, reachable companies): losing
# real leads to a false pre-check is worse than a genuine no-button lead
# reaching send time, where it's now caught cleanly and shown with its
# real reason (see the sendFailureReason checks below) instead of a
# silent, endless "pending" retry loop.
check("has_message_button (the discovery-time pre-check) is fully removed, not just disabled",
      not hasattr(linkedin, "has_message_button"))
check("no 'no Message button' rejection path remains in _discover_linkedin (regression check)",
      "rejected (no Message button)" not in _inspect.getsource(sch._discover_linkedin))

# Real gap found and fixed 2026-09-13 while removing the pre-check above:
# a NoMessageButtonAvailable at SEND time used to reset send_status back to
# "pending" -- the same treatment as a genuinely transient failure (a
# network blip, a timeout) -- so it silently retried forever with the real
# reason visible nowhere but a log line. Owner: "when it appears in the
# approval section as no message button I will press hold and ignore
# sending it" -- that requires the failure to actually land as a visible,
# permanent "failed" state with its real reason attached, not an endless
# silent retry.
_ls_src = _inspect.getsource(linkedin_send)
_is_src = _inspect.getsource(instagram_send)
check("linkedin_send.py marks a NoMessageButtonAvailable as a PERMANENT failed status with its reason persisted",
      'except NoMessageButtonAvailable as exc:' in _ls_src and '"send_failure_reason": str(exc)' in _ls_src)
check("instagram_send.py marks its own NoMessageButtonAvailable as a PERMANENT failed status with its reason persisted",
      'except NoMessageButtonAvailable as exc:' in _is_src and '"send_failure_reason": str(exc)' in _is_src)
# UPDATED 2026-09-16: the literal "send_status": "pending" reset used to
# live directly in linkedin_send.py/instagram_send.py, which is what this
# check originally grepped for. It now lives in ONE shared place --
# delivery.settle_after_failure() -- as part of fixing the two double-send
# vectors documented in that module's own docstring, so both files now
# route a transient (pre-delivery) failure through settle_after_failure()
# instead of writing the literal themselves. The actual pending-reset
# behavior is verified BEHAVIORALLY above (the "still releases a
# NOT-yet-delivered message back to 'pending'" check); this one just
# confirms both send paths still call the shared function rather than
# having quietly dropped back to handling it inline.
check("a genuinely transient send failure still resets to 'pending' for a real retry (regression check, both channels)",
      "settle_after_failure(" in _ls_src and "settle_after_failure(" in _is_src)

# THE REAL ROOT CAUSE of every LinkedIn zero-results run tonight and last
# night, LIVE-CONFIRMED 2026-09-13: both Zimmar's and Insurance's
# target_industry field is long descriptive PROSE, not a search term
# ("Offices, warehouses, retail, schools, factories, residential
# complexes, hospitality; individuals or families setting up a new
# house..." for Zimmar). build_search_url() had a length/comma guard for
# a verbose LOCATION string (see _MAX_LOCATION_KEYWORD_LENGTH's own use
# just above) but the identical guard was never applied to `industry` --
# so that entire sentence was appended straight into the `keywords` query
# param on every single search. Direct proof: a live diagnostic run
# showed 10/10 search rounds returning 0 results with the real
# (verbose-industry) URL, while the EXACT SAME niche+location, tested
# moments later with industry dropped, returned 10 real companies and a
# page showing "643 results" for keyword 'trading' alone.
_verbose_industry = (
    "Offices, warehouses, retail, schools, factories, residential complexes, "
    "hospitality; individuals or families setting up a new house; real estate "
    "developers building new apartments/buildings; engineering and construction "
    "companies; and property/building management companies -- any business, "
    "developer, or individual showing a real need, no category prioritized over another"
)
_poisoned_url = linkedin.build_search_url("trading", "Lebanon", _verbose_industry, None)
check("verbose target_industry text is NOT appended into the LinkedIn search keywords%s" % (
        "" if "Offices" not in _poisoned_url else " -- STILL POISONED: %s" % _poisoned_url),
      "Offices" not in _poisoned_url and "warehouses" not in _poisoned_url)
check("a real short industry facet still passes through untouched",
      "technology" in linkedin.build_search_url("trading", "Lebanon", "technology", None))

# Agency exclusion added 2026-09-13 (owner: "no agencies only companies and
# businesses"), then REVERSED the same night during a live test (owner:
# "some agencies have good number of employees... Yes, both -- remove the
# no-agency rule entirely for both tenants"): an agency with real staff and
# a real office has real premises to protect and a real insurable
# operation just like any other company. _is_agency() itself is still a
# correct detector (checked below) -- only the WIRING that hard-rejected on
# it is gone, via an empty _AGENCY_EXCLUDED_BUSINESSES set, kept for a
# future tenant that might genuinely need this (MJivity's own market
# explicitly INCLUDES agencies as legitimate clients, the opposite
# preference -- see outreach-tenant-targeting-rules memory).
check("_is_agency() still correctly detects a marketing agency (detector itself unchanged)",
      qualify._is_agency("acme.marketing.agency", "Full-service digital marketing agency in Beirut"))
check("_is_agency() still correctly detects a real estate agency (detector itself unchanged)",
      qualify._is_agency("cedar.realty", "Cedar Realty Agency - real estate in Beirut"))
check("_is_agency() does not false-positive a real furniture business",
      not qualify._is_agency("cedar.furniture", "Cedar Furniture, Beirut"))
check("_is_agency() does not false-positive a real logistics company",
      not qualify._is_agency("hosarilogistics", "Freight forwarding and logistics company in Beirut"))
check("agency exclusion is now EMPTY for both Zimmar and Insurance (owner-reversed 2026-09-13)",
      sch._AGENCY_EXCLUDED_BUSINESSES == set())

# Real-time discovery progress logging, added 2026-09-13 after a 30+ minute
# discovery run showed zero visible progress and the owner had to ask "how
# to check where is the real problem" -- there was no way to tell from the
# logs alone whether a long run was stuck or just slow. Just confirms the
# logger exists and is wired to reach docker logs (server.py's own
# logging.basicConfig() call, not re-tested here).
check("discovery progress logger exists and is a real Logger",
      hasattr(sch, "_progress_log") and isinstance(sch._progress_log, __import__("logging").Logger))

# Real infra problem found live 2026-09-13: the droplet has only 1.9GB RAM
# total, and one Chromium renderer process alone measured at 22.7% of that
# mid-run (docker top) -- with GPU/audio/network helper processes on top,
# one browser instance ate ~40-45% of the whole machine, at load average
# 4.5. That resource starvation, not a selector/logic bug, is the confirmed
# real cause behind a run of consecutive Page.goto timeouts. Upgrading the
# droplet was explicitly ruled out ("this is the 3rd time we upgrade") --
# this trims Chromium's own footprint instead (GPU, audio, extensions,
# background networking, etc, none of which a headless scraper needs).
import inspect as _sess_inspect
_session_src = _sess_inspect.getsource(sess)
check("Chromium launches with memory-saving flags (--disable-gpu, --mute-audio) for the RAM-constrained droplet",
      "--disable-gpu" in _session_src and "--mute-audio" in _session_src)
check("the anti-detection flag (--disable-blink-features=AutomationControlled) is still present (regression check)",
      "--disable-blink-features=AutomationControlled" in _session_src)

# REAL ROOT CAUSE of the duplicate-message incident, found and fixed
# 2026-09-15: linkedin_reply_check.py/instagram_reply_check.py's
# _sync_thread_messages() re-reads the live LinkedIn/Instagram DOM every
# 3-minute reply-detection poll and backfills any "new" outgoing message it
# sees into our DB. The dedup compared RAW strings -- our own stored body
# keeps real paragraph breaks, but the live DOM renders the identical
# message as one flat run with no line breaks, so the two never matched and
# EVERY poll re-inserted the same one real, already-sent message as a
# phantom "new" duplicate row (approved_by=None, created_at==approved_at==
# sent_at). LIVE-CONFIRMED against 5 real leads. No second message was
# ever actually delivered to any lead -- this was purely a duplicate
# DATABASE record of one real send, which the dashboard then rendered as
# if two real sends had happened.
check("_normalized_for_dedup() exists and actually collapses whitespace/newlines",
      linkedin_reply_check._normalized_for_dedup("Hi\n\nthere") == linkedin_reply_check._normalized_for_dedup("Hithere"))
check("linkedin_reply_check's dedup uses the normalized comparison, not raw strings (regression check)",
      "normalized in known_outgoing" in _inspect.getsource(linkedin_reply_check._sync_thread_messages))
check("instagram_reply_check's dedup uses the normalized comparison, not raw strings (regression check)",
      "normalized in known_outgoing" in _inspect.getsource(instagram_reply_check._sync_thread_messages))

# REAL ROOT CAUSE of 9 fake replies + false "replied" statuses, found and
# fixed 2026-09-16: instagram_reply_check._read_thread_messages() used to
# decide each bubble's direction ("us" vs "lead") by comparing its
# horizontal position against the THREAD'S OWN AVERAGE left offset --
# LIVE-CONFIRMED against 5 real leads (meteorintheyks, hnmoverseas,
# al_mosbah_, lafe.leb, lets_travel_and_discover), each a thread holding
# ONLY our own template's messages (no real reply ever received). With
# only one side actually present, the average sits in the middle of OUR
# OWN bubbles, so roughly half of them landed left of it and were recorded
# as if the lead had sent them -- fabricating outreach_replies rows out of
# our own pitch text and flipping the lead to status='replied' on zero real
# evidence. Fix: direction is no longer guessed from position alone. A
# bubble already matching known outgoing/incoming CONTENT is classified by
# that; a genuinely new bubble only gets a position-based guess once a real
# reply already exists for the lead (the thread is confirmed two-sided);
# otherwise it is skipped rather than guessed.
class _FakeReplyRepo:
    """Stands in for repo inside _sync_thread_messages: a lead with a known
    outgoing template already on file, no confirmed reply yet (the exact
    shape of the 5 real leads above at the moment the bug fired)."""
    def __init__(self, existing_replies=None, existing_messages=None):
        self._replies = existing_replies or []
        self._messages = existing_messages or []
        self.inserted_replies = []
        self.inserted_messages = []
    def replies_for_lead(self, lead_id):
        return self._replies
    def messages_for_lead(self, lead_id):
        return self._messages
    def insert_message(self, fields):
        self.inserted_messages.append(fields)
    def insert_error(self, *a, **k):
        pass

import re as _re_t
_zim_paras = [x for x in _re_t.split(r"\n+", _gen._ZIMMAR_TEMPLATE_INSTAGRAM) if x]
_ig_real_repo = instagram_reply_check.repo
_li_real_repo = linkedin_reply_check.repo
_orig_handle_reply = instagram_reply_check.handle_reply_detected
try:
    # No confirmed reply exists yet -- a thread with ONLY our own opening
    # and closing lines (mirrors the real 2-fragment pattern found on all
    # 5 leads). Bubbles are given the SAME left offset the real bug needed
    # to misfire (an even split around the average).
    _fake_no_reply_yet = _FakeReplyRepo(existing_replies=[], existing_messages=[
        {"channel": "instagram", "body": _zim_paras[0] + "\n\n" + _zim_paras[1] + "\n\n" + _zim_paras[2] + "\n\n" + _zim_paras[-1]},
    ])
    instagram_reply_check.repo = _fake_no_reply_yet
    _fabricated_replies = []
    instagram_reply_check.handle_reply_detected = lambda *a, **k: _fabricated_replies.append(k.get("body") or (a[2] if len(a) > 2 else None))
    _live = [{"text": _zim_paras[0], "left": 100.0}, {"text": _zim_paras[-1], "left": 900.0}]
    _new_replies, _new_outgoing = instagram_reply_check._sync_thread_messages(
        {"id": "lead-no-reply-yet"}, {"id": "acc1"}, _live)
    check("a thread with ONLY our own messages and no confirmed reply yet fabricates ZERO replies (the false 'replied' bug)",
          _new_replies == 0 and not _fabricated_replies)

    # A real reply DOES already exist -- the thread is confirmed two-sided,
    # so a genuinely new incoming message must still be detected normally.
    _fake_with_reply = _FakeReplyRepo(
        existing_replies=[{"body": "Thanks, tell me more"}],
        existing_messages=[{"channel": "instagram", "body": _zim_paras[0]}],
    )
    instagram_reply_check.repo = _fake_with_reply
    _fabricated_replies.clear()
    _live2 = [
        {"text": _zim_paras[0], "left": 900.0},          # already-known outgoing (content match, not position)
        {"text": "Thanks, tell me more", "left": 100.0},  # already-known incoming (content match)
        {"text": "Ok sounds good, call me", "left": 100.0},  # genuinely NEW incoming, same side as the known reply
    ]
    _new_replies2, _new_outgoing2 = instagram_reply_check._sync_thread_messages(
        {"id": "lead-with-reply"}, {"id": "acc1"}, _live2)
    check("a genuinely NEW incoming message is still detected once a real reply already anchors the thread",
          _new_replies2 == 1 and _fabricated_replies == ["Ok sounds good, call me"])

    # REAL BUG found live 2026-09-19 (fadeltradingcompany, titus.logistics,
    # real Zimmar Instagram leads): the ORIGINAL version of this check
    # additionally required known_incoming to be non-empty (a reply already
    # confirmed on a PRIOR run) before ever trusting a position-based
    # guess -- which silently excluded a lead's FIRST EVER reply, since
    # that is always the one moment known_incoming is still empty. Both
    # real leads sent a genuine first reply that this exact gate skipped
    # outright. This is the fix: a genuinely new bubble at a lead's FIRST
    # reply (known_incoming empty, but our own sent message IS
    # content-matched in this same read) must now be detected.
    _fake_first_reply = _FakeReplyRepo(existing_replies=[], existing_messages=[
        {"channel": "instagram", "body": "Our cold outreach message"},
    ])
    instagram_reply_check.repo = _fake_first_reply
    _fabricated_replies.clear()
    _live3 = [
        {"text": "Our cold outreach message", "left": 900.0},  # us, content-matched
        {"text": "Hi thanks for reaching out", "left": 100.0},  # genuinely new -- the lead's FIRST reply
    ]
    _new_replies3, _new_outgoing3 = instagram_reply_check._sync_thread_messages(
        {"id": "lead-first-reply"}, {"id": "acc1"}, _live3)
    check("a lead's FIRST EVER reply is detected even with no prior confirmed reply on file (2026-09-19 real bug fix)",
          _new_replies3 == 1 and _fabricated_replies == ["Hi thanks for reaching out"])
finally:
    instagram_reply_check.repo = _ig_real_repo
    instagram_reply_check.handle_reply_detected = _orig_handle_reply

check("_read_thread_messages() no longer decides direction itself (returns undecided bubbles, see its own docstring)",
      '"from"' not in _inspect.getsource(instagram_reply_check._read_thread_messages))
check("direction classification lives in _sync_thread_messages(), anchored to known content first (regression check)",
      "known_outgoing" in _inspect.getsource(instagram_reply_check._sync_thread_messages)
      and "confirmed_us_lefts" in _inspect.getsource(instagram_reply_check._sync_thread_messages))

# REAL ROOT CAUSE found and fixed 2026-09-18, live-confirmed against lead
# "Khatib & Alami" (Insurance tenant, lead_id 83ae70fd-0064-4372-992e-
# 612691e2add3): unlike Instagram (which derives direction from CONTENT
# first, known_outgoing checked before any position guess -- see the block
# above), linkedin_reply_check._sync_thread_messages() unconditionally
# trusted _read_thread_messages()'s DOM-derived "from" label. A re-render
# of our OWN already-sent message got mislabeled "lead" by LinkedIn's own
# sender-name carry-forward heuristic and was inserted straight into
# outreach_replies as a fabricated reply -- confirmed live: the bad row's
# body is byte-for-byte our own outbound message with paragraph breaks
# flattened. Fix: a candidate labeled "lead" is now cross-checked against
# known_outgoing (content-normalized) BEFORE being accepted -- a match
# means it's our own message misread off the page, not a real reply, and
# it's skipped entirely (no outreach_replies insert, no status flip).
check("linkedin_reply_check cross-checks a 'lead'-labeled candidate against known_outgoing before accepting it (regression check)",
      "if normalized in known_outgoing" in _inspect.getsource(linkedin_reply_check._sync_thread_messages))

class _FakeLinkedInRepo:
    """Stands in for repo inside linkedin_reply_check._sync_thread_messages:
    a lead with one known outgoing message on file and one genuine prior
    reply -- mirrors Khatib & Alami's real shape (one real send, one real
    'deleted message' reply) at the moment the bug fired."""
    def __init__(self, existing_replies=None, existing_messages=None):
        self._replies = existing_replies or []
        self._messages = existing_messages or []
    def replies_for_lead(self, lead_id):
        return self._replies
    def messages_for_lead(self, lead_id):
        return self._messages
    def insert_message(self, fields):
        pass
    def insert_error(self, *a, **k):
        pass

_li_sent_body = "Hello Khatib & Alami,\n\nWe're introducing Lebanon's first Dental Card.\n\nWould it be worth a quick call?"
_fake_li_repo = _FakeLinkedInRepo(
    existing_replies=[{"body": "This message has been deleted."}],
    existing_messages=[{"channel": "linkedin", "body": _li_sent_body}],
)
try:
    linkedin_reply_check.repo = _fake_li_repo
    _li_fabricated = []
    linkedin_reply_check.handle_reply_detected = lambda *a, **k: _li_fabricated.append(k.get("body") or (a[2] if len(a) > 2 else None))
    # DOM mislabels our own already-sent message as "lead" (flattened
    # newlines, exactly like LinkedIn's real re-render) -- the exact
    # live-confirmed failure mode for Khatib & Alami.
    _li_live = [
        {"from": "lead", "text": "This message has been deleted."},   # genuine prior reply, already known
        {"from": "lead", "text": _li_sent_body.replace("\n", "")},    # BUG: our own message mislabeled "lead"
    ]
    _li_new_replies, _li_new_outgoing = linkedin_reply_check._sync_thread_messages(
        {"id": "lead-khatib-alami"}, {"id": "acc1"}, _li_live)
    check("a DOM-mislabeled 'lead' message matching our own known_outgoing content fabricates ZERO replies (Khatib & Alami bug)",
          _li_new_replies == 0 and not _li_fabricated)
finally:
    linkedin_reply_check.repo = _li_real_repo
    linkedin_reply_check.handle_reply_detected = _orig_handle_reply

# REAL SECOND BUG found alongside the above while investigating: the
# sending cycle had NO daily-send-limit check at all -- LIVE-CONFIRMED one
# account sent 8 real LinkedIn messages in a single day against its own
# configured linkedin_daily_limit of 5 (this is a SEPARATE issue from the
# phantom-duplicate-row bug above; both existing together is what let the
# real send count run over its cap once duplicate rows were queued).
check("cold_sends_today_for_account() exists for the new sending-side daily cap",
      hasattr(sch.repo, "cold_sends_today_for_account"))
check("_run_sending_cycle_for_tenant() actually applies the daily cap (regression check)",
      "cold_sends_today_for_account" in _inspect.getsource(sch._run_sending_cycle_for_tenant))

# REAL INCIDENT 2026-09-16: LinkedIn served a security checkpoint on Zimmar's
# account ("unusual activity / high volume of profile data access"). Both that
# LinkedIn account and its Instagram account were set to status='paused' in
# the DB -- but the pause did NOT stop sending. Account status was only ever
# consulted at schedule-BUILD time (build_daily_schedule), so the sending jobs
# registered at the previous boot (08:41 and 10:05 Beirut) still held live
# closures and would have kept sending on the checkpointed account until the
# next redeploy. Discovery was never exposed: pool.get_due_accounts() has
# always re-checked status at run time. This proves the SENDING path now does
# the same, by actually running the real cycle against a paused account and
# asserting no send is even attempted (no browser session, no stage_run row).
class _FakeSendRepo:
    """Stands in for repo: one paused account with an approved message waiting."""
    def __init__(self, status):
        self.status = status
        self.started_runs = []
    class _Scope:
        def __enter__(self): return None
        def __exit__(self, *a): return False
    def tenant_scope(self, tenant_id): return self._Scope()
    def is_tenant_paused(self): return False          # tenant is ACTIVE; only the account is paused
    def get_account(self, account_id, tenant_id):
        return {"id": account_id, "status": self.status, "platform": "linkedin",
                "label": "Zimmar LinkedIn", "send_daily_limit_override": None}
    def messages_approved_pending(self):
        # A real, sendable, non-reply message is waiting -- so if the guard is
        # missing, the cycle WILL try to send it and the check fails loudly.
        return [{"id": "m1", "lead_id": "l1", "is_reply": False}]
    def get_lead(self, lead_id): return {"id": lead_id, "account_id": "acc-zimmar-li"}
    def start_stage_run(self, tenant_id, stage):
        self.started_runs.append(stage)
        return {"id": "run1"}
    def finish_run(self, *a, **k): pass
    def insert_error(self, *a, **k): pass
    def cold_sends_today_for_account(self, *a, **k): return 0

_real_repo = sch.repo
try:
    for _status, _should_send in (("paused", False), ("warned", False), ("active", True)):
        _fake = _FakeSendRepo(_status)
        sch.repo = _fake
        _results = sch.run_account_sending_cycle("tenant-zimmar", "acc-zimmar-li")
        if _should_send:
            # An active account must still get PAST the guard. It will fail
            # later (no real browser/DB here) -- what matters is that it tried:
            # a stage_run row was opened, proving the guard did not short-circuit.
            check("an ACTIVE account is still allowed to send (guard is not blanket-blocking)",
                  _fake.started_runs == ["sending"])
        else:
            check("a %r account sends NOTHING at run time, even with an approved message queued" % _status,
                  _results == [] and _fake.started_runs == [])
finally:
    sch.repo = _real_repo

check("run_account_sending_cycle() re-reads account status at RUN time, not just at schedule-build (regression check)",
      "get_account" in _inspect.getsource(sch._run_account_sending_cycle))
check("_run_sending_cycle_for_tenant() also gates on account status (defense in depth, regression check)",
      'status") != "active"' in _inspect.getsource(sch._run_sending_cycle_for_tenant))

# Owner-requested 2026-09-15: a simple box on the Follow-ups dashboard page
# for what follow-up messages should be about (OutreachSettings.
# followUpGuidance), threaded through as extra Claude context -- NOT a
# fixed template, _FOLLOWUP_RULES still forces a genuinely fresh,
# non-repeating message every time.
check("generate_followup_message() accepts follow_up_guidance and passes it through",
      "follow_up_guidance" in _inspect.signature(_gen.generate_followup_message).parameters)
check("format_personalization_context() includes follow_up_guidance in the prompt when given",
      "What this follow-up should be about" in _gen.format_personalization_context(
          {"business_name": "Test Co"}, follow_up_guidance="mention our new pricing"))
check("format_personalization_context() adds nothing extra when no guidance is given (regression check)",
      "What this follow-up should be about" not in _gen.format_personalization_context({"business_name": "Test Co"}))

# REAL CUSTOMER-VISIBLE BUG, found and fixed 2026-09-16: one Instagram DM to
# lead "mik.export" arrived as FOUR separate message bubbles, all stamped
# 11:31:49, one per paragraph of Zimmar's fixed Instagram template (owner
# screenshot). Cause: core/pacing.py's human_type() fed EVERY character to
# press_sequentially(), newlines included, and a bare Enter in Instagram's
# (and LinkedIn's) chat composer means SEND -- so each "\n\n" paragraph
# break fired a real send and the rest kept typing into an emptied box.
# Reads as spam to the recipient. The fix types newlines as explicit
# Shift+Enter (soft line break, never sends) instead.
from agent.core import pacing as _pacing

class _FakeLocator:
    """Records exactly what human_type() would do to a real composer."""
    def __init__(self):
        self.events = []
    def click(self):
        self.events.append(("click", ""))
    def press(self, key, delay=None):
        self.events.append(("press", key))
    def press_sequentially(self, text, delay=None):
        self.events.append(("type", text))

def _drive(body):
    loc = _FakeLocator()
    _pacing.human_type(loc, body)
    return loc.events

_zim = _gen._ZIMMAR_TEMPLATE_INSTAGRAM
_zim_events = _drive(_zim)
_typed_chars = [e[1] for e in _zim_events if e[0] == "type"]
_pressed = [e[1] for e in _zim_events if e[0] == "press"]

# The core assertion: a raw newline must NEVER be typed as a character --
# that keystroke is literally what sent the four separate messages.
check("human_type() never types a raw newline character (the four-separate-messages bug)",
      not any("\n" in c or "\r" in c for c in _typed_chars))
check("human_type() uses Shift+Enter for line breaks, not bare Enter",
      _pressed and all(k == "Shift+Enter" for k in _pressed))
# One Shift+Enter per newline in the real template (8 today: 4 blank lines
# between its 5 blocks). Asserted against the template's own count rather
# than a hardcoded number, so an owner-approved wording change can't fail
# this check -- what matters is that no newline is lost or doubled. Two
# presses per blank line is what preserves the visual paragraph spacing
# instead of collapsing it to a single break.
check("Zimmar's Instagram template produces one Shift+Enter per newline (blank lines preserved, not collapsed)",
      len(_pressed) == _zim.count("\n"))
check("a '\\n\\n' blank line yields exactly TWO Shift+Enters (paragraph spacing preserved)",
      [e[1] for e in _drive("a\n\nb") if e[0] == "press"] == ["Shift+Enter", "Shift+Enter"])
# Every visible character of the approved body still gets typed, in order --
# the fix must not drop or reorder any of the real message content.
check("human_type() still types the complete approved body, in order",
      "".join(_typed_chars) == _zim.replace("\n", ""))
# Single-line fields (login email/password via core/session.py) must behave
# exactly as before: no newlines in, no Shift+Enter out.
check("a single-line value presses no keys at all (login fields unaffected)",
      [e for e in _drive("user@example.com") if e[0] == "press"] == [])

# LinkedIn was affected identically -- same shared human_type(), and its
# Zimmar template also has "\n\n" paragraphs. Both send paths (cold +
# reply) on both channels must go through the fixed helper.
import inspect as _hi
for _label, _fn in (
    ("instagram cold send", instagram_send._send_from_profile),
    ("instagram reply", instagram_send.send_reply),
    ("linkedin company send", linkedin_send._send_to_company),
    ("linkedin person send", linkedin_send._send_to_person),
    ("linkedin reply", linkedin_send.send_reply),
):
    _src = _hi.getsource(_fn)
    check("%s types the body via human_type(), not .fill()/.type() (regression check)" % _label,
          "human_type(" in _src and ".fill(" not in _src)

# The 2026-09-15 duplicate-row fix must survive this change: _normalized_for_dedup
# strips ALL whitespace, so a body typed with Shift+Enter line breaks still
# compares equal to the same message read back flat from the live DOM.
check("dedup still matches the Zimmar body against a flat DOM rendering of it (cross-check with the 2026-09-15 fix)",
      linkedin_reply_check._normalized_for_dedup(_zim)
      == linkedin_reply_check._normalized_for_dedup(_zim.replace("\n", " ")))

# ---------------------------------------------------------------------------
# Two real double-send vectors, found and fixed 2026-09-16 -- the owner was
# emphatic a message must NEVER be delivered twice. See
# agent/sending/delivery.py's own module docstring for the full incident.
# VECTOR 1: send_reply() on both channels took no claim at all, so a
# post-delivery failure left the row 'pending' and the ~3-minute reply poll
# re-delivered it, unbounded (replies are exempt from the daily cap).
# VECTOR 2: a blanket `except Exception` enclosing both the send click and
# all post-click teardown reset an already-DELIVERED message back to
# 'pending', causing a genuine re-send on the next cycle.
import inspect as _dd_inspect
from agent.sending import delivery as _delivery

check("delivery.Delivery/settle_after_failure exist and enforce the invariant in code, not just by convention",
      hasattr(_delivery, "Delivery") and hasattr(_delivery, "settle_after_failure"))

# settle_after_failure must NEVER release a delivered message back to
# 'pending', even if persisting that fact to the DB itself fails -- verified
# behaviorally against the real function, not by reading its source.
class _FakeDeliveryRepo:
    def __init__(self):
        self.calls = []
    def update_message(self, message_id, fields):
        self.calls.append(dict(fields))
        if fields.get("send_status") == "sent":
            raise RuntimeError("DB write failed -- must not fall back to pending")
        return None

_orig_update_message = _delivery.repo.update_message
_fake_repo = _FakeDeliveryRepo()
_delivery.repo.update_message = _fake_repo.update_message
# REAL BUG FOUND AND FIXED 2026-09-25: settle_after_failure() ALSO calls
# scheduler.log_error() (imported lazily inside the function, so it can't
# be patched via _delivery's own module reference) on the delivered-but-
# teardown-failed path -- that's a REAL write to the production error_logs
# table via repo.insert_error(), completely bypassing the _fake_repo mock
# above, which only covers repo.update_message. Confirmed live: 53 rows
# with tenantId=NULL and message "...RuntimeError: teardown blew up..." --
# a synthetic string that exists ONLY in this test, one per deploy.sh run
# -- had been silently accumulating in the real table this whole time,
# indistinguishable from a genuine unresolved incident to anyone (including
# a health-check agent) reading that table. Mocked the same way as
# repo.update_message: swap it out for the duration of this block, restore
# in the same finally.
_orig_log_error = sch.log_error
sch.log_error = lambda *a, **k: None
try:
    _d = _delivery.Delivery()
    _d.mark()  # simulates: the send click already succeeded
    _delivery.settle_after_failure({"id": "fake-msg"}, _d, RuntimeError("teardown blew up"), channel="linkedin")
    check("settle_after_failure never writes send_status='pending' for an already-delivered message, even when the DB write itself fails",
          all(c.get("send_status") != "pending" for c in _fake_repo.calls)
          and any(c.get("send_status") == "sent" for c in _fake_repo.calls))

    _fake_repo.calls.clear()
    _d2 = _delivery.Delivery()  # never marked -- send click never happened
    _delivery.settle_after_failure({"id": "fake-msg-2"}, _d2, RuntimeError("failed before the click"), channel="linkedin")
    check("settle_after_failure still releases a NOT-yet-delivered message back to 'pending' (the original, correct retry path)",
          any(c.get("send_status") == "pending" for c in _fake_repo.calls))
finally:
    _delivery.repo.update_message = _orig_update_message
    sch.log_error = _orig_log_error

for _mod, _fn_name, _label in (
    (linkedin_send, "send_message", "linkedin_send.send_message"),
    (linkedin_send, "send_reply", "linkedin_send.send_reply"),
    (instagram_send, "send_cold_message", "instagram_send.send_cold_message"),
    (instagram_send, "send_reply", "instagram_send.send_reply"),
):
    _src = _dd_inspect.getsource(getattr(_mod, _fn_name))
    check("%s claims the message via claim_message_for_sending() before any browser work (regression check)" % _label,
          "claim_message_for_sending" in _src)
    check("%s uses the shared Delivery/settle_after_failure invariant, not a bare except-Exception reset (regression check)" % _label,
          "settle_after_failure(" in _src and "Delivery(" in _src)

# Owner-requested 2026-09-16, REVISED 2026-09-17, REVISED AGAIN 2026-09-30:
# Insurance's SENDING job still runs at a time ANCHORED near a fixed hour
# (~10:00 Beirut, jittered +/-10 min), not spread across the whole window the
# way every other tenant is via _spread_within_window(). Insurance's
# DISCOVERY jobs, however, no longer use an anchor at all as of 2026-09-30 --
# the owner asked for Zimmar and Insurance discovery to run in fully
# SEQUENTIAL, non-overlapping windows instead of one shared 20:15-03:00 span
# (Zimmar 20:00-23:00, Insurance 23:10-03:00), so there is nothing left for
# an anchor to dodge -- both tenants' discovery now uses the same
# _spread_within_window() mechanism, just against their own disjoint window.
# Verified: (1) _is_insurance_tenant() correctly identifies Insurance by
# business_name (the same identifier messaging/generate.py already keys its
# own fixed templates on) and nothing else; (2) BEHAVIORALLY, by actually
# calling build_daily_schedule() against the real live DB and reading back
# the real APScheduler jobs it produced -- Insurance's discovery jobs must
# land strictly inside 23:10-03:00 and Zimmar's strictly inside 20:00-23:00,
# on every rebuild, with neither ever crossing into the other's window; (3)
# Insurance's sending job must still land within the tight +/-10 min band
# around its 10:00 anchor and VARY across independent rebuilds (bounded
# randomness, not a fixed minute).
check("_is_insurance_tenant() identifies Insurance by business_name (same identifier generate.py's fixed templates use)",
      sch._INSURANCE_BUSINESS_NAME == _gen._INSURANCE_BUSINESS_NAME)

_INSURANCE_TENANT_ID = "cmt4i8jxh000crao9ekd6pe08"
_ZIMMAR_TENANT_ID = "cmt0o0yr30002f9p5t3eb269f"
check("_is_insurance_tenant() is True for Insurance's real tenant_id",
      sch._is_insurance_tenant(_INSURANCE_TENANT_ID))
check("_is_insurance_tenant() is False for Zimmar's real tenant_id",
      not sch._is_insurance_tenant(_ZIMMAR_TENANT_ID))

# Rebuild the real schedule against the live DB (read-only -- constructing a
# BackgroundScheduler and calling add_job on it does not start the
# scheduler or touch any data) and inspect the actual jobs produced, twice,
# to prove Insurance's time is FIXED across rebuilds while Zimmar's keeps
# moving (spread/jitter re-draws its random offset on every call).
def _job_times(jobs, id_prefix, tenant_id):
    out = {}
    for job in jobs:
        if job.id.startswith("%s-%s-" % (id_prefix, tenant_id)):
            trig = job.trigger
            hour = str(trig.fields[trig.FIELD_NAMES.index("hour")])
            minute = str(trig.fields[trig.FIELD_NAMES.index("minute")])
            out[job.id] = (hour, minute)
    return out

_sched1 = sch.build_daily_schedule()
_sched2 = sch.build_daily_schedule()

_ins_disc_1 = _job_times(_sched1.get_jobs(), "discovery", _INSURANCE_TENANT_ID)
_ins_disc_2 = _job_times(_sched2.get_jobs(), "discovery", _INSURANCE_TENANT_ID)
_ins_send_1 = _job_times(_sched1.get_jobs(), "sending", _INSURANCE_TENANT_ID)
_ins_send_2 = _job_times(_sched2.get_jobs(), "sending", _INSURANCE_TENANT_ID)
_zim_disc_1 = _job_times(_sched1.get_jobs(), "discovery", _ZIMMAR_TENANT_ID)
_zim_disc_2 = _job_times(_sched2.get_jobs(), "discovery", _ZIMMAR_TENANT_ID)

# Extra rebuilds (beyond the two above) JUST for the "varies across
# rebuilds" checks below. A single independent +/-10 min randint draw has
# a real ~1-in-21 chance of landing on the identical minute as one other
# draw -- especially visible on Insurance's sending job, which has only
# ONE account (LinkedIn) behind it, so two rebuilds coincidentally
# matching is a plausible, non-buggy flake, not evidence the jitter regressed
# to fixed. Rebuilding several more times and requiring NOT ALL of them to
# match drops the false-flake probability to (1/21)^(N-1) -- effectively
# zero at N=8 -- while still failing hard if the jitter is ever really
# removed (in which case every single rebuild is identical).
_ins_send_all = [_ins_send_1, _ins_send_2]
_ins_disc_all = [_ins_disc_1, _ins_disc_2]
_zim_disc_all = [_zim_disc_1, _zim_disc_2]
for _ in range(6):
    _extra_sched = sch.build_daily_schedule()
    _ins_send_all.append(_job_times(_extra_sched.get_jobs(), "sending", _INSURANCE_TENANT_ID))
    _ins_disc_all.append(_job_times(_extra_sched.get_jobs(), "discovery", _INSURANCE_TENANT_ID))
    _zim_disc_all.append(_job_times(_extra_sched.get_jobs(), "discovery", _ZIMMAR_TENANT_ID))

# Helper: total minutes-since-midnight for an (hour, minute) string pair,
# so "is this inside the +/-10 min band around anchor X" is a plain
# integer-range check instead of juggling hour/minute separately.
def _mins(pair):
    h, m = pair
    return int(h) * 60 + int(m)

# Insurance's discovery window (23:10-03:00) crosses midnight, but the real
# CronTrigger hour stored on a job is always a plain 0-23 wall-clock hour
# (_spread_within_window's own % 24, since APScheduler has no "hour 26"
# concept -- see that function's docstring in scheduler.py). A job that
# actually fires at 01:30 (linearly 25:30 within the window) therefore comes
# back from _job_times() as the raw pair ("1", "30"), and plain _mins() on
# that gives 90 -- nowhere near the window's 1390-1620 linear-minute range.
# This wraps any hour that could only mean "after midnight, inside this
# window" (i.e. less than the window's own start-of-day hour) back into the
# same linear timeline _spread_within_window built the window in, so the
# comparison below is apples-to-apples.
def _mins_after_midnight(pair, window_start_minutes):
    total = _mins(pair)
    if total < window_start_minutes % (24 * 60):
        total += 24 * 60
    return total

_INS_SEND_ANCHOR = 10 * 60 + 0        # 10:00
_INS_JITTER = 10  # must match scheduler._INSURANCE_JITTER_MINUTES
# WIDENED 2026-10-04, owner's explicit request -- see scheduler.py's own
# comment above _ZIMMAR_DISCOVERY_WINDOW_START_MINUTES for the full
# reasoning (real multi-day data showed a single account can take 2-4.5h,
# risking the 4th of 4 real accounts never getting a turn in the old
# 20:15-03:00 span).
# FIXED 2026-10-07, owner's explicit request: moved back to the window's
# originally-intended 18:00 start (had drifted to 18:15) -- see
# scheduler.py's own comment above _ZIMMAR_DISCOVERY_WINDOW_START_MINUTES.
_ZIMMAR_DISC_START = 18 * 60          # 18:00, must match scheduler._ZIMMAR_DISCOVERY_WINDOW_START_MINUTES
_ZIMMAR_DISC_END = 22 * 60 + 59       # 22:59, must match scheduler._ZIMMAR_DISCOVERY_WINDOW_END_MINUTES
_INS_DISC_START = 22 * 60 + 59        # 22:59, must match scheduler._INSURANCE_DISCOVERY_WINDOW_START_MINUTES
_INS_DISC_END = 27 * 60 + 59          # 03:59 next day, must match scheduler._INSURANCE_DISCOVERY_WINDOW_END_MINUTES

# Insurance's/Zimmar's LinkedIn accounts can legitimately be PAUSED (e.g.
# 2026-09-17: both paused while diagnosing droplet resource contention) --
# a paused account correctly has ZERO scheduled jobs (see the run-time
# account-status gate added earlier), so these timing/collision checks are
# only meaningful, and only run, when there's at least one real job to
# check. A paused account is not a regression; an ACTIVE account with
# broken timing is -- these checks still catch that case fully.
if _ins_disc_1:
    check("Insurance's discovery job(s) land strictly inside its own 22:59-03:59 window on both rebuilds (OWNER REQUEST 2026-09-30/2026-10-04: sequential, non-overlapping per-tenant windows)",
          all(_INS_DISC_START <= _mins_after_midnight(v, _INS_DISC_START) <= _INS_DISC_END for v in _ins_disc_1.values())
          and all(_INS_DISC_START <= _mins_after_midnight(v, _INS_DISC_START) <= _INS_DISC_END for v in _ins_disc_2.values()))
    check("Insurance's discovery time VARIES across independent rebuilds (spread/jitter, checked across 8 rebuilds so one coincidental match isn't a false flake)",
          any(x != _ins_disc_all[0] for x in _ins_disc_all[1:]))
else:
    print("   OK   Insurance's LinkedIn/Instagram/Email accounts are currently paused -- no discovery jobs to check, correctly")

if _ins_send_1:
    check("Insurance's sending job lands within +/-10 min of its 10:00 Beirut anchor on both rebuilds, and stays before 11:00",
          all(abs(_mins(v) - _INS_SEND_ANCHOR) <= _INS_JITTER for v in _ins_send_1.values())
          and all(abs(_mins(v) - _INS_SEND_ANCHOR) <= _INS_JITTER for v in _ins_send_2.values())
          and all(_mins(v) < 11 * 60 for v in _ins_send_1.values()))
    check("Insurance's sending time VARIES across independent rebuilds (owner's 2026-09-17 fix, same as discovery; checked across 8 rebuilds so one coincidental match on its single LinkedIn job isn't a false flake)",
          any(x != _ins_send_all[0] for x in _ins_send_all[1:]))
else:
    print("   OK   Insurance's LinkedIn account is currently paused -- no sending job to check, correctly")

if not _zim_disc_1:
    print("   OK   Zimmar's LinkedIn/Instagram/Email accounts are currently paused -- no discovery jobs to check, correctly")
else:
    check("Zimmar's discovery job(s) land strictly inside its own 18:00-22:59 window on both rebuilds (OWNER REQUEST 2026-09-30/2026-10-04/2026-10-07: sequential, non-overlapping per-tenant windows)",
          all(_ZIMMAR_DISC_START <= _mins(v) <= _ZIMMAR_DISC_END for v in _zim_disc_1.values())
          and all(_ZIMMAR_DISC_START <= _mins(v) <= _ZIMMAR_DISC_END for v in _zim_disc_2.values()))
    check("Zimmar's discovery time still RE-RANDOMIZES across independent rebuilds (spread/jitter unchanged, regression check)",
          any(x != _zim_disc_all[0] for x in _zim_disc_all[1:]))

# With Zimmar confined to 20:00-23:00 and Insurance confined to 23:10-03:00
# (disjoint, non-overlapping windows -- OWNER REQUEST 2026-09-30), the two
# tenants' DISCOVERY times can never literally collide by construction, so
# there is nothing left to check there. Sending still shares one
# 08:00-12:00 window across both tenants (Instagram only, LinkedIn sending
# jobs no longer scheduled at all -- see the check below), so a literal
# collision there is still worth checking directly.
_zim_send_times = (
    set(_job_times(_sched1.get_jobs(), "sending", _ZIMMAR_TENANT_ID).values())
    | set(_job_times(_sched2.get_jobs(), "sending", _ZIMMAR_TENANT_ID).values())
)
if _ins_send_1 or _zim_send_times:
    check("Insurance's jittered sending time does not exactly match any of Zimmar's own live-scheduled sending job times (either rebuild)",
          not (set(_ins_send_1.values()) & _zim_send_times)
          and not (set(_ins_send_2.values()) & _zim_send_times))
else:
    print("   OK   Both tenants' Instagram sending accounts are currently paused -- no collision to check, correctly")
if _ins_disc_1:
    check("Insurance's own discovery jobs don't collide with each other at the identical instant",
          len(set(_ins_disc_1.values())) == len(_ins_disc_1) or len(_ins_disc_1) == 1)

# OWNER REQUEST 2026-09-30: LinkedIn sending is permanently disabled and no
# longer scheduled at all -- only Instagram accounts should ever produce a
# "sending-*" job. A LinkedIn account showing up here would mean the
# sending_accounts filter in build_daily_schedule() regressed back to
# scheduling a job that does nothing when it fires.
_all_sending_jobs = [j for j in _sched1.get_jobs() if j.id.startswith("sending-") and not j.id.startswith("sending-recovery-") and not j.id.startswith("sending-catchup-")]
_sending_job_account_ids = {j.id.rsplit("-", 1)[-1] for j in _all_sending_jobs}
_linkedin_account_ids = {
    a["id"] for tid in (_ZIMMAR_TENANT_ID, _INSURANCE_TENANT_ID)
    for a in sch.pool.load_accounts(tid) if a.get("platform") == "linkedin"
}
check("No LinkedIn account has a sending job scheduled (LinkedIn sending permanently disabled, removed from the schedule entirely 2026-09-30)",
      not (_sending_job_account_ids & _linkedin_account_ids))

# ---------------------------------------------------------------------------
# Real resource-contention incident, 2026-09-17: Zimmar LinkedIn's scheduled
# sending job failed 3/3 real send attempts that morning on page-load/
# element-wait timeouts, each one landing within seconds of the reply-poll
# also having a browser open -- the droplet is 1 vCPU/1.9GB and one Chromium
# instance alone eats ~40-45% of that. Two fixes: (1) the reply polls now
# run every 30 min instead of 3, cutting poll-driven browser opens ~90%;
# (2) a global cross-process slot cap (_MAX_CONCURRENT_BROWSER_SESSIONS)
# stops two DIFFERENT accounts' sessions from ever launching Chromium at the
# same literal moment, closing the actual collision instead of just making
# it rarer.
check("reply-send poll interval raised from 3 to 30 minutes (resource-contention fix)",
      sch._REPLY_POLL_INTERVAL_MINUTES == 30)
check("reply-detection poll interval raised from 3 to 60 minutes (resource-contention fix)",
      sch._REPLY_DETECTION_POLL_INTERVAL_MINUTES == 60)

check("a global browser-slot limiter exists and is set to a small, non-zero cap",
      hasattr(sess, "_MAX_CONCURRENT_BROWSER_SESSIONS") and 1 <= sess._MAX_CONCURRENT_BROWSER_SESSIONS <= 4)
check("SessionManager acquires the global slot in __enter__, before launching Chromium (regression check)",
      "_global_session_slot" in _inspect.getsource(sess.SessionManager.__enter__)
      and _inspect.getsource(sess.SessionManager.__enter__).index("_global_session_slot")
          < _inspect.getsource(sess.SessionManager.__enter__).index("chromium.launch"))
check("SessionManager releases the global slot in __exit__, after the browser is closed (regression check)",
      "_global_session_slot" not in _inspect.getsource(sess.SessionManager.__exit__)
      and "_global_slot" in _inspect.getsource(sess.SessionManager.__exit__)
      and _inspect.getsource(sess.SessionManager.__exit__).index("_browser.close")
          < _inspect.getsource(sess.SessionManager.__exit__).index("_global_slot.__exit__"))

# Behavioral check: with the cap set to 1, a second concurrent
# SessionManager must actually raise SessionBusy rather than silently
# proceeding -- proves this is a real enforced limit, not just present code
# that's never actually reached.
_orig_cap = sess._MAX_CONCURRENT_BROWSER_SESSIONS
_orig_timeout = sess._GLOBAL_SESSION_LOCK_TIMEOUT_SECONDS
sess._MAX_CONCURRENT_BROWSER_SESSIONS = 1
sess._GLOBAL_SESSION_LOCK_TIMEOUT_SECONDS = 1
try:
    _held = sess._global_session_slot()
    _held.__enter__()
    try:
        _blocked = False
        try:
            with sess._global_session_slot():
                pass
        except sess.SessionBusy:
            _blocked = True
        check("with the slot cap at 1, a second concurrent session is genuinely blocked (SessionBusy), not silently allowed through",
              _blocked)
    finally:
        _held.__exit__(None, None, None)
    # And once released, a new acquire succeeds immediately -- proves this
    # isn't a one-way lock that permanently wedges the account/machine.
    with sess._global_session_slot():
        check("after the holder releases, a new session can acquire the same slot immediately", True)
finally:
    sess._MAX_CONCURRENT_BROWSER_SESSIONS = _orig_cap
    sess._GLOBAL_SESSION_LOCK_TIMEOUT_SECONDS = _orig_timeout

# TIGHTENED 2026-10-07, owner's explicit request: the daily cap rose to
# 15/day (was 10), so 15 approved messages must reliably finish within the
# real 08:00-12:00 Beirut window (4 hours), with real margin given the
# window-start fix the same day still leaves some slop in exactly when the
# job actually begins.
check("send-gap pacing tightened to 6-8 min (was 6-13) so 15 messages fit comfortably within the 4-hour window",
      sch._SEND_GAP_MIN_SECONDS == 6 * 60 and sch._SEND_GAP_MAX_SECONDS == 8 * 60)
check("15 messages' worst-case total gap time (14 max-length gaps) stays well under the 4-hour window",
      14 * sch._SEND_GAP_MAX_SECONDS <= 180 * 60)
check("the gap is still genuinely randomized, not a fixed interval (regression check -- a fixed cadence is itself a bot signal)",
      sch._SEND_GAP_MIN_SECONDS < sch._SEND_GAP_MAX_SECONDS)

# ---------------------------------------------------------------------------
# REAL DATA-QUALITY BUG, found and fixed 2026-09-17: hunter.py's
# find_email()/find_company_emails() took whatever email Hunter's API
# returned without ever checking Hunter's own `score` (0-100 confidence)
# or `verification.status` fields -- both returned on every response, both
# silently discarded. Confirmed real harm: lead "Kedemos Education" has
# website=https://linktr.ee/KedemosEducation (a Linktree bio-link page,
# not their real site); Domain Search was run against linktr.ee itself and
# returned pooya@linktr.ee, a stranger's email with zero connection to the
# company -- consistent with the account's 5-8% bounce rate (cold-email
# norm is ~1-2%). Two fixes: (1) a score/verification quality gate on both
# Hunter lookup functions, (2) a bio-link/social-platform domain blocklist
# checked BEFORE calling Hunter at all, in _maybe_find_email() (so a lead
# whose "website" is actually linktr.ee/instagram.com/etc. never reaches
# either Hunter endpoint in the first place).
check("Hunter's verification.status is actually read from the API response, not discarded (structural regression check)",
      "verification" in _inspect.getsource(hunter._passes_quality_gate))
check("a hard-bad verification status (invalid/disposable) is rejected",
      not hunter._passes_quality_gate({"score": 90, "verification": {"status": "invalid"}}, context="t")
      and not hunter._passes_quality_gate({"score": 90, "verification": {"status": "disposable"}}, context="t"))
check("a genuinely good status (valid/accept_all) passes at a high score",
      hunter._passes_quality_gate({"score": 90, "verification": {"status": "valid"}}, context="t")
      and hunter._passes_quality_gate({"score": 90, "verification": {"status": "accept_all"}}, context="t"))
check("a low score is rejected even with no bad status present (score is checked independently of status)",
      not hunter._passes_quality_gate({"score": 20, "verification": {"status": "unknown"}}, context="t"))
check("score exactly at the minimum threshold (%d) still passes (inclusive floor, not exclusive)" % hunter._MIN_SCORE,
      hunter._passes_quality_gate({"score": hunter._MIN_SCORE, "verification": {"status": "valid"}}, context="t"))
check("an 'unknown' verification status is accepted (not so strict this returns nothing), at an acceptable score",
      hunter._passes_quality_gate({"score": 70, "verification": {"status": "unknown"}}, context="t"))
check("a candidate with no verification block at all (missing key) does not crash and is judged on score alone",
      hunter._passes_quality_gate({"score": 70}, context="t"))

# The Kedemos Education case, exactly as it happened: website is a Linktree
# URL, not the company's real domain.
check("linktr.ee (the real Kedemos Education case) is recognized as a generic platform domain, not a company site",
      hunter.is_blocklisted_domain("linktr.ee")
      and hunter.is_blocklisted_domain("https://linktr.ee/KedemosEducation"))
check("common bio-link/social platforms are all blocklisted",
      all(hunter.is_blocklisted_domain(d) for d in
          ["instagram.com", "facebook.com", "twitter.com", "x.com", "tiktok.com",
           "bio.link", "beacons.ai", "linktree.com"]))
check("a real company domain is NOT blocklisted (regression check -- must not over-block)",
      not hunter.is_blocklisted_domain("acmesecurity.com") and not hunter.is_blocklisted_domain("tesla.com"))
_refused_blocklisted = False
try:
    hunter.find_company_emails("linktr.ee")
except ValueError:
    _refused_blocklisted = True
except Exception:
    pass  # any other exception (e.g. network) still means it did NOT silently search it
check("find_company_emails() refuses to search a blocklisted platform domain (raises, never silently searches it)",
      _refused_blocklisted)

# scheduler.py's _maybe_find_email() must apply the domain-sanity check
# BEFORE calling Hunter at all -- structural check against its real source,
# since a live call would need a real API key/network access this
# verification step doesn't have.
_mfe_src = _inspect.getsource(sch._maybe_find_email)
check("_maybe_find_email() checks is_blocklisted_domain() before either Hunter lookup tier (regression check)",
      "hunter.is_blocklisted_domain(domain)" in _mfe_src
      and _mfe_src.index("is_blocklisted_domain") < _mfe_src.index("hunter.find_email")
      and _mfe_src.index("is_blocklisted_domain") < _mfe_src.index("hunter.find_company_emails"))

# Owner-requested 2026-09-17: prefer the company's own generic address
# (info@/contact@/sales@) over a named individual's personal email when
# Hunter's Domain Search returns both -- founder/manager email is still an
# acceptable fallback (find_email() above is unaffected), but a generic
# company address should win whenever one exists and passes the quality
# gate. Verified BEHAVIORALLY by mocking Hunter's HTTP response, not just
# reading the source -- proves the actual runtime selection, not just that
# the right-looking code exists.
import httpx as _httpx

class _FakeHunterResponse:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200
        self.text = ""
    def json(self):
        return self._payload

def _fake_domain_search(emails):
    # **kwargs so this stub keeps working as the real call's signature
    # grows (e.g. the 2026-09-19 move of Hunter's key from an `api_key=`
    # query param to an X-API-KEY header added `headers=`).
    def _get(url, params=None, timeout=None, **kwargs):
        return _FakeHunterResponse({"data": {"emails": emails}})
    return _get

_orig_httpx_get = _httpx.get
try:
    _httpx.get = _fake_domain_search([
        {"value": "someone@acmesecurity.com", "type": "personal", "score": 90, "verification": {"status": "valid"}},
        {"value": "info@acmesecurity.com", "type": "generic", "score": 85, "verification": {"status": "valid"}},
    ])
    check("find_company_emails() picks the generic company address over a personal one, even when personal comes first in Hunter's own array",
          hunter.find_company_emails("acmesecurity.com") == "info@acmesecurity.com")

    _httpx.get = _fake_domain_search([
        {"value": "jane.doe@acmesecurity.com", "type": "personal", "score": 90, "verification": {"status": "valid"}},
    ])
    check("find_company_emails() falls back to a personal/named email when no generic address exists at all",
          hunter.find_company_emails("acmesecurity.com") == "jane.doe@acmesecurity.com")

    _httpx.get = _fake_domain_search([
        {"value": "bad@acmesecurity.com", "type": "generic", "score": 10, "verification": {"status": "invalid"}},
        {"value": "jane.doe@acmesecurity.com", "type": "personal", "score": 90, "verification": {"status": "valid"}},
    ])
    check("a low-quality generic candidate does NOT win over a genuinely good personal one (quality gate still applies within the preference)",
          hunter.find_company_emails("acmesecurity.com") == "jane.doe@acmesecurity.com")

    # REAL SECRET LEAK FOUND AND FIXED 2026-09-19: httpx logs every
    # request's full URL at INFO level, so passing Hunter's key as an
    # `api_key=` QUERY PARAM wrote the live key in plaintext into docker
    # logs on every lookup. Moved to an X-API-KEY header. These checks
    # capture what the code actually sends and assert the key is in the
    # header and NOT anywhere in the URL/params -- a behavioural guard, so
    # a future refactor that puts it back in the URL fails the deploy.
    _seen = {}
    def _capture_get(url, params=None, headers=None, timeout=None):
        _seen["url"] = url
        _seen["params"] = params or {}
        _seen["headers"] = headers or {}
        return _FakeHunterResponse({"data": {"emails": [
            {"value": "info@acmesecurity.com", "type": "generic", "score": 90,
             "verification": {"status": "valid"}},
        ]}})
    _httpx.get = _capture_get
    hunter.find_company_emails("acmesecurity.com")
    _key = hunter.config.HUNTER_API_KEY
    check("Hunter's API key is sent as an X-API-KEY header, not a URL query param (secret-leak regression check)",
          _seen["headers"].get("X-API-KEY") == _key and "api_key" not in _seen["params"])
    check("the real API key value appears NOWHERE in the request URL or params (secret-leak regression check)",
          bool(_key) and _key not in str(_seen["url"]) and _key not in str(_seen["params"]))
finally:
    _httpx.get = _orig_httpx_get

# ---------------------------------------------------------------------------
# 2026-09-17 real live-confirmed bug: for an EMPTY-target_niche tenant
# ("all companies" -- Zimmar and Insurance, owner's standing rule), the niche
# used to QUALIFY a candidate was the single random word _resolve_search_niche
# picked ONCE at the very top of the whole discovery cycle -- not the
# per-round search_niche that actually found that candidate. Zimmar and
# Insurance both searched "construction" the same night and surfaced the same
# real companies (Arabian Construction Co., UNITECH, Evans Engineering,
# Regbar, Murex, ITG Holding, Sword Group, NavLink, Falcon Logistics); Zimmar
# saved them because its own fixed top-of-run word happened to also be
# "construction", Insurance rejected every one of them because its fixed
# top-of-run word had randomly landed on something unrelated -- same real
# candidates, opposite outcomes, purely from this mismatch. Fix: qualify-time
# niche is now the per-round search_niche, passed via the new
# _save_if_qualified_with_reasons(), not the single fixed niche.
import re as _niche_re
_lk_src = _inspect.getsource(sch._discover_linkedin)
_ig_src = _inspect.getsource(sch._discover_instagram)

def _qualify_call_uses_search_niche(src, platform):
    # Find the _save_if_qualified_with_reasons(...) call for this platform and
    # confirm its niche argument is `search_niche` (this round's real
    # keyword), not the bare `niche` (the single fixed top-of-run value --
    # tonight's actual bug).
    m = _niche_re.search(
        r'_save_if_qualified_with_reasons\(\s*account,\s*"%s".*?\)' % platform, src, _niche_re.DOTALL,
    )
    if not m:
        return False
    call_text = m.group(0)
    return bool(_niche_re.search(r'\bsearch_niche\b', call_text)) and not _niche_re.search(r',\s*niche\s*\)', call_text)

check("LinkedIn discovery qualifies each candidate against THIS ROUND's search_niche, not the fixed top-of-run niche",
      _qualify_call_uses_search_niche(_lk_src, "linkedin"))
check("Instagram discovery qualifies each candidate against THIS ROUND's search_niche, not the fixed top-of-run niche",
      _qualify_call_uses_search_niche(_ig_src, "instagram"))
check("the old direct _save_if_qualified(...) call (fixed top-of-run niche, no reasons) is gone from both discovery loops (regression check)",
      "_save_if_qualified(account, \"linkedin\"" not in _lk_src
      and "_save_if_qualified(account, \"instagram\"" not in _ig_src)

# Behavioral proof, not just source-grepping: simulate what happened tonight
# directly through qualify_profile(), which is what actually scores a
# candidate. A bio that only mentions "construction" must qualify when
# checked against this round's real search keyword ("construction") and be
# scored worse when (as the bug did) checked against an unrelated fixed word
# picked at the top of the run ("retail") -- proving the fix's OWN target
# metric (niche mismatch costs real points) is real, then proving the code
# path now avoids it.
_construction_bio = (
    "Arabian Construction Co. is a leading Lebanese construction and "
    "building contractor with over 500 employees, delivering major "
    "infrastructure and construction projects across the region. Visit our "
    "website for details."
)
_qualifies_correct_niche, _reasons_correct = qualify.qualify_profile(
    {"display_name": "Arabian Construction Co.", "bio": _construction_bio,
     "has_website": True, "post_count": 40, "recent_activity": True,
     "follower_or_headcount": 500, "platform": "linkedin"},
    "construction",
)
_qualifies_wrong_niche, _reasons_wrong = qualify.qualify_profile(
    {"display_name": "Arabian Construction Co.", "bio": _construction_bio,
     "has_website": True, "post_count": 40, "recent_activity": True,
     "follower_or_headcount": 500, "platform": "linkedin"},
    "retail",
)
check("proves the real mismatch: the SAME real candidate qualifies when checked against the niche that actually found it (this round's search_niche)",
      _qualifies_correct_niche)
check("...and would have been penalized/could be rejected when checked against an unrelated fixed niche from a different round (tonight's actual bug)",
      "Bio mentions the target niche" in _reasons_correct
      and "Bio does not mention the target niche -- possible relevance miss" in _reasons_wrong)

# Real-niche tenants (Zimmar's actual configured niche, when non-empty) must
# be UNCHANGED: _next_search_terms only PEELS a real niche into a still
# on-topic substring, it never rotates in an unrelated random word the way
# the empty-niche branch does -- so search_niche and the original niche
# always describe the same topic for those tenants, before and after this fix.
check("a real (non-empty, non-service) configured niche is never randomized by _resolve_search_niche (regression check -- only empty/service niches rotate)",
      sch._resolve_search_niche("Security and building infrastructure integration") ==
      "Security and building infrastructure integration")
_peel_result = sch._next_search_terms(
    "Security and building infrastructure integration", "Lebanon", "Lebanon",
    False, set(),
)
check("a real configured niche's round-2 search_niche is a PEELED, still on-topic substring of the original -- never an unrelated word (so qualify-time niche stays consistent with what a real-niche tenant actually configured, same as before this fix)",
      _peel_result is not None
      and _peel_result[0] in "Security and building infrastructure integration")
check("an EMPTY niche's round-2 search_niche instead comes from the random industry rotation (confirms the fix only changes behavior for the empty/all-companies case)",
      sch._next_search_terms("construction", "Lebanon", "Lebanon", True, {"construction"})[0]
      in sch._RANDOM_INDUSTRY_TERMS)

# Rejection reasons must now reach the logs, not just be discarded --
# closes the exact observability gap that made tonight's bug hard to
# diagnose from `docker logs` alone.
import inspect as _svq_inspect
_svq_src = _svq_inspect.getsource(sch._save_if_qualified_with_reasons)
check("_save_if_qualified_with_reasons() returns qualify_profile's reasons on a rejection instead of discarding them",
      "return False, reasons" in _svq_src)
check("the LinkedIn rejection log line now includes the specific reasons, not just the candidate name",
      "rejected by qualify_profile: %s -- reasons: %s" in _lk_src)
check("the Instagram rejection log line now includes the specific reasons, not just the candidate name",
      "rejected by qualify_profile: %s -- reasons: %s" in _ig_src)

# --- 2026-09-18: unrendered LinkedIn /about pages masquerading as bad leads
# Insurance's Sept 18 run visited 161 candidates and saved 5 (3.1%), with
# 137 qualify-rejections -- 96 of them scoring exactly -6 on an IDENTICAL
# all-empty reason list and 117/137 (85%) including "Bio is missing".
# DocShipper, GFS Global Group, Regie Libanaise and Advanced Lines Group
# were all rejected this way despite being real companies with real
# websites, bios and posts. Zimmar the same night: 11 visits, 5 saves
# (45%). The root cause is page timing (1 vCPU droplet +
# wait_until="domcontentloaded"), not lead quality.
_empty_scrape = {
    "platform": "linkedin", "display_name": "DocShipper", "bio": "",
    "website": None, "has_website": False, "post_count": 0, "headquarters": "",
}
check("an all-empty /about scrape (bio+website+posts+headquarters ALL empty) is detected as a scrape failure",
      sch._linkedin_scrape_looks_empty(_empty_scrape))
check("whitespace-only bio/headquarters still counts as empty (a rendered-but-blank panel is the same failure)",
      sch._linkedin_scrape_looks_empty(dict(_empty_scrape, bio="   ", headquarters="  ")))

# The happy path must be untouched: NO extra page load for a normal or even
# a thin-but-real profile. Each of these has exactly ONE real field, which
# is enough to prove the page rendered.
check("a NORMAL scrape does not trigger the retry (no extra page loads on the happy path)",
      not sch._linkedin_scrape_looks_empty({
          "platform": "linkedin", "display_name": "DocShipper",
          "bio": "DocShipper is a Lebanese freight forwarding and logistics company.",
          "website": "https://docshipper.com", "has_website": True,
          "post_count": 12, "headquarters": "Beirut, Lebanon"}))
check("a PARTIAL scrape (bio only, no website/posts/hq) does not trigger the retry either -- that is a real thin company, not a failed render",
      not sch._linkedin_scrape_looks_empty(dict(_empty_scrape, bio="A real Lebanese trading company.")))
check("a partial scrape with ONLY a website does not trigger the retry",
      not sch._linkedin_scrape_looks_empty(dict(_empty_scrape, website="https://example.com.lb")))
check("a partial scrape with ONLY posts does not trigger the retry",
      not sch._linkedin_scrape_looks_empty(dict(_empty_scrape, post_count=3)))
check("a partial scrape with ONLY a headquarters does not trigger the retry",
      not sch._linkedin_scrape_looks_empty(dict(_empty_scrape, headquarters="Beirut, Lebanon")))

# Structural: the empty signature must route into a RETRY + distinct
# scrape-failure log, and must NOT reach qualification as a normal rejection.
check("_discover_linkedin gates a retry on the all-empty signature (not on every candidate)",
      "_linkedin_scrape_looks_empty(profile)" in _lk_src)
# REAL BUG FOUND AND FIXED 2026-10-04: this check's own string literal
# ("section.org-about-module__margin-bottom p") was the exact dead
# selector 2026-10-01's fix removed from the real retry code -- this test
# was checking scheduler.py still contained its OWN bug. Updated to check
# for the replacement anchor instead: the same get_by_role("heading",
# name="Overview") locator extract_company_profile()'s own real read
# already uses, reused here rather than introducing a second, separately-
# unverified selector.
check("the retry re-loads /about with a stronger wait than domcontentloaded (networkidle) plus an explicit about-panel selector wait",
      'wait_until="networkidle"' in _lk_src
      and 'get_by_role("heading", name="Overview")' in _lk_src)
check("a still-empty retry is logged DISTINCTLY as a scrape failure, not as a qualify rejection (this is what masked the bug in the logs)",
      "scrape failed (empty /about after retry)" in _lk_src)
check("a still-empty retry skips the candidate instead of passing empty data to qualification",
      _niche_re.search(r"scrape failed \(empty /about after retry\).*?continue", _lk_src, _niche_re.DOTALL) is not None)
check("the retry happens BEFORE the location/competitor/size checks, so recovered data flows through every check, not just qualify_profile",
      _lk_src.index("_linkedin_scrape_looks_empty(profile)") < _lk_src.index("mismatch_reason = None"))
check("the retry carries post_count/recent_activity across from the /posts/ read instead of letting extract_company_profile's placeholders overwrite them",
      'retried["post_count"] = profile.get("post_count")' in _lk_src
      and 'retried["recent_activity"] = profile.get("recent_activity")' in _lk_src)

# --- 2026-09-18: _looks_like_personal_name false-positives on LinkedIn
# LIVE-VERIFIED tonight: "Orange Business", "Alfa Telecommunications" and
# "Roman Foods" all returned True -- any Two Title-Case Words lacking a term
# from the small _BUSINESS_WORDS set. On LinkedIn that cost -2 each and
# produced 21 of the -9 scores. LinkedIn company search structurally only
# ever returns /company/ URLs, so an individual is impossible there.
def _linkedin_profile(name):
    return {"platform": "linkedin", "display_name": name,
            "bio": "A real Lebanese company providing services to businesses nationwide.",
            "has_website": True, "post_count": 8, "recent_activity": True,
            "follower_or_headcount": 200}

for _real_company in ("Orange Business", "Alfa Telecommunications", "Roman Foods"):
    _, _reasons_lk = qualify.qualify_profile(_linkedin_profile(_real_company), "")
    check("LinkedIn company %r is no longer penalized as a personal name (tonight's real false positive)" % _real_company,
          not any("matches a personal-name pattern" in r for r in _reasons_lk))

# Regression: Instagram genuinely needs this check (hashtag discovery really
# does surface individuals) -- it must be completely unchanged there.
_, _reasons_ig = qualify.qualify_profile(
    {"platform": "instagram", "display_name": "anthony_elhachem",
     "bio": "Sharing my life, travels and daily thoughts with you all.",
     "has_website": True, "post_count": 80, "recent_activity": True,
     "follower_or_headcount": 4000},
    "",
)
check("Instagram's personal-name gate still flags a real personal handle (regression check -- must NOT be weakened)",
      any("reads as an individual's account" in r for r in _reasons_ig))
_ig_qualifies, _ = qualify.qualify_profile(
    {"platform": "instagram", "display_name": "anthony_elhachem",
     "bio": "Sharing my life, travels and daily thoughts with you all.",
     "has_website": True, "post_count": 80, "recent_activity": True,
     "follower_or_headcount": 4000},
    "",
)
check("...and that Instagram individual is still hard-rejected, not saved as a lead",
      not _ig_qualifies)
check("a real Instagram BUSINESS account is still not flagged as personal (regression check -- must not over-reject)",
      qualify.qualify_profile(
          {"platform": "instagram", "display_name": "zimmar.security.systems",
           "bio": "Security systems installation and building infrastructure for offices and homes in Beirut.",
           "has_website": True, "post_count": 40, "recent_activity": True,
           "follower_or_headcount": 3000}, "")[0])

# 2026-10-14: Instagram's inbox list is virtualized (only ~10 rows exist in the page at once; older chats appear and are
# recycled again as you scroll). The reply check used to wait for a row and click it a moment later, by which time it had
# been recycled -- "Locator.click: Timeout 10000ms exceeded" on the same older leads every poll. _click_conversation()
# scrolls the list and clicks the instant the row is on screen. Simulated page: the row is on screen only during some scroll positions.
class _FakeIgLocator:
    def __init__(self, page): self.page = page
    @property
    def first(self): return self
    def is_visible(self): return self.page.row_on_screen()
    def scroll_into_view_if_needed(self, timeout=None): pass
    def click(self, timeout=None):
        if self.page.click_failures > 0:
            self.page.click_failures -= 1
            raise RuntimeError("Locator.click: Timeout exceeded (row recycled)")
        self.page.clicked += 1

class _FakeIgMouse:
    def __init__(self, page): self.page = page
    def move(self, x, y): pass
    def wheel(self, dx, dy): self.page.scrolls += 1

class _FakeIgPage:
    def __init__(self, visible_scrolls, click_failures=0, list_length=None):
        self.visible_scrolls, self.click_failures, self.list_length = set(visible_scrolls), click_failures, list_length
        self.scrolls = 0
        self.clicked = 0
        self.mouse = _FakeIgMouse(self)
    def row_on_screen(self): return self.scrolls in self.visible_scrolls
    def locator(self, selector, has_text=None): return _FakeIgLocator(self)
    def wait_for_selector(self, *a, **k): pass
    def wait_for_timeout(self, ms): pass
    def evaluate(self, js):
        # the visible rows change with every scroll until the end of the list, then stay the same
        pos = self.scrolls if self.list_length is None else min(self.scrolls, self.list_length)
        return "rows-at-%d" % pos

_igp = _FakeIgPage(visible_scrolls={4})
check("reply check scrolls the virtualized inbox until the older chat is on screen, then clicks it once",
      instagram_reply_check._click_conversation(_igp, "MOPIVU") is True and _igp.clicked == 1 and _igp.scrolls == 4)
_igp = _FakeIgPage(visible_scrolls={0})
check("a chat already at the top is clicked without scrolling",
      instagram_reply_check._click_conversation(_igp, "Angy") is True and _igp.scrolls == 0)
_igp = _FakeIgPage(visible_scrolls={2, 3}, click_failures=1)
check("a row recycled between the visibility check and the click is not an error: it keeps scrolling and clicks it next time it shows",
      instagram_reply_check._click_conversation(_igp, "Voltmax") is True and _igp.clicked == 1)
_igp = _FakeIgPage(visible_scrolls=set(), list_length=6)
check("a chat that is not in the inbox returns False once the end of the list is reached (not an exception, not 45 scrolls)",
      instagram_reply_check._click_conversation(_igp, "Nobody") is False and _igp.scrolls <= 6 + 4 and _igp.clicked == 0)
_igp = _FakeIgPage(visible_scrolls=set())
check("the scroll search is bounded even if the list never ends",
      instagram_reply_check._click_conversation(_igp, "Nobody") is False and _igp.scrolls <= instagram_reply_check._MAX_LIST_SCROLL_STEPS)

check("Reply Here's send path finds older chats with the same scrolling click (it had the same recycled-row bug)",
      "click_conversation(page, match_text)" in _inspect.getsource(instagram_send.send_reply))

# 2026-10-14 (Bashir Choucair): our own first message, rendered as a WIDE right-aligned bubble that differs slightly from the
# stored body, was classified as a lead's reply because its LEFT edge was smaller than our short follow-up bubble's. Direction
# now uses the RIGHT edge (all our bubbles end at the same x), and a near-identical bubble is treated as our known message.
_ig_repo_before_b = instagram_reply_check.repo
_ig_handle_before_b = instagram_reply_check.handle_reply_detected
_fabricated_b = []
try:
    instagram_reply_check.handle_reply_detected = lambda *a, **k: _fabricated_b.append(k.get("body") or (a[2] if len(a) > 2 else None))
    _old_text = "Hi Bashir\n\nHere's something worth knowing: your CCTV system isn't just cameras watching your building — it holds real data. Footage, access logs, sometimes client information too. We're Zimmar Tech and we have done this for 100+ companies so far."
    _stored = "Hi Bashir\n\nHere is something worth knowing. Your CCTV system holds real data, not just footage of your building. Footage, access logs, sometimes client info too. We are Zimmar Tech and we have done this for over 100 companies so far."
    _fake_bashir = _FakeReplyRepo(existing_replies=[], existing_messages=[
        {"channel": "instagram", "body": _stored},
        {"channel": "instagram", "body": "Hi Bashir,\n\nJust following up on my last message. Are you interested or not?"},
    ])
    instagram_reply_check.repo = _fake_bashir
    _live_b = [
        {"text": _old_text, "left": 150.0, "right": 1080.0},   # our long pitch: wide, right-aligned
        {"text": "Hi Bashir,Just following up on my last message. Are you interested or not?", "left": 420.0, "right": 1080.0},  # our short follow-up
    ]
    _nr, _no = instagram_reply_check._sync_thread_messages({"id": "lead-bashir"}, {"id": "acc1"}, _live_b)
    check("our own wide first message (slightly different from the stored body) is NOT recorded as a lead reply",
          _nr == 0 and not _fabricated_b)

    _fake_pos = _FakeReplyRepo(existing_replies=[], existing_messages=[
        {"channel": "instagram", "body": "Hi Rami, short opener"},
        {"channel": "instagram", "body": "Hi Rami, Just following up. Are you interested or not?"},
    ])
    instagram_reply_check.repo = _fake_pos
    _live_p = [
        {"text": "Hi Rami, short opener", "left": 700.0, "right": 1080.0},
        {"text": "Hi Rami, Just following up. Are you interested or not?", "left": 450.0, "right": 1080.0},
        {"text": "An unrelated brand new wide message from someone typed at length about many different topics here", "left": 120.0, "right": 900.0},  # left-aligned: the lead
    ]
    _nr2, _no2 = instagram_reply_check._sync_thread_messages({"id": "lead-pos"}, {"id": "acc1"}, _live_p)
    check("a genuinely new left-aligned bubble is still detected as the lead's reply (right-edge rule does not hide real replies)",
          _nr2 == 1 and len(_fabricated_b) == 1)
finally:
    instagram_reply_check.repo = _ig_repo_before_b
    instagram_reply_check.handle_reply_detected = _ig_handle_before_b

# 2026-10-15: a reply poll hung for 11+ hours holding the browser slot. The Instagram reply check now runs in its own process
# with a hard limit and is killed (slot released by the OS) if it overruns.
import time as _t2
from agent import scheduler as _sch
_t0 = _t2.time()
try:
    _sch._run_isolated([sys.executable, "-c", "import time; time.sleep(120)"], 2)
    _killed = False
except TimeoutError:
    _killed = True
check("an isolated process that overruns its limit is killed promptly instead of hanging the agent", _killed and _t2.time() - _t0 < 10)
_rc, _out = _sch._run_isolated([sys.executable, "-c", "print('hello')"], 20)
check("an isolated process that finishes normally returns its output", _rc == 0 and "hello" in _out)
check("the reply poll runs the Instagram check through the isolated runner (not in a thread that cannot be stopped)",
      "_run_instagram_reply_check_isolated(tenant_id, deadline_ts)" in _inspect.getsource(_sch.run_reply_detection_poll)
      and "check_instagram_replies(deadline_ts=deadline_ts)" not in _inspect.getsource(_sch.run_reply_detection_poll))
import agent.sending.instagram_reply_runner as _runner
check("the runner module exists with a result marker the scheduler can parse", bool(_runner.RESULT_MARKER))

# 2026-10-16: second campaign "Website Offer" (free website + 5 minute meeting). Fixed text, no-website targeting, competitor rules,
# its own afternoon sending window and evening discovery slot.
from agent.messaging import generate as _wgen
_wlead = {"business_name": "Pizza Roma", "founder_name": None}
_orig_identity = _wgen._business_identity
_wgen._business_identity = lambda: ("Website Offer", "builds websites")
try:
    _wmsg = _wgen.generate_message(_wlead, "instagram", "discovery")
    _wfu = _wgen.generate_followup_message(_wlead, "instagram", "discovery", _wmsg)
finally:
    _wgen._business_identity = _orig_identity
check("Website Offer's first message is the agreed text with the business name filled in and no dashes",
      _wmsg.startswith("Hi Pizza Roma\n\nWe noticed Pizza Roma does not have a website, so we prepared one for you, free. It is professional and friendly for your customers.")
      and "quick 5 minute meeting this week" in _wmsg and "—" not in _wmsg and "–" not in _wmsg and " - " not in _wmsg)
check("Website Offer's follow-up is the short 'interested or not' note",
      _wfu == "Hi Pizza Roma,\n\nJust following up on my last message. Are you interested or not?")
_nw = {"platform": "instagram", "display_name": "Cafe Roma", "bio": "Fresh coffee and pastries in Hamra, Beirut. Open daily. Lebanon",
       "has_website": True, "post_count": 80, "recent_activity": True, "follower_or_headcount": 2000, "handle": "caferoma"}
check("Website Offer rejects a business that already has a website linked, but only for that campaign",
      qualify.qualify_profile({**_nw, "require_no_website": True}, "")[0] is False
      and "already has a website" in qualify.qualify_profile({**_nw, "require_no_website": True}, "")[1][0])
_small = {**_nw, "has_website": False, "follower_or_headcount": 60, "require_no_website": True, "min_followers": 100}
_small_ok = qualify.qualify_profile({**_small, "min_followers": None}, "")
_small_rej = qualify.qualify_profile(_small, "")
check("Website Offer rejects a business under 100 followers, keeps an unreadable count, and the floor is off for other campaigns",
      _small_rej[0] is False and "minimum of 100" in _small_rej[1][0] and "minimum of" not in " ".join(_small_ok[1])
      and sch._WEBSITE_MIN_FOLLOWERS == 100
      and not (qualify.qualify_profile({**_small, "follower_or_headcount": None}, "")[1] or [""])[0].startswith("Hard reject: None"))
check("Website Offer's competitor rules catch a web designer and a digital agency, and leave a cafe alone",
      sch._is_competitor("Website Offer", "Web design and development studio in Beirut", None, "Pixel Studio")
      and sch._is_competitor("Website Offer", "Digital marketing agency, social media", None, "Brand Hub")
      and not sch._is_competitor("Website Offer", "Fresh coffee and pastries in Hamra, Beirut", None, "Cafe Roma"))
check("Zimmar's sending window is 06:30-12:50 with recovery at 12:55",
      sch._sending_window_minutes(False) == (6 * 60 + 30, 12 * 60 + 50) and divmod(sch._sending_window_minutes(False)[1] + 5, 60) == (12, 55))
check("Website Offer sends in the afternoon (13:00-17:50) after Zimmar's morning window and discovers (22:00) after Zimmar's evening run",
      sch._sending_window_minutes(True) == (13 * 60, 17 * 60 + 50) and sch._WEBSITE_DISCOVERY_START_MINUTES == 22 * 60
      and sch._WEBSITE_SENDING_WINDOW_START_MINUTES > sch._SENDING_WINDOW_END_MINUTES)
_ws, _we = sch._sending_window_minutes(True)
check("Website Offer window fits 25 new + 15 follow-ups (39 gaps at the 6-minute floor) from the latest start, and ends before Zimmar's 18:00 discovery",
      _we - (_ws + sch._RUN_TIME_JITTER_MINUTES) >= 39 * sch._SEND_GAP_MIN_SECONDS / 60 and _we + 5 <= sch._ZIMMAR_DISCOVERY_WINDOW_START_MINUTES)
_hs = sch._DISCOVERY_HARD_STOP_MINUTES_BY_BUSINESS
from agent.discovery import instagram as _ig_disc
import json as _json_t
class _FakePage:
    def __init__(self, reply): self.reply = reply
    def evaluate(self, js, tag):
        if isinstance(self.reply, Exception): raise self.reply
        return self.reply
_tagjson = _json_t.dumps({"data": {"top": {"sections": [{"layout_content": {"fill_items": [
    {"media": {"code": "AAA", "user": {"username": "shop_one"}}}, {"media": {"code": "BBB", "user": {"username": "shop_two"}}},
    {"media": {"code": "AAA", "user": {"username": "shop_one"}}}, {"media": {"pk": "no-code", "user": {"username": "x"}}}]}}]}}})
check("when the hashtag page renders nothing, the tag-info endpoint supplies the posts (in order, no repeats, same shape as the page reader)",
      _ig_disc.fetch_tag_posts_via_api(_FakePage([200, _tagjson]), "Lebanese Cosmetics") == [{"post_url": "/p/AAA/"}, {"post_url": "/p/BBB/"}])
check("the fallback returns [] (never raises) on an error status, bad JSON, a browser error or an empty hashtag",
      _ig_disc.fetch_tag_posts_via_api(_FakePage([429, "x"]), "a") == [] and _ig_disc.fetch_tag_posts_via_api(_FakePage([200, "not json"]), "a") == []
      and _ig_disc.fetch_tag_posts_via_api(_FakePage(RuntimeError("boom")), "a") == [] and _ig_disc.fetch_tag_posts_via_api(_FakePage([200, _tagjson]), "!!!") == [])
check("Instagram discovery uses the fallback only after the page itself returned nothing",
      "page_posts = instagram.extract_hashtag_results(page)" in inspect.getsource(sch._discover_instagram)
      and "if not page_posts:" in inspect.getsource(sch._discover_instagram)
      and "fetch_tag_posts_via_api" in inspect.getsource(sch._discover_instagram))
import inspect as _insp_rc
_rc_src = _insp_rc.getsource(instagram_reply_check.check_instagram_replies)
_rc_leads = [{"id": i, "updated_at": ("2026-10-%02d 10:00:00" % (1 + i % 28)) if i % 7 else None} for i in range(200)]
_rc_ord = instagram_reply_check.order_leads_for_check(_rc_leads, 5)
_rc_head = _rc_ord[:instagram_reply_check._HEAD_SIZE]
check("the Instagram reply check visits the newest-activity leads first, so fresh replies are never starved by the old tail",
      all(str(_rc_head[i].get("updated_at") or "") >= str(_rc_head[i + 1].get("updated_at") or "") for i in range(len(_rc_head) - 1))
      and sorted(l["id"] for l in _rc_ord) == list(range(200))
      and min(str(l.get("updated_at") or "") for l in _rc_head) >= max(str(l.get("updated_at") or "") for l in _rc_ord[instagram_reply_check._HEAD_SIZE:]))
check("...and the older leads are visited in a slice that moves every hour, so none is skipped forever",
      [l["id"] for l in instagram_reply_check.order_leads_for_check(_rc_leads, 1)[60:]] != [l["id"] for l in instagram_reply_check.order_leads_for_check(_rc_leads, 2)[60:]]
      and "order_leads_for_check(leads" in _rc_src and "_MAX_RUN_SECONDS" in _rc_src)
check("the reply check logs its progress and where it stopped (so a slow or killed run is visible)",
      "reply check: deadline reached after" in _rc_src and "reply check: lead %d of %d" in _rc_src)
from agent.crm import reply_detection as _rd, pipeline as _pl, followup as _fu
_rd_calls = {"moved": [], "status": "interested"}
_o = (_rd.repo.insert_reply, _rd.repo.get_lead, _pl.move_stage, _fu.cancel_pending)
_rd.repo.insert_reply = lambda row: None
_rd.repo.get_lead = lambda lead_id: {"id": lead_id, "status": _rd_calls["status"]}
_pl.move_stage = lambda lead_id, to, changed_by="agent": (_rd_calls["moved"].append(to), {"id": lead_id, "status": to})[1]
_fu.cancel_pending = lambda lead_id: None
import datetime as _rdt
_res = {}
for _st in ("interested", "meeting_booked", "deal_closed", "contacted", "lost"):
    _rd_calls["status"] = _st
    _rd_calls["moved"].clear()
    _rd.handle_reply_detected("L1", channel="instagram", body="hi", replied_at=_rdt.datetime(2026, 10, 19, 10, 0))
    _res[_st] = list(_rd_calls["moved"])
_rd.repo.insert_reply, _rd.repo.get_lead, _pl.move_stage, _fu.cancel_pending = _o
check("a new reply is recorded for a lead the owner already moved to interested / meeting booked / deal closed WITHOUT dropping it back to replied",
      _res["interested"] == [] and _res["meeting_booked"] == [] and _res["deal_closed"] == [])
check("...while a contacted (or lost) lead that writes back still moves to replied",
      _res["contacted"] == ["replied"] and _res["lost"] == ["replied"])
check("the Instagram reply check keeps watching leads the owner moved to interested / meeting booked",
      "interested" in _rc_src or "interested" in _insp_rc.getsource(instagram_reply_check))
from agent.core import session as _sess
_sm = _sess.SessionManager()
_blocked = []
for _st in ("paused", "warned"):
    try:
        _sm.open({"id": "x", "label": "t", "status": _st})
        _blocked.append(False)
    except _sess.AccountNotActive:
        _blocked.append(True)
    except Exception:
        _blocked.append(False)
try:
    _sm.open({"id": "x", "label": "t", "status": "active"})
    _active_passes = False
except AssertionError:
    _active_passes = True  # got past the status guard to the next line (the context-manager assert), i.e. active accounts are not blocked
except Exception:
    _active_passes = False
check("no browser session is ever opened for a paused or warned account, while an active account is not blocked",
      _blocked == [True, True] and _active_passes)
_wst = sch._website_offer_sector_terms("restaurant, cafe, beauty salon, dentist, real estate", "Lebanon")
check("Website Offer searches its own consumer sectors, each anchored to Lebanon (not the generic B2B rotation), and falls back to the generic one when none are set",
      _wst == ["restaurant lebanon", "cafe lebanon", "beauty salon lebanon", "dentist lebanon", "real estate lebanon"]
      and sch._website_offer_sector_terms("", "Lebanon") == [] and "_website_offer_sector_terms(industry, location)" in inspect.getsource(sch._run_discovery_cycle_for_tenant))
_zt = _gen._ZIMMAR_TEMPLATE_INSTAGRAM
_zmsg = _gen._zimmar_fixed_template({"business_name": "Cafe Roma", "display_name": "Cafe Roma"}, "instagram")
check("Zimmar's Instagram message is the owner's Arabic text (5 lines, the greeting filled with the business name), not the old English one",
      "علي زغيب" in _zt and "Quick question" not in _zt and len(_zt.split(chr(10))) == 5
      and _zmsg.startswith("مرحبا Cafe Roma،") and "{" not in _zmsg and "—" not in _zmsg)
check("shop/gym names like 'Ocean Fitness' and 'Fitness City' are no longer read as individuals, while 'Hsien Ismail' still is",
      not qualify._looks_like_personal_name("Ocean Fitness") and not qualify._looks_like_personal_name("Fitness City")
      and not qualify._looks_like_personal_name("Cave Gym") and qualify._looks_like_personal_name("Hsien Ismail"))
_tn = _gen._tidy_business_name
check("Website Offer messages use a clean business name: tagline cut, ALL CAPS title-cased, acronyms and normal names left alone",
      _tn("FIRST STEP") == "First Step" and _tn("MC FIT | SPORT & PERFORMANCE") == "MC FIT" and _tn("AS_GYM") == "AS GYM"
      and _tn("Doctor Gym") == "Doctor Gym" and _tn("Energy Gym") == "Energy Gym")
check("hard stops: Zimmar 21:45, Website Offer 24:00; Website Offer starts after Zimmar's stop and its stop is before the 00:30 message writing",
      _hs["zimmar"] == 21 * 60 + 45 and _hs["website offer"] == 24 * 60
      and sch._WEBSITE_DISCOVERY_START_MINUTES >= _hs["zimmar"] and _hs["website offer"] <= 24 * 60 + 30)
def _left(name, h, m):
    now = _qdt.datetime(2026, 10, 16, h, m, tzinfo=sch.ZoneInfo(sch.config.TIMEZONE))
    return round(sch._discovery_deadline(name, now) - sch.time.monotonic())
check("Zimmar discovery started at 18:00 may run until 21:45 (3h45), Website Offer started at 22:15 until midnight (1h45)",
      abs(_left("Zimmar", 18, 0) - (3 * 3600 + 45 * 60)) <= 2 and abs(_left("Website Offer", 22, 15) - (1 * 3600 + 45 * 60)) <= 2)
check("a manual or make-up run far from those hours, and other tenants, keep the plain 2.5h cap",
      abs(_left("Zimmar", 1, 0) - 9000) <= 2 and abs(_left("Zimmar", 22, 30) - 9000) <= 2 and abs(_left("Website Offer", 10, 0) - 9000) <= 2 and abs(_left("Insurance", 18, 0) - 9000) <= 2)

print()
if failures:
    print("VERIFICATION FAILED (%d): %s" % (len(failures), failures))
    sys.exit(1)
print("ALL CHECKS PASSED")
PYEOF

verify() {
  say "Verifying the code the container is ACTUALLY running"
  ssh "$DROPLET" "docker exec -i $CONTAINER python3 -" <<< "$VERIFY_PY"
}

if [[ "${1:-}" == "--verify-only" ]]; then
  verify
  exit $?
fi

# --- 1. copy ---------------------------------------------------------------
# LIVE BUG FOUND AND FIXED 2026-09-13: this list used to name each
# subdirectory explicitly (discovery, messaging, db, core) and silently
# missed FOUR real ones that already existed with real code in them --
# analysis, crm, notifications, sending. A real edit made tonight to
# agent/sending/linkedin_send.py (marking a permanent send failure with
# its reason, instead of a silent endless retry) never reached the
# droplet at all -- deploy.sh's own verification step caught it immediately
# (the check for the new code failed against what was ACTUALLY running,
# exactly what this script's whole reason-to-exist is), but any of this
# session's earlier edits to those four directories could have silently
# never deployed either, the identical class of bug this script was
# originally built to prevent for the top-level agent/*.py files.
# Building the subdirectory list from find() instead of a hand-maintained
# name means a future new subdirectory (or one added months from now) can
# never repeat this -- it just gets included automatically.
say "Copying agent source to the droplet"
scp -q -r agent/*.py "$DROPLET:$REMOTE_DIR/agent/"
# LIVE BUG FOUND AND FIXED 2026-09-13 (second bug, same session): the first
# attempt at this loop used `ssh ... < <(find ...)` -- ssh with no `-n`
# reads its OWN stdin from the terminal by default, and inside a `while
# read` loop fed by process substitution, that means ssh silently steals
# the exact stdin the loop's own `read -r subdir` needs from find's output.
# Confirmed live with `set -x`: the loop ran for exactly ONE subdirectory
# (analysis) then silently stopped, no error, `set -e` never tripped --
# sending/ never got copied a second time even after "fixing" the missing-
# directory bug above, and the very next deploy attempt failed verification
# again on the exact same two checks. `ssh -n` (redirect ssh's own stdin
# from /dev/null instead of inheriting the loop's) is the standard fix for
# a network command run inside a shell read loop.
while IFS= read -r subdir; do
  name=$(basename "$subdir")
  # venv and __pycache__ are never source to deploy -- venv is the local
  # dev virtualenv (never existed on the droplet, has its own
  # droplet-side interpreter/deps), __pycache__ is compiled bytecode the
  # droplet regenerates itself.
  [[ "$name" == "venv" || "$name" == "__pycache__" ]] && continue
  if compgen -G "$subdir/*.py" > /dev/null; then
    ssh -n "$DROPLET" "mkdir -p $REMOTE_DIR/agent/$name" >/dev/null
    scp -q -r "$subdir"/*.py "$DROPLET:$REMOTE_DIR/agent/$name/"
  fi
done < <(find agent -mindepth 1 -maxdepth 1 -type d)
ok "source copied"

# --- 2. syntax check BEFORE building --------------------------------------
say "Syntax-checking every file on the droplet"
ssh "$DROPLET" "cd $REMOTE_DIR && python3 -m compileall -q agent >/dev/null && echo ok" >/dev/null
ok "all modules parse"

# --- 3. build --------------------------------------------------------------
say "Building the image"
ssh "$DROPLET" "cd $REMOTE_DIR && docker build -f agent/Dockerfile -t $IMAGE . 2>&1 | tail -2"
ok "image built"

# --- 4. RECREATE (never 'restart' -- see the header comment) ---------------
say "Recreating the container on the new image"
ssh "$DROPLET" "
  set -e
  docker rm -f ${CONTAINER}-old 2>/dev/null || true
  docker rename $CONTAINER ${CONTAINER}-old
  docker stop ${CONTAINER}-old >/dev/null
  docker run -d --name $CONTAINER \
    --restart unless-stopped \
    --env-file $ENV_FILE \
    -v $VOLUME:/app/agent/browser_profiles \
    $IMAGE \
    python -m agent.server >/dev/null
"
sleep 6

running=$(ssh "$DROPLET" "docker ps --filter name=^/${CONTAINER}\$ --format '{{.Status}}'")
if [[ -z "$running" ]]; then
  fail "container did not start -- rolling back"
  ssh "$DROPLET" "
    docker rm -f $CONTAINER 2>/dev/null || true
    docker rename ${CONTAINER}-old $CONTAINER
    docker start $CONTAINER
  "
  fail "ROLLED BACK to the previous container. Deploy aborted."
  exit 1
fi
ok "container up: $running"

# --- 5. verify -------------------------------------------------------------
if ! verify; then
  fail "verification failed -- rolling back"
  ssh "$DROPLET" "
    docker rm -f $CONTAINER
    docker rename ${CONTAINER}-old $CONTAINER
    docker start $CONTAINER
  "
  fail "ROLLED BACK to the previous container. Deploy aborted."
  exit 1
fi

say "Agent logs"
ssh "$DROPLET" "docker logs --tail 15 $CONTAINER 2>&1"

say "DEPLOY COMPLETE"
ok "new code is live and verified"
printf '   previous container kept as %s-old (remove with: docker rm %s-old)\n' "$CONTAINER" "$CONTAINER"
