'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarClock, Plus, Repeat } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { formatZonedDate, formatZonedTime } from '@/lib/zoned-time'
import { meetingTitle, describeRecurrence, formatDuration } from '@/lib/meetings'
import { formatClockTime, pluralize } from '@/lib/utils'
import { cancelMeeting, closeMeetingNow, deleteMeeting, endSchedule } from '../_actions'
import { MeetingDialog } from './meeting-dialog'
import { ScheduleDialog } from './schedule-dialog'
import type { Meeting, MeetingSchedule } from '@/lib/types'

/** A meeting plus server-computed facts (counted and clock-read once, on the server). */
export type MeetingRow = Meeting & { present: number; absent: number; expected: number; started: boolean }
export type DeviceOption = { id: string; label: string }

type Config = {
  timezone: string
  time_format: '12h' | '24h'
  track_absences: boolean
  label_member: string
  label_members: string
  label_unit: string
}

type Props = {
  live: MeetingRow[]
  upcoming: MeetingRow[]
  past: MeetingRow[]
  schedules: MeetingSchedule[]
  devices: { id: string; group_name: string; unit_name: string; display_name: string | null }[]
  pinnedDeviceId: string | null
  historyDays: number
  config: Config
}

type ConfirmState = { action: 'cancel' | 'delete' | 'close' | 'end'; id: string; title: string; description: string }

export function MeetingsView({ live, upcoming, past, schedules, devices, pinnedDeviceId, historyDays, config }: Props) {
  const router = useRouter()
  const tz = config.timezone

  // Live / upcoming / past depend on the clock, not just on data changes, so
  // refresh once a minute: a meeting that starts or ends while the page is
  // open moves section by itself.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60_000)
    return () => clearInterval(t)
  }, [router])

  const deviceOptions: DeviceOption[] = devices.map((d) => ({
    id: d.id,
    label: d.display_name ?? `${d.group_name} ${d.unit_name}`,
  }))
  const deviceLabel = (m: Pick<Meeting, 'device_id' | 'device_deleted_at'>) =>
    m.device_deleted_at ? 'Removed device'
    : m.device_id ? (deviceOptions.find((d) => d.id === m.device_id)?.label ?? '—')
    : 'All devices'

  const date = (iso: string) => formatZonedDate(iso, tz)
  const time = (iso: string) => formatZonedTime(iso, tz, config.time_format)
  const range = (m: Meeting) => `${time(m.starts_at)} – ${m.ends_at ? time(m.ends_at) : 'open'}`

  // Dialogs are remounted per open (key) so each starts from fresh state.
  const [dialog, setDialog] = useState<{ kind: 'meeting'; meeting?: MeetingRow } | { kind: 'schedule' } | null>(null)
  const [dialogKey, setDialogKey] = useState(0)
  const openDialog = (d: NonNullable<typeof dialog>) => { setDialogKey((k) => k + 1); setDialog(d) }

  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const absencesNote = config.track_absences
    ? ' Absences for it are recorded within about 15 minutes.'
    : ''

  function ask(action: ConfirmState['action'], m: { id: string; title: string | null; origin?: Meeting['origin'] }, isSkip = false) {
    const name = m.origin ? meetingTitle({ title: m.title, origin: m.origin }) : (m.title ?? 'this schedule')
    const description = {
      close: `"${name}" stops accepting scans now.${absencesNote}`,
      cancel: `"${name}" won't accept any more scans, and no absences will be recorded for it. Any scans already recorded stay.`,
      delete: isSkip
        ? `This occurrence of "${name}" is removed and won't come back. The rest of its schedule is unaffected.`
        : `"${name}" is removed permanently.`,
      end: `Upcoming meetings from "${name}" that haven't started are removed. Past meetings and their attendance stay.`,
    }[action]
    setConfirm({ action, id: m.id, title: name, description })
  }

  async function runConfirm() {
    if (!confirm) return
    setBusy(true)
    setNotice(null)
    const run = { close: closeMeetingNow, cancel: cancelMeeting, delete: deleteMeeting, end: endSchedule }[confirm.action]
    const result = await run(confirm.id)
    setBusy(false)
    setConfirm(null)
    if (result.error) {
      setNotice({ kind: 'error', text: result.error })
    } else if (confirm.action === 'end' && 'removed' in result) {
      const n = result.removed ?? 0
      setNotice({ kind: 'success', text: `Schedule ended. ${n} upcoming ${n === 1 ? 'meeting' : 'meetings'} removed.` })
    }
  }

  const confirmLabel = confirm
    ? { close: 'Close now', cancel: 'Cancel meeting', delete: 'Delete', end: 'End schedule' }[confirm.action]
    : ''

  return (
    <div className="space-y-8">
      <PageHeader
        title="Meetings"
        subtitle={`Times shown in ${tz}`}
        actions={
          <>
            <Button variant="outline" onClick={() => openDialog({ kind: 'schedule' })}>
              <Repeat className="h-4 w-4 mr-1.5" />
              New recurring
            </Button>
            <Button onClick={() => openDialog({ kind: 'meeting' })}>
              <Plus className="h-4 w-4 mr-1.5" />
              New meeting
            </Button>
          </>
        }
      />

      {notice && (
        <Alert variant={notice.kind === 'error' ? 'error' : 'success'}>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}

      {/* ── Live now ─────────────────────────────────────────────── */}
      {live.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight">Live now</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {live.map((m) => {
              const started = m.started
              return (
                <div key={m.id} className="rounded-xl border border-success-border bg-card p-4 shadow-xs space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="success">Live</Badge>
                        {m.origin === 'device' && <Badge variant="secondary">Opened at device</Badge>}
                      </div>
                      <p className="mt-2 font-medium truncate">{meetingTitle(m)}</p>
                      <p className="text-sm text-muted-foreground">{range(m)} · {deviceLabel(m)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-semibold tabular-nums text-success-foreground">
                        {m.present}
                        {m.expected > 0 && <span className="text-base text-muted-foreground"> / {m.expected}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">present</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {started && (
                      <Button size="sm" variant="outline" onClick={() => ask('close', m)}>Close now</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => ask('cancel', m)}>Cancel</Button>
                    <Link href={`/attendance?meeting=${m.id}`} className="ml-auto self-center text-sm text-primary hover:underline underline-offset-4">
                      View scans
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Upcoming ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Upcoming ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            message="No meetings scheduled. Create a one-off meeting, or a recurring one for regular sessions."
            action={<Button onClick={() => openDialog({ kind: 'meeting' })}>New meeting</Button>}
          />
        ) : (
          <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>{config.label_unit}</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcoming.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap font-medium">{date(m.starts_at)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{range(m)}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        {meetingTitle(m)}
                        {m.schedule_id && <Repeat className="h-3.5 w-3.5 text-muted-foreground" aria-label="Recurring" />}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{deviceLabel(m)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: 'meeting', meeting: m })}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => ask('cancel', m)}>Cancel</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => ask('delete', m, !!m.schedule_id)}
                      >
                        {m.schedule_id ? 'Skip' : 'Delete'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ── Recurring ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Recurring ({schedules.length})</h2>
        {schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recurring meetings. Use <span className="font-medium">New recurring</span> for sessions that repeat weekly or monthly.
          </p>
        ) : (
          <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Repeats</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>{config.label_unit}</TableHead>
                  <TableHead>Runs</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.title ?? 'Untitled'}</TableCell>
                    <TableCell>{describeRecurrence(s)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatClockTime(s.start_time, config.time_format)} · {formatDuration(s.duration_minutes)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.device_id ? (deviceOptions.find((d) => d.id === s.device_id)?.label ?? '—') : 'All devices'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                      From {s.starts_on}{s.ends_on ? ` to ${s.ends_on}` : ''}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => ask('end', { id: s.id, title: s.title })}
                      >
                        End
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ── Past ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Past {historyDays} days ({past.length})</h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">No meetings in the last {historyDays} days.</p>
        ) : (
          <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>{config.label_unit}</TableHead>
                  <TableHead className="text-right">Present</TableHead>
                  <TableHead className="text-right">Absent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {past.map((m) => {
                  const hasRows = m.present + m.absent > 0
                  return (
                    <TableRow key={m.id} className={m.status === 'cancelled' ? 'text-muted-foreground' : undefined}>
                      <TableCell className="whitespace-nowrap font-medium">{date(m.starts_at)}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{range(m)}</TableCell>
                      <TableCell>{meetingTitle(m)}</TableCell>
                      <TableCell className="text-muted-foreground">{deviceLabel(m)}</TableCell>
                      <TableCell className="text-right tabular-nums text-success-foreground font-medium">{m.present}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {config.track_absences ? <span className="text-destructive font-medium">{m.absent}</span> : '—'}
                      </TableCell>
                      <TableCell>
                        {m.status === 'cancelled' ? <Badge variant="outline">Cancelled</Badge>
                          : m.status === 'closed' ? <Badge variant="secondary">Closed</Badge>
                          : <Badge variant="warning">Closing…</Badge>}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {hasRows && (
                          <Link href={`/attendance?meeting=${m.id}`} className="mr-2 text-sm text-primary hover:underline underline-offset-4">
                            Attendance
                          </Link>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => openDialog({ kind: 'meeting', meeting: m })}>Rename</Button>
                        {!hasRows && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => ask('delete', m)}
                          >
                            Delete
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Older meetings and full per-{config.label_member.toLowerCase()} history are on the{' '}
          <Link href="/attendance" className="text-primary hover:underline underline-offset-4">Attendance</Link> page.
          {' '}{pluralize(config.label_member)} are counted once per meeting.
        </p>
      </section>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => { if (!v) setConfirm(null) }}
        title={confirm ? `${confirmLabel}?` : ''}
        description={confirm?.description ?? ''}
        confirmLabel={confirmLabel}
        loading={busy}
        onConfirm={runConfirm}
      />

      {dialog?.kind === 'meeting' && (
        <MeetingDialog
          key={dialogKey}
          open
          onOpenChange={(v) => { if (!v) setDialog(null) }}
          meeting={dialog.meeting}
          devices={deviceOptions}
          pinnedDeviceId={pinnedDeviceId}
          timezone={tz}
          labelUnit={config.label_unit}
        />
      )}
      {dialog?.kind === 'schedule' && (
        <ScheduleDialog
          key={dialogKey}
          open
          onOpenChange={(v) => { if (!v) setDialog(null) }}
          devices={deviceOptions}
          pinnedDeviceId={pinnedDeviceId}
          timezone={tz}
          labelUnit={config.label_unit}
          onCreated={(n) => setNotice({
            kind: 'success',
            text: `Recurring meeting created — ${n} ${n === 1 ? 'meeting' : 'meetings'} scheduled for the next 8 weeks.`,
          })}
        />
      )}
    </div>
  )
}
