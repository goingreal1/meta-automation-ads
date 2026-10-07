import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Internal (staff-facing) email alerts via Resend, for the non-urgent half
// of the funding-request lifecycle -- "submitted" and "decided" -- that
// doesn't need to interrupt someone's phone the way send-internal-whatsapp's
// low-balance/payment-confirmed/transfer-result alerts do. Recipients are
// looked up by auth email (supabase.auth.admin.getUserById), not a
// separately-stored address, so there's nothing to keep in sync.
//
//   POST { type: "fund_request_submitted" | "fund_request_decided", fund_request_id }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// Must be on a domain verified in Resend -- resend.com/domains. Defaults to
// their sandbox sender, which only delivers to the Resend account owner's
// own inbox; override via secret once a real domain is verified.
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "alerts@onresend.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const fmt = (n: number) => new Intl.NumberFormat("en-NG").format(Number(n ?? 0));

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to, subject, html }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Resend send failed (${res.status})`);
  return data;
}

async function adminEmails(companyId: string): Promise<string[]> {
  const { data: profiles } = await supabase.from("profiles").select("id").eq("company_id", companyId).in("role", ["owner", "admin"]);
  const emails: string[] = [];
  for (const p of profiles ?? []) {
    const { data } = await supabase.auth.admin.getUserById(p.id);
    if (data?.user?.email) emails.push(data.user.email);
  }
  return emails;
}

async function buyerEmail(mediaBuyerId: string): Promise<string | null> {
  const { data: profile } = await supabase.from("profiles").select("id").eq("media_buyer_id", mediaBuyerId).eq("role", "buyer").maybeSingle();
  if (!profile) return null;
  const { data } = await supabase.auth.admin.getUserById(profile.id);
  return data?.user?.email ?? null;
}

async function sendToMany(emails: string[], subject: string, html: string) {
  const results: Record<string, string> = {};
  for (const email of emails) {
    try {
      await sendEmail(email, subject, html);
      results[email] = "sent";
    } catch (err: any) {
      results[email] = `error: ${err.message}`;
    }
  }
  return results;
}

const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Caller must be the service role (internal functions / cron) or a signed-in
// dashboard user -- the public anon key alone is not enough. A service token
// is proven with the Auth admin API because pg_cron may hold a different (but
// valid) copy of the key than this function's env.
type Caller = { service: boolean; company_id: string | null; role: string | null };
async function getCaller(req: Request, admin: ReturnType<typeof createClient>): Promise<Caller | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  if (SVC_KEY && token === SVC_KEY) return { service: true, company_id: null, role: null };
  const { data } = await admin.auth.getUser(token);
  if (data?.user) {
    const { data: p } = await admin.from("profiles").select("company_id, role").eq("id", data.user.id).maybeSingle();
    return p?.company_id ? { service: false, company_id: p.company_id, role: p.role } : null;
  }
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL") ?? ""}/auth/v1/admin/users?per_page=1`, { headers: { apikey: token, Authorization: `Bearer ${token}` } });
    if (r.status === 200) return { service: true, company_id: null, role: null };
  } catch { /* not a service token */ }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY isn't configured yet." }, 500);

  try {
    if (!(await getCaller(req, supabase))) return json({ error: "Not signed in" }, 401);
    const { type, fund_request_id } = await req.json();

    if (type === "fund_request_submitted") {
      const { data: fr } = await supabase.from("fund_requests").select("id, amount_naira, note, company_id, media_buyers(name)").eq("id", fund_request_id).maybeSingle();
      if (!fr) return json({ error: "Funding request not found" }, 404);
      const emails = await adminEmails(fr.company_id);
      const buyerName = (fr.media_buyers as any)?.name || "A buyer";
      const results = await sendToMany(emails, `Funding request: NGN ${fmt(fr.amount_naira)} from ${buyerName}`,
        `<p><strong>${buyerName}</strong> requested <strong>NGN ${fmt(fr.amount_naira)}</strong> in funding.</p><p>Note: ${fr.note ? fr.note : "(none)"}</p><p>Approve or decline it from the Wallet tab.</p>`);
      return json({ ok: true, results });
    }

    if (type === "fund_request_decided") {
      const { data: fr } = await supabase.from("fund_requests").select("id, amount_naira, status, media_buyer_id").eq("id", fund_request_id).maybeSingle();
      if (!fr) return json({ error: "Funding request not found" }, 404);
      const email = fr.media_buyer_id ? await buyerEmail(fr.media_buyer_id) : null;
      if (!email) return json({ ok: true, results: {} });
      const results = await sendToMany([email], `Your funding request was ${fr.status}`,
        `<p>Your funding request for <strong>NGN ${fmt(fr.amount_naira)}</strong> was <strong>${fr.status}</strong>.</p>${fr.status === "approved" ? `<p>You can now send it from the Wallet tab.</p>` : ""}`);
      return json({ ok: true, results });
    }

    return json({ error: `Unknown type: ${type}` }, 400);
  } catch (err: any) {
    console.error("send-internal-email error:", err);
    return json({ error: err.message }, 500);
  }
});
