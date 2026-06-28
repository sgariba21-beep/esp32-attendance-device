/**
 * T5 — RBAC coverage check.
 *
 * Asserts that every page.tsx under app/(dashboard) is covered by a role gate:
 * either it lives inside the (admin) route group (whose layout calls requireRole)
 * OR it calls requireRole directly.
 *
 * Run: node scripts/check-rbac.mjs
 * Add to CI: package.json "check:rbac": "node scripts/check-rbac.mjs"
 *
 * A new page that forgets a role gate will fail this check and block the merge.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DASHBOARD_DIR = join(__dirname, '..', 'app', '(dashboard)')
const ADMIN_GROUP   = '(admin)'

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, files)
    else if (entry === 'page.tsx' || entry === 'page.ts') files.push(full)
  }
  return files
}

const pages  = walk(DASHBOARD_DIR)
const errors = []

for (const page of pages) {
  const rel = relative(DASHBOARD_DIR, page)

  // Pages inside (admin) group are covered by the group layout.
  if (rel.startsWith(`${ADMIN_GROUP}/`) || rel.startsWith(`(admin)\\`)) continue

  // All other pages must call requireRole themselves.
  const src = readFileSync(page, 'utf8')
  if (!src.includes('requireRole(')) {
    errors.push(`  UNGATED: app/(dashboard)/${rel}`)
  }
}

if (errors.length > 0) {
  console.error('\n[check-rbac] The following pages lack a role gate:\n')
  errors.forEach(e => console.error(e))
  console.error(`
Either:
  (a) Move the page into app/(dashboard)/(admin)/ to get the group layout gate, OR
  (b) Call requireRole(...) directly inside the page's default export.
`)
  process.exit(1)
}

console.log(`[check-rbac] All ${pages.length} dashboard pages have a role gate. ✓`)
