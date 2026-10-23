/**
 * Phase A: create a workforce task.
 *
 * POST /api/workforce/tasks
 * Body: { organizationId, agentId, title, requiredTool, requiredResource?,
 *         description?, priority?, dedupeKey?, dependsOn? }
 *
 * Identity comes only from the session cookie. Membership, assignee, dedupe
 * and dependency checks happen inside workforce_create_task; the assigner is
 * recorded as the signed-in user and cannot be supplied by the client.
 * 201 created · 200 duplicate (returns the existing task id) · 400/401/403.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createTask, WorkforceError, type TaskPriority } from '@/lib/workforce/service'

export const dynamic = 'force-dynamic'

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const { organizationId, agentId, title, requiredTool, requiredResource, description, priority, dedupeKey, dependsOn } = body
  if (!isUuid(organizationId) || !isUuid(agentId)) {
    return NextResponse.json({ error: 'organizationId and agentId must be UUIDs' }, { status: 400 })
  }
  if (!isNonEmpty(title) || !isNonEmpty(requiredTool)) {
    return NextResponse.json({ error: 'title and requiredTool are required' }, { status: 400 })
  }
  if (requiredResource !== undefined && !isNonEmpty(requiredResource)) {
    return NextResponse.json({ error: 'requiredResource must be a non-empty string' }, { status: 400 })
  }
  if (priority !== undefined && !PRIORITIES.includes(priority as TaskPriority)) {
    return NextResponse.json({ error: 'priority must be low, medium, high or urgent' }, { status: 400 })
  }
  if (dedupeKey !== undefined && !isNonEmpty(dedupeKey)) {
    return NextResponse.json({ error: 'dedupeKey must be a non-empty string' }, { status: 400 })
  }
  if (dependsOn !== undefined && !(Array.isArray(dependsOn) && dependsOn.every(isUuid))) {
    return NextResponse.json({ error: 'dependsOn must be an array of task ids' }, { status: 400 })
  }

  try {
    const result = await createTask(supabase as any, {
      organizationId, agentId, title, requiredTool,
      requiredResource: requiredResource as string | undefined,
      description: typeof description === 'string' ? description : undefined,
      priority: priority as TaskPriority | undefined,
      dedupeKey: dedupeKey as string | undefined,
      dependsOn: dependsOn as string[] | undefined,
    })
    return NextResponse.json(
      { taskId: result.taskId, duplicate: result.duplicate },
      { status: result.duplicate ? 200 : 201 },
    )
  } catch (e) {
    if (e instanceof WorkforceError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    return NextResponse.json({ error: 'Workforce request failed' }, { status: 500 })
  }
}
