function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className ?? ''}`} style={style} />
}

export default function DevicesLoading() {
  return (
    <div className="space-y-4">
      {/* PageHeader */}
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <Bone className="h-7 w-28" />
          <Bone className="h-3.5 w-20" />
        </div>
        <Bone className="h-8 w-28 rounded-lg" />
      </div>

      {/* Form groups */}
      {[4, 5, 3].map((count, gi) => (
        <div key={gi}>
          <Bone className="mb-2 h-3.5 w-16" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: count }).map((_, i) => (
              <Bone key={i} className="h-8 w-20 rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
