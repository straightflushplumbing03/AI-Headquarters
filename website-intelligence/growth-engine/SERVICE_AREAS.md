# Service Areas — Straight Flush Plumbing & Leak Detection

**Authoritative source:** `sitemap.xml` + `cities/` directory, verified 2026-10-09.
21 city pages exist. Published city list also appears in `index.html` JSON-LD
`areaServed` and `llms.txt`.

## Verified city pages (21)

| City | Page | Page size (bytes) | Notes |
|---|---|---|---|
| Laguna Niguel (HQ) | `/cities/laguna-niguel.html` | ~5.4k | Primary market |
| Dana Point | `/cities/dana-point.html` | ~5.3k | |
| San Clemente | `/cities/san-clemente.html` | ~5.3k | |
| San Juan Capistrano | `/cities/san-juan-capistrano.html` | ~5.3k | |
| Mission Viejo | `/cities/mission-viejo.html` | ~5.4k | |
| Laguna Hills | `/cities/laguna-hills.html` | ~5.2k | |
| Laguna Beach | `/cities/laguna-beach.html` | ~5.2k | |
| Laguna Woods | `/cities/laguna-woods.html` | ~5.3k | Previously orphaned; de-orphaned 2026-10-07 |
| Aliso Viejo | `/cities/aliso-viejo.html` | ~5.2k | |
| Ladera Ranch | `/cities/ladera-ranch.html` | ~5.2k | |
| Rancho Santa Margarita | `/cities/rancho-santa-margarita.html` | ~5.3k | |
| Coto de Caza | `/cities/coto-de-caza.html` | ~7.7k | |
| Dove Canyon | `/cities/dove-canyon.html` | ~5.8k | Previously orphaned; de-orphaned 2026-10-07 |
| Foothill Ranch | `/cities/foothill-ranch.html` | ~5.8k | Previously orphaned; de-orphaned 2026-10-07 |
| Lake Forest | `/cities/lake-forest.html` | ~5.2k | |
| Irvine | `/cities/irvine.html` | ~5.2k | |
| Newport Beach | `/cities/newport-beach.html` | ~5.3k | |
| Costa Mesa | `/cities/costa-mesa.html` | ~9.1k | Deviates (JS not localized 2026-08) |
| Huntington Beach | `/cities/huntington-beach.html` | ~5.9k | |
| Tustin | `/cities/tustin.html` | ~5.3k | |
| Orange | `/cities/orange.html` | ~5.3k | |

## Root-level city stubs (intentional noindex)

`laguna-niguel.html`, `aliso-viejo.html`, `costa-mesa.html`, `dana-point.html`,
etc. at the repo root are **intentional `noindex, nofollow` stubs** whose
canonical points to the real `/cities/…` page. Confirmed correct in
`briefs/strategy-log.md` (2026-10-07). Do not delete or "fix" these.

## Owner confirmation required

- Is the 21-city list actively serviced (vs. historically listed)?
- Priority order for content depth (Laguna Niguel is primary per the brief).
- Any cities to **exclude** (e.g., very distant ones where the owner will not travel).

Do not add new cities to schema or sitemap without owner confirmation.
