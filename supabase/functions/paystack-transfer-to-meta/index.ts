import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Executes the real money movement a buyer triggers themselves from the
// dashboard: sending their own already-approved wallet balance to their own
// verified Meta/Facebook ad account bank destination, to top up ad spend.
// Deliberately narrow about what it will move:
//   - the fund_requests row must already be admin-approved (never pending),
//     must belong to the caller's own buyer when the caller isn't an admin,
//     and must not already have a transfer attached;
//   - the destination must be the buyer's own meta_ads_* record, which only
//     paystack-verify-meta-account can set, and only after Paystack's own
//     account-resolve confirmed the name says Facebook/Meta.
// There is no path here for moving money to any other account.
//
//   POST { fund_request_id } -> { ok: true, transfer_code } | { error }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const PAYSTACK_BASE = "https://api.paystack.co";

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

async function authedProfile(req: Request): Promise<{ id: string; role: string; media_buyer_id: string | null } | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData?.user) return null;
  const { data: profile } = await supabase.from("profiles").select("id, role, media_buyer_id").eq("id", userData.user.id).maybeSingle();
  return profile ?? null;
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
    const { fund_request_id } = await req.json();
    if (!fund_request_id) return json({ error: "fund_request_id is required" }, 400);

    const profile = await authedProfile(req);
    if (!profile) return json({ error: "Unauthorized" }, 401);

    const { data: fr } = await supabase.from("fund_requests").select("*").eq("id", fund_request_id).maybeSingle();
    if (!fr) return json({ error: "Funding request not found" }, 404);

    const isAdmin = profile.role === "owner" || profile.role === "admin";
    if (!isAdmin && !(profile.role === "buyer" && profile.media_buyer_id === fr.media_buyer_id)) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (fr.status !== "approved") return json({ error: `This request is ${fr.status}, not approved -- nothing to transfer.` }, 400);
    if (fr.paystack_transfer_code) return json({ error: "This request already has a transfer attached." }, 400);

    const { data: buyer } = await supabase.from("media_buyers")
      .select("id, name, meta_ads_recipient_code, meta_ads_verified, meta_ads_account_name")
      .eq("id", fr.media_buyer_id).maybeSingle();
    if (!buyer) return json({ error: "Media buyer not found" }, 404);
    if (!buyer.meta_ads_verified || !buyer.meta_ads_recipient_code) {
      return json({ error: "No verified Meta Ads bank account on file for this buyer yet -- verify one first." }, 400);
    }

    let transfer;
    try {
      transfer = await paystackFetch("/transfer", {
        method: "POST",
        body: JSON.stringify({
          source: "balance",
          amount: Math.round(Number(fr.amount_naira) * 100),
          recipient: buyer.meta_ads_recipient_code,
          reason: `Meta Ads top-up for ${buyer.name} (request ${fr.id})`,
        }),
      });
    } catch (transferErr: any) {
      await supabase.from("fund_requests").update({ transfer_error: transferErr.message }).eq("id", fr.id);
      return json({ error: `Transfer failed: ${transferErr.message}` }, 502);
    }

    const { error: updErr } = await supabase.from("fund_requests").update({
      status: "transferred",
      paystack_transfer_code: transfer?.data?.transfer_code ?? null,
      paystack_transfer_reference: transfer?.data?.reference ?? null,
      transfer_error: null,
      transferred_at: new Date().toISOString(),
    }).eq("id", fr.id);
    if (updErr) throw updErr;

    return json({ ok: true, transfer_code: transfer?.data?.transfer_code, account_name: buyer.meta_ads_account_name });
  } catch (err: any) {
    console.error("paystack-transfer-to-meta error:", err);
    return json({ error: err.message }, 500);
  }
});
