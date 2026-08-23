import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { Container } from '@/components/Container'

export const metadata = {
  title: 'Dashboard - AI Headquarters',
  description: 'Your AI Headquarters dashboard',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/signin')
  }

  // Get user's primary organization
  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!membership) {
    redirect('/onboarding')
  }

  redirect(`/headquarters/${membership.organization_id}`)
}
