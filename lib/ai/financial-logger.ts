/**
 * Structured financial lifecycle logger.
 *
 * Every Business Brain money-touching operation emits ONE structured line so
 * an operator can answer "what happened to this $X request?" across the
 * reserve -> execute -> settle/release -> spend-booking lifecycle without
 * grepping unrelated logs.
 *
 * Trace identifiers carried on every line (when available):
 *   organizationId, requestId, approvalId, reservationId, executionId,
 *   settlementId, actionId, taskId
 *
 * NEVER included: API keys, Supabase service-role keys, passwords, JWTs,
 * provider secrets, or sensitive customer content. Amounts are numeric only;
 * prompts/messages are never logged.
 */

export type FinancialOperation =
  | 'budget.reserve.start'
  | 'budget.reserve.success'
  | 'budget.reserve.replay'
  | 'budget.reserve.rejected'
  | 'budget.reserve.error'
  | 'budget.settle.start'
  | 'budget.settle.success'
  | 'budget.settle.noop'
  | 'budget.settle.error'
  | 'budget.release.start'
  | 'budget.release.success'
  | 'budget.release.noop'
  | 'budget.release.error'
  | 'execution.start'
  | 'execution.reserved'
  | 'execution.success'
  | 'execution.failure'
  | 'execution.log.persisted'
  | 'approval.expired'

export interface FinancialLogContext {
  organizationId?: string | null
  requestId?: string | null
  approvalId?: string | null
  reservationId?: string | null
  executionId?: string | null
  settlementId?: string | null
  actionId?: string | null
  taskId?: string | null
  agentId?: string | null
  provider?: string | null
  model?: string | null
}

export interface FinancialLogDetails {
  op: FinancialOperation
  ctx?: FinancialLogContext
  amounts?: {
    requested?: number
    reserved?: number
    actual?: number
    settled?: number
    remaining?: number
  }
  /** Extra structured fields (never free-form secrets). */
  extra?: Record<string, unknown>
}

function safeBaseCtx(ctx: FinancialLogContext | undefined): Record<string, string | null> {
  const c = ctx ?? {}
  return {
    organizationId: c.organizationId ?? null,
    requestId: c.requestId ?? null,
    approvalId: c.approvalId ?? null,
    reservationId: c.reservationId ?? null,
    executionId: c.executionId ?? null,
    settlementId: c.settlementId ?? null,
    actionId: c.actionId ?? null,
    taskId: c.taskId ?? null,
    agentId: c.agentId ?? null,
    provider: c.provider ?? null,
    model: c.model ?? null,
  }
}

export function logFinancial(details: FinancialLogDetails): void {
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    event: 'financial',
    op: details.op,
    ...safeBaseCtx(details.ctx),
  }
  if (details.amounts) {
    // Amounts are plain numbers; round to 6 decimals so the log never
    // carries JS float drift.
    line.amounts = {
      requested: details.amounts.requested !== undefined ? roundMoney(details.amounts.requested) : undefined,
      reserved: details.amounts.reserved !== undefined ? roundMoney(details.amounts.reserved) : undefined,
      actual: details.amounts.actual !== undefined ? roundMoney(details.amounts.actual) : undefined,
      settled: details.amounts.settled !== undefined ? roundMoney(details.amounts.settled) : undefined,
      remaining: details.amounts.remaining !== undefined ? roundMoney(details.amounts.remaining) : undefined,
    }
  }
  if (details.extra) {
    line.extra = details.extra
  }
  // JSON.stringify never throws for our controlled shapes (no BigInt/cycles).
  const payload = JSON.stringify(line)
  if (details.op.includes('error') || details.op.includes('rejected')) {
    console.error(payload)
  } else {
    console.info(payload)
  }
}

/** Round a monetary number to 6 decimal places (matching NUMERIC(10,6)). */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}