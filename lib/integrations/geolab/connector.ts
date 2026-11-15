/**
 * GEO Lab connector (spec Phase 4).
 *
 * Pulls research from the Lab's /api/v1 API and stores it in Supabase. The
 * module owns four responsibilities:
 *
 *   1. fetch   -- via the client, with retry
 *   2. normalize -- map the Lab's JSON onto our columns
 *   3. dedupe  -- upsert on (organization_id, source key), so a re-sync
 *                 updates rather than duplicates
 *   4. record  -- a sync_runs row per attempt, so the status screen can report
 *                 what happened, including failures
 *
 * A partial failure is recorded as `partial`, not `succeeded`: if visibility
 * imported but citations failed, the run says so. Nothing is silently dropped.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { geoLabGet, GeoLabError, isGeoLabConfigured, missingGeoLabEnvVars, type GeoLabFailureReason } from "./client";

export interface SyncResult {
  ok: boolean;
  status: "succeeded" | "partial" | "failed";
  syncRunId: string | null;
  fetched: number;
  imported: number;
  skipped: number;
  durationMs: number;
  resources: Record<string, { fetched: number; imported: number; error?: string }>;
  errorReason?: GeoLabFailureReason;
  errorMessage?: string;
}

/** Resources pulled on each sync, in dependency-free order. */
const RESOURCES = ["visibility", "visibilityHistory", "competitors", "citations", "geo", "opportunities"] as const;
type Resource = (typeof RESOURCES)[number];

/**
 * Run one synchronization for an organization.
 *
 * Never throws: a connection failure is recorded as a failed sync run and
 * returned, because the caller is a status screen that must render a state.
 */
export async function syncGeoLab(
  supabase: SupabaseClient,
  organizationId: string,
  options: { limit?: number; since?: string } = {},
): Promise<SyncResult> {
  const started = Date.now();
  const limit = options.limit ?? 500;
  const since = options.since ?? "-90 days";

  if (!isGeoLabConfigured()) {
    const message = `Not configured. Set ${missingGeoLabEnvVars().join(", ")}.`;
    const syncRunId = await recordSyncRun(supabase, organizationId, {
      status: "failed",
      errorReason: "not_configured",
      errorMessage: message,
      durationMs: Date.now() - started,
    });
    return {
      ok: false,
      status: "failed",
      syncRunId,
      fetched: 0,
      imported: 0,
      skipped: 0,
      durationMs: Date.now() - started,
      resources: {},
      errorReason: "not_configured",
      errorMessage: message,
    };
  }

  // Open the run first so a crash mid-sync still leaves a visible record.
  const syncRunId = await recordSyncRun(supabase, organizationId, { status: "running" });

  const resources: SyncResult["resources"] = {};
  let fetched = 0;
  let imported = 0;
  let skipped = 0;
  let labVersion: string | null = null;
  let labGeneratedAt: string | null = null;
  let firstError: { reason: GeoLabFailureReason; message: string } | null = null;

  for (const resource of RESOURCES) {
    try {
      const result = await importResource(supabase, organizationId, syncRunId, resource, { limit, since });
      resources[resource] = { fetched: result.fetched, imported: result.imported };
      fetched += result.fetched;
      imported += result.imported;
      skipped += result.fetched - result.imported;
      labVersion = result.version ?? labVersion;
      labGeneratedAt = result.generatedAt ?? labGeneratedAt;
    } catch (error) {
      const reason = error instanceof GeoLabError ? error.reason : "unreachable";
      const message = error instanceof Error ? error.message : String(error);
      resources[resource] = { fetched: 0, imported: 0, error: message };
      if (!firstError) firstError = { reason, message };
    }
  }

  const attempted = RESOURCES.length;
  const failedCount = Object.values(resources).filter((r) => r.error).length;
  const status: SyncResult["status"] = failedCount === 0 ? "succeeded" : failedCount === attempted ? "failed" : "partial";
  const durationMs = Date.now() - started;

  await finalizeSyncRun(supabase, syncRunId, {
    status,
    recordsFetched: fetched,
    recordsImported: imported,
    recordsSkipped: skipped,
    durationMs,
    labVersion,
    labGeneratedAt,
    errorReason: firstError?.reason ?? null,
    errorMessage: firstError?.message ?? null,
  });

  return {
    ok: status !== "failed",
    status,
    syncRunId,
    fetched,
    imported,
    skipped,
    durationMs,
    resources,
    errorReason: firstError?.reason,
    errorMessage: firstError?.message,
  };
}

async function importResource(
  supabase: SupabaseClient,
  organizationId: string,
  syncRunId: string | null,
  resource: Resource,
  opts: { limit: number; since: string },
): Promise<{ fetched: number; imported: number; version?: string; generatedAt?: string }> {
  switch (resource) {
    case "visibility": {
      const res = await geoLabGet<RawVisibility[]>("/visibility", { limit: opts.limit, since: opts.since });
      const rows = (res.data ?? []).map((v) => ({
        organization_id: organizationId,
        sync_run_id: syncRunId,
        source_row_id: v.id,
        source_run_id: v.runId ?? null,
        observed_at: toIso(v.observedAt),
        query: v.query ?? "",
        platform: v.platform ?? "",
        test_type: v.testType ?? null,
        status: v.status ?? null,
        mentioned: Boolean(v.mentioned),
        recommended: Boolean(v.recommended),
        cited_urls: v.citedUrls ?? [],
        competitors: v.competitors ?? [],
        rank: v.rank ?? null,
        city: v.city ?? null,
        service: v.service ?? null,
        confidence: v.confidence ?? null,
      }));
      const imported = await upsert(supabase, "geo_lab_visibility", rows, "organization_id,source_row_id");
      return { fetched: rows.length, imported, version: res.meta.version, generatedAt: res.meta.generatedAt };
    }
    case "visibilityHistory": {
      const res = await geoLabGet<RawHistory[]>("/visibility/history", { limit: opts.limit, since: opts.since });
      const rows = (res.data ?? [])
        .filter((h) => h.day)
        .map((h) => ({
          organization_id: organizationId,
          day: h.day,
          observations: h.observations ?? 0,
          mentions: h.mentions ?? 0,
          recommendations: h.recommendations ?? 0,
          citations: h.citations ?? 0,
          mention_rate: h.mentionRate ?? null,
          recommendation_rate: h.recommendationRate ?? null,
          citation_rate: h.citationRate ?? null,
          avg_rank: h.avgRank ?? null,
          rate_definition: (res.meta.rateDefinition as string) ?? null,
        }));
      const imported = await upsert(supabase, "geo_lab_visibility_history", rows, "organization_id,day");
      return { fetched: rows.length, imported, version: res.meta.version, generatedAt: res.meta.generatedAt };
    }
    case "competitors": {
      const res = await geoLabGet<RawCompetitor[]>("/competitors", { limit: opts.limit, since: opts.since });
      const rows = (res.data ?? []).map((c) => ({
        organization_id: organizationId,
        sync_run_id: syncRunId,
        source_row_id: c.id,
        domain: c.domain ?? "",
        name: c.name ?? null,
        tier: c.tier ?? null,
        home_city: c.homeCity ?? null,
        appearances: c.appearances ?? 0,
        observations: c.observations ?? 0,
        share_of_voice: c.shareOfVoice ?? null,
        last_platform: c.lastPlatform ?? null,
        last_seen_at: c.lastSeenAt ? toIso(c.lastSeenAt) : null,
      }));
      const imported = await upsert(supabase, "geo_lab_competitors", rows, "organization_id,source_row_id");
      return { fetched: rows.length, imported, version: res.meta.version, generatedAt: res.meta.generatedAt };
    }
    case "citations": {
      const res = await geoLabGet<{ sources?: RawCitation[]; sourcesTotal?: number }>("/citations", {
        limit: opts.limit,
        since: opts.since,
        include: "sources",
      });
      const rows = (res.data?.sources ?? []).map((c) => ({
        organization_id: organizationId,
        sync_run_id: syncRunId,
        domain: c.domain,
        citations: c.citations ?? 0,
        owned_citations: c.ownedCitations ?? 0,
        first_seen_at: c.firstSeenAt ? toIso(c.firstSeenAt) : null,
        last_seen_at: c.lastSeenAt ? toIso(c.lastSeenAt) : null,
      }));
      const imported = await upsert(supabase, "geo_lab_citations", rows, "organization_id,domain");
      return { fetched: rows.length, imported, version: res.meta.version, generatedAt: res.meta.generatedAt };
    }
    case "geo": {
      const res = await geoLabGet<RawGeo[]>("/geo", { limit: opts.limit, since: opts.since });
      const rows = (res.data ?? []).map((g) => ({
        organization_id: organizationId,
        sync_run_id: syncRunId,
        city: g.city,
        priority: Boolean(g.priority),
        observations: g.observations ?? 0,
        mentions: g.mentions ?? 0,
        recommendations: g.recommendations ?? 0,
        mention_rate: g.mentionRate ?? null,
        recommendation_rate: g.recommendationRate ?? null,
        avg_rank: g.avgRank ?? null,
        platforms: g.platforms ?? 0,
        last_observed_at: g.lastObservedAt ? toIso(g.lastObservedAt) : null,
      }));
      const imported = await upsert(supabase, "geo_lab_geo", rows, "organization_id,city");
      return { fetched: rows.length, imported, version: res.meta.version, generatedAt: res.meta.generatedAt };
    }
    case "opportunities": {
      const res = await geoLabGet<RawOpportunity[]>("/opportunities", {
        limit: opts.limit,
        status: "all",
      });
      const rows = (res.data ?? []).map((o) => ({
        organization_id: organizationId,
        sync_run_id: syncRunId,
        source_row_id: o.id,
        identified_at: o.identifiedAt ? toIso(o.identifiedAt) : null,
        title: o.title ?? null,
        problem: o.problem ?? null,
        evidence: o.evidence ?? null,
        url: o.url ?? null,
        section: o.section ?? null,
        geo_layer: o.geoLayer ?? null,
        expected_benefit: o.expectedBenefit ?? null,
        difficulty: o.difficulty ?? null,
        priority: o.priority ?? null,
        proposed_solution: o.proposedSolution ?? null,
        status: o.status ?? null,
        implemented_at: o.implementedAt ? toIso(o.implementedAt) : null,
        result: o.result ?? null,
      }));
      const imported = await upsert(supabase, "geo_lab_opportunities", rows, "organization_id,source_row_id");
      return { fetched: rows.length, imported, version: res.meta.version, generatedAt: res.meta.generatedAt };
    }
  }
}

/**
 * Upsert with dedupe. Returns the number of rows written.
 *
 * `onConflict` names the unique key, so a row already present is updated
 * instead of inserted twice. This is what makes a repeated sync idempotent.
 */
async function upsert(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  // Chunked so a large sync does not exceed the request size limit.
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

/** The Lab stores UTC timestamps without a zone; SQLite space format is normalised here. */
function toIso(value: string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const normalised = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function recordSyncRun(
  supabase: SupabaseClient,
  organizationId: string,
  fields: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("geo_lab_sync_runs")
    .insert({ organization_id: organizationId, ...fields })
    .select("id")
    .single();
  if (error) {
    console.error("[geolab] could not record sync run", error.message);
    return null;
  }
  return (data as { id: string }).id;
}

async function finalizeSyncRun(
  supabase: SupabaseClient,
  syncRunId: string | null,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!syncRunId) return;
  const { error } = await supabase
    .from("geo_lab_sync_runs")
    .update({ finished_at: new Date().toISOString(), ...fields })
    .eq("id", syncRunId);
  if (error) console.error("[geolab] could not finalize sync run", error.message);
}

// ── Raw shapes as the Lab returns them ────────────────────────────────────────
interface RawVisibility {
  id: number;
  runId?: number;
  observedAt: string;
  query?: string;
  platform?: string;
  testType?: string;
  status?: string;
  mentioned?: boolean;
  recommended?: boolean;
  citedUrls?: string[];
  competitors?: string[];
  rank?: number | null;
  city?: string | null;
  service?: string | null;
  confidence?: string | null;
}
interface RawHistory {
  day?: string;
  observations?: number;
  mentions?: number;
  recommendations?: number;
  citations?: number;
  mentionRate?: number;
  recommendationRate?: number;
  citationRate?: number;
  avgRank?: number | null;
}
interface RawCompetitor {
  id: number;
  domain?: string;
  name?: string;
  tier?: string | null;
  homeCity?: string | null;
  appearances?: number;
  observations?: number;
  shareOfVoice?: number;
  lastPlatform?: string | null;
  lastSeenAt?: string | null;
}
interface RawCitation {
  domain: string;
  citations?: number;
  ownedCitations?: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}
interface RawGeo {
  city: string;
  priority?: boolean;
  observations?: number;
  mentions?: number;
  recommendations?: number;
  mentionRate?: number;
  recommendationRate?: number;
  avgRank?: number | null;
  platforms?: number;
  lastObservedAt?: string | null;
}
interface RawOpportunity {
  id: number;
  identifiedAt?: string;
  title?: string | null;
  problem?: string | null;
  evidence?: string | null;
  url?: string | null;
  section?: string | null;
  geoLayer?: string | null;
  expectedBenefit?: string | null;
  difficulty?: string | null;
  priority?: number | null;
  proposedSolution?: string | null;
  status?: string | null;
  implementedAt?: string | null;
  result?: string | null;
}
