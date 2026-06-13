function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className ?? ''}`} style={style} />
}

export default function StudentsLoading() {
  return (
    <div className="space-y-4">
      {/* PageHeader */}
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <Bone className="h-7 w-32" />
          <Bone className="h-3.5 w-48" />
        </div>
        <Bone className="h-8 w-28 rounded-lg" />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <Bone className="h-8 w-56" />
        <Bone className="h-8 w-32" />
        <Bone className="h-8 w-28" />
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden">
        <div className="flex gap-4 border-b bg-muted/30 px-4 py-2.5">
          {[140, 80, 72, 80, 56, 80].map((w, i) => (
            <Bone key={i} className="h-3.5" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b last:border-0 px-4 py-3">
            <Bone className="h-3.5 w-36" />
            <Bone className="h-3.5 w-16" />
            <Bone className="h-3.5 w-16" />
            <div className="flex gap-1.5">
              <Bone className="h-3.5 w-3.5 rounded-sm" />
              <Bone className="h-3.5 w-3.5 rounded-sm" />
            </div>
            <Bone className="h-5 w-14 rounded-full" />
            <div className="ml-auto flex gap-2">
              <Bone className="h-6 w-10 rounded-md" />
              <Bone className="h-6 w-20 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
