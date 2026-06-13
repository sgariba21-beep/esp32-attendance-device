import Link from 'next/link'

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm bg-card ring-1 ring-foreground/10 rounded-xl p-6 space-y-4 text-center">
        <div className="space-y-1">
          <h1 className="text-base font-semibold text-foreground">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            You don&apos;t have permission to view this page.
          </p>
        </div>
        <Link
          href="/attendance"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
        >
          Go to attendance
        </Link>
      </div>
    </div>
  )
}
