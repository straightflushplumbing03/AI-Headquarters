import { createClient } from '@supabase/supabase-js'
import { verifyFounderAccess } from '@/lib/founder/permissions'
import { FounderAccountManager } from '@/lib/founder/founder-manager'

// Per-user endpoint: must never be statically prerendered at build time.
export const dynamic = 'force-dynamic'

/**
 * Founder-only endpoints
 * All require server-side verification of Founder role
 */

/**
 * POST /api/founder/ai-budget
 * Founder sets their AI budget
 */
export async function POST(request: Request) {
  try {
    // Get user from session (from auth header)
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    )

    // Verify user is founder
    const { data: userData } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!userData?.user?.id) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const isFounder = await verifyFounderAccess(supabase, userData.user.id)
    if (!isFounder) {
      return new Response(JSON.stringify({ error: 'Not a Founder account' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Parse request
    const body = (await request.json()) as { monthlyBudget: number }
    if (!body.monthlyBudget || body.monthlyBudget <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid budget amount' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Update budget
    const founderManager = new FounderAccountManager(supabase)
    await founderManager.setFounderAIBudget(userData.user.id, body.monthlyBudget)

    return new Response(
      JSON.stringify({
        success: true,
        message: `AI budget set to $${body.monthlyBudget.toFixed(2)}/month`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[Founder Budget Error]', error.message)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/**
 * GET /api/founder/ai-budget
 * Get Founder's current AI budget and spending
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    )

    const { data: userData } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!userData?.user?.id) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const isFounder = await verifyFounderAccess(supabase, userData.user.id)
    if (!isFounder) {
      return new Response(JSON.stringify({ error: 'Not a Founder account' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const founderManager = new FounderAccountManager(supabase)
    const budget = await founderManager.getFounderAIBudget(userData.user.id)

    return new Response(JSON.stringify(budget), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('[Founder Budget Get Error]', error.message)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
