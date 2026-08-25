import { createClient } from '@supabase/supabase-js'
import { AIExecutionService } from '@/lib/ai/execution-service'
import type { AIExecutionRequest } from '@/types/ai'

/**
 * API Route: POST /api/ai/execute
 * Executes AI request with budget check and cost tracking
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
 * 
 * Response:
 * {
 *   success: boolean
 *   content: string (AI response or error)
 *   inputTokens: number
 *   outputTokens: number
 *   actualCost: number
 *   executionTimeMs: number
 *   provider?: 'openai' | 'anthropic'
 *   model?: string
 *   error?: string
 *   errorType?: string
 * }
 */
export async function POST(request: Request) {
  try {
    // 1. Parse request
    const body = (await request.json()) as AIExecutionRequest

    // 2. Validate required fields
    if (!body.organizationId || !body.agentId || !body.taskId || !body.systemPrompt || !body.userMessage) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required fields',
          errorType: 'invalid_request',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 3. Initialize service (server-side only)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    )
    const executionService = new AIExecutionService(supabase)

    // 4. Execute AI with budget checks
    const result = await executionService.execute(body)

    // 5. Return result
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('[AI Execute Error]', error.message)
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
        errorType: 'server_error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

/**
 * API Route: GET /api/ai/spending
 * Get organization AI spending status
 * 
 * Query params:
 * - organizationId: string
 * 
 * Response:
 * {
 *   monthlyBudget: number
 *   currentSpend: number
 *   remaining: number
 *   percentUsed: number
 * }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: 'Missing organizationId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    )
    const executionService = new AIExecutionService(supabase)

    const spending = await executionService.getOrganizationSpending(organizationId)

    return new Response(JSON.stringify(spending), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('[AI Spending Error]', error.message)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
