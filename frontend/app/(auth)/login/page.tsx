'use client'

import { useState, useEffect } from 'react'
import { Fingerprint } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/components/theme-toggle'

// L1: this lockout is a UX nicety ONLY — it lives in localStorage and is trivially
// bypassed (clear storage / call /api/signin directly). The real brute-force
// protection is Supabase Auth's server-side rate limit (see
// [auth.rate_limit] sign_in_sign_ups in backend/supabase/config.toml). Do not
// rely on the values below for security.
const MAX_ATTEMPTS = 3
const LOCKOUT_MS = 5 * 60 * 1000
const KEY_ATTEMPTS = 'login_attempts'
const KEY_LOCKOUT = 'login_lockout_until'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    const lockoutUntil = parseInt(localStorage.getItem(KEY_LOCKOUT) ?? '0', 10)
    const remaining = Math.max(0, lockoutUntil - Date.now())
    if (remaining > 0) setCountdown(Math.ceil(remaining / 1000))
  }, [])

  useEffect(() => {
    if (countdown <= 0) return
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          localStorage.removeItem(KEY_LOCKOUT)
          localStorage.removeItem(KEY_ATTEMPTS)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [countdown])

  async function handleSignIn() {
    if (loading || countdown > 0) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // T22: send the password exactly as entered — trimming breaks passwords
        // that legitimately contain leading/trailing spaces.
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        const text = await res.text()
        throw new Error(`Server returned ${res.status}: ${text.slice(0, 300)}`)
      }
      const data = await res.json()

      if (data.error) {
        const isCredentialError = data.error.toLowerCase().includes('invalid') ||
          data.error.toLowerCase().includes('credentials')
        if (isCredentialError) {
          const attempts = parseInt(localStorage.getItem(KEY_ATTEMPTS) ?? '0', 10) + 1
          if (attempts >= MAX_ATTEMPTS) {
            localStorage.setItem(KEY_LOCKOUT, (Date.now() + LOCKOUT_MS).toString())
            localStorage.removeItem(KEY_ATTEMPTS)
            setCountdown(LOCKOUT_MS / 1000)
          } else {
            localStorage.setItem(KEY_ATTEMPTS, attempts.toString())
            const left = MAX_ATTEMPTS - attempts
            setError(`Invalid email or password. ${left} attempt${left === 1 ? '' : 's'} remaining.`)
          }
        } else {
          setError(data.error)
        }
        setLoading(false)
        return
      }

      localStorage.removeItem(KEY_ATTEMPTS)
      localStorage.removeItem(KEY_LOCKOUT)
      sessionStorage.setItem('app_session_active', '1')
      window.location.href = '/?session_init=1'
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`)
      setLoading(false)
    }
  }

  const mins = Math.floor(countdown / 60)
  const secs = String(countdown % 60).padStart(2, '0')

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle className="text-muted-foreground hover:bg-muted hover:text-foreground" />
      </div>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Fingerprint className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground leading-tight">Attendance System</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to your dashboard</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-5">
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); handleSignIn() }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                className="h-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    document.getElementById('password')?.focus()
                  }
                }}
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={loading || countdown > 0}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                className="h-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loading || countdown > 0}
              />
            </div>

            {countdown > 0 ? (
              <Alert variant="error">
                <AlertDescription>
                  Too many failed attempts. Try again in {mins}:{secs}.
                </AlertDescription>
              </Alert>
            ) : error ? (
              <Alert variant="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={loading || countdown > 0}
            >
              {countdown > 0 ? `Try again in ${mins}:${secs}` : loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        {/* T21: password recovery note — no self-service SMTP flow; admin resets passwords */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Forgot your password?{' '}
          <a
            href="mailto:sgariba21@gmail.com?subject=Password+reset+request"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Contact your administrator
          </a>
          .
        </p>
      </div>
    </div>
  )
}
