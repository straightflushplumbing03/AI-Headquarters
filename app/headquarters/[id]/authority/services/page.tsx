import { AuthorityServices } from '@/components/authority/AuthorityServices'

export const metadata = {
  title: 'Services - AI Authority',
  description: 'Per-service authority, coverage, and evidence strength',
}

export default function Page() {
  return <AuthorityServices />
}
