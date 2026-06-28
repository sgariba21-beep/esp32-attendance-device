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

function genSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
      .select("id, institution_id, display_name, provisioning_token, device_secret")
      .eq("id", device_id)
      .single();

    if (deviceError || !device) {
      return json({ error: "Device not found" }, 404);
    }

    // Not yet assigned by an admin.
    if (!device.institution_id) {
      return json({ status: "pending" });
    }

    // H7: the device secret is released ONLY to a caller that proves it is this
    // device by presenting the provisioning token issued at /register.
    if (!device.provisioning_token || provisioning_token !== device.provisioning_token) {
      return json({ error: "Unauthorized" }, 401);
    }

    // T1e: mint a per-device secret if this device doesn't have one yet.
    // This happens on first assignment-poll after T1 migration or first assignment.
    let deviceSecret = device.device_secret as string | null;
    if (!deviceSecret) {
      deviceSecret = genSecret();
      const { error: updateErr } = await supabase
        .from("devices")
        .update({ device_secret: deviceSecret })
        .eq("id", device.id);
      if (updateErr) {
        return json({ error: "Failed to mint device secret" }, 500);
      }
    }

    return json({
      status: "assigned",
      institution_id: device.institution_id,
      // T1e: return the per-device secret (not the institution-wide secret).
      // The firmware stores this and sends it as x-device-secret on every
      // authenticated request (log-attendance, get-enrollment-job, update-enrollment-job).
      device_secret: deviceSecret,
      display_name: device.display_name,
    });
  } catch (e) {
    return json({ error: `Internal error: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
