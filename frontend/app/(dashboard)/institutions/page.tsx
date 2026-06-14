import { requireRole } from '@/lib/supabase/dal'
import { createAdminClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Building2 } from 'lucide-react'
import { InstitutionActions } from './_components/institution-actions'

type InstitutionRow = {
  id: string
  name: string
  type: 'school' | 'office'
  members: [{ count: number }]
  devices: [{ count: number }]
}

export default async function InstitutionsPage() {
  await requireRole('platform_admin')
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('institutions')
    .select('id, name, type, members(count), devices(count)')
    .order('name')

  const institutions = (data ?? []) as unknown as InstitutionRow[]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Institutions"
        subtitle={`${institutions.length} institution${institutions.length !== 1 ? 's' : ''}`}
      />

      {institutions.length === 0 ? (
        <EmptyState icon={Building2} message="No institutions yet. Use the Create institution page to add one." />
      ) : (
        <div className="rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Devices</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {institutions.map((inst) => {
                const memberCount = inst.members?.[0]?.count ?? 0
                const deviceCount = inst.devices?.[0]?.count ?? 0
                return (
                  <TableRow key={inst.id}>
                    <TableCell className="font-medium">{inst.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{inst.type === 'school' ? 'School' : 'Office'}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{memberCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{deviceCount}</TableCell>
                    <TableCell>
                      <InstitutionActions
                        institution={{ id: inst.id, name: inst.name, memberCount, deviceCount }}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
