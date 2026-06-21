'use client'

import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { createInstitutionWithAdmin } from '../_actions'

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-xs">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  )
}

function ScanModeSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="present_absent">Present / Absent</option>
      <option value="time_in_out">Time In / Time Out</option>
    </NativeSelect>
  )
}

const empty = {
  institution_name: '',
  institution_type: 'school' as 'school' | 'office' | 'shop',
  track_students: true,
  track_staff: false,
  student_scan_mode: 'present_absent' as 'present_absent' | 'time_in_out',
  staff_scan_mode: 'present_absent' as 'present_absent' | 'time_in_out',
  admin_email: '',
  admin_password: '',
  admin_name: '',
}

export function OnboardingForm() {
  const [form, setForm] = useState(empty)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ institutionId: string } | null>(null)

  function set(field: string, value: string | boolean) {
    setForm((f) => {
      const next = { ...f, [field]: value }
      // Offices and shops don't track students — force sensible flags on type change.
      if (field === 'institution_type') {
        if (value === 'office' || value === 'shop') { next.track_students = false; next.track_staff = true }
        else { next.track_students = true }
      }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.track_students && !form.track_staff) {
      setError('At least one member type must be tracked.')
      return
    }
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
      <div className="space-y-4 max-w-2xl">
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
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <Section title="Institution">
        <div className="space-y-2">
          <Label htmlFor="institution_name">Name</Label>
          <Input
            id="institution_name"
            value={form.institution_name}
            onChange={(e) => set('institution_name', e.target.value)}
            placeholder="e.g. Westside Academy or Acme Corp"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="institution_type">Type</Label>
          <NativeSelect
            id="institution_type"
            value={form.institution_type}
            onChange={(e) => set('institution_type', e.target.value)}
          >
            <option value="school">School</option>
            <option value="office">Office</option>
            <option value="shop">Shop</option>
          </NativeSelect>
        </div>
      </Section>

      <Section
        title="Attendance tracking"
        description="Choose which member types to track and what scan mode each uses. All of this can be changed later in Settings."
      >
        <div className="space-y-4 rounded-lg border border-border p-4">
          {form.institution_type === 'school' && (
            <>
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
                    <div className="space-y-1.5">
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

              <div className="border-t border-border" />
            </>
          )}

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
                <div className="space-y-1.5">
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
      </Section>

      <Section title="First admin account">
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
            placeholder="admin@example.com"
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
      </Section>

      {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}

      <Button type="submit" disabled={loading}>
        {loading ? 'Creating…' : 'Create institution'}
      </Button>
    </form>
  )
}
