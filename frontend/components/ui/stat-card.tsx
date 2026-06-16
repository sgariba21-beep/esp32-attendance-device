import * as React from "react"
import { type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type StatCardProps = {
  label: string
  value: React.ReactNode
  icon?: LucideIcon
  hint?: React.ReactNode
  /** Tint the value with the brand or a semantic colour. */
  tone?: "default" | "primary" | "success" | "destructive" | "muted"
  className?: string
}

const toneClass: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  primary: "text-primary",
  success: "text-success-foreground",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
}

/** Compact metric tile for overview/summary rows. */
function StatCard({ label, value, icon: Icon, hint, tone = "default", className }: StatCardProps) {
  return (
    <div
      data-slot="stat-card"
      className={cn(
        "flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-xs",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/70" />}
      </div>
      <span className={cn("text-2xl font-semibold tracking-tight tabular-nums", toneClass[tone])}>
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export { StatCard }
