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

/**
 * POST /api/github-changes/[changeId]/execute
 *
 * Executes an approved GitHub change via the GitHub API.
 * - Requires authentication
 * - Verifies organization membership
 * - Verifies the change is approved (or low-risk)
 * - GitHub credentials are resolved server-side from environment variables ONLY
 * - Records result and writes audit log entry
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { changeId: string } }
) {
  try {
    const { organizationId } = await request.json()
    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId required' }, { status: 400 })
    }

    const supabase = buildSupabaseClient(request)
    const { data: user } = await supabase.auth.getUser()
    if (!user.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verify membership (admin/owner required to execute)
    const { data: member } = await supabase
      .from('organization_members')
      .select('id, role')
      .eq('user_id', user.user.id)
      .eq('organization_id', organizationId)
      .single()

    if (!member) return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })
    if (!['admin', 'owner'].includes(member.role)) {
      return NextResponse.json({ error: 'Only admins and owners can execute changes' }, { status: 403 })
    }

    // Verify change belongs to this organization
    const { data: change } = await supabase
      .from('github_changes')
      .select('organization_id, risk_level, approval_status, approval_required')
      .eq('id', params.changeId)
      .single()

    if (!change) return NextResponse.json({ error: 'Change not found' }, { status: 404 })
    if (change.organization_id !== organizationId) {
      return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })
    }

    // Enforce approval requirement — high-risk changes MUST be approved
    if (change.approval_required && change.approval_status !== 'approved') {
      return NextResponse.json(
        { error: `Change requires approval but status is "${change.approval_status}"` },
        { status: 422 }
      )
    }

    const integration = new GitHubIntegration(supabase)
    // GitHub credentials are resolved from GITHUB_TOKEN / GITHUB_REPO env vars server-side
    const result = await integration.executeApprovedChange(params.changeId, user.user.id)

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 422 })
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error: any) {
    console.error('Error executing GitHub change:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
