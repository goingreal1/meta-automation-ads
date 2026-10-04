import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Powers the "AI Assistant" chat panel in dashboard_new.html.
//
// Two layers of grounding:
//  1. An upfront role-scoped DATA snapshot (buildXContext below) so common
//     questions ("which creative is winning?") answer in one round trip.
//  2. Real OpenAI function calling (TOOLS below) so the model can look up
//     anything NOT in that snapshot -- ad account balances, wallet balance,
//     pending fund requests -- and even take real actions (request funds,
//     approve a request), the same as clicking the matching button in the
//     dashboard itself. It can call several tools in a loop before answering.
//
// RLS on these tables is company-wide (everyone in a company can read every
// row), and this function uses the SERVICE ROLE key for its own queries
// (so it can act on the user's behalf), so every single query below filters
// explicitly by company_id -- and by media_buyer_id for a buyer -- rather
// than relying on RLS. Action tools additionally re-check the caller's role
// before doing anything, regardless of what the model asks for.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

function fmtNaira(n: number) {
  return "₦" + Math.round(n || 0).toLocaleString("en-NG");
}

type Ctx = { companyId: string; role: string; mediaBuyerId: string | null; deliveryAgentId: string | null; userId: string; displayName: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: "Not signed in" }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, role, display_name, media_buyer_id, delivery_agent_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.company_id) return json({ error: "No company on this account yet" }, 400);

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const question = (body?.question || "").toString().trim();
  if (!question) return json({ error: "A question is required" }, 400);
  // Short rolling history from the frontend (role/content pairs only) so a
  // follow-up like "yes, 50000" after the assistant asks "how much?" still
  // makes sense. Capped and sanitized -- never trust shape from the client.
  const history: { role: string; content: string }[] = Array.isArray(body?.history)
    ? body.history.filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string").slice(-12)
    : [];

  if (!OPENAI_API_KEY) {
    return json({
      answer: "AI chat isn't switched on yet for this workspace — an admin needs to add an OPENAI_API_KEY in Supabase (Project Settings → Edge Functions → Secrets) before I can answer questions.",
    });
  }

  const ctx: Ctx = {
    companyId: profile.company_id, role: profile.role, mediaBuyerId: profile.media_buyer_id,
    deliveryAgentId: profile.delivery_agent_id, userId: user.id, displayName: profile.display_name || "",
  };

  const { data: companyRow } = await supabase.from("companies").select("name").eq("id", ctx.companyId).maybeSingle();
  const companyName = companyRow?.name || "the company";

  let data: Record<string, unknown>;
  const sinceIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  try {
    if (ctx.role === "owner" || ctx.role === "admin") data = await buildAdminContext(ctx.companyId, sinceIso);
    else if (ctx.role === "buyer") data = await buildBuyerContext(ctx.companyId, ctx.mediaBuyerId, sinceIso);
    else if (ctx.role === "customer_care") data = await buildCareContext(ctx.companyId, sinceIso);
    else if (ctx.role === "delivery_agent") data = await buildDeliveryContext(ctx.companyId, ctx.deliveryAgentId, sinceIso);
    else data = { note: "No specific data view defined for this role yet." };
  } catch (e) {
    return json({ error: "Couldn't pull your data: " + (e as Error).message }, 500);
  }

  const roleLabel: Record<string, string> = {
    owner: "the company owner", admin: "an admin", buyer: "a media buyer",
    customer_care: "a customer care agent", delivery_agent: "a delivery agent",
  };

  const systemPrompt = `You are the AI assistant built into ${companyName}'s operations dashboard (a media-buying + order/delivery CRM for Nigerian e-commerce).
You are talking to ${ctx.displayName || "a team member"}, who is ${roleLabel[ctx.role] || ctx.role} at this company.

You have two sources of truth:
1. A DATA snapshot below (last 7 days unless noted) for common questions.
2. Tools you can call for anything not already in that snapshot, or to take a real action (request funds, approve a fund request). Prefer calling a tool over saying you don't have data — you very likely can look it up. Only say you can't help if a tool call genuinely comes back empty or errors.

Rules:
- Never invent numbers, names, balances or outcomes. Only state what the DATA or a tool result actually returned.
- Money is in Naira — use ₦.
- Be concise and direct: short paragraphs or bullet points, not a wall of text. This person is busy.
- For an action tool (request_funds, approve_fund_request): if the user already gave you what's needed (e.g. "request 50000 for TikTok ads"), just call it — don't ask for confirmation first, the same way clicking the button on the dashboard doesn't ask twice. Only ask a clarifying question if something required is actually missing (e.g. no amount given).
- request_funds only works for a buyer; approve_fund_request and list_pending_fund_requests only work for an owner/admin. If the signed-in person's role doesn't allow it, say so plainly instead of calling the tool.
- If you call list_ad_accounts and there's more than one account, list them clearly (name + balance) in your answer so the person can see all of them at once.
- For performance/KPI questions about a specific ad account (spend, CTR, orders, CPA, impressions, clicks) use get_ad_account_performance, not list_ad_accounts (that one only has balance). If the name is ambiguous it'll tell you the matches it found.
- query_data is your general-purpose lookup for anything else across the site: orders (search by customer name/phone, filter by status), ad sets, daily performance metrics, creatives, products, the leaderboard (media_buyers), pending approvals, AI call logs (voice_calls), and website leads. Use it instead of saying you don't have something.

DATA (JSON):
${JSON.stringify(data)}`;

  const TOOLS = [
    {
      type: "function", function: {
        name: "list_ad_accounts",
        description: "List Meta ad accounts (with their cached balance) visible to this user. Use for balance/status questions. For spend/CTR/orders/CPA use get_ad_account_performance instead.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function", function: {
        name: "get_ad_account_performance",
        description: "Get real KPIs for one ad account by name: total spend, orders, CTR, clicks, impressions, cost per order, plus a per-ad-set breakdown. Use this for any 'how is X account performing' / 'KPI' / 'metrics' question.",
        parameters: {
          type: "object",
          properties: {
            ad_account_name: { type: "string", description: "The ad account's name or nickname (partial match is fine, e.g. 'Femi tec' or 'BEYCEE')" },
            days: { type: "number", description: "How many days back to look. Defaults to 7." },
          },
          required: ["ad_account_name"],
        },
      },
    },
    {
      type: "function", function: {
        name: "query_data",
        description: "General-purpose lookup across the company's live data. Use for anything not covered by a more specific tool: find an order by customer name/phone, list orders by status, look up ad sets, creatives, products, pending approvals, AI call logs, website leads, or the buyer leaderboard.",
        parameters: {
          type: "object",
          properties: {
            table: {
              type: "string",
              enum: ["orders", "ad_sets", "daily_metrics", "creative_assets", "products", "media_buyers", "pending_approvals", "voice_calls", "website_leads"],
              description: "Which table to query.",
            },
            search: { type: "string", description: "Free-text search (e.g. a customer name, phone number, or ad set name) -- matched against that table's main name/identifier field." },
            filters: {
              type: "object",
              description: "Exact-match filters as {column: value} or {column: [value1,value2]} for 'one of these'. Only columns relevant to the chosen table are honored.",
              additionalProperties: true,
            },
            days: { type: "number", description: "Only return rows from the last N days (uses each table's own date column). Omit for no date filter." },
            limit: { type: "number", description: "Max rows to return, default 20, max 50." },
          },
          required: ["table"],
        },
      },
    },
    {
      type: "function", function: {
        name: "get_wallet_balance",
        description: "Get the funding wallet balance: company-wide breakdown for an owner/admin, or just the signed-in buyer's own balance for a buyer.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function", function: {
        name: "request_funds",
        description: "Submit a fund request for the signed-in buyer, exactly like clicking 'Request funds' on the Wallet tab. Buyer role only.",
        parameters: {
          type: "object",
          properties: {
            amount_naira: { type: "number", description: "Amount in Naira to request" },
            note: { type: "string", description: "Optional note on what it's for" },
          },
          required: ["amount_naira"],
        },
      },
    },
    {
      type: "function", function: {
        name: "list_pending_fund_requests",
        description: "List fund requests awaiting approval, with buyer name and amount. Owner/admin only.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function", function: {
        name: "approve_fund_request",
        description: "Approve a pending fund request by id, exactly like clicking 'Approve' on the Wallet tab. Owner/admin only.",
        parameters: {
          type: "object",
          properties: { fund_request_id: { type: "string", description: "The fund request's id, from list_pending_fund_requests" } },
          required: ["fund_request_id"],
        },
      },
    },
  ];

  const messages: any[] = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: question }];
  let quickReplies: string[] = [];

  try {
    for (let step = 0; step < 4; step++) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // This OpenAI project's key doesn't have access to the -mini/-nano
          // tiers (confirmed live: gpt-4o-mini/gpt-4.1-mini/gpt-4.1-nano/o4-mini
          // all 403 "does not have access to model") -- only gpt-4o and
          // gpt-3.5-turbo work on this account. Using gpt-4o for quality + tool use.
          model: "gpt-4o",
          messages,
          tools: TOOLS,
          tool_choice: "auto",
          temperature: 0.3,
          max_tokens: 600,
        }),
      });
      const out = await r.json();
      if (!r.ok) return json({ error: out?.error?.message || "AI request failed" }, 502);

      const msg = out?.choices?.[0]?.message;
      if (!msg) return json({ error: "AI returned no response" }, 502);
      messages.push(msg);

      if (!msg.tool_calls || !msg.tool_calls.length) {
        return json({ answer: msg.content?.trim() || "I couldn't generate a response from your data just now — try again.", quick_replies: quickReplies });
      }

      for (const tc of msg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* malformed args */ }
        const result = await runTool(tc.function.name, args, ctx);
        if (tc.function.name === "list_ad_accounts" && Array.isArray(result) && result.length > 1) {
          quickReplies = result.slice(0, 6).map((a: any) => `What's the balance on ${a.name}?`);
        }
        if (tc.function.name === "get_ad_account_performance" && (result as any)?.ambiguous) {
          quickReplies = ((result as any).matches || []).slice(0, 6).map((n: string) => `KPI for ${n}`);
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    }
    return json({ error: "That took too many steps to work out — try asking in a simpler way." }, 502);
  } catch (e) {
    return json({ error: "AI request failed: " + (e as Error).message }, 502);
  }
});

// ── Tool execution -- the same actions the dashboard's own buttons take ───

async function runTool(name: string, args: any, ctx: Ctx): Promise<unknown> {
  switch (name) {
    case "list_ad_accounts": {
      let q = supabase.from("ad_accounts")
        .select("id, name, nickname, status, balance_naira, balance_updated_at, low_balance_threshold_naira, media_buyer_id")
        .eq("company_id", ctx.companyId);
      if (ctx.role === "buyer") q = q.eq("media_buyer_id", ctx.mediaBuyerId);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return (data || []).map(a => ({
        id: a.id, name: a.name || a.nickname || a.id, status: a.status,
        balance: fmtNaira(a.balance_naira), balance_last_updated: a.balance_updated_at,
        low_balance_threshold: a.low_balance_threshold_naira != null ? fmtNaira(a.low_balance_threshold_naira) : null,
      }));
    }

    case "get_ad_account_performance": {
      const nameQuery = (args?.ad_account_name || "").toString().trim();
      if (!nameQuery) return { error: "ad_account_name is required." };
      const days = Math.min(Math.max(Number(args?.days) || 7, 1), 90);

      let acctQ = supabase.from("ad_accounts").select("id, name, nickname").eq("company_id", ctx.companyId)
        .or(`name.ilike.%${nameQuery}%,nickname.ilike.%${nameQuery}%`);
      if (ctx.role === "buyer") acctQ = acctQ.eq("media_buyer_id", ctx.mediaBuyerId);
      const { data: accounts, error: acctErr } = await acctQ.limit(10);
      if (acctErr) return { error: acctErr.message };
      if (!accounts || accounts.length === 0) return { error: `No ad account matching "${nameQuery}" found.` };
      if (accounts.length > 1) {
        return { ambiguous: true, matches: accounts.map(a => a.name || a.nickname || a.id) };
      }
      const account = accounts[0];

      const { data: adSets } = await supabase.from("ad_sets").select("id, adset_name, status").eq("ad_account_id", account.id).eq("company_id", ctx.companyId);
      const adSetIds = (adSets || []).map(a => a.id);
      if (!adSetIds.length) return { ad_account: account.name || account.nickname, note: "This ad account has no ad sets yet, so there's no performance data." };

      const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const { data: metrics, error: metErr } = await supabase.from("daily_metrics")
        .select("ad_set_id, spend_naira, impressions, clicks, ctr, orders, cost_per_order_naira, metric_date")
        .in("ad_set_id", adSetIds).gte("metric_date", sinceIso);
      if (metErr) return { error: metErr.message };

      const adSetNameById = new Map((adSets || []).map(a => [a.id, a.adset_name]));
      const perAdSet = new Map<string, { spend: number; orders: number; impressions: number; clicks: number }>();
      let totalSpend = 0, totalOrders = 0, totalImpressions = 0, totalClicks = 0;
      for (const m of metrics || []) {
        totalSpend += Number(m.spend_naira || 0);
        totalOrders += Number(m.orders || 0);
        totalImpressions += Number(m.impressions || 0);
        totalClicks += Number(m.clicks || 0);
        const p = perAdSet.get(m.ad_set_id) || { spend: 0, orders: 0, impressions: 0, clicks: 0 };
        p.spend += Number(m.spend_naira || 0); p.orders += Number(m.orders || 0);
        p.impressions += Number(m.impressions || 0); p.clicks += Number(m.clicks || 0);
        perAdSet.set(m.ad_set_id, p);
      }
      return {
        ad_account: account.name || account.nickname,
        period_days: days,
        spend: fmtNaira(totalSpend),
        orders: totalOrders,
        cost_per_order: totalOrders ? fmtNaira(totalSpend / totalOrders) : "n/a",
        ctr_pct: totalImpressions ? ((totalClicks / totalImpressions) * 100).toFixed(2) : "0.00",
        impressions: totalImpressions,
        clicks: totalClicks,
        per_ad_set: [...perAdSet.entries()].map(([id, p]) => ({
          ad_set: adSetNameById.get(id) || id, status: (adSets || []).find(a => a.id === id)?.status,
          spend: fmtNaira(p.spend), orders: p.orders, cost_per_order: p.orders ? fmtNaira(p.spend / p.orders) : "n/a",
        })),
      };
    }

    case "query_data": {
      return await runQueryData(args, ctx);
    }

    case "get_wallet_balance": {
      const [{ data: buyers }, { data: payments }, { data: fundRequests }, { data: withdrawals }] = await Promise.all([
        supabase.from("media_buyers").select("id, name").eq("company_id", ctx.companyId),
        supabase.from("payments").select("media_buyer_id, amount_naira, source").eq("company_id", ctx.companyId).eq("status", "confirmed"),
        supabase.from("fund_requests").select("media_buyer_id, amount_naira, status").eq("company_id", ctx.companyId),
        supabase.from("admin_withdrawals").select("amount_naira, status").eq("company_id", ctx.companyId),
      ]);
      const per: Record<string, { confirmed: number; approved: number; transferred: number }> = {};
      for (const b of buyers || []) per[b.id] = { confirmed: 0, approved: 0, transferred: 0 };
      let companyTopups = 0;
      for (const p of payments || []) {
        if (p.media_buyer_id) { per[p.media_buyer_id] = per[p.media_buyer_id] || { confirmed: 0, approved: 0, transferred: 0 }; per[p.media_buyer_id].confirmed += Number(p.amount_naira || 0); }
        else if (p.source === "admin_topup") companyTopups += Number(p.amount_naira || 0);
      }
      let approvedTotal = 0, transferredTotal = 0;
      for (const f of fundRequests || []) {
        if (f.status !== "approved" && f.status !== "transferred") continue;
        per[f.media_buyer_id] = per[f.media_buyer_id] || { confirmed: 0, approved: 0, transferred: 0 };
        if (f.status === "approved") { per[f.media_buyer_id].approved += Number(f.amount_naira || 0); approvedTotal += Number(f.amount_naira || 0); }
        else { per[f.media_buyer_id].transferred += Number(f.amount_naira || 0); transferredTotal += Number(f.amount_naira || 0); }
      }
      const withdrawnTotal = (withdrawals || []).filter(w => w.status === "sent").reduce((s, w) => s + Number(w.amount_naira || 0), 0);
      const fundingWalletBalance = companyTopups - approvedTotal - transferredTotal - withdrawnTotal;

      if (ctx.role === "buyer") {
        const mine = ctx.mediaBuyerId ? per[ctx.mediaBuyerId] || { confirmed: 0, approved: 0, transferred: 0 } : { confirmed: 0, approved: 0, transferred: 0 };
        return { your_confirmed_revenue: fmtNaira(mine.confirmed), your_approved_not_yet_sent: fmtNaira(mine.approved), your_transferred_to_ad_account: fmtNaira(mine.transferred) };
      }
      return {
        company_funding_wallet_balance: fmtNaira(fundingWalletBalance),
        company_total_topups: fmtNaira(companyTopups),
        approved_awaiting_transfer: fmtNaira(approvedTotal),
        already_transferred_to_ad_accounts: fmtNaira(transferredTotal),
        withdrawn_by_admin: fmtNaira(withdrawnTotal),
        per_buyer: (buyers || []).map(b => ({ name: b.name, confirmed_revenue: fmtNaira(per[b.id]?.confirmed || 0), approved_not_yet_sent: fmtNaira(per[b.id]?.approved || 0) })),
      };
    }

    case "request_funds": {
      if (ctx.role !== "buyer" || !ctx.mediaBuyerId) return { error: "Only a media buyer can request funds. This account isn't a buyer." };
      const amount = Number(args?.amount_naira);
      if (!amount || amount <= 0) return { error: "A valid positive amount_naira is required." };
      const { data: inserted, error } = await supabase.from("fund_requests").insert({
        company_id: ctx.companyId, media_buyer_id: ctx.mediaBuyerId, amount_naira: amount, note: args?.note || null,
      }).select().single();
      if (error) return { error: "Could not submit request: " + error.message };
      // Same notifications the dashboard's own "Request funds" button fires -- fire-and-forget.
      fetch(`${SUPABASE_URL}/functions/v1/send-internal-whatsapp`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "fund_request_submitted", fund_request_id: inserted.id }) }).catch(() => {});
      fetch(`${SUPABASE_URL}/functions/v1/send-internal-email`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "fund_request_submitted", fund_request_id: inserted.id }) }).catch(() => {});
      return { ok: true, submitted: { id: inserted.id, amount: fmtNaira(amount), note: args?.note || null, status: "pending" } };
    }

    case "list_pending_fund_requests": {
      if (ctx.role !== "owner" && ctx.role !== "admin") return { error: "Only an owner/admin can see pending fund requests." };
      const { data: requests, error } = await supabase.from("fund_requests").select("id, media_buyer_id, amount_naira, note, requested_at").eq("company_id", ctx.companyId).eq("status", "pending").order("requested_at", { ascending: true });
      if (error) return { error: error.message };
      const { data: buyers } = await supabase.from("media_buyers").select("id, name").eq("company_id", ctx.companyId);
      const nameById = new Map((buyers || []).map(b => [b.id, b.name]));
      return (requests || []).map(r => ({ fund_request_id: r.id, buyer: nameById.get(r.media_buyer_id) || "Unknown", amount: fmtNaira(r.amount_naira), note: r.note, requested_at: r.requested_at }));
    }

    case "approve_fund_request": {
      if (ctx.role !== "owner" && ctx.role !== "admin") return { error: "Only an owner/admin can approve fund requests." };
      const id = args?.fund_request_id;
      if (!id) return { error: "fund_request_id is required." };
      const { data: existing } = await supabase.from("fund_requests").select("id, company_id, status, amount_naira, media_buyer_id").eq("id", id).maybeSingle();
      if (!existing || existing.company_id !== ctx.companyId) return { error: "Fund request not found." };
      if (existing.status !== "pending") return { error: `This request is already "${existing.status}", not pending.` };
      const { error } = await supabase.from("fund_requests").update({ status: "approved", decided_at: new Date().toISOString(), decided_by: ctx.userId }).eq("id", id);
      if (error) return { error: error.message };
      return { ok: true, approved: { fund_request_id: id, amount: fmtNaira(existing.amount_naira) } };
    }

    default:
      return { error: "Unknown tool: " + name };
  }
}

// ── query_data: one generic, safe lookup tool covering most of the rest of
// the site (orders, ad sets, metrics, creatives, products, leaderboard,
// approvals, call logs, website leads). Every table is allow-listed by
// name, selectable columns, filterable columns and which roles may see it
// at all -- mirroring what that role already sees in the dashboard's own
// tabs (HIDDEN_TABS_BY_ROLE in dashboard_new.html). company_id is always
// forced server-side; a buyer additionally gets forced to their own rows
// where the table has an owner column, regardless of what's asked. ───────

type TableConfig = {
  columns: string[];
  allowedRoles: string[];
  buyerCol?: string;
  deliveryCol?: string;
  dateCol?: string;
  filterable: string[];
  searchCols?: string[];
};

const TABLE_CONFIGS: Record<string, TableConfig> = {
  orders: {
    columns: ["id", "customer_name", "customer_phone", "customer_city", "customer_state", "product_name", "quantity", "order_value_naira", "order_status", "payment_method", "media_buyer_id", "delivery_agent_id", "assignment_status", "possible_duplicate", "followup_attempts", "ordered_at", "delivered_at"],
    allowedRoles: ["owner", "admin", "buyer", "customer_care", "delivery_agent"],
    buyerCol: "media_buyer_id", deliveryCol: "delivery_agent_id", dateCol: "ordered_at",
    filterable: ["order_status", "media_buyer_id", "delivery_agent_id", "possible_duplicate", "assignment_status"],
    searchCols: ["customer_name", "customer_phone"],
  },
  ad_sets: {
    columns: ["id", "adset_name", "campaign_id", "creative_id", "status", "media_buyer_id", "ad_account_id", "budget_naira", "targeting_type", "created_at"],
    allowedRoles: ["owner", "admin", "buyer"],
    buyerCol: "media_buyer_id", dateCol: "created_at",
    filterable: ["status", "media_buyer_id", "ad_account_id", "campaign_id"],
    searchCols: ["adset_name"],
  },
  daily_metrics: {
    columns: ["ad_set_id", "metric_date", "spend_naira", "impressions", "clicks", "ctr", "cpc_naira", "cpm_naira", "orders", "cost_per_order_naira", "frequency"],
    allowedRoles: ["owner", "admin", "buyer"],
    dateCol: "metric_date",
    filterable: ["ad_set_id"],
  },
  creative_assets: {
    columns: ["id", "headline", "file_name", "asset_type", "test_status", "campaign_name", "product_id", "uploaded_at"],
    allowedRoles: ["owner", "admin", "buyer"],
    dateCol: "uploaded_at",
    filterable: ["test_status", "product_id"],
    searchCols: ["headline", "file_name", "campaign_name"],
  },
  products: {
    columns: ["id", "product_name", "default_order_value_naira", "currency", "is_active", "stock_on_hand", "low_stock_threshold", "destination_type"],
    allowedRoles: ["owner", "admin", "buyer", "customer_care"],
    filterable: ["is_active"],
    searchCols: ["product_name"],
  },
  media_buyers: {
    columns: ["id", "name", "code", "active"],
    allowedRoles: ["owner", "admin", "buyer"],
    filterable: ["active"],
    searchCols: ["name"],
  },
  pending_approvals: {
    columns: ["id", "approval_type", "reason", "status", "requested_at", "responded_at"],
    allowedRoles: ["owner", "admin", "buyer"],
    dateCol: "requested_at",
    filterable: ["status", "approval_type"],
  },
  voice_calls: {
    columns: ["id", "order_id", "status", "summary", "needs_human", "duration_secs", "created_at"],
    allowedRoles: ["owner", "admin", "customer_care"],
    dateCol: "created_at",
    filterable: ["status", "needs_human"],
  },
  website_leads: {
    columns: ["id", "name", "phone", "product_name", "city", "state", "package", "status", "created_at"],
    allowedRoles: ["owner", "admin", "customer_care"],
    dateCol: "created_at",
    filterable: ["status"],
    searchCols: ["name", "phone"],
  },
};

async function runQueryData(args: any, ctx: Ctx): Promise<unknown> {
  const table = (args?.table || "").toString();
  const cfg = TABLE_CONFIGS[table];
  if (!cfg) return { error: `Unknown table "${table}". Allowed: ${Object.keys(TABLE_CONFIGS).join(", ")}` };
  if (!cfg.allowedRoles.includes(ctx.role)) return { error: `Your role (${ctx.role}) isn't allowed to query ${table}.` };

  let q = supabase.from(table).select(cfg.columns.join(", ")).eq("company_id", ctx.companyId);

  if (ctx.role === "buyer" && cfg.buyerCol) q = q.eq(cfg.buyerCol, ctx.mediaBuyerId);
  if (ctx.role === "delivery_agent") {
    if (table !== "orders" || !cfg.deliveryCol) return { error: "As a delivery agent you can only query your own orders." };
    q = q.eq(cfg.deliveryCol, ctx.deliveryAgentId);
  }

  // daily_metrics has no owning-buyer column of its own -- scope a buyer to
  // metrics on just their own ad sets instead.
  if (table === "daily_metrics" && ctx.role === "buyer") {
    const { data: myAdSets } = await supabase.from("ad_sets").select("id").eq("company_id", ctx.companyId).eq("media_buyer_id", ctx.mediaBuyerId);
    const ids = (myAdSets || []).map(a => a.id);
    if (!ids.length) return [];
    q = q.in("ad_set_id", ids);
  }

  const filters = args?.filters && typeof args.filters === "object" ? args.filters : {};
  for (const [col, val] of Object.entries(filters)) {
    if (!cfg.filterable.includes(col)) continue;
    q = Array.isArray(val) ? q.in(col, val) : q.eq(col, val as any);
  }

  if (args?.search && cfg.searchCols?.length) {
    const term = String(args.search).trim();
    if (term) q = q.or(cfg.searchCols.map(c => `${c}.ilike.%${term}%`).join(","));
  }

  if (args?.days && cfg.dateCol) {
    const sinceDate = new Date(Date.now() - Math.min(Number(args.days) || 7, 365) * 24 * 3600 * 1000).toISOString();
    q = q.gte(cfg.dateCol, cfg.dateCol === "metric_date" ? sinceDate.slice(0, 10) : sinceDate);
  }

  const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 50);
  q = q.limit(limit);
  if (cfg.dateCol) q = q.order(cfg.dateCol, { ascending: false });

  const { data, error } = await q;
  if (error) return { error: error.message };
  return data;
}

// ── Role-scoped upfront context builders ──────────────────────────────────

async function buildAdminContext(companyId: string, sinceIso: string) {
  const [{ data: buyers }, { data: adSets }, { data: metrics }, { data: orders }, { data: calls }, { data: approvals }, { data: creatives }] = await Promise.all([
    supabase.from("media_buyers").select("id, name, code").eq("company_id", companyId).eq("active", true),
    supabase.from("ad_sets").select("id, adset_name, media_buyer_id, creative_id, status, campaign_id").eq("company_id", companyId).limit(500),
    supabase.from("daily_metrics").select("ad_set_id, spend_naira, orders, ctr, cost_per_order_naira, metric_date").eq("company_id", companyId).gte("metric_date", sinceIso.slice(0, 10)).limit(2000),
    supabase.from("orders").select("id, media_buyer_id, ad_set_id, creative_id, order_status, order_value_naira, possible_duplicate, followup_attempts, ordered_at").eq("company_id", companyId).gte("ordered_at", sinceIso).limit(2000),
    supabase.from("voice_calls").select("status, needs_human").eq("company_id", companyId).gte("created_at", sinceIso).limit(2000),
    supabase.from("pending_approvals").select("id").eq("company_id", companyId).eq("status", "pending"),
    supabase.from("creative_assets").select("id, headline, file_name").eq("company_id", companyId).limit(500),
  ]);

  const adSetById = new Map((adSets || []).map(a => [a.id, a]));
  const creativeById = new Map((creatives || []).map(c => [c.id, c]));

  const buyerStats = new Map<string, { name: string; code: string; spend: number; orders: number; delivered: number; value: number }>();
  for (const b of buyers || []) buyerStats.set(b.id, { name: b.name, code: b.code, spend: 0, orders: 0, delivered: 0, value: 0 });
  for (const m of metrics || []) {
    const buyerId = adSetById.get(m.ad_set_id)?.media_buyer_id;
    if (buyerId && buyerStats.has(buyerId)) buyerStats.get(buyerId)!.spend += Number(m.spend_naira || 0);
  }
  for (const o of orders || []) {
    if (o.media_buyer_id && buyerStats.has(o.media_buyer_id)) {
      const s = buyerStats.get(o.media_buyer_id)!;
      s.orders++;
      s.value += Number(o.order_value_naira || 0);
      if (o.order_status === "delivered") s.delivered++;
    }
  }

  const ordersByAdSet = new Map<string, number>();
  const ordersByCreative = new Map<string, number>();
  for (const o of orders || []) {
    if (o.ad_set_id) ordersByAdSet.set(o.ad_set_id, (ordersByAdSet.get(o.ad_set_id) || 0) + 1);
    if (o.creative_id) ordersByCreative.set(o.creative_id, (ordersByCreative.get(o.creative_id) || 0) + 1);
  }
  const topAdSets = [...ordersByAdSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, n]) => ({ ad_set: adSetById.get(id)?.adset_name || id, orders: n }));
  const topCreatives = [...ordersByCreative.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, n]) => ({ creative: creativeById.get(id)?.headline || creativeById.get(id)?.file_name || id, orders: n }));

  const callStatusCounts: Record<string, number> = {};
  let needsHuman = 0;
  for (const c of calls || []) { callStatusCounts[c.status] = (callStatusCounts[c.status] || 0) + 1; if (c.needs_human) needsHuman++; }

  return {
    period: "last 7 days",
    buyers: [...buyerStats.values()].map(s => ({
      name: s.name, code: s.code, spend: fmtNaira(s.spend), orders: s.orders, delivered: s.delivered,
      order_value: fmtNaira(s.value), cpa: s.orders ? fmtNaira(s.spend / s.orders) : "n/a",
    })),
    top_ad_sets_by_orders: topAdSets,
    top_creatives_by_orders: topCreatives,
    ai_call_agent_outcomes_last_7_days: callStatusCounts,
    calls_flagged_needing_a_human: needsHuman,
    pending_approvals_awaiting_review: (approvals || []).length,
    possible_duplicate_orders: (orders || []).filter(o => o.possible_duplicate).length,
    orders_stuck_after_followup_attempts: (orders || []).filter(o => (o.followup_attempts || 0) > 0).length,
    total_orders_last_7_days: (orders || []).length,
  };
}

async function buildBuyerContext(companyId: string, mediaBuyerId: string | null, sinceIso: string) {
  if (!mediaBuyerId) return { note: "This account isn't linked to a media buyer profile yet, so there's no campaign/order data to show." };

  const [{ data: adSets }, { data: creatives }, { data: orders }] = await Promise.all([
    supabase.from("ad_sets").select("id, adset_name, creative_id, status").eq("company_id", companyId).eq("media_buyer_id", mediaBuyerId).limit(300),
    supabase.from("creative_assets").select("id, headline, file_name").eq("company_id", companyId).limit(300),
    supabase.from("orders").select("id, order_status, order_value_naira, ad_set_id, creative_id, ordered_at, delivery_agent_id, assignment_status").eq("company_id", companyId).eq("media_buyer_id", mediaBuyerId).gte("ordered_at", sinceIso).limit(1000),
  ]);
  const adSetIds = (adSets || []).map(a => a.id);
  const { data: metrics } = adSetIds.length
    ? await supabase.from("daily_metrics").select("ad_set_id, spend_naira, ctr, cost_per_order_naira, orders, metric_date").in("ad_set_id", adSetIds).gte("metric_date", sinceIso.slice(0, 10)).limit(2000)
    : { data: [] as any[] };

  const adSetById = new Map((adSets || []).map(a => [a.id, a]));
  const creativeById = new Map((creatives || []).map(c => [c.id, c]));

  const totalSpend = (metrics || []).reduce((s, m) => s + Number(m.spend_naira || 0), 0);
  const avgCtr = (metrics || []).length ? (metrics || []).reduce((s, m) => s + Number(m.ctr || 0), 0) / (metrics || []).length : 0;

  const ordersByAdSet = new Map<string, number>();
  for (const o of orders || []) if (o.ad_set_id) ordersByAdSet.set(o.ad_set_id, (ordersByAdSet.get(o.ad_set_id) || 0) + 1);
  const topAdSets = [...ordersByAdSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, n]) => ({ ad_set: adSetById.get(id)?.adset_name || id, orders: n, creative: creativeById.get(adSetById.get(id)?.creative_id)?.headline || null }));

  const orderIds = (orders || []).map(o => o.id);
  const { data: calls } = orderIds.length
    ? await supabase.from("voice_calls").select("order_id, status").in("order_id", orderIds).gte("created_at", sinceIso).limit(1000)
    : { data: [] as any[] };
  const callStatusCounts: Record<string, number> = {};
  for (const c of calls || []) callStatusCounts[c.status] = (callStatusCounts[c.status] || 0) + 1;
  const ordersWithDeliveryAgent = (orders || []).filter(o => o.delivery_agent_id).length;
  const ordersAwaitingRiderAcceptance = (orders || []).filter(o => o.assignment_status === "offered").length;

  return {
    period: "last 7 days",
    campaigns_summary: { active_ad_sets: (adSets || []).filter(a => a.status === "active" || a.status === "ACTIVE").length, total_ad_sets: (adSets || []).length, spend: fmtNaira(totalSpend), avg_ctr_pct: avgCtr.toFixed(2) },
    top_ad_sets_by_orders: topAdSets,
    orders_summary: {
      total: (orders || []).length,
      delivered: (orders || []).filter(o => o.order_status === "delivered").length,
      pending: (orders || []).filter(o => o.order_status === "pending").length,
      value: fmtNaira((orders || []).reduce((s, o) => s + Number(o.order_value_naira || 0), 0)),
    },
    ai_call_agent_on_new_orders: {
      calls_made: (calls || []).length,
      outcomes: callStatusCounts,
      note: "Every new order automatically gets an AI call attempt to confirm it; outcomes are also visible to Customer Care in the Support Queue, and confirmed orders move to a delivery agent for dispatch.",
    },
    delivery_handoff: { orders_assigned_to_a_delivery_agent: ordersWithDeliveryAgent, orders_awaiting_rider_acceptance: ordersAwaitingRiderAcceptance },
  };
}

async function buildCareContext(companyId: string, sinceIso: string) {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, customer_name, customer_phone, order_status, possible_duplicate, followup_attempts, ordered_at")
    .eq("company_id", companyId)
    .gte("ordered_at", sinceIso)
    .limit(1000);
  const orderById = new Map((orders || []).map(o => [o.id, o]));

  const { data: calls } = await supabase
    .from("voice_calls")
    .select("order_id, status, summary, red_flags, needs_human, created_at")
    .eq("company_id", companyId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(500);

  const needsAttention = (calls || [])
    .filter(c => c.needs_human || c.status === "failed" || c.status === "no_answer")
    .slice(0, 20)
    .map(c => ({
      customer: orderById.get(c.order_id)?.customer_name || "Unknown",
      phone: orderById.get(c.order_id)?.customer_phone || null,
      call_status: c.status, needs_human: c.needs_human, red_flags: c.red_flags, summary: c.summary,
    }));

  const duplicates = (orders || []).filter(o => o.possible_duplicate)
    .map(o => ({ customer: o.customer_name, phone: o.customer_phone, status: o.order_status }));
  const stuck = (orders || []).filter(o => (o.followup_attempts || 0) > 0)
    .map(o => ({ customer: o.customer_name, phone: o.customer_phone, status: o.order_status, followup_attempts: o.followup_attempts }));

  return {
    period: "last 7 days",
    calls_needing_a_human_right_now: needsAttention,
    possible_duplicate_orders: duplicates,
    stuck_orders_after_followup_attempts: stuck,
    totals: { orders_last_7_days: (orders || []).length, calls_last_7_days: (calls || []).length },
  };
}

async function buildDeliveryContext(companyId: string, deliveryAgentId: string | null, sinceIso: string) {
  if (!deliveryAgentId) return { note: "This account isn't linked to a delivery agent profile yet." };
  const { data: orders } = await supabase
    .from("orders")
    .select("id, customer_name, customer_city, order_status, assignment_status, order_value_naira, ordered_at")
    .eq("company_id", companyId)
    .eq("delivery_agent_id", deliveryAgentId)
    .gte("ordered_at", sinceIso)
    .limit(500);
  return {
    period: "last 7 days",
    awaiting_your_acceptance: (orders || []).filter(o => o.assignment_status === "offered").map(o => ({ customer: o.customer_name, city: o.customer_city })),
    active_deliveries: (orders || []).filter(o => o.assignment_status === "accepted" && o.order_status !== "delivered").length,
    delivered_this_period: (orders || []).filter(o => o.order_status === "delivered").length,
  };
}
