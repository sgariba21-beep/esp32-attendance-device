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

  // Authenticate the device — every ESP32 must send the shared secret as X-Device-Secret.
  if (req.headers.get("x-device-secret") !== Deno.env.get("DEVICE_SHARED_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
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

  // Fetch the job to know its command before updating
  const { data: job } = await supabase
    .from("enrollment_jobs")
    .select("command")
    .eq("id", id)
    .maybeSingle();

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

  // Sync student finger slot on completion
  if (status === "completed" && student_id && finger_slot) {
    const command = job?.command;

    if (command === "register" && fid && fid > 0) {
      // Registration succeeded — store the sensor slot
      const studentUpdate: Record<string, number> = {};
      if (finger_slot === "fin1") studentUpdate.fin1 = fid;
      else if (finger_slot === "fin2") studentUpdate.fin2 = fid;
      if (Object.keys(studentUpdate).length > 0) {
        await supabase.from("students").update(studentUpdate).eq("id", student_id);
      }
    } else if (command === "delete") {
      // Deletion succeeded — clear the sensor slot
      const studentUpdate: Record<string, null> = {};
      if (finger_slot === "fin1") studentUpdate.fin1 = null;
      else if (finger_slot === "fin2") studentUpdate.fin2 = null;
      if (Object.keys(studentUpdate).length > 0) {
        await supabase.from("students").update(studentUpdate).eq("id", student_id);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
