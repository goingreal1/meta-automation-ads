import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Registers the bank account a buyer wants their approved wallet balance
// transferred INTO (Meta's bank account for topping up their own ad
// account's billing) -- and refuses to save it unless Paystack's own
// account-resolve API confirms the name on that account actually says
// "Facebook"/"Meta". This is the one guardrail that makes it safe to let a
// non-admin trigger a real transfer later: no matter what account number
// they type, we never record (or later pay) an account that doesn't
// resolve to Meta's own name.
//
//   POST { media_buyer_id, account_number, bank_code } ->
//     { verified: true, account_name } | { verified: false, account_name, reason }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const PAYSTACK_BASE = "https://api.paystack.co";
const ALLOWED_NAME_PATTERN = /facebook|meta/i;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function paystackFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.status === false) {
    throw new Error(body?.message || `Paystack ${path} failed (${res.status})`);
  }
  return body;
}

async function isAuthorized(req: Request, mediaBuyerId: string): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData?.user) return false;
  const { data: profile } = await supabase.from("profiles").select("role, media_buyer_id").eq("id", userData.user.id).maybeSingle();
  if (!profile) return false;
  if (profile.role === "owner" || profile.role === "admin") return true;
  return profile.role === "buyer" && profile.media_buyer_id === mediaBuyerId;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!PAYSTACK_SECRET_KEY) return json({ error: "PAYSTACK_SECRET_KEY isn't configured yet." }, 500);

  try {
    const { media_buyer_id, account_number, bank_code } = await req.json();
    if (!media_buyer_id || !account_number || !bank_code) {
      return json({ error: "media_buyer_id, account_number and bank_code are required" }, 400);
    }
    if (!(await isAuthorized(req, media_buyer_id))) return json({ error: "Unauthorized" }, 401);

    const { data: buyer } = await supabase.from("media_buyers").select("id, company_id, name").eq("id", media_buyer_id).maybeSingle();
    if (!buyer) return json({ error: "Media buyer not found" }, 404);

    const resolved = await paystackFetch(`/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`);
    const accountName = resolved?.data?.account_name ?? "";

    if (!ALLOWED_NAME_PATTERN.test(accountName)) {
      return json({ verified: false, account_name: accountName, reason: "This account isn't registered to Facebook/Meta -- we only accept transfers into Meta's own ad billing account." });
    }

    const bankList = await paystackFetch("/bank?country=nigeria").catch(() => ({ data: [] }));
    const bankName = (bankList?.data ?? []).find((b: any) => b.code === bank_code)?.name ?? bank_code;

    const recipient = await paystackFetch("/transferrecipient", {
      method: "POST",
      body: JSON.stringify({
        type: "nuban",
        name: accountName,
        account_number,
        bank_code,
        currency: "NGN",
        description: `Meta Ads top-up destination for ${buyer.name}`,
      }),
    });

    const { error: updErr } = await supabase.from("media_buyers").update({
      meta_ads_bank_account_number: account_number,
      meta_ads_bank_code: bank_code,
      meta_ads_bank_name: bankName,
      meta_ads_account_name: accountName,
      meta_ads_verified: true,
      meta_ads_recipient_code: recipient?.data?.recipient_code ?? null,
    }).eq("id", buyer.id);
    if (updErr) throw updErr;

    return json({ verified: true, account_name: accountName, bank_name: bankName });
  } catch (err: any) {
    console.error("paystack-verify-meta-account error:", err);
    return json({ error: err.message }, 500);
  }
});
