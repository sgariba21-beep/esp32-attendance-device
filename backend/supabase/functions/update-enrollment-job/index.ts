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

  const { id, institution_id, status, fid, note, finger_slot, student_id } =
    await req.json();

  if (!id || !institution_id || !status) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate per-institution secret.
  const { data: institution, error: instError } = await supabase
    .from("institutions")
    .select("device_secret")
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

  // Fetch the job to know its command, scoped to institution.
  const { data: job } = await supabase
    .from("enrollment_jobs")
    .select("command")
    .eq("id", id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  const jobUpdate: Record<string, unknown> = { status };
  if (note) jobUpdate.note = note;
  if (fid && fid > 0) jobUpdate.fid = fid;

  const { error: jobError } = await supabase
    .from("enrollment_jobs")
    .update(jobUpdate)
    .eq("id", id)
    .eq("institution_id", institution_id);

  if (jobError) {
    return new Response(JSON.stringify({ error: jobError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Sync member finger slot on completion (fin1/fin2 column names unchanged).
  if (status === "completed" && student_id && finger_slot) {
    const command = job?.command;

    if (command === "register" && fid && fid > 0) {
      const memberUpdate: Record<string, number> = {};
      if (finger_slot === "fin1") memberUpdate.fin1 = fid;
      else if (finger_slot === "fin2") memberUpdate.fin2 = fid;
      if (Object.keys(memberUpdate).length > 0) {
        await supabase.from("members").update(memberUpdate).eq("id", student_id);
      }
    } else if (command === "delete") {
      const memberUpdate: Record<string, number> = {};
      if (finger_slot === "fin1") memberUpdate.fin1 = 0;
      else if (finger_slot === "fin2") memberUpdate.fin2 = 0;
      if (Object.keys(memberUpdate).length > 0) {
        await supabase.from("members").update(memberUpdate).eq("id", student_id);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
