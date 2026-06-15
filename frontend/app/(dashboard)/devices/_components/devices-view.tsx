'use client'

import { useState } from 'react'
import { Cpu, Pencil, Settings, Trash2, Wifi } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { DeviceDialog } from './device-dialog'
import { AssignDeviceDialog } from './assign-device-dialog'
import { deleteDevice } from '../_actions'
import { pluralize } from '@/lib/utils'
import type { Device, UnassignedDevice, InstitutionConfig } from '@/lib/types'
import type { UserRole } from '@/lib/supabase/dal'

type Props = {
  devices: Device[]
  pendingSetupDevices: Device[]
  unassignedDevices: UnassignedDevice[]
  role: UserRole
  institution: InstitutionConfig
  allInstitutions: { id: string; name: string }[]
}

export function DevicesView({ devices, pendingSetupDevices, unassignedDevices, role, institution, allInstitutions }: Props) {
  const isPlatformAdmin = role === 'platform_admin'

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogTitle, setDialogTitle] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState<Device | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Device | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null)

  const [assignOpen, setAssignOpen] = useState(false)
  const [assignTarget, setAssignTarget] = useState<UnassignedDevice | null>(null)

  function openAdd() { setEditing(null); setDialogTitle(undefined); setDialogOpen(true) }
  function openEdit(device: Device) { setEditing(device); setDialogTitle(undefined); setDialogOpen(true) }
  function openConfigure(device: Device) { setEditing(device); setDialogTitle('Configure device'); setDialogOpen(true) }

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

  // ── Platform admin: unified fleet table ──────────────────────────────────
  if (isPlatformAdmin) {
    const allAssigned = [...devices, ...pendingSetupDevices].sort((a, b) => {
      const ia = a.institution?.name ?? ''
      const ib = b.institution?.name ?? ''
      if (ia !== ib) return ia.localeCompare(ib)
      if (a.group_name !== b.group_name) return a.group_name.localeCompare(b.group_name)
      return a.unit_name.localeCompare(b.unit_name)
    })

    return (
      <div className="space-y-6">
        <PageHeader
          title="Devices"
          subtitle={`${allAssigned.length + unassignedDevices.length} device${allAssigned.length + unassignedDevices.length !== 1 ? 's' : ''} total`}
          actions={<Button onClick={openAdd}>Add device</Button>}
        />

        {/* Pending assignment */}
        {unassignedDevices.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-warning-foreground" />
              <h2 className="text-sm font-semibold">Pending assignment ({unassignedDevices.length})</h2>
            </div>
            <p className="text-xs text-muted-foreground -mt-1">
              These devices have provisioned but haven&apos;t been assigned to an institution yet.
            </p>
            <div className="rounded-xl border border-warning/30 bg-warning/5 divide-y divide-border">
              {unassignedDevices.map((d) => (
                <div key={d.id} className="flex items-center justify-between px-4 py-3 gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-sm font-mono text-muted-foreground truncate">{d.mac ?? d.id}</p>
                    {d.display_name && (
                      <p className="text-xs text-muted-foreground">{d.display_name}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary">Unassigned</Badge>
                    <Button
                      size="sm"
                      onClick={() => { setAssignTarget(d); setAssignOpen(true) }}
                    >
                      Assign
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All assigned devices — fleet table */}
        {allAssigned.length === 0 ? (
          <EmptyState icon={Cpu} message="No assigned devices yet." />
        ) : (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Assigned devices ({allAssigned.length})</h2>
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left font-medium">Institution</th>
                    <th className="px-4 py-2.5 text-left font-medium">Group</th>
                    <th className="px-4 py-2.5 text-left font-medium">Unit</th>
                    <th className="px-4 py-2.5 text-left font-medium">MAC</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {allAssigned.map((d) => {
                    const isConfigured = d.group_name.trim() !== ''
                    return (
                      <tr key={d.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          {d.institution?.name ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {d.group_name || <span className="italic">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {d.unit_name || <span className="italic">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {d.mac ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {isConfigured
                            ? <Badge variant="success">Configured</Badge>
                            : <Badge variant="secondary">Not configured</Badge>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEdit(d)}
                              title="Edit"
                              className="text-muted-foreground hover:text-foreground transition-colors p-1"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmTarget(d)}
                              title="Delete"
                              className="text-muted-foreground hover:text-destructive transition-colors p-1"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {deleteError && (
              <Alert variant="error">
                <AlertDescription>{deleteError.message}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DeviceDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          device={editing}
          labelGroup={institution.label_group}
          labelUnit={institution.label_unit}
          institutionType={institution.type}
          title={dialogTitle}
        />

        <AssignDeviceDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          device={assignTarget}
          institutions={allInstitutions}
        />

        <ConfirmDialog
          open={confirmTarget !== null}
          onOpenChange={(v) => { if (!v) setConfirmTarget(null) }}
          title="Delete device?"
          description={confirmTarget
            ? `This will permanently delete this device${confirmTarget.institution?.name ? ` from ${confirmTarget.institution.name}` : ''}. The physical device will be signalled to reset on its next connection.`
            : ''}
          confirmLabel="Delete device"
          loading={deleting}
          onConfirm={handleDelete}
        />
      </div>
    )
  }

  // ── Institution admin: card grid ─────────────────────────────────────────
  const grouped = Object.entries(
    devices.reduce((acc, d) => {
      if (!acc[d.group_name]) acc[d.group_name] = []
      acc[d.group_name].push(d)
      return acc
    }, {} as Record<string, Device[]>)
  ).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devices"
        subtitle={`${devices.length} device${devices.length !== 1 ? 's' : ''}`}
      />

      {/* Pending setup */}
      {pendingSetupDevices.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-warning-foreground" />
            <h2 className="text-sm font-semibold">Pending setup ({pendingSetupDevices.length})</h2>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            These devices have been assigned to your institution. Set their {institution.label_group.toLowerCase()} and {institution.label_unit.toLowerCase()} to activate them.
          </p>
          <div className="rounded-xl border border-warning/30 bg-warning/5 divide-y divide-border">
            {pendingSetupDevices.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-4 py-3 gap-4">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-mono text-muted-foreground truncate">{d.mac ?? d.id}</p>
                  {d.display_name && (
                    <p className="text-xs text-muted-foreground">{d.display_name}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary">Not configured</Badge>
                  <Button size="sm" onClick={() => openConfigure(d)}>Configure</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Configured devices */}
      {devices.length === 0 ? (
        <EmptyState
          icon={Cpu}
          message={
            pendingSetupDevices.length > 0
              ? `No configured devices yet. Use the ${pendingSetupDevices.length > 1 ? `${pendingSetupDevices.length} devices` : 'device'} above to get started.`
              : 'No devices yet.'
          }
        />
      ) : (
        <div className="space-y-3">
          {grouped.map(([group_name, group]) => (
            <div key={group_name} className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{group_name}</p>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {group.length} {group.length !== 1 ? pluralize(institution.label_unit.toLowerCase()) : institution.label_unit.toLowerCase()}
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
                      <div className="min-w-0">
                        <span className="text-sm font-medium">{d.unit_name}</span>
                      </div>
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

      <DeviceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        device={editing}
        labelGroup={institution.label_group}
        labelUnit={institution.label_unit}
        institutionType={institution.type}
        title={dialogTitle}
      />

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(v) => { if (!v) setConfirmTarget(null) }}
        title="Delete device?"
        description={confirmTarget ? `This will permanently delete the ${confirmTarget.group_name} ${confirmTarget.unit_name} device. Members assigned to it will lose their ${institution.label_unit.toLowerCase()} assignment. The physical device will be signalled to reset on its next connection.` : ''}
        confirmLabel="Delete device"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  )
}
