import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  
  const { data: { user }, error } = await supabase.auth.getUser()
  
  if (error || !user) {
    return NextResponse.json(
      { user: null },
      { status: 401 }
    )
  }
  
  const { data: memberships } = await supabase
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)
  
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      organizations: memberships || [],
    },
  })
}
