function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className ?? ''}`} style={style} />
}

export default function AttendanceLoading() {
  return (
    <div className="space-y-6">
      {/* PageHeader */}
      <div className="flex items-start justify-between">
        <Bone className="h-7 w-44" />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <Bone className="h-8 w-28" />
        <Bone className="h-8 w-28" />
        <Bone className="h-8 w-32" />
        <div className="w-px self-stretch bg-border mx-1" />
        <Bone className="h-8 w-36" />
        <Bone className="h-8 w-36" />
      </div>

      {/* Tabs */}
      <div className="space-y-4">
        <div className="flex gap-1">
          <Bone className="h-8 w-32 rounded-md" />
          <Bone className="h-8 w-20 rounded-md" />
        </div>

        {/* Table */}
        <div className="rounded-xl border overflow-hidden">
          {/* Header */}
          <div className="flex gap-4 border-b bg-muted/30 px-4 py-2.5">
            {[80, 120, 64, 72, 96, 72, 72].map((w, i) => (
              <Bone key={i} className={`h-3.5`} style={{ width: w }} />
            ))}
          </div>
          {/* Rows */}
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b last:border-0 px-4 py-3">
              <Bone className="h-3.5 w-24" />
              <Bone className="h-3.5 w-32" />
              <Bone className="h-3.5 w-12" />
              <Bone className="h-3.5 w-16" />
              <Bone className="h-3.5 w-20" />
              <Bone className="h-3.5 w-16" />
              <Bone className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <Bone className="h-3.5 w-36" />
          <div className="flex gap-1.5">
            <Bone className="h-7 w-24 rounded-lg" />
            <Bone className="h-7 w-16 rounded-lg" />
            <Bone className="h-7 w-16 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
