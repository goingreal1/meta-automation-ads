import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const BM = Deno.env.get("META_BUSINESS_ID") ?? "";
const G = "https://graph.facebook.com/v21.0";
const json = (o, status = 200)=>new Response(JSON.stringify(o), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
const get = async (path)=>(await fetch(`${G}/${path}${path.includes("?") ? "&" : "?"}access_token=${TOKEN}`)).json().catch(()=>({}));
async function allIds(path) {
  const ids = new Set();
  let next = `${G}/${path}${path.includes("?") ? "&" : "?"}fields=id&limit=200&access_token=${TOKEN}`;
  for(let i = 0; next && i < 10; i++){
    const j = await fetch(next).then((r)=>r.json()).catch(()=>({}));
    for (const x of j?.data ?? [])ids.add(String(x.id));
    next = j?.paging?.next ?? null;
  }
  return ids;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey"
    }
  });
  try {
    if (!TOKEN) return json({
      error: "Meta isn't connected."
    }, 500);
    const { data: u } = await db.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({
      error: "Not signed in"
    }, 401);
    const { data: me } = await db.from("profiles").select("company_id, role").eq("id", u.user.id).maybeSingle();
    if (!me?.company_id || ![
      "owner",
      "admin",
      "buyer"
    ].includes(me.role)) return json({
      error: "Not allowed."
    }, 403);
    const body = await req.json().catch(()=>({}));
    const pageId = String(body.page_id ?? "").replace(/\D/g, "");
    if (pageId.length < 8) return json({
      error: "That doesn't look like a Page ID. It's a long number, found in the Page's About section."
    }, 400);
    // Check only (the Add a Page screen): is the Page shared with Revora's Business? Nothing is saved until it is linked to an ad account.
    if (body.check_only === true) {
      const shared = BM ? await allIds(`${BM}/client_pages`) : new Set();
      const page = await get(`${pageId}?fields=name`);
      if (shared.has(pageId)) return json({ status: "shared", page_id: pageId, page_name: page?.name ?? null });
      return json({ status: "not_shared", business_id: BM || null, error: `Share that Page with Revora first (Business Settings, Pages, Add partner${BM ? ", Business ID " + BM : ""}), then check again.` });
    }
    const { data: acc } = await db.from("ad_accounts").select("id, company_id, meta_ad_account_id, fb_page_id").eq("id", String(body.ad_account_id ?? "")).maybeSingle();
    if (!acc || acc.company_id !== me.company_id) return json({
      error: "Unknown ad account."
    }, 404);
    if (body.unlink === true) {
      if (String(acc.fb_page_id ?? "") === pageId) await db.from("ad_accounts").update({ fb_page_id: null, fb_page_name: null }).eq("id", acc.id);
      return json({ status: "unlinked" });
    }
    const { data: taken } = await db.from("ad_accounts").select("id").eq("fb_page_id", pageId).neq("company_id", me.company_id).limit(1);
    if (taken?.length) return json({
      status: "taken",
      error: "That Page is already linked to another Revora company. If it's yours, contact support."
    }, 409);
    const act = String(acc.meta_ad_account_id).replace(/\D/g, "");
    const usable = await allIds(`act_${act}/promote_pages`);
    if (!usable.has(pageId)) {
      const shared = BM ? await allIds(`${BM}/client_pages`) : new Set();
      if (shared.has(pageId)) {
        // Revora can see the Page, but Meta says this ad account itself cannot advertise as it: say whose ad account it is, so the right Business gets the access.
        let who = "";
        try {
          const ab = await get(`act_${act}?fields=business{id,name},owner`);
          const bz = ab?.business ?? null;
          who = bz?.id ? ` This ad account belongs to the Business "${bz.name ?? bz.id}" (ID ${bz.id}).` : "";
        } catch (_) { /* the plain message still helps */ }
        return json({
          status: "not_usable",
          business_id: BM || null,
          error: `Revora can see that Page, but Meta does not let this ad account advertise as it.${who} In Meta Business Settings, open Pages, pick the Page, tap Add partner and add the Business that owns this ad account with permission to create ads. Then try again.`
        });
      }
      return json({
        status: "not_shared",
        business_id: BM || null,
        error: `Share that Page with Revora first (Business Settings → Pages → Add partner${BM ? ", Business ID " + BM : ""}), then try again.`
      });
    }
    const page = await get(`${pageId}?fields=name,whatsapp_number`);
    const { error } = await db.from("ad_accounts").update({
      fb_page_id: pageId,
      fb_page_name: page?.name ?? null,
      whatsapp_number: page?.whatsapp_number ?? null,
      connection_verified_at: new Date().toISOString()
    }).eq("id", acc.id);
    if (error) return json({
      error: error.message
    }, 500);
    return json({
      status: "linked",
      page_id: pageId,
      page_name: page?.name ?? null
    });
  } catch (e) {
    return json({
      error: e.message
    }, 500);
  }
});
