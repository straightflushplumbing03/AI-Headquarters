'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'

// Onboarding depends on runtime env/session — never statically prerender.
export const dynamic = 'force-dynamic'

export default function CreateOrganizationPage() {
  const router = useRouter()
  // Sprint 5.3 P0: create the browser client lazily inside handlers. The page
  // must render without env-configured Supabase clients (build prerendering
  // throws otherwise), and createBrowserClient() requires env at call time.
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // S53-APP-INTEGRATION: organization creation goes through the atomic
      // create_organization RPC (migration 018). The two-step client-side
      // insert (org, then first owner membership) could never succeed: the
      // first membership cannot satisfy the is_org_owner RLS policy on an
      // empty org, and the org INSERT...RETURNING read-back is filtered by
      // the SELECT policy for a user with no membership yet.
      const slug = formData.slug || formData.name.toLowerCase().replace(/\s+/g, '-')
      const { data: orgId, error: orgError } = await supabase.rpc('create_organization', {
        p_name: formData.name,
        p_slug: slug,
      })

      if (orgError) throw orgError
      if (!orgId) throw new Error('Organization creation returned no id')

      router.push(`/headquarters/${orgId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Container className="max-w-md mx-auto py-12">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent">
          Business Brain
        </h1>
        <p className="text-slate-400">Create Your Headquarters</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Organization Name"
          placeholder="My Company"
          value={formData.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, name: e.target.value })}
          disabled={loading}
          required
        />
        <Input
          label="Organization Slug (optional)"
          placeholder="my-company"
          value={formData.slug}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, slug: e.target.value })}
          disabled={loading}
        />

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Creating...' : 'Create Organization'}
        </Button>
      </form>
    </Container>
  )
}
