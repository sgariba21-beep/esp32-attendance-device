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

  const grouped = Object.entries(
    devices.reduce((acc, d) => {
      if (!acc[d.group_name]) acc[d.group_name] = []
      acc[d.group_name].push(d)
      return acc
    }, {} as Record<string, Device[]>)
  ).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))

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
        <div className="space-y-3">
          {grouped.map(([group_name, group]) => (
            <div key={group_name} className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{group_name}</p>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {group.length} unit{group.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {group
                  .sort((a, b) => a.unit_name.localeCompare(b.unit_name))
                  .map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-background border px-3 py-2.5"
                    >
                      <span className="text-sm font-medium">{d.unit_name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openEdit(d)}
                          title="Edit"
                          className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmTarget(d)}
                          title="Delete"
                          className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
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
        description={confirmTarget ? `This will permanently delete the ${confirmTarget.group_name} ${confirmTarget.unit_name} device. Members assigned to it will lose their unit assignment.` : ''}
        confirmLabel="Delete device"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  )
}
