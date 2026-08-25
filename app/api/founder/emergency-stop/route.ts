import { createClient } from '@supabase/supabase-js'
import { verifyFounderAccess } from '@/lib/founder/permissions'
import { AICostController } from '@/lib/ai/cost-controller'

/**
 * POST /api/founder/emergency-stop
 * Founder can trigger global AI emergency stop
 * 
 * Body:
 * {
 *   enable: boolean
 * }
 */
export async function POST(request: Request) {
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

    // Verify founder
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
    const body = (await request.json()) as { enable: boolean }
    const costController = new AICostController(supabase)

    if (body.enable) {
      await costController.enableGlobalKillSwitch()
      // Log to audit trail
      await supabase.from('audit_logs').insert([
        {
          user_id: userData.user.id,
          action: 'emergency_stop_enabled',
          resource: 'global_ai',
          timestamp: new Date().toISOString(),
        },
      ])

      return new Response(
        JSON.stringify({ success: true, message: 'Global AI emergency stop ENABLED' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    } else {
      await costController.disableGlobalKillSwitch()
      // Log to audit trail
      await supabase.from('audit_logs').insert([
        {
          user_id: userData.user.id,
          action: 'emergency_stop_disabled',
          resource: 'global_ai',
          timestamp: new Date().toISOString(),
        },
      ])

      return new Response(
        JSON.stringify({ success: true, message: 'Global AI emergency stop DISABLED' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
  } catch (error: any) {
    console.error('[Emergency Stop Error]', error.message)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
