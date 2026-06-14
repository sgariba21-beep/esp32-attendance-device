'use client'

import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateInstitutionSettings, type SettingsFormData } from '../_actions'
import type { InstitutionConfig } from '@/lib/types'

type Props = {
  institution: InstitutionConfig
  saveAction?: (data: SettingsFormData) => Promise<{ error: string | null }>
}

function ScanModeSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
    >
      <option value="present_absent">Present / Absent</option>
      <option value="time_in_out">Time In / Time Out</option>
    </select>
  )
}

export function SettingsForm({ institution, saveAction }: Props) {
  const [form, setForm] = useState({
    name: institution.name,
    type: institution.type,
    logo_url: institution.logo_url ?? '',
    label_member: institution.label_member,
    label_members: institution.label_members,
    label_group: institution.label_group,
    label_unit: institution.label_unit,
    label_period: institution.label_period,
    label_staff: institution.label_staff,
    label_staff_plural: institution.label_staff_plural,
    skip_weekends: institution.skip_weekends,
    timezone: institution.timezone,
    track_students: institution.track_students,
    track_staff: institution.track_staff,
    student_scan_mode: institution.student_scan_mode,
    staff_scan_mode: institution.staff_scan_mode,
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
    if (!form.track_students && !form.track_staff) {
      setError('At least one member type must be tracked.')
      return
    }
    setLoading(true)
    setError(null)
    setSaved(false)

    const action = saveAction ?? updateInstitutionSettings
    const result = await action({
      ...form,
      type: form.type as 'school' | 'office',
      student_scan_mode: form.student_scan_mode as 'present_absent' | 'time_in_out',
      staff_scan_mode: form.staff_scan_mode as 'present_absent' | 'time_in_out',
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
          <div className="space-y-2">
            <Label htmlFor="label_staff">Staff (singular)</Label>
            <Input id="label_staff" value={form.label_staff} onChange={(e) => set('label_staff', e.target.value)} placeholder="Teacher" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label_staff_plural">Staff (plural)</Label>
            <Input id="label_staff_plural" value={form.label_staff_plural} onChange={(e) => set('label_staff_plural', e.target.value)} placeholder="Teachers" />
          </div>
        </div>
      </section>

      {/* Attendance tracking */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Attendance tracking</h2>
        <p className="text-xs text-muted-foreground">
          Choose which member types have their attendance recorded and what scan mode each uses.
          &ldquo;Members&rdquo; (the neutral type) follow the student rules.
        </p>

        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-start gap-3">
            <input
              id="track_students"
              type="checkbox"
              checked={form.track_students}
              onChange={(e) => set('track_students', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
            />
            <div className="flex-1 space-y-2">
              <Label htmlFor="track_students" className="cursor-pointer font-medium">Track students</Label>
              {form.track_students && (
                <div className="space-y-1">
                  <Label htmlFor="student_scan_mode" className="text-xs text-muted-foreground">Scan mode</Label>
                  <ScanModeSelect
                    id="student_scan_mode"
                    value={form.student_scan_mode}
                    onChange={(v) => set('student_scan_mode', v)}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="border-t" />

          <div className="flex items-start gap-3">
            <input
              id="track_staff"
              type="checkbox"
              checked={form.track_staff}
              onChange={(e) => set('track_staff', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
            />
            <div className="flex-1 space-y-2">
              <Label htmlFor="track_staff" className="cursor-pointer font-medium">Track staff</Label>
              {form.track_staff && (
                <div className="space-y-1">
                  <Label htmlFor="staff_scan_mode" className="text-xs text-muted-foreground">Scan mode</Label>
                  <ScanModeSelect
                    id="staff_scan_mode"
                    value={form.staff_scan_mode}
                    onChange={(v) => set('staff_scan_mode', v)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

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
