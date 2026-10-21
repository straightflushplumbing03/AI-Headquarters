#!/usr/bin/env python3
"""Report the health of recent runs for an automation.

Usage:
    python3 check_run.py [automation_id]

Reads GET /api/automation/v1/<id>/runs and prints status, current_phase,
timestamps, cost, and any error_detail.

Interpreting the output:
  - A healthy run shows concrete task text in current_phase (e.g. "Write the
    daily report"). The legacy broken job sat at "Starting automation" with
    conversation_id None, which means the wrapper died before any agent ran.
  - status FAILED with error_detail "Timed out" means the run hit the 1800 s
    platform ceiling. That does NOT mean no work was done — check for a pushed
    branch and an open PR before concluding anything.
  - Compare completed_at - started_at against the 1800 s cap to see how close
    the run came to the limit.

Requires OPENHANDS_API_KEY. Override the host with OPENHANDS_HOST.
"""
import json
import os
import sys
import urllib.request

DEFAULT_AUTOMATION_ID = "1485d659-8663-4776-a507-db0fefed8483"


def main() -> int:
    automation_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_AUTOMATION_ID
    host = os.environ.get("OPENHANDS_HOST", "https://app.all-hands.dev").rstrip("/")
    api_key = os.environ.get("OPENHANDS_API_KEY")
    if not api_key:
        print("OPENHANDS_API_KEY is not set", file=sys.stderr)
        return 2

    url = f"{host}/api/automation/v1/{automation_id}/runs?limit=5"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)

    runs = data.get("items") or data.get("runs") or []
    print(f"automation {automation_id}")
    print(f"runs: {len(runs)}\n")
    for r in runs:
        started = r.get("started_at") or ""
        completed = r.get("completed_at") or ""
        elapsed = ""
        if started and completed:
            try:
                from datetime import datetime

                delta = datetime.fromisoformat(completed.replace("Z", "")) - datetime.fromisoformat(
                    started.replace("Z", "")
                )
                secs = int(delta.total_seconds())
                pct = round(secs / 1800 * 100)
                elapsed = f"{secs}s ({pct}% of the 1800s cap)"
            except Exception:
                pass

        print(f"  status={r.get('status')}  phase={r.get('current_phase')!r}")
        print(f"    started={started}")
        print(f"    completed={completed}")
        if elapsed:
            print(f"    elapsed={elapsed}")
        print(f"    conversation_id={r.get('conversation_id')}")
        print(f"    cost={r.get('cost')}")
        if r.get("error_detail"):
            print(f"    error_detail={str(r['error_detail'])[:400]}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
