import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Links a customer's Facebook Page to one of their ad accounts from the Page ID they paste.
//   POST { ad_account_id, page_id }  (Authorization: user session)
// The Page must already be shared with Revora's Business Manager and usable by that ad account, and one Page can only belong to one company.
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const BM = Deno.env.get("META_BUSINESS_ID") ?? "";
const G = "https://graph.facebook.com/v21.0";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
const get = async (path: string) => (await fetch(`${G}/${path}${path.includes("?") ? "&" : "?"}access_token=${TOKEN}`)).json().catch(() => ({}));

async function allIds(path: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let next: string | null = `${G}/${path}${path.includes("?") ? "&" : "?"}fields=id&limit=200&access_token=${TOKEN}`;
  for (let i = 0; next && i < 10; i++) {
    const j: any = await fetch(next).then(r => r.json()).catch(() => ({}));
    for (const x of j?.data ?? []) ids.add(String(x.id));
    next = j?.paging?.next ?? null;
  }
  return ids;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" } });
  try {
    if (!TOKEN) return json({ error: "Meta isn't connected." }, 500);
    const { data: u } = await db.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await db.from("profiles").select("company_id, role").eq("id", u.user.id).maybeSingle();
    if (!me?.company_id || !["owner", "admin", "buyer"].includes(me.role)) return json({ error: "Not allowed." }, 403);
    const body = await req.json().catch(() => ({}));
    const pageId = String(body.page_id ?? "").replace(/\D/g, "");
    if (pageId.length < 8) return json({ error: "That doesn't look like a Page ID. It's a long number, found in the Page's About section." }, 400);
    const { data: acc } = await db.from("ad_accounts").select("id, company_id, meta_ad_account_id, fb_page_id").eq("id", String(body.ad_account_id ?? "")).maybeSingle();
    if (!acc || acc.company_id !== me.company_id) return json({ error: "Unknown ad account." }, 404);

    // One Page, one company.
    const { data: taken } = await db.from("ad_accounts").select("id").eq("fb_page_id", pageId).neq("company_id", me.company_id).limit(1);
    if (taken?.length) return json({ status: "taken", error: "That Page is already linked to another Revora company. If it's yours, contact support." }, 409);

    const act = String(acc.meta_ad_account_id).replace(/\D/g, "");
    const usable = await allIds(`act_${act}/promote_pages`);
    if (!usable.has(pageId)) {
      const shared = BM ? await allIds(`${BM}/client_pages`) : new Set<string>();
      if (shared.has(pageId)) return json({ status: "not_usable", business_id: BM || null, error: "We can see that Page, but this ad account can't advertise as it yet. Make sure you gave Revora permission to create ads on the Page, then try again." });
      return json({ status: "not_shared", business_id: BM || null, error: `Share that Page with Revora first (Business Settings → Pages → Add partner${BM ? ", Business ID " + BM : ""}), then try again.` });
    }
    const page: any = await get(`${pageId}?fields=name,whatsapp_number`);
    const { error } = await db.from("ad_accounts").update({
      fb_page_id: pageId, fb_page_name: page?.name ?? null, whatsapp_number: page?.whatsapp_number ?? null, connection_verified_at: new Date().toISOString(),
    }).eq("id", acc.id);
    if (error) return json({ error: error.message }, 500);
    return json({ status: "linked", page_id: pageId, page_name: page?.name ?? null });
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
