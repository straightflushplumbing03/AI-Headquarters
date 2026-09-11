import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AIExecutionService } from '@/lib/ai/execution-service'
import type { AIExecutionRequest } from '@/types/ai'

// Per-user endpoint: must never be statically prerendered at build time.
export const dynamic = 'force-dynamic'

/**
 * API Route: POST /api/ai/execute
 * Executes AI request with budget check and cost tracking.
 *
 * SECURITY (Sprint 5.1):
 * - The caller's identity comes ONLY from the session cookie (createClient()).
 * - The caller must be a member of the target organization; membership is
 *   verified server-side against organization_members.
 * - Database access uses the user-scoped client, so RLS applies.
 * - The service-role key is never used here.
 *
 * Request:
 * {
 *   organizationId: string
 *   agentId: string
 *   taskId: string
 *   systemPrompt: string
 *   userMessage: string
 *   maxTokens?: number
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate from session cookie — fail closed.
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          errorType: 'unauthorized',
        },
        { status: 401 }
      )
    }

    // 2. Parse request
    const body = (await request.json()) as AIExecutionRequest

    // 3. Validate required fields
    if (
      !body.organizationId ||
      !body.agentId ||
      !body.taskId ||
      !body.systemPrompt ||
      !body.userMessage
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields',
          errorType: 'invalid_request',
        },
        { status: 400 }
      )
    }

    // 4. Verify the caller is a member of the target organization (fail closed).
    const { data: member } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', body.organizationId)
      .single()

    if (!member) {
      return NextResponse.json(
        {
          success: false,
          error: 'Organization access denied',
          errorType: 'forbidden',
        },
        { status: 403 }
      )
    }

    // 5. Execute with the user-scoped client (RLS enforced server-side).
    const executionService = new AIExecutionService(supabase)
    const result = await executionService.execute(body)

    // 6. Return result
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error: any) {
    console.error('[AI Execute Error]', error.message)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        errorType: 'server_error',
      },
      { status: 500 }
    )
  }
}

/**
 * API Route: GET /api/ai/execute?organizationId=...
 * Get organization AI spending status (members only).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const { data: member } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', organizationId)
      .single()

    if (!member) {
      return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })
    }

    const executionService = new AIExecutionService(supabase)
    const spending = await executionService.getOrganizationSpending(organizationId)

    return NextResponse.json(spending)
  } catch (error: any) {
    console.error('[AI Spending Error]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
