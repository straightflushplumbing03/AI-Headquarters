#!/usr/bin/env python3
"""Cloudflare crawler-block audit (read-only by default).

Diagnoses why the zone returns `cf-mitigated: challenge` (HTTP 403) to crawlers,
using a Cloudflare API token from CLOUDFLARE_API_TOKEN.

  python3 cloudflare_audit.py                    # read-only audit + diagnosis
  python3 cloudflare_audit.py --zone <zoneid>    # skip zone lookup
  python3 cloudflare_audit.py --fix under-attack-off   # explicit, narrow write

Writes are OFF unless --fix names exactly one change. Never prints the token.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
DOMAIN = "straightflushplumbingoc.com"


def call(path, token, method="GET", body=None):
    req = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {"errors": [{"message": "unparseable"}]}
    except Exception as e:
        return 0, {"errors": [{"message": str(e)}]}


def show(label, status, data):
    ok = data.get("success")
    print(f"\n### {label}  (HTTP {status}, success={ok})")
    if ok:
        print(json.dumps(data.get("result"), indent=2)[:2000])
    else:
        for err in data.get("errors", []):
            print("  ERROR:", err.get("code"), err.get("message"))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", help="zone id (skip lookup)")
    ap.add_argument("--fix", choices=["under-attack-off"], help="apply one named change")
    args = ap.parse_args()

    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not token:
        print("ERROR: CLOUDFLARE_API_TOKEN is not set.")
        print("Store the token secret in the runtime secrets manager, then re-run.")
        return 2

    print("=== Cloudflare crawler-block audit ===")
    # /user/tokens/verify only works for user-owned tokens; account-owned
    # tokens (cfat_...) fail it but work for zone operations. Warn, don't bail.
    st, d = call("/user/tokens/verify", token)
    if not d.get("success"):
        print("note: /user/tokens/verify failed (expected for account-owned tokens);"
              " continuing with zone lookup.")
    else:
        show("Token verify", st, d)

    zone_id = args.zone
    if not zone_id:
        st, d = call(f"/zones?name={DOMAIN}", token)
        show("Zone lookup", st, d)
        res = d.get("result") or []
        if not res:
            print(f"\nERROR: zone {DOMAIN} not found with this token (Zone:Read scope?).")
            return 2
        zone_id = res[0]["id"]
    print(f"\nZONE_ID = {zone_id}")

    st, d = call(f"/zones/{zone_id}/settings/security_level", token)
    show("security_level (Under Attack toggle)", st, d)
    sl = (d.get("result") or {}).get("value")

    st, d = call(f"/zones/{zone_id}/bot_management", token)
    show("bot_management (Bot Fight Mode)", st, d)
    bm = d.get("result") or {}

    for setting in ("rocket_loader", "mirage", "email_obfuscation", "browser_check",
                    "challenge_ttl", "privacy_pass"):
        st, d = call(f"/zones/{zone_id}/settings/{setting}", token)
        show(f"setting: {setting}", st, d)

    print("\n=== DIAGNOSIS ===")
    if sl and sl.lower() in ("under_attack", "i_am_under_attack"):
        print(f"  security_level = {sl!r}  ->  UNDER ATTACK MODE IS ON. This is the")
        print("  most likely cause of the Managed Challenge / 403 to crawlers.")
        print("  FIX: set security_level to 'medium'.")
    else:
        print(f"  security_level = {sl!r} (not Under Attack).")
    if bm.get("fight_mode"):
        print("  bot_management.fight_mode = True  ->  BOT FIGHT MODE IS ON.")
        print("  FIX (Free plan): turn Bot Fight Mode off, OR add a WAF Skip rule")
        print("  on expression (cf.client.bot).")
    else:
        print(f"  bot_management.fight_mode = {bm.get('fight_mode')!r} (off).")

    if args.fix == "under-attack-off":
        print("\n=== APPLYING FIX: under-attack-off ===")
        st, d = call(f"/zones/{zone_id}/settings/security_level", token,
                     method="PATCH", body={"value": "medium"})
        show("PATCH security_level -> medium", st, d)
        if d.get("success"):
            print("  DONE. Re-run the crawler check to confirm 200.")
    else:
        print("\n(No write performed. To turn off Under Attack mode:")
        print("  python3 cloudflare_audit.py --zone <id> --fix under-attack-off )")
    return 0


if __name__ == "__main__":
    sys.exit(main())
