'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

/**
 * Shared loader for AI Authority views.
 *
 * Every view in this section needs the same three things and the same honesty
 * about them: the organization id from the route, a loading state, and a real
 * error message rather than a blank panel.
 */
export function useAuthority<T>(loader: (organizationId: string) => Promise<T>, deps: unknown[] = []) {
  const params = useParams()
  const organizationId = params?.id as string | undefined

  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Guards against a late response from an unmounted or superseded load
  // overwriting fresher data.
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!organizationId) {
      setError('No organization selected.')
      setLoading(false)
      return
    }

    const requestId = ++requestRef.current
    setLoading(true)
    setError(null)

    try {
      const result = await loader(organizationId)
      if (requestRef.current === requestId) setData(result)
    } catch (err) {
      if (requestRef.current === requestId) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, ...deps])

  useEffect(() => {
    void load()
  }, [load])

  return { organizationId, data, loading, error, reload: load }
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value}%`
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString()
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Relative age, used for freshness signals. */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return 'never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'never'
  const diffMs = Date.now() - date.getTime()
  const days = Math.floor(diffMs / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}