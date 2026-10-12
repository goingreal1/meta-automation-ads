import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Platform-admin tool: create a Business-level Meta pixel (dataset) and share it with an ad account, using Revora's global token.
//   POST { action: "list" }
//   POST { action: "create", name, ad_account_id? }   -- idempotent on name; shares the pixel with the ad account when given
//   POST { action: "share", pixel_id, ad_account_id }
// Auth: a platform admin's session, or the shared cron secret (x-cron-secret).
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const BM = Deno.env.get("META_BUSINESS_ID") ?? "";
const G = "https://graph.facebook.com/v22.0";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
async function g(path: string, method = "GET", body?: Record<string, string>) {
  const url = `${G}${path}${method === "GET" ? (path.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(TOKEN) : ""}`;
  const r = await fetch(url, method === "GET" ? undefined : { method, body: new URLSearchParams({ ...(body ?? {}), access_token: TOKEN }) });
  const j: any = await r.json().catch(() => ({}));
  if (j?.error) throw new Error(j.error.error_user_msg || j.error.message || "Meta refused the request");
  return j;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-cron-secret" } });
  try {
    if (!TOKEN || !BM) return json({ error: "META_ACCESS_TOKEN or META_BUSINESS_ID is not set." }, 500);
    const sec = (await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle()).data?.value ?? "";
    const given = req.headers.get("x-cron-secret") ?? "";
    let ok = !!given && given === sec;
    if (!ok) {
      const { data: u } = await db.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
      if (u?.user) ok = !!(await db.from("platform_admins").select("user_id").eq("user_id", u.user.id).maybeSingle()).data;
    }
    if (!ok) return json({ error: "Not allowed." }, 403);
    const b = await req.json().catch(() => ({}));
    const list = async () => (await g(`/${BM}/adspixels?fields=id,name&limit=200`)).data ?? [];
    const share = async (pixel: string, acct: string) => {
      const id = String(acct).replace(/\D/g, "");
      if (!id) return null;
      const tries: Record<string, string>[] = [{ account_id: id, business: BM }, { account_id: `act_${id}`, business: BM }];
      let last = "";
      for (const t of tries) {
        try { await g(`/${pixel}/shared_accounts`, "POST", t); return { shared: true }; } catch (e) { last = (e as Error).message; }
      }
      return { shared: false, note: last };
    };
    if (b.action === "list") return json({ pixels: await list() });
    if (b.action === "overview") {
      const days = Math.min(Math.max(Number(b.days) || 7, 1), 30), start = Math.floor(Date.now() / 1000) - days * 86400;
      const l = (await g(`/${BM}/adspixels?fields=id,name,last_fired_time,is_unavailable&limit=50`)).data ?? [];
      const out: any[] = [];
      for (const p of l.slice(0, 15)) {
        const row: any = { id: p.id, name: p.name, last_fired_time: p.last_fired_time ?? null, unavailable: p.is_unavailable === true, events: {}, methods: {} };
        try { const st = await g(`/${p.id}/stats?aggregation=event&start_time=${start}`); for (const bk of st?.data ?? []) for (const e of bk?.data ?? []) row.events[e.value] = (row.events[e.value] || 0) + Number(e.count || 0); } catch (e) { row.error = (e as Error).message.slice(0, 120); }
        try { const m = await g(`/${p.id}/stats?aggregation=event_detection_method&start_time=${start}`); for (const bk of m?.data ?? []) for (const e of bk?.data ?? []) row.methods[e.value] = (row.methods[e.value] || 0) + Number(e.count || 0); } catch { /* optional */ }
        out.push(row);
      }
      return json({ ok: true, days, pixels: out });
    }
    if (b.action === "create") {
      const name = String(b.name ?? "").trim().slice(0, 60);
      if (!name) return json({ error: "name is required" }, 400);
      const existing = (await list()).find((p: any) => p.name === name);
      const pixel = existing ?? (await g(`/${BM}/adspixels`, "POST", { name }));
      const sh = b.ad_account_id ? await share(pixel.id, b.ad_account_id) : null;
      return json({ ok: true, pixel_id: pixel.id, name, existed: !!existing, share: sh });
    }
    if (b.action === "share") return json({ ok: true, share: await share(String(b.pixel_id ?? ""), b.ad_account_id) });
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
