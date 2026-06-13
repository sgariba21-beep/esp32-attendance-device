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

  // Bootstrap auth — same secret as /register. The device uses this until it
  // receives an assigned response, after which it switches to the per-institution
  // device_secret for all scan and enrollment requests.
  if (
    req.headers.get("x-bootstrap-secret") !== Deno.env.get("BOOTSTRAP_SECRET")
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

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

  // Not yet assigned by an admin.
  if (!device.institution_id) {
    return new Response(
      JSON.stringify({ status: "pending" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Assigned: fetch the institution's device_secret and return the full
  // identity bundle. The device persists this to SPIFFS as device_identity.json
  // and switches to per-institution auth for all subsequent requests.
  const { data: institution, error: instError } = await supabase
    .from("institutions")
    .select("device_secret")
    .eq("id", device.institution_id)
    .single();

  if (instError || !institution) {
    return new Response(JSON.stringify({ error: "Institution not found" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      status: "assigned",
      institution_id: device.institution_id,
      device_secret: institution.device_secret,
      display_name: device.display_name,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
