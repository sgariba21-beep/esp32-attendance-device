import * as React from "react"

import { cn } from "@/lib/utils"

type PageHeaderProps = {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}
    >
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight leading-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}

export { PageHeader }
