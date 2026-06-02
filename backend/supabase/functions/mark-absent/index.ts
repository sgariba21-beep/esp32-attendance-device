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

  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split("T")[0];

  // Find the currently active academic record
  const { data: academic, error: academicError } = await supabase
    .from("academic")
    .select("id")
    .eq("status", "active")
    .single();

  if (academicError || !academic) {
    return new Response(JSON.stringify({ error: "No active academic term" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get all active students
  const { data: students, error: studentsError } = await supabase
    .from("students")
    .select("id")
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
    date: today,
    time: "23:00:00",
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