import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Routes that require authentication
const protectedRoutes = [
  '/dashboard',
  '/headquarters',
  '/onboarding',
  '/api/organizations',
  '/api/tasks',
  '/api/agents',
  '/api/approvals',
  '/api/decisions',
]

// Routes that should redirect authenticated users away
const authRoutes = [
  '/auth/signin',
  '/auth/signup',
]

export async function middleware(request: NextRequest) {
  const { response, session } = await updateSession(request)
  const { pathname } = request.nextUrl

  // Session is derived from the refreshed Supabase auth session (cookies
  // managed by @supabase/ssr), not a hardcoded cookie name.
  const isAuthenticated = !!session?.user

  // Check if route is protected
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route))

  // Check if route is auth route
  const isAuthRoute = authRoutes.some(route => pathname.startsWith(route))

  // Redirect unauthenticated users trying to access protected routes
  if (isProtectedRoute && !isAuthenticated) {
    return NextResponse.redirect(new URL('/auth/signin', request.url))
  }

  // Redirect authenticated users trying to access auth routes
  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
}