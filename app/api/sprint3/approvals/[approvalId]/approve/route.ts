import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { ApprovalManager } from '@/lib/sprint3/approval-manager'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function POST(request: NextRequest, { params }: { params: { approvalId: string } }) {
  try {
    const { organizationId, notes } = await request.json()
    if (!organizationId) return NextResponse.json({ error: 'organizationId required' }, { status: 400 })

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll() {},
      },
    })

    const { data: user } = await supabase.auth.getUser()
    if (!user.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const manager = new ApprovalManager(supabase)
    const result = await manager.approveAction(params.approvalId, user.user.id, organizationId, notes)

    if (!result.success) return NextResponse.json({ error: result.error }, { status: 403 })

    return NextResponse.json({ success: true, message: 'Action approved' })
  } catch (error: any) {
    console.error('Error approving action:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
