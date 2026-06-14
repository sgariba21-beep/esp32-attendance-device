'use client'

import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createInstitutionWithAdmin } from '../_actions'

const empty = {
  institution_name: '',
  institution_type: 'school' as 'school' | 'office',
  admin_email: '',
  admin_password: '',
  admin_name: '',
}

export function OnboardingForm() {
  const [form, setForm] = useState(empty)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ institutionId: string } | null>(null)

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const result = await createInstitutionWithAdmin(form)
    setLoading(false)

    if (result.error) { setError(result.error); return }
    setCreated({ institutionId: result.institutionId! })
    setForm(empty)
  }

  if (created) {
    return (
      <div className="space-y-4 max-w-lg">
        <Alert variant="success">
          <AlertDescription>
            Institution created successfully. The admin account is ready to log in.
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => setCreated(null)}>
          Create another
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-lg">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Institution</h2>

        <div className="space-y-2">
          <Label htmlFor="institution_name">Name</Label>
          <Input
            id="institution_name"
            value={form.institution_name}
            onChange={(e) => set('institution_name', e.target.value)}
            placeholder="Westside Academy"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="institution_type">Type</Label>
          <select
            id="institution_type"
            value={form.institution_type}
            onChange={(e) => set('institution_type', e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="school">School</option>
            <option value="office">Office</option>
          </select>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">First admin account</h2>

        <div className="space-y-2">
          <Label htmlFor="admin_name">Full name</Label>
          <Input
            id="admin_name"
            value={form.admin_name}
            onChange={(e) => set('admin_name', e.target.value)}
            placeholder="Jane Doe"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="admin_email">Email</Label>
          <Input
            id="admin_email"
            type="email"
            value={form.admin_email}
            onChange={(e) => set('admin_email', e.target.value)}
            placeholder="admin@westside.edu"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="admin_password">Temporary password</Label>
          <Input
            id="admin_password"
            type="password"
            value={form.admin_password}
            onChange={(e) => set('admin_password', e.target.value)}
            placeholder="Min 8 characters"
            minLength={8}
            required
          />
          <p className="text-xs text-muted-foreground">The admin should change this after first login.</p>
        </div>
      </section>

      {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}

      <Button type="submit" disabled={loading}>
        {loading ? 'Creating…' : 'Create institution'}
      </Button>
    </form>
  )
}
