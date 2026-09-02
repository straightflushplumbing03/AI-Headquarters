import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApprovalManager } from '@/lib/sprint3/approval-manager'

export async function POST(request: NextRequest, { params }: { params: { approvalId: string } }) {
  try {
    const { organizationId, reason } = await request.json()
    if (!organizationId || !reason) return NextResponse.json({ error: 'organizationId and reason required' }, { status: 400 })

    const supabase = await createClient()

    const { data: user } = await supabase.auth.getUser()
    if (!user.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const manager = new ApprovalManager(supabase)
    const result = await manager.rejectAction(params.approvalId, user.user.id, organizationId, reason)

    if (!result.success) return NextResponse.json({ error: result.error }, { status: 403 })

    return NextResponse.json({ success: true, message: 'Action rejected' })
  } catch (error: any) {
    console.error('Error rejecting action:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
