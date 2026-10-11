import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Revora HQ: a read-only view across every company, for platform admins only (table platform_admins).
//   POST { action: "overview" | "companies" | "company" | "accounts" | "money", company_id? }  (Authorization: user session)
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
const sum = (rows: any[] | null, k: string) => (rows ?? []).reduce((t, r) => t + Number(r[k] || 0), 0);
const count = async (table: string, f?: (q: any) => any) => { let q = db.from(table).select("id", { count: "exact", head: true }); if (f) q = f(q); return (await q).count ?? 0; };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" } });
  try {
    const { data: u } = await db.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const { data: pa } = await db.from("platform_admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (!pa) return json({ error: "Not allowed." }, 403);
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    const { data: companies } = await db.from("companies").select("id, name, plan, account_type, created_at, dedicated_account_number").order("created_at", { ascending: false }).limit(500);
    const coName = new Map((companies ?? []).map((c: any) => [c.id, c.name]));
    const { data: buyers } = await db.from("media_buyers").select("id, name, code, company_id, active, dedicated_account_number");
    const buyerName = new Map((buyers ?? []).map((b: any) => [b.id, b.name]));

    if (action === "overview") {
      const [users, managed, own, poolFree, poolSold, poolRetired] = await Promise.all([
        count("profiles"), count("ad_accounts", q => q.eq("billing_mode", "managed")), count("ad_accounts", q => q.neq("billing_mode", "managed")),
        count("sellable_ad_accounts", q => q.eq("status", "available")), count("sellable_ad_accounts", q => q.not("assigned_company_id", "is", null)), count("sellable_ad_accounts", q => q.eq("status", "retired")),
      ]);
      const { data: tops } = await db.from("wallet_topups").select("amount_naira").eq("status", "confirmed");
      const { data: fees } = await db.from("wallet_adjustments").select("amount_naira").eq("reason", "ad_account_fee");
      const { data: earn } = await db.rpc("managed_earnings", { p_days: 30 });
      const { data: accts } = await db.from("ad_accounts").select("id").eq("billing_mode", "managed");
      let spend = 0;
      for (const a of accts ?? []) { const { data } = await db.rpc("account_billed_spend", { p_account: a.id }); spend += Number(data ?? 0); }
      const { count: pendReq } = await db.from("wallet_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
      return json({ companies: (companies ?? []).length, users, buyers: (buyers ?? []).length, managed_accounts: managed, own_accounts: own, pool: { free: poolFree, sold: poolSold, retired: poolRetired },
        card_topups: sum(tops, "amount_naira"), account_fees: sum(fees, "amount_naira"), managed_spend_billed: spend,
        earnings_30d: { billed: sum(earn, "billed"), raw: sum(earn, "raw"), profit: sum(earn, "profit") }, pending_wallet_requests: pendReq ?? 0 });
    }

    if (action === "companies") {
      const { data: profs } = await db.from("profiles").select("company_id, role");
      const { data: accts } = await db.from("ad_accounts").select("company_id, billing_mode");
      const rows = (companies ?? []).map((c: any) => {
        const p = (profs ?? []).filter((x: any) => x.company_id === c.id), a = (accts ?? []).filter((x: any) => x.company_id === c.id);
        return { id: c.id, name: c.name, plan: c.plan, type: c.account_type, created_at: c.created_at, users: p.length, buyers: (buyers ?? []).filter((b: any) => b.company_id === c.id).length,
          managed: a.filter((x: any) => x.billing_mode === "managed").length, own: a.filter((x: any) => x.billing_mode !== "managed").length };
      });
      return json({ companies: rows });
    }

    if (action === "company") {
      const id = String(body.company_id ?? "");
      const { data: profs } = await db.from("profiles").select("id, display_name, role, media_buyer_id, created_at, whatsapp_number").eq("company_id", id);
      const people = [];
      for (const p of profs ?? []) { const { data: au } = await db.auth.admin.getUserById(p.id); people.push({ ...p, email: au?.user?.email ?? null, last_sign_in: au?.user?.last_sign_in_at ?? null, buyer: buyerName.get(p.media_buyer_id) ?? null }); }
      const { data: accts } = await db.from("ad_accounts").select("id, nickname, name, meta_ad_account_id, status, billing_mode, media_buyer_id, fb_page_name, meta_pixel_id, created_at").eq("company_id", id);
      const accounts = [];
      for (const a of accts ?? []) { const spent = a.billing_mode === "managed" ? Number((await db.rpc("account_billed_spend", { p_account: a.id })).data ?? 0) : null; accounts.push({ ...a, buyer: buyerName.get(a.media_buyer_id) ?? null, billed_spend: spent }); }
      const cb = Number((await db.rpc("company_wallet_balance", { p_company: id })).data ?? 0);
      const bw = [];
      for (const b of (buyers ?? []).filter((x: any) => x.company_id === id)) bw.push({ id: b.id, name: b.name, wallet: Number((await db.rpc("buyer_wallet_balance", { p_buyer: b.id })).data ?? 0), payment_account: b.dedicated_account_number });
      return json({ company: (companies ?? []).find((c: any) => c.id === id) ?? null, people, accounts, company_wallet: cb, buyer_wallets: bw });
    }

    if (action === "accounts") {
      const { data: pool } = await db.from("sellable_ad_accounts").select("id, meta_ad_account_id, label, meta_name, status, assigned_company_id, assigned_at").order("created_at", { ascending: false }).limit(300);
      const { data: sold } = await db.from("ad_accounts").select("id, nickname, name, meta_ad_account_id, status, company_id, media_buyer_id, created_at, markup_pct").eq("billing_mode", "managed").order("created_at", { ascending: false }).limit(300);
      const rows = [];
      for (const a of sold ?? []) rows.push({ ...a, company: coName.get(a.company_id) ?? "", buyer: buyerName.get(a.media_buyer_id) ?? null, billed_spend: Number((await db.rpc("account_billed_spend", { p_account: a.id })).data ?? 0) });
      return json({ sold: rows, pool: (pool ?? []).map((p: any) => ({ ...p, company: coName.get(p.assigned_company_id) ?? null })) });
    }

    if (action === "money") {
      const { data: tops } = await db.from("wallet_topups").select("id, company_id, media_buyer_id, amount_naira, status, channel, created_at").order("created_at", { ascending: false }).limit(60);
      const { data: reqs } = await db.from("wallet_requests").select("id, company_id, media_buyer_id, amount_naira, status, requested_at").order("requested_at", { ascending: false }).limit(40);
      const { data: adj } = await db.from("wallet_adjustments").select("id, company_id, media_buyer_id, amount_naira, reason, created_at").order("created_at", { ascending: false }).limit(60);
      const { data: wd } = await db.from("admin_withdrawals").select("id, company_id, amount_naira, status, created_at").order("created_at", { ascending: false }).limit(30);
      const decorate = (r: any) => ({ ...r, company: coName.get(r.company_id) ?? "", buyer: buyerName.get(r.media_buyer_id) ?? null });
      const wallets = [];
      for (const b of buyers ?? []) wallets.push({ company: coName.get(b.company_id) ?? "", buyer: b.name, wallet: Number((await db.rpc("buyer_wallet_balance", { p_buyer: b.id })).data ?? 0) });
      return json({ topups: (tops ?? []).map(decorate), requests: (reqs ?? []).map(decorate), adjustments: (adj ?? []).map(decorate), withdrawals: (wd ?? []).map(decorate), buyer_wallets: wallets });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
