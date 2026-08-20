// Temporary — logs whatever payload Elementor's Webhook action sends, so we can see
// its real shape before building the final parser. Safe to delete once that's confirmed.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST" } });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let body: unknown;
  try {
    body = contentType.includes("application/json") ? await req.json() : Object.fromEntries((await req.formData()).entries());
  } catch {
    body = await req.text();
  }

  console.log("=== ELEMENTOR WEBHOOK PAYLOAD ===", JSON.stringify(body, null, 2));

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  await supabase.from("webhook_debug_log").insert({ payload: body, content_type: contentType }).select().maybeSingle().catch(() => {});

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
});
