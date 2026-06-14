import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // x-cron-secret auth: Kong strips Authorization headers; custom header
  // survives. Same pattern as before, unchanged.
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Single global cron iterates all institutions (Decision 7).
  const { data: institutions, error: instError } = await supabase
    .from("institutions")
    .select("id, skip_weekends, timezone");

  if (instError || !institutions || institutions.length === 0) {
    return new Response(JSON.stringify({ error: "No institutions found" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results: string[] = [];

  for (const inst of institutions) {
    const now = new Date();

    // Resolve today's date in the institution's local timezone (Decision 6).
    // en-CA gives "YYYY-MM-DD" which is the format used by the date columns.
    const todayInTz = now.toLocaleDateString("en-CA", {
      timeZone: inst.timezone,
    });

    // UTC time for the attendance.time column (all timestamps stored UTC).
    const currentTimeUtc = now.toISOString().split("T")[1].slice(0, 8);

    if (inst.skip_weekends) {
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: inst.timezone,
        weekday: "short",
      }).format(now);
      if (weekday === "Sun" || weekday === "Sat") {
        results.push(`${inst.id}: weekend — skipped`);
        continue;
      }
    }

    // Holiday check: range overlap in institution's local date.
    const { data: holiday } = await supabase
      .from("holidays")
      .select("label")
      .eq("institution_id", inst.id)
      .lte("start_date", todayInTz)
      .gte("end_date", todayInTz)
      .maybeSingle();

    if (holiday) {
      results.push(`${inst.id}: holiday (${holiday.label}) — skipped`);
      continue;
    }

    // Active period — nullable (Decision 3). Office-type institutions run
    // without a period; attendance inserts with period_id = null for them.
    const { data: period } = await supabase
      .from("periods")
      .select("id, start_date, end_date")
      .eq("institution_id", inst.id)
      .eq("status", "active")
      .maybeSingle();

    if (period) {
      if (period.start_date && todayInTz < period.start_date) {
        results.push(`${inst.id}: before period start — skipped`);
        continue;
      }
      if (period.end_date && todayInTz > period.end_date) {
        results.push(`${inst.id}: after period end — skipped`);
        continue;
      }
    }

    const { data: members, error: membersError } = await supabase
      .from("members")
      .select("id, device_id")
      .eq("institution_id", inst.id)
      .eq("status", "active");

    if (membersError || !members || members.length === 0) {
      results.push(`${inst.id}: no active members`);
      continue;
    }

    const { data: presentRecords, error: presentError } = await supabase
      .from("attendance")
      .select("member_id")
      .eq("institution_id", inst.id)
      .eq("date", todayInTz)
      .eq("status", "present");

    if (presentError) {
      results.push(`${inst.id}: error reading present records — ${presentError.message}`);
      continue;
    }

    const presentIds = new Set((presentRecords || []).map((r) => r.member_id));
    const absentMembers = members.filter((m) => !presentIds.has(m.id));

    if (absentMembers.length === 0) {
      results.push(`${inst.id}: all present`);
      continue;
    }

    const absentRecords = absentMembers.map((m) => ({
      member_id: m.id,
      period_id: period?.id ?? null,
      device_id: m.device_id,
      institution_id: inst.id,
      date: todayInTz,
      time: currentTimeUtc,
      status: "absent",
      scan_id: null,
    }));

    const { error: insertError } = await supabase
      .from("attendance")
      .insert(absentRecords);

    if (insertError) {
      results.push(`${inst.id}: insert error — ${insertError.message}`);
    } else {
      results.push(`${inst.id}: marked ${absentMembers.length} absent`);
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
