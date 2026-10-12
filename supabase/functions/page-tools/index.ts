import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Page-level Meta tools for an ad account's Facebook Page: find the Instagram account behind it, and manage Instant (lead) forms.
//   POST { action: "diag" | "detect_ig" | "forms_list" | "forms_create" | "leads", ad_account_id, ... }
//   forms_create: { name, fields?: ["FULL_NAME","PHONE","EMAIL","CITY","STATE"], intro?, privacy_url?, thank_you_url? }  -- idempotent on name
//   leads: { form_id, limit? }
// Auth: the caller's own session (owner/admin/buyer, ad account must be theirs), or the shared cron secret (x-cron-secret) for platform tests.
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const SHARED = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const G = "https://graph.facebook.com/v22.0";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-cron-secret" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function g(path: string, token: string, method = "GET", body?: Record<string, string>) {
  const url = `${G}${path}${method === "GET" ? (path.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(token) : ""}`;
  const r = await fetch(url, method === "GET" ? undefined : { method, body: new URLSearchParams({ ...(body ?? {}), access_token: token }) });
  const j: any = await r.json().catch(() => ({}));
  if (j?.error) throw new Error(j.error.error_user_msg || j.error.message || "Meta refused the request");
  return j;
}

async function pageToken(pageId: string, token: string): Promise<string> {
  try {
    const r = await g(`/${pageId}?fields=access_token`, token);
    if (r?.access_token) return r.access_token;
  } catch { /* fall through to /me/accounts */ }
  const a = await g(`/me/accounts?fields=id,access_token&limit=200`, token);
  const hit = (a?.data ?? []).find((p: any) => String(p.id) === String(pageId));
  if (hit?.access_token) return hit.access_token;
  throw new Error("Revora's Meta login cannot act for this Page yet. Share the Page with Revora's Business in Meta (Page access), then try again.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    const sec = (await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle()).data?.value ?? "";
    const given = req.headers.get("x-cron-secret") ?? "";
    let companyId: string | null = null, role = "", buyerId: string | null = null;
    const isPlatform = !!given && given === sec;
    if (!isPlatform) {
      const { data: u } = await db.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
      if (!u?.user) return json({ error: "Not signed in" }, 401);
      const { data: me } = await db.from("profiles").select("company_id, role, media_buyer_id").eq("id", u.user.id).maybeSingle();
      buyerId = me?.media_buyer_id ?? null;
      if (!me?.company_id || !["owner", "admin", "buyer"].includes(me.role)) return json({ error: "Only owners, admins and media buyers can do this." }, 403);
      companyId = me.company_id; role = me.role;
    }
    let q = db.from("ad_accounts").select("id, company_id, fb_page_id, ig_user_id, meta_connection_id, media_buyer_id").eq("id", String(b.ad_account_id ?? ""));
    if (companyId) q = q.eq("company_id", companyId);
    const { data: acct } = await q.maybeSingle();
    if (!acct) return json({ error: "That ad account was not found or is not yours." }, 404);
    if (role === "buyer" && acct.media_buyer_id !== buyerId) return json({ error: "That ad account was not found or is not yours." }, 404);
    const pageId = String(acct.fb_page_id ?? "").match(/\d+/)?.[0];
    if (!pageId) return json({ error: "This ad account has no Facebook Page saved. Link the Page in Settings first." }, 400);
    let token = SHARED;
    if (acct.meta_connection_id) {
      const { data: conn } = await db.from("meta_connections").select("access_token, status").eq("id", acct.meta_connection_id).maybeSingle();
      if (conn?.status === "active" && conn.access_token) token = conn.access_token;
    }
    const action = String(b.action ?? "");

    if (action === "diag") {
      const out: any = { page_id: pageId, ig_saved: acct.ig_user_id ?? null };
      try { out.page = await g(`/${pageId}?fields=name,link,instagram_business_account{id,username},connected_instagram_account{id,username},can_post`, token); } catch (e) { out.page_error = (e as Error).message; }
      try { const pt = await pageToken(pageId, token); out.page_token = true; try { out.leadgen_tos = (await g(`/${pageId}?fields=leadgen_tos_accepted`, pt)).leadgen_tos_accepted ?? null; } catch (e) { out.leadgen_tos_error = (e as Error).message.slice(0, 160); } } catch (e) { out.page_token = false; out.page_token_error = (e as Error).message; }
      return json({ ok: true, ...out });
    }

    if (action === "detect_ig") {
      const p: any = await g(`/${pageId}?fields=instagram_business_account{id,username},connected_instagram_account{id,username}`, token);
      let ig = p?.instagram_business_account ?? p?.connected_instagram_account ?? null;
      if (!ig) {
        const a: any = await g(`/act_${String(await acctMetaId(acct.id))}/instagram_accounts?fields=id,username&limit=10`, token).catch(() => null);
        ig = a?.data?.[0] ?? null;
      }
      if (!ig?.id) return json({ ok: false, error: "No Instagram account is linked to this Facebook Page yet. In Meta Business Suite, connect the Instagram profile to the Page, then try again." });
      await db.from("ad_accounts").update({ ig_user_id: String(ig.id) }).eq("id", acct.id);
      return json({ ok: true, ig_user_id: String(ig.id), username: ig.username ?? null });
    }

    if (action === "forms_list") {
      const pt = await pageToken(pageId, token);
      const r: any = await g(`/${pageId}/leadgen_forms?fields=id,name,status,leads_count,created_time&limit=50`, pt);
      return json({ ok: true, forms: r?.data ?? [] });
    }

    if (action === "forms_create") {
      const name = String(b.name ?? "").trim().slice(0, 100);
      if (!name) return json({ error: "Give the form a name." }, 400);
      const pt = await pageToken(pageId, token);
      const existing: any = await g(`/${pageId}/leadgen_forms?fields=id,name,status&limit=100`, pt).catch(() => ({ data: [] }));
      const hit = (existing?.data ?? []).find((f: any) => f.name === name && f.status === "ACTIVE");
      if (hit) return json({ ok: true, form_id: hit.id, name, existed: true });
      const allowed = ["FULL_NAME", "EMAIL", "PHONE", "CITY", "STATE"];
      const fields = (Array.isArray(b.fields) && b.fields.length ? b.fields : ["FULL_NAME", "PHONE", "CITY"]).map((x: any) => String(x).toUpperCase()).filter((x: string) => allowed.includes(x));
      const privacy = /^https:\/\//.test(String(b.privacy_url ?? "")) ? String(b.privacy_url) : "https://metaautomationads.vercel.app/privacy.html";
      const params: Record<string, string> = {
        name,
        questions: JSON.stringify(fields.map((type: string) => ({ type }))),
        privacy_policy: JSON.stringify({ url: privacy, link_text: "Privacy policy" }),
        follow_up_action_url: /^https:\/\//.test(String(b.thank_you_url ?? "")) ? String(b.thank_you_url) : `https://www.facebook.com/${pageId}`,
        locale: "EN_US",
      };
      if (b.intro) params.context_card = JSON.stringify({ title: String(b.intro).slice(0, 60), style: "PARAGRAPH_STYLE", content: [String(b.intro_text ?? b.intro).slice(0, 500)], button_text: "Continue" });
      const r: any = await g(`/${pageId}/leadgen_forms`, pt, "POST", params);
      return json({ ok: true, form_id: r.id, name, existed: false });
    }

    if (action === "leads") {
      const formId = String(b.form_id ?? "").match(/\d+/)?.[0];
      if (!formId) return json({ error: "form_id is required" }, 400);
      const pt = await pageToken(pageId, token);
      const r: any = await g(`/${formId}/leads?fields=id,created_time,field_data&limit=${Math.min(Math.max(Number(b.limit) || 25, 1), 100)}`, pt);
      const leads = (r?.data ?? []).map((l: any) => ({ id: l.id, created: l.created_time, ...Object.fromEntries((l.field_data ?? []).map((f: any) => [f.name, (f.values ?? [])[0] ?? ""])) }));
      return json({ ok: true, leads });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});

async function acctMetaId(id: string): Promise<string> {
  const { data } = await db.from("ad_accounts").select("meta_ad_account_id").eq("id", id).maybeSingle();
  return String(data?.meta_ad_account_id ?? "").replace(/^act_/, "").match(/\d+/)?.[0] ?? "";
}
