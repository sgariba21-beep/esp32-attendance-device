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

  const { id, status, fid, note, finger_slot, student_id } = await req.json();

  if (!id || !status) {
    return new Response(JSON.stringify({ error: "Missing id or status" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const jobUpdate: Record<string, unknown> = { status };
  if (note) jobUpdate.note = note;
  if (fid && fid > 0) jobUpdate.fid = fid;

  const { error: jobError } = await supabase
    .from("enrollment_jobs")
    .update(jobUpdate)
    .eq("id", id);

  if (jobError) {
    return new Response(JSON.stringify({ error: jobError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // On successful registration, update the student's finger slot
  if (status === "completed" && student_id && finger_slot && fid && fid > 0) {
    const studentUpdate: Record<string, number> = {};
    if (finger_slot === "fin1") studentUpdate.fin1 = fid;
    else if (finger_slot === "fin2") studentUpdate.fin2 = fid;

    if (Object.keys(studentUpdate).length > 0) {
      await supabase.from("students").update(studentUpdate).eq("id", student_id);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
