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

/** POST /api/github-changes/[changeId]/reject */
export async function POST(
  request: NextRequest,
  { params }: { params: { changeId: string } }
) {
  try {
    const { organizationId, reason } = await request.json()
    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId required' }, { status: 400 })
    }

    const supabase = buildSupabaseClient(request)
    const { data: user } = await supabase.auth.getUser()
    if (!user.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: member } = await supabase
      .from('organization_members')
      .select('id, role')
      .eq('user_id', user.user.id)
      .eq('organization_id', organizationId)
      .single()

    if (!member) return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })

    // Verify the change belongs to the organization
    const { data: change } = await supabase
      .from('github_changes')
      .select('organization_id')
      .eq('id', params.changeId)
      .single()

    if (!change) return NextResponse.json({ error: 'Change not found' }, { status: 404 })
    if (change.organization_id !== organizationId) {
      return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })
    }

    const integration = new GitHubIntegration(supabase)
    const updated = await integration.rejectChange(params.changeId, reason ?? 'Rejected by user')

    return NextResponse.json({ success: true, data: updated })
  } catch (error: any) {
    console.error('Error rejecting change:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
