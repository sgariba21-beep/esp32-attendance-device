'use client'

import { useState, useEffect } from 'react'
import { Building2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
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
      window.location.href = '/attendance?session_init=1'
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`)
      setLoading(false)
    }
  }

  const mins = Math.floor(countdown / 60)
  const secs = String(countdown % 60).padStart(2, '0')

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center mb-8 text-center">
        <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center ring-4 ring-border shadow-md mb-4">
          <Building2 className="h-12 w-12 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold text-foreground leading-tight">Attendance System</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Sign in to continue</p>
      </div>

      <div className="w-full max-w-sm bg-card ring-1 ring-foreground/10 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Sign in</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Enter your admin credentials to continue.</p>
        </div>

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

          <button
            type="submit"
            disabled={loading || countdown > 0}
            className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:pointer-events-none disabled:opacity-50"
          >
            {countdown > 0 ? `Try again in ${mins}:${secs}` : loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
