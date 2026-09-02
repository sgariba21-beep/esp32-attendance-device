'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { NativeSelect } from '@/components/ui/native-select'
import { PageHeader } from '@/components/ui/page-header'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Toolbar, ToolbarField } from '@/components/ui/toolbar'
import { JobDialog } from './job-dialog'
import { retryEnrollmentJob, cancelEnrollmentJob } from '../_actions'
import type { EnrollmentJob } from '../page'
import type { Device } from '@/lib/types'

// An in_progress job older than this almost certainly means a lost completion
// ack or a device reboot — the server re-delivers it, but the operator gets a
// manual retry/cancel too.
const STUCK_AFTER_MS = 2 * 60 * 1000

/** Whole minutes an in_progress job has been waiting, or null if not stuck.
 *  `now` is passed in so nothing impure runs during render. */
function jobStuckMinutes(job: EnrollmentJob, now: number): number | null {
  if (job.status !== 'in_progress') return null
  const t = Date.parse(job.dispatched_at ?? job.created_at)
  if (!Number.isFinite(t) || now - t <= STUCK_AFTER_MS) return null
  return Math.round((now - t) / 60000)
}

function jobSlotOccupied(job: EnrollmentJob): boolean {
  const s = `${job.last_error ?? ''} ${job.note ?? ''}`.toLowerCase()
  return s.includes('slot-occupied') || s.includes('occupied')
}

type Props = {
  initialJobs: EnrollmentJob[]
  devices: Device[]
  labelUnit: string
  labelMember: string
  labelMembers: string
  showInstitution?: boolean
  institutions?: { id: string; name: string }[]
  institutionFilter?: string
  /** Device-bound admin: one device, register/delete only, no master/clearall. */
  restrictedToDevice?: boolean
}

const STATUS_BADGE: Record<EnrollmentJob['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' }> = {
  pending:     { label: 'Pending',     variant: 'secondary'   },
  in_progress: { label: 'In progress', variant: 'outline'     },
  completed:   { label: 'Completed',   variant: 'success'     },
  failed:      { label: 'Failed',      variant: 'destructive' },
}

function formatClass(device: { group_name: string; unit_name: string }) {
  return `${device.group_name} ${device.unit_name}`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function SseStatusBadge({ status }: { status: 'connecting' | 'connected' | 'error' }) {
  if (status === 'connected') {
    return (
      <Badge variant="success" className="gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
        Live
      </Badge>
    )
  }
  if (status === 'error') {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
        Disconnected
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="gap-1.5">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
      Connecting…
    </Badge>
  )
}

export function EnrollmentView({
  initialJobs, devices, labelUnit, labelMember, labelMembers, showInstitution,
  institutions = [], institutionFilter = '', restrictedToDevice = false,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()
  const [jobs, setJobs] = useState<EnrollmentJob[]>(initialJobs)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sseStatus, setSseStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Drives the "stuck for Nm" label; the interval keeps it roughly live without
  // calling anything impure directly in render.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  async function runAction(jobId: string, fn: () => Promise<{ error: string | null }>) {
    setBusyId(jobId)
    setActionError(null)
    const res = await fn()
    setBusyId(null)
    if (res.error) setActionError(res.error)
  }

  // Institution filter (platform_admin) re-requests the page with a new
  // ?institution= param; jobs/devices arrive scoped from the server, so sync
  // local state from the fresh prop rather than only seeding it on mount.
  useEffect(() => {
    setJobs(initialJobs)
  }, [initialJobs])

  function handleInstitutionChange(value: string) {
    startTransition(() => {
      router.push(value ? `${pathname}?institution=${value}` : pathname)
    })
  }

  useEffect(() => {
    const source = new EventSource('/api/enrollment-stream')

    source.onopen = () => setSseStatus('connected')
    source.onerror = () => setSseStatus('error')

    source.onmessage = (event) => {
      let payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }

      if (payload.eventType === 'INSERT') {
        setJobs((prev) => {
          const exists = prev.find((j) => j.id === (payload.new.id as string))
          if (exists) return prev
          // Joins (student name, device) resolve on next page load.
          const newJob: EnrollmentJob = {
            id: payload.new.id as string,
            command: payload.new.command as EnrollmentJob['command'],
            status: payload.new.status as EnrollmentJob['status'],
            finger_slot: (payload.new.finger_slot as EnrollmentJob['finger_slot']) ?? null,
            fid: (payload.new.fid as number) ?? null,
            note: (payload.new.note as string) ?? null,
            last_error: (payload.new.last_error as string) ?? null,
            attempts: (payload.new.attempts as number) ?? 0,
            created_at: payload.new.created_at as string,
            dispatched_at: (payload.new.dispatched_at as string) ?? null,
            device: devices.find((d) => d.id === payload.new.device_id) ?? null,
            member: null,
            institution: null,
          }
          return [newJob, ...prev]
        })
      } else if (payload.eventType === 'UPDATE') {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === (payload.new.id as string)
              ? {
                  ...j,
                  status: payload.new.status as EnrollmentJob['status'],
                  note: (payload.new.note as string) ?? null,
                  last_error: (payload.new.last_error as string) ?? null,
                  fid: (payload.new.fid as number) ?? j.fid,
                  attempts: (payload.new.attempts as number) ?? j.attempts,
                  dispatched_at: (payload.new.dispatched_at as string) ?? j.dispatched_at,
                }
              : j
          )
        )
      }
    }

    return () => source.close()
  }, [devices])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Enrollment"
        subtitle={<SseStatusBadge status={sseStatus} />}
        actions={<Button onClick={() => setDialogOpen(true)}>New job</Button>}
      />

      {showInstitution && institutions.length > 0 && (
        <Toolbar>
          <ToolbarField label="Institution" htmlFor="institution-filter">
            <NativeSelect
              id="institution-filter"
              value={institutionFilter}
              onChange={(e) => handleInstitutionChange(e.target.value)}
              className="w-56"
            >
              <option value="">All institutions</option>
              {institutions.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.name}</option>
              ))}
            </NativeSelect>
          </ToolbarField>
        </Toolbar>
      )}

      {actionError && (
        <Alert variant="error">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {jobs.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          message="No enrollment jobs yet."
          action={<Button onClick={() => setDialogOpen(true)}>New job</Button>}
        />
      ) : (
        <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                {showInstitution && <TableHead>Institution</TableHead>}
                <TableHead>Command</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>{labelMember}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const badge = STATUS_BADGE[job.status]
                const noteText = job.command === 'register-master'
                  ? '—'
                  : job.status === 'failed'
                    ? (job.last_error ?? job.note ?? '—')
                    : (job.note ?? '—')
                const noteTruncated = noteText.length > 40 ? noteText.slice(0, 40) + '…' : noteText
                const stuckMinutes = jobStuckMinutes(job, now)
                const stuck = stuckMinutes !== null
                const canOverwriteRetry =
                  jobSlotOccupied(job) && (job.command === 'register' || job.command === 'register-master')
                return (
                  <TableRow key={job.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatTime(job.created_at)}
                    </TableCell>
                    {showInstitution && (
                      <TableCell className="text-sm text-muted-foreground">{job.institution?.name ?? '—'}</TableCell>
                    )}
                    <TableCell>
                      <Badge variant={
                        job.command === 'register' ? 'success'
                          : job.command === 'delete' ? 'destructive'
                          : job.command === 'clearall' ? 'secondary'
                          : 'outline'
                      }>
                        {job.command === 'register' ? 'Register'
                          : job.command === 'delete' ? 'Delete'
                          : job.command === 'register-master' ? 'Reg. master'
                          : job.command === 'delete-master' ? 'Del. master'
                          : 'Clear all'}
                      </Badge>
                    </TableCell>
                    <TableCell>{job.device ? formatClass(job.device) : '—'}</TableCell>
                    <TableCell>
                      {job.command === 'register-master'
                        ? <span className="text-xs text-muted-foreground italic">{job.note ?? 'master'}</span>
                        : (job.command === 'delete-master' || job.command === 'clearall')
                          ? <span className="text-xs text-muted-foreground">—</span>
                          : job.member?.fullname ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-48">
                      <span
                        className="block truncate"
                        title={noteText.length > 40 ? noteText : undefined}
                      >
                        {noteTruncated}
                      </span>
                      {(job.finger_slot || job.fid) && (
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {[
                            job.finger_slot === 'fin1' ? 'Finger 1' : job.finger_slot === 'fin2' ? 'Finger 2' : job.finger_slot,
                            job.fid,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      {stuck && (
                        <span className="block text-xs text-warning-foreground">
                          No response for {stuckMinutes}m
                          {job.attempts > 1 ? ` · ${job.attempts} attempts` : ''}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {job.status === 'failed' && job.command !== 'clearall' && (
                          <Button
                            size="xs" variant="ghost" disabled={busyId === job.id}
                            onClick={() => runAction(job.id, () => retryEnrollmentJob(job.id))}
                          >
                            Re-queue
                          </Button>
                        )}
                        {job.status === 'failed' && canOverwriteRetry && (
                          <Button
                            size="xs" variant="ghost" disabled={busyId === job.id}
                            title="Re-queue and tell the device it may overwrite the occupied slot"
                            onClick={() => runAction(job.id, () => retryEnrollmentJob(job.id, { withOverwrite: true }))}
                          >
                            + overwrite
                          </Button>
                        )}
                        {stuck && (
                          <Button
                            size="xs" variant="ghost" disabled={busyId === job.id}
                            onClick={() => runAction(job.id, () => retryEnrollmentJob(job.id))}
                          >
                            Retry
                          </Button>
                        )}
                        {(stuck || job.status === 'pending') && (
                          <Button
                            size="xs" variant="ghost" disabled={busyId === job.id}
                            className="text-destructive hover:text-destructive"
                            onClick={() => runAction(job.id, () => cancelEnrollmentJob(job.id))}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <JobDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        devices={devices}
        labelUnit={labelUnit}
        labelMember={labelMember}
        labelMembers={labelMembers}
        restrictedToDevice={restrictedToDevice}
      />
    </div>
  )
}
