import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function GET(request: NextRequest, { params }: { params: { actionId: string } }) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')
    if (!organizationId) return NextResponse.json({ error: 'organizationId required' }, { status: 400 })

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll() {},
      },
    })

    // Authentication
    const { data: user } = await supabase.auth.getUser()
    if (!user.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Organisation membership (cross-tenant isolation)
    const { data: member } = await supabase
      .from('organization_members')
      .select('role')
      .eq('user_id', user.user.id)
      .eq('organization_id', organizationId)
      .single()
    if (!member) return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })

    // Load action — only from the caller's organization (tenant isolation)
    const { data: action, error } = await supabase
      .from('autonomous_actions')
      .select(`
        id,
        execution_status,
        risk_level,
        authorization_level,
        started_at,
        completed_at,
        created_at,
        success,
        result_summary,
        decision_id
      `)
      .eq('id', params.actionId)
      .eq('organization_id', organizationId)
      .single()

    if (error || !action) return NextResponse.json({ error: 'Action not found' }, { status: 404 })

    // Load linked approval status (if any)
    let approvalStatus: string | null = null
    if (action.decision_id) {
      const { data: approval } = await supabase
        .from('approval_requests')
        .select('approval_status')
        .eq('decision_id', action.decision_id)
        .eq('organization_id', organizationId)
        .single()
      approvalStatus = approval?.approval_status ?? null
    }

    // Return only safe, non-sensitive fields
    return NextResponse.json({
      success: true,
      data: {
        id: action.id,
        executionStatus: action.execution_status,
        riskLevel: action.risk_level,
        authorizationLevel: action.authorization_level,
        approvalStatus,
        startedAt: action.started_at,
        completedAt: action.completed_at,
        createdAt: action.created_at,
        resultSummary: action.result_summary ?? null,
        succeeded: action.success ?? null,
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
