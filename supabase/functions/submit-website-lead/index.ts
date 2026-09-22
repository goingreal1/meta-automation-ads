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

// Package strings are "Label — ₦31,000" -- pull the naira amount out for CAPI's
// event value, same pattern the page itself uses for its own browser-side fbq calls.
function parsePackageValue(pkg: string): number {
  const m = pkg.match(/([\d,]+)/);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : 0;
}

// Server-side mirror of the page's browser fbq('track', ...) calls -- fires
// even if the customer has an ad blocker, and carries real hashed PII (phone/
// name/city/state) for much better Meta match quality than the browser event
// alone gets. eventId must match what the page sends to fbq for the same
// order so Meta dedupes the two into one event instead of double-counting.
async function fireCapiEvents(opts: {
  eventIdBase: string;
  sourceUrl: string | null;
  value: number;
  name: string;
  phone: string;
  city: string;
  state: string;
}) {
  const [firstName, ...rest] = opts.name.split(" ");
  const userData = {
    phone: opts.phone,
    firstName,
    lastName: rest.join(" ") || undefined,
    city: opts.city,
    state: opts.state,
    country: "NG",
  };
  const events = [
    { event_name: "Lead", event_id: `${opts.eventIdBase}_lead` },
    { event_name: "Purchase", event_id: `${opts.eventIdBase}_purchase` },
  ];
  for (const e of events) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/meta-capi`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          event_name: e.event_name,
          event_id: e.event_id,
          event_source_url: opts.sourceUrl,
          action_source: "website",
          user_data: userData,
          custom_data: { value: opts.value, currency: "NGN", content_name: "Lunessa" },
        }),
      });
    } catch (err) {
      console.error(`CAPI ${e.event_name} failed:`, err);
    }
  }
}

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
    // The page generates one id per submit and uses it for its own browser
    // fbq() calls -- passing it through lets Meta dedupe the browser + server
    // copies of the same Lead/Purchase into one event instead of counting twice.
    const eventIdBase = (body?.event_id as string | undefined)?.trim() || `lunessa_${Date.now()}`;

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

    if (!error) {
      await fireCapiEvents({
        eventIdBase,
        sourceUrl,
        value: parsePackageValue(pkg),
        name,
        phone,
        city,
        state,
      });
    }

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
