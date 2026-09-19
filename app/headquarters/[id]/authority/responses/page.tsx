import { AuthorityResponses } from '@/components/authority/AuthorityResponses'

export const metadata = {
  title: 'AI Response Explorer - AI Authority',
  description: 'Verbatim AI answers collected by the system',
}

export default function Page() {
  return <AuthorityResponses />
}
