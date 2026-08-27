import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { ApprovalManager } from '@/lib/sprint3/approval-manager'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function POST(request: NextRequest, { params }: { params: { approvalId: string } }) {
  try {
    const body = await request.json().catch(() => ({}))
    const { organizationId, reason } = body as { organizationId?: string; reason?: string }
    if (!organizationId) return NextResponse.json({ error: 'organizationId required' }, { status: 400 })

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getSetCookie().map((cookie) => ({
            name: cookie.split('=')[0],
            value: decodeURIComponent(cookie.split('=')[1]),
          }))
        },
        setAll() {},
      },
    })

    const { data: user } = await supabase.auth.getUser()
    if (!user.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Server-side org membership check
    const { data: member } = await supabase
      .from('organization_members')
      .select('id, role')
      .eq('user_id', user.user.id)
      .eq('organization_id', organizationId)
      .single()
    if (!member) return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })

    const manager = new ApprovalManager(supabase)
    const result = await manager.cancelAction(params.approvalId, user.user.id, organizationId, reason)

    if (!result.success) return NextResponse.json({ error: result.error }, { status: 403 })

    return NextResponse.json({ success: true, message: 'Action cancelled' })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
