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
 *
 * The device RTC is synced to NTP at UTC offset 0, and the firmware sends
 * "YYYY-MM-DD HH:MM:SS" with no zone designator. We treat that as UTC and keep
 * it AUTHORITATIVE — attendance reflects when the scan happened on the device,
 * never when the server received it. Returns null if unparseable / implausible.
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
 * Everything downstream — the stored date/time, the weekend check, holiday and
 * period boundaries — uses these, so log-attendance and mark-absent now agree on
 * what "today" is for a given institution.
 */
function zonedParts(instant: Date, timeZone: string): { date: string; time: string; weekday: string } {
  let date: string, time: string, weekday: string;
  try {
    date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
    time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(instant);
    weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
  } catch {
    // Bad/unknown timezone string → fall back to UTC rather than crash.
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

    let parsed: { institution_id?: string; sid?: string; scan_id?: string; timestamp?: string };
    try {
      parsed = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { institution_id, sid, scan_id, timestamp } = parsed;

    if (!institution_id || !sid || !scan_id || !timestamp) {
      return json({ error: "Missing required fields" }, 400);
    }

    // M13: validate the device timestamp up front (and keep it authoritative).
    const instant = parseInstant(timestamp);
    if (!instant) {
      return json({ error: "Invalid timestamp" }, 400);
    }

    // Validate secret and load institution config in one query.
    const { data: institution, error: instError } = await supabase
      .from("institutions")
      .select(
        "device_secret, status, timezone, skip_weekends, track_students, track_staff, student_scan_mode, staff_scan_mode"
      )
      .eq("id", institution_id)
      .single();

    if (instError || !institution) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (req.headers.get("x-device-secret") !== institution.device_secret) {
      return json({ error: "Unauthorized" }, 401);
    }

    // #4: a suspended/deactivated institution's hardware must stop writing
    // attendance. Checked AFTER secret validation so status is not leaked to
    // unauthenticated callers. 403 = authenticated device, tenant switched off.
    if (institution.status !== "active") {
      return json({ error: "Institution inactive" }, 403);
    }

    // H3: derive date/time/weekday in the institution's timezone.
    const tz = institution.timezone || "UTC";
    const { date, time, weekday } = zonedParts(instant, tz);

    if (institution.skip_weekends) {
      if (weekday === "Sun" || weekday === "Sat") {
        return json({ message: "Weekend — scan ignored" });
      }
    }

    // Holiday check (local date).
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

    // Look up member — include member_type to determine tracking rules.
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

    // Determine tracking rules based on member_type.
    // 'member' (the neutral/generic type) follows student rules.
    const isStudentLike =
      member.member_type === "student" || member.member_type === "member";
    const isStaff = member.member_type === "staff";

    if (isStudentLike && !institution.track_students) {
      return json({ message: "Member type not tracked — scan ignored" });
    }

    if (isStaff && !institution.track_staff) {
      return json({ message: "Member type not tracked — scan ignored" });
    }

    const scanMode = isStaff
      ? institution.staff_scan_mode
      : institution.student_scan_mode;

    // Find active period (nullable — office-type institutions may have none).
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

    // Determine scan_type based on the mode configured for this member type.
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

    const { error: insertError } = await supabase.from("attendance").insert({
      member_id: member.id,
      period_id: period?.id ?? null,
      device_id: member.device_id,
      institution_id,
      date,
      time,
      status: "present",
      scan_type,
      scan_id,
    });

    if (insertError) {
      // Unique violation — either (member_id, date, scan_type) duplicate for the
      // day, or (institution_id, scan_id) replay. Either way it's a duplicate.
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
