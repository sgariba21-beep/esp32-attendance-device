import { createAdminClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/supabase/dal'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AcademicView } from './_components/academic-view'
import { HolidaysView } from './_components/holidays-view'
import type { AcademicTerm } from '@/lib/types'
import type { Holiday } from './_components/holidays-view'

export default async function AcademicPage() {
  await verifySession()
  const supabase = createAdminClient()

  const [termsRes, holidaysRes] = await Promise.all([
    supabase
      .from('academic')
      .select('id, term, year, status, start_date, end_date')
      .order('year', { ascending: false })
      .order('term', { ascending: false }),
    supabase
      .from('holidays')
      .select('id, date, label')
      .order('date', { ascending: true }),
  ])

  return (
    <>
      <RealtimeRefresh />
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Academic</h1>
        <Tabs defaultValue="terms">
          <TabsList>
            <TabsTrigger value="terms">Terms</TabsTrigger>
            <TabsTrigger value="holidays">Holidays</TabsTrigger>
          </TabsList>
          <TabsContent value="terms" className="mt-4">
            <AcademicView terms={(termsRes.data ?? []) as AcademicTerm[]} />
          </TabsContent>
          <TabsContent value="holidays" className="mt-4">
            <HolidaysView holidays={(holidaysRes.data ?? []) as Holiday[]} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
