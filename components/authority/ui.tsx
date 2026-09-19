'use client'

import { useState } from 'react'
import { Card } from '@/components/Card'

/**
 * Shared display primitives for the AI Authority section.
 *
 * The MetricDisclosure component is deliberately not optional decoration. Every
 * score in this subsystem is an internal measurement over answers this system
 * collected, not a platform ranking, and the product requirement is that a
 * reader can never mistake one for the other.
 */

export function MetricDisclosure({ text }: { text?: string | null }) {
  if (!text) return null
  return (
    <p className="text-xs text-slate-500 leading-relaxed border-l-2 border-slate-700 pl-3 my-4">
      {text}
    </p>
  )
}

/** A labelled metric with an optional period-over-period delta. */
export function Stat({
  label,
  value,
  suffix = '',
  delta = null,
  tone = 'default',
}: {
  label: string
  value: number | string | null | undefined
  suffix?: string
  delta?: number | null
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'muted'
}) {
  const tones: Record<string, string> = {
    default: 'text-white',
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    bad: 'text-rose-400',
    muted: 'text-slate-500',
  }

  const display = value === null || value === undefined ? '—' : `${value}${suffix}`

  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${tones[tone]}`}>{display}</div>
      {delta !== null && delta !== undefined && (
        <div
          className={`text-xs mt-1 tabular-nums ${
            delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-slate-500'
          }`}
        >
          {delta > 0 ? '+' : ''}
          {delta} vs previous period
        </div>
      )}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'green' | 'yellow' | 'red' | 'info'
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-slate-800 text-slate-300 border-slate-700',
    green: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    yellow: 'bg-amber-950 text-amber-300 border-amber-800',
    red: 'bg-rose-950 text-rose-300 border-rose-800',
    info: 'bg-sky-950 text-sky-300 border-sky-800',
  }
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded border ${tones[tone]}`}>
      {children}
    </span>
  )
}

/**
 * Approval class badge.
 *
 * The wording spells out what each class means, because "GREEN" alone does not
 * tell a reader that it runs without a human decision.
 */
export function ApprovalBadge({ approvalClass }: { approvalClass: string | null | undefined }) {
  const value = String(approvalClass ?? '').toLowerCase()
  if (value === 'green') return <Badge tone="green">Runs automatically</Badge>
  if (value === 'yellow') return <Badge tone="yellow">Requires approval</Badge>
  if (value === 'red') return <Badge tone="red">Explicit approval required</Badge>
  return <Badge>Unknown class</Badge>
}

/** Severity / priority chip with a consistent vocabulary. */
export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  const value = String(severity ?? '').toLowerCase()
  if (value === 'critical') return <Badge tone="red">Critical</Badge>
  if (value === 'high') return <Badge tone="red">High</Badge>
  if (value === 'medium') return <Badge tone="yellow">Medium</Badge>
  if (value === 'low') return <Badge tone="info">Low</Badge>
  return <Badge>{value || 'unknown'}</Badge>
}

/** A simple meter. Never rendered without a numeric label beside it. */
export function Meter({
  value,
  max = 100,
  label,
  tone = 'sky',
}: {
  value: number
  max?: number
  label?: string
  tone?: 'sky' | 'emerald' | 'amber' | 'rose'
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const tones: Record<string, string> = {
    sky: 'bg-sky-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  }
  return (
    <div>
      {label && (
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>{label}</span>
          <span className="tabular-nums">{value}</span>
        </div>
      )}
      <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
        <div className={`h-full ${tones[tone]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-slate-300 font-medium">{title}</p>
      <p className="text-sm text-slate-500 mt-1 max-w-xl mx-auto leading-relaxed">{detail}</p>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-rose-400 font-medium">Could not load this view</p>
      <p className="text-sm text-slate-400 mt-1">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 text-sm text-sky-400 hover:text-sky-300 border border-slate-700 rounded px-3 py-1.5"
        >
          Retry
        </button>
      )}
    </div>
  )
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return <p className="text-slate-500 text-sm py-10 text-center">{label}…</p>
}

/** Collapsible raw-data panel, used by the Response Explorer. */
export function Disclosure({
  summary,
  children,
}: {
  summary: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-slate-800 rounded-lg">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800/50 flex justify-between items-center"
      >
        <span>{summary}</span>
        <span className="text-slate-500">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-4 pb-4 pt-1 text-sm text-slate-400">{children}</div>}
    </div>
  )
}

export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>}
      </div>
      {children}
    </Card>
  )
}