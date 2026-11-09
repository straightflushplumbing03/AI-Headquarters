/**
 * GET /api/ai-authority/geolab/metrics
 *
 * The dashboard read model (spec Phase 5). Assembles the imported GEO Lab data
 * into the shapes the intelligence modules need:
 *
 *   visibility   -- rates and trend for the AI Visibility Dashboard
 *   recommendations -- which platforms recommend us, and where we are absent
 *   competitors  -- Competitor Intelligence scorecard
 *   geo          -- Geographic Visibility, Laguna Niguel first
 *   citations    -- Citation Intelligence
 *   opportunities -- recommended improvements, by GEO layer
 *
 * Every figure is computed from stored rows. Nothing is estimated, and a
 * dimension with no data returns an empty list rather than a zero that would
 * read as "measured and found nothing".
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
} from "@/lib/authority/api-auth";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** Laguna Niguel is the initial priority market (spec Phase 5). */
const PRIORITY_MARKET = "Laguna Niguel";

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request);
    const auth = await authenticateAuthorityRequest(organizationId);
    if (isAuthFailure(auth)) return auth.response;
    const db = auth.supabase;

    const [trend, platforms, competitors, geo, citations, opportunities, lagunaNiguel] = await Promise.all([
      loadTrend(db, auth.organizationId),
      loadPlatforms(db, auth.organizationId),
      loadCompetitors(db, auth.organizationId),
      loadGeo(db, auth.organizationId),
      loadCitations(db, auth.organizationId),
      loadOpportunities(db, auth.organizationId),
      loadCityDetail(db, auth.organizationId, PRIORITY_MARKET),
    ]);

    // Overall rates come from the summed counts, not an average of averages,
    // so a day with more observations carries its true weight.
    const totals = trend.reduce(
      (acc, d) => ({
        observations: acc.observations + d.observations,
        mentions: acc.mentions + d.mentions,
        recommendations: acc.recommendations + d.recommendations,
        citations: acc.citations + d.citations,
      }),
      { observations: 0, mentions: 0, recommendations: 0, citations: 0 },
    );
    const rate = (n: number) => (totals.observations > 0 ? Math.round((n / totals.observations) * 1000) / 10 : 0);

    return NextResponse.json({
      priorityMarket: PRIORITY_MARKET,
      generatedAt: new Date().toISOString(),
      visibility: {
        observations: totals.observations,
        mentionRate: rate(totals.mentions),
        recommendationRate: rate(totals.recommendations),
        citationRate: rate(totals.citations),
        trend,
      },
      platforms,
      competitors,
      geo,
      citations,
      opportunities,
      priorityCity: lagunaNiguel,
      // Stated so no display presents these as platform-reported figures.
      rateDefinition:
        "percent of stored observations in the window; measured by the GEO Lab from its own AI-search tests",
    });
  } catch (error) {
    return authorityErrorResponse(error, "geolab metrics");
  }
}

async function loadTrend(db: SupabaseClient, organizationId: string) {
  const { data } = await db
    .from("geo_lab_visibility_history")
    .select("day, observations, mentions, recommendations, citations, mention_rate, recommendation_rate, citation_rate, avg_rank")
    .eq("organization_id", organizationId)
    .order("day", { ascending: true });
  return (data ?? []).map((r) => ({
    day: r.day,
    observations: r.observations ?? 0,
    mentions: r.mentions ?? 0,
    recommendations: r.recommendations ?? 0,
    citations: r.citations ?? 0,
    mentionRate: num(r.mention_rate),
    recommendationRate: num(r.recommendation_rate),
    citationRate: num(r.citation_rate),
    avgRank: num(r.avg_rank),
  }));
}

/** Per-platform rates, so "recommended by ChatGPT" and "cited by Perplexity" stay distinct. */
async function loadPlatforms(db: SupabaseClient, organizationId: string) {
  const { data } = await db
    .from("geo_lab_visibility")
    .select("platform, mentioned, recommended, cited_urls, rank")
    .eq("organization_id", organizationId);

  const byPlatform = new Map<string, { observations: number; mentions: number; recommendations: number; citations: number }>();
  for (const row of data ?? []) {
    const key = String(row.platform ?? "unknown");
    const cur = byPlatform.get(key) ?? { observations: 0, mentions: 0, recommendations: 0, citations: 0 };
    cur.observations += 1;
    if (row.mentioned) cur.mentions += 1;
    if (row.recommended) cur.recommendations += 1;
    if (Array.isArray(row.cited_urls) && row.cited_urls.length > 0) cur.citations += 1;
    byPlatform.set(key, cur);
  }

  const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
  return [...byPlatform.entries()]
    .map(([platform, c]) => ({
      platform,
      observations: c.observations,
      mentions: c.mentions,
      recommendations: c.recommendations,
      citations: c.citations,
      mentionRate: pct(c.mentions, c.observations),
      recommendationRate: pct(c.recommendations, c.observations),
      citationRate: pct(c.citations, c.observations),
    }))
    .sort((a, b) => b.observations - a.observations);
}

async function loadCompetitors(db: SupabaseClient, organizationId: string) {
  const { data } = await db
    .from("geo_lab_competitors")
    .select("domain, name, tier, home_city, appearances, observations, share_of_voice, last_platform, last_seen_at")
    .eq("organization_id", organizationId)
    .order("share_of_voice", { ascending: false, nullsFirst: false })
    .limit(25);
  return (data ?? []).map((r) => ({
    domain: r.domain,
    name: r.name,
    tier: r.tier,
    homeCity: r.home_city,
    appearances: r.appearances ?? 0,
    observations: r.observations ?? 0,
    shareOfVoice: num(r.share_of_voice),
    lastPlatform: r.last_platform,
    lastSeenAt: r.last_seen_at,
  }));
}

async function loadGeo(db: SupabaseClient, organizationId: string) {
  const { data } = await db
    .from("geo_lab_geo")
    .select("city, priority, observations, mentions, recommendations, mention_rate, recommendation_rate, avg_rank, platforms, last_observed_at")
    .eq("organization_id", organizationId)
    .order("priority", { ascending: false })
    .order("observations", { ascending: false });
  return (data ?? []).map((r) => ({
    city: r.city,
    priority: Boolean(r.priority),
    observations: r.observations ?? 0,
    mentions: r.mentions ?? 0,
    recommendations: r.recommendations ?? 0,
    mentionRate: num(r.mention_rate),
    recommendationRate: num(r.recommendation_rate),
    avgRank: num(r.avg_rank),
    platforms: r.platforms ?? 0,
    lastObservedAt: r.last_observed_at,
  }));
}

async function loadCitations(db: SupabaseClient, organizationId: string) {
  const { data } = await db
    .from("geo_lab_citations")
    .select("domain, citations, owned_citations, first_seen_at, last_seen_at")
    .eq("organization_id", organizationId)
    .order("citations", { ascending: false })
    .limit(25);
  return (data ?? []).map((r) => ({
    domain: r.domain,
    citations: r.citations ?? 0,
    ownedCitations: r.owned_citations ?? 0,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  }));
}

async function loadOpportunities(db: SupabaseClient, organizationId: string) {
  const { data } = await db
    .from("geo_lab_opportunities")
    .select("title, problem, evidence, url, section, geo_layer, expected_benefit, difficulty, priority, status")
    .eq("organization_id", organizationId)
    .order("priority", { ascending: false, nullsFirst: false })
    .limit(50);
  const rows = data ?? [];
  const byLayer = new Map<string, number>();
  for (const r of rows) {
    const layer = String(r.geo_layer ?? "unclassified");
    byLayer.set(layer, (byLayer.get(layer) ?? 0) + 1);
  }
  return {
    total: rows.length,
    byLayer: [...byLayer.entries()].map(([layer, count]) => ({ layer, count })).sort((a, b) => b.count - a.count),
    items: rows.map((r) => ({
      title: r.title,
      problem: r.problem,
      evidence: r.evidence,
      url: r.url,
      section: r.section,
      geoLayer: r.geo_layer,
      expectedBenefit: r.expected_benefit,
      difficulty: r.difficulty,
      priority: r.priority,
      status: r.status,
    })),
  };
}

/** The priority city's own observations, so its detail view is real data. */
async function loadCityDetail(db: SupabaseClient, organizationId: string, city: string) {
  const { data } = await db
    .from("geo_lab_visibility")
    .select("query, platform, observed_at, mentioned, recommended, rank, status")
    .eq("organization_id", organizationId)
    .eq("city", city)
    .order("observed_at", { ascending: false })
    .limit(25);

  const observations = data ?? [];
  return {
    city,
    observations: observations.length,
    mentions: observations.filter((o) => o.mentioned).length,
    recommendations: observations.filter((o) => o.recommended).length,
    rows: observations,
    // The Lab stores city as null unless a test was city-scoped; the query text
    // still names the city. Report that rather than implying no measurement.
    note:
      observations.length === 0
        ? "No city-scoped rows are stored. The Lab records the city on a test only when it is set explicitly; city-named queries appear under the global visibility list."
        : null,
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
