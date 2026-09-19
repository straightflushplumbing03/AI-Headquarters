/**
 * AI Authority Engine -- competitor intelligence.
 *
 * Discovers competitors from the answers themselves, measures their visible
 * position over time, and detects changes worth an alert.
 *
 * HARD RULES (enforced here, not merely documented):
 *   - We never attack competitors, never publish negative content about them,
 *     and never impersonate them.
 *   - We record only OBSERVED facts from answers we actually collected.
 *   - We do not claim a competitor is "winning"; we report counts and deltas.
 *   - "Share of voice" is explicitly an INTERNAL metric over our own sample,
 *     not a market measurement.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorityStore } from './store'
import type { CompetitorChangeType } from './types'

export interface DiscoveredCompetitor {
  name: string
  normalizedName: string
  website: string | null
  locations: string[]
  services: string[]
  mentionCount: number
  firstPositionCount: number
}

export interface CompetitorSnapshotData {
  competitorId: string
  competitorName: string
  windowDays: number
  mentionCount: number
  firstPositionCount: number
  citationCount: number
  responseCount: number
  distinctSourceDomains: number
  locationsSeen: string[]
  servicesSeen: string[]
  enginesSeen: string[]
  topSourceDomains: Array<{ domain: string; count: number }>
  internalShareOfVoice: number
}

export interface DetectedChange {
  competitorId: string
  competitorName: string
  changeType: CompetitorChangeType
  significance: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  details: Record<string, unknown>
  warrantsAction: boolean
}

/**
 * Aggregate mentions into per-competitor discovery candidates.
 *
 * Pure function over mention rows: no database access, so it is directly
 * testable. The subject business is excluded by `is_subject`.
 */
export function aggregateCompetitors(
  mentions: Array<{
    normalized_business_name: string
    business_name: string
    is_subject: boolean
    position: number
    website: string | null
    services_associated: string[]
    locations_associated: string[]
  }>
): DiscoveredCompetitor[] {
  const byName = new Map<string, DiscoveredCompetitor>()

  for (const mention of mentions) {
    if (mention.is_subject) continue
    const key = mention.normalized_business_name
    if (!key || key.length < 4) continue

    const existing = byName.get(key)
    if (existing) {
      existing.mentionCount += 1
      if (mention.position === 1) existing.firstPositionCount += 1
      if (!existing.website && mention.website) existing.website = mention.website
      for (const l of mention.locations_associated ?? []) {
        if (!existing.locations.includes(l)) existing.locations.push(l)
      }
      for (const s of mention.services_associated ?? []) {
        if (!existing.services.includes(s)) existing.services.push(s)
      }
    } else {
      byName.set(key, {
        name: mention.business_name,
        normalizedName: key,
        website: mention.website,
        locations: [...(mention.locations_associated ?? [])],
        services: [...(mention.services_associated ?? [])],
        mentionCount: 1,
        firstPositionCount: mention.position === 1 ? 1 : 0,
      })
    }
  }

  return [...byName.values()].sort((a, b) => b.mentionCount - a.mentionCount)
}

/**
 * Upsert discovered competitors and return a name-key to id map.
 *
 * Competitors are only ever CREATED here; existing rows have their observation
 * window refreshed. We never overwrite a human-edited website or phone.
 */
export async function persistCompetitors(params: {
  store: AuthorityStore
  organizationId: string
  discovered: DiscoveredCompetitor[]
}): Promise<Map<string, string>> {
  const { store, organizationId, discovered } = params
  const ids = new Map<string, string>()

  for (const competitor of discovered) {
    const id = await store.upsertCompetitor({
      organization_id: organizationId,
      name: competitor.name,
      normalized_name: competitor.normalizedName,
      website: competitor.website,
      discovery_source: 'ai_answer',
      locations: competitor.locations,
      services: competitor.services,
    })
    if (id) ids.set(competitor.normalizedName, id)
  }

  return ids
}

/**
 * Build a competitor snapshot for a window from already-collected rows.
 * Pure, so the trend maths can be unit tested without a database.
 */
export function buildSnapshotData(params: {
  competitorId: string
  competitorName: string
  windowDays: number
  mentions: Array<{
    competitor_id: string | null
    position: number
    locations_associated: string[]
    services_associated: string[]
  }>
  citations: Array<{ domain: string; cited_business_name: string | null }>
  responseCount: number
  enginesWithMentions: string[]
  subjectMentionTotal: number
}): CompetitorSnapshotData {
  const own = params.mentions.filter((m) => m.competitor_id === params.competitorId)

  const locationsSeen = new Set<string>()
  const servicesSeen = new Set<string>()
  let firstPositionCount = 0

  for (const mention of own) {
    if (mention.position === 1) firstPositionCount += 1
    for (const l of mention.locations_associated ?? []) locationsSeen.add(l)
    for (const s of mention.services_associated ?? []) servicesSeen.add(s)
  }

  const domainCounts = new Map<string, number>()
  for (const citation of params.citations) {
    if (!citation.cited_business_name) continue
    if (citation.cited_business_name.toLowerCase() !== params.competitorName.toLowerCase()) continue
    const domain = (citation.domain ?? '').toLowerCase()
    if (!domain) continue
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1)
  }

  const mentionCount = own.length
  const totalCompetitorPlusSubject = params.subjectMentionTotal + countAllMentions(params.mentions)

  return {
    competitorId: params.competitorId,
    competitorName: params.competitorName,
    windowDays: params.windowDays,
    mentionCount,
    firstPositionCount,
    citationCount: [...domainCounts.values()].reduce((a, b) => a + b, 0),
    responseCount: params.responseCount,
    distinctSourceDomains: domainCounts.size,
    locationsSeen: [...locationsSeen].sort(),
    servicesSeen: [...servicesSeen].sort(),
    enginesSeen: [...new Set(params.enginesWithMentions)].sort(),
    topSourceDomains: [...domainCounts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    /**
     * INTERNAL share of voice: this competitor's mentions as a share of all
     * business mentions WE observed in our own sample. It is not a market
     * measurement and must never be presented as one.
     */
    internalShareOfVoice:
      totalCompetitorPlusSubject > 0
        ? round2((mentionCount / totalCompetitorPlusSubject) * 100)
        : 0,
  }
}

function countAllMentions(
  mentions: Array<{ competitor_id: string | null; position: number }>
): number {
  return mentions.filter((m) => m.competitor_id !== null).length
}

/**
 * Diff two snapshots into alertable changes.
 *
 * Thresholds are intentionally blunt and documented, so an alert means
 * something: a 5+ mention swing, or a first-position change of 3+, is a real
 * movement in our sample rather than noise.
 */
export function detectChanges(params: {
  competitorId: string
  competitorName: string
  previous: CompetitorSnapshotData | null
  current: CompetitorSnapshotData
}): DetectedChange[] {
  const { competitorId, competitorName, previous, current } = params
  const changes: DetectedChange[] = []

  if (!previous) {
    changes.push({
      competitorId,
      competitorName,
      changeType: 'new_competitor',
      significance: current.mentionCount >= 5 ? 'medium' : 'low',
      summary: `${competitorName} first observed in AI answers (${current.mentionCount} mention(s))`,
      details: { mentionCount: current.mentionCount, windowDays: current.windowDays },
      warrantsAction: false,
    })
    return changes
  }

  const mentionDelta = current.mentionCount - previous.mentionCount

  if (mentionDelta >= 5) {
    changes.push({
      competitorId,
      competitorName,
      changeType: 'ai_visibility_increase',
      significance: mentionDelta >= 15 ? 'high' : 'medium',
      summary:
        `${competitorName} appeared in ${mentionDelta} more AI answers than the previous window ` +
        `(${previous.mentionCount} -> ${current.mentionCount})`,
      details: { previous: previous.mentionCount, current: current.mentionCount, delta: mentionDelta },
      warrantsAction: mentionDelta >= 10,
    })
  } else if (mentionDelta <= -5) {
    changes.push({
      competitorId,
      competitorName,
      changeType: 'ai_visibility_decrease',
      significance: 'low',
      summary:
        `${competitorName} appeared in ${Math.abs(mentionDelta)} fewer AI answers than the previous ` +
        `window (${previous.mentionCount} -> ${current.mentionCount})`,
      details: { previous: previous.mentionCount, current: current.mentionCount, delta: mentionDelta },
      warrantsAction: false,
    })
  }

  const firstDelta = current.firstPositionCount - previous.firstPositionCount
  if (firstDelta >= 3) {
    changes.push({
      competitorId,
      competitorName,
      changeType: 'ai_visibility_increase',
      significance: 'medium',
      summary: `${competitorName} was named first in ${firstDelta} more answers than previously`,
      details: { previousFirst: previous.firstPositionCount, currentFirst: current.firstPositionCount },
      warrantsAction: true,
    })
  }

  // New service or location footprint: a genuine new entrant into a market we
  // care about, worth surfacing even without a mention-count swing.
  const newServices = current.servicesSeen.filter((s) => !previous.servicesSeen.includes(s))
  const newLocations = current.locationsSeen.filter((l) => !previous.locationsSeen.includes(l))

  if (newServices.length > 0) {
    changes.push({
      competitorId,
      competitorName,
      changeType: 'new_service_page',
      significance: 'medium',
      summary: `${competitorName} newly associated with: ${newServices.slice(0, 4).join(', ')}`,
      details: { newServices },
      warrantsAction: newServices.length >= 2,
    })
  }

  if (newLocations.length > 0) {
    changes.push({
      competitorId,
      competitorName,
      changeType: 'new_city_page',
      significance: 'medium',
      summary: `${competitorName} newly associated with: ${newLocations.slice(0, 4).join(', ')}`,
      details: { newLocations },
      warrantsAction: newLocations.length >= 2,
    })
  }

  const domainGrowth = current.distinctSourceDomains - previous.distinctSourceDomains
  if (domainGrowth >= 3) {
    changes.push({
      competitorId,
      competitorName,
      changeType: 'new_citation',
      significance: 'low',
      summary: `${competitorName} gained citations from ${domainGrowth} new source domain(s)`,
      details: { previous: previous.distinctSourceDomains, current: current.distinctSourceDomains },
      warrantsAction: false,
    })
  }

  return changes
}

/** Persist detected changes, idempotent on the schema's unique constraint. */
export async function persistChanges(params: {
  store: AuthorityStore
  organizationId: string
  changes: DetectedChange[]
}): Promise<number> {
  const { store, organizationId, changes } = params
  let written = 0
  for (const change of changes) {
    written += await store.insertCompetitorChange({
      organization_id: organizationId,
      competitor_id: change.competitorId,
      change_type: change.changeType,
      significance: change.significance,
      summary: change.summary.slice(0, 500),
      details: change.details,
      warrants_action: change.warrantsAction,
    })
  }
  return written
}

/**
 * Competitor monitoring orchestrator.
 *
 * Reads what monitoring has already collected, aggregates, snapshots, diffs and
 * persists. It performs NO external calls of its own, so it is cheap and safe
 * to run frequently.
 */
export class CompetitorMonitor {
  constructor(
    private supabase: SupabaseClient,
    private store: AuthorityStore
  ) {}

  async run(params: {
    organizationId: string
    windowDays?: number
    snapshotDate?: string
  }): Promise<{
    competitorsTracked: number
    snapshotsWritten: number
    changesDetected: number
    alertsCreated: number
  }> {
    const organizationId = params.organizationId
    const windowDays = params.windowDays ?? 30
    const snapshotDate = params.snapshotDate ?? new Date().toISOString().slice(0, 10)

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
    const previousSince = new Date(Date.now() - windowDays * 2 * 24 * 60 * 60 * 1000).toISOString()

    const [currentRows, previousRows] = await Promise.all([
      this.loadMentions(organizationId, since),
      this.loadMentions(organizationId, previousSince, since),
    ])

    const discovered = aggregateCompetitors(currentRows)
    const idByName = await persistCompetitors({
      store: this.store,
      organizationId,
      discovered,
    })

    // Attach competitor ids to mentions so later windows can attribute properly.
    for (const row of currentRows) {
      if (row.is_subject) continue
      const competitorId = idByName.get(row.normalized_business_name)
      if (competitorId && row.id && !row.competitor_id) {
        await this.store.upsertMentionCompetitorLink(organizationId, row.id, competitorId)
      }
    }

    const citationRows = await this.loadCitations(organizationId, since)
    const subjectMentionTotal = currentRows.filter((r) => r.is_subject).length
    const responseCount = new Set(currentRows.map((r) => r.response_id)).size

    let snapshotsWritten = 0
    let changesDetected = 0
    let alertsCreated = 0

    for (const competitor of discovered) {
      const competitorId = idByName.get(competitor.normalizedName)
      if (!competitorId) continue

      const engines = await this.loadEnginesForCompetitor(organizationId, competitorId, since)

      const current = buildSnapshotData({
        competitorId,
        competitorName: competitor.name,
        windowDays,
        mentions: currentRows.map((r) => ({
          competitor_id: r.competitor_id ?? idByName.get(r.normalized_business_name) ?? null,
          position: r.position,
          locations_associated: r.locations_associated ?? [],
          services_associated: r.services_associated ?? [],
        })),
        citations: citationRows,
        responseCount,
        enginesWithMentions: engines,
        subjectMentionTotal,
      })

      const previousMentions = aggregateCompetitors(previousRows)
      const previousDiscovered = previousMentions.find(
        (p) => p.normalizedName === competitor.normalizedName
      )
      const previous = previousDiscovered
        ? buildSnapshotData({
            competitorId,
            competitorName: previousDiscovered.name,
            windowDays,
            mentions: previousRows.map((r) => ({
              competitor_id: r.normalized_business_name === competitor.normalizedName ? competitorId : null,
              position: r.position,
              locations_associated: r.locations_associated ?? [],
              services_associated: r.services_associated ?? [],
            })),
            citations: [],
            responseCount: new Set(previousRows.map((r) => r.response_id)).size,
            enginesWithMentions: [],
            subjectMentionTotal: previousRows.filter((r) => r.is_subject).length,
          })
        : null

      const wrote = await this.store.upsertCompetitorSnapshot({
        organization_id: organizationId,
        competitor_id: competitorId,
        snapshot_date: snapshotDate,
        window_days: windowDays,
        ai_mention_count: current.mentionCount,
        ai_first_position_count: current.firstPositionCount,
        ai_citation_count: current.citationCount,
        ai_response_count: current.responseCount,
        distinct_source_domains: current.distinctSourceDomains,
        locations_seen: current.locationsSeen,
        services_seen: current.servicesSeen,
        engines_seen: current.enginesSeen,
        top_source_domains: current.topSourceDomains,
        internal_share_of_voice: current.internalShareOfVoice,
        metrics: { note: 'Internal metric over the monitored sample only.' },
      })
      if (wrote) snapshotsWritten += 1

      const changes = detectChanges({
        competitorId,
        competitorName: competitor.name,
        previous,
        current,
      })
      changesDetected += changes.length

      const written = await persistChanges({
        store: this.store,
        organizationId,
        changes,
      })
      void written

      for (const change of changes) {
        if (!change.warrantsAction) continue
        const created = await this.store.insertAlert({
          organization_id: organizationId,
          alert_type:
            change.changeType === 'new_competitor'
              ? 'new_competitor'
              : change.changeType === 'ai_visibility_increase'
                ? 'competitor_visibility_increase'
                : change.changeType === 'new_citation'
                  ? 'citation_loss'
                  : 'new_competitor_service_page',
          severity: change.significance === 'critical' ? 'critical' : change.significance === 'high' ? 'high' : 'medium',
          title: `${change.competitorName}: ${change.changeType.replace(/_/g, ' ')}`,
          detail: change.summary,
          competitor_id: competitorId,
          metrics: change.details,
          dedupe_key: `competitor-change:${competitorId}:${change.changeType}:${snapshotDate}`,
        })
        if (created) alertsCreated += 1

        // Mirror into the pre-existing phase-4 alert table so the existing
        // Business Brain views surface authority findings without changes.
        await this.supabase.from('competitor_alerts').insert({
          organization_id: organizationId,
          competitor_name: change.competitorName,
          alert_type: change.changeType,
          finding: change.summary.slice(0, 1000),
          opportunity: 'Review whether comparable, truthful evidence exists for this business.',
          severity: change.significance,
          action_recommended: 'Review the competitor card in AI Authority; no direct action is taken.',
          status: 'new',
        })
      }
    }

    return {
      competitorsTracked: discovered.length,
      snapshotsWritten,
      changesDetected,
      alertsCreated,
    }
  }

  private async loadMentions(organizationId: string, since: string, until?: string) {
    let query = this.supabase
      .from('authority_mentions')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('created_at', since)
      .limit(5000)
    if (until) query = query.lt('created_at', until)

    const { data, error } = await query
    if (error) throw new Error(`loadMentions failed: ${error.message}`)
    return (data ?? []) as Array<{
      id: string
      response_id: string
      normalized_business_name: string
      business_name: string
      is_subject: boolean
      position: number
      website: string | null
      services_associated: string[]
      locations_associated: string[]
      competitor_id: string | null
    }>
  }

  private async loadCitations(organizationId: string, since: string) {
    const { data, error } = await this.supabase
      .from('authority_citations')
      .select('domain, cited_business_name')
      .eq('organization_id', organizationId)
      .gte('created_at', since)
      .limit(5000)

    if (error) throw new Error(`loadCitations failed: ${error.message}`)
    return (data ?? []) as Array<{ domain: string; cited_business_name: string | null }>
  }

  private async loadEnginesForCompetitor(
    organizationId: string,
    competitorId: string,
    since: string
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('authority_mentions')
      .select('engine_id')
      .eq('organization_id', organizationId)
      .eq('competitor_id', competitorId)
      .gte('created_at', since)
      .limit(2000)

    if (error) return []
    return [...new Set((data ?? []).map((r: { engine_id: string }) => r.engine_id))]
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}