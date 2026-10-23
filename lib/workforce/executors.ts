/**
 * Built-in workforce executors. Both are read-only: they observe and report,
 * they never change the website, ads or any customer data.
 *
 *   report.write  Workforce activity report for the task's organization.
 *                 resource: any label, e.g. 'reports/weekly'
 *   site.audit    On-page SEO health check of a live website, page by page
 *                 from its sitemap. resource: the site origin, e.g.
 *                 'https://straightflushplumbingoc.com'. Only URLs on that
 *                 exact origin are ever fetched.
 *
 * Each executor runs its work inside ctx.act(), so the database authorizes
 * the action at execution time and records the outcome.
 */

import type { Executor, ExecutorContext, RunnableTask } from './runner'

// --------------------------------------------------------------- report.write

interface ActivitySummary {
  since: string
  tasks_by_status: Record<string, number>
  tasks_completed: number
  tasks_failed: number
  events_by_type: Record<string, number>
  denials_by_reason: Record<string, number>
  cost_usd: number
  deliverables: number
  deliverables_verified: number
  approvals_pending: number
  approvals_escalated: number
  agents_active: number
}

const table = (rows: Record<string, number>, label: string) => {
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return `_No ${label}._\n`
  return `| ${label} | Count |\n| --- | ---: |\n` + entries.map(([k, v]) => `| ${k} | ${v} |`).join('\n') + '\n'
}

export function renderActivityReport(s: ActivitySummary, days: number, generatedAt: Date): string {
  return [
    `# Workforce activity report (last ${days} days)`,
    ``,
    `Generated ${generatedAt.toISOString()} from recorded events only.`,
    ``,
    `- Tasks completed: **${s.tasks_completed}**, failed: **${s.tasks_failed}**`,
    `- Deliverables: **${s.deliverables}** (${s.deliverables_verified} verified)`,
    `- Approvals waiting for the owner: **${s.approvals_pending}** (${s.approvals_escalated} escalated by agents)`,
    `- Recorded cost: **$${Number(s.cost_usd).toFixed(2)}**`,
    `- Active agents: **${s.agents_active}**`,
    ``,
    `## Tasks created in the period, by status`,
    table(s.tasks_by_status, 'Status'),
    `## Refusals by reason`,
    table(s.denials_by_reason, 'Reason'),
    `## Recorded events`,
    table(s.events_by_type, 'Event'),
  ].join('\n')
}

export const reportExecutor: Executor = {
  tool: 'report.write',
  async run(ctx: ExecutorContext) {
    const days = Math.min(Math.max(Number(ctx.task.input?.days ?? 7) || 7, 1), 90)
    const summary = await ctx.act('report.write', ctx.task.required_resource, async () => {
      const { data, error } = await ctx.client.rpc('workforce_activity_summary', {
        p_org: ctx.task.organization_id, p_days: days,
      })
      if (error) throw new Error(`activity summary failed: ${error.message}`)
      return { value: data as ActivitySummary, metadata: { days } }
    })
    const report = renderActivityReport(summary, days, new Date())
    await ctx.deliver({ kind: 'report', uri: `aihq://tasks/${ctx.task.id}/report.md`, content: report })
    return { result: report }
  },
}

// ----------------------------------------------------------------- site.audit

export interface PageAudit {
  url: string
  status: number | null
  ms: number | null
  title: string | null
  description: string | null
  h1Count: number
  canonical: string | null
  noindex: boolean
  issues: string[]
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim()

/** Value of an HTML attribute, honouring the quote it was written with ("it's" stays whole). */
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined
}

function metaContent(html: string, name: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const n = attr(tag, 'name') ?? attr(tag, 'property')
    if (n?.toLowerCase() === name) {
      const c = attr(tag, 'content')
      return c === undefined ? null : decode(c)
    }
  }
  return null
}

/** Pure HTML checks; network-free so it is unit-testable. */
export function auditHtml(url: string, status: number | null, html: string, ms: number | null): PageAudit {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const canonicalTag = (html.match(/<link\b[^>]*>/gi) ?? []).find((t) => attr(t, 'rel')?.toLowerCase() === 'canonical')
  const canonical = (canonicalTag && attr(canonicalTag, 'href')) || null
  const robots = metaContent(html, 'robots') ?? ''
  const a: PageAudit = {
    url, status, ms,
    title: title ? decode(title) : null,
    description: metaContent(html, 'description'),
    h1Count: (html.match(/<h1\b/gi) ?? []).length,
    canonical,
    noindex: /noindex/i.test(robots),
    issues: [],
  }
  if (status === null) a.issues.push('unreachable')
  else if (status >= 400) a.issues.push(`HTTP ${status}`)
  if (!a.title) a.issues.push('missing title')
  else if (a.title.length > 60) a.issues.push(`title too long (${a.title.length} chars)`)
  else if (a.title.length < 15) a.issues.push(`title too short (${a.title.length} chars)`)
  if (!a.description) a.issues.push('missing meta description')
  else if (a.description.length > 160) a.issues.push(`meta description too long (${a.description.length} chars)`)
  else if (a.description.length < 70) a.issues.push(`meta description short (${a.description.length} chars)`)
  if (a.h1Count === 0) a.issues.push('no H1')
  else if (a.h1Count > 1) a.issues.push(`${a.h1Count} H1 tags`)
  if (!canonical) a.issues.push('no canonical')
  if (a.noindex) a.issues.push('noindex')
  if (ms !== null && ms > 3000) a.issues.push(`slow response (${ms} ms)`)
  return a
}

/** Same-origin page URLs from a sitemap (or sitemap index's same-origin child sitemaps). */
export function sitemapUrls(xml: string, origin: string): string[] {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]))
  return [...new Set(locs.filter((u) => {
    try { return new URL(u).origin === origin } catch { return false }
  }))]
}

export function renderSiteAudit(origin: string, pages: PageAudit[], robotsOk: boolean, generatedAt: Date, truncated: number): string {
  const withIssues = pages.filter((p) => p.issues.length > 0)
  const counts: Record<string, number> = {}
  for (const p of pages) for (const i of p.issues) {
    const key = i.replace(/\s*\(.*\)$/, '').replace(/^\d+ H1 tags$/, 'multiple H1 tags')
    counts[key] = (counts[key] ?? 0) + 1
  }
  const issueRows = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return [
    `# Site audit: ${origin}`,
    ``,
    `Generated ${generatedAt.toISOString()}. Read-only check of ${pages.length} page(s) listed in the sitemap` +
      (truncated > 0 ? ` (${truncated} more not checked this run).` : '.'),
    ``,
    `- Pages with no issues: **${pages.length - withIssues.length}** of ${pages.length}`,
    `- robots.txt reachable: **${robotsOk ? 'yes' : 'no'}**`,
    ``,
    `## Issues by type`,
    issueRows.length === 0 ? '_None found._' :
      '| Issue | Pages |\n| --- | ---: |\n' + issueRows.map(([k, v]) => `| ${k} | ${v} |`).join('\n'),
    ``,
    `## Pages with issues`,
    withIssues.length === 0 ? '_None._' :
      '| Page | Status | Issues |\n| --- | ---: | --- |\n' +
      withIssues.map((p) => `| ${p.url} | ${p.status ?? '-'} | ${p.issues.join('; ')} |`).join('\n'),
    ``,
  ].join('\n')
}

async function timedFetch(fetcher: Fetcher, url: string, timeoutMs: number) {
  const started = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetcher(url, {
      signal: ctl.signal, redirect: 'follow',
      headers: { 'user-agent': 'AIHeadquarters-SiteAudit/1.0 (+read-only)' },
    })
    const body = await res.text()
    return { status: res.status, body: body.slice(0, 2_000_000), ms: Date.now() - started }
  } catch {
    return { status: null, body: '', ms: null }
  } finally {
    clearTimeout(timer)
  }
}

export function makeSiteAuditExecutor(
  fetcher: Fetcher = fetch,
  opts: { timeoutMs?: number; budgetMs?: number } = {},
): Executor {
  const timeoutMs = opts.timeoutMs ?? 8_000
  // The scheduled tick has a 60 s limit; stop crawling well before it.
  const budgetMs = opts.budgetMs ?? 35_000
  return {
    tool: 'site.audit',
    async run(ctx: ExecutorContext) {
      const resource = ctx.task.required_resource
      let origin: string
      try {
        const u = new URL(resource)
        if (u.protocol !== 'https:' || u.pathname !== '/' && u.pathname !== '') throw new Error()
        origin = u.origin
      } catch {
        throw new Error('site.audit resource must be an https origin, e.g. https://example.com')
      }
      const maxPages = Math.min(Math.max(Number(ctx.task.input?.maxPages ?? 20) || 20, 1), 100)
      const started = Date.now()

      const { pages, robotsOk, truncated } = await ctx.act('site.audit', resource, async () => {
        const robots = await timedFetch(fetcher, `${origin}/robots.txt`, timeoutMs)
        const sitemap = await timedFetch(fetcher, `${origin}/sitemap.xml`, timeoutMs)
        if (sitemap.status === null || sitemap.status >= 400) {
          throw new Error(`sitemap.xml not reachable (status ${sitemap.status ?? 'none'})`)
        }
        const all = sitemapUrls(sitemap.body, origin)
        const picked = all.slice(0, maxPages)
        const audits: PageAudit[] = []
        for (const url of picked) {
          if (Date.now() - started > budgetMs) break
          const r = await timedFetch(fetcher, url, timeoutMs)
          audits.push(auditHtml(url, r.status, r.body, r.ms))
        }
        return {
          value: { pages: audits, robotsOk: robots.status !== null && robots.status < 400, truncated: all.length - audits.length },
          metadata: { pages_checked: audits.length, pages_in_sitemap: all.length,
                      pages_with_issues: audits.filter((p) => p.issues.length > 0).length },
        }
      })

      const report = renderSiteAudit(origin, pages, robotsOk, new Date(), truncated)
      await ctx.deliver({ kind: 'report', uri: `aihq://tasks/${ctx.task.id}/site-audit.md`, content: report,
        metadata: { origin, pages_checked: pages.length } })
      return { result: report }
    },
  }
}

/** Read-only tools that get one task per week once the owner grants them. */
export const RECURRING_TOOLS = ['site.audit', 'report.write']

export function defaultExecutors(): Executor[] {
  return [reportExecutor, makeSiteAuditExecutor()]
}

export type { RunnableTask }
