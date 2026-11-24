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
const get = async (path, tok = TOKEN)=>(await fetch(`${G}/${path}${path.includes("?") ? "&" : "?"}access_token=${tok}`)).json().catch(()=>({}));
async function allIds(path, tok = TOKEN) {
  const ids = new Set();
  let next = `${G}/${path}${path.includes("?") ? "&" : "?"}fields=id&limit=200&access_token=${tok}`;
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
      // Or the person's own Meta login can already see the Page (their Business owns it).
      const { data: cAccts } = await db.from("ad_accounts").select("meta_connection_id").eq("company_id", me.company_id).not("meta_connection_id", "is", null);
      for (const cid of [...new Set((cAccts ?? []).map((x)=>x.meta_connection_id).filter(Boolean))].slice(0, 4)) {
        const { data: c } = await db.from("meta_connections").select("access_token, status").eq("id", cid).maybeSingle();
        if (c?.status === "active" && c.access_token) { const pg = await get(`${pageId}?fields=name`, c.access_token); if (pg?.name) return json({ status: "shared", page_id: pageId, page_name: pg.name }); }
      }
      return json({ status: "not_shared", business_id: BM || null, error: `Share that Page with Revora first (Business Settings, Pages, Add partner${BM ? ", Business ID " + BM : ""}), then check again.` });
    }
    const { data: acc } = await db.from("ad_accounts").select("id, company_id, meta_ad_account_id, fb_page_id, meta_connection_id").eq("id", String(body.ad_account_id ?? "")).maybeSingle();
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
    // The person's own Meta login (the one their ad accounts and Pages live under) sees what Revora's shared access may not.
    const { data: conAccts } = await db.from("ad_accounts").select("meta_connection_id").eq("company_id", me.company_id).not("meta_connection_id", "is", null);
    const conIds = [...new Set([acc.meta_connection_id, ...(conAccts ?? []).map((x)=>x.meta_connection_id)].filter(Boolean))].slice(0, 4);
    const toks: string[] = [];
    for (const cid of conIds) { const { data: c } = await db.from("meta_connections").select("access_token, status").eq("id", cid).maybeSingle(); if (c?.status === "active" && c.access_token) toks.push(c.access_token); }
    toks.push(TOKEN);
    let usable = false, via = "";
    for (const t of toks) { if ((await allIds(`act_${act}/promote_pages`, t)).has(pageId)) { usable = true; via = t === TOKEN ? "Revora" : "your Meta login"; break; } }
    // Same Business owns the ad account and the Page: Meta lets that ad account advertise as the Page.
    let acBiz: any = null, pgBiz: any = null;
    if (!usable) {
      for (const t of toks) {
        if (!acBiz) { const ab = await get(`act_${act}?fields=business{id,name}`, t); acBiz = ab?.business ?? null; }
        if (!pgBiz) { const pb = await get(`${pageId}?fields=business{id,name}`, t); pgBiz = pb?.business ?? null; }
        if (acBiz && pgBiz) break;
      }
      if (acBiz?.id && pgBiz?.id && String(acBiz.id) === String(pgBiz.id)) { usable = true; via = "the Business that owns both"; }
    }
    if (!usable) {
      const shared = BM ? await allIds(`${BM}/client_pages`) : new Set();
      const who = acBiz?.id ? ` The ad account belongs to the Business "${acBiz.name ?? acBiz.id}" (ID ${acBiz.id})${pgBiz?.id ? ", the Page to \"" + (pgBiz.name ?? pgBiz.id) + "\" (ID " + pgBiz.id + ")" : ", and Meta did not say which Business owns the Page"}.` : "";
      if (shared.has(pageId) || pgBiz?.id) return json({
        status: "not_usable",
        business_id: BM || null,
        error: `Meta does not let this ad account advertise as that Page yet.${who} In Meta Business Settings, open Pages, pick the Page and make sure this ad account's Business has permission to create ads on it. Then try again.`
      });
      return json({
        status: "not_shared",
        business_id: BM || null,
        error: `Share that Page with Revora first (Business Settings \u2192 Pages \u2192 Add partner${BM ? ", Business ID " + BM : ""}), then try again.`
      });
    }
    let page: any = null;
    for (const t of toks) { page = await get(`${pageId}?fields=name,whatsapp_number`, t); if (page?.name) break; }
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
