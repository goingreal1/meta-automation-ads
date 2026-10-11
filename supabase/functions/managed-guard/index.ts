import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Safety net for Revora-managed ad accounts (the ones Revora's card pays Meta for). Runs every 10 minutes (pg_cron).
// For each managed account:
//   1. balance_naira is set to the customer's Revora wallet (what they see as "balance"; low-balance alerts use it).
//   2. Meta's spend cap on the account is set to what Meta has already charged plus what the wallet can still pay for
//      (wallet divided by the markup), so Revora's card can never be billed for more than the customer paid in.
//   3. When the wallet is used up, every running campaign is paused and the customer is told.
// Auth: the shared cron secret in x-cron-secret.
const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const GRAPH = "https://graph.facebook.com/v20.0";
const db = createClient(URL_, KEY);
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const naira = (n: number) => "₦" + Math.round(n).toLocaleString("en-NG");

async function graph(path: string, method = "GET", body?: Record<string, string>) {
  const url = `${GRAPH}${path}${method === "GET" ? (path.includes("?") ? "&" : "?") + "access_token=" + META_TOKEN : ""}`;
  const r = await fetch(url, method === "GET" ? undefined : { method, body: new URLSearchParams({ ...(body ?? {}), access_token: META_TOKEN }) });
  const j: any = await r.json().catch(() => ({}));
  if (j?.error) throw new Error(j.error.error_user_msg || j.error.message || "Meta refused the request");
  return j;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const given = req.headers.get("x-cron-secret") || body?.cron_secret || "";
  const { data: sec } = await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
  if (!given || (given !== sec?.value && given !== CRON_SECRET)) return json({ error: "Unauthorized" }, 401);
  if (!META_TOKEN) return json({ error: "Meta is not connected." }, 500);

  const { data: accounts } = await db.from("ad_accounts").select("id, name, nickname, meta_ad_account_id, company_id, markup_pct").eq("billing_mode", "managed").eq("status", "active");
  const out: any[] = [];
  const wallets = new Map<string, number>();
  for (const a of accounts ?? []) {
    const res: any = { account: a.nickname || a.name, actions: [] as string[] };
    try {
      if (!wallets.has(a.company_id)) { const { data } = await db.rpc("company_wallet_balance", { p_company: a.company_id }); wallets.set(a.company_id, Number(data ?? 0)); }
      const wallet = wallets.get(a.company_id) ?? 0;
      await db.from("ad_accounts").update({ balance_naira: Math.max(0, wallet), balance_updated_at: new Date().toISOString() }).eq("id", a.id);
      const factor = 1 + Number(a.markup_pct ?? 0) / 100;
      const act = String(a.meta_ad_account_id).replace(/^act_/, "");
      // 2. spend cap (Meta's own numbers are in minor units: kobo)
      try {
        const info = await graph(`/act_${act}?fields=amount_spent,spend_cap`);
        const spentMinor = Number(info?.amount_spent ?? 0);
        const room = Math.max(0, wallet) / factor;
        const capMinor = Math.round(spentMinor + room * 100);
        if (Number(info?.spend_cap ?? 0) !== capMinor) { await graph(`/act_${act}`, "POST", { spend_cap: String(capMinor) }); res.actions.push("spend cap updated"); }
      } catch (e) { res.actions.push("spend cap not set: " + (e as Error).message.slice(0, 120)); }
      // 3. wallet used up: pause everything that is running
      if (wallet <= 0) {
        const camps = await graph(`/act_${act}/campaigns?fields=id,effective_status&effective_status=${encodeURIComponent('["ACTIVE"]')}&limit=100`);
        let paused = 0;
        for (const c of camps?.data ?? []) { try { await graph(`/${c.id}`, "POST", { status: "PAUSED" }); paused++; } catch { /* keep going */ } }
        if (paused) {
          res.actions.push(`paused ${paused} campaign(s)`);
          const day = new Date().toISOString().slice(0, 10);
          const { data: people } = await db.from("profiles").select("id").eq("company_id", a.company_id).in("role", ["owner", "admin", "buyer"]);
          for (const p of people ?? []) await db.from("ai_inbox").insert({ company_id: a.company_id, profile_id: p.id, ad_account_id: a.id, kind: "low_balance", title: `${a.nickname || a.name}: ads paused, wallet is empty`, body: `Your wallet is ${naira(Math.max(0, wallet))}, so your ads were paused. Add funds to your wallet, then turn them back on.`, payload: {}, dedupe_key: `managed_empty:${a.id}:${day}` }).then(() => {}, () => {});
        }
      }
    } catch (e) { res.actions.push("error: " + (e as Error).message.slice(0, 160)); }
    out.push(res);
  }
  return json({ ok: true, accounts: out.length, detail: out });
});
