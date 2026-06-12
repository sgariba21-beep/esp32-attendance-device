import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          "h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-background py-1 pl-2.5 pr-8 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 shrink-0 text-muted-foreground" />
    </div>
  )
}

export { NativeSelect }
