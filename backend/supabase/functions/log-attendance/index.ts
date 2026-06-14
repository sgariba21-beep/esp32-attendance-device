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

  const { institution_id, sid, scan_id, timestamp } = await req.json();

  if (!institution_id || !sid || !scan_id || !timestamp) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate secret and load institution config in one query.
  const { data: institution, error: instError } = await supabase
    .from("institutions")
    .select(
      "device_secret, skip_weekends, track_students, track_staff, student_scan_mode, staff_scan_mode"
    )
    .eq("id", institution_id)
    .single();

  if (instError || !institution) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.headers.get("x-device-secret") !== institution.device_secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const dt = new Date(timestamp);
  const date = dt.toISOString().split("T")[0];
  const time = dt.toISOString().split("T")[1].slice(0, 8);

  if (institution.skip_weekends) {
    const dayOfWeek = dt.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return new Response(
        JSON.stringify({ message: "Weekend — scan ignored" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Holiday check.
  const { data: holiday } = await supabase
    .from("holidays")
    .select("label")
    .eq("institution_id", institution_id)
    .lte("start_date", date)
    .gte("end_date", date)
    .maybeSingle();

  if (holiday) {
    return new Response(
      JSON.stringify({ message: `Holiday (${holiday.label}) — scan ignored` }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
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
    return new Response(JSON.stringify({ error: "Member not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Determine tracking rules based on member_type.
  // 'member' (the neutral/generic type) follows student rules.
  const isStudentLike =
    member.member_type === "student" || member.member_type === "member";
  const isStaff = member.member_type === "staff";

  if (isStudentLike && !institution.track_students) {
    return new Response(
      JSON.stringify({ message: "Member type not tracked — scan ignored" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (isStaff && !institution.track_staff) {
    return new Response(
      JSON.stringify({ message: "Member type not tracked — scan ignored" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
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
      return new Response(
        JSON.stringify({ message: "Before period start — scan ignored" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (period.end_date && date > period.end_date) {
      return new Response(
        JSON.stringify({ message: "After period end — scan ignored" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Determine scan_type based on the mode configured for this member type.
  let scan_type: "present" | "time_in" | "time_out";

  if (scanMode === "time_in_out") {
    // Check what has already been recorded for this member today.
    const { data: existing } = await supabase
      .from("attendance")
      .select("scan_type")
      .eq("member_id", member.id)
      .eq("date", date)
      .in("scan_type", ["time_in", "time_out"]);

    const hasTimeIn = existing?.some((r) => r.scan_type === "time_in") ?? false;
    const hasTimeOut = existing?.some((r) => r.scan_type === "time_out") ?? false;

    if (hasTimeIn && hasTimeOut) {
      return new Response(
        JSON.stringify({ message: "Already fully logged for today — scan ignored" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
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
    // Unique constraint (member_id, date, scan_type) — duplicate scan for same type today.
    if (insertError.code === "23505") {
      return new Response(
        JSON.stringify({ message: "Duplicate scan ignored" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ message: "Attendance logged", scan_type }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
