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

function localTime(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).format(instant);
  } catch {
    return instant.toISOString().split("T")[1].slice(0, 8);
  }
}

// T15: process institutions in bounded-concurrency batches rather than fully
// sequential. Each batch runs concurrently; batches are sequential to bound
// total in-flight requests and respect the function wall-clock limit.
const BATCH_SIZE = 8;

async function processInstitution(inst: {
  id: string; status: string; skip_weekends: boolean; timezone: string;
  track_students: boolean; track_staff: boolean;
  student_scan_mode: string; staff_scan_mode: string;
}): Promise<string> {
  if (inst.status !== "active") {
    return `${inst.id}: inactive — skipped`;
  }

  const now = new Date();
  const todayInTz = now.toLocaleDateString("en-CA", { timeZone: inst.timezone });
  const currentTime = localTime(now, inst.timezone || "UTC");

  if (inst.skip_weekends) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: inst.timezone,
      weekday: "short",
    }).format(now);
    if (weekday === "Sun" || weekday === "Sat") {
      return `${inst.id}: weekend — skipped`;
    }
  }

  // H3 consistency: fetch holidays and match in code (non-recurring and recurring).
  const { data: holidays } = await supabase
    .from("holidays")
    .select("label, start_date, end_date, recurring")
    .eq("institution_id", inst.id);

  const todayMMDD = todayInTz.slice(5);
  const holiday = (holidays || []).find((h) => {
    if (!h.recurring) {
      return h.start_date <= todayInTz && todayInTz <= h.end_date;
    }
    const startMMDD = h.start_date.slice(5);
    const endMMDD = h.end_date.slice(5);
    if (startMMDD <= endMMDD) {
      return startMMDD <= todayMMDD && todayMMDD <= endMMDD;
    }
    return todayMMDD >= startMMDD || todayMMDD <= endMMDD;
  });

  if (holiday) {
    return `${inst.id}: holiday (${holiday.label}) — skipped`;
  }

  const { data: period } = await supabase
    .from("periods")
    .select("id, start_date, end_date")
    .eq("institution_id", inst.id)
    .eq("status", "active")
    .maybeSingle();

  if (period) {
    if (period.start_date && todayInTz < period.start_date) {
      return `${inst.id}: before period start — skipped`;
    }
    if (period.end_date && todayInTz > period.end_date) {
      return `${inst.id}: after period end — skipped`;
    }
  }

  const trackedTypes: string[] = [];
  if (inst.track_students) trackedTypes.push("student");
  if (inst.track_staff) trackedTypes.push("staff");

  if (trackedTypes.length === 0) {
    return `${inst.id}: no member types tracked — skipped`;
  }

  const { data: members, error: membersError } = await supabase
    .from("members")
    .select("id, device_id, member_type")
    .eq("institution_id", inst.id)
    .eq("status", "active")
    .in("member_type", trackedTypes);

  if (membersError || !members || members.length === 0) {
    return `${inst.id}: no active tracked members`;
  }

  const studentScanType = inst.student_scan_mode === "time_in_out" ? "time_in" : "present";
  const staffScanType   = inst.staff_scan_mode   === "time_in_out" ? "time_in" : "present";

  function scanTypeFor(memberType: string): "present" | "time_in" {
    return memberType === "staff" ? staffScanType : studentScanType;
  }

  const { data: presentRecords, error: presentError } = await supabase
    .from("attendance")
    .select("member_id, scan_type")
    .eq("institution_id", inst.id)
    .eq("date", todayInTz)
    .eq("status", "present");

  if (presentError) {
    return `${inst.id}: error reading present records — ${presentError.message}`;
  }

  const presentSet = new Set(
    (presentRecords || []).map((r) => `${r.member_id}:${r.scan_type}`)
  );

  const absentRecords = members
    .filter((m) => {
      const expected = scanTypeFor(m.member_type);
      return !presentSet.has(`${m.id}:${expected}`);
    })
    .map((m) => ({
      member_id: m.id,
      period_id: period?.id ?? null,
      device_id: m.device_id,
      institution_id: inst.id,
      date: todayInTz,
      time: currentTime,
      status: "absent",
      scan_type: scanTypeFor(m.member_type),
      scan_id: null,
    }));

  if (absentRecords.length === 0) {
    return `${inst.id}: all tracked members present`;
  }

  const { error: insertError } = await supabase
    .from("attendance")
    .upsert(absentRecords, {
      onConflict: "member_id,date,scan_type",
      ignoreDuplicates: true,
    });

  if (insertError) {
    return `${inst.id}: insert error — ${insertError.message}`;
  }

  return `${inst.id}: marked ${absentRecords.length} absent`;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: institutions, error: instError } = await supabase
      .from("institutions")
      .select(
        "id, status, skip_weekends, timezone, track_students, track_staff, student_scan_mode, staff_scan_mode"
      );

    if (instError || !institutions || institutions.length === 0) {
      return json({ error: "No institutions found" }, 500);
    }

    const results: string[] = [];

    // T15: bounded-concurrency batches — BATCH_SIZE institutions in parallel,
    // batches in sequence. Caps total in-flight DB connections and keeps the
    // function well within the wall-clock limit even with many tenants.
    for (let i = 0; i < institutions.length; i += BATCH_SIZE) {
      const batch = institutions.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(processInstitution));
      results.push(...batchResults);
    }

    return json({ results });
  } catch (e) {
    return json({ error: `Internal error: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
