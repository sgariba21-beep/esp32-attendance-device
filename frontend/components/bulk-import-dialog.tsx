'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, Check, Download, Loader2, Upload } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { SingleSelect } from '@/components/ui/single-select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn, pluralize } from '@/lib/utils'
import { parseCsv } from '@/lib/csv'
import { MAX_BULK_IMPORT_ROWS, type BulkMemberRow, type BulkImportResponse, type Device } from '@/lib/types'

type Labels = {
  label_member: string
  label_members: string
  label_unit: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  devices: Device[]
  institutions: { id: string; name: string }[]
  isPlatformAdmin: boolean
  labels: Labels
  onImport: (rows: BulkMemberRow[]) => Promise<BulkImportResponse>
}

type PreviewRow = {
  rowNum: number
  sid: string
  fullname: string
  unitText: string
  deviceId: string | null
  error: string | null
}

type Step = 'upload' | 'preview' | 'results'

const HEADER_ALIASES: Record<'sid' | 'fullname' | 'unit', string[]> = {
  sid: ['sid', 'id', 'studentid', 'memberid', 'staffid'],
  fullname: ['fullname', 'name'],
  unit: ['unit', 'device', 'group', 'unitname'],
}

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/[\s_]+/g, '')
}

function findColumn(headers: string[], key: keyof typeof HEADER_ALIASES): number {
  return headers.findIndex((h) => HEADER_ALIASES[key].includes(h))
}

export function BulkImportDialog({ open, onOpenChange, devices, institutions, isPlatformAdmin, labels, onImport }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [institutionId, setInstitutionId] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [results, setResults] = useState<{ sid: string; fullname: string; error: string | null }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const scopedDevices = isPlatformAdmin
    ? devices.filter((d) => d.institution_id === institutionId)
    : devices

  function reset() {
    setStep('upload')
    setParseError(null)
    setPreviewRows([])
    setImportError(null)
    setResults([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleClose(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function matchDevice(text: string): Device | null {
    const norm = text.trim().toLowerCase()
    if (!norm) return null
    return scopedDevices.find((d) => {
      const combo = `${d.group_name} ${d.unit_name}`.trim().toLowerCase()
      return combo === norm || d.unit_name.toLowerCase() === norm || (d.display_name ?? '').toLowerCase() === norm
    }) ?? null
  }

  async function handleFile(file: File) {
    setParseError(null)
    setImportError(null)

    const text = await file.text()
    const table = parseCsv(text)

    if (table.length === 0) {
      setParseError('That file is empty.')
      return
    }

    const [headerRow, ...dataRows] = table
    const headers = headerRow.map(normalizeHeader)
    const sidIdx = findColumn(headers, 'sid')
    const nameIdx = findColumn(headers, 'fullname')
    const unitIdx = findColumn(headers, 'unit')

    if (sidIdx === -1 || nameIdx === -1 || unitIdx === -1) {
      setParseError(`The CSV must have "sid", "fullname", and "${labels.label_unit.toLowerCase()}" columns. Download the template below to see the expected format.`)
      return
    }

    const rows = dataRows.filter((r) => r.some((cell) => cell.trim() !== ''))
    if (rows.length > MAX_BULK_IMPORT_ROWS) {
      setParseError(`This file has ${rows.length} rows — imports are limited to ${MAX_BULK_IMPORT_ROWS} at a time. Split it into smaller files.`)
      return
    }

    const seenSids = new Set<string>()
    const built: PreviewRow[] = rows.map((r, i) => {
      const sid = (r[sidIdx] ?? '').trim()
      const fullname = (r[nameIdx] ?? '').trim()
      const unitText = (r[unitIdx] ?? '').trim()
      const device = matchDevice(unitText)

      let error: string | null = null
      if (!sid) error = 'Missing ID'
      else if (!fullname) error = 'Missing name'
      else if (!unitText) error = `Missing ${labels.label_unit.toLowerCase()}`
      else if (seenSids.has(sid.toLowerCase())) error = 'Duplicate ID in file'
      else if (!device) error = `Unknown ${labels.label_unit.toLowerCase()}: "${unitText}"`

      if (sid) seenSids.add(sid.toLowerCase())

      return { rowNum: i + 2, sid, fullname, unitText, deviceId: device?.id ?? null, error }
    })

    setPreviewRows(built)
    setStep('preview')
  }

  async function handleImport() {
    const validRows = previewRows.filter((r) => !r.error && r.deviceId).map((r) => ({ sid: r.sid, fullname: r.fullname, device_id: r.deviceId! }))
    if (validRows.length === 0) return

    setImporting(true)
    setImportError(null)
    const res = await onImport(validRows)
    setImporting(false)

    if (res.error) { setImportError(res.error); return }
    setResults(res.results)
    setStep('results')
  }

  function downloadTemplate() {
    const sampleUnit = scopedDevices[0] ? `${scopedDevices[0].group_name} ${scopedDevices[0].unit_name}` : 'Room A'
    const csv = `sid,fullname,${labels.label_unit.toLowerCase()}\nL186,Jane Doe,${sampleUnit}\n`
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const validCount = previewRows.filter((r) => !r.error).length
  const errorCount = previewRows.length - validCount
  const successCount = results.filter((r) => !r.error).length
  const failedResults = results.filter((r) => r.error)

  const needsInstitution = isPlatformAdmin && !institutionId

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import {labels.label_members.toLowerCase()} from CSV</DialogTitle>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4 py-2">
            {isPlatformAdmin && (
              <div className="space-y-2">
                <SingleSelect
                  options={institutions.map((i) => ({ value: i.id, label: i.name }))}
                  value={institutionId}
                  onChange={setInstitutionId}
                  placeholder="Select institution…"
                  searchPlaceholder="Search institutions…"
                />
              </div>
            )}

            <div className={cn('rounded-lg border border-dashed p-6 text-center space-y-3', needsInstitution && 'opacity-50 pointer-events-none')}>
              <Upload className="mx-auto size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Upload a CSV with <span className="font-mono text-xs">sid</span>, <span className="font-mono text-xs">fullname</span>, and{' '}
                <span className="font-mono text-xs">{labels.label_unit.toLowerCase()}</span> columns.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                disabled={needsInstitution}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                className="mx-auto block text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted"
              />
            </div>

            <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
              <Download className="size-3.5" /> Download template
            </Button>

            <Alert>
              <AlertDescription>
                New {labels.label_members.toLowerCase()} are imported as <span className="font-medium">inactive</span>. Review and activate them (typically after fingerprint enrollment) from the list.
              </AlertDescription>
            </Alert>

            {parseError && <Alert variant="error"><AlertDescription>{parseError}</AlertDescription></Alert>}
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-3 py-2">
            <p className="text-sm">
              <span className="font-medium text-success-foreground">{validCount} ready to import</span>
              {errorCount > 0 && <span className="text-destructive"> · {errorCount} with errors (will be skipped)</span>}
            </p>

            <div className="max-h-72 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>{labels.label_unit}</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((r) => (
                    <TableRow key={r.rowNum}>
                      <TableCell className="text-muted-foreground text-xs">{r.rowNum}</TableCell>
                      <TableCell className="font-mono text-xs">{r.sid || '—'}</TableCell>
                      <TableCell>{r.fullname || '—'}</TableCell>
                      <TableCell className="text-xs">{r.unitText || '—'}</TableCell>
                      <TableCell>
                        {r.error
                          ? <span className="text-xs text-destructive">{r.error}</span>
                          : <Check className="size-3.5 text-success-foreground" />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {importError && <Alert variant="error"><AlertDescription>{importError}</AlertDescription></Alert>}
          </div>
        )}

        {step === 'results' && (
          <div className="space-y-3 py-2">
            <Alert variant={failedResults.length === 0 ? 'success' : undefined}>
              <AlertDescription>
                {successCount} {pluralize(labels.label_member.toLowerCase())} imported (inactive){failedResults.length > 0 && `, ${failedResults.length} failed`}.
              </AlertDescription>
            </Alert>

            {failedResults.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {failedResults.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{r.sid}</TableCell>
                        <TableCell>{r.fullname}</TableCell>
                        <TableCell className="text-xs text-destructive flex items-center gap-1.5">
                          <AlertTriangle className="size-3.5 shrink-0" /> {r.error}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          )}
          {step === 'preview' && (
            <>
              <Button type="button" variant="outline" onClick={reset}>Back</Button>
              <Button type="button" onClick={handleImport} disabled={importing || validCount === 0}>
                {importing ? <Loader2 className="size-3.5 animate-spin" /> : `Import ${validCount} ${pluralize(labels.label_member.toLowerCase())}`}
              </Button>
            </>
          )}
          {step === 'results' && (
            <Button type="button" onClick={() => handleClose(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
