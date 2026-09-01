'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'

export function LogoUpload() {
  const params = useParams()
  const organizationId = params.id as string
  const supabase = createClient()

  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('File must be less than 5MB')
      return
    }

    // Create preview
    const reader = new FileReader()
    reader.onload = (event) => {
      setPreview(event.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    setSuccess(null)

    try {
      // Upload to Supabase Storage
      const fileName = `${organizationId}/logo-${Date.now()}.${file.type.split('/')[1]}`
      
      const { data: _uploadData, error: uploadError } = await supabase.storage
        .from('logos')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('logos')
        .getPublicUrl(fileName)

      // Update organization with logo URL
      const { error: updateError } = await supabase
        .from('organizations')
        .update({
          logo_url: publicUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', organizationId)

      if (updateError) throw updateError

      setSuccess('Logo uploaded successfully!')
      setPreview(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Container className="py-12 max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Upload Company Logo</h1>
        <p className="text-slate-400 mt-2">Add your company logo to personalize your headquarters</p>
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
        {preview ? (
          <div className="space-y-4">
            <div className="flex justify-center">
              <img
                src={preview}
                alt="Logo preview"
                className="max-h-48 max-w-48 object-contain"
              />
            </div>
            <div className="flex gap-4">
              <Button
                onClick={() => handleUpload(new File([preview], 'logo.png'))}
                disabled={uploading}
                className="flex-1"
              >
                {uploading ? 'Uploading...' : 'Confirm Upload'}
              </Button>
              <Button
                onClick={() => setPreview(null)}
                variant="ghost"
                disabled={uploading}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <label className="block">
              <div className="border-2 border-dashed border-slate-700 rounded-lg p-8 text-center cursor-pointer hover:border-primary-500 transition-colors">
                <div className="text-4xl mb-2">📸</div>
                <p className="font-semibold text-slate-300">Click to upload logo</p>
                <p className="text-sm text-slate-400 mt-1">PNG, JPG, or GIF (max 5MB)</p>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                disabled={uploading}
                className="hidden"
              />
            </label>
          </div>
        )}
      </Card>
    </Container>
  )
}
