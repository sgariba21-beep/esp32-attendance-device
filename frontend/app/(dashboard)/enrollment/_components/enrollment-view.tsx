'use client'

import { useState, useEffect } from 'react'
import { ClipboardList } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { JobDialog } from './job-dialog'
import type { EnrollmentJob } from '../page'
import type { Device } from '@/lib/types'

type Props = {
  initialJobs: EnrollmentJob[]
  devices: Device[]
}

const STATUS_BADGE: Record<EnrollmentJob['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' }> = {
  pending:     { label: 'Pending',     variant: 'secondary'   },
  in_progress: { label: 'In progress', variant: 'outline'     },
  completed:   { label: 'Completed',   variant: 'success'     },
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

export function EnrollmentView({ initialJobs, devices }: Props) {
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
            created_at: payload.new.created_at as string,
            device: devices.find((d) => d.id === payload.new.device_id) ?? null,
            student: null,
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
  }, [devices])

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
          <ClipboardList className="h-8 w-8 mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No enrollment jobs yet.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
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
                    <TableCell className="font-medium">
                      {job.command === 'register' ? 'Register'
                        : job.command === 'delete' ? 'Delete'
                        : job.command === 'register-master' ? 'Reg. master'
                        : job.command === 'delete-master' ? 'Del. master'
                        : 'Clear all'}
                    </TableCell>
                    <TableCell>{job.device ? formatClass(job.device) : '—'}</TableCell>
                    <TableCell>
                      {job.command === 'register-master'
                        ? <span className="text-xs text-muted-foreground italic">{job.note ?? 'master'}</span>
                        : (job.command === 'delete-master' || job.command === 'clearall')
                          ? <span className="text-xs text-muted-foreground">—</span>
                          : job.student?.fullname ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{job.finger_slot ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{job.fid ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-48 truncate">
                      {job.command === 'register-master' ? '—' : (job.note ?? '—')}
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
      />
    </div>
  )
}
