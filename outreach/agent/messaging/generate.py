"""
Personalised message generation via Claude Sonnet.

Must read as human, not AI. Greeting uses whichever name exists: business,
team, or founder. Body references that specific lead's weak points and AI
opportunities from Phase 4's analysis. Tone adapts per platform -- LinkedIn
more formal, WhatsApp and Instagram more direct/casual (a DM, not a memo).
"""

from __future__ import annotations

from agent import config
from agent.analysis import client as claude_client
from agent.analysis import prompts
from agent.db import repositories as repo
from agent.messaging import style as style_module

_PLATFORM_TONE = {
    "linkedin": "Formal, professional tone -- this is a LinkedIn message to a business contact.",
    "whatsapp": "Direct, casual tone -- this is a WhatsApp message, closer to texting a person "
                "than emailing a company.",
    "instagram": "Casual, warm tone -- this is an Instagram DM, informal but respectful.",
    "email": "Professional but warm tone -- this is a cold email to a business contact's inbox, "
             "not a LinkedIn Page message or a DM. Read as a standalone note with its own opening "
             "line (the subject line is generated separately, do not repeat it in the body).",
}

_MESSAGE_RULES = """Rules:
- Open with a greeting using the exact name given -- never "Hi there" or "Hello business owner". Put a line break (a real newline, not just a space) after the greeting line before the message body starts -- never run the greeting straight into the first sentence on the same line ("Hello Acme,here's why" is wrong; "Hello Acme,

Here's why" is right).
- If a SPECIFIC weak point or AI opportunity is given, reference at least one -- never vague \
("I noticed some areas to improve") -- always concrete ("your booking takes 12h" not "your \
booking could be faster"). If none is given ("none identified"), don't wait for one or invent a \
problem that isn't there -- open the conversation by offering the sender's services directly \
instead (what they do, plainly, and why it could be relevant to this lead).
- Keep it short -- 3-5 sentences, not a pitch deck. This opens a conversation, it doesn't close a sale.
- No exclamation-point enthusiasm, no emojis, no "I hope this message finds you well".
- Never use the words "streamline", "leverage", "revolutionize", or "unlock" -- they read as AI-generated.
- End with a low-pressure question or invitation to reply, not a hard call-to-action.

Respond with ONLY the message text, nothing else -- no preamble, no quotes around it, no "Here's \
a message:"."""

_FOLLOWUP_RULES = """Rules:
- Same greeting formatting as a first message: a real line break after the greeting line, never running it straight into the first sentence on the same line.
- This is a FOLLOW-UP to a message already sent that got no reply -- it must NOT repeat the \
original pitch or re-explain the same weak point in the same words. A lead who ignored the first \
message won't read a near-duplicate any differently.
- Open with the greeting name, but acknowledge briefly that this is a second note (e.g. "circling \
back", "following up", "wanted to check back") -- don't pretend it's the first contact.
- Bring something NEW: either a different angle on the business (a second weak point/opportunity \
if one exists), a lower-friction ask ("even a quick no works"), or genuine curiosity about why they \
haven't responded -- never just restate the original in different words.
- Keep it VERY SHORT -- 1-2 sentences, ideally one. A follow-up earns less of the reader's \
attention than the first message did, not more; a long second note reads as more desperate, not \
more thorough.
- No exclamation-point enthusiasm, no emojis, no guilt-tripping ("just following up again!!"), no \
"just circling back" as the entire message with nothing else.
- Never use the words "streamline", "leverage", "revolutionize", or "unlock" -- they read as AI-generated.
- End with a low-pressure question or invitation to reply, not a hard call-to-action.

Respond with ONLY the message text, nothing else -- no preamble, no quotes around it, no "Here's \
a message:"."""


def _greeting_name(lead: dict) -> str:
    """
    Whichever name actually exists, in order of preference: a named founder
    (most personal), then the business name. Never a generic fallback like
    "there" gets used silently -- the spec requires a real name, so a lead
    with neither shouldn't reach message generation in the first place.
    """
    return lead.get("founder_name") or lead.get("business_name") or "there"


# Fallback for templates that use the company name MID-SENTENCE rather than
# as a greeting. "there" is fine after "Hello" but produces broken English
# anywhere else -- LIVE-CONFIRMED 2026-09-13, a nameless lead generated
# "Worth a quick check on there's setup?" and "brands like there?", both of
# which would have been sent to a real prospect verbatim. Discovery does
# normally populate business_name (scheduler.py saves display_name into it),
# so this only fires when a scrape genuinely failed to read the name.
_GENERIC_COMPANY_FALLBACK = "your company"


def _company_name_in_sentence(lead: dict) -> str:
    """
    The company name for use inside a sentence, with a fallback that still
    reads as English when the name is missing. See
    _GENERIC_COMPANY_FALLBACK's comment for the real bug behind this.
    """
    return lead.get("business_name") or _GENERIC_COMPANY_FALLBACK


def build_system_prompt(
    channel: str,
    message_style: str,
    business_name: str,
    business_description: str,
    is_followup: bool = False,
) -> str:
    """
    Assemble the system prompt for one message-generation call: fixed
    intro (identifying the sending business -- tenant-configurable, see
    OutreachSettings.businessName/businessDescription, NOT a hardcoded
    identity, since each tenant runs their own outreach for their own
    business), the channel's tone, the active style's guide, and the fixed
    rules block. The same (channel, style, business identity, is_followup)
    combination always produces the exact same string, which is what lets
    prompt caching pay off here -- every message generated on the same
    channel/style/kind/tenant hits the cache, not just repeats within one
    run.

    `is_followup` swaps in _FOLLOWUP_RULES instead of _MESSAGE_RULES -- a
    follow-up must read as a genuinely different, shorter second note, not
    a re-send of the original pitch (see _FOLLOWUP_RULES for exactly what
    that requires).
    """
    tone = _PLATFORM_TONE.get(channel, _PLATFORM_TONE["linkedin"])
    guide = style_module.style_guide(message_style)
    rules = _FOLLOWUP_RULES if is_followup else _MESSAGE_RULES
    name = business_name or "our business"
    description = business_description or "a business reaching out to potential clients"

    return f"""You write short, personalized outreach messages for {name}, {description}, to send \
to businesses found on social media. The message must read as if a real person wrote it -- no \
AI-sounding phrasing, no generic templates, no corporate buzzwords.

{tone}

{guide}

{rules}"""


def format_personalization_context(
    lead: dict, original_body: str | None = None, follow_up_guidance: str | None = None,
) -> str:
    lines = [
        f"Greeting name: {_greeting_name(lead)}",
        f"Business: {lead.get('business_name') or 'unknown'}",
        f"Industry: {lead.get('industry') or 'unknown'}",
        f"Weak points: {', '.join(lead.get('weak_points') or []) or 'none identified'}",
        f"AI opportunities: {', '.join(lead.get('ai_opportunities') or []) or 'none identified'}",
    ]
    if original_body:
        lines.append(f"Original message already sent (no reply yet): {original_body}")
    # Owner-editable free text (Follow-ups page, OutreachSettings.followUpGuidance),
    # applies to every follow-up for this tenant. Guidance only, NOT a
    # template -- _FOLLOWUP_RULES still requires a genuinely fresh message
    # that doesn't repeat the original pitch; this just tells Claude what
    # that fresh message should be about, e.g. "mention our new pricing".
    if follow_up_guidance:
        lines.append(f"What this follow-up should be about (from the account owner): {follow_up_guidance}")
    return "\n".join(lines)


def _business_identity() -> tuple[str, str]:
    """
    This tenant's sending identity, from OutreachSettings (relies on
    tenant_scope() being active, same ambient-tenant call shape as every
    other repo.get_settings() call site -- see repositories.py's docstring).
    Two clients running simultaneously each get their own name/description
    here, never a shared hardcoded identity.
    """
    settings = repo.get_settings() or {}
    return settings.get("business_name") or "", settings.get("business_description") or ""


# 2026-09-02: the platform owner asked for Insurance's outreach to use two
# FIXED templates instead of AI-generated text -- explicit instruction was
# "do not add something from your own", so this is literal template text
# the owner reviewed and approved, not an AI-written prompt. Matched on
# business_name (unique per tenant, same identifier _business_identity()
# above already reads) so this only ever applies to this one tenant --
# every other tenant's generate_message() call keeps going through the
# normal AI-generation path below, completely untouched.
_INSURANCE_BUSINESS_NAME = "Partners Insurance Consultancy"

# REPLACED 2026-09-19, real owner instruction: the old Template A implied
# the company lacks insurance ("I noticed your team doesn't currently show
# a group employee insurance benefit") -- owner does not want that
# suggested AT ALL, since most companies already have some form of
# insurance and the message shouldn't presume otherwise. New single angle,
# used for every lead regardless of detected gap: lead with the fact that
# NO insurer in Lebanon offers dental coverage, and that a company can add
# it ALONGSIDE whatever commercial insurance they already have, not instead
# of it. This replaces both former templates (gap/no-gap) with one -- the
# "no assumption about existing coverage" framing makes the gap/no-gap
# split itself unnecessary, and the owner's instruction was to remove the
# assumption everywhere, not just in the no-gap case.
#
# UPDATED 2026-09-19: "annual coverage for cleanings, extractions,
# fillings" reworded to "free unlimited cleanings, extractions, and
# fillings" per owner instruction -- those three are unlimited. The
# consultation stays explicitly ONE free consultation, not unlimited --
# owner's direct correction the same day ("the consultation one for free
# only so put one free con[sultation]").
#
# Length checked against LinkedIn Page inbox's 25-750 char limit (see the
# dated history above this comment for why that limit is load-bearing):
# 620 chars with a long real company name ("Mediterranean Pharmaceutical
# Company"), 589 with the "there" fallback -- both comfortably under 750,
# same "only the greeting varies" structure that keeps a long name from
# ever pushing this over the limit.
_INSURANCE_TEMPLATE = """Hello {company_name},

We're introducing Lebanon's first Dental Card — a dental benefit no insurance company in Lebanon currently offers. Even if you already have commercial insurance, you can add this while keeping your existing coverage as is.

The dental card includes: free unlimited cleanings, extractions, and fillings, plus one free consultation, plus 50-70% off implants, crowns, orthodontics, and oral surgery. No medical exams, no pre-existing condition screening, open to all ages from day one — just USD 50 per person/year.

Would it be worth a quick call to see if this fits your team?"""


def _insurance_fixed_template(lead: dict) -> str:
    """
    Single fixed template for every Insurance lead, regardless of whether
    analysis detected a "gap" -- see _INSURANCE_TEMPLATE's own comment for
    why the owner had the former gap/no-gap split removed: it never assumes
    (or implies) the company lacks insurance either way, only that dental
    coverage is a genuinely new addition to whatever they already have.
    """
    company_name = lead.get("business_name") or "there"
    return _INSURANCE_TEMPLATE.format(company_name=company_name)


# FIXED templates for Zimmar (CCTV/network security review outreach),
# agreed with the owner 2026-09-10 -- same "literal text the owner
# approved, not an AI-written prompt" posture as Insurance's own fixed
# templates above, but keyed by CHANNEL rather than gap/no-gap, since the
# owner approved three separate channel-specific drafts (email reads
# noticeably more formal/longer than the Instagram DM) rather than one
# shared body. Matched on business_name, same mechanism as Insurance --
# only this one tenant's generate_message() calls ever reach this path.
#
# Sender identity is hardcoded as "Zimmar Tech" / "100+ companies" (owner's
# real, approved values, confirmed 2026-09-10) -- no signature line at all,
# by the owner's own choice, unlike Insurance's templates above which don't
# use one either. If the owner's own name/title/contact details are ever
# wanted back in, add them the same literal-text way Insurance's templates
# do (a fixed string, not a lead-data substitution).
_ZIMMAR_BUSINESS_NAME = "Zimmar"

# SHORTENED 2026-09-13: the original (with bullet list) was 784-785 chars
# filled -- LinkedIn's Page inbox HARD-REJECTS anything outside 25-750,
# confirmed live when TEAMWORK ENERGY's send failed with exactly that error.
# Two changes made the fix durable, not just a one-time trim:
#   1. Bullets folded into one flowing sentence -- bullet markers/line
#      breaks cost characters with no content benefit here.
#   2. Closing line no longer inserts {company_name} at all (was "on
#      {company_name}'s setup?") -- a long real company name
#      ("Advanced Construction Technology Services International") could
#      push a future edit back over 750 even after this trim. "your setup"
#      reads identically and makes the template's length FIXED regardless
#      of lead name length, so this specific failure mode cannot recur.
# Fixed length: 710 chars, always -- verified via len() before shipping.
# SIMPLIFIED 2026-10-07, owner's explicit request ("simpler english, no
# dasher, human one"): rewrote both templates in plainer, more
# conversational English and removed every em dash (the "dasher" the owner
# meant) -- replaced with periods/commas instead, so sentences read like
# something a person typed, not a copy-edited one-liner. Same message,
# same structure, same length constraints (LinkedIn still fixed under 750
# chars, verified via len() before shipping, same as the original).
_ZIMMAR_TEMPLATE_LINKEDIN = """Hi {greeting_name},

Quick question. Your CCTV system holds real data, not just footage. Access logs, sometimes client info too. Most systems still use the default login, on the same network as everything else.

One weak point can mean stolen footage, a way into your systems, downtime if it gets breached, or legal trouble. There is also a quieter risk. Employees watching footage they should not, or deleting it when something goes wrong, with nobody checking who has access.

Most companies only find out after it already happened.

We are Zimmar Tech. We run full security checks for facilities and security companies. Done it for over 100 companies so far.

Worth a quick look at your setup?"""

_ZIMMAR_TEMPLATE_INSTAGRAM = """Hi {greeting_name} \U0001F44B

Here is something worth knowing. Your CCTV system holds real data, not just footage of your building. Access logs, sometimes client info too. Most of these still use the default login, on the same network as everything else.

That one weak point can cause real damage. Stolen or leaked footage, a way into your main systems, unexpected downtime, or legal trouble. There is also a quieter risk. Employees watching footage they should not, or deleting it when something goes wrong, with no one checking who has access. Most companies only find out after it already happened.

We are Zimmar Tech. We run full security checks for facilities and security companies, cameras, network, access, backups, all of it. We have done this for over 100 companies so far.

Want us to take a quick look at {company_name}'s setup?"""

# ADDED 2026-10-07, real bug found and fixed live: this channel never had
# its own template. generate_message()'s email path (scheduler.py's
# _run_message_generation_cycle_for_tenant, the "a LinkedIn/Instagram lead
# whose bio had a plain-text email also gets a real email message" branch)
# calls straight into _zimmar_fixed_template(lead, "email") -- the comment
# that used to sit on this function claiming "email is handled entirely by
# the Next.js/SES pipeline, never by this Python agent" was wrong: SES
# (src/lib/actions/outreach-approvals.ts's sendIfEmailChannel) sends
# whatever is in OutreachMessage.body verbatim as the email HTML, and this
# Python agent is the only thing that ever writes that body. With no email
# branch, `channel == "email"` fell through to the LinkedIn template
# (`else`), so every bio-found-email lead for Zimmar got a LinkedIn-flavored
# message ("Worth a quick look at your setup?", no greeting/sign-off
# appropriate for an inbox) silently emailed to a real prospect. Written to
# read as a standalone email (own opening line, no dependency on a
# platform's own message-preview chrome), same facts/claims as the other
# two channels.
_ZIMMAR_TEMPLATE_EMAIL = """Hi {greeting_name},

Quick note. Your CCTV system holds real data, not just footage, access logs, sometimes client info too. Most systems we see still use the default login, on the same network as everything else.

One weak point can mean stolen footage, a way into your systems, downtime if it gets breached, or legal trouble. There is also a quieter risk: employees watching footage they should not, or deleting it when something goes wrong, with nobody checking who has access. Most companies only find out after it already happened.

We are Zimmar Tech. We run full security checks for facilities and security companies, cameras, network, access, backups, all of it. We have done this for over 100 companies so far.

Worth a quick look at {company_name}'s setup?"""


def _zimmar_fixed_template(lead: dict, channel: str) -> str:
    """
    One fixed template per channel (LinkedIn/Instagram/email), all three
    owner-approved, same "literal text, not an AI-written prompt" posture as
    Insurance's template above. See _ZIMMAR_TEMPLATE_EMAIL's own comment for
    the real bug this channel branch fixes -- email messages ARE generated
    by this Python agent (scheduler.py's message-generation cycle), not by
    the Next.js/SES side, which only ever sends whatever body is already on
    the OutreachMessage row.
    """
    greeting_name = _greeting_name(lead)
    if channel == "instagram":
        template = _ZIMMAR_TEMPLATE_INSTAGRAM
    elif channel == "email":
        template = _ZIMMAR_TEMPLATE_EMAIL
    else:
        template = _ZIMMAR_TEMPLATE_LINKEDIN
    return template.format(
        greeting_name=greeting_name,
        company_name=_company_name_in_sentence(lead),
    )


# FIXED template for MJivity (3D/CGI creative studio outreach), agreed with
# the owner 2026-09-12 -- same "literal text the owner approved" posture as
# Zimmar/Insurance above. Instagram-only for now: MJivity's LinkedIn
# account is paused (owner's explicit instruction 2026-09-12 -- run only on
# Instagram right now), so no LinkedIn template exists yet. If LinkedIn is
# ever reactivated for this tenant, add a _MJIVITY_TEMPLATE_LINKEDIN the
# same way Zimmar has two channel variants, rather than reusing this one --
# the owner's Instagram draft was written for that channel's casual tone
# specifically, not vetted for LinkedIn's more formal one.
_MJIVITY_BUSINESS_NAME = "MJivity"

_MJIVITY_TEMPLATE_INSTAGRAM = """Hi {greeting_name} \U0001F44B

Your product deserves visuals that actually stop the scroll — not another flat product photo everyone's seen a hundred times. We build CGI product visuals, 3D anamorphic billboards, and viral-style visual campaigns for brands who want to look like a completely different league without the cost or hassle of a real physical shoot.

We're MJivity — a 3D creative studio working with brands across Lebanon, the GCC, and the MENA region. If your current visuals feel outdated or you're just running the same static ad creative on repeat, this might be worth a look.

Want us to send over a few examples of what we've done for brands like yours?"""


def _mjivity_fixed_template(lead: dict, channel: str) -> str:
    """
    Instagram only today -- see this constant block's own comment on why
    there's no LinkedIn variant yet (account paused, not just unused).
    Falls through to the normal AI-generation path for any other channel
    (e.g. if a future email account gets added for this tenant) rather
    than silently reusing an Instagram-toned draft somewhere it wasn't
    written for.
    """
    greeting_name = _greeting_name(lead)
    return _MJIVITY_TEMPLATE_INSTAGRAM.format(greeting_name=greeting_name)


# LinkedIn's Page inbox hard-rejects anything outside 25-750 characters
# (sending/linkedin_send.py raises MessageLengthInvalid on it). Enforced
# here at GENERATION time as well, added 2026-09-16: until now the only
# check was at send time, so an over-length message was generated,
# approved by a human, queued, and only then failed -- which is exactly
# how 12 Insurance messages sat unsendable in the queue. Applied to EVERY
# generate_message() return path (2026-09-16), fixed templates included --
# they are each verified under the limit by construction today, but a
# future wording edit is exactly how the over-length failure recurs.
_CHANNEL_MAX_CHARS = {"linkedin": 750}


def _enforce_channel_length(body: str, channel: str) -> str:
    """
    Trim an over-length generated message at a sentence or paragraph
    boundary rather than mid-word, so a message that would be rejected at
    send time is shortened here instead of failing later.
    """
    limit = _CHANNEL_MAX_CHARS.get(channel)
    if limit is None or len(body) <= limit:
        return body
    truncated = body[:limit]
    # Prefer the last paragraph break, then the last sentence end, so the
    # result still reads as a finished message rather than a cut-off one.
    for boundary in ("\n\n", ". ", "? ", "! "):
        cut = truncated.rfind(boundary)
        if cut > limit // 2:
            return truncated[:cut + len(boundary)].strip()
    return truncated.strip()


def generate_message(lead: dict, channel: str, message_style: str, model: str | None = None) -> str:
    """
    Generate one personalized outreach message for one lead on one channel.

    `channel` is "linkedin", "whatsapp", "instagram", or "email" -- affects tone.
    `message_style` is style.DIRECT or style.DISCOVERY -- affects how weak
    points are framed. Returns the raw message text, ready to store on
    messages.body.
    """
    business_name, business_description = _business_identity()
    if business_name == _INSURANCE_BUSINESS_NAME:
        body = _insurance_fixed_template(lead)
    elif business_name == _ZIMMAR_BUSINESS_NAME:
        body = _zimmar_fixed_template(lead, channel)
    elif business_name == _MJIVITY_BUSINESS_NAME and channel == "instagram":
        body = _mjivity_fixed_template(lead, channel)
    else:
        model = model or config.MODEL_MESSAGES
        system = prompts.cacheable_system(
            build_system_prompt(channel, message_style, business_name, business_description)
        )
        user_content = format_personalization_context(lead)
        body = claude_client.call_text(system, user_content, model)

    # The guard covers the FIXED-TEMPLATE paths too, not just the AI one.
    # Today's templates are each verified under the limit by construction,
    # but a future owner-approved wording edit is exactly how this recurs:
    # both the Zimmar (2026-09-13) and Insurance (2026-09-16) templates
    # silently grew past LinkedIn's 750-char limit and only surfaced as
    # MessageLengthInvalid at send time, after a human had already approved
    # and queued them. Applying it once, at the single exit point, means no
    # template can ever bypass it again.
    return _enforce_channel_length(body, channel)


def generate_followup_message(
    lead: dict, channel: str, message_style: str, original_body: str,
    model: str | None = None, follow_up_guidance: str | None = None,
) -> str:
    """
    Generate a follow-up message -- distinct from generate_message(): the
    system prompt swaps in _FOLLOWUP_RULES (shorter, acknowledges this is a
    second note, forbids repeating the original pitch) and the original
    sent message is included in the personalization context so Claude can
    actually avoid restating it rather than just being told not to.

    `follow_up_guidance` is the owner's own free text from the Follow-ups
    page (OutreachSettings.followUpGuidance) -- optional, added 2026-09-15.
    Passed through as extra context only; _FOLLOWUP_RULES still applies in
    full, so the result is never a fixed template, always a fresh message.
    """
    model = model or config.MODEL_MESSAGES
    business_name, business_description = _business_identity()
    system = prompts.cacheable_system(
        build_system_prompt(channel, message_style, business_name, business_description, is_followup=True)
    )
    user_content = format_personalization_context(
        lead, original_body=original_body, follow_up_guidance=follow_up_guidance,
    )
    return _enforce_channel_length(claude_client.call_text(system, user_content, model), channel)
