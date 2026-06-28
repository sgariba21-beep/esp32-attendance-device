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

  let parsed: { device_id?: string };
  try {
    parsed = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { device_id } = parsed;
  if (!device_id) {
    return json({ error: "Missing device_id" }, 400);
  }

  // T11: check for a pending decommission signal BEFORE looking up the device row.
  // The device_resets record is keyed by device_id and has no FK constraint,
  // so it survives the deletion of the devices row.
  //
  // T11 change from prior behaviour: do NOT delete the row on read. Return
  // decommissioned:true while the row exists; clear it only when the device
  // re-registers with a fresh identity. This removes the "one-shot signal"
  // vulnerability where an attacker who knows a device UUID consumes the signal
  // before the real device polls. Server-side revocation (devices.revoked, T1e)
  // is the authoritative cut-off; the wipe is cosmetic cleanup.
  const { data: resetRecord } = await supabase
    .from("device_resets")
    .select("device_id")
    .eq("device_id", device_id)
    .maybeSingle();

  if (resetRecord) {
    // Do NOT delete the row here (T11). The device will wipe and re-register;
    // /register clears the reset row when a fresh MAC comes in for this device_id.
    return json({ decommissioned: true });
  }

  // T1e: authenticate against the per-device secret (not the institution secret).
  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id, institution_id, display_name, device_secret, revoked")
    .eq("id", device_id)
    .single();

  if (deviceError || !device) {
    return json({ error: "Device not found" }, 404);
  }

  if (!device.device_secret || req.headers.get("x-device-secret") !== device.device_secret) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (device.revoked) {
    return json({ error: "Device revoked" }, 403);
  }

  // Fetch oldest pending job for this device, scoped to institution.
  const { data: job, error } = await supabase
    .from("enrollment_jobs")
    .select(`
      id, command, fid, finger_slot, note,
      member:student_id(id, sid, fullname)
    `)
    .eq("device_id", device.id)
    .eq("institution_id", device.institution_id)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return json({ error: error.message }, 500);
  }

  if (!job) {
    return json({ job: null });
  }

  await supabase
    .from("enrollment_jobs")
    .update({ status: "in_progress" })
    .eq("id", job.id);

  const member = job.member as { id: string; sid: string; fullname: string } | null;
  const isMaster = job.command === "register-master";

  return json({
    job: {
      id: job.id,
      command: job.command,
      fid: job.fid ?? 0,
      finger_slot: job.finger_slot ?? "",
      student_id: member?.id ?? "",
      sid: member?.sid ?? "",
      fullname: isMaster ? (job.note ?? "Master") : (member?.fullname ?? ""),
      unit_name: device.display_name ?? "",
    },
  });
});
