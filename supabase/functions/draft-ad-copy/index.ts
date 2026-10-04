import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Powers the Shop tab's "Draft with AI" button. Drafts primary text/headline/
// description from the product's OWN data only (name, description, benefits,
// price) -- never invents claims -- and always comes back for the person to
// review and edit before saving; this never writes to the product itself.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: "Not signed in" }, 401);

  const { data: profile } = await supabase.from("profiles").select("company_id, role").eq("id", user.id).maybeSingle();
  if (!profile?.company_id) return json({ error: "No company on this account yet" }, 400);
  if (!["owner", "admin", "buyer"].includes(profile.role)) return json({ error: "Not allowed for this role" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const productId = (body?.product_id || "").toString();
  if (!productId) return json({ error: "product_id is required" }, 400);

  const { data: product } = await supabase
    .from("products")
    .select("product_name, description, benefits, default_order_value_naira, currency")
    .eq("id", productId)
    .eq("company_id", profile.company_id)
    .maybeSingle();
  if (!product) return json({ error: "Product not found" }, 404);

  if (!OPENAI_API_KEY) return json({ error: "AI drafting isn't switched on yet -- an admin needs to add an OPENAI_API_KEY in Supabase secrets." }, 400);

  const priceStr = product.default_order_value_naira
    ? `${product.currency === "NGN" || !product.currency ? "₦" : product.currency + " "}${Number(product.default_order_value_naira).toLocaleString()}`
    : "unknown";

  const prompt = `Product name: ${product.product_name}
Price: ${priceStr}
Description: ${product.description || "(none given)"}
Benefits/claims: ${product.benefits || "(none given)"}

Write Meta ad copy for this product. Rules:
- Use ONLY the facts given above -- never invent a benefit, claim, or statistic that isn't already there.
- primary_text: 1-3 short sentences, direct, no hype words like "miracle" or "guaranteed".
- headline: under 40 characters, punchy.
- description: under 30 characters, a short secondary line (can be blank "" if nothing useful to add).
Return ONLY JSON: {"primary_text": "...", "headline": "...", "description": "..."}`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o", // this OpenAI project's key only has access to gpt-4o/gpt-3.5-turbo, see ai-chat's own note
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
    });
    const out = await r.json();
    if (!r.ok) return json({ error: out?.error?.message || "AI request failed" }, 502);
    const content = out?.choices?.[0]?.message?.content;
    if (!content) return json({ error: "AI returned no draft" }, 502);
    const draft = JSON.parse(content);
    return json({
      primary_text: (draft.primary_text || "").toString().trim(),
      headline: (draft.headline || "").toString().trim(),
      description: (draft.description || "").toString().trim(),
    });
  } catch (e) {
    return json({ error: "AI request failed: " + (e as Error).message }, 502);
  }
});
