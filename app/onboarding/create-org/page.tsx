'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'

export default function CreateOrganizationPage() {
  const router = useRouter()
  const supabase = createClient()
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
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert([
          {
            name: formData.name,
            slug: formData.slug || formData.name.toLowerCase().replace(/\s+/g, '-'),
          },
        ])
        .select()
        .single()

      if (orgError) throw orgError

      const { error: memberError } = await supabase
        .from('organization_members')
        .insert([
          {
            organization_id: org.id,
            user_id: user.id,
            role: 'owner',
          },
        ])

      if (memberError) throw memberError

      router.push(`/headquarters/${org.id}`)
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
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          disabled={loading}
          required
        />
        <Input
          label="Organization Slug (optional)"
          placeholder="my-company"
          value={formData.slug}
          onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
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
