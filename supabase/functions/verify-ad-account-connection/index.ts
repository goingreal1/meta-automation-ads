import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Confirms a Facebook Page and a Meta Pixel are actually reachable from a
// given ad account -- instead of trusting whatever ID someone typed into the
// Settings form. Two Meta endpoints exist specifically for this:
//   /act_{id}/promote_pages -- Pages this ad account is permitted to run ads
//     as (what object_story_spec.page_id needs to be one of).
//   /act_{id}/adspixels -- Pixels/Datasets owned by or shared with this ad
//     account (what the Sales-objective promoted_object.pixel_id needs to be
//     one of).
// A page or pixel ID saved in ad_accounts that isn't in these lists will
// fail at actual launch time with an opaque Meta error -- this lets the
// dashboard catch that before launch, by only offering Meta-confirmed values
// to pick from, instead of a free-text field.
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!META_ACCESS_TOKEN) return json({ error: "META_ACCESS_TOKEN secret is not set yet in Supabase." }, 500);

  try {
    const body = await req.json().catch(() => ({}));
    if (!body.ad_account_id) return json({ error: "Missing ad_account_id in request body." }, 400);

    const { data: accountRow } = await supabase.from("ad_accounts").select("*").eq("id", body.ad_account_id).maybeSingle();
    if (!accountRow) return json({ error: `No ad_accounts row found for id ${body.ad_account_id}` }, 404);

    const metaAdAccountId = String(accountRow.meta_ad_account_id).replace(/^act_/, "");

    const [pagesRes, pixelsRes] = await Promise.all([
      fetch(`${META_GRAPH_BASE}/act_${metaAdAccountId}/promote_pages?fields=id,name&access_token=${META_ACCESS_TOKEN}`).then(r => r.json()),
      fetch(`${META_GRAPH_BASE}/act_${metaAdAccountId}/adspixels?fields=id,name&access_token=${META_ACCESS_TOKEN}`).then(r => r.json()),
    ]);

    if (pagesRes.error) return json({ error: `Couldn't reach this ad account's pages: ${pagesRes.error.message}`, code: pagesRes.error.code }, 400);
    if (pixelsRes.error) return json({ error: `Couldn't reach this ad account's pixels: ${pixelsRes.error.message}`, code: pixelsRes.error.code }, 400);

    const pages = (pagesRes.data || []).map((p: any) => ({ id: p.id, name: p.name }));
    const pixels = (pixelsRes.data || []).map((p: any) => ({ id: p.id, name: p.name }));

    return json({
      success: true,
      pages,
      pixels,
      current_fb_page_id: accountRow.fb_page_id || null,
      current_pixel_id: accountRow.meta_pixel_id || null,
      page_connected: accountRow.fb_page_id ? pages.some((p: any) => p.id === accountRow.fb_page_id) : null,
      pixel_connected: accountRow.meta_pixel_id ? pixels.some((p: any) => p.id === accountRow.meta_pixel_id) : null,
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
