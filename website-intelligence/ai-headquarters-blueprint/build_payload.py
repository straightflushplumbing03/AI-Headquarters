#!/usr/bin/env python3
"""Build the automation payload from the master prompt file.

This file is the ONLY source of truth for the deployed prompt. Editing
01-MASTER-AGENT-PROMPT.md does not change the running automation: OpenHands
stores a copy of the prompt when the automation is created, so the change only
takes effect after the payload is re-deployed (PATCH the prompt, or re-create
the automation and disable the previous one). Re-run this script and re-deploy
after every prompt edit, or the repository and the live job will disagree.

Run:
    python3 ai-headquarters-blueprint/build_payload.py          # writes /tmp/payload.json
    python3 ai-headquarters-blueprint/build_payload.py --deploy # PATCH the live automation
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(HERE, "01-MASTER-AGENT-PROMPT.md")

# Keep this in one place. It previously hardcoded "0 6 * * *" while the live
# automation ran Mon/Wed/Fri, so a re-deploy would silently have reverted the
# schedule to daily and doubled the run count.
SCHEDULE = "0 6 * * 1,3,5"          # Mon/Wed/Fri
TIMEZONE = "America/Los_Angeles"
TIMEOUT = 1800
AUTOMATION_ID = "1485d659-8663-4776-a507-db0fefed8483"

text = open(src, encoding="utf-8").read()
m = re.search(r"^## THE PROMPT.*?\n(.*?)^## END OF PROMPT", text, re.S | re.M)
if not m:
    raise SystemExit("could not locate prompt markers")
prompt = m.group(1).strip()

payload = {
    "name": "SFPL AI Headquarters Daily",
    "prompt": prompt,
    "trigger": {"type": "cron", "schedule": SCHEDULE, "timezone": TIMEZONE},
    "timeout": TIMEOUT,
    "repos": [
        {"url": "https://github.com/straightflushplumbing03/AI-Headquarters",
         "ref": "main"},
        {"url": "https://github.com/straightflushplumbing03/-Up2datewebsiteseo",
         "ref": "main"},
    ],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--deploy", action="store_true",
                    help="PATCH the live automation with this prompt")
    ap.add_argument("--id", default=AUTOMATION_ID)
    args = ap.parse_args()

    out = "/tmp/payload.json"
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)

    print("wrote", out)
    print("name:        ", payload["name"])
    print("trigger:     ", payload["trigger"])
    print("timeout:     ", payload["timeout"])
    print("repos:       ", [r["url"] for r in payload["repos"]])
    print("prompt chars:", len(prompt))
    print("payload bytes:", len(json.dumps(payload)))

    if not args.deploy:
        print("\n(dry run — pass --deploy to update the live automation)")
        return

    token = os.environ.get("OPENHANDS_API_KEY")
    if not token:
        sys.exit("OPENHANDS_API_KEY is not set; cannot deploy")
    host = os.environ.get("OPENHANDS_HOST", "https://app.all-hands.dev")
    r = subprocess.run(
        ["curl", "-sS", "-X", "PATCH",
         f"{host}/api/automation/v1/{args.id}",
         "-H", f"Authorization: Bearer {token}",
         "-H", "Content-Type: application/json",
         "--data", json.dumps({"prompt": prompt})],
        capture_output=True, text=True,
    )
    print(r.stdout or r.stderr)
    if r.returncode != 0:
        sys.exit(f"deploy failed (curl exit {r.returncode})")


if __name__ == "__main__":
    main()

