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

  // Bootstrap auth (Correction 3). This secret is baked into firmware at
  // compile time and used ONLY for /register and /assignment-poll — the two
  // endpoints a device can reach before it has been assigned an institution.
  // After assignment the device switches to its per-institution device_secret.
  if (
    req.headers.get("x-bootstrap-secret") !== Deno.env.get("BOOTSTRAP_SECRET")
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { mac } = await req.json();
  if (!mac) {
    return new Response(JSON.stringify({ error: "Missing mac" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Idempotent: return the existing record if this MAC has registered before.
  const { data: existing } = await supabase
    .from("devices")
    .select("id, institution_id")
    .eq("mac", mac)
    .maybeSingle();

  if (existing) {
    return new Response(
      JSON.stringify({
        device_id: existing.id,
        status: existing.institution_id ? "assigned" : "pending",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // New device: insert with only mac. institution_id, group_name, and
  // unit_name are all nullable (Migration J) so this succeeds without them.
  // The admin assigns the device from the dashboard (Phase 4), which fills
  // in the remaining fields and triggers the device to flush its queue.
  const { data: device, error } = await supabase
    .from("devices")
    .insert({ mac })
    .select("id")
    .single();

  if (error || !device) {
    return new Response(
      JSON.stringify({ error: "Failed to register device" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ device_id: device.id, status: "pending" }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
});
