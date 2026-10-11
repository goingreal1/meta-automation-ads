import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Event Manager inside the dashboard, per ad account: the datasets (pixels) linked to the account, their event counts,
// whether they fire from the browser or the server (Conversions API), creating a dataset, choosing which one the account
// uses, and sending a test event. Works for Revora-provided accounts and for accounts people connected themselves;
// what Meta lets each connection do (read only, or create too) decides what succeeds, and Meta's own message is passed on.
//
//   POST { action: "overview", ad_account_id, days? (1..30) }          -> { can_create, pixels: [{id,name,last_fired_time,active,events,daily,methods}] }
//   POST { action: "create_dataset", ad_account_id, name? }           -> { ok, pixel_id }
//   POST { action: "use_dataset", ad_account_id, pixel_id }           -> { ok }
//   POST { action: "quality", ad_account_id, pixel_id?, days? }       -> { ok, keys: {email:n,phone:n,...}, total }   (customer details sent with events; Meta's 0-10 match score is not available through the API)
//   POST { action: "conversions", ad_account_id }                      -> { ok, items: [{id,name,type,rule,pixel,value,last_fired_time}] }
//   POST { action: "conversion_create", ad_account_id, name, contains, type?, value?, pixel_id? } -> { ok, id }
//   POST { action: "test_event", ad_account_id, pixel_id, test_code, event_name? } -> { ok, events_received }
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SHARED_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const GRAPH = "https://graph.facebook.com/v22.0";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const EVENTS = new Set(["PageView", "ViewContent", "InitiateCheckout", "Lead", "Purchase"]);

async function g(path: string, token: string, method = "GET", body?: Record<string, string> | string) {
  const isGet = method === "GET";
  const url = `${GRAPH}${path}${isGet ? (path.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(token) : ""}`;
  const init: RequestInit | undefined = isGet ? undefined : typeof body === "string"
    ? { method, headers: { "Content-Type": "application/json" }, body }
    : { method, body: new URLSearchParams({ ...(body ?? {}), access_token: token }) };
  const r = await fetch(url, init);
  const j: any = await r.json().catch(() => ({}));
  if (j?.error) throw new Error(j.error.error_user_msg || j.error.message || "Meta refused the request");
  return j;
}
async function sha(v: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v.trim().toLowerCase())))).map((b) => b.toString(16).padStart(2, "0")).join(""); }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null as any };
  if (!u?.user) return json({ error: "Not signed in." }, 401);
  const { data: me } = await admin.from("profiles").select("id, role, company_id, media_buyer_id").eq("id", u.user.id).maybeSingle();
  if (!me?.company_id || !["owner", "admin", "buyer"].includes(me.role)) return json({ error: "Not allowed." }, 403);
  const { data: acct } = await admin.from("ad_accounts").select("id, meta_ad_account_id, nickname, name, meta_pixel_id, meta_connection_id, media_buyer_id, billing_mode, company_id").eq("id", String(b?.ad_account_id ?? "")).eq("company_id", me.company_id).maybeSingle();
  if (!acct) return json({ error: "Ad account not found." }, 404);
  if (me.role === "buyer" && acct.media_buyer_id !== me.media_buyer_id) return json({ error: "That ad account is not yours." }, 403);
  const act = String(acct.meta_ad_account_id).replace(/^act_/, "");
  let token = SHARED_TOKEN, own = false;
  if (acct.meta_connection_id) {
    const { data: c } = await admin.from("meta_connections").select("access_token, status").eq("id", acct.meta_connection_id).maybeSingle();
    if (c?.status === "active" && c.access_token) { token = c.access_token; own = true; }
  }
  if (!token) return json({ error: "Meta is not connected." }, 500);
  const action = String(b?.action ?? "overview");

  try {
    if (action === "overview") {
      const days = Math.min(Math.max(Number(b?.days) || 7, 1), 30);
      const start = Math.floor(Date.now() / 1000) - days * 86400;
      const list = await g(`/act_${act}/adspixels?fields=id,name,last_fired_time,creation_time,is_unavailable&limit=25`, token);
      const pixels: any[] = [];
      for (const p of (list?.data ?? []).slice(0, 8)) {
        const row: any = { id: p.id, name: p.name, last_fired_time: p.last_fired_time ?? null, created: p.creation_time ?? null, unavailable: p.is_unavailable === true, active: String(acct.meta_pixel_id ?? "") === String(p.id), events: {}, daily: [], methods: {} };
        try {
          const st = await g(`/${p.id}/stats?aggregation=event&start_time=${start}`, token);
          const perDay: Record<string, number> = {};
          for (const bucket of st?.data ?? []) {
            const day = String(bucket.start_time ?? "").slice(0, 10);
            for (const e of bucket?.data ?? []) { row.events[e.value] = (row.events[e.value] || 0) + Number(e.count || 0); if (day) perDay[day] = (perDay[day] || 0) + Number(e.count || 0); }
          }
          row.daily = Object.entries(perDay).sort().map(([date, total]) => ({ date, total }));
        } catch (e) { row.stats_error = (e as Error).message.slice(0, 160); }
        try {
          // Where the events came from: the browser pixel or the server (Conversions API).
          const m = await g(`/${p.id}/stats?aggregation=event_detection_method&start_time=${start}`, token);
          for (const bucket of m?.data ?? []) for (const e of bucket?.data ?? []) row.methods[e.value] = (row.methods[e.value] || 0) + Number(e.count || 0);
        } catch { /* not every dataset reports this */ }
        pixels.push(row);
      }
      return json({ ok: true, ad_account: acct.nickname ?? acct.name, managed: acct.billing_mode === "managed", can_create: acct.billing_mode === "managed" || own, days, pixels, note: acct.billing_mode !== "managed" && !own ? "This account is shared with Revora for viewing. Creating a dataset needs the account connected with full access." : undefined });
    }

    if (action === "create_dataset") {
      const existing = await g(`/act_${act}/adspixels?fields=id,name`, token);
      let p = (existing?.data ?? [])[0];
      if (p) { if (!acct.meta_pixel_id) await admin.from("ad_accounts").update({ meta_pixel_id: p.id, pixel_name: p.name }).eq("id", acct.id); return json({ ok: true, pixel_id: p.id, name: p.name, existing: true, note: "Meta allows one dataset per ad account, and this one already has it." }); }
      const nm = String(b?.name ?? "").trim().slice(0, 60) || `${acct.nickname ?? acct.name ?? "Revora"} dataset`;
      const c = await g(`/act_${act}/adspixels`, token, "POST", { name: nm });
      await admin.from("ad_accounts").update({ meta_pixel_id: c?.id, pixel_name: nm }).eq("id", acct.id);
      return json({ ok: true, pixel_id: c?.id, name: nm });
    }

    if (action === "use_dataset") {
      const pid = String(b?.pixel_id ?? "");
      const list = await g(`/act_${act}/adspixels?fields=id,name`, token);
      const hit = (list?.data ?? []).find((p: any) => String(p.id) === pid);
      if (!hit) return json({ error: "That dataset is not linked to this ad account." }, 400);
      await admin.from("ad_accounts").update({ meta_pixel_id: hit.id, pixel_name: hit.name }).eq("id", acct.id);
      return json({ ok: true });
    }

    if (action === "quality") {
      const pid = String(b?.pixel_id ?? acct.meta_pixel_id ?? "");
      if (!/^\d+$/.test(pid)) return json({ error: "Pick a dataset first." }, 400);
      const days = Math.min(Math.max(Number(b?.days) || 7, 1), 30);
      const start = Math.floor(Date.now() / 1000) - days * 86400;
      const keys: Record<string, number> = {}; let total = 0;
      const ev = await g(`/${pid}/stats?aggregation=event&start_time=${start}`, token);
      for (const bucket of ev?.data ?? []) for (const e of bucket?.data ?? []) total += Number(e.count || 0);
      try {
        const k = await g(`/${pid}/stats?aggregation=pii_keys&start_time=${start}`, token);
        for (const bucket of k?.data ?? []) for (const e of bucket?.data ?? []) keys[String(e.value)] = (keys[String(e.value)] || 0) + Number(e.count || 0);
      } catch (e) { return json({ ok: true, total, keys: {}, days, unavailable: "Meta did not return customer-detail counts for this dataset." }); }
      return json({ ok: true, total, keys, days });
    }

    if (action === "conversions") {
      const r = await g(`/act_${act}/customconversions?fields=id,name,custom_event_type,rule,default_conversion_value,last_fired_time,is_archived,pixel&limit=50`, token);
      const items = (r?.data ?? []).filter((c: any) => !c.is_archived).map((c: any) => ({ id: c.id, name: c.name, type: c.custom_event_type, rule: c.rule, value: c.default_conversion_value ?? 0, last_fired_time: c.last_fired_time ?? null, pixel: c.pixel?.id ?? null }));
      return json({ ok: true, items });
    }

    if (action === "conversion_create") {
      const name = String(b?.name ?? "").trim().slice(0, 100);
      const contains = String(b?.contains ?? "").trim().slice(0, 200);
      const TYPES = ["PURCHASE", "LEAD", "COMPLETE_REGISTRATION", "ADD_TO_CART", "INITIATED_CHECKOUT", "CONTENT_VIEW", "OTHER"];
      const type = TYPES.includes(String(b?.type)) ? String(b.type) : "OTHER";
      const pid = String(b?.pixel_id ?? acct.meta_pixel_id ?? "");
      if (!name) return json({ error: "Give the conversion a name." }, 400);
      if (!contains) return json({ error: "Say which page address counts, for example thank-you." }, 400);
      if (!/^\d+$/.test(pid)) return json({ error: "Pick a dataset first." }, 400);
      const body: Record<string, string> = { name, event_source_id: pid, custom_event_type: type, rule: JSON.stringify({ url: { i_contains: contains } }) };
      const val = Number(b?.value); if (val > 0) body.default_conversion_value = String(val);
      const r = await g(`/act_${act}/customconversions`, token, "POST", body);
      return json({ ok: true, id: r?.id });
    }

    if (action === "test_event") {
      const pid = String(b?.pixel_id ?? acct.meta_pixel_id ?? "");
      const code = String(b?.test_code ?? "").trim();
      if (!/^\d+$/.test(pid)) return json({ error: "Pick a dataset first." }, 400);
      if (!/^[A-Za-z0-9_-]{4,40}$/.test(code)) return json({ error: "Paste the test code from Meta (Events Manager, Test events), for example TEST12345." }, 400);
      const ev = EVENTS.has(String(b?.event_name)) ? String(b.event_name) : "PageView";
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || undefined;
      const payload = { test_event_code: code, data: [{
        event_name: ev, event_time: Math.floor(Date.now() / 1000), event_id: `revora-test-${crypto.randomUUID()}`, action_source: "system_generated",
        user_data: { em: [await sha(`${me.id}@test.revora`)], external_id: [await sha(me.id)], client_user_agent: "Revora test event", ...(ip ? { client_ip_address: ip } : {}) },
        ...(ev === "Purchase" ? { custom_data: { currency: "NGN", value: 1 } } : {}),
      }] };
      const r = await g(`/${pid}/events`, token, "POST", JSON.stringify(payload));
      return json({ ok: true, events_received: r?.events_received ?? 0, event_name: ev });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: /permission|OAuth|access/i.test(msg) ? `${msg} (This connection may not be allowed to do that. Connect Meta with full access, or do it in Meta's Events Manager.)` : msg }, 502);
  }
});
