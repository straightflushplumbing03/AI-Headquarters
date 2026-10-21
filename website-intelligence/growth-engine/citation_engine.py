#!/usr/bin/env python3
"""AI Citation Engine — find out *which sources AI answers copy from* and turn
every source that recommends a competitor instead of Straight Flush into a task.

Why: AI assistants (ChatGPT, Gemini/AI Overviews, Perplexity, Claude, Copilot)
recommend local plumbers by synthesising a small set of trusted sources —
directories, "best plumbers in <city>" listicles, review sites, forums, and the
businesses' own pages. Getting onto (or out-answering) the exact sources an
engine already cites is the most direct lever on whether it recommends us.

Commands (stdlib only, no network):
  plan     [--n 12]              next batch of queries (least-recently tested first)
  record   FILE.json             append observations captured during a run
  import-csv FILE.csv            append owner's manual tests (ai-visibility tracker CSV)
  analyze  [--days 56]           write reports/citation-gaps/<date>.md + data/citation_actions.json

Observation schema (one JSON object per query × engine):
  {
    "ts": "2026-10-20T13:05:00Z",          # UTC
    "engine": "claude_web_search",         # see ENGINES
    "query": "who does slab leak detection in Dana Point?",
    "city": "Dana Point", "service": "slab-leak",
    "sf_status": "absent",                 # recommended|mentioned|cited|absent|incorrect|inconclusive
    "businesses_named": ["Evans Leak Detection", "..."],   # in answer order
    "cited_urls": ["https://www.yelp.com/search?...", "..."],
    "note": "..."
  }

Honesty rules (mirror AI_VISIBILITY_METHODOLOGY.md): an observation is only
recorded for a query that was actually executed on that engine; a failed or
blocked test is `inconclusive`, never `absent`.
"""
import csv, datetime as dt, json, os, re, sys
from collections import Counter, defaultdict
from urllib.parse import urlparse

GE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(GE, "data")
OBS = os.path.join(DATA, "citation_observations.jsonl")
ACTIONS = os.path.join(DATA, "citation_actions.json")
REPORTS = os.path.join(GE, "reports", "citation-gaps")

OUR_DOMAIN = "straightflushplumbingoc.com"
OUR_NAMES = ("straight flush",)

ENGINES = {
    "claude_web_search": "Claude (web search)",
    "gemini_search": "Gemini (grounded API)",
    "perplexity": "Perplexity",
    "chatgpt": "ChatGPT",
    "google_ai_overview": "Google AI Overview / AI Mode",
    "copilot": "Microsoft Copilot",
    "manual_other": "Other (manual)",
}
STATUSES = ("recommended", "mentioned", "cited", "absent", "incorrect", "inconclusive")

# Services → (query noun, our page). Only verified services from SERVICE_CATALOG.md.
SERVICES = {
    "leak-detection": ("leak detection", "/services/leak-detection"),
    "slab-leak": ("slab leak detection", "/services/slab-leak-detection"),
    "repipe": ("PEX repiping", "/services/pex-repiping"),
    "water-heater": ("water heater repair", "/services/water-heater-services"),
    "drain": ("drain cleaning", "/services/drain-services"),
    "emergency": ("emergency plumber", "/services/emergency-plumbing"),
    "plumber": ("plumber", "/"),
}
# Recommendation-intent phrasings — these are the questions where an AI names businesses.
INTENTS = [
    "best {svc} in {city}, CA",
    "who does {svc} in {city}?",
    "recommend a {svc} company in {city}",
]
TIER1 = ["Laguna Niguel", "Dana Point", "San Clemente", "Mission Viejo", "Aliso Viejo"]
TIER2 = ["Laguna Hills", "Laguna Beach", "Ladera Ranch", "Rancho Santa Margarita",
         "Irvine", "Lake Forest", "San Juan Capistrano"]
SERVICE_VALUE = {"slab-leak": 3, "leak-detection": 3, "repipe": 3, "emergency": 2,
                 "plumber": 2, "water-heater": 1, "drain": 1}

# Source classes → what to do about them.
SOURCE_CLASSES = [
    ("directory", ["yelp.com", "bbb.org", "angi.com", "homeadvisor.com", "thumbtack.com",
                   "nextdoor.com", "houzz.com", "porch.com", "yellowpages.com", "mapquest.com",
                   "manta.com", "superpages.com", "bing.com", "apple.com", "google.com",
                   "maps.google", "foursquare.com", "chamberofcommerce.com", "buildzoom.com",
                   "networx.com", "bark.com", "fixr.com", "homeguide.com", "cslb.ca.gov"]),
    ("listicle", ["expertise.com", "threebestrated.com", "bestprosintown.com",
                  "topratedlocal.com", "upcity.com", "localbest", "top10", "best-plumbers",
                  "bestplumbers"]),
    ("lead_gen", ["ignitionlabs.com", "homeservice.", "localplumbersnear", "near-me/"]),
    ("forum", ["reddit.com", "quora.com", "city-data.com", "facebook.com", "nextdoor.com/p"]),
    ("news", ["ocregister.com", "patch.com", "latimes.com", "dailypilot.com",
              "lagunabeachindy.com", "danapointtimes.com", "sanclementetimes.com",
              "thecapistranodispatch.com", "voiceofoc.org"]),
    ("gov_edu", [".gov", ".edu", "epa.gov", "watersense"]),
]
ADVICE = {
    "directory": "Claim / complete this listing with the exact name, phone and service list; ask recent customers for a review here.",
    "listicle": "Get included: find the 'suggest a business' / editor contact and submit with license #, reviews and services.",
    "lead_gen": "Lead-generation network with a page for every city × service. Ask whether it lists real local pros (get listed if free); otherwise out-answer it with our own specific city × service page.",
    "forum": "Post a genuinely helpful answer (no sales pitch) in this thread or the next similar one; disclose you're a local plumber.",
    "news": "Pitch a short local tip (e.g. 'signs of a slab leak') to this outlet so it cites you next time.",
    "gov_edu": "Authority source — cite it on the matching page of our site to strengthen that page's trust signals.",
    "competitor": "AI quotes this competitor page for this topic. Make our matching page clearly better (more specific answer, local proof, cost info).",
    "other": "Review manually: decide whether to get listed, pitched, or out-answer it.",
}


# ------------------------------------------------------------------ helpers
def now():
    return dt.datetime.now(dt.timezone.utc)


def load_obs():
    out = []
    if os.path.exists(OBS):
        with open(OBS, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    out.append(json.loads(line))
    return out


def domain(url):
    try:
        d = urlparse(url if "://" in url else "https://" + url).netloc.lower()
    except Exception:
        return ""
    return d[4:] if d.startswith("www.") else d


def known_competitors():
    """Domains already recorded as competitors by the daily research loop."""
    comps = set()
    p = os.path.join(DATA, "competitor_observations.jsonl")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for line in f:
                try:
                    d = json.loads(line).get("domain") or ""
                except Exception:
                    continue
                if d:
                    comps.add(domain(d))
    return comps


def _match(needle, d, full):
    """Domain-ish needles match on the domain boundary (so 'bing.com' never matches
    'benjaminfranklinplumbing.com'); anything else is a substring of the URL."""
    if needle.startswith("."):
        return d.endswith(needle)
    if "." in needle and "/" not in needle and not needle.endswith("."):
        return d == needle or d.endswith("." + needle)
    return needle in full


def classify(url, competitors):
    d = domain(url)
    full = url.lower()
    if OUR_DOMAIN in d:
        return "ours"
    for cls, needles in SOURCE_CLASSES:
        if any(_match(n, d, full) for n in needles):
            return cls
    if d in competitors or re.search(r"plumb|rooter|leak|drain|pipe|repipe|flow", d):
        return "competitor"
    return "other"


def mentions_us(text):
    return any(n in (text or "").lower() for n in OUR_NAMES)


def validate(o):
    errs = []
    for k in ("ts", "engine", "query", "sf_status"):
        if not o.get(k):
            errs.append(f"missing {k}")
    if o.get("engine") and o["engine"] not in ENGINES:
        errs.append(f"unknown engine {o['engine']!r} (use one of {', '.join(ENGINES)})")
    if o.get("sf_status") and o["sf_status"] not in STATUSES:
        errs.append(f"bad sf_status {o['sf_status']!r}")
    if not isinstance(o.get("cited_urls", []), list) or not isinstance(o.get("businesses_named", []), list):
        errs.append("cited_urls and businesses_named must be lists")
    # Consistency guard: can't be 'absent' while naming us.
    if o.get("sf_status") == "absent" and any(mentions_us(b) for b in o.get("businesses_named", [])):
        errs.append("sf_status is 'absent' but Straight Flush is in businesses_named")
    return errs


def append(rows):
    os.makedirs(DATA, exist_ok=True)
    with open(OBS, "a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


# ------------------------------------------------------------------ plan
def universe():
    qs = []
    for tier, cities in ((1, TIER1), (2, TIER2)):
        for city in cities:
            for key, (svc, _) in SERVICES.items():
                for i, intent in enumerate(INTENTS):
                    # Tier 2 gets one phrasing per service to keep the universe tractable.
                    if tier == 2 and i > 0:
                        continue
                    qs.append({"query": intent.format(svc=svc, city=city), "city": city,
                               "service": key, "tier": tier, "_i": i})
    return qs


def plan(n=12, engine="claude_web_search"):
    last = {}
    for o in load_obs():
        if o.get("engine") == engine and o.get("sf_status") != "inconclusive":
            last[o["query"].lower()] = max(last.get(o["query"].lower(), ""), o["ts"])

    def key(q):
        tested = last.get(q["query"].lower(), "")
        # never-tested first, then oldest; then Tier 1, then higher-value services
        # spread a batch across cities and services instead of 3 phrasings of one query
        return (tested != "", tested, q["tier"], q["_i"], -SERVICE_VALUE[q["service"]])
    batch = sorted(universe(), key=key)[:n]
    return [{k: v for k, v in q.items() if k != "_i"} for q in batch]


# ------------------------------------------------------------------ analyze
def analyze(days=56):
    obs = [o for o in load_obs() if o.get("sf_status") != "inconclusive"]
    cutoff = (now() - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    recent = [o for o in obs if o["ts"] >= cutoff]
    comps = known_competitors()
    today = now().strftime("%Y-%m-%d")

    # Latest result per (engine, query)
    latest = {}
    for o in sorted(recent, key=lambda x: x["ts"]):
        latest[(o["engine"], o["query"].lower())] = o
    cur = list(latest.values())

    # Scoreboard per engine
    board = defaultdict(Counter)
    for o in cur:
        board[o["engine"]][o["sf_status"]] += 1

    # Share of voice: who gets named most
    sov = Counter()
    for o in cur:
        for b in o.get("businesses_named", [])[:5]:
            sov["Straight Flush" if mentions_us(b) else b.strip()] += 1

    # Sources cited when we were NOT recommended → the gap list
    gaps = defaultdict(lambda: {"count": 0, "queries": set(), "engines": set(), "urls": set(),
                                "services": Counter(), "score": 0.0})
    wins = Counter()
    for o in cur:
        lost = o["sf_status"] in ("absent", "mentioned", "incorrect")
        weight = SERVICE_VALUE.get(o.get("service"), 1)
        age_days = (now() - dt.datetime.strptime(o["ts"][:19], "%Y-%m-%dT%H:%M:%S")
                    .replace(tzinfo=dt.timezone.utc)).days
        recency = 1.0 if age_days <= 14 else 0.6
        for u in o.get("cited_urls", []):
            d = domain(u)
            if not d:
                continue
            if OUR_DOMAIN in d:
                wins[u] += 1
                continue
            if not lost:
                continue
            g = gaps[d]
            g["count"] += 1
            g["queries"].add(o["query"])
            g["engines"].add(o["engine"])
            g["urls"].add(u)
            if o.get("service"):
                g["services"][o["service"]] += 1
            g["score"] += weight * recency

    actions = []
    for d, g in gaps.items():
        sample = sorted(g["urls"])[0]
        cls = classify(sample, comps)
        if cls == "competitor":
            svc = g["services"].most_common(1)[0][0] if g["services"] else None
            ours = SERVICES[svc][1] if svc in SERVICES else None
            todo = ADVICE[cls] + (f" Our page: {ours}" if ours else "")
        else:
            todo = ADVICE.get(cls, ADVICE["other"])
        # listicles & directories outrank competitor pages: one listing can flip many answers
        mult = {"listicle": 1.5, "directory": 1.3, "forum": 1.1}.get(cls, 1.0)
        actions.append({
            "domain": d, "class": cls, "priority_score": round(g["score"] * mult, 2),
            "times_cited_when_we_lost": g["count"], "engines": sorted(g["engines"]),
            "example_urls": sorted(g["urls"])[:3], "queries": sorted(g["queries"])[:5],
            "action": todo, "status": "todo", "first_seen": today,
        })
    actions.sort(key=lambda a: -a["priority_score"])

    # Preserve owner-set statuses from previous runs
    if os.path.exists(ACTIONS):
        try:
            with open(ACTIONS, encoding="utf-8") as fh:
                prev = {a["domain"]: a for a in json.load(fh).get("actions", [])}
            for a in actions:
                if a["domain"] in prev:
                    a["status"] = prev[a["domain"]].get("status", "todo")
                    a["first_seen"] = prev[a["domain"]].get("first_seen", today)
        except Exception:
            pass

    # Weekly trend (all history): recommended-or-cited rate per ISO week
    trend = defaultdict(Counter)
    for o in obs:
        wk = dt.date.fromisoformat(o["ts"][:10]).isocalendar()
        trend[f"{wk[0]}-W{wk[1]:02d}"][o["sf_status"]] += 1

    with open(ACTIONS, "w", encoding="utf-8") as f:
        json.dump({"generated": today, "window_days": days, "observations_used": len(cur),
                   "actions": actions}, f, indent=2, ensure_ascii=False)

    os.makedirs(REPORTS, exist_ok=True)
    L = [f"# AI Citation Gap Report — {today}", "",
         f"Window: last {days} days · {len(cur)} current query results "
         f"({len(recent)} observations, inconclusive excluded).", "",
         "Each source below was **cited by an AI answer that did not recommend Straight Flush**. "
         "Getting onto (or out-answering) these sources is the most direct lever on AI recommendations. "
         "Status of each action is tracked in `growth-engine/data/citation_actions.json` "
         "(owner: change `todo` → `done`).", ""]
    if not cur:
        L += ["_No observations yet. Run a sweep: `python3 growth-engine/citation_engine.py plan`._", ""]
    L += ["## Scoreboard (latest result per query)", "",
          "| Engine | Recommended | Cited | Mentioned | Absent | Incorrect |", "|---|---|---|---|---|---|"]
    for e, c in sorted(board.items()):
        L.append(f"| {ENGINES.get(e, e)} | {c['recommended']} | {c['cited']} | {c['mentioned']} | "
                 f"{c['absent']} | {c['incorrect']} |")
    L += ["", "## Who AI names most (share of voice, top 5 per answer)", ""]
    for name, n in sov.most_common(12):
        L.append(f"- {'**' if name == 'Straight Flush' else ''}{name}{'**' if name == 'Straight Flush' else ''} — {n}")
    L += ["", "## Top actions", "", "| # | Source | Type | Score | Lost answers | Do this |", "|---|---|---|---|---|---|"]
    for i, a in enumerate([a for a in actions if a["status"] != "done"][:20], 1):
        L.append(f"| {i} | [{a['domain']}]({a['example_urls'][0]}) | {a['class']} | {a['priority_score']} | "
                 f"{a['times_cited_when_we_lost']} | {a['action']} |")
    if wins:
        L += ["", "## Our pages AI already cites (protect these)", ""]
        L += [f"- {u} — {n}×" for u, n in wins.most_common(10)]
    L += ["", "## Trend (all history)", "", "| Week | Recommended | Cited | Mentioned | Absent |", "|---|---|---|---|---|"]
    for wk in sorted(trend)[-12:]:
        c = trend[wk]
        L.append(f"| {wk} | {c['recommended']} | {c['cited']} | {c['mentioned']} | {c['absent']} |")
    L += ["", "## Method & limits", "",
          "- Engines are recorded separately; a conventional search result is never counted as an AI answer.",
          "- `claude_web_search` = the answer Claude gives using live web search, run by the scheduled Claude task. "
          "ChatGPT / Google AI Overview / Copilot come from the owner's manual tests (`import-csv`).",
          "- Inconclusive tests are excluded, not counted as absent. Small samples — treat week-to-week moves as directional.", ""]
    path = os.path.join(REPORTS, f"{today}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    return path, actions


# ------------------------------------------------------------------ CSV import
def import_csv(path):
    """Owner's manual tests, from the ai-visibility-tracker.csv layout:
    Date, Engine, Prompt, Mentioned? (Y/N), Position (1=first), Competitors named, Sources it cited, Notes"""
    eng_map = {"chatgpt": "chatgpt", "perplexity": "perplexity", "gemini": "gemini_search",
               "google ai mode": "google_ai_overview", "google ai overview": "google_ai_overview",
               "claude": "claude_web_search", "copilot": "copilot"}
    rows, skipped = [], 0
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            m = (r.get("Mentioned? (Y/N)") or "").strip().upper()
            if not r.get("Date") or m not in ("Y", "N"):
                skipped += 1
                continue
            pos = (r.get("Position (1=first)") or "").strip()
            status = "absent" if m == "N" else ("recommended" if pos in ("1", "2", "3") else "mentioned")
            o = {"ts": f"{r['Date'].strip()}T12:00:00Z",
                 "engine": eng_map.get((r.get("Engine") or "").strip().lower(), "manual_other"),
                 "query": r["Prompt"].strip(), "city": "", "service": "",
                 "sf_status": status,
                 "businesses_named": [x.strip() for x in re.split(r"[;,]", r.get("Competitors named") or "") if x.strip()],
                 "cited_urls": [x.strip() for x in re.split(r"[\s;,]+", r.get("Sources it cited") or "") if "." in x],
                 "note": ("owner manual test. " + (r.get("Notes") or "")).strip()}
            if not validate(o):
                rows.append(o)
            else:
                skipped += 1
    append(rows)
    return len(rows), skipped


# ------------------------------------------------------------------ CLI
def main(argv):
    if not argv:
        print(__doc__)
        return 0
    cmd = argv[0]
    if cmd == "plan":
        n = int(argv[argv.index("--n") + 1]) if "--n" in argv else 12
        print(json.dumps(plan(n), indent=2))
    elif cmd == "record" and len(argv) > 1:
        with open(argv[1], encoding="utf-8") as fh:
            data = json.load(fh)
        rows = data if isinstance(data, list) else [data]
        bad = [(i, e) for i, r in enumerate(rows) for e in validate(r)]
        if bad:
            for i, e in bad:
                print(f"row {i}: {e}", file=sys.stderr)
            return 1
        append(rows)
        print(f"recorded {len(rows)} observation(s) → {os.path.relpath(OBS)}")
    elif cmd == "import-csv" and len(argv) > 1:
        n, s = import_csv(argv[1])
        print(f"imported {n} row(s), skipped {s} blank/invalid")
    elif cmd == "analyze":
        days = int(argv[argv.index("--days") + 1]) if "--days" in argv else 56
        path, actions = analyze(days)
        print(f"wrote {os.path.relpath(path)} · {len(actions)} source action(s)")
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
