'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'

export default function AuthCallback() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get the session from the URL hash
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error

        if (data.session) {
          // Redirect to onboarding
          router.push('/onboarding')
        } else {
          router.push('/auth/signin')
        }
      } catch (error) {
        console.error('Auth callback error:', error)
        router.push('/auth/signin')
      }
    }

    handleCallback()
  }, [router, supabase])

  return (
    <Container className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">Authenticating...</h2>
        <p className="text-slate-400">Please wait while we set up your account.</p>
      </div>
    </Container>
  )
}
