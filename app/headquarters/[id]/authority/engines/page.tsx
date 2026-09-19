import { AuthorityEngines } from '@/components/authority/AuthorityEngines'

export const metadata = {
  title: 'AI Engines - AI Authority',
  description: 'Per-engine monitoring state and coverage',
}

export default function Page() {
  return <AuthorityEngines />
}
