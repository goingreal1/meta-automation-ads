import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Creative-vault launch planner (cron, every 15 minutes).
//
// For every product that has the AI switch on ("Let the AI launch tests from this vault") and is READY
// (at least 5 creatives with a headline + primary text, and a website link / WhatsApp number), it looks
// for creatives that have never been tested and drops a "launch suggestion" into the owner's AI inbox
// (+ push). NOTHING is launched here: the person taps Confirm in the AI chat, which runs ai-auto-launch-tests
// on exactly those creatives. A new suggestion is made once a day, and again right after the AI (or the
// buyer) paused something that was costing, so a killed ad gets a fresh creative proposed to replace it.
//
//   POST {} + header x-cron-secret -> sweep   ({ dry_run: true } previews and changes nothing)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MIN_CREATIVES = 5;
const MAX_PER_SUGGESTION = 5;

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

async function notifyInbox(admin: any, row: { company_id: string; profile_id: string; ad_account_id?: string; kind: string; title: string; body?: string; payload?: any; dedupe_key: string }): Promise<boolean> {
  const { error } = await admin.from("ai_inbox").insert({ ...row, payload: row.payload ?? {} });
  if (error) { if (error.code !== "23505") console.error("ai_inbox insert:", error.message); return false; }
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/handle-whatsapp-reply`, {
      method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ audience: { user_ids: [row.profile_id] }, category: "ads", notification: { title: row.title, body: row.body ?? "", url: "/dashboard_new.html#ai", tag: row.dedupe_key } }),
    });
  } catch (e) { console.error("push failed:", e); }
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: secret } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
  if (!secret?.value || (req.headers.get("x-cron-secret") ?? "") !== secret.value) return json({ error: "Not allowed." }, 401);
  const body = await req.json().catch(() => ({}));
  const dry = body?.dry_run === true;

  const { data: prods } = await admin.from("products")
    .select("id, product_name, company_id, ad_account_id, landing_page_url, destination_type, whatsapp_number")
    .eq("is_active", true).eq("auto_post_enabled", true).not("ad_account_id", "is", null);
  const { data: people } = await admin.from("profiles").select("id, company_id, role, media_buyer_id").in("role", ["owner", "admin", "buyer"]);

  const out: any[] = []; let made = 0;
  for (const p of prods ?? []) {
    const hasLink = !!(p.landing_page_url || (p.destination_type === "whatsapp" && p.whatsapp_number));
    if (!hasLink) { out.push({ product: p.product_name, skipped: "no website link / WhatsApp number" }); continue; }
    const { data: assets } = await admin.from("creative_assets")
      .select("id, file_name, public_url, asset_type, headline, primary_text, test_status, uploaded_at").eq("product_id", p.id).order("uploaded_at", { ascending: true });
    const complete = (assets ?? []).filter((a: any) => (a.headline ?? "").trim() && (a.primary_text ?? "").trim() && a.public_url);
    if (complete.length < MIN_CREATIVES) { out.push({ product: p.product_name, skipped: `only ${complete.length} complete creatives (need ${MIN_CREATIVES})` }); continue; }
    const fresh = complete.filter((a: any) => (a.test_status ?? "untested") === "untested").slice(0, MAX_PER_SUGGESTION);
    if (!fresh.length) { out.push({ product: p.product_name, skipped: "no untested creatives left" }); continue; }

    const { data: acct } = await admin.from("ad_accounts").select("id, nickname, company_id, user_id, media_buyer_id, status").eq("id", p.ad_account_id).maybeSingle();
    if (!acct || acct.status !== "active") { out.push({ product: p.product_name, skipped: "ad account not active" }); continue; }
    const here = (people ?? []).filter((x: any) => x.company_id === acct.company_id);
    const recipients = here.filter((x: any) => x.role === "owner" || x.role === "admin" || x.id === acct.user_id || (x.media_buyer_id && x.media_buyer_id === acct.media_buyer_id));

    // one suggestion per day, plus a new one right after anything was paused on this account
    const { data: lastKill } = await admin.from("ad_kill_log").select("created_at").eq("ad_account_id", acct.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const killedRecently = lastKill && Date.now() - new Date(lastKill.created_at).getTime() < 24 * 3600_000;
    const bucket = killedRecently ? `k${new Date(lastKill!.created_at).getTime().toString(36)}` : `d${new Date().toISOString().slice(0, 10)}`;
    const reason = killedRecently ? "Something was just paused for costing too much, so here are fresh creatives to replace it." : "These creatives have never been tested.";
    const title = `Launch ${fresh.length} fresh creative${fresh.length === 1 ? "" : "s"} for ${p.product_name}?`;
    const payload = {
      kind: "launch", product_id: p.id, product_name: p.product_name, ad_account_id: acct.id, account_name: acct.nickname,
      creative_ids: fresh.map((a: any) => a.id),
      previews: fresh.map((a: any) => ({ id: a.id, url: a.public_url, type: a.asset_type, headline: a.headline, text: (a.primary_text ?? "").slice(0, 140) })),
      reason,
    };
    if (dry) { out.push({ product: p.product_name, would_suggest: fresh.length, bucket, recipients: recipients.length }); continue; }
    for (const r of recipients) {
      const ok = await notifyInbox(admin, { company_id: acct.company_id, profile_id: r.id, ad_account_id: acct.id, kind: "launch_suggestion", title, body: `${reason} Nothing launches until you tap Confirm. (${acct.nickname})`, payload, dedupe_key: `launch:${p.id}:${bucket}` });
      if (ok) made++;
    }
    out.push({ product: p.product_name, suggested: fresh.length, bucket });
  }
  return json({ ok: true, suggestions: made, summary: out });
});
