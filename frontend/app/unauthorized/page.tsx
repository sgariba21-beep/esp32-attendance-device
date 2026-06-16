import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-7 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Access denied</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          You don&apos;t have permission to view this page. If you think this is a
          mistake, contact your administrator.
        </p>
        <Button render={<Link href="/attendance" />} className="mt-6 w-full">
          Go to attendance
        </Button>
      </div>
    </div>
  )
}
