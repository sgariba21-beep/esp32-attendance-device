'use client'

import { useState, Fragment } from 'react'
import { Cpu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { DeviceDialog } from './device-dialog'
import { deleteDevice } from '../_actions'
import type { Device } from '@/lib/types'

type Props = { devices: Device[] }

export function DevicesView({ devices }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Device | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Device | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null)

  function openAdd() { setEditing(null); setDialogOpen(true) }
  function openEdit(device: Device) { setEditing(device); setDialogOpen(true) }

  async function handleDelete() {
    if (!confirmTarget) return
    setDeleting(true)
    setDeleteError(null)
    const result = await deleteDevice(confirmTarget.id)
    setDeleting(false)
    if (result.error) {
      setDeleteError({ id: confirmTarget.id, message: result.error })
      setConfirmTarget(null)
      return
    }
    setConfirmTarget(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Devices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {devices.length} device{devices.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={openAdd}>Add device</Button>
      </div>

      {devices.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-16 text-center">
          <Cpu className="h-8 w-8 mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No devices yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Form</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <Fragment key={d.id}>
                  <TableRow>
                    <TableCell className="font-medium">{d.form}</TableCell>
                    <TableCell className="text-muted-foreground">{d.class}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(d)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmTarget(d)}
                          className="text-destructive hover:text-destructive ml-1"
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {deleteError?.id === d.id && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-2 text-sm text-destructive bg-destructive/5">
                        {deleteError.message}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DeviceDialog open={dialogOpen} onOpenChange={setDialogOpen} device={editing} />

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(v) => { if (!v) setConfirmTarget(null) }}
        title="Delete device?"
        description={confirmTarget ? `This will permanently delete the ${confirmTarget.form} ${confirmTarget.class} device. Students assigned to it will lose their class assignment.` : ''}
        confirmLabel="Delete device"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  )
}
