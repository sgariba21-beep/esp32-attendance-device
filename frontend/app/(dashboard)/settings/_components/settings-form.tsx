'use client'

import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { BrandColorPicker } from '@/components/ui/brand-color-picker'
import { updateInstitutionSettings, type SettingsFormData } from '../_actions'
import type { InstitutionConfig } from '@/lib/types'

type Props = {
  institution: InstitutionConfig
  saveAction?: (data: SettingsFormData) => Promise<{ error: string | null }>
}

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
    currency: institution.currency,
    track_students: institution.track_students,
    track_staff: institution.track_staff,
    student_scan_mode: institution.student_scan_mode,
    staff_scan_mode: institution.staff_scan_mode,
    sell_products: institution.sell_products,
    sell_services: institution.sell_services,
    loyalty_enabled: institution.loyalty_enabled,
    theme_primary: institution.theme_primary ?? '',
    theme_preset: institution.theme_preset ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function set(field: string, value: string | boolean) {
    setForm((f) => {
      const next = { ...f, [field]: value }
      // Offices and shops cannot track students
      if (field === 'type' && (value === 'office' || value === 'shop')) next.track_students = false
      return next
    })
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
      type: form.type as 'school' | 'office' | 'shop',
      student_scan_mode: form.student_scan_mode as 'present_absent' | 'time_in_out',
      staff_scan_mode: form.staff_scan_mode as 'present_absent' | 'time_in_out',
    })

    setLoading(false)
    if (result.error) { setError(result.error); return }
    setSaved(true)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <Section title="Identity">
        <div className="space-y-2">
          <Label htmlFor="name">Institution name</Label>
          <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="type">Type</Label>
          <NativeSelect id="type" value={form.type} onChange={(e) => set('type', e.target.value)}>
            <option value="school">School</option>
            <option value="office">Office</option>
            <option value="shop">Shop</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            Office type tracks staff only and hides Academic and Promotion.
            Shop type tracks stylists, hides student and promotion features, and enables the retail module.
          </p>
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
      </Section>

      <Section title="Branding" description="Set the brand colour used across the dashboard — buttons, active navigation, focus, and key figures.">
        <BrandColorPicker
          value={form.theme_primary}
          preset={form.theme_preset}
          onChange={(hex, preset) => {
            setForm((f) => ({ ...f, theme_primary: hex, theme_preset: preset }))
            setSaved(false)
          }}
        />
        <p className="text-xs text-muted-foreground">Changes apply across the dashboard after saving and reloading.</p>
      </Section>

      <Section title="Custom labels" description="These replace terminology throughout the dashboard.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="label_member">Member (singular)</Label>
            <Input id="label_member" value={form.label_member} onChange={(e) => set('label_member', e.target.value)} placeholder="Student / Employee" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label_members">Member (plural)</Label>
            <Input id="label_members" value={form.label_members} onChange={(e) => set('label_members', e.target.value)} placeholder="Students / Employees" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label_group">Group</Label>
            <Input id="label_group" value={form.label_group} onChange={(e) => set('label_group', e.target.value)} placeholder="Form / Department" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label_unit">Unit</Label>
            <Input id="label_unit" value={form.label_unit} onChange={(e) => set('label_unit', e.target.value)} placeholder="Class / Branch" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label_period">Period</Label>
            <Input id="label_period" value={form.label_period} onChange={(e) => set('label_period', e.target.value)} placeholder="Term / Quarter" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label_staff">Staff (singular)</Label>
            <Input id="label_staff" value={form.label_staff} onChange={(e) => set('label_staff', e.target.value)} placeholder="Teacher / Staff" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label_staff_plural">Staff (plural)</Label>
            <Input id="label_staff_plural" value={form.label_staff_plural} onChange={(e) => set('label_staff_plural', e.target.value)} placeholder="Teachers / Staff" />
          </div>
        </div>
      </Section>

      <Section title="Attendance tracking" description="Choose which member types have their attendance recorded and what scan mode each uses.">
        <div className="space-y-4 rounded-lg border border-border p-4">
          {form.type === 'school' && (
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
                      <NativeSelect
                        id="student_scan_mode"
                        value={form.student_scan_mode}
                        onChange={(e) => set('student_scan_mode', e.target.value)}
                      >
                        <option value="present_absent">Present / Absent</option>
                        <option value="time_in_out">Time In / Time Out</option>
                      </NativeSelect>
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
                  <NativeSelect
                    id="staff_scan_mode"
                    value={form.staff_scan_mode}
                    onChange={(e) => set('staff_scan_mode', e.target.value)}
                  >
                    <option value="present_absent">Present / Absent</option>
                    <option value="time_in_out">Time In / Time Out</option>
                  </NativeSelect>
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
      </Section>

      {form.type === 'shop' && (
        <Section title="Shop" description="Currency, offerings, and loyalty for the retail module.">
          <div className="space-y-2">
            <Label htmlFor="currency">Currency</Label>
            <NativeSelect id="currency" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
              <option value="GHS">Ghanaian cedi (GHS)</option>
              <option value="NGN">Nigerian naira (NGN)</option>
              <option value="USD">US dollar (USD)</option>
              <option value="EUR">Euro (EUR)</option>
              <option value="GBP">Pound sterling (GBP)</option>
              <option value="ZAR">South African rand (ZAR)</option>
              <option value="KES">Kenyan shilling (KES)</option>
              <option value="XOF">West African CFA franc (XOF)</option>
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              Used to display all prices, sales, and reports. Does not convert existing values.
            </p>
          </div>

          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <input
                id="sell_services"
                type="checkbox"
                checked={form.sell_services}
                onChange={(e) => set('sell_services', e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="sell_services" className="cursor-pointer">Sell services</Label>
            </div>
            <div className="flex items-center gap-3">
              <input
                id="sell_products"
                type="checkbox"
                checked={form.sell_products}
                onChange={(e) => set('sell_products', e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="sell_products" className="cursor-pointer">Sell products</Label>
            </div>
            <div className="flex items-center gap-3">
              <input
                id="loyalty_enabled"
                type="checkbox"
                checked={form.loyalty_enabled}
                onChange={(e) => set('loyalty_enabled', e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="loyalty_enabled" className="cursor-pointer">Enable loyalty rewards</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Disabling a category hides it from the catalog and new sales; existing history is unaffected.
            </p>
          </div>
        </Section>
      )}

      {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}
      {saved && <Alert variant="success"><AlertDescription>Settings saved.</AlertDescription></Alert>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  )
}
