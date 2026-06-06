'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createStudent, updateStudent } from '../_actions'
import type { StudentWithDevice } from '../page'
import type { Device } from '@/lib/types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  student: StudentWithDevice | null
  devices: Device[]
}

const empty = { sid: '', fullname: '', device_id: '', fin1: 0, fin2: 0 }

export function StudentDialog({ open, onOpenChange, student, devices }: Props) {
  const [form, setForm] = useState(empty)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      setForm(
        student
          ? { sid: student.sid, fullname: student.fullname, device_id: student.device_id, fin1: student.fin1, fin2: student.fin2 }
          : { ...empty, device_id: devices[0]?.id ?? '' }
      )
    }
  }, [open, student, devices])

  function set(field: string, value: string | number) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.device_id) { setError('Please select a class.'); return }

    setLoading(true)
    setError(null)

    const data = { ...form, fin1: Number(form.fin1), fin2: Number(form.fin2) }
    const result = student
      ? await updateStudent(student.id, data)
      : await createStudent(data)

    setLoading(false)
    if (result.error) { setError(result.error); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{student ? 'Edit student' : 'Add student'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="fullname">Full name</Label>
            <Input
              id="fullname"
              value={form.fullname}
              onChange={(e) => set('fullname', e.target.value)}
              placeholder="e.g. Jane Doe"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sid">School ID</Label>
            <Input
              id="sid"
              value={form.sid}
              onChange={(e) => set('sid', e.target.value)}
              placeholder="e.g. L186"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="device_id">Class</Label>
            <select
              id="device_id"
              value={form.device_id}
              onChange={(e) => set('device_id', e.target.value)}
              required
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select a class…</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.form} {d.class}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fin1">Finger slot 1</Label>
              <Input
                id="fin1"
                type="number"
                min={0}
                value={form.fin1}
                onChange={(e) => set('fin1', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fin2">Finger slot 2</Label>
              <Input
                id="fin2"
                type="number"
                min={0}
                value={form.fin2}
                onChange={(e) => set('fin2', e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : student ? 'Save changes' : 'Add student'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
