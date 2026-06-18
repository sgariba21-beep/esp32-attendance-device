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
  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Bootstrap auth — same secret as /register.
    if (req.headers.get("x-bootstrap-secret") !== Deno.env.get("BOOTSTRAP_SECRET")) {
      return json({ error: "Unauthorized" }, 401);
    }

    let parsed: { device_id?: string; provisioning_token?: string };
    try {
      parsed = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { device_id, provisioning_token } = parsed;
    if (!device_id) {
      return json({ error: "Missing device_id" }, 400);
    }

    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, institution_id, display_name, provisioning_token")
      .eq("id", device_id)
      .single();

    if (deviceError || !device) {
      return json({ error: "Device not found" }, 404);
    }

    // Not yet assigned by an admin.
    if (!device.institution_id) {
      return json({ status: "pending" });
    }

    // H7: the institution device_secret is released ONLY to a caller that proves
    // it is this device by presenting the provisioning token issued at /register.
    // Knowing the (UUID) device_id is no longer sufficient on its own.
    if (!device.provisioning_token || provisioning_token !== device.provisioning_token) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: institution, error: instError } = await supabase
      .from("institutions")
      .select("device_secret")
      .eq("id", device.institution_id)
      .single();

    if (instError || !institution) {
      return json({ error: "Institution not found" }, 500);
    }

    return json({
      status: "assigned",
      institution_id: device.institution_id,
      device_secret: institution.device_secret,
      display_name: device.display_name,
    });
  } catch (e) {
    return json({ error: `Internal error: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
