'use client'

import { useState } from 'react'
import { Cpu, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
        <div className="space-y-4">
          {Object.entries(
            devices.reduce((acc, d) => {
              if (!acc[d.form]) acc[d.form] = []
              acc[d.form].push(d)
              return acc
            }, {} as Record<string, Device[]>)
          )
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([form, group]) => (
              <div key={form}>
                <p className="text-sm font-medium text-muted-foreground mb-2">Form {form}</p>
                <div className="flex flex-wrap gap-2">
                  {group
                    .sort((a, b) => a.class.localeCompare(b.class))
                    .map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                      >
                        <span>{d.class}</span>
                        <button
                          onClick={() => openEdit(d)}
                          title="Edit"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmTarget(d)}
                          title="Delete"
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError.message}</p>
          )}
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
