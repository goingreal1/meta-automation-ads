import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, read-only product lookup for order.html (the generic order form
// every buyer embeds on their own sales page). products/ad_accounts are
// RLS-locked to the signed-in dashboard user, so a customer's browser can't
// read them directly with the anon key -- this is the one narrow, safe slice
// of that data a stranger on the internet is allowed to see: enough to
// render an order form, nothing about the account, spend, or other products.
//
//   GET /get-product-public?id=<product_id>

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "GET") return json({ error: "GET only" }, 405);

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "?id=<product_id> is required" }, 400);

  const [{ data: product, error }, { data: tiers }] = await Promise.all([
    supabase
      .from("products")
      .select(`
        id, product_name, currency, default_order_value_naira, is_active,
        description, benefits, safety_notes, nafdac_reg_no, product_image_url,
        destination_type, whatsapp_number,
        is_service, bank_name, bank_account_number, bank_account_name, payment_note,
        ad_accounts(meta_pixel_id)
      `)
      .eq("id", id)
      .maybeSingle(),
    // Package options (e.g. "1 piece" / "3-piece bundle" / "5-piece bundle"),
    // if the buyer set any up -- order.html shows these as selectable cards
    // instead of a plain quantity stepper when the list isn't empty.
    supabase
      .from("product_tiers")
      .select("id, label, quantity, price_naira, badge, image_url, features, is_default")
      .eq("product_id", id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);

  if (error) return json({ error: "Lookup failed" }, 500);
  if (!product || !product.is_active) return json({ error: "Product not found" }, 404);

  return json({
    id: product.id,
    product_name: product.product_name,
    currency: product.currency || "NGN",
    default_order_value_naira: product.default_order_value_naira,
    description: product.description,
    benefits: product.benefits,
    safety_notes: product.safety_notes,
    nafdac_reg_no: product.nafdac_reg_no,
    product_image_url: product.product_image_url,
    destination_type: product.destination_type,
    whatsapp_number: product.whatsapp_number,
    is_service: !!product.is_service,
    bank_name: product.bank_name,
    bank_account_number: product.bank_account_number,
    bank_account_name: product.bank_account_name,
    payment_note: product.payment_note,
    meta_pixel_id: (product as any).ad_accounts?.meta_pixel_id ?? null,
    tiers: tiers ?? [],
  });
});
