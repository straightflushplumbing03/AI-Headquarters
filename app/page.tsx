import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Home - AI Headquarters',
  description: 'AI Headquarters - Virtual Workforce Platform',
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
      <div className="text-center space-y-6 px-4">
        <h1 className="text-6xl font-bold bg-gradient-to-r from-primary-400 to-secondary-400 bg-clip-text text-transparent">
          AI Headquarters
        </h1>
        <p className="text-2xl text-slate-300">Your Virtual AI Workforce Platform</p>
        <p className="text-slate-400 max-w-2xl mx-auto">
          Create a branded headquarters. Hire specialized AI employees. Automate your business. Measure results.
        </p>
        <div className="flex gap-4 justify-center pt-8">
          <a
            href="/auth/signin"
            className="px-8 py-3 rounded-lg font-semibold bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 text-white shadow-lg hover:shadow-xl transition-all"
          >
            Sign In
          </a>
          <a
            href="/auth/signup"
            className="px-8 py-3 rounded-lg font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-all"
          >
            Get Started
          </a>
        </div>
      </div>
    </main>
  )
}
