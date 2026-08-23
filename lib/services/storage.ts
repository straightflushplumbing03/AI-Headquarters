import { createClient } from '@/lib/supabase/server'

export async function uploadLogo(
  organizationId: string,
  file: File
) {
  if (!file.type.startsWith('image/')) {
    throw new Error('File must be an image')
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error('File size must be less than 5MB')
  }

  const supabase = await createClient()
  const fileName = `${organizationId}-${Date.now()}-${file.name}`
  const filePath = `logos/${organizationId}/${fileName}`

  const { error: uploadError } = await supabase.storage
    .from('organizations')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (uploadError) throw uploadError

  const { data: urlData } = supabase.storage
    .from('organizations')
    .getPublicUrl(filePath)

  const logoUrl = urlData.publicUrl

  // Update organization with logo URL
  const { error: updateError } = await supabase
    .from('organizations')
    .update({ logo_url: logoUrl })
    .eq('id', organizationId)

  if (updateError) throw updateError

  return logoUrl
}

export async function deleteLogo(organizationId: string) {
  const supabase = await createClient()

  // Get current logo URL
  const { data: org } = await supabase
    .from('organizations')
    .select('logo_url')
    .eq('id', organizationId)
    .single()

  if (org?.logo_url) {
    // Extract path from public URL
    const path = org.logo_url.split('/organizations/')[1]
    if (path) {
      await supabase.storage.from('organizations').remove([`logos/${organizationId}/${path}`])
    }
  }

  // Clear logo URL from organization
  const { error } = await supabase
    .from('organizations')
    .update({ logo_url: null })
    .eq('id', organizationId)

  if (error) throw error
}
