#!/usr/bin/env python3
"""Classify an automation run's outcome and recommend an action.

Reads a run object (or `{"runs": [...]}` from
`GET /api/automation/v1/{id}/runs`) from a file or stdin and prints the failure
class plus the recommended action. Read-only, no network access.

Why elapsed time is the primary signal (see growth-engine/KNOWN_ISSUES.md
ISSUE-009): every observed daily-run failure ended at the *enforced ceiling*
(start + ~1920 s), and the platform then reported `environment_unavailable` /
"Timed out: Sandbox not available" at its post-run verification step — the sandbox
is simply gone by then. That error is a *symptom of running out of clock*, not a
provisioning failure. A retry cannot fix a budget overrun, so the two must not be
confused. The tie-breaker for a genuine provisioning failure is a *short* run that
never reached the ceiling (and usually has no `sandbox_id`).

Classes (see growth-engine/KNOWN_ISSUES.md ISSUE-006/009):
  ok               COMPLETED or still running -> no action
  budget_overrun   FAILED near the ceiling -> fix the prompt budget; do NOT retry
  sandbox          FAILED early, no ceiling hit -> re-dispatch once
  config_error     e.g. KeyError: 'AUTOMATION_AGENT_PROFILE_ID' -> fix the automation
  other            unclassified failure -> human review

Usage:
  python3 growth-engine/tests/classify_automation_run.py run.json
  curl -s -H "Authorization: Bearer $OPENHANDS_API_KEY" \
    "https://app.all-hands.dev/api/automation/v1/<id>/runs?limit=5" \
    | python3 growth-engine/tests/classify_automation_run.py
"""
import json
import sys
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

SANDBOX_MARKER = "Sandbox not available"
CONFIG_MARKERS = ("AUTOMATION_AGENT_PROFILE_ID", "KeyError")

# The run is killed at start + ~1920 s regardless of the 1800 s in the config.
# Measured as `timeout_at - started_at` across runs (1923 s, 1946 s, 1922 s).
ENFORCED_CEILING_SECONDS = 1920
# A failure this close to the ceiling is a budget overrun, not a provisioning blip.
CEILING_FRACTION = 0.8


def _lookup(run: Dict[str, Any], *keys: str) -> Optional[Any]:
    for key in keys:
        value = run.get(key)
        if value is not None:
            return value
    return None


def _parse_ts(value: Optional[Any]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def elapsed_seconds(run: Dict[str, Any]) -> Optional[float]:
    """Seconds between start and finish, or between start and the ceiling if the
    run was killed and only `timeout_at` is present."""
    started = _parse_ts(_lookup(run, "started_at", "created_at"))
    if started is None:
        return None
    finished = _parse_ts(_lookup(run, "completed_at", "finished_at", "updated_at"))
    if finished is not None:
        return (finished - started).total_seconds()
    ceiling = _parse_ts(run.get("timeout_at"))
    if ceiling is not None:
        return (ceiling - started).total_seconds()
    return None


def _ceiling_seconds(run: Dict[str, Any]) -> float:
    started = _parse_ts(_lookup(run, "started_at", "created_at"))
    ceiling = _parse_ts(run.get("timeout_at"))
    if started is not None and ceiling is not None:
        return (ceiling - started).total_seconds()
    return float(ENFORCED_CEILING_SECONDS)


def classify(run: Dict[str, Any]) -> Tuple[str, str]:
    status = (run.get("status") or "").upper()
    detail = run.get("status_detail") or {}
    kind = (detail.get("kind") or "").lower()
    error = (run.get("error_detail") or "").strip()
    sandbox_id = _lookup(run, "sandbox_id")
    conversation_id = _lookup(run, "conversation_id")

    if status in {"COMPLETED", "PENDING", "RUNNING"}:
        return "ok", "no action"

    if status != "FAILED":
        return "other", "human review"

    if kind == "execution_error" and any(marker in error for marker in CONFIG_MARKERS):
        return "config_error", "fix the automation configuration; retrying cannot help"

    elapsed = elapsed_seconds(run)
    ceiling = _ceiling_seconds(run)
    sandbox_marker = kind == "environment_unavailable" or SANDBOX_MARKER in error

    # Elapsed time is the discriminator: a failure at/near the ceiling is a budget
    # overrun no matter which error string the platform attached to it.
    if elapsed is not None and elapsed >= ceiling * CEILING_FRACTION:
        return (
            "budget_overrun",
            "fix the prompt budget; the run consumed its whole clock — do NOT retry",
        )

    if sandbox_marker and (conversation_id is None or sandbox_id is None):
        return (
            "sandbox",
            "re-dispatch once (watchdog HQ-R); no conversation/sandbox was ever set up",
        )

    if kind == "timeout" or "timed out" in error.lower():
        return "budget_overrun", "fix the prompt budget; do not retry blindly"

    if sandbox_marker:
        return "sandbox", "re-dispatch once (watchdog HQ-R); sandbox never came up"

    return "other", "human review"


def _coerce_run(payload: Any) -> Optional[Dict[str, Any]]:
    if isinstance(payload, dict):
        if isinstance(payload.get("runs"), list):
            runs = payload["runs"]
            if not runs:
                return None
            return max(
                runs,
                key=lambda item: str(
                    _lookup(item, "started_at", "created_at", "updated_at") or ""
                ),
            )
        if any(k in payload for k in ("status", "status_detail", "error_detail", "id")):
            return payload
        if "data" in payload and isinstance(payload["data"], dict):
            return _coerce_run(payload["data"])
    if isinstance(payload, list):
        if not payload:
            return None
        return _coerce_run(payload[0])
    return None


def main() -> int:
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as fh:
            raw = fh.read()
    else:
        raw = sys.stdin.read()

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"invalid JSON: {exc}", file=sys.stderr)
        return 2

    run = _coerce_run(payload)
    if run is None:
        print("no runs")
        return 0

    run_id = _lookup(run, "id", "run_id")
    cls, action = classify(run)
    print(f"run: {run_id or 'unknown'}")
    print(f"status: {run.get('status')}")
    print(f"class: {cls}")
    print(f"action: {action}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
