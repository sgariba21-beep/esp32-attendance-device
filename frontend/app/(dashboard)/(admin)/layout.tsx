/**
 * T5 — Central RBAC gate for admin-only pages.
 *
 * This layout is the single authority for the route group that covers
 * admin-restricted pages (devices, users, institutions, enrollment, staff,
 * onboarding). The requireRole call here is the outer gate; individual pages
 * still call requireRole as defense-in-depth.
 *
 * Pages outside this group (attendance, members, academic, settings, catalog,
 * sales, clients, rewards, reports) rely solely on their own page-level gate.
 * The RBAC coverage test (scripts/check-rbac.mjs) enforces that every page.tsx
 * under (dashboard) either lives inside this group or calls requireRole itself.
 *
 * Admin group allows: super_admin, admin, platform_admin.
 * Individual pages may restrict further (e.g. enrollment: super_admin + platform_admin only).
 */
import { requireRole } from '@/lib/supabase/dal'

export default async function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireRole('super_admin', 'admin', 'platform_admin')
  return <>{children}</>
}
