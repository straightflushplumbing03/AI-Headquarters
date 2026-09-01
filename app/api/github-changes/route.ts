import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { GitHubIntegration } from '@/lib/phase4/github-integration'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

function buildSupabaseClient(request: NextRequest) {
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll() {},
    },
  })
}

/** GET /api/github-changes?organizationId=xxx — list changes awaiting approval */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId required' }, { status: 400 })
    }

    const supabase = buildSupabaseClient(request)
    const { data: user } = await supabase.auth.getUser()
    if (!user.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verify membership
    const { data: member } = await supabase
      .from('organization_members')
      .select('id, role')
      .eq('user_id', user.user.id)
      .eq('organization_id', organizationId)
      .single()

    if (!member) return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })

    const integration = new GitHubIntegration(supabase)
    const changes = await integration.getChangesAwaitingApproval(organizationId)

    return NextResponse.json({ success: true, data: changes })
  } catch (error: any) {
    console.error('Error fetching GitHub changes:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/** POST /api/github-changes — create a new change request */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, ...changeData } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId required' }, { status: 400 })
    }

    const supabase = buildSupabaseClient(request)
    const { data: user } = await supabase.auth.getUser()
    if (!user.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verify membership
    const { data: member } = await supabase
      .from('organization_members')
      .select('id, role')
      .eq('user_id', user.user.id)
      .eq('organization_id', organizationId)
      .single()

    if (!member) return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })

    const integration = new GitHubIntegration(supabase)

    // Auto-assess risk based on files
    const riskLevel = integration.assessRiskLevel(changeData.files_changed ?? [], changeData.risk_level ?? 'low')
    const approvalRequired = integration.isApprovalRequired(riskLevel)

    const change = await integration.createChangeRequest(organizationId, {
      ...changeData,
      risk_level: riskLevel,
      approval_required: approvalRequired,
      approval_status: approvalRequired ? 'pending' : 'approved',
    })

    return NextResponse.json({ success: true, data: change }, { status: 201 })
  } catch (error: any) {
    console.error('Error creating GitHub change:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
