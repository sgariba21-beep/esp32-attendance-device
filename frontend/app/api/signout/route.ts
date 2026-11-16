import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    },
  )

  // Clears the auth cookies via the cookie bridge above. Errors are non-fatal —
  // the expired cookies are still written to the response.
  //
  // scope 'local': end THIS browser's session only. supabase-js defaults to
  // 'global', which revokes every session the account has. The session
  // manager calls this route automatically (a fresh browser session, the
  // inactivity timeout), so global scope meant opening the dashboard on a new
  // device, or idling on one, signed the user out on all of them.
  await supabase.auth.signOut({ scope: 'local' })

  return response
}
