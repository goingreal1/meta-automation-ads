import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Revora-provided ad accounts. The platform owner keeps a pool of ad accounts inside Revora's own Business Manager
// (table sellable_ad_accounts). A customer taps "Get an ad account": one ready account is renamed to what they chose and handed to
// them as a "managed" ad account (billing_mode managed, with Revora's markup). Pixels (datasets) can be created or picked from here.
//
//   Platform admin:  { action: "pool_list" } | { action: "pool_add", meta_ad_account_id, label? } | { action: "pool_retire", id }
//   Anyone signed in (owner / admin / buyer):
//     { action: "availability" }                                   -> { available, owned, fee, wallet }
//     { action: "claim", name, create_pixel?, pixel_id? }          -> { ok, ad_account_id, pixel_id? }
//     { action: "pixels", ad_account_id }                          -> { pixels: [{id,name,last_fired_time}] }
//     { action: "create_pixel", ad_account_id, name? }             -> { ok, pixel_id }
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const GRAPH = "https://graph.facebook.com/v20.0";
const MARKUP_PCT = 5;
const ACCOUNT_FEE = 3000; // naira, charged from the customer's wallet for every Revora ad account
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const actId = (v: string) => String(v).replace(/^act_/, "");

async function graph(path: string, method = "GET", body?: Record<string, string>) {
  const url = `${GRAPH}${path}${method === "GET" ? (path.includes("?") ? "&" : "?") + "access_token=" + META_TOKEN : ""}`;
  const r = await fetch(url, method === "GET" ? undefined : { method, body: new URLSearchParams({ ...(body ?? {}), access_token: META_TOKEN }) });
  const j: any = await r.json().catch(() => ({}));
  if (j?.error) throw new Error(j.error.error_user_msg || j.error.message || "Meta refused the request");
  return j;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!META_TOKEN) return json({ error: "Meta is not connected on the server yet." }, 500);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = token ? await admin.auth.getUser(token) : { data: null as any };
  if (!u?.user) return json({ error: "Not signed in." }, 401);
  const { data: me } = await admin.from("profiles").select("id, role, company_id, media_buyer_id").eq("id", u.user.id).maybeSingle();
  if (!me?.company_id) return json({ error: "Finish setting up your workspace first." }, 400);
  const action = String(b?.action ?? "");

  // ---- platform admin: manage the pool ----
  if (action.startsWith("pool_")) {
    const { data: pa } = await admin.from("platform_admins").select("user_id").eq("user_id", me.id).maybeSingle();
    if (!pa) return json({ error: "Not allowed." }, 403);
    if (action === "pool_list") {
      const { data } = await admin.from("sellable_ad_accounts").select("*").order("created_at", { ascending: false });
      return json({ accounts: data ?? [] });
    }
    if (action === "pool_add") {
      const id = actId(String(b?.meta_ad_account_id ?? "")).trim();
      if (!/^\d{6,20}$/.test(id)) return json({ error: "Paste the ad account number (digits)." }, 400);
      let info: any;
      try { info = await graph(`/act_${id}?fields=name,currency,account_status`); } catch (e) { return json({ error: "Revora's Meta login cannot see that ad account. Assign it to your Business Manager's system user first. (" + (e as Error).message + ")" }, 400); }
      const { error } = await admin.from("sellable_ad_accounts").insert({ meta_ad_account_id: id, label: String(b?.label ?? "").slice(0, 80) || null, meta_name: info?.name ?? null, currency: info?.currency ?? null });
      if (error) return json({ error: /duplicate/i.test(error.message) ? "That ad account is already in the pool." : error.message }, 400);
      return json({ ok: true, name: info?.name ?? null, currency: info?.currency ?? null, status: info?.account_status ?? null });
    }
    if (action === "pool_earnings") {
      const { data } = await admin.rpc("managed_earnings", { p_days: Math.min(Math.max(Number(b?.days) || 30, 1), 365) });
      const rows: any[] = data ?? [];
      const sum = (k: string) => rows.reduce((t, r) => t + Number(r[k] || 0), 0);
      return json({ days: rows, billed: sum("billed"), raw: sum("raw"), profit: sum("profit") });
    }
    if (action === "pool_retire") {
      await admin.from("sellable_ad_accounts").update({ status: "retired" }).eq("id", String(b?.id ?? "")).eq("status", "available");
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  }

  const allowed = me.role === "owner" || me.role === "admin" || me.role === "buyer";
  if (!allowed) return json({ error: "Not allowed." }, 403);

  if (action === "availability") {
    const [{ count: available }, { count: owned }] = await Promise.all([
      admin.from("sellable_ad_accounts").select("id", { count: "exact", head: true }).eq("status", "available"),
      admin.from("ad_accounts").select("id", { count: "exact", head: true }).eq("company_id", me.company_id).eq("billing_mode", "managed"),
    ]);
    const { data: w } = await admin.rpc("company_wallet_balance", { p_company: me.company_id });
    return json({ available: available ?? 0, owned: owned ?? 0, fee: ACCOUNT_FEE, wallet: Number(w ?? 0) });
  }

  if (action === "claim") {
    const name = String(b?.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (name.length < 2) return json({ error: "Give the ad account a name." }, 400);
    const { data: w0 } = await admin.rpc("company_wallet_balance", { p_company: me.company_id });
    if (Number(w0 ?? 0) < ACCOUNT_FEE) return json({ error: `A Revora ad account costs ₦${ACCOUNT_FEE.toLocaleString("en-NG")}, taken from your wallet. Your wallet has ₦${Math.max(0, Math.round(Number(w0 ?? 0))).toLocaleString("en-NG")}. Add funds first.` }, 402);
    // Take one ready account. The update only succeeds while it is still available, so two people can never get the same one.
    let picked: any = null;
    for (let i = 0; i < 4 && !picked; i++) {
      const { data: c } = await admin.from("sellable_ad_accounts").select("id, meta_ad_account_id").eq("status", "available").order("created_at").limit(1);
      if (!c?.length) return json({ error: "No ad accounts are ready right now. Try again soon." }, 409);
      const { data: got } = await admin.from("sellable_ad_accounts").update({ status: "assigned", assigned_company_id: me.company_id, assigned_at: new Date().toISOString() }).eq("id", c[0].id).eq("status", "available").select("id, meta_ad_account_id");
      if (got?.length) picked = got[0];
    }
    if (!picked) return json({ error: "Could not reserve an ad account. Try again." }, 409);
    // Charge the fee first (a charge row in the wallet ledger); every failure below gives it back.
    const { data: fee, error: feeErr } = await admin.from("wallet_adjustments").insert({ company_id: me.company_id, amount_naira: ACCOUNT_FEE, reason: "ad_account_fee", ref: picked.id }).select("id").single();
    if (feeErr || !fee) { await admin.from("sellable_ad_accounts").update({ status: "available", assigned_company_id: null, assigned_at: null }).eq("id", picked.id); return json({ error: "Could not charge your wallet. Try again." }, 500); }
    const release = async () => { await admin.from("wallet_adjustments").delete().eq("id", fee.id); await admin.from("sellable_ad_accounts").update({ status: "available", assigned_company_id: null, assigned_at: null }).eq("id", picked.id); };
    try { await graph(`/act_${picked.meta_ad_account_id}`, "POST", { name }); }
    catch (e) { await release(); return json({ error: "Meta would not rename the account: " + (e as Error).message }, 502); }

    let pixelId: string | null = null, pixelName: string | null = null, pixelNote: string | undefined;
    try {
      const existing = await graph(`/act_${picked.meta_ad_account_id}/adspixels?fields=id,name`);
      const list: any[] = existing?.data ?? [];
      const want = String(b?.pixel_id ?? "").trim();
      if (want) { const hit = list.find((p) => String(p.id) === want); if (hit) { pixelId = hit.id; pixelName = hit.name; } else pixelNote = "That dataset is not on this ad account. You can create one in Settings."; }
      else if (b?.create_pixel === true || list.length) {
        if (list.length) { pixelId = list[0].id; pixelName = list[0].name; }
        else { const p = await graph(`/act_${picked.meta_ad_account_id}/adspixels`, "POST", { name: `${name} dataset` }); pixelId = p?.id ?? null; pixelName = `${name} dataset`; }
      }
    } catch (e) { pixelNote = "The account is yours, but the dataset could not be created yet: " + (e as Error).message; }

    const buyerId = me.role === "buyer" ? me.media_buyer_id : (me.media_buyer_id ?? null);
    const { data: row, error } = await admin.from("ad_accounts").insert({
      meta_ad_account_id: picked.meta_ad_account_id, nickname: name, name, status: "active", connected_via: "partner",
      company_id: me.company_id, media_buyer_id: buyerId, user_id: me.id,
      meta_pixel_id: pixelId, pixel_name: pixelName, billing_mode: "managed", markup_pct: MARKUP_PCT, sellable_id: picked.id,
    }).select("id").single();
    if (error || !row) { await release(); return json({ error: "Could not add it to your workspace: " + (error?.message ?? "unknown") }, 500); }
    await admin.from("sellable_ad_accounts").update({ assigned_ad_account_id: row.id }).eq("id", picked.id);
    return json({ ok: true, ad_account_id: row.id, name, fee: ACCOUNT_FEE, pixel_id: pixelId, pixel_note: pixelNote });
  }

  if (action === "pixels" || action === "create_pixel") {
    const { data: acct } = await admin.from("ad_accounts").select("id, meta_ad_account_id, billing_mode, media_buyer_id, nickname").eq("id", String(b?.ad_account_id ?? "")).eq("company_id", me.company_id).maybeSingle();
    if (!acct) return json({ error: "Ad account not found." }, 404);
    if (me.role === "buyer" && acct.media_buyer_id !== me.media_buyer_id) return json({ error: "That ad account is not yours." }, 403);
    if (acct.billing_mode !== "managed") return json({ error: "Datasets are created here only for Revora ad accounts." }, 400);
    try {
      if (action === "pixels") {
        const r = await graph(`/act_${acct.meta_ad_account_id}/adspixels?fields=id,name,last_fired_time`);
        return json({ pixels: r?.data ?? [] });
      }
      const existing = await graph(`/act_${acct.meta_ad_account_id}/adspixels?fields=id,name`);
      let p = (existing?.data ?? [])[0];
      if (!p) { const nm = String(b?.name ?? "").trim().slice(0, 60) || `${acct.nickname ?? "Revora"} dataset`; const c = await graph(`/act_${acct.meta_ad_account_id}/adspixels`, "POST", { name: nm }); p = { id: c?.id, name: nm }; }
      await admin.from("ad_accounts").update({ meta_pixel_id: p.id, pixel_name: p.name }).eq("id", acct.id);
      return json({ ok: true, pixel_id: p.id, name: p.name });
    } catch (e) { return json({ error: (e as Error).message }, 502); }
  }
  return json({ error: "Unknown action." }, 400);
});
