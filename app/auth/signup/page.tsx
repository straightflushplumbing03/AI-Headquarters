import { SignUpForm } from '@/components/auth/SignUpForm'

// Auth flow depends on runtime env/session — never statically prerender.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign Up - AI Headquarters',
  description: 'Create your AI Headquarters account',
}

export default function SignUpPage() {
  return <SignUpForm />
}
