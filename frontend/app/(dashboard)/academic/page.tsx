import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { pluralize } from '@/lib/utils'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AcademicView } from './_components/academic-view'
import { HolidaysView } from './_components/holidays-view'
import type { AcademicTerm, Holiday } from '@/lib/types'

export default async function AcademicPage() {
  const { institutionId } = await requireRole('super_admin', 'admin')
  const institution = await getInstitution(institutionId)
  const supabase = createAdminClient()

  let termsQ = supabase
    .from('periods')
    .select('id, term, year, status, start_date, end_date')
    .order('year', { ascending: false })
    .order('term', { ascending: false })

  let holidaysQ = supabase
    .from('holidays')
    .select('id, label, start_date, end_date, recurring')
    .order('start_date', { ascending: true })

  if (institutionId) {
    termsQ = termsQ.eq('institution_id', institutionId)
    holidaysQ = holidaysQ.eq('institution_id', institutionId)
  }

  const [termsRes, holidaysRes] = await Promise.all([termsQ, holidaysQ])

  return (
    <>
      <RealtimeRefresh />
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{institution.type === 'office' ? 'Periods & Holidays' : 'Academic'}</h1>
        <Tabs defaultValue="terms">
          <TabsList>
            <TabsTrigger value="terms">{pluralize(institution.label_period)}</TabsTrigger>
            <TabsTrigger value="holidays">Holidays</TabsTrigger>
          </TabsList>
          <TabsContent value="terms" className="mt-4">
            <AcademicView terms={(termsRes.data ?? []) as AcademicTerm[]} labelPeriod={institution.label_period} />
          </TabsContent>
          <TabsContent value="holidays" className="mt-4">
            <HolidaysView holidays={(holidaysRes.data ?? []) as Holiday[]} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
