'use client'

import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateInstitutionSettings } from '../_actions'
import type { InstitutionConfig } from '@/lib/types'

type Props = { institution: InstitutionConfig }

export function SettingsForm({ institution }: Props) {
  const [form, setForm] = useState({
    name: institution.name,
    type: institution.type,
    logo_url: institution.logo_url ?? '',
    label_member: institution.label_member,
    label_members: institution.label_members,
    label_group: institution.label_group,
    label_unit: institution.label_unit,
    label_period: institution.label_period,
    skip_weekends: institution.skip_weekends,
    timezone: institution.timezone,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSaved(false)

    const result = await updateInstitutionSettings({
      ...form,
      type: form.type as 'school' | 'office',
    })

    setLoading(false)
    if (result.error) { setError(result.error); return }
    setSaved(true)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-lg">
      {/* Identity */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Identity</h2>

        <div className="space-y-2">
          <Label htmlFor="name">Institution name</Label>
          <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="type">Type</Label>
          <select
            id="type"
            value={form.type}
            onChange={(e) => set('type', e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="school">School</option>
            <option value="office">Office</option>
          </select>
          <p className="text-xs text-muted-foreground">Office type hides the Promotion feature.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="logo_url">Logo URL</Label>
          <Input
            id="logo_url"
            value={form.logo_url}
            onChange={(e) => set('logo_url', e.target.value)}
            placeholder="https://…"
            type="url"
          />
          <p className="text-xs text-muted-foreground">Shown in the sidebar. Leave blank to use the default icon.</p>
        </div>
      </section>

      {/* Labels */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Custom labels</h2>
        <p className="text-xs text-muted-foreground">These replace terminology throughout the dashboard.</p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="label_member">Member (singular)</Label>
            <Input id="label_member" value={form.label_member} onChange={(e) => set('label_member', e.target.value)} placeholder="Student" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label_members">Member (plural)</Label>
            <Input id="label_members" value={form.label_members} onChange={(e) => set('label_members', e.target.value)} placeholder="Students" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label_group">Group</Label>
            <Input id="label_group" value={form.label_group} onChange={(e) => set('label_group', e.target.value)} placeholder="Form" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label_unit">Unit</Label>
            <Input id="label_unit" value={form.label_unit} onChange={(e) => set('label_unit', e.target.value)} placeholder="Class" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label_period">Period</Label>
            <Input id="label_period" value={form.label_period} onChange={(e) => set('label_period', e.target.value)} placeholder="Term" />
          </div>
        </div>
      </section>

      {/* Attendance settings */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Attendance</h2>

        <div className="flex items-center gap-3">
          <input
            id="skip_weekends"
            type="checkbox"
            checked={form.skip_weekends}
            onChange={(e) => set('skip_weekends', e.target.checked)}
            className="h-4 w-4 rounded border-input accent-primary"
          />
          <Label htmlFor="skip_weekends" className="cursor-pointer">Skip weekends when generating absent records</Label>
        </div>

        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <Input
            id="timezone"
            value={form.timezone}
            onChange={(e) => set('timezone', e.target.value)}
            placeholder="Africa/Accra"
          />
          <p className="text-xs text-muted-foreground">IANA timezone name, e.g. Africa/Accra, America/New_York</p>
        </div>
      </section>

      {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}
      {saved && <Alert variant="success"><AlertDescription>Settings saved.</AlertDescription></Alert>}

      <Button type="submit" disabled={loading}>
        {loading ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  )
}
