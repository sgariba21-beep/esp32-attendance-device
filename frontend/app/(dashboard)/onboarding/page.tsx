import { requireRole } from '@/lib/supabase/dal'
import { PageHeader } from '@/components/ui/page-header'
import { OnboardingForm } from './_components/onboarding-form'

export default async function OnboardingPage() {
  await requireRole('platform_admin')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Onboarding"
        subtitle="Create a new institution and its first admin account"
      />
      <OnboardingForm />
    </div>
  )
}
