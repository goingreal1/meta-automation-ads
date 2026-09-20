import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public endpoint (deployed with --no-verify-jwt) -- called directly from a
// product's sales page (no logged-in Supabase session exists there) to
// capture a lead before they'd otherwise bounce: name/phone/address/city/
// state + which package, shown as a small on-page modal instead of sending
// them into the full CRM order form. Insert-only from here; the dashboard
// (or Supabase's own table editor) is where these get reviewed and turned
// into real orders.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const productName = (body?.product_name as string | undefined)?.trim();
    const name = (body?.name as string | undefined)?.trim();
    const phone = (body?.phone as string | undefined)?.trim();
    const address = (body?.address as string | undefined)?.trim();
    const city = (body?.city as string | undefined)?.trim();
    const state = (body?.state as string | undefined)?.trim();
    const pkg = (body?.package as string | undefined)?.trim();
    const sourceUrl = (body?.source_url as string | undefined)?.trim() || null;

    if (!productName || !name || !phone || !address || !city || !state || !pkg) {
      return json({ error: "name, phone, address, city, state, package and product_name are all required." }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.from("website_leads").insert({
      product_name: productName,
      name,
      phone,
      address,
      city,
      state,
      package: pkg,
      source_url: sourceUrl,
    });

    if (error) {
      console.error("website_leads insert failed:", error);
      return json({ error: "Could not save your details. Please try again." }, 500);
    }

    return json({ success: true });
  } catch (err: any) {
    console.error("submit-website-lead error:", err);
    return json({ error: err.message }, 500);
  }
});
