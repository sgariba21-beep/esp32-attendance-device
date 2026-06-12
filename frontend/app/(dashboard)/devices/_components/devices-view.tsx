'use client'

import { useState } from 'react'
import { Cpu, Pencil, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
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
      <PageHeader
        title="Devices"
        subtitle={`${devices.length} device${devices.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={openAdd}>Add device</Button>}
      />

      {devices.length === 0 ? (
        <EmptyState
          icon={Cpu}
          message="No devices yet. Add one to get started."
          action={<Button onClick={openAdd}>Add device</Button>}
        />
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
                        className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm"
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
            <Alert variant="error">
              <AlertDescription>{deleteError.message}</AlertDescription>
            </Alert>
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
