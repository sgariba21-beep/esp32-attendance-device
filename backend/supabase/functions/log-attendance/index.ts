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

  // Look up institution to validate per-institution secret and read config.
  // Auth failure returns the same 401 whether the institution doesn't exist
  // or the secret is wrong — no enumeration of valid institution IDs.
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

  // Read skip_weekends from institution config, not hardcoded.
  if (institution.skip_weekends) {
    const dayOfWeek = dt.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return new Response(
        JSON.stringify({ message: "Weekend — scan ignored" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Holiday check: range overlap (today BETWEEN start_date AND end_date).
  // Replaces the old exact .eq("date", date) match.
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

  // Look up member by sid, scoped to institution.
  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, device_id")
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

  // Find active period — nullable result, no error if none exists (Decision 3).
  // Office-type institutions have no period concept and attendance inserts
  // with period_id = null.
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

  return new Response(JSON.stringify({ message: "Attendance logged" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
