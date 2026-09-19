import { AuthorityNav } from '@/components/authority/AuthorityNav'

export const metadata = {
  title: 'AI Authority - AI Headquarters',
  description:
    'AI search visibility, citation, competitor, and authority intelligence for Straight Flush Plumbing & Leak Detection',
}

/**
 * AI Authority section layout.
 *
 * The nav is rendered once here so every sub-page inherits it, and each page
 * below owns only its own data loading.
 */
export default function AuthorityLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <AuthorityNav />
      {children}
    </div>
  )
}