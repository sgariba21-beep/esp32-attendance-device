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

// H7: a per-device provisioning token, issued at registration and required by
// /assignment-poll before the institution device_secret is released. This binds
// secret retrieval to the specific device that registered, instead of "anyone
// holding the shared bootstrap secret plus a device_id".
function genToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Bootstrap auth. This secret is baked into firmware at compile time and used
    // ONLY for /register and /assignment-poll. KEEP IT OUT OF SOURCE CONTROL and
    // rotate it (it lives in secrets.h on the device, BOOTSTRAP_SECRET in Vault).
    if (req.headers.get("x-bootstrap-secret") !== Deno.env.get("BOOTSTRAP_SECRET")) {
      return json({ error: "Unauthorized" }, 401);
    }

    let parsed: { mac?: string };
    try {
      parsed = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { mac } = parsed;
    if (!mac) {
      return json({ error: "Missing mac" }, 400);
    }

    // Idempotent: return the existing record if this MAC has registered before.
    const { data: existing } = await supabase
      .from("devices")
      .select("id, institution_id, provisioning_token")
      .eq("mac", mac)
      .maybeSingle();

    if (existing) {
      // Already assigned: the device should already hold its identity. We do NOT
      // release the secret or token here — recovery of a wiped-but-assigned device
      // is via the dashboard (delete the device, it re-provisions fresh).
      if (existing.institution_id) {
        return json({ device_id: existing.id, status: "assigned" });
      }
      // Still pending: ensure a token exists (legacy rows may predate this) and
      // return it so the device can poll for assignment.
      let token = existing.provisioning_token as string | null;
      if (!token) {
        token = genToken();
        await supabase.from("devices").update({ provisioning_token: token }).eq("id", existing.id);
      }
      return json({ device_id: existing.id, status: "pending", provisioning_token: token });
    }

    // New device: insert with mac + a fresh provisioning token.
    const token = genToken();
    const { data: device, error } = await supabase
      .from("devices")
      .insert({ mac, provisioning_token: token })
      .select("id")
      .single();

    if (error || !device) {
      return json({ error: "Failed to register device" }, 500);
    }

    return json({ device_id: device.id, status: "pending", provisioning_token: token }, 201);
  } catch (e) {
    return json({ error: `Internal error: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
