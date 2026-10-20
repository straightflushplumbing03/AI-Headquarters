/**
 * Phase A: read a task with its full recorded history.
 *
 * GET /api/workforce/tasks/:taskId
 * Returns { task, events, deliverables, approvals, dependencies } read under
 * the caller's own session, so row-level security decides visibility. A task
 * in an organization the caller does not belong to is a 404, not a 403, so
 * its existence is not disclosed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTaskTimeline, WorkforceError } from '@/lib/workforce/service'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: { taskId: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!/^[0-9a-f-]{36}$/i.test(params.taskId)) {
    return NextResponse.json({ error: 'Invalid task id' }, { status: 400 })
  }

  try {
    const timeline = await getTaskTimeline(supabase as any, params.taskId)
    if (!timeline) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    return NextResponse.json(timeline)
  } catch (e) {
    if (e instanceof WorkforceError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    return NextResponse.json({ error: 'Workforce request failed' }, { status: 500 })
  }
}
