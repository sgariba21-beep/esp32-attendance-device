'use client'

import { PauseCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Landing page for users whose institution is suspended/deactivated. The
// verifySession() gate (lib/supabase/dal.ts) redirects here. It lives OUTSIDE
// the (dashboard) route group so it never re-enters verifySession and loops.
// The only action offered is sign-out — there is no dashboard to return to.
export default function SuspendedPage() {
  async function handleSignOut() {
    sessionStorage.removeItem('app_session_active')
    await fetch('/api/signout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-7 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <PauseCircle className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Account paused</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This institution&apos;s access is currently suspended. Your data is safe.
          Please contact your administrator to restore access.
        </p>
        <Button onClick={handleSignOut} className="mt-6 w-full">
          Sign out
        </Button>
      </div>
    </div>
  )
}
