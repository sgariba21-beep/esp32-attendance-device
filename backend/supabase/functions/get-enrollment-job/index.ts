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

  const { class_name } = await req.json();
  if (!class_name) {
    return new Response(JSON.stringify({ error: "Missing class_name" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve device UUID from class name (stored as "form class", e.g. "Form 1 A")
  const { data: devices, error: deviceError } = await supabase
    .from("devices")
    .select("id, form, class");

  if (deviceError) {
    return new Response(JSON.stringify({ error: "Failed to look up device" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const device = devices?.find((d) => `${d.form} ${d["class"]}` === class_name);
  if (!device) {
    return new Response(JSON.stringify({ error: `Device not found: ${class_name}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fetch oldest pending job for this device
  const { data: job, error } = await supabase
    .from("enrollment_jobs")
    .select(`
      id, command, fid, finger_slot,
      student:student_id(id, sid, fullname)
    `)
    .eq("device_id", device.id)
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

  // Mark as in_progress atomically before returning
  await supabase
    .from("enrollment_jobs")
    .update({ status: "in_progress" })
    .eq("id", job.id);

  const student = job.student as { id: string; sid: string; fullname: string } | null;

  return new Response(
    JSON.stringify({
      job: {
        id: job.id,
        command: job.command,
        fid: job.fid ?? 0,
        finger_slot: job.finger_slot ?? "",
        student_id: student?.id ?? "",
        sid: student?.sid ?? "",
        fullname: student?.fullname ?? "",
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
