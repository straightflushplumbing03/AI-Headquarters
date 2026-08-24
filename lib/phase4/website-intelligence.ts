import { SupabaseClient } from '@supabase/supabase-js'
import type { WebsitePage } from '@/types/phase4'

/**
 * Website Intelligence System
 * Analyzes website architecture, content, and SEO signals
 */
export class WebsiteIntelligence {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Register a website page
   */
  async registerPage(
    organizationId: string,
    url: string,
    pageData: Partial<Omit<WebsitePage, 'id' | 'organization_id' | 'created_at' | 'updated_at'>>
  ): Promise<WebsitePage> {
    const { data, error } = await this.supabase
      .from('website_pages')
      .insert([
        {
          ...pageData,
          organization_id: organizationId,
          url,
          last_analyzed: new Date().toISOString(),
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Analyze page for issues
   */
  async identifyIssues(organizationId: string, url: string): Promise<any[]> {
    const { data: page } = await this.supabase
      .from('website_pages')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('url', url)
      .single()

    if (!page) return []

    const issues: any[] = []

    // Title analysis
    if (!page.title || page.title.length === 0) {
      issues.push({
        type: 'missing_title',
        severity: 'high',
        message: 'Page is missing an SEO title',
        recommendation: 'Add a descriptive title tag (50-60 characters)',
      })
    } else if (page.title.length < 30) {
      issues.push({
        type: 'short_title',
        severity: 'medium',
        message: 'Page title is too short',
        recommendation: 'Expand title to 50-60 characters',
      })
    }

    // Meta description analysis
    if (!page.meta_description) {
      issues.push({
        type: 'missing_meta_description',
        severity: 'medium',
        message: 'Page is missing a meta description',
        recommendation: 'Add a compelling meta description (155-160 characters)',
      })
    }

    // Schema markup
    if (!page.has_schema) {
      issues.push({
        type: 'missing_schema',
        severity: 'medium',
        message: 'Page lacks structured data (schema markup)',
        recommendation: 'Add appropriate schema markup (LocalBusiness, Service, FAQPage, etc.)',
      })
    }

    // Canonicals
    if (!page.has_canonical) {
      issues.push({
        type: 'missing_canonical',
        severity: 'low',
        message: 'Page lacks a canonical tag',
        recommendation: 'Add canonical tag to prevent duplicate content issues',
      })
    }

    // Indexability
    if (page.indexable === false) {
      issues.push({
        type: 'not_indexable',
        severity: 'high',
        message: 'Page is blocked from indexing',
        recommendation: 'Check robots.txt and noindex directives',
      })
    }

    // Content length
    if (page.content_word_count && page.content_word_count < 300) {
      issues.push({
        type: 'thin_content',
        severity: 'medium',
        message: `Page has only ${page.content_word_count} words (below 300-word minimum)`,
        recommendation: 'Expand content to provide more value and context',
      })
    }

    // Internal links
    if (!page.internal_links || page.internal_links === 0) {
      issues.push({
        type: 'no_internal_links',
        severity: 'low',
        message: 'Page has no internal links',
        recommendation: 'Add relevant internal links to related pages',
      })
    }

    return issues
  }

  /**
   * Identify opportunities
   */
  async identifyOpportunities(organizationId: string, url: string): Promise<any[]> {
    const { data: page } = await this.supabase
      .from('website_pages')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('url', url)
      .single()

    if (!page) return []

    const opportunities: any[] = []

    // Poor CTR opportunity
    if (
      page.search_impressions &&
      page.search_clicks &&
      page.search_impressions > 100 &&
      page.search_clicks / page.search_impressions < 0.02
    ) {
      opportunities.push({
        type: 'low_ctr_improvement',
        impact: 'high',
        message: `This page has ${page.search_impressions} impressions but only ${((page.search_clicks / page.search_impressions) * 100).toFixed(2)}% CTR`,
        recommendation:
          'Improve title tag and meta description to increase click-through rate. Consider adding review stars or numbers if available.',
        estimated_traffic_gain: Math.round(page.search_impressions * 0.03 * 0.5), // 3% CTR improvement
      })
    }

    // Ranking opportunity
    if (page.rank_position && page.rank_position > 5 && page.rank_position < 20) {
      opportunities.push({
        type: 'ranking_improvement',
        impact: 'medium',
        message: `Page ranks #${page.rank_position} - close to top results`,
        recommendation: 'Strengthen content, add internal links, and optimize for featured snippets to move into top 5',
        estimated_ctr_gain: 0.15, // Average 15% more clicks from top 5 vs 10-20
      })
    }

    // Content expansion opportunity
    if (page.content_word_count && page.content_word_count < 1000) {
      opportunities.push({
        type: 'content_expansion',
        impact: 'medium',
        message: `Page has ${page.content_word_count} words - can be expanded for better authority`,
        recommendation: 'Expand content to 1500-2000 words by covering related subtopics and answering common questions',
        benefit: 'Improved topical authority and ranked snippets',
      })
    }

    // Schema opportunity
    if (!page.has_schema) {
      opportunities.push({
        type: 'schema_markup',
        impact: 'medium',
        message: 'Missing schema markup for enhanced SERP features',
        recommendation:
          'Add schema markup: LocalBusiness (service pages), FAQPage (Q&A), HowTo (guides), Review (testimonials)',
        benefit: 'Enhanced search appearance, potential rich snippets',
      })
    }

    return opportunities
  }

  /**
   * Get all pages with issues
   */
  async getPagesWithIssues(organizationId: string): Promise<any[]> {
    const { data: pages } = await this.supabase
      .from('website_pages')
      .select('*')
      .eq('organization_id', organizationId)

    const pagesWithIssues = []

    for (const page of pages || []) {
      const issues = await this.identifyIssues(organizationId, page.url)
      if (issues.length > 0) {
        pagesWithIssues.push({
          page,
          issues,
        })
      }
    }

    return pagesWithIssues
  }

  /**
   * Get website health summary
   */
  async getWebsiteHealthSummary(organizationId: string): Promise<any> {
    const { data: pages } = await this.supabase
      .from('website_pages')
      .select('*')
      .eq('organization_id', organizationId)

    if (!pages || pages.length === 0) {
      return {
        status: 'no_data',
        total_pages: 0,
        health_score: 0,
        message: 'No pages analyzed yet',
      }
    }

    const withTitles = pages.filter((p) => p.title).length
    const withMeta = pages.filter((p) => p.meta_description).length
    const withSchema = pages.filter((p) => p.has_schema).length
    const withCanonical = pages.filter((p) => p.has_canonical).length
    const indexable = pages.filter((p) => p.indexable !== false).length

    // Simple health score: average of 5 key metrics
    const healthScore =
      (withTitles / pages.length + withMeta / pages.length + withSchema / pages.length + withCanonical / pages.length + indexable / pages.length) *
      20

    return {
      status: healthScore >= 70 ? 'healthy' : healthScore >= 50 ? 'needs_attention' : 'poor',
      total_pages: pages.length,
      health_score: Math.round(healthScore),
      pages_with_titles: withTitles,
      pages_with_meta: withMeta,
      pages_with_schema: withSchema,
      pages_with_canonical: withCanonical,
      pages_indexable: indexable,
      critical_issues_count: pages.filter((p) => !p.indexable || !p.title).length,
    }
  }
}
