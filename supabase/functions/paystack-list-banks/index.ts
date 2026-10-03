import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Thin proxy for Paystack's /bank list -- the dashboard needs it to render
// a bank dropdown when a buyer registers their Meta Ads top-up account, but
// the secret key can't be called from the browser directly.
//
//   GET -> { banks: [{ name, code }] }

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK_BASE = "https://api.paystack.co";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" },
    });
  }
  if (!PAYSTACK_SECRET_KEY) return json({ error: "PAYSTACK_SECRET_KEY isn't configured yet." }, 500);

  try {
    const res = await fetch(`${PAYSTACK_BASE}/bank?country=nigeria`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const body = await res.json();
    if (!res.ok || body?.status === false) throw new Error(body?.message || `Paystack /bank failed (${res.status})`);
    const banks = (body.data ?? []).map((b: any) => ({ name: b.name, code: b.code })).sort((a: any, b: any) => a.name.localeCompare(b.name));
    return json({ banks });
  } catch (err: any) {
    console.error("paystack-list-banks error:", err);
    return json({ error: err.message }, 500);
  }
});
