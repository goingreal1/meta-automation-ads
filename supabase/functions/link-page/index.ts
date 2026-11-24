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
    // "Link anyway": the person knows the Page is already in their Business, so save it without Meta's advertise check (ads will report it if Meta still refuses).
    if (body.force === true) {
      let fp: any = null;
      const { data: fc } = await db.from("ad_accounts").select("meta_connection_id").eq("company_id", me.company_id).not("meta_connection_id", "is", null);
      const ftoks: string[] = [];
      for (const cid of [...new Set([acc.meta_connection_id, ...(fc ?? []).map((x)=>x.meta_connection_id)].filter(Boolean))].slice(0, 4)) { const { data: c } = await db.from("meta_connections").select("access_token, status").eq("id", cid).maybeSingle(); if (c?.status === "active" && c.access_token) ftoks.push(c.access_token); }
      ftoks.push(TOKEN);
      for (const t of ftoks) { fp = await get(`${pageId}?fields=name,whatsapp_number`, t); if (fp?.name) break; }
      const { error: fe } = await db.from("ad_accounts").update({ fb_page_id: pageId, fb_page_name: fp?.name ?? (String(body.page_name ?? "").slice(0, 120) || null), whatsapp_number: fp?.whatsapp_number ?? null, connection_verified_at: new Date().toISOString() }).eq("id", acc.id);
      if (fe) return json({ error: fe.message }, 500);
      return json({ status: "linked", page_id: pageId, page_name: fp?.name ?? null, forced: true });
    }
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
    // Everything sits in Revora's own Business: let Revora's access give itself the right on this Page (advertise, create content), then check again.
    let assignNote = "", sysName = "";
    if (!usable) {
      try {
        const meu = await get("me?fields=id,name");
        sysName = String(meu?.name ?? "");
        if (meu?.id) {
          const rr = await fetch(`${G}/${pageId}/assigned_users`, { method: "POST", body: new URLSearchParams({ user: String(meu.id), tasks: JSON.stringify(["ADVERTISE", "CREATE_CONTENT", "MODERATE", "MESSAGING", "ANALYZE"]), access_token: TOKEN }) });
          const jj = await rr.json().catch(()=>({}));
          if (jj?.error) assignNote = String(jj.error.error_user_msg || jj.error.message || "").slice(0, 200);
          else {
            await new Promise((res)=>setTimeout(res, 1500));
            if ((await allIds(`act_${act}/promote_pages`)).has(pageId)) { usable = true; via = "Revora's access (assigned just now)"; }
          }
        }
      } catch (e) { assignNote = String((e as Error).message ?? e).slice(0, 200); }
    }
    if (!usable) {
      let canUse = "";
      try { const l = await get(`act_${act}/promote_pages?fields=id,name&limit=12`); canUse = (l?.data ?? []).map((x: any)=>x.name ?? x.id).join(", "); } catch (_) { /* optional */ }
      const diag = ` Revora's access${sysName ? ` ("${sysName}")` : ""} can advertise on this ad account as: ${canUse || "no Page at all"}.${assignNote ? ` Meta said when Revora tried to give itself the right on this Page: ${assignNote}` : ""}`;
      const shared = BM ? new Set([...(await allIds(`${BM}/client_pages`)), ...(await allIds(`${BM}/owned_pages`))]) : new Set();
      const who = acBiz?.id ? ` The ad account belongs to the Business "${acBiz.name ?? acBiz.id}" (ID ${acBiz.id})${pgBiz?.id ? ", the Page to \"" + (pgBiz.name ?? pgBiz.id) + "\" (ID " + pgBiz.id + ")" : ", and Meta did not say which Business owns the Page"}.` : "";
      if (shared.has(pageId) || pgBiz?.id) return json({
        status: "not_usable",
        business_id: BM || null,
        error: `Meta does not let this ad account advertise as that Page yet.${diag}${who} In Meta Business Settings, open Users, System users, pick the one Revora uses, and under Add assets give it the Page with permission to create ads. Then try again.`
      });
      return json({
        status: "not_shared",
        business_id: BM || null,
        error: `Revora cannot see that Page.${diag} Share it with Revora first (Business Settings \u2192 Pages \u2192 Add partner${BM ? ", Business ID " + BM : ""}), then try again.`
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
