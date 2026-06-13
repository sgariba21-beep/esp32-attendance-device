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

  // Device now identifies by its assigned device_id (from SPIFFS after
  // assignment), not the old form+class string concatenation.
  const { device_id } = await req.json();
  if (!device_id) {
    return new Response(JSON.stringify({ error: "Missing device_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id, institution_id, display_name")
    .eq("id", device_id)
    .single();

  if (deviceError || !device) {
    return new Response(JSON.stringify({ error: "Device not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate per-institution secret.
  const { data: institution, error: instError } = await supabase
    .from("institutions")
    .select("device_secret")
    .eq("id", device.institution_id)
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!job) {
    return new Response(JSON.stringify({ job: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  await supabase
    .from("enrollment_jobs")
    .update({ status: "in_progress" })
    .eq("id", job.id);

  const member = job.member as { id: string; sid: string; fullname: string } | null;
  const isMaster = job.command === "register-master";

  return new Response(
    JSON.stringify({
      job: {
        id: job.id,
        command: job.command,
        fid: job.fid ?? 0,
        finger_slot: job.finger_slot ?? "",
        student_id: member?.id ?? "",
        sid: member?.sid ?? "",
        fullname: isMaster ? (job.note ?? "Master") : (member?.fullname ?? ""),
        // class_name renamed to unit_name; populated from the stored generated
        // display_name column (group_name — unit_name).
        unit_name: device.display_name ?? "",
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
