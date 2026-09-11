import { SignInForm } from '@/components/auth/SignInForm'

// Auth flow depends on runtime env/session — never statically prerender.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign In - AI Headquarters',
  description: 'Sign in to your AI Headquarters account',
}

export default function SignInPage() {
  return <SignInForm />
}
