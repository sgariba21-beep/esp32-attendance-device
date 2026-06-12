'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
  const router = useRouter()

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (countdown > 0) return

    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
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
      setLoading(false)
      return
    }

    localStorage.removeItem(KEY_ATTEMPTS)
    localStorage.removeItem(KEY_LOCKOUT)
    sessionStorage.setItem('app_session_active', '1')
    router.push('/attendance')
    router.refresh()
  }

  const mins = Math.floor(countdown / 60)
  const secs = String(countdown % 60).padStart(2, '0')

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      {/* Logo + school name */}
      <div className="flex flex-col items-center mb-8 text-center">
        <img
          src="/olag-logo.jpg"
          alt="OLAG SHS logo"
          className="h-24 w-24 rounded-full object-cover ring-4 ring-border shadow-md mb-4"
        />
        <h1 className="text-xl font-bold text-foreground leading-tight">Our Lady Of Grace SHS</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Attendance System</p>
      </div>

      {/* Login card — ring-based elevation to match the design system */}
      <div className="w-full max-w-sm bg-card ring-1 ring-foreground/10 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Sign in</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Enter your admin credentials to continue.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={loading || countdown > 0}
              className={loading ? 'opacity-75' : ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={loading || countdown > 0}
              className={loading ? 'opacity-75' : ''}
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

          <Button type="submit" className="w-full" disabled={loading || countdown > 0}>
            {countdown > 0 ? `Try again in ${mins}:${secs}` : loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  )
}
