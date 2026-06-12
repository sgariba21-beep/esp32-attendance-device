function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className ?? ''}`} style={style} />
}

export default function PromotionLoading() {
  return (
    <div className="space-y-6">
      {/* PageHeader */}
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <Bone className="h-7 w-36" />
          <Bone className="h-3.5 w-64" />
        </div>
        <div className="flex flex-col items-end gap-1">
          <Bone className="h-8 w-36 rounded-lg" />
          <Bone className="h-3 w-44" />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Bone className="h-3.5 w-16" />
              <Bone className="h-3.5 w-4" />
              <Bone className="h-3.5 w-16" />
            </div>
            <Bone className="h-8 w-12" />
            <Bone className="h-3 w-40" />
          </div>
        ))}
      </div>

      {/* Collapsible group rows */}
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border">
            <div className="flex items-center justify-between px-4 py-3">
              <Bone className="h-3.5 w-48" />
              <Bone className="h-4 w-4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
