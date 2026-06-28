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

/**
 * Parse the device-supplied timestamp into a UTC instant (M13).
 */
function parseInstant(ts: unknown): Date | null {
  if (typeof ts !== "string" || ts.trim().length < 19) return null;
  let s = ts.trim();
  if (s.includes(" ") && !s.includes("T")) s = s.replace(" ", "T");
  if (!/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 2000 || y > 2100) return null;
  return d;
}

/**
 * Convert a UTC instant to wall-clock parts in the institution's timezone (H3).
 */
function zonedParts(instant: Date, timeZone: string): { date: string; time: string; weekday: string } {
  let date: string, time: string, weekday: string;
  try {
    date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
    time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(instant);
    weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
  } catch {
    date = instant.toISOString().split("T")[0];
    time = instant.toISOString().split("T")[1].slice(0, 8);
    weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(instant);
  }
  return { date, time, weekday };
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    let parsed: {
      // New path (T1e): device_id identifies the device directly.
      device_id?: string;
      // Legacy / transitional fields (used by both paths).
      institution_id?: string;
      sid?: string;
      scan_id?: string;
      timestamp?: string;
    };
    try {
      parsed = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { device_id, institution_id: bodyInstitutionId, sid, scan_id, timestamp } = parsed;

    if (!sid || !scan_id || !timestamp) {
      return json({ error: "Missing required fields" }, 400);
    }

    const instant = parseInstant(timestamp);
    if (!instant) {
      return json({ error: "Invalid timestamp" }, 400);
    }

    let institution_id: string;
    let authenticatedDeviceId: string | null = null;

    if (device_id) {
      // ── New path (T1e): per-device secret authentication ────────────────────
      const { data: device, error: devErr } = await supabase
        .from("devices")
        .select("id, institution_id, device_secret, revoked")
        .eq("id", device_id)
        .single();

      if (devErr || !device) {
        return json({ error: "Unauthorized" }, 401);
      }

      if (!device.device_secret || req.headers.get("x-device-secret") !== device.device_secret) {
        return json({ error: "Unauthorized" }, 401);
      }

      if (device.revoked) {
        return json({ error: "Device revoked" }, 403);
      }

      if (!device.institution_id) {
        return json({ error: "Device not assigned to an institution" }, 403);
      }

      institution_id = device.institution_id;
      // Stamp attendance with the authenticated device, not member.device_id.
      authenticatedDeviceId = device.id;
    } else {
      // TRANSITION: legacy path — validate against institutions.device_secret.
      // Remove after all devices re-provisioned with per-device secrets (see T20m).
      if (!bodyInstitutionId) {
        return json({ error: "Missing device_id or institution_id" }, 400);
      }
      institution_id = bodyInstitutionId;

      const { data: institution, error: instError } = await supabase
        .from("institutions")
        .select("device_secret, status, timezone, skip_weekends, track_students, track_staff, student_scan_mode, staff_scan_mode")
        .eq("id", institution_id)
        .single();

      if (instError || !institution) {
        return json({ error: "Unauthorized" }, 401);
      }

      if (req.headers.get("x-device-secret") !== institution.device_secret) {
        return json({ error: "Unauthorized" }, 401);
      }

      // Status/config fetched below via a second query; store for now.
      // Fall through to shared logic below.
    }

    // Load institution config (shared by both auth paths).
    const { data: institution, error: instError } = await supabase
      .from("institutions")
      .select("status, timezone, skip_weekends, track_students, track_staff, student_scan_mode, staff_scan_mode")
      .eq("id", institution_id)
      .single();

    if (instError || !institution) {
      return json({ error: "Institution not found" }, 500);
    }

    if (institution.status !== "active") {
      return json({ error: "Institution inactive" }, 403);
    }

    const tz = institution.timezone || "UTC";
    const { date, time, weekday } = zonedParts(instant, tz);

    if (institution.skip_weekends) {
      if (weekday === "Sun" || weekday === "Sat") {
        return json({ message: "Weekend — scan ignored" });
      }
    }

    const { data: holiday } = await supabase
      .from("holidays")
      .select("label")
      .eq("institution_id", institution_id)
      .lte("start_date", date)
      .gte("end_date", date)
      .maybeSingle();

    if (holiday) {
      return json({ message: `Holiday (${holiday.label}) — scan ignored` });
    }

    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, device_id, member_type")
      .eq("sid", sid)
      .eq("institution_id", institution_id)
      .eq("status", "active")
      .single();

    if (memberError || !member) {
      return json({ error: "Member not found" }, 404);
    }

    const isStudentLike = member.member_type === "student" || member.member_type === "member";
    const isStaff = member.member_type === "staff";

    if (isStudentLike && !institution.track_students) {
      return json({ message: "Member type not tracked — scan ignored" });
    }

    if (isStaff && !institution.track_staff) {
      return json({ message: "Member type not tracked — scan ignored" });
    }

    const scanMode = isStaff ? institution.staff_scan_mode : institution.student_scan_mode;

    const { data: period } = await supabase
      .from("periods")
      .select("id, start_date, end_date")
      .eq("institution_id", institution_id)
      .eq("status", "active")
      .maybeSingle();

    if (period) {
      if (period.start_date && date < period.start_date) {
        return json({ message: "Before period start — scan ignored" });
      }
      if (period.end_date && date > period.end_date) {
        return json({ message: "After period end — scan ignored" });
      }
    }

    let scan_type: "present" | "time_in" | "time_out";

    if (scanMode === "time_in_out") {
      const { data: existing } = await supabase
        .from("attendance")
        .select("scan_type")
        .eq("member_id", member.id)
        .eq("date", date)
        .in("scan_type", ["time_in", "time_out"]);

      const hasTimeIn = existing?.some((r) => r.scan_type === "time_in") ?? false;
      const hasTimeOut = existing?.some((r) => r.scan_type === "time_out") ?? false;

      if (hasTimeIn && hasTimeOut) {
        return json({ message: "Already fully logged for today — scan ignored" });
      }

      scan_type = hasTimeIn ? "time_out" : "time_in";
    } else {
      scan_type = "present";
    }

    // Use the authenticated device_id (new path) or fall back to member.device_id (legacy).
    const effectiveDeviceId = authenticatedDeviceId ?? member.device_id;

    const { error: insertError } = await supabase.from("attendance").insert({
      member_id: member.id,
      period_id: period?.id ?? null,
      device_id: effectiveDeviceId,
      institution_id,
      date,
      time,
      status: "present",
      scan_type,
      scan_id,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        return json({ message: "Duplicate scan ignored" });
      }
      return json({ error: insertError.message }, 500);
    }

    return json({ message: "Attendance logged", scan_type });
  } catch (e) {
    return json({ error: `Internal error: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
