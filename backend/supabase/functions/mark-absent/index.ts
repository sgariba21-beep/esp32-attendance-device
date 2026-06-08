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

  // Capture the exact moment the function runs
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const currentTime = now.toISOString().split("T")[1].slice(0, 8); // HH:MM:SS

  // Check 1: Skip weekends (0 = Sunday, 6 = Saturday)
  const dayOfWeek = now.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return new Response(
      JSON.stringify({ message: "Weekend — absent marking skipped" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Check 2: Skip public holidays
  const { data: holiday } = await supabase
    .from("holidays")
    .select("label")
    .eq("date", today)
    .maybeSingle();

  if (holiday) {
    return new Response(
      JSON.stringify({ message: `Holiday (${holiday.label}) — absent marking skipped` }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
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

  // Check 3: Skip if today falls outside the active term's date range (vacation period)
  if (academic.start_date && today < academic.start_date) {
    return new Response(
      JSON.stringify({ message: "Before term start — absent marking skipped" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  if (academic.end_date && today > academic.end_date) {
    return new Response(
      JSON.stringify({ message: "After term end — absent marking skipped" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Get all active students
  const { data: students, error: studentsError } = await supabase
    .from("students")
    .select("id, device_id")
    .eq("status", "active");

  if (studentsError || !students || students.length === 0) {
    return new Response(JSON.stringify({ error: "No active students found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get all students who were marked present today
  const { data: presentRecords, error: presentError } = await supabase
    .from("attendance")
    .select("sid")
    .eq("date", today)
    .eq("status", "present");

  if (presentError) {
    return new Response(JSON.stringify({ error: presentError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Build a set of student UUIDs who are already marked present today
  const presentIds = new Set((presentRecords || []).map((r) => r.sid));

  // Filter out students who are already present
  const absentStudents = students.filter((s) => !presentIds.has(s.id));

  if (absentStudents.length === 0) {
    return new Response(
      JSON.stringify({ message: "All students present today" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build absent records for all absent students
  const absentRecords = absentStudents.map((s) => ({
    sid: s.id,
    academic_id: academic.id,
    device_id: s.device_id,
    date: today,
    time: currentTime,
    status: "absent",
    scan_id: null,
  }));

  // Insert all absent records in one go
  const { error: insertError } = await supabase
    .from("attendance")
    .insert(absentRecords);

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      message: `Marked ${absentStudents.length} student(s) absent for ${today}`,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});