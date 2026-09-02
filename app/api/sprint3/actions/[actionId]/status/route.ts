import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApprovalManager } from '@/lib/sprint3/approval-manager'

export async function GET(request: NextRequest, { params }: { params: { actionId: string } }) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId required' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: user } = await supabase.auth.getUser()
    if (!user.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: member } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.user.id)
      .eq('organization_id', organizationId)
      .single()

    if (!member) return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })

    const manager = new ApprovalManager(supabase)
    const action = await manager.getActionStatus(params.actionId, organizationId)

    if (!action) return NextResponse.json({ error: 'Action not found' }, { status: 404 })

    return NextResponse.json({ success: true, data: action })
  } catch (error: any) {
    console.error('Error fetching action status:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
