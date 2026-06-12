function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className ?? ''}`} style={style} />
}

export default function EnrollmentLoading() {
  return (
    <div className="space-y-4">
      {/* PageHeader */}
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <Bone className="h-7 w-36" />
          <Bone className="h-5 w-16 rounded-full" />
        </div>
        <Bone className="h-8 w-24 rounded-lg" />
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden">
        <div className="flex gap-4 border-b bg-muted/30 px-4 py-2.5">
          {[96, 80, 72, 120, 80, 160].map((w, i) => (
            <Bone key={i} className="h-3.5" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b last:border-0 px-4 py-3">
            <Bone className="h-3.5 w-24" />
            <Bone className="h-5 w-20 rounded-full" />
            <Bone className="h-3.5 w-16" />
            <Bone className="h-3.5 w-28" />
            <Bone className="h-5 w-20 rounded-full" />
            <Bone className="h-3.5 w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}
