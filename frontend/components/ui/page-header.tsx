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
      className={cn("flex items-start justify-between gap-4", className)}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  )
}

export { PageHeader }
