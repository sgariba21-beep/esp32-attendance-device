import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req: Request) => {
  // Only allow POST requests
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Authenticate the device — every ESP32 must send the shared secret as X-Device-Secret.
  // The secret lives in an env var so it never appears in source code.
  if (req.headers.get("x-device-secret") !== Deno.env.get("DEVICE_SHARED_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse the request body
  const { sid, scan_id, timestamp } = await req.json();

  // Validate required fields
  if (!sid || !scan_id || !timestamp) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse date and time from timestamp
  const dt = new Date(timestamp);
  const date = dt.toISOString().split("T")[0];             // "2025-06-02"
  const time = dt.toISOString().split("T")[1].slice(0, 8); // "08:30:00"

  // Check 1: Skip weekends (0 = Sunday, 6 = Saturday)
  const dayOfWeek = dt.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return new Response(
      JSON.stringify({ message: "Weekend — scan ignored" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Check 2: Skip public holidays
  const { data: holiday } = await supabase
    .from("holidays")
    .select("label")
    .eq("date", date)
    .maybeSingle();

  if (holiday) {
    return new Response(
      JSON.stringify({ message: `Holiday (${holiday.label}) — scan ignored` }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Look up the student by school ID
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, device_id")
    .eq("sid", sid)
    .eq("status", "active")
    .single();

  if (studentError || !student) {
    return new Response(JSON.stringify({ error: "Student not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Find the currently active academic record
  const { data: academic, error: academicError } = await supabase
    .from("academic")
    .select("id, start_date, end_date")
    .eq("status", "active")
    .single();

  if (academicError || !academic) {
    return new Response(JSON.stringify({ error: "No active academic term" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check 3: Skip if outside the active term's date range
  if (academic.start_date && date < academic.start_date) {
    return new Response(
      JSON.stringify({ message: "Before term start — scan ignored" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  if (academic.end_date && date > academic.end_date) {
    return new Response(
      JSON.stringify({ message: "After term end — scan ignored" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Insert attendance record
  const { error: insertError } = await supabase
    .from("attendance")
    .insert({
      sid: student.id,
      academic_id: academic.id,
      device_id: student.device_id,
      date,
      time,
      status: "present",
      scan_id,
    });

  // If scan_id already exists, treat it as a duplicate and return success
  if (insertError) {
    if (insertError.code === "23505") {
      return new Response(JSON.stringify({ message: "Duplicate scan ignored" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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