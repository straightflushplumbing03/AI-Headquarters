/**
 * GEO Lab connection status (spec Phase 4).
 *
 * Answers, from stored data plus one live probe: is the integration connected,
 * when did it last succeed, how many records came in, and what is stale.
 *
 * The screen this feeds must never claim a healthy connection it cannot
 * evidence, so every field here is either a real probe result or a stored row.
 * An unconfigured integration reports `unconfigured` with the missing
 * environment variable names, and no counts are invented.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { geoLabHealth, isGeoLabConfigured, missingGeoLabEnvVars } from "./client";

export type ConnectionState = "connected" | "degraded" | "error" | "unconfigured";

export interface GeoLabStatus {
  state: ConnectionState;
  configured: boolean;
  missingEnvVars: string[];
  message: string;
  latencyMs: number | null;

  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSuccessAt: string | null;
  dataFreshnessMinutes: number | null;
  stale: boolean;

  records: {
    visibility: number;
    visibilityHistory: number;
    competitors: number;
    citations: number;
    geo: number;
    opportunities: number;
    jobs: number;
  };

  latestRun: {
    startedAt: string;
    status: string;
    recordsImported: number;
    recordsFetched: number;
    errorMessage: string | null;
  } | null;

  lab: {
    lastRunAt: string | null;
    lastVisibilityAt: string | null;
    counts: Record<string, number> | null;
  } | null;
}

/** Data older than this is reported as stale rather than fresh. */
const STALE_AFTER_MINUTES = 60 * 36; // 36 hours: a daily cadence plus slack.

export async function getGeoLabStatus(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<GeoLabStatus> {
  const configured = isGeoLabConfigured();
  const missingEnvVars = missingGeoLabEnvVars();

  const counts = await loadCounts(supabase, organizationId);
  const { data: lastRunRows } = await supabase
    .from("geo_lab_sync_runs")
    .select("started_at, finished_at, status, records_imported, records_fetched, error_message")
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(1);
  const lastRun = (lastRunRows?.[0] ?? null) as
    | {
        started_at: string;
        finished_at: string | null;
        status: string;
        records_imported: number;
        records_fetched: number;
        error_message: string | null;
      }
    | null;

  const { data: lastSuccessRows } = await supabase
    .from("geo_lab_sync_runs")
    .select("finished_at")
    .eq("organization_id", organizationId)
    .eq("status", "succeeded")
    .order("finished_at", { ascending: false })
    .limit(1);
  const lastSuccessAt = (lastSuccessRows?.[0]?.finished_at as string | null) ?? null;

  const freshnessMinutes = lastSuccessAt
    ? Math.round((Date.now() - new Date(lastSuccessAt).getTime()) / 60000)
    : null;
  const stale = freshnessMinutes === null ? true : freshnessMinutes > STALE_AFTER_MINUTES;

  if (!configured) {
    return {
      state: "unconfigured",
      configured: false,
      missingEnvVars,
      message: `Not configured. Set ${missingEnvVars.join(", ")} on the server.`,
      latencyMs: null,
      lastSyncAt: lastRun?.started_at ?? null,
      lastSyncStatus: lastRun?.status ?? null,
      lastSuccessAt,
      dataFreshnessMinutes: freshnessMinutes,
      stale: true,
      records: counts,
      latestRun: lastRun
        ? {
            startedAt: lastRun.started_at,
            status: lastRun.status,
            recordsImported: lastRun.records_imported,
            recordsFetched: lastRun.records_fetched,
            errorMessage: lastRun.error_message,
          }
        : null,
      lab: null,
    };
  }

  const probe = await geoLabHealth();

  let state: ConnectionState;
  let message: string;
  if (!probe.ok) {
    state = "error";
    message = probe.message;
  } else if (stale) {
    state = "degraded";
    message = "Connected, but imported data is stale. The last successful sync is older than expected.";
  } else {
    state = "connected";
    message = "Connected.";
  }

  const lab = probe.ok
    ? {
        lastRunAt: ((probe.health.data as Record<string, unknown>)?.lastRunAt as string) ?? null,
        lastVisibilityAt: ((probe.health.data as Record<string, unknown>)?.lastVisibilityAt as string) ?? null,
        counts: (probe.health.counts as Record<string, number>) ?? null,
      }
    : null;

  return {
    state,
    configured: true,
    missingEnvVars: [],
    message,
    latencyMs: probe.ok ? probe.latencyMs : null,
    lastSyncAt: lastRun?.started_at ?? null,
    lastSyncStatus: lastRun?.status ?? null,
    lastSuccessAt,
    dataFreshnessMinutes: freshnessMinutes,
    stale,
    records: counts,
    latestRun: lastRun
      ? {
          startedAt: lastRun.started_at,
          status: lastRun.status,
          recordsImported: lastRun.records_imported,
          recordsFetched: lastRun.records_fetched,
          errorMessage: lastRun.error_message,
        }
      : null,
    lab,
  };
}

async function loadCounts(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<GeoLabStatus["records"]> {
  const tables = [
    "geo_lab_visibility",
    "geo_lab_visibility_history",
    "geo_lab_competitors",
    "geo_lab_citations",
    "geo_lab_geo",
    "geo_lab_opportunities",
    "geo_lab_jobs",
  ] as const;

  const results = await Promise.all(
    tables.map((t) => supabase.from(t).select("id", { count: "exact", head: true }).eq("organization_id", organizationId)),
  );

  return {
    visibility: results[0].count ?? 0,
    visibilityHistory: results[1].count ?? 0,
    competitors: results[2].count ?? 0,
    citations: results[3].count ?? 0,
    geo: results[4].count ?? 0,
    opportunities: results[5].count ?? 0,
    jobs: results[6].count ?? 0,
  };
}

/** Submit a job to the Lab and record the Lab's answer verbatim. */
export async function submitGeoLabJob(
  supabase: SupabaseClient,
  organizationId: string,
  args: { kind: string; params?: Record<string, unknown>; requestedBy?: string },
): Promise<{ ok: boolean; jobId?: string; status?: string; requiresApproval?: boolean; message: string }> {
  const { geoLabPost, GeoLabError } = await import("./client");
  try {
    const res = await geoLabPost<{
      jobId: string;
      kind: string;
      status: string;
      requiresApproval: boolean;
      message: string;
    }>("/jobs", {
      kind: args.kind,
      params: args.params ?? {},
      requestedBy: args.requestedBy ?? "AI Headquarters",
    });

    const d = res.data;
    await supabase.from("geo_lab_jobs").upsert(
      {
        organization_id: organizationId,
        lab_job_id: d.jobId,
        kind: d.kind,
        params: args.params ?? {},
        status: d.status,
        requires_approval: d.requiresApproval,
        requested_by: args.requestedBy ?? "AI Headquarters",
        message: d.message,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,lab_job_id" },
    );

    return { ok: true, jobId: d.jobId, status: d.status, requiresApproval: d.requiresApproval, message: d.message };
  } catch (error) {
    if (error instanceof GeoLabError) {
      return { ok: false, message: `${error.reason}: ${error.message}` };
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Recent job submissions, for the status screen. */
export async function listGeoLabJobs(supabase: SupabaseClient, organizationId: string, limit = 25) {
  const { data } = await supabase
    .from("geo_lab_jobs")
    .select("lab_job_id, kind, status, requires_approval, requested_by, message, submitted_at, result, error")
    .eq("organization_id", organizationId)
    .order("submitted_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
