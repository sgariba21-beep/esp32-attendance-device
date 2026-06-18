import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsForm } from '../../settings/_components/settings-form'
import { updateInstitutionSettingsById } from '../_actions'

export default async function InstitutionEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('platform_admin')
  const { id } = await params
  const institution = await getInstitution(id)

  return (
    <div className="space-y-6">
      <PageHeader title={institution.name} subtitle="Edit institution settings" />
      <SettingsForm
        institution={institution}
        saveAction={updateInstitutionSettingsById.bind(null, id)}
      />
    </div>
  )
}
