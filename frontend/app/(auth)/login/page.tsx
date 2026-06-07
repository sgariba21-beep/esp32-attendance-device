'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    sessionStorage.setItem('app_session_active', '1')
    router.push('/attendance')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      {/* Logo + school name */}
      <div className="flex flex-col items-center mb-8 text-center">
        <div className="h-24 w-24 rounded-full overflow-hidden ring-4 ring-border shadow-md mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/olag-logo.jpg" alt="OLAG SHS" className="h-full w-full object-cover" />
        </div>
        <h1 className="text-xl font-bold text-foreground leading-tight">Our Lady Of Grace SHS</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Attendance System</p>
      </div>

      {/* Login card */}
      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-sm p-6 space-y-5">
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
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  )
}
