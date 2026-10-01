import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Alternative to per-buyer Meta OAuth (which only ever worked for the
// platform's own Facebook login, never a genuinely separate buyer account,
// across extensive testing). Instead: ONE global Business Manager (the
// platform's own, via META_ACCESS_TOKEN + META_BUSINESS_ID) that any buyer,
// from any company, shares their own ad account with directly from their
// own Meta Business Settings -- no login on this dashboard at all.
//
// Safety: the token and Business ID are global, but every lookup this
// function does is scoped to ONE specific pre-registered business ID
// belonging to ONE specific buyer the caller already has rights to (their
// own company, or their own row if they're a buyer). It never lists or
// exposes the platform's full partner list to anyone -- that would leak
// one company's pending buyer requests to another company's admin.
//
//   POST { access_token, mode: "get_business_id" }
//     -> { business_id } -- for display, any signed-in user
//   POST { access_token, mode: "register", business_id }
//     -> buyer (or admin for a buyer) records which Meta Business ID to watch for
//   POST { access_token, mode: "sync" }
//     -> checks every (or, for a buyer caller, just their own) registered
//        business ID in the caller's company against the real partner list,
//        imports confirmed ones, reports status per buyer

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_BUSINESS_ID = Deno.env.get("META_BUSINESS_ID") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

async function requireAuth(accessToken: string) {
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  if (error || !user) throw new Error("Not signed in.");
  const { data: profile } = await supabase.from("profiles").select("role, company_id, media_buyer_id").eq("id", user.id).maybeSingle();
  if (!profile) throw new Error("No profile found.");
  return profile as { role: string; company_id: string; media_buyer_id: string | null };
}

// Fetches the platform's full partner list ONCE per call and filters down
// to only the business IDs the caller is actually allowed to check --
// the full list itself is never returned to a client.
async function fetchClientsById(businessIds: string[]): Promise<Map<string, any>> {
  const wanted = new Set(businessIds);
  const found = new Map<string, any>();
  if (!wanted.size) return found;
  let url: string | null = `${META_GRAPH_BASE}/${META_BUSINESS_ID}/clients?fields=id,name,adaccount_permissions{id,access_status}&limit=200&access_token=${META_ACCESS_TOKEN}`;
  while (url && found.size < wanted.size) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Could not check partner shares.");
    for (const c of data.data ?? []) if (wanted.has(c.id)) found.set(c.id, c);
    url = data.paging?.next ?? null;
  }
  return found;
}

async function importConfirmed(companyId: string, mediaBuyerId: string, client: any) {
  const confirmed = (client.adaccount_permissions ?? []).filter((a: any) => a.access_status === "CONFIRMED");
  if (!confirmed.length) return 0;
  const rows = confirmed.map((a: any) => ({
    company_id: companyId,
    media_buyer_id: mediaBuyerId,
    name: client.name,
    nickname: client.name,
    meta_ad_account_id: String(a.id).replace(/^act_/, ""),
    connected_via: "partner",
    status: "active",
  }));
  const { error } = await supabase.from("ad_accounts").upsert(rows, { onConflict: "meta_ad_account_id", ignoreDuplicates: true });
  if (error) throw error;
  return confirmed.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" } });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json();
    const { access_token, mode } = body;
    if (!access_token) return json({ error: "access_token is required" }, 400);

    if (mode === "get_business_id") {
      await requireAuth(access_token); // any signed-in user, just needs to be real
      if (!META_BUSINESS_ID) return json({ error: "META_BUSINESS_ID isn't configured yet." }, 500);
      return json({ business_id: META_BUSINESS_ID });
    }

    const profile = await requireAuth(access_token);
    const isAdmin = ["owner", "admin"].includes(profile.role);
    if (!META_ACCESS_TOKEN || !META_BUSINESS_ID) return json({ error: "Partner sync isn't configured yet (META_ACCESS_TOKEN / META_BUSINESS_ID missing)." }, 500);

    if (mode === "register") {
      const { business_id, media_buyer_id } = body;
      const targetId = media_buyer_id || profile.media_buyer_id;
      if (!targetId) return json({ error: "No buyer to register this against." }, 400);
      if (!isAdmin && targetId !== profile.media_buyer_id) return json({ error: "You can only register your own Business ID." }, 403);
      if (!/^\d+$/.test(String(business_id || ""))) return json({ error: "That doesn't look like a valid Meta Business ID (digits only)." }, 400);
      const { error } = await supabase.from("media_buyers").update({ meta_partner_business_id: business_id }).eq("id", targetId).eq("company_id", profile.company_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (mode === "sync") {
      let buyerQuery = supabase.from("media_buyers").select("id, name, meta_partner_business_id").eq("company_id", profile.company_id).not("meta_partner_business_id", "is", null);
      if (!isAdmin) {
        if (!profile.media_buyer_id) return json({ results: [] });
        buyerQuery = buyerQuery.eq("id", profile.media_buyer_id);
      }
      const { data: buyers } = await buyerQuery;
      if (!buyers?.length) return json({ results: [] });

      const clients = await fetchClientsById(buyers.map(b => b.meta_partner_business_id as string));
      const results = [];
      for (const buyer of buyers) {
        const client = clients.get(buyer.meta_partner_business_id as string);
        if (!client) {
          results.push({ media_buyer: buyer.name, status: "pending", imported: 0 });
          continue;
        }
        const imported = await importConfirmed(profile.company_id, buyer.id, client);
        results.push({ media_buyer: buyer.name, status: imported ? "confirmed" : "pending", imported });
      }
      return json({ results });
    }

    return json({ error: "mode must be get_business_id, register, or sync" }, 400);
  } catch (err: any) {
    console.error("sync-partner-accounts error:", err);
    return json({ error: err.message }, 500);
  }
});
