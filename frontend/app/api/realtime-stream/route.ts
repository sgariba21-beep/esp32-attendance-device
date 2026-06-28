/**
 * T3f — REMOVED. This SSE route has been replaced by the /api/changes watermark
 * polling endpoint. Delete this file; it is kept as a tombstone only.
 *
 * If you see this file in a code review, it should be deleted — any import of
 * this route is a bug (the RealtimeRefresh component now polls /api/changes).
 *
 * The enrollment live-status stream (app/api/enrollment-stream/route.ts) is
 * separate and intentionally kept.
 */
export async function GET() {
  return new Response('Gone — use /api/changes', { status: 410 })
}
