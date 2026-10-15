"""
Runs ONE Instagram reply check in its own process:  python -m agent.sending.instagram_reply_runner <tenant_id> <deadline_ts>

WHY A SEPARATE PROCESS (2026-10-15, real incident): the reply poll started at 12:55 and never finished. It sat inside a browser
call that never returned, holding the single browser slot for 11+ hours -- so the last follow-up, the 18:00 discovery (it waited
45 minutes and gave up) and every health check all failed. A Python thread cannot be stopped from outside, and the slot is held
for as long as that thread lives. A process can be killed, and the slot is an OS file lock that the OS releases the moment the
process dies. The scheduler therefore runs the check here, with a hard time limit, and kills it if it overruns.

Prints the results as JSON after a marker line so the scheduler can read them out of any log noise.
"""

from __future__ import annotations

import json
import sys

RESULT_MARKER = "@@REPLY_CHECK_RESULT@@"


def main(argv: list[str]) -> int:
    tenant_id, deadline_ts = argv[1], float(argv[2])
    from agent.db.repositories import tenant_scope
    from agent.sending import instagram_reply_check

    with tenant_scope(tenant_id):
        results = instagram_reply_check.check_instagram_replies(deadline_ts=deadline_ts)
    sys.stdout.write("\n" + RESULT_MARKER + json.dumps(results, default=str) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
