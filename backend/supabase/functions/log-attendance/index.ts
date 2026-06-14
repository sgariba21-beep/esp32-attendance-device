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

  // Validate per-institution secret. Same 401 for missing institution or wrong secret.
  const { data: institution, error: instError } = await supabase
    .from("institutions")
    .select("device_secret, skip_weekends")
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

  // Holiday check: range overlap.
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

  // Look up member — also fetch their device's mode so we know scan semantics.
  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, device_id, device:device_id(mode)")
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

  const deviceMode =
    (member.device as unknown as { mode: string } | null)?.mode ??
    "present_absent";

  // Find active period (nullable — office-type institutions have none).
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

  let scan_type: "present" | "time_in" | "time_out";

  if (deviceMode === "time_in_out") {
    // Determine whether this is time_in or time_out based on today's records.
    const { data: todayScans } = await supabase
      .from("attendance")
      .select("scan_type")
      .eq("member_id", member.id)
      .eq("date", date)
      .in("scan_type", ["time_in", "time_out"]);

    const existing = new Set((todayScans ?? []).map((r) => r.scan_type));

    if (!existing.has("time_in")) {
      scan_type = "time_in";
    } else if (!existing.has("time_out")) {
      scan_type = "time_out";
    } else {
      // Both already recorded today — ignore.
      return new Response(
        JSON.stringify({ message: "Already fully logged today" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  } else {
    scan_type = "present";
  }

  const { error: insertError } = await supabase
    .from("attendance")
    .insert({
      member_id: member.id,
      period_id: period?.id ?? null,
      device_id: member.device_id,
      institution_id,
      date,
      time,
      status: "present",
      scan_id,
      scan_type,
    });

  if (insertError) {
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
