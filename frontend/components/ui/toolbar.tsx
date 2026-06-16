import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

/**
 * A consistent filter row for list pages. Sits directly on the page (no heavy
 * surface) so it reads like Linear/Vercel toolbars — the table below is the
 * bordered object, not the controls. Replaces the ad-hoc `flex flex-wrap gap-3`
 * rows so every page's controls align and label consistently.
 */
function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar"
      className={cn(
        "flex flex-wrap items-end gap-x-3 gap-y-3",
        className
      )}
      {...props}
    />
  )
}

/** Label + control pair with consistent spacing and a muted micro-label. */
function ToolbarField({
  label,
  htmlFor,
  className,
  children,
}: {
  label?: React.ReactNode
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label
          htmlFor={htmlFor}
          className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {label}
        </Label>
      )}
      {children}
    </div>
  )
}

/** Thin vertical rule to separate groups of fields inside a toolbar. */
function ToolbarSeparator({ className }: { className?: string }) {
  return <div className={cn("hidden self-stretch w-px bg-border sm:block", className)} />
}

export { Toolbar, ToolbarField, ToolbarSeparator }
