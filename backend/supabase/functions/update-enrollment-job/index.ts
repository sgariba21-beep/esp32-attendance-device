import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let parsed: {
    id?: string;
    device_id?: string;
    institution_id?: string;
    status?: string;
    fid?: number;
    note?: string;
    finger_slot?: string;
    member_id?: string;
    student_id?: string;
  };
  try {
    parsed = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { id, device_id, institution_id: bodyInstitutionId, status, fid, note, finger_slot } = parsed;
  // member_id is the current key; accept student_id from firmware older than 1.10.0.
  const member_id = parsed.member_id ?? parsed.student_id;

  if (!id || !status) {
    return json({ error: "Missing required fields" }, 400);
  }

  // T1e: authenticate against the per-device secret (not the institution secret).
  // The firmware now sends device_id in the update-enrollment-job payload.
  if (!device_id) {
    return json({ error: "Missing device_id" }, 400);
  }

  const { data: device, error: devErr } = await supabase
    .from("devices")
    .select("id, institution_id, device_secret, revoked")
    .eq("id", device_id)
    .single();

  if (devErr || !device) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!device.device_secret || req.headers.get("x-device-secret") !== device.device_secret) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (device.revoked) {
    return json({ error: "Device revoked" }, 403);
  }

  // Derive institution_id from the authenticated device row (ignore body value).
  const institution_id = device.institution_id;
  if (!institution_id) {
    return json({ error: "Device not assigned to an institution" }, 403);
  }

  // Fetch the job scoped to institution to know its command.
  const { data: job } = await supabase
    .from("enrollment_jobs")
    .select("command, device_id, status")
    .eq("id", id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  // A "clear all" wiped the sensor and the device's fid map, so none of this
  // device's members has a finger on it any more: free their slots, except any
  // re-enrolled after the wipe (this report may arrive late — see
  // 20261005120000). Done BEFORE the job is marked completed, so if it fails
  // the 500 makes the device retry with the job still open; a duplicate report
  // for an already-completed job is skipped.
  if (status === "completed" && job?.command === "clearall" &&
      job.device_id === device.id && job.status !== "completed") {
    const { error: resetError } = await supabase.rpc("reset_slots_after_clearall", { p_job_id: id });
    if (resetError) {
      return json({ error: `Slot reset failed: ${resetError.message}` }, 500);
    }
  }

  const jobUpdate: Record<string, unknown> = { status };
  if (note) jobUpdate.note = note;
  if (fid && fid > 0) jobUpdate.fid = fid;
  // Keep last_error meaningful for the dashboard's stuck/failed view: set it
  // from the device's failure note, clear it once the job completes. The DB
  // status guard (20260902120000) ignores this write entirely if the job is
  // already terminal, so a duplicate report can't churn it.
  if (status === "failed") jobUpdate.last_error = note ?? "device reported failure";
  if (status === "completed") jobUpdate.last_error = null;

  const { error: jobError } = await supabase
    .from("enrollment_jobs")
    .update(jobUpdate)
    .eq("id", id)
    .eq("institution_id", institution_id);

  if (jobError) {
    return json({ error: jobError.message }, 500);
  }

  // T4: scope the members update to institution_id so a device can never write
  // a foreign tenant's member record, even if it somehow has a valid job id.
  if (status === "completed" && member_id && finger_slot) {
    const command = job?.command;

    if (command === "register" && fid && fid > 0) {
      const memberUpdate: Record<string, number> = {};
      if (finger_slot === "fin1") memberUpdate.fin1 = fid;
      else if (finger_slot === "fin2") memberUpdate.fin2 = fid;
      if (Object.keys(memberUpdate).length > 0) {
        await supabase
          .from("members")
          .update(memberUpdate)
          .eq("id", member_id)
          .eq("institution_id", institution_id); // T4: tenant-scoped write
      }
    } else if (command === "delete") {
      const memberUpdate: Record<string, number> = {};
      if (finger_slot === "fin1") memberUpdate.fin1 = 0;
      else if (finger_slot === "fin2") memberUpdate.fin2 = 0;
      if (Object.keys(memberUpdate).length > 0) {
        await supabase
          .from("members")
          .update(memberUpdate)
          .eq("id", member_id)
          .eq("institution_id", institution_id); // T4: tenant-scoped write
      }
    }
  }

  // A delete the device couldn't carry out because it has no finger for this
  // member at all ("not-found" — e.g. after a clear all, or a lost register)
  // still leaves the finger not enrolled: free the slot so the dashboard
  // agrees with the device instead of showing a finger nobody can remove.
  if (status === "failed" && note === "not-found" && member_id && finger_slot &&
      job?.command === "delete" && job.device_id === device.id) {
    const memberUpdate: Record<string, number> = {};
    if (finger_slot === "fin1") memberUpdate.fin1 = 0;
    else if (finger_slot === "fin2") memberUpdate.fin2 = 0;
    if (Object.keys(memberUpdate).length > 0) {
      await supabase
        .from("members")
        .update(memberUpdate)
        .eq("id", member_id)
        .eq("institution_id", institution_id) // T4: tenant-scoped write
        .eq("device_id", device.id);          // only this device's finger is known absent
    }
  }

  return json({ ok: true });
});
