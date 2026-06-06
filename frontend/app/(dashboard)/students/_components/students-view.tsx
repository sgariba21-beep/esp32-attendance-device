'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StudentDialog } from './student-dialog'
import { setStudentStatus } from '../_actions'
import type { StudentWithDevice } from '../page'
import type { Device } from '@/lib/types'

type Props = {
  students: StudentWithDevice[]
  devices: Device[]
}

export function StudentsView({ students, devices }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<StudentWithDevice | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  function openAdd() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(student: StudentWithDevice) {
    setEditing(student)
    setDialogOpen(true)
  }

  async function handleToggleStatus(student: StudentWithDevice) {
    setTogglingId(student.id)
    const newStatus = student.status === 'active' ? 'inactive' : 'active'
    await setStudentStatus(student.id, newStatus)
    setTogglingId(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Students</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {students.length} student{students.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={openAdd}>Add student</Button>
      </div>

      {students.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No students yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>School ID</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Fin 1</TableHead>
                <TableHead>Fin 2</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => (
                <TableRow key={s.id} className={s.status === 'inactive' ? 'opacity-60' : ''}>
                  <TableCell className="font-medium">{s.fullname}</TableCell>
                  <TableCell className="text-muted-foreground">{s.sid}</TableCell>
                  <TableCell>
                    {s.device ? `${s.device.form} ${s.device.class}` : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{s.fin1}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{s.fin2}</TableCell>
                  <TableCell>
                    <Badge variant={s.status === 'active' ? 'default' : 'secondary'}>
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(s)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={togglingId === s.id}
                        onClick={() => handleToggleStatus(s)}
                        className={s.status === 'active' ? 'text-destructive hover:text-destructive' : ''}
                      >
                        {togglingId === s.id
                          ? '…'
                          : s.status === 'active'
                            ? 'Deactivate'
                            : 'Activate'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <StudentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        student={editing}
        devices={devices}
      />
    </div>
  )
}
