/**
 * AI Authority Engine -- read-only repository status tests.
 *
 * Two things must hold: the module only ever issues GET requests, and it never
 * reports a CI result it did not observe. An absent token is `unconfigured`,
 * not "passing".
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchRepositoryStatus,
  summarizeChecks,
  githubStatusToken,
  missingGithubStatusEnvVars,
  type CheckSummary,
} from '@/lib/authority/repository-status'

const TOKEN_VARS = ['GITHUB_STATUS_TOKEN', 'GITHUB_TOKEN'] as const

function clearTokens() {
  for (const name of TOKEN_VARS) delete process.env[name]
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<unknown>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn as unknown as typeof fetch)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearTokens()
})

describe('summarizeChecks', () => {
  const check = (status: string, conclusion: string | null): CheckSummary => ({
    name: 'x',
    status,
    conclusion,
  })

  it('is unknown when there are no checks', () => {
    expect(summarizeChecks([])).toBe('unknown')
  })

  it('is pending while any check is incomplete', () => {
    expect(summarizeChecks([check('in_progress', null), check('completed', 'success')])).toBe('pending')
  })

  it('is failing when any check failed', () => {
    expect(summarizeChecks([check('completed', 'success'), check('completed', 'failure')])).toBe('failing')
  })

  it('is passing when every check succeeded or was skipped', () => {
    expect(summarizeChecks([check('completed', 'success'), check('completed', 'skipped')])).toBe('passing')
  })
})

describe('token gating', () => {
  it('reports the missing env var when no token is present', () => {
    clearTokens()
    expect(githubStatusToken()).toBeNull()
    expect(missingGithubStatusEnvVars()).toEqual(['GITHUB_STATUS_TOKEN'])
  })

  it('prefers the dedicated read-only token over GITHUB_TOKEN', () => {
    clearTokens()
    process.env.GITHUB_TOKEN = 'fallback'
    expect(githubStatusToken()).toBe('fallback')
    process.env.GITHUB_STATUS_TOKEN = 'dedicated'
    expect(githubStatusToken()).toBe('dedicated')
  })
})

describe('fetchRepositoryStatus', () => {
  it('issues only GET requests and reads the branch, checks, and PRs', async () => {
    const fetchMock = mockFetch(async (url: string) => {
      if (url.includes('/branches/main')) {
        return jsonResponse({ commit: { sha: 'abc123', commit: { committer: { date: '2026-10-13T00:00:00Z' } } } })
      }
      if (url.includes('/check-runs')) {
        return jsonResponse({ check_runs: [{ name: 'CI', status: 'completed', conclusion: 'success' }] })
      }
      if (url.includes('/pulls')) {
        return jsonResponse([
          {
            number: 42,
            title: 'A change',
            draft: false,
            state: 'open',
            mergeable_state: 'clean',
            head: { ref: 'feature' },
            updated_at: '2026-10-13T01:00:00Z',
            html_url: 'https://example/pr/42',
          },
        ])
      }
      return jsonResponse({}, 404)
    })

    const snapshot = await fetchRepositoryStatus(
      { owner: 'acme', repo: 'site', defaultBranch: 'main' },
      'token'
    )

    expect(snapshot.defaultBranchSha).toBe('abc123')
    expect(snapshot.ciStatus).toBe('passing')
    expect(snapshot.openPullRequests).toHaveLength(1)
    expect(snapshot.openPullRequests[0].number).toBe(42)

    // Every request must be a GET; this module must never mutate GitHub.
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined
      expect(init?.method).toBe('GET')
    }
  })

  it('throws with the status when the repo cannot be read', async () => {
    mockFetch(async () => jsonResponse({ message: 'Not Found' }, 404))
    await expect(
      fetchRepositoryStatus({ owner: 'acme', repo: 'missing', defaultBranch: 'main' }, 'token')
    ).rejects.toThrow(/HTTP 404/)
  })
})
