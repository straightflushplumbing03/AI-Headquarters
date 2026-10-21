# Open PR triage — 2026-10-15

Owner decision needed on three stale pull requests. Recorded here because the
GitHub token available to the agent cannot write issue or PR comments (403
"Resource not accessible by personal access token"), so this file is the durable
channel.

## PR #38 — Technical SEO/AEO audit + fixes — **needs rebase, do not merge as-is**

Branch `technical-seo/2026-10-15-audit-fixes` → `main`. 68 files, +1456/−319.
**11 commits behind `main`**, conflicts on `scripts/refresh_sitemap.py` and
`growth-engine/KNOWN_ISSUES.md`.

### Blocker 1 — it would regress the shallow-clone lastmod fix

The branch carries 54 of 74 sitemap URLs stamped `<lastmod>2026-10-15</lastmod>`.
That is exactly the defect fixed on `main` by PR #41 (ISSUE-016). Measured in a
real depth-1 clone:

| Tree | `refresh_sitemap.py` result |
|---|---|
| `main` before the fix | `lastmod refreshed: 74` — every URL restamped with the run date |
| `main` after the fix | `lastmod refreshed: 0 (unchanged, history unavailable: 74)`, no diff |
| PR #38 head | no shallow-clone guard; 54/74 URLs already stamped `2026-10-15` |

A rebase that keeps this branch's `scripts/refresh_sitemap.py` silently restores
the bug. Take `scripts/refresh_sitemap.py` and `sitemap.xml` from `main` and
regenerate the sitemap.

### Blocker 2 — colliding issue IDs

Both branches renumbered the same IDs in `growth-engine/KNOWN_ISSUES.md`; 007–013
mean different things on each side. A naive union produces duplicate numbers and
loses issues. Resolve as a union with explicit renumbering: main's 010→014,
011→015, 012→016, 013→017, then this branch's 007–013 → 018–024.

### Recommendation

If the AEO content is still wanted, re-cut **just the content changes** on top of
current `main` and leave the sitemap tooling out. 68 files of stale changes with
colliding IDs is worse to review than either extreme.

## PR #35 and PR #36 — 10 commits stale, likely superseded

`intelligence-hq/blockers-verification-2026-10-13` (9 files) and
`intelligence-hq/fix-sandbox-failure-2026-10-13` (15 files). Both are **10 commits
behind `main`** and their stated purpose has been overtaken:

- #36 "fix transient sandbox failure losing the daily run" — the automation has
  since been redeployed twice; the failure mode it targeted no longer applies.
- #35 "fix search-provider policy, verify scheduled runs" — provider policy and
  scheduled-run verification were both redone on 2026-10-15 (PR #41, ISSUE-017).

**Recommendation:** close both. Their unique content is the dated 2026-10-13
records in `data/*.jsonl` and `briefs/strategy-log.md`; confirm nothing there is
still wanted before closing.

## Merged

#39 (blueprint + Tavily/Perplexity clients) and #40 (automation ids) were both
fast-forwarded to `main` on 2026-10-15 and are closed.
