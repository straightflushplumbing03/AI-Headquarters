import { SupabaseClient } from '@supabase/supabase-js'
import { CompanyProfileService } from '@/lib/phase4/company-profile'

/**
 * Straight Flush Plumbing Initialization
 * Sets up the first real-world organization with full context
 */
export class StraightFlushInitializer {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Initialize Straight Flush Plumbing as Organization #1
   */
  async initializeStraightFlush(organizationId: string): Promise<any> {
    const profileService = new CompanyProfileService(this.supabase)

    // Create company profile
    const profile = await profileService.initializeProfile(organizationId, {
      company_name: 'Straight Flush Plumbing & Leak Detection',
      brand_position: 'Always A Safe Bet',
      primary_specialties: [
        'Leak Detection',
        'Slab Leak Detection & Repair',
        'Hidden Water Leak Detection',
        'Advanced Electronic Leak Detection',
        'Plumbing Repair',
        'Emergency Plumbing',
        'Water Heater Installation & Repair',
        'Repipe/Re-piping',
        'Sewer Services',
        'Drain Cleaning',
      ],
      strategic_market: 'Orange County, California',
      service_areas: [
        'Laguna Niguel',
        'Dana Point',
        'San Clemente',
        'Laguna Beach',
        'Mission Viejo',
        'San Juan Capistrano',
        'Rancho Santa Margarita',
        'Lake Forest',
        'Irvine',
        'Newport Beach',
        'Costa Mesa',
        'Aliso Viejo',
        'Laguna Hills',
        'Foothill Ranch',
        'Coto de Caza',
        'Trabuco Canyon',
        'Ladera Ranch',
        'Laguna Woods',
        'Corona Del Mar',
      ],
      brand_values: ['Transparency', 'Expertise', 'Reliability', 'Education', 'Emergency Responsiveness'],
      primary_competitors: [
        'Local Orange County plumbing companies',
        'Regional plumbing services',
        'Leak detection specialists',
        'Emergency plumbing services',
      ],
      strategic_objectives: [
        'Dominate leak detection market in Orange County',
        'Build topical authority for plumbing expertise',
        'Achieve top 3 rankings for service keywords in all service areas',
        'Generate consistent high-quality leads through organic search',
        'Expand from emergency-reactive to proactive maintenance positioning',
        'Build educational content authority',
        'Establish reputation as most trustworthy plumber in OC',
      ],
      company_context:
        'Straight Flush Plumbing is a full-service plumbing company in Orange County, California, specializing in leak detection and repair. The company serves residential and commercial customers across 19 service areas. The business is driven by referrals and local search visibility. The goal is to build market-dominating online presence for leak detection and plumbing services.',
    })

    // Initialize base KPIs
    await this.initializeBaseKPIs(organizationId)

    // Initialize website pages (empty, to be populated later)
    await this.initializeWebsitePages(organizationId)

    return {
      status: 'initialized',
      organization_id: organizationId,
      company: profile,
      message: 'Straight Flush Plumbing initialized as Organization #1',
    }
  }

  /**
   * Initialize base KPIs for tracking
   */
  private async initializeBaseKPIs(organizationId: string): Promise<void> {
    const kpis = [
      {
        kpi_type: 'business',
        name: 'Monthly Revenue',
        unit: 'USD',
        description: 'Total monthly revenue from all sources',
      },
      {
        kpi_type: 'business',
        name: 'Monthly Leads',
        unit: 'count',
        description: 'Total qualified leads per month',
      },
      {
        kpi_type: 'business',
        name: 'Lead Conversion Rate',
        unit: 'percent',
        description: 'Percentage of leads that convert to estimates/jobs',
      },
      {
        kpi_type: 'seo',
        name: 'Organic Impressions',
        unit: 'count',
        description: 'Monthly search impressions in Google Search Console',
      },
      {
        kpi_type: 'seo',
        name: 'Organic Clicks',
        unit: 'count',
        description: 'Monthly clicks from organic search',
      },
      {
        kpi_type: 'seo',
        name: 'Average Search Position',
        unit: 'position',
        description: 'Average ranking position for tracked keywords',
      },
      {
        kpi_type: 'website',
        name: 'Monthly Website Visitors',
        unit: 'count',
        description: 'Total website visitors per month',
      },
      {
        kpi_type: 'website',
        name: 'Website Conversion Rate',
        unit: 'percent',
        description: 'Percentage of visitors who take action (call, form, etc)',
      },
      {
        kpi_type: 'website',
        name: 'Average Session Duration',
        unit: 'seconds',
        description: 'Average time spent on website per visit',
      },
    ]

    for (const kpi of kpis) {
      await this.supabase.from('business_kpis').insert([
        {
          organization_id: organizationId,
          ...kpi,
          data_source: 'manual',
        },
      ])
    }
  }

  /**
   * Initialize empty website pages structure
   */
  private async initializeWebsitePages(organizationId: string): Promise<void> {
    // This will be populated as pages are discovered
    // Starting with common page types
    const pages = [
      { url: 'https://straightflushplumbing.com', title: 'Home' },
      { url: 'https://straightflushplumbing.com/services', title: 'Services' },
      { url: 'https://straightflushplumbing.com/about', title: 'About Us' },
      { url: 'https://straightflushplumbing.com/contact', title: 'Contact' },
    ]

    for (const page of pages) {
      await this.supabase.from('website_pages').insert([
        {
          organization_id: organizationId,
          url: page.url,
          title: page.title,
          indexable: true,
        },
      ])
    }
  }

  /**
   * Get Straight Flush initialization status
   */
  async getInitializationStatus(organizationId: string): Promise<any> {
    const profileService = new CompanyProfileService(this.supabase)
    const profile = await profileService.getProfile(organizationId)

    const { data: kpis } = await this.supabase
      .from('business_kpis')
      .select('count')
      .eq('organization_id', organizationId)

    const { data: pages } = await this.supabase
      .from('website_pages')
      .select('count')
      .eq('organization_id', organizationId)

    return {
      organization_initialized: Boolean(profile),
      company_name: profile?.company_name,
      service_areas: profile?.service_areas?.length || 0,
      strategic_objectives: profile?.strategic_objectives?.length || 0,
      kpis_initialized: kpis?.[0]?.count || 0,
      pages_registered: pages?.[0]?.count || 0,
      ready_for_operation: Boolean(profile && kpis && pages),
    }
  }
}
