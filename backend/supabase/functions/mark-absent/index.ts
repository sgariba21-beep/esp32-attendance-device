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

  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: institutions, error: instError } = await supabase
    .from("institutions")
    .select(
      "id, skip_weekends, timezone, track_students, track_staff, student_scan_mode, staff_scan_mode"
    );

  if (instError || !institutions || institutions.length === 0) {
    return new Response(JSON.stringify({ error: "No institutions found" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results: string[] = [];

  for (const inst of institutions) {
    const now = new Date();

    const todayInTz = now.toLocaleDateString("en-CA", {
      timeZone: inst.timezone,
    });

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

    // Determine which member types to mark absent for this institution.
    // 'member' (generic/neutral) follows student rules.
    const trackedTypes: string[] = [];
    if (inst.track_students) trackedTypes.push("student");
    if (inst.track_staff) trackedTypes.push("staff");

    if (trackedTypes.length === 0) {
      results.push(`${inst.id}: no member types tracked — skipped`);
      continue;
    }

    const { data: members, error: membersError } = await supabase
      .from("members")
      .select("id, device_id, member_type")
      .eq("institution_id", inst.id)
      .eq("status", "active")
      .in("member_type", trackedTypes);

    if (membersError || !members || members.length === 0) {
      results.push(`${inst.id}: no active tracked members`);
      continue;
    }

    // For each member type group, determine the scan_type to use for absent records.
    // present_absent mode → scan_type = 'present' (the slot that was never filled)
    // time_in_out mode  → scan_type = 'time_in'  (they never clocked in)
    const studentScanType =
      inst.student_scan_mode === "time_in_out" ? "time_in" : "present";
    const staffScanType =
      inst.staff_scan_mode === "time_in_out" ? "time_in" : "present";

    function scanTypeFor(memberType: string): "present" | "time_in" {
      return memberType === "staff" ? staffScanType : studentScanType;
    }

    // Collect all present/time_in records for today across this institution.
    const { data: presentRecords, error: presentError } = await supabase
      .from("attendance")
      .select("member_id, scan_type")
      .eq("institution_id", inst.id)
      .eq("date", todayInTz)
      .eq("status", "present");

    if (presentError) {
      results.push(
        `${inst.id}: error reading present records — ${presentError.message}`
      );
      continue;
    }

    // A member is "present today" if they have a present record whose scan_type
    // matches what we'd use for absent (i.e., they already have the relevant slot filled).
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
        time: currentTimeUtc,
        status: "absent",
        scan_type: scanTypeFor(m.member_type),
        scan_id: null,
      }));

    if (absentRecords.length === 0) {
      results.push(`${inst.id}: all tracked members present`);
      continue;
    }

    const { error: insertError } = await supabase
      .from("attendance")
      .insert(absentRecords);

    if (insertError) {
      results.push(`${inst.id}: insert error — ${insertError.message}`);
    } else {
      results.push(`${inst.id}: marked ${absentRecords.length} absent`);
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
