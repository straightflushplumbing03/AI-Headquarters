/**
 * GEO Lab API client (spec Phase 4).
 *
 * Talks to the GEO Intelligence Lab's versioned /api/v1 surface. The Lab runs
 * on a different stack (Next.js + SQLite) from Headquarters (Next.js +
 * Supabase), so the two share no database and this HTTP client is the only
 * coupling between them.
 *
 * Design notes:
 * - Credentials come from the server environment only. This module must never
 *   be imported into a client component: GEO_LAB_API_KEY is a server secret.
 * - Retries are limited to failures that can succeed on a second attempt
 *   (network, 5xx, 429). A 401 or 403 is returned immediately, because
 *   retrying bad credentials just burns the rate limit.
 * - Every failure carries a machine-readable reason so the connector can
 *   report *why* it is disconnected rather than just that it is.
 */

export type GeoLabFailureReason =
  | "not_configured"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "unreachable"
  | "server_error"
  | "bad_response"
  | "timeout";

export interface GeoLabEnvelope<T> {
  data: T;
  meta: {
    generatedAt: string;
    source: string;
    version: string;
    count: number;
    pagination?: { limit: number; offset: number; total: number; hasMore: boolean };
    window?: string;
    [key: string]: unknown;
  };
}

export class GeoLabError extends Error {
  readonly reason: GeoLabFailureReason;
  readonly status: number | null;

  constructor(reason: GeoLabFailureReason, message: string, status: number | null = null) {
    super(message);
    this.name = "GeoLabError";
    this.reason = reason;
    this.status = status;
  }
}

export interface GeoLabConfig {
  baseUrl: string | null;
  apiKey: string | null;
  timeoutMs: number;
  maxRetries: number;
}

export function geoLabConfig(): GeoLabConfig {
  const rawUrl = process.env.GEO_LAB_URL ?? "";
  return {
    // A trailing slash would produce a double slash in every path.
    baseUrl: rawUrl ? rawUrl.replace(/\/+$/, "") : null,
    apiKey: process.env.GEO_LAB_API_KEY ?? null,
    timeoutMs: Number(process.env.GEO_LAB_TIMEOUT_MS ?? 20000),
    maxRetries: Number(process.env.GEO_LAB_MAX_RETRIES ?? 3),
  };
}

export function isGeoLabConfigured(): boolean {
  const c = geoLabConfig();
  return Boolean(c.baseUrl && c.apiKey);
}

/** Environment variable names the operator must set, for honest status output. */
export function missingGeoLabEnvVars(): string[] {
  const missing: string[] = [];
  if (!process.env.GEO_LAB_URL) missing.push("GEO_LAB_URL");
  if (!process.env.GEO_LAB_API_KEY) missing.push("GEO_LAB_API_KEY");
  return missing;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET a path from the Lab, returning the parsed envelope.
 *
 * Retries on network failure, 5xx and 429 with exponential backoff. 4xx other
 * than 429 is terminal.
 */
export async function geoLabGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<GeoLabEnvelope<T>> {
  const config = geoLabConfig();
  if (!config.baseUrl || !config.apiKey) {
    throw new GeoLabError("not_configured", "GEO_LAB_URL or GEO_LAB_API_KEY is not set.");
  }

  const url = new URL(`${config.baseUrl}/api/v1${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let lastError: GeoLabError | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (attempt > 0) await sleep(Math.min(500 * 2 ** (attempt - 1), 4000));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);

      if (res.status === 401) {
        throw new GeoLabError("unauthorized", "GEO Lab rejected the API key.", 401);
      }
      if (res.status === 403) {
        const body = await res.text().catch(() => "");
        throw new GeoLabError("forbidden", `GEO Lab denied this key's scope. ${body.slice(0, 200)}`, 403);
      }
      if (res.status === 429) {
        lastError = new GeoLabError("rate_limited", "GEO Lab rate limit reached.", 429);
        continue; // Retryable.
      }
      if (res.status >= 500) {
        lastError = new GeoLabError("server_error", `GEO Lab returned ${res.status}.`, res.status);
        continue; // Retryable.
      }
      if (!res.ok) {
        throw new GeoLabError("bad_response", `GEO Lab returned ${res.status}.`, res.status);
      }

      const json = (await res.json()) as GeoLabEnvelope<T>;
      if (!json || typeof json !== "object" || !("data" in json) || !("meta" in json)) {
        throw new GeoLabError("bad_response", "GEO Lab response is missing the expected envelope.");
      }
      return json;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof GeoLabError) {
        // Terminal reasons are rethrown at once; retryable ones were recorded.
        if (error.reason === "unauthorized" || error.reason === "forbidden" || error.reason === "bad_response") {
          throw error;
        }
        lastError = error;
        continue;
      }
      const aborted = error instanceof Error && error.name === "AbortError";
      lastError = new GeoLabError(
        aborted ? "timeout" : "unreachable",
        aborted ? `GEO Lab did not respond within ${config.timeoutMs}ms.` : `Could not reach GEO Lab: ${String(error)}`,
      );
    }
  }

  throw lastError ?? new GeoLabError("unreachable", "GEO Lab request failed.");
}

/**
 * Probe the connection without throwing, for the status screen.
 * Returns a result object so the caller can render a state rather than catch.
 */
export async function geoLabHealth(): Promise<
  | { ok: true; latencyMs: number; health: Record<string, unknown>; meta: GeoLabEnvelope<unknown>["meta"] }
  | { ok: false; reason: GeoLabFailureReason; message: string }
> {
  if (!isGeoLabConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      message: `Not configured. Set ${missingGeoLabEnvVars().join(", ")}.`,
    };
  }
  const started = Date.now();
  try {
    const res = await geoLabGet<Record<string, unknown>>("/health");
    return { ok: true, latencyMs: Date.now() - started, health: res.data, meta: res.meta };
  } catch (error) {
    if (error instanceof GeoLabError) {
      return { ok: false, reason: error.reason, message: error.message };
    }
    return { ok: false, reason: "unreachable", message: String(error) };
  }
}

/** POST to the Lab, used for job submission. Not retried: a job must not double-submit. */
export async function geoLabPost<T>(path: string, body: Record<string, unknown>): Promise<GeoLabEnvelope<T>> {
  const config = geoLabConfig();
  if (!config.baseUrl || !config.apiKey) {
    throw new GeoLabError("not_configured", "GEO_LAB_URL or GEO_LAB_API_KEY is not set.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/api/v1${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (res.status === 401) throw new GeoLabError("unauthorized", "GEO Lab rejected the API key.", 401);
    if (res.status === 403) throw new GeoLabError("forbidden", "This key cannot submit jobs.", 403);
    if (res.status === 429) throw new GeoLabError("rate_limited", "GEO Lab rate limit reached.", 429);
    if (!res.ok) throw new GeoLabError("bad_response", `GEO Lab returned ${res.status}.`, res.status);
    return (await res.json()) as GeoLabEnvelope<T>;
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof GeoLabError) throw error;
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new GeoLabError(aborted ? "timeout" : "unreachable", String(error));
  }
}
