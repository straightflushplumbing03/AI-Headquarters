import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Container } from '@/components/Container'
import { SignOutButton } from '@/components/auth/SignOutButton'

export const metadata = {
  title: 'Dashboard - Business Brain',
  description: 'Your Business Brain dashboard',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/signin')
  }

  const { data: memberships, error } = await supabase
    .from('organization_members')
    .select('organization_id, organizations(name, slug)')
    .eq('user_id', user.id)
    .order('created_at')

  if (error || !memberships || memberships.length === 0) {
    redirect('/onboarding/create-org')
  }

  const primaryOrg = memberships[0]?.organizations as any
  if (!primaryOrg) {
    redirect('/onboarding/create-org')
  }

  return (
    <Container className="py-12">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent">
            Business Brain
          </h1>
          <p className="text-slate-400">The Autonomous Business Operating System</p>
        </div>
        <SignOutButton />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h2 className="text-lg font-semibold mb-4">Your Organizations</h2>
          <div className="space-y-2">
            {memberships.map((membership: any) => (
              <a
                key={membership.organization_id}
                href={`/headquarters/${membership.organization_id}`}
                className="block p-3 bg-slate-700 rounded hover:bg-slate-600 transition-colors"
              >
                {membership.organizations?.name || 'Untitled Organization'}
              </a>
            ))}
          </div>
        </div>

        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h2 className="text-lg font-semibold mb-4">Authenticated User</h2>
          <div className="space-y-2 text-sm text-slate-400">
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>ID:</strong> {user.id.substring(0, 8)}...</p>
            <p><strong>Organizations:</strong> {memberships.length}</p>
          </div>
        </div>

        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h2 className="text-lg font-semibold mb-4">Security Status</h2>
          <div className="space-y-2 text-sm">
            <p className="text-green-400">✓ Authenticated</p>
            <p className="text-green-400">✓ Session Active</p>
            <p className="text-green-400">✓ RLS Enforced</p>
          </div>
        </div>
      </div>
    </Container>
  )
}
