import type { Metadata } from 'next'
import { Inter, Fira_Code } from 'next/font/google'
import '@/styles/globals.css'

const inter = Inter({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const firaCode = Fira_Code({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'AI Headquarters',
  description: 'Your Virtual AI Workforce Platform',
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${firaCode.variable} font-sans`}>
        {children}
      </body>
    </html>
  )
}
