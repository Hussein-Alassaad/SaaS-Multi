"""
Manual, on-demand LinkedIn test-send tool.

LinkedIn message GENERATION is permanently disabled in the normal pipeline
(scheduler.py's OWNER DECISION 2026-10-02 -- see
_run_message_generation_cycle_for_tenant's own comment) because of the
unresolved Page-messaging rate-limit ("you have reached the limit for
starting new conversations with Pages"). This script exists purely to keep
testing whether that limit is still live, on demand, without re-enabling
LinkedIn sending in the real automated pipeline or the dashboard.

It builds ONE real outreach_messages row for ONE lead the normal way
(message_generate.generate_message, repo.insert_message, auto-approved) and
sends it through the real linkedin_send.send_message() path -- the exact
same claim/settle/duplicate-send-safe machinery a real automated send uses,
so a successful send here is a genuine, trustworthy signal, not a special
code path that could behave differently from production.

Usage (run inside the agent container):
    docker exec nexaris-agent python3 agent/scripts/test_linkedin_send.py <lead_id>
    docker exec nexaris-agent python3 agent/scripts/test_linkedin_send.py --business-name "Falcon Logistics"

Only ever sends to ONE lead per invocation -- this is a manual diagnostic
tool, not a backdoor around the pipeline's own disable switch. Does not
touch config.py or the scheduler's channel-generation logic at all.
"""

from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))

from agent.db import repositories as repo
from agent.messaging import generate as message_generate
from agent.messaging import style as message_style
from agent.sending import linkedin_send

ZIMMAR_TENANT_ID = "cmt0o0yr30002f9p5t3eb269f"


def _find_lead(lead_id: str | None, business_name: str | None) -> dict:
    """Must be called from inside an active repo.tenant_scope(...) block."""
    if lead_id:
        lead = repo.get_lead(lead_id)
        if not lead:
            raise SystemExit(f"No lead found with id {lead_id!r}.")
        return lead
    leads = repo.leads_by_status("approved") + repo.leads_by_status("awaiting_approval") \
        + repo.leads_by_status("analyzed") + repo.leads_by_status("contacted")
    for lead in leads:
        if lead.get("business_name") == business_name:
            return lead
    raise SystemExit(f"No lead found with business_name {business_name!r} in a usable status.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lead_id", nargs="?", help="OutreachLead.id to send to")
    parser.add_argument("--business-name", help="Find the lead by business name instead of id")
    parser.add_argument("--tenant-id", default=ZIMMAR_TENANT_ID)
    args = parser.parse_args()

    if not args.lead_id and not args.business_name:
        parser.error("pass either a lead_id or --business-name")

    with repo.tenant_scope(args.tenant_id):
        lead = _find_lead(args.lead_id, args.business_name)
        print(f"Target lead: {lead.get('business_name')} ({lead['id']}) -- platform={lead.get('platform')}, profile_url={lead.get('profile_url')}")

        if lead.get("platform") != "linkedin":
            raise SystemExit(f"This lead's platform is {lead.get('platform')!r}, not 'linkedin' -- refusing to send a LinkedIn message to it.")
        if not lead.get("profile_url"):
            raise SystemExit("This lead has no profile_url -- nothing to send to.")

        existing = [
            m for m in repo.messages_for_lead(lead["id"])
            if m.get("channel") == "linkedin" and m.get("send_status") == "sent"
        ]
        if existing:
            raise SystemExit(
                f"This lead already has a SENT LinkedIn message ({existing[0]['id']}) -- "
                "refusing to send a second real cold message to the same lead. "
                "Pick a different lead if you need another test."
            )

        active_style = message_style.get_active_style()
        body = message_generate.generate_message(lead, "linkedin", active_style)
        print(f"\nGenerated message ({len(body)} chars):\n{'-' * 60}\n{body}\n{'-' * 60}\n")

        message = repo.insert_message({"lead_id": lead["id"], "channel": "linkedin", "body": body})
        message = repo.update_message(message["id"], {
            "approval_status": "approved",
            "approved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        })

        print(f"Message {message['id']} created and approved. Sending now...\n")
        try:
            result = linkedin_send.send_message(message)
            print("SEND SUCCEEDED:", result)
        except linkedin_send.PageMessagingRateLimited as exc:
            print("RATE LIMIT STILL LIVE:", exc)
            sys.exit(2)
        except linkedin_send.NoMessageButtonAvailable as exc:
            print("NO MESSAGE BUTTON (permanent, unrelated to the rate limit):", exc)
            sys.exit(3)
        except Exception as exc:  # noqa: BLE001 -- this is a diagnostic script, show the real error
            print(f"SEND FAILED ({type(exc).__name__}):", exc)
            sys.exit(1)


if __name__ == "__main__":
    main()
