import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { ApprovalManager } from '@/lib/sprint3/approval-manager'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId required' }, { status: 400 })
    }

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

    const { data: member } = await supabase
      .from('organization_members')
      .select('id, role')
      .eq('user_id', user.user.id)
      .eq('organization_id', organizationId)
      .single()

    if (!member) return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })

    const manager = new ApprovalManager(supabase)
    const approvals = await manager.getPendingApprovals(organizationId)

    return NextResponse.json({ success: true, data: approvals, userRole: member.role })
  } catch (error: any) {
    console.error('Error fetching approvals:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
