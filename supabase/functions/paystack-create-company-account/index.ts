import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Creates (or reuses) the COMPANY's own Dedicated Virtual Account -- the
// admin's actual wallet, separate from any buyer's. A buyer's DVA only
// ever exists to collect customer payments for their own orders; this is
// where the admin deposits the company's own money directly (e.g. to seed
// ad budget before any sales have happened yet, or just as working
// capital). Admin-only.
//
//   POST { access_token } -> { account_number, bank_name, account_name }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const IS_LIVE = PAYSTACK_SECRET_KEY.startsWith("sk_live");
const _pref = Deno.env.get("PAYSTACK_PREFERRED_BANK") ?? "";
const PAYSTACK_PREFERRED_BANK = IS_LIVE ? (_pref && _pref !== "test-bank" ? _pref : "wema-bank") : (_pref || "test-bank");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const PAYSTACK_BASE = "https://api.paystack.co";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

async function paystackFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.status === false) throw new Error(body?.message || `Paystack ${path} failed (${res.status})`);
  return body;
}

// Live Paystack requires a phone number on every customer. Normalise Nigerian formats to +234XXXXXXXXXX.
function normPhone(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("234")) return "+" + d;
  if (d.length === 11 && d.startsWith("0")) return "+234" + d.slice(1);
  if (d.length === 10) return "+234" + d;
  return null;
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
    const { access_token, company_id: svcCompanyId, email: givenEmail, phone: givenPhone } = await req.json();
    // Internal callers (sign-up) pass the service-role key as the bearer token plus a company_id; everyone else is an owner/admin.
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    let profile: { role: string; company_id: string } | null = null;
    if (svcCompanyId && SUPABASE_SERVICE_ROLE_KEY && bearer === SUPABASE_SERVICE_ROLE_KEY) {
      profile = { role: "owner", company_id: String(svcCompanyId) };
    } else {
      const { data: userData } = await supabase.auth.getUser(access_token);
      if (!userData?.user) return json({ error: "Unauthorized" }, 401);
      const { data: p } = await supabase.from("profiles").select("role, company_id").eq("id", userData.user.id).maybeSingle();
      if (!p || !["owner", "admin"].includes(p.role)) return json({ error: "Unauthorized" }, 401);
      profile = p;
    }

    const { data: company } = await supabase.from("companies")
      .select("id, name, paystack_customer_code, dedicated_account_number, dedicated_account_bank")
      .eq("id", profile.company_id).maybeSingle();
    if (!company) return json({ error: "Company not found" }, 404);

    if (company.dedicated_account_number) {
      return json({ account_number: company.dedicated_account_number, bank_name: company.dedicated_account_bank, account_name: company.name });
    }

    const email = typeof givenEmail === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(givenEmail) ? givenEmail : `company-${company.id}@noemail.example.com`;
    const { data: owners } = await supabase.from("profiles").select("whatsapp_number, role").eq("company_id", company.id).in("role", ["owner", "admin"]);
    const phone = normPhone(givenPhone) ?? (owners ?? []).map((o: any) => normPhone(o.whatsapp_number)).find(Boolean) ?? null;
    if (!phone) return json({ error: "A phone number is needed to open the company account (Paystack requires one). Add the owner's WhatsApp number in Settings, then try again." }, 400);
    const names = { first_name: (company.name || "Company").slice(0, 30), last_name: "Wallet", phone };
    const customer = await paystackFetch("/customer", { method: "POST", body: JSON.stringify({ email, ...names }) });
    const customerCode = customer.data.customer_code;
    await paystackFetch(`/customer/${customerCode}`, { method: "PUT", body: JSON.stringify(names) }).catch(() => {});

    let dva;
    try {
      dva = await paystackFetch("/dedicated_account", { method: "POST", body: JSON.stringify({ customer: customerCode, preferred_bank: PAYSTACK_PREFERRED_BANK, ...names }) });
    } catch (e) {
      if (!IS_LIVE || PAYSTACK_PREFERRED_BANK === "titan-paystack") throw e;
      dva = await paystackFetch("/dedicated_account", { method: "POST", body: JSON.stringify({ customer: customerCode, preferred_bank: "titan-paystack", ...names }) });
    }
    const accountNumber = dva.data.account_number;
    const bankName = dva.data.bank?.name ?? PAYSTACK_PREFERRED_BANK;

    const { error: updErr } = await supabase.from("companies").update({
      paystack_customer_code: customerCode,
      dedicated_account_number: accountNumber,
      dedicated_account_bank: bankName,
    }).eq("id", company.id);
    if (updErr) throw updErr;

    return json({ account_number: accountNumber, bank_name: bankName, account_name: dva.data.account_name || `${company.name} Wallet` });
  } catch (err: any) {
    console.error("paystack-create-company-account error:", err);
    return json({ error: err.message }, 500);
  }
});
