import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow'

// Onboarding depends on runtime env/session — never statically prerender.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Onboarding - AI Headquarters',
  description: 'Set up your AI Headquarters',
}

export default function OnboardingPage() {
  return <OnboardingFlow />
}
