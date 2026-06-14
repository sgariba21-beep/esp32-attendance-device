import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsForm } from './_components/settings-form'

export default async function SettingsPage() {
  const { institutionId } = await requireRole('super_admin', 'platform_admin')
  const institution = await getInstitution(institutionId)

  // platform_admin has no institution to edit
  if (!institutionId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" subtitle="Platform administrator" />
        <p className="text-sm text-muted-foreground">
          Institution settings are managed per-institution. Use the Onboarding page to create institutions.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle={institution.name} />
      <SettingsForm institution={institution} />
    </div>
  )
}
