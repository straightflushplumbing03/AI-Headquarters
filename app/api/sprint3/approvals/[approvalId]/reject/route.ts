import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { ApprovalManager } from '@/lib/sprint3/approval-manager'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function POST(request: NextRequest, { params }: { params: { approvalId: string } }) {
  try {
    const { organizationId, reason } = await request.json()
    if (!organizationId || !reason) return NextResponse.json({ error: 'organizationId and reason required' }, { status: 400 })

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

    const manager = new ApprovalManager(supabase)
    const result = await manager.rejectAction(params.approvalId, user.user.id, organizationId, reason)

    if (!result.success) return NextResponse.json({ error: result.error }, { status: 403 })

    return NextResponse.json({ success: true, message: 'Action rejected' })
  } catch (error: any) {
    console.error('Error rejecting action:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
