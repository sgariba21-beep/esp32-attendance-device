'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { JobDialog } from './job-dialog'
import type { EnrollmentJob, StudentOption } from '../page'
import type { Device } from '@/lib/types'

type Props = {
  initialJobs: EnrollmentJob[]
  devices: Device[]
  students: StudentOption[]
}

const STATUS_BADGE: Record<EnrollmentJob['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending:     { label: 'Pending',     variant: 'secondary' },
  in_progress: { label: 'In progress', variant: 'outline'   },
  completed:   { label: 'Completed',   variant: 'default'   },
  failed:      { label: 'Failed',      variant: 'destructive' },
}

function formatClass(device: { form: string; class: string }) {
  return `${device.form} ${device.class}`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export function EnrollmentView({ initialJobs, devices, students }: Props) {
  const [jobs, setJobs] = useState<EnrollmentJob[]>(initialJobs)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sseStatus, setSseStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')

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
        // New job: add at top, then fetch full row with joins from current list
        // We only have flat data from Realtime, so insert a minimal row and let
        // the next server re-render reconcile the joined fields.
        setJobs((prev) => {
          const exists = prev.find((j) => j.id === (payload.new.id as string))
          if (exists) return prev
          // Build a partial job from the flat payload; joins come on next page load
          const newJob: EnrollmentJob = {
            id: payload.new.id as string,
            command: payload.new.command as EnrollmentJob['command'],
            status: payload.new.status as EnrollmentJob['status'],
            finger_slot: (payload.new.finger_slot as EnrollmentJob['finger_slot']) ?? null,
            fid: (payload.new.fid as number) ?? null,
            note: (payload.new.note as string) ?? null,
            created_at: payload.new.created_at as string,
            device: devices.find((d) => d.id === payload.new.device_id) ?? null,
            student: students.find((s) => s.id === payload.new.student_id) ?? null,
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
                  fid: (payload.new.fid as number) ?? j.fid,
                }
              : j
          )
        )
      }
    }

    return () => source.close()
  }, [devices, students])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Enrollment</h1>
          <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${
              sseStatus === 'connected' ? 'bg-green-500' :
              sseStatus === 'error'     ? 'bg-destructive' :
                                          'bg-muted-foreground'
            }`} />
            {sseStatus === 'connected' ? 'Live' : sseStatus === 'error' ? 'Disconnected' : 'Connecting…'}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>New job</Button>
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No enrollment jobs yet.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Command</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Slot</TableHead>
                <TableHead>FID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const badge = STATUS_BADGE[job.status]
                return (
                  <TableRow key={job.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatTime(job.created_at)}
                    </TableCell>
                    <TableCell className="font-medium capitalize">
                      {job.command === 'register-master' ? 'Master' : job.command}
                    </TableCell>
                    <TableCell>{job.device ? formatClass(job.device) : '—'}</TableCell>
                    <TableCell>
                      {job.command === 'register-master'
                        ? <span className="text-xs text-muted-foreground italic">{job.note ?? 'master'}</span>
                        : job.student?.fullname ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{job.finger_slot ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{job.fid ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-48 truncate">
                      {job.note ?? '—'}
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
        students={students}
      />
    </div>
  )
}
