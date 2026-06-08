'use client'

import { useState, Fragment } from 'react'
import { Button } from '@/components/ui/button'
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
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null)

  function openAdd() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(device: Device) {
    setEditing(device)
    setDialogOpen(true)
  }

  async function handleDelete(device: Device) {
    setDeletingId(device.id)
    setDeleteError(null)
    const result = await deleteDevice(device.id)
    setDeletingId(null)
    if (result.error) setDeleteError({ id: device.id, message: result.error })
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
          <p className="text-sm text-muted-foreground">No devices yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead>Form</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <Fragment key={d.id}>
                  <TableRow>
                    <TableCell className="font-medium">{d.form} {d.class}</TableCell>
                    <TableCell className="text-muted-foreground">{d.form}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(d)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deletingId === d.id}
                          onClick={() => handleDelete(d)}
                          className="text-destructive hover:text-destructive"
                        >
                          {deletingId === d.id ? '…' : 'Delete'}
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

      <DeviceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        device={editing}
      />
    </div>
  )
}
