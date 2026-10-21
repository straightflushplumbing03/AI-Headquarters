#!/usr/bin/env python3
"""Deploy (or update) the two Intelligence HQ automations from the canonical prompts.

The `.prompt.md` files in this directory are the source of truth. OpenHands stores a
copy of the prompt at creation time, so editing a file here does not change the live
job until this script re-deploys it. Run this after every prompt edit, or the
repository and the live automations disagree.

Deploys by name: if an automation with the target name already exists it is PATCHed
in place (prompt, schedule, timezone, timeout); otherwise it is created with the
prompt preset. This keeps the live automation id stable across re-deploys.

Run:
    python3 growth-engine/automations/deploy_intelligence_hq.py            # dry run
    python3 growth-engine/automations/deploy_intelligence_hq.py --deploy   # apply
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_URL = "https://github.com/straightflushplumbing03/-Up2datewebsiteseo"
TIMEZONE = "America/Los_Angeles"
TIMEOUT = 1800

TARGETS = [
    {
        "file": "intelligence-hq-daily.prompt.md",
        "name": "SFPL Intelligence HQ Daily 6 AM",
        "schedule": "0 6 * * *",  # every day, incl. weekends
    },
    {
        "file": "intelligence-hq-weekly.prompt.md",
        "name": "SFPL Intelligence HQ Weekly Review",
        "schedule": "0 6 * * 1",  # Mondays
    },
]


def prompt_body(path):
    """Return the prompt text: everything after the first '---' rule.

    The header above the rule is human-facing metadata (name, schedule, approval
    scope); only the body is sent to the automation.
    """
    text = open(path, encoding="utf-8").read()
    parts = re.split(r"^---$", text, maxsplit=1, flags=re.M)
    if len(parts) != 2:
        raise SystemExit(f"no '---' prompt separator found in {path}")
    return parts[1].strip()


def api(method, url, token, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        return e.code, {"error": body}


def find_by_name(host, token, name):
    status, data = api("GET", f"{host}/api/automation/v1?limit=100", token)
    if status != 200:
        raise SystemExit(f"could not list automations: HTTP {status} {data}")
    for a in data.get("automations", []):
        if a.get("name") == name:
            return a
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--deploy", action="store_true", help="apply to OpenHands Cloud")
    ap.add_argument("--host", default=os.environ.get(
        "OPENHANDS_HOST", "https://app.all-hands.dev"))
    args = ap.parse_args()

    token = os.environ.get("OPENHANDS_API_KEY")
    if not token:
        sys.exit("OPENHANDS_API_KEY is not set")

    for t in TARGETS:
        path = os.path.join(HERE, t["file"])
        body = prompt_body(path)
        payload = {
            "name": t["name"],
            "prompt": body,
            "trigger": {"type": "cron", "schedule": t["schedule"], "timezone": TIMEZONE},
            "timeout": TIMEOUT,
            "repos": [{"url": REPO_URL, "ref": "main"}],
        }
        print(f"{t['name']}: {len(body)} prompt chars, cron {t['schedule']} {TIMEZONE}")
        if not args.deploy:
            continue

        existing = find_by_name(args.host, token, t["name"])
        if existing:
            status, data = api(
                "PATCH", f"{args.host}/api/automation/v1/{existing['id']}", token, payload)
            print(f"  PATCH {existing['id']} -> HTTP {status}")
        else:
            status, data = api(
                "POST", f"{args.host}/api/automation/v1/preset/prompt", token, payload)
            print(f"  POST create -> HTTP {status}")
        print("  " + json.dumps({k: data.get(k) for k in
                                 ("id", "name", "trigger", "enabled", "state")}))

    if not args.deploy:
        print("\n(dry run — pass --deploy to apply)")


if __name__ == "__main__":
    main()
