import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Guard: middleware runs on every matched request and any throw here
  // becomes a 500 (Vercel: MIDDLEWARE_INVOCATION_FAILED). If the env vars
  // are missing (e.g. not set on this Vercel environment), fail loudly in
  // logs but pass the request through so the app still renders — otherwise
  // every route, including the landing page, crashes.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      `[supabase-middleware] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing ` +
        `(url=${supabaseUrl ? 'set' : 'MISSING'}, anonKey=${supabaseAnonKey ? 'set' : 'MISSING'}). ` +
        `Set them on this environment and redeploy. Requests pass through unauthenticated.`
    )
    return { response: supabaseResponse, session: null }
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the auth token and return the resulting session so callers can
  // branch on auth state without hardcoding the SSR cookie name (which is
  // `sb-<project-ref>-auth-token` and varies per project).
  // A transient failure here (network blip against the auth server) should
  // degrade to unauthenticated, not 500 the whole request.
  let session = null
  try {
    const {
      data: { session: refreshed },
    } = await supabase.auth.getSession()
    session = refreshed
  } catch (err) {
    console.error('[supabase-middleware] session refresh failed, treating request as unauthenticated:', err)
  }

  return { response: supabaseResponse, session }
}