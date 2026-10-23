import { describe, it, expect } from 'vitest'
import { auditHtml, sitemapUrls, renderSiteAudit, renderActivityReport } from '@/lib/workforce/executors'

describe('auditHtml', () => {
  const good =
    '<html><head><title>Slab Leak Repair in Mission Viejo | Straight Flush</title>' +
    '<meta content="Non-invasive slab leak detection and repair in Mission Viejo. Licensed, insured, upfront pricing." name="description">' +
    '<link href="https://x.example/slab" rel="canonical"></head><body><h1>Slab leaks</h1></body></html>'

  it('passes a well-formed page, regardless of attribute order', () => {
    const a = auditHtml('https://x.example/slab', 200, good, 300)
    expect(a.issues).toEqual([])
    expect(a.canonical).toBe('https://x.example/slab')
    expect(a.description).toMatch(/^Non-invasive/)
  })

  it('flags the common on-page problems', () => {
    const a = auditHtml('https://x.example/', 200,
      '<head><title>Home</title><meta name="robots" content="noindex"></head><h1>a</h1><h1>b</h1>', 4200)
    expect(a.issues).toEqual([
      'title too short (4 chars)', 'missing meta description', '2 H1 tags', 'no canonical', 'noindex', 'slow response (4200 ms)'])
  })

  it('reports HTTP errors and unreachable pages', () => {
    expect(auditHtml('u', 404, '', 10).issues[0]).toBe('HTTP 404')
    expect(auditHtml('u', null, '', null).issues[0]).toBe('unreachable')
  })

  it('keeps apostrophes inside double-quoted attributes', () => {
    const a = auditHtml('u', 200, `<meta name="description" content="Irvine's villages span 1970s builds to brand-new homes; we match the approach to your village.">`, 1)
    expect(a.description).toBe("Irvine's villages span 1970s builds to brand-new homes; we match the approach to your village.")
    expect(auditHtml('u', 200, `<link rel='canonical' href='https://a.example/o"k'>`, 1).canonical).toBe('https://a.example/o"k')
  })

  it('decodes entities and whitespace in titles', () => {
    expect(auditHtml('u', 200, '<title>  Drains &amp;\n Sewers  </title>', 1).title).toBe('Drains & Sewers')
  })
})

describe('sitemapUrls', () => {
  it('keeps only same-origin, de-duplicated URLs', () => {
    const xml = '<urlset><url><loc> https://a.example/ </loc></url><url><loc>https://a.example/x</loc></url>' +
      '<url><loc>https://a.example/x</loc></url><url><loc>https://b.example/</loc></url><url><loc>not a url</loc></url></urlset>'
    expect(sitemapUrls(xml, 'https://a.example')).toEqual(['https://a.example/', 'https://a.example/x'])
  })
})

describe('report rendering', () => {
  it('summarizes the site audit by issue type', () => {
    const md = renderSiteAudit('https://a.example', [
      { url: 'https://a.example/', status: 200, ms: 1, title: 't', description: null, h1Count: 2, canonical: null, noindex: false,
        issues: ['missing meta description', '2 H1 tags'] },
      { url: 'https://a.example/b', status: 200, ms: 1, title: 't', description: null, h1Count: 3, canonical: null, noindex: false,
        issues: ['3 H1 tags'] },
    ], true, new Date('2026-10-23T00:00:00Z'), 5)
    expect(md).toContain('(5 more not checked this run)')
    expect(md).toContain('| multiple H1 tags | 2 |')
    expect(md).toContain('| missing meta description | 1 |')
  })

  it('renders the activity report from figures only', () => {
    const md = renderActivityReport({
      since: '', tasks_by_status: { completed: 3, queued: 1 }, tasks_completed: 3, tasks_failed: 0,
      events_by_type: { 'workforce.task_claimed': 3 }, denials_by_reason: {}, cost_usd: 0.125,
      deliverables: 2, deliverables_verified: 2, approvals_pending: 1, approvals_escalated: 0, agents_active: 4,
    }, 7, new Date('2026-10-23T00:00:00Z'))
    expect(md).toContain('Tasks completed: **3**')
    expect(md).toContain('Recorded cost: **$0.13**')
    expect(md).toContain('_No Reason._')
  })
})
