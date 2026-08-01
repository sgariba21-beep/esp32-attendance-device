import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Schema version of the device_config_* wire format itself (OLED Phase 1),
// separate from config_rev (the per-institution data revision). Bump this
// only if the flat-key shape below changes in a way old firmware can't parse.
const DEVICE_CONFIG_VERSION = 1;

/**
 * Numeric UTC offset in minutes for an IANA zone, recomputed per call so DST
 * is handled for free (the ESP32 can't resolve an IANA zone name itself).
 * Same technique as log-attendance's zonedParts: format "now" in the target
 * zone, then read those wall-clock numbers back as if they were UTC — the
 * difference from the real UTC instant is the offset.
 */
function tzOffsetMinutes(timeZone: string, instant = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(instant).reduce((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    return Math.round((asUTC - instant.getTime()) / 60000);
  } catch {
    return 0;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let parsed: { device_id?: string; device_config_rev?: number };
  try {
    parsed = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { device_id, device_config_rev } = parsed;
  if (!device_id) {
    return json({ error: "Missing device_id" }, 400);
  }

  // T11: check for a pending decommission signal BEFORE looking up the device row.
  // The device_resets record is keyed by device_id and has no FK constraint,
  // so it survives the deletion of the devices row.
  //
  // T11 change from prior behaviour: do NOT delete the row on read. Return
  // decommissioned:true while the row exists; clear it only when the device
  // re-registers with a fresh identity. This removes the "one-shot signal"
  // vulnerability where an attacker who knows a device UUID consumes the signal
  // before the real device polls. Server-side revocation (devices.revoked, T1e)
  // is the authoritative cut-off; the wipe is cosmetic cleanup.
  const { data: resetRecord } = await supabase
    .from("device_resets")
    .select("device_id")
    .eq("device_id", device_id)
    .maybeSingle();

  if (resetRecord) {
    // Do NOT delete the row here (T11). The device will wipe and re-register;
    // /register clears the reset row when a fresh MAC comes in for this device_id.
    return json({ decommissioned: true });
  }

  // T1e: authenticate against the per-device secret (not the institution secret).
  // Institution config is embedded here (not a second query) since this runs
  // per device every 10s forever.
  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select(`
      id, institution_id, display_name, device_secret, revoked,
      institutions ( config_rev, member_name_display, timezone )
    `)
    .eq("id", device_id)
    .single();

  if (deviceError || !device) {
    return json({ error: "Device not found" }, 404);
  }

  if (!device.device_secret || req.headers.get("x-device-secret") !== device.device_secret) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (device.revoked) {
    return json({ error: "Device revoked" }, 403);
  }

  // devices.institution_id -> institutions.id is many-to-one, so PostgREST
  // embeds a single object here, not an array.
  const institution = device.institutions as unknown as
    { config_rev: number; member_name_display: string; timezone: string } | null;

  const configRev = institution?.config_rev ?? 1;
  // 0 (no cached config yet, or pre-Phase-2 firmware that omits the field)
  // is always "stale" against a real config_rev, which starts at 1.
  const deviceRev = typeof device_config_rev === "number" ? device_config_rev : 0;
  const deviceConfig: Record<string, unknown> = {
    device_config_ver: DEVICE_CONFIG_VERSION,
    device_config_rev: configRev,
    device_config_tz_offset: tzOffsetMinutes(institution?.timezone || "UTC"),
    // Sent every poll (not gated on device_config_rev) so a dashboard rename
    // reaches the idle screen within one 10s cycle instead of only ever being
    // set once, at initial assignment (register/assignment-poll don't get
    // called again after that).
    display_name: device.display_name ?? "",
  };
  if (deviceRev < configRev) {
    deviceConfig.device_config_name_display = institution?.member_name_display ?? "first";
  }

  // Fetch oldest pending job for this device, scoped to institution.
  const { data: job, error } = await supabase
    .from("enrollment_jobs")
    .select(`
      id, command, fid, finger_slot, note,
      member:student_id(id, sid, fullname)
    `)
    .eq("device_id", device.id)
    .eq("institution_id", device.institution_id)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return json({ error: error.message }, 500);
  }

  if (!job) {
    return json({ job: null, ...deviceConfig });
  }

  await supabase
    .from("enrollment_jobs")
    .update({ status: "in_progress" })
    .eq("id", job.id);

  const member = job.member as { id: string; sid: string; fullname: string } | null;
  const isMaster = job.command === "register-master";

  return json({
    job: {
      id: job.id,
      command: job.command,
      fid: job.fid ?? 0,
      finger_slot: job.finger_slot ?? "",
      student_id: member?.id ?? "",
      sid: member?.sid ?? "",
      fullname: isMaster ? (job.note ?? "Master") : (member?.fullname ?? ""),
      unit_name: device.display_name ?? "",
    },
    ...deviceConfig,
  });
});
