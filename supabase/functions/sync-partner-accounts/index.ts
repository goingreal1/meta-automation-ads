import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Alternative to per-buyer Meta OAuth: a buyer shares their own ad account
// with the company's Business Manager as a Partner (Business Settings ->
// Partners -> "Give a partner access to your assets", using the company's
// Business ID) -- no login dance on our side at all. This function reads
// those partner shares via the Graph API using the company's own saved
// token, and either auto-imports ones already matched to a buyer
// (media_buyers.meta_partner_business_id) or returns them as "unclaimed"
// for an admin to assign once.
//
//   POST { access_token, mode: "sync" }
//     -> { claimed: [...], unclaimed: [{business_id, business_name, ad_accounts:[...]}] }
//   POST { access_token, mode: "claim", business_id, business_name, media_buyer_id }
//     -> assigns that partner business to a buyer and imports its ad accounts

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

async function requireAdmin(accessToken: string) {
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  if (error || !user) throw new Error("Not signed in.");
  const { data: profile } = await supabase.from("profiles").select("role, company_id").eq("id", user.id).maybeSingle();
  if (!profile || !["owner", "admin"].includes(profile.role)) throw new Error("Only an owner or admin can manage partner-shared ad accounts.");
  return profile as { role: string; company_id: string };
}

// Resolves (and lazily sets up) the company's own Business Manager ID and
// which saved Meta connection's token to read partner shares through.
async function resolveCompanySync(companyId: string): Promise<{ businessId: string; accessToken: string }> {
  const { data: settings } = await supabase.from("company_settings").select("meta_business_id, meta_sync_connection_id").eq("company_id", companyId).maybeSingle();

  let connectionId = settings?.meta_sync_connection_id as string | null;
  let connToken: string | null = null;

  if (connectionId) {
    const { data: conn } = await supabase.from("meta_connections").select("access_token").eq("id", connectionId).maybeSingle();
    connToken = conn?.access_token ?? null;
  }
  if (!connToken) {
    // Fall back to the company's most recently connected token (any buyer,
    // typically the admin's own) and remember it going forward.
    const { data: conn } = await supabase.from("meta_connections").select("id, access_token").eq("company_id", companyId).order("connected_at", { ascending: false }).limit(1).maybeSingle();
    if (!conn?.access_token) throw new Error("No Meta connection found for this company yet -- connect Meta at least once first (Settings -> Connect Meta).");
    connectionId = conn.id;
    connToken = conn.access_token;
  }

  let businessId = settings?.meta_business_id as string | null;
  if (!businessId) {
    const bizRes = await fetch(`${META_GRAPH_BASE}/me/businesses?fields=id,name&access_token=${connToken}`);
    const bizData = await bizRes.json();
    if (!bizRes.ok) throw new Error(bizData.error?.message || "Could not look up this Meta login's Business Manager.");
    const first = bizData.data?.[0];
    if (!first) throw new Error("This Meta login isn't an admin of any Business Manager -- reconnect with the account that owns your Business Manager.");
    businessId = first.id;
  }

  await supabase.from("company_settings").upsert({ company_id: companyId, meta_business_id: businessId, meta_sync_connection_id: connectionId });

  return { businessId, accessToken: connToken };
}

async function fetchAllClients(businessId: string, accessToken: string) {
  const clients: any[] = [];
  let url: string | null = `${META_GRAPH_BASE}/${businessId}/clients?fields=id,name,adaccount_permissions{id,access_status}&limit=100&access_token=${accessToken}`;
  while (url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Could not list partner businesses.");
    clients.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return clients;
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
    const profile = await requireAdmin(access_token);

    const { businessId, accessToken } = await resolveCompanySync(profile.company_id);
    const clients = await fetchAllClients(businessId, accessToken);

    const { data: buyers } = await supabase.from("media_buyers").select("id, name, meta_partner_business_id").eq("company_id", profile.company_id);
    const byBusinessId = new Map((buyers ?? []).filter(b => b.meta_partner_business_id).map(b => [b.meta_partner_business_id, b]));

    if (mode === "claim") {
      const { business_id, business_name, media_buyer_id } = body;
      if (!business_id || !media_buyer_id) return json({ error: "business_id and media_buyer_id are required" }, 400);
      const client = clients.find((c: any) => c.id === business_id);
      if (!client) return json({ error: "That business is no longer in your partner list -- refresh and try again." }, 404);

      await supabase.from("media_buyers").update({ meta_partner_business_id: business_id }).eq("id", media_buyer_id).eq("company_id", profile.company_id);

      const confirmedAccounts = (client.adaccount_permissions ?? []).filter((a: any) => a.access_status === "CONFIRMED");
      const rows = confirmedAccounts.map((a: any) => ({
        company_id: profile.company_id,
        media_buyer_id,
        name: business_name || client.name,
        nickname: client.name,
        meta_ad_account_id: String(a.id).replace(/^act_/, ""),
        connected_via: "partner",
        status: "active",
      }));
      if (rows.length) {
        const { error } = await supabase.from("ad_accounts").upsert(rows, { onConflict: "meta_ad_account_id", ignoreDuplicates: true });
        if (error) throw error;
      }
      return json({ ok: true, imported: rows.length });
    }

    // mode === "sync" (default): auto-import anything already claimed,
    // report everything else as unclaimed for the admin to assign.
    const claimed: any[] = [];
    const unclaimed: any[] = [];
    for (const client of clients) {
      const confirmedAccounts = (client.adaccount_permissions ?? []).filter((a: any) => a.access_status === "CONFIRMED");
      if (!confirmedAccounts.length) continue;
      const buyer = byBusinessId.get(client.id);
      if (buyer) {
        const rows = confirmedAccounts.map((a: any) => ({
          company_id: profile.company_id,
          media_buyer_id: buyer.id,
          name: client.name,
          nickname: client.name,
          meta_ad_account_id: String(a.id).replace(/^act_/, ""),
          connected_via: "partner",
          status: "active",
        }));
        const { error } = await supabase.from("ad_accounts").upsert(rows, { onConflict: "meta_ad_account_id", ignoreDuplicates: true });
        if (!error) claimed.push({ business_id: client.id, business_name: client.name, media_buyer: buyer.name, ad_accounts: confirmedAccounts.length });
      } else {
        unclaimed.push({ business_id: client.id, business_name: client.name, ad_accounts: confirmedAccounts.map((a: any) => a.id) });
      }
    }

    return json({ business_id: businessId, claimed, unclaimed });
  } catch (err: any) {
    console.error("sync-partner-accounts error:", err);
    return json({ error: err.message }, 500);
  }
});
