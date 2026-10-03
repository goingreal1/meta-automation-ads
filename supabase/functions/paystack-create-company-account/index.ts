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
const PAYSTACK_PREFERRED_BANK = Deno.env.get("PAYSTACK_PREFERRED_BANK") ?? "test-bank";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!PAYSTACK_SECRET_KEY) return json({ error: "PAYSTACK_SECRET_KEY isn't configured yet." }, 500);

  try {
    const { access_token } = await req.json();
    const { data: userData } = await supabase.auth.getUser(access_token);
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await supabase.from("profiles").select("role, company_id").eq("id", userData.user.id).maybeSingle();
    if (!profile || !["owner", "admin"].includes(profile.role)) return json({ error: "Unauthorized" }, 401);

    const { data: company } = await supabase.from("companies")
      .select("id, name, paystack_customer_code, dedicated_account_number, dedicated_account_bank")
      .eq("id", profile.company_id).maybeSingle();
    if (!company) return json({ error: "Company not found" }, 404);

    if (company.dedicated_account_number) {
      return json({ account_number: company.dedicated_account_number, bank_name: company.dedicated_account_bank, account_name: company.name });
    }

    const email = `company-${company.id}@noemail.example.com`;
    const customer = await paystackFetch("/customer", {
      method: "POST",
      body: JSON.stringify({ email, first_name: company.name || "Company", last_name: "Wallet" }),
    });
    const customerCode = customer.data.customer_code;

    const dva = await paystackFetch("/dedicated_account", {
      method: "POST",
      body: JSON.stringify({ customer: customerCode, preferred_bank: PAYSTACK_PREFERRED_BANK }),
    });
    const accountNumber = dva.data.account_number;
    const bankName = dva.data.bank?.name ?? PAYSTACK_PREFERRED_BANK;

    const { error: updErr } = await supabase.from("companies").update({
      paystack_customer_code: customerCode,
      dedicated_account_number: accountNumber,
      dedicated_account_bank: bankName,
    }).eq("id", company.id);
    if (updErr) throw updErr;

    return json({ account_number: accountNumber, bank_name: bankName, account_name: company.name });
  } catch (err: any) {
    console.error("paystack-create-company-account error:", err);
    return json({ error: err.message }, 500);
  }
});
