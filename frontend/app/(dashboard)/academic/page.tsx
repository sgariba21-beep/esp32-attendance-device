import { createAdminClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/supabase/dal'
import { AcademicView } from './_components/academic-view'
import type { AcademicTerm } from '@/lib/types'

export default async function AcademicPage() {
  await verifySession()
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('academic')
    .select('id, term, year, status')
    .order('year', { ascending: false })
    .order('term', { ascending: false })

  return <AcademicView terms={(data ?? []) as AcademicTerm[]} />
}
