/**
 * AI Authority Engine -- read-only repository status.
 *
 * Answers the operational question the daily briefing cannot: "did the change
 * that was supposed to ship actually pass CI and land on the default branch?"
 *
 * Scope and safety:
 *   * READ-ONLY. Only GET requests are ever issued. This module cannot open,
 *     merge, comment on, or close anything.
 *   * Credential-gated. With no token it reports `unconfigured`; it never
 *     fabricates a green status.
 *   * Not part of a dashboard read model. Live external calls belong to an
 *     explicit request or a scheduled job, never to a page render.
 *
 * REQUIRED CREDENTIAL (documented, never committed):
 *   GITHUB_STATUS_TOKEN   a fine-grained token with read-only "Contents",
 *                         "Pull requests" and "Actions" access on the repo.
 *                         Falls back to GITHUB_TOKEN when the dedicated
 *                         variable is absent.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthorityStore } from './store'

const API = 'https://api.github.com'

export interface RepositoryTarget {
  owner: string
  repo: string
  defaultBranch: string
}

export interface PullRequestSummary {
  number: number
  title: string
  draft: boolean
  state: string
  mergeableState: string | null
  headRef: string
  updatedAt: string | null
  url: string
}

export interface CheckSummary {
  name: string
  status: string
  conclusion: string | null
}

export interface RepositoryStatus {
  target: RepositoryTarget
  defaultBranchSha: string | null
  defaultBranchCommitAt: string | null
  checks: CheckSummary[]
  /** Rolled-up CI state for the default branch head. */
  ciStatus: 'passing' | 'failing' | 'pending' | 'unknown'
  openPullRequests: PullRequestSummary[]
  fetchedAt: string
}

export interface RepositoryStatusResult {
  provider: 'github_repository'
  status: 'unconfigured' | 'configured' | 'connected' | 'error'
  missingEnvVars: string[]
  message: string
  snapshot: RepositoryStatus | null
}

const STATUS_ENV_VARS = ['GITHUB_STATUS_TOKEN', 'GITHUB_TOKEN']

/** The token to use, preferring the dedicated read-only variable. */
export function githubStatusToken(): string | null {
  for (const name of STATUS_ENV_VARS) {
    const value = process.env[name]
    if (value && value.trim().length > 0) return value.trim()
  }
  return null
}

export function missingGithubStatusEnvVars(): string[] {
  return githubStatusToken() ? [] : ['GITHUB_STATUS_TOKEN']
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}

async function githubGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'BusinessBrainAI-AuthorityBot/1.0',
    },
  })

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`GitHub GET ${path} failed (HTTP ${response.status}): ${truncate(raw, 200)}`)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`GitHub GET ${path} returned non-JSON body`)
  }
}

/** Roll a set of check runs up into a single state. */
export function summarizeChecks(checks: CheckSummary[]): RepositoryStatus['ciStatus'] {
  if (checks.length === 0) return 'unknown'
  if (checks.some((c) => c.status !== 'completed')) return 'pending'
  const conclusions = checks.map((c) => (c.conclusion ?? '').toLowerCase())
  if (conclusions.some((c) => c === 'failure' || c === 'timed_out' || c === 'cancelled')) return 'failing'
  if (conclusions.every((c) => c === 'success' || c === 'skipped' || c === 'neutral')) return 'passing'
  return 'unknown'
}

/**
 * Fetch a read-only snapshot of the repository.
 *
 * Never throws for an unreachable repo; the caller decides how to report it.
 */
export async function fetchRepositoryStatus(
  target: RepositoryTarget,
  token: string
): Promise<RepositoryStatus> {
  const { owner, repo, defaultBranch } = target

  const [branch, pulls] = await Promise.all([
    githubGet<{ commit?: { sha?: string; commit?: { committer?: { date?: string } } } }>(
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(defaultBranch)}`,
      token
    ),
    githubGet<unknown[]>(`/repos/${owner}/${repo}/pulls?state=open&per_page=30`, token),
  ])

  const sha = branch.commit?.sha ?? null
  const committedAt = branch.commit?.commit?.committer?.date ?? null

  let checks: CheckSummary[] = []
  if (sha) {
    const runs = await githubGet<{ check_runs?: unknown[] }>(
      `/repos/${owner}/${repo}/commits/${sha}/check-runs`,
      token
    )
    checks = (runs.check_runs ?? []).map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>
      return {
        name: String(row.name ?? 'unnamed'),
        status: String(row.status ?? 'unknown'),
        conclusion: row.conclusion === null || row.conclusion === undefined ? null : String(row.conclusion),
      }
    })
  }

  const openPullRequests: PullRequestSummary[] = (Array.isArray(pulls) ? pulls : []).map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>
    const head = (row.head ?? {}) as Record<string, unknown>
    return {
      number: Number(row.number ?? 0),
      title: String(row.title ?? ''),
      draft: Boolean(row.draft),
      state: String(row.state ?? ''),
      mergeableState: row.mergeable_state === undefined ? null : String(row.mergeable_state),
      headRef: String(head.ref ?? ''),
      updatedAt: row.updated_at === undefined ? null : String(row.updated_at),
      url: String(row.html_url ?? ''),
    }
  })

  return {
    target,
    defaultBranchSha: sha,
    defaultBranchCommitAt: committedAt,
    checks,
    ciStatus: summarizeChecks(checks),
    openPullRequests,
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * Read-only repository status for the org's configured repo.
 *
 * The target is stored per-org in authority_integrations under the provider
 * 'github_repository' (property_or_location = "owner/repo"), reusing the same
 * integration record the rest of the engine uses. No new table is introduced.
 */
export class RepositoryStatusService {
  private store: AuthorityStore

  constructor(supabase: SupabaseClient) {
    this.store = new AuthorityStore(supabase)
  }

  private async target(organizationId: string): Promise<RepositoryTarget | null> {
    const row = await this.store.getIntegration(organizationId, 'github_repository')
    const ref = (row?.property_or_location as string | null) ?? null
    if (!ref || !ref.includes('/')) return null
    const [owner, repo] = ref.split('/')
    if (!owner || !repo) return null
    const branch = (row?.sync_cursor as { default_branch?: string } | null)?.default_branch ?? 'main'
    return { owner, repo, defaultBranch: branch }
  }

  /** Honest status without making a network call. */
  async status(organizationId: string): Promise<RepositoryStatusResult> {
    const missing = missingGithubStatusEnvVars()
    const target = await this.target(organizationId)

    if (missing.length > 0) {
      return {
        provider: 'github_repository',
        status: 'unconfigured',
        missingEnvVars: missing,
        message:
          `Cannot read repository status: missing ${missing.join(', ')}. ` +
          `Deployment status is reported as unavailable, never assumed green.`,
        snapshot: null,
      }
    }
    if (!target) {
      return {
        provider: 'github_repository',
        status: 'configured',
        missingEnvVars: [],
        message:
          'A token is present but no repository is configured. Set ' +
          'authority_integrations.property_or_location (provider "github_repository") to "owner/repo".',
        snapshot: null,
      }
    }
    return {
      provider: 'github_repository',
      status: 'connected',
      missingEnvVars: [],
      message: `Configured for ${target.owner}/${target.repo} (default branch ${target.defaultBranch}).`,
      snapshot: null,
    }
  }

  /** Live read-only snapshot. Returns a result rather than throwing. */
  async fetch(organizationId: string): Promise<RepositoryStatusResult> {
    const base = await this.status(organizationId)
    if (base.status !== 'connected') return base

    const token = githubStatusToken()
    const target = await this.target(organizationId)
    if (!token || !target) return base

    try {
      const snapshot = await fetchRepositoryStatus(target, token)
      await this.store.updateIntegration(organizationId, 'github_repository', {
        status: 'connected',
        last_sync_at: new Date().toISOString(),
        last_error: null,
      })
      return { ...base, snapshot }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.updateIntegration(organizationId, 'github_repository', {
        status: 'error',
        last_error: message.slice(0, 500),
      })
      return {
        provider: 'github_repository',
        status: 'error',
        missingEnvVars: [],
        message,
        snapshot: null,
      }
    }
  }
}
