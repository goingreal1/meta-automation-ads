import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Generic receiver for Telnyx's SIP connection webhook events (call status,
// hangup cause, cost, etc.). Logs every event verbatim first -- we haven't
// seen Telnyx's real payload shape against this account yet, so this stays
// tolerant/generic rather than assuming field names, and gets refined once
// real events start arriving (check telnyx_webhook_events in the DB).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    payload = { raw: await req.text().catch(() => "") };
  }

  const eventType = payload?.data?.event_type ?? payload?.event_type ?? null;
  console.log("telnyx-webhook event:", eventType, JSON.stringify(payload).slice(0, 2000));

  const { error } = await supabase.from("telnyx_webhook_events").insert({ event_type: eventType, payload });
  if (error) console.error("telnyx-webhook insert error:", error.message);

  // Telnyx expects a fast 200 regardless -- it retries on non-2xx.
  return new Response("ok", { status: 200 });
});
