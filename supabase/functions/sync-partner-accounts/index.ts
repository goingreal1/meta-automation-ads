import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Connect ad accounts WITHOUT a Facebook login. Revora has ONE platform Business Manager (META_BUSINESS_ID + META_ACCESS_TOKEN).
// A customer shares their ad accounts with that Business from their own Meta Business Settings, then links their Business ID here.
//
// Meta lists everything shared with us at  /{platform}/client_ad_accounts , and each account says which Business owns it. (The old
// /clients list now comes back empty, which is why nothing imported before.) A buyer can link SEVERAL Business IDs; every account a
// linked Business has shared is imported, and new shares are picked up by a 15-minute job.
//
// Safety: a Business ID can belong to only one workspace, and a NEW link must be proven: the person names one ad account that Business
// shared with Revora, which an attacker who only knows a Business ID cannot do. An account already in another workspace is never taken over.
//
//   { access_token, mode: "get_business_id" }                         -> { business_id }  (Revora's)
//   { access_token, mode: "list" }                                    -> { items: [{ id, business_id, buyer, accounts: [...] }] }
//   { access_token, mode: "register", business_id, proof_account_id, media_buyer_id? }   -> links + imports
//   { access_token, mode: "sync" }                                    -> imports for the caller's linked Businesses
//   { access_token, mode: "remove", link_id }                         -> unlinks a Business (accounts already imported stay)
//   cron: header x-cron-secret (or body cron_secret) + { mode: "sync_all" }
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_BUSINESS_ID = Deno.env.get("META_BUSINESS_ID") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const GRAPH = "https://graph.facebook.com/v19.0";
const supabase = createClient(SUPABASE_URL, SERVICE);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors } });

type Shared = { account_id: string; name: string; owner: string; status: string };
const STATUS: Record<number, string> = { 1: "Active", 2: "Disabled", 3: "Payment issue", 7: "In review", 8: "Payment pending", 9: "Grace period", 100: "Pending closure", 101: "Closed", 201: "Any" };

// Everything shared with Revora's Business, with the owning Business of each account. One paginated call.
async function listShared(): Promise<Shared[]> {
  const out: Shared[] = [];
  let url: string | null = `${GRAPH}/${META_BUSINESS_ID}/client_ad_accounts?fields=account_id,name,owner,business{id},account_status&limit=100&access_token=${META_ACCESS_TOKEN}`;
  for (let page = 0; url && page < 30; page++) {
    const r = await fetch(url); const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(String(j?.error?.message ?? "Could not read the accounts shared with Revora.").replace(META_ACCESS_TOKEN, "***"));
    for (const a of j.data ?? []) out.push({ account_id: String(a.account_id ?? "").replace(/^act_/, ""), name: String(a.name ?? ""), owner: String(a.owner ?? a.business?.id ?? ""), status: STATUS[Number(a.account_status)] ?? "Unknown" });
    url = j.paging?.next ?? null;
  }
  return out;
}

// Brings in every account a Business has shared. Never takes over an account that already belongs to another workspace.
async function importFor(companyId: string, buyerId: string, shared: Shared[]): Promise<{ imported: number; updated: number; blocked: number }> {
  if (!shared.length) return { imported: 0, updated: 0, blocked: 0 };
  const ids = shared.map((a) => a.account_id);
  const { data: have } = await supabase.from("ad_accounts").select("id, meta_ad_account_id, company_id, name").in("meta_ad_account_id", ids);
  const byId = new Map((have ?? []).map((a) => [String(a.meta_ad_account_id), a]));
  const fresh = [] as Record<string, unknown>[]; let updated = 0, blocked = 0;
  for (const a of shared) {
    const ex = byId.get(a.account_id);
    if (!ex) { fresh.push({ company_id: companyId, media_buyer_id: buyerId, name: a.name || `act_${a.account_id}`, nickname: a.name || `act_${a.account_id}`, meta_ad_account_id: a.account_id, connected_via: "partner", status: "active" }); continue; }
    if (ex.company_id !== companyId) { blocked++; continue; }
    if (a.name && ex.name !== a.name) { await supabase.from("ad_accounts").update({ name: a.name }).eq("id", ex.id); updated++; }
  }
  if (fresh.length) { const { error } = await supabase.from("ad_accounts").insert(fresh); if (error) throw error; }
  return { imported: fresh.length, updated, blocked };
}

async function syncLinks(links: { id: string; company_id: string; media_buyer_id: string; business_id: string }[]) {
  const shared = await listShared(); const results = [];
  for (const l of links) {
    const mine = shared.filter((a) => a.owner === l.business_id);
    const r = await importFor(l.company_id, l.media_buyer_id, mine);
    await supabase.from("media_buyer_bms").update({ accounts_found: mine.length, status: mine.length ? "linked" : "waiting", last_synced_at: new Date().toISOString() }).eq("id", l.id);
    results.push({ link_id: l.id, business_id: l.business_id, found: mine.length, ...r });
  }
  return results;
}

async function requireAuth(accessToken: string) {
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  if (error || !user) throw new Error("Not signed in.");
  const { data: profile } = await supabase.from("profiles").select("role, company_id, media_buyer_id").eq("id", user.id).maybeSingle();
  if (!profile?.company_id) throw new Error("No profile found.");
  return profile;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const { access_token, mode } = body;

    if (mode === "sync_all") {
      const hdr = req.headers.get("x-cron-secret") ?? body.cron_secret ?? "";
      const { data: sec } = await supabase.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
      if (!hdr || (hdr !== sec?.value && hdr !== CRON_SECRET)) return json({ error: "Not authorized." }, 403);
      if (!META_ACCESS_TOKEN || !META_BUSINESS_ID) return json({ error: "Partner sync isn't configured yet." }, 500);
      const { data: links } = await supabase.from("media_buyer_bms").select("id, company_id, media_buyer_id, business_id");
      const results = links?.length ? await syncLinks(links) : [];
      return json({ checked: results.length, imported: results.reduce((a, r) => a + r.imported, 0) });
    }

    if (!access_token) return json({ error: "access_token is required" }, 400);
    const profile = await requireAuth(access_token);
    const isAdmin = ["owner", "admin"].includes(String(profile.role));
    if (!META_ACCESS_TOKEN || !META_BUSINESS_ID) return json({ error: "Partner sync isn't configured yet." }, 500);

    if (mode === "get_business_id") return json({ business_id: META_BUSINESS_ID });

    // Which linked Businesses this person may see: an owner/admin sees the company's, a buyer sees their own.
    const scoped = async () => {
      let q = supabase.from("media_buyer_bms").select("id, company_id, media_buyer_id, business_id, label, status, accounts_found, last_synced_at, created_at").eq("company_id", profile.company_id).order("created_at");
      if (!isAdmin) { if (!profile.media_buyer_id) return []; q = q.eq("media_buyer_id", profile.media_buyer_id); }
      return (await q).data ?? [];
    };

    if (mode === "list") {
      const links = await scoped();
      const shared = links.length ? await listShared() : [];
      const { data: mine } = await supabase.from("ad_accounts").select("id, meta_ad_account_id, media_buyer_id").eq("company_id", profile.company_id);
      const inRevora = new Map((mine ?? []).map((a) => [String(a.meta_ad_account_id), a]));
      const { data: buyers } = await supabase.from("media_buyers").select("id, name").eq("company_id", profile.company_id);
      const nameOf = new Map((buyers ?? []).map((b) => [b.id, b.name]));
      return json({
        platform_business_id: META_BUSINESS_ID,
        items: links.map((l) => ({
          id: l.id, business_id: l.business_id, media_buyer_id: l.media_buyer_id, buyer: nameOf.get(l.media_buyer_id) ?? "", last_synced_at: l.last_synced_at,
          accounts: shared.filter((a) => a.owner === l.business_id).map((a) => ({ account_id: a.account_id, name: a.name, status: a.status, imported: inRevora.has(a.account_id), assigned_to: nameOf.get(inRevora.get(a.account_id)?.media_buyer_id) ?? null })),
        })),
      });
    }

    if (mode === "register") {
      const businessId = String(body.business_id ?? "").trim(), proof = String(body.proof_account_id ?? "").trim().replace(/^act_/, "");
      const target = body.media_buyer_id || profile.media_buyer_id;
      if (!target) return json({ error: "No buyer to link this to." }, 400);
      if (!isAdmin && target !== profile.media_buyer_id) return json({ error: "You can only link your own Business ID." }, 403);
      const { data: tb } = await supabase.from("media_buyers").select("id, company_id").eq("id", target).maybeSingle();
      if (!tb || tb.company_id !== profile.company_id) return json({ error: "Buyer not found." }, 404);
      if (!/^\d{6,}$/.test(businessId)) return json({ error: "That doesn't look like a Meta Business ID (digits only, from Business Settings → Business info)." }, 400);
      const { data: existing } = await supabase.from("media_buyer_bms").select("id, company_id, media_buyer_id").eq("business_id", businessId).maybeSingle();
      if (existing && existing.company_id !== profile.company_id) return json({ error: "This Business ID is already linked to another Revora workspace. If it is yours, contact support." }, 409);
      if (existing) return json({ error: "This Business ID is already linked. Use Check and import to bring in new accounts." }, 409);
      if (!/^\d{6,}$/.test(proof)) return json({ error: "To protect your accounts, also enter the ID of ONE ad account you shared with Revora (Business Settings → Accounts → Ad accounts shows each ID)." }, 400);
      const shared = await listShared();
      if (!shared.some((a) => a.account_id === proof && a.owner === businessId)) {
        return json({ error: `We can't see that ad account shared with Revora from Business ${businessId} yet. In Business Settings → Partners, share it with Revora's Business ID (${META_BUSINESS_ID}), check the Business ID and account ID are right, then try again.` }, 422);
      }
      const { data: link, error } = await supabase.from("media_buyer_bms").insert({ company_id: profile.company_id, media_buyer_id: target, business_id: businessId, status: "linked" }).select("id, company_id, media_buyer_id, business_id").single();
      if (error || !link) return json({ error: error?.message ?? "Could not link it." }, 500);
      await supabase.from("media_buyers").update({ meta_partner_business_id: businessId }).eq("id", target).is("meta_partner_business_id", null);
      const results = await syncLinks([link]);
      return json({ ok: true, ...results[0] });
    }

    if (mode === "sync") {
      const links = await scoped();
      if (!links.length) return json({ results: [] });
      return json({ results: await syncLinks(links) });
    }

    if (mode === "remove") {
      const links = await scoped(); const l = links.find((x) => x.id === body.link_id);
      if (!l) return json({ error: "Not found." }, 404);
      await supabase.from("media_buyer_bms").delete().eq("id", l.id);
      return json({ ok: true });
    }

    return json({ error: "mode must be get_business_id, list, register, sync or remove" }, 400);
  } catch (err) {
    console.error("sync-partner-accounts error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
