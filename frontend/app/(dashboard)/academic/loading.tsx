function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className ?? ''}`} style={style} />
}

export default function AcademicLoading() {
  return (
    <div className="space-y-4">
      {/* Active term chip + Add button */}
      <div className="flex items-center justify-between">
        <Bone className="h-8 w-48 rounded-lg" />
        <Bone className="h-8 w-24 rounded-lg" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        <Bone className="h-8 w-32 rounded-md" />
        <Bone className="h-8 w-24 rounded-md" />
      </div>

      {/* Terms table */}
      <div className="rounded-xl border overflow-hidden">
        <div className="flex gap-4 border-b bg-muted/30 px-4 py-2.5">
          {[100, 160, 72, 120].map((w, i) => (
            <Bone key={i} className="h-3.5" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b last:border-0 px-4 py-3">
            <Bone className="h-3.5 w-24" />
            <Bone className="h-3.5 w-40" />
            <Bone className="h-5 w-16 rounded-full" />
            <div className="ml-auto flex gap-2">
              <Bone className="h-6 w-20 rounded-md" />
              <Bone className="h-6 w-10 rounded-md" />
              <Bone className="h-6 w-14 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
