'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import type { Organization } from '@/types/models'

export function OrganizationSettings() {
  const params = useParams()
  const router = useRouter()
  const organizationId = params.id as string
  const supabase = createClient()

  const [_organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    website: '',
    industry: '',
    description: '',
    primary_color: '',
    secondary_color: '',
    accent_color: '',
  })

  useEffect(() => {
    const loadOrganization = async () => {
      try {
        const { data } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', organizationId)
          .single()

        setOrganization(data)
        if (data) {
          setFormData({
            name: data.name,
            website: data.website || '',
            industry: data.industry || '',
            description: data.description || '',
            primary_color: data.primary_color || '#0ea5e9',
            secondary_color: data.secondary_color || '#8b5cf6',
            accent_color: data.accent_color || '#06b6d4',
          })
        }
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadOrganization()
  }, [organizationId, supabase])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const { error: updateError } = await supabase
        .from('organizations')
        .update({
          ...formData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', organizationId)

      if (updateError) throw updateError

      setSuccess('Settings saved successfully')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-center text-slate-400">Loading settings...</div>
  }

  return (
    <Container className="py-12 max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Organization Settings</h1>
        <p className="text-slate-400 mt-2">Manage your company information and branding</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 text-green-400">
          {success}
        </div>
      )}

      <Card className="space-y-6">
        <h2 className="text-xl font-bold">Company Information</h2>

        <Input
          label="Company Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          disabled={saving}
        />

        <Input
          label="Website"
          type="url"
          value={formData.website}
          onChange={(e) => setFormData({ ...formData, website: e.target.value })}
          disabled={saving}
        />

        <Input
          label="Industry"
          value={formData.industry}
          onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
          disabled={saving}
        />

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
          <textarea
            className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors h-24 resize-none"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            disabled={saving}
          />
        </div>
      </Card>

      <Card className="space-y-6">
        <h2 className="text-xl font-bold">Brand Colors</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Primary Color</label>
            <div className="flex gap-3 items-center">
              <input
                type="color"
                value={formData.primary_color}
                onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
                disabled={saving}
                className="w-12 h-12 rounded cursor-pointer"
              />
              <span className="text-slate-400">{formData.primary_color}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Secondary Color</label>
            <div className="flex gap-3 items-center">
              <input
                type="color"
                value={formData.secondary_color}
                onChange={(e) => setFormData({ ...formData, secondary_color: e.target.value })}
                disabled={saving}
                className="w-12 h-12 rounded cursor-pointer"
              />
              <span className="text-slate-400">{formData.secondary_color}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Accent Color</label>
            <div className="flex gap-3 items-center">
              <input
                type="color"
                value={formData.accent_color}
                onChange={(e) => setFormData({ ...formData, accent_color: e.target.value })}
                disabled={saving}
                className="w-12 h-12 rounded cursor-pointer"
              />
              <span className="text-slate-400">{formData.accent_color}</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex gap-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </Container>
  )
}
