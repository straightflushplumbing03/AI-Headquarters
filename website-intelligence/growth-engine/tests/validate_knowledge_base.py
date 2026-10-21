#!/usr/bin/env python3
"""Validate the growth-engine knowledge base and key site invariants.

Checks:
  1. Required knowledge-base files exist.
  2. All data/*.jsonl lines parse as JSON.
  3. data/BASELINE_METRICS.json parses.
  4. Site invariants from the 2026-10-07 audit still hold on indexable pages:
     exactly one <title>, one meta description, one canonical, one <h1>;
     0 broken internal <a href> to local .html targets.

Exit 0 on success, 1 on any failure. No network access.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GE = os.path.join(ROOT, "growth-engine")
errors, warnings = [], []

REQUIRED = [
    "BUSINESS_PROFILE.md", "SERVICE_CATALOG.md", "SERVICE_AREAS.md",
    "APPROVED_CLAIMS.md", "BRAND_VOICE.md", "COMPETITOR_DIRECTORY.md",
    "KEYWORD_UNIVERSE.md", "AI_VISIBILITY_METHODOLOGY.md", "INTEGRATION_STATUS.md",
    "KNOWN_ISSUES.md", "EXPERIMENT_LOG.md", "CHANGELOG.md", "README.md",
    "INDUSTRY_WATCH.md", "INNOVATION_IDEAS.md",
]
for f in REQUIRED:
    if not os.path.exists(os.path.join(GE, f)):
        errors.append(f"missing knowledge-base file: growth-engine/{f}")

for f in ["ai_visibility_history.jsonl", "competitor_observations.jsonl",
          "technical_health_history.jsonl", "content_experiments.jsonl"]:
    p = os.path.join(GE, "data", f)
    if not os.path.exists(p):
        errors.append(f"missing data file: {f}")
        continue
    with open(p, encoding="utf-8") as fh:
        for i, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                json.loads(line)
            except Exception as e:
                errors.append(f"{f}:{i} invalid JSON: {e}")

try:
    json.load(open(os.path.join(GE, "data", "BASELINE_METRICS.json"), encoding="utf-8"))
except Exception as e:
    errors.append(f"BASELINE_METRICS.json invalid: {e}")

# --- Site invariants ---
def indexable_pages():
    pages = []
    for base, _, files in os.walk(ROOT):
        if "/.git" in base or "/growth-engine" in base or "/assets" in base:
            continue
        for fn in files:
            if fn.endswith(".html"):
                pages.append(os.path.join(base, fn))
    return pages

for p in indexable_pages():
    with open(p, encoding="utf-8") as fh:
        h = fh.read()
    rel = os.path.relpath(p, ROOT)
    if re.search(r'name=["\']robots["\'][^>]*noindex', h, re.I):
        continue  # intentional stubs
    if len(re.findall(r"<title", h, re.I)) != 1:
        errors.append(f"{rel}: expected 1 <title>")
    if len(re.findall(r'name=["\']description["\']', h, re.I)) != 1:
        errors.append(f"{rel}: expected 1 meta description")
    if len(re.findall(r'rel=["\']canonical["\']', h, re.I)) != 1:
        errors.append(f"{rel}: expected 1 canonical")
    if len(re.findall(r"<h1[ >]", h, re.I)) != 1:
        errors.append(f"{rel}: expected 1 <h1>")

# --- Unique titles/descriptions on indexable pages (cannibalisation guard) ---
seen_titles, seen_descs = {}, {}
for p in indexable_pages():
    with open(p, encoding="utf-8") as fh:
        h = fh.read()
    if re.search(r'name=["\']robots["\'][^>]*noindex', h, re.I):
        continue
    rel = os.path.relpath(p, ROOT)
    mt = re.search(r"<title>(.*?)</title>", h, re.S | re.I)
    md = re.search(r'<meta name=["\']description["\'] content="([^"]*)"', h, re.I)
    if mt:
        key = mt.group(1).strip()
        if key in seen_titles:
            errors.append(f"{rel}: duplicate <title> with {seen_titles[key]}")
        seen_titles[key] = rel
        if len(key) > 60:
            errors.append(f"{rel}: title is {len(key)}c (>60, SERP truncation)")
    if md:
        key = md.group(1).strip()
        if key in seen_descs:
            errors.append(f"{rel}: duplicate meta description with {seen_descs[key]}")
        seen_descs[key] = rel
        if len(key) > 165:
            errors.append(f"{rel}: meta description is {len(key)}c (>165)")

# --- Internal links resolve, including cross-file fragments (dead-anchor guard) ---
# Indexable pages only: the noindex root stubs use "../" paths that a browser
# clamps at the URL root (so they resolve live); they are not indexed anyway.
LINK_RE = re.compile(r'href=["\']([^"\']+\.html)(?:#([\w.-]+))?["\']', re.I)
for p in indexable_pages():
    with open(p, encoding="utf-8") as fh:
        h = fh.read()
    if re.search(r'name=["\']robots["\'][^>]*noindex', h, re.I):
        continue
    rel = os.path.relpath(p, ROOT)
    base = os.path.dirname(p)
    for m in LINK_RE.finditer(h):
        target, frag = m.group(1), m.group(2)
        if target.startswith(("http://", "https://", "//")):
            continue
        tp = os.path.normpath(os.path.join(base, target.split("?")[0]))
        if not os.path.exists(tp):
            errors.append(f"{rel}: broken internal link -> {target}")
            continue
        if frag:
            with open(tp, encoding="utf-8", errors="replace") as tf:
                th = tf.read()
            if not re.search(rf'id=["\']{re.escape(frag)}["\']|name=["\']{re.escape(frag)}["\']', th):
                errors.append(f"{rel}: dead fragment #{frag} -> {target}")

# --- Sitemap lists exactly the indexable page set (no orphans / no exclusions) ---
CLEAN = "https://straightflushplumbingoc.com"
sm_path = os.path.join(ROOT, "sitemap.xml")
if os.path.exists(sm_path):
    with open(sm_path, encoding="utf-8") as fh:
        sm = fh.read()
    sm_rels = set()
    for m in re.finditer(r"<loc>(.*?)</loc>", sm):
        path = m.group(1).replace(CLEAN, "").lstrip("/")
        if path == "":
            sm_rels.add("index.html")
        elif path.endswith("/"):
            sm_rels.add(path + "index.html")
        else:
            sm_rels.add(path)
    expected = set()
    for p in indexable_pages():
        with open(p, encoding="utf-8") as fh:
            h = fh.read()
        if re.search(r'name=["\']robots["\'][^>]*noindex', h, re.I):
            continue
        rel = os.path.relpath(p, ROOT).replace(os.sep, "/")
        if rel == "404.html":
            continue
        expected.add(rel)
    for miss in sorted(expected - sm_rels):
        errors.append(f"sitemap.xml missing indexable page: {miss}")
    for extra in sorted(sm_rels - expected):
        errors.append(f"sitemap.xml lists a non-indexable/absent page: {extra}")


print(f"Checked {len(indexable_pages())} HTML files.")

# --- Sitemap consistency ---
sm_path = os.path.join(ROOT, "sitemap.xml")
DOMAIN = "https://straightflushplumbingoc.com"
if os.path.exists(sm_path):
    with open(sm_path, encoding="utf-8") as fh:
        sm = fh.read()

    def rel_of(loc):
        path = loc.replace(DOMAIN, "").lstrip("/")
        if path == "" or path.endswith("/"):
            return path + "index.html"
        return path

    sm_rels = {rel_of(m) for m in re.findall(r"<loc>(.*?)</loc>", sm)}
    indexable = set()
    for p in indexable_pages():
        rel = os.path.relpath(p, ROOT).replace(os.sep, "/")
        with open(p, encoding="utf-8") as fh:
            if re.search(r'name=["\']robots["\'][^>]*noindex', fh.read(4096), re.I):
                continue
        if rel == "404.html":
            continue
        indexable.add(rel)

    for rel in sorted(indexable - sm_rels):
        errors.append(f"sitemap missing indexable page: {rel}")
    for rel in sorted(sm_rels - indexable):
        errors.append(f"sitemap lists non-indexable page: {rel}")

if errors:
    print("FAIL:")
    for e in errors[:50]:
        print("  -", e)
    sys.exit(1)
print("OK: knowledge base + site invariants validated.")
