import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Thin proxy for Paystack's /bank list -- the dashboard needs it to render
// a bank dropdown when a buyer registers their Meta Ads top-up account, but
// the secret key can't be called from the browser directly.
//
//   GET -> { banks: [{ name, code }] }
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK_BASE = "https://api.paystack.co";
// Used only while Paystack's own bank list is down (their /bank endpoint sometimes returns 504). Account numbers are still
// verified with the bank before any money moves, so a wrong entry here can only fail the check, never misdirect funds.
const FALLBACK = [
  ["Access Bank","044"],["EcoBank Nigeria","050"],["Fidelity Bank","070"],["First Bank of Nigeria","011"],["First City Monument Bank","214"],
  ["Guaranty Trust Bank","058"],["Keystone Bank","082"],["Kuda Microfinance Bank","50211"],["Moniepoint MFB","50515"],["OPay Digital Services Limited (OPay)","999992"],
  ["Paga","100002"],["PalmPay","999991"],["Polaris Bank","076"],["Providus Bank","101"],["Stanbic IBTC Bank","221"],["Sterling Bank","232"],
  ["Union Bank of Nigeria","032"],["United Bank For Africa","033"],["Wema Bank","035"],["Zenith Bank","057"]
].map(([name, code]) => ({ name, code }));
let cached = null; // last good list, reused if Paystack hiccups
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey"
      }
    });
  }
  if (!PAYSTACK_SECRET_KEY) return json({
    error: "PAYSTACK_SECRET_KEY isn't configured yet."
  }, 500);
  try {
    // Paystack sometimes answers a bare request with an HTML error page (bot filter) instead of JSON. Ask for JSON explicitly,
    // identify ourselves, try a second URL shape, and fall back to the last good list kept in memory.
    const urls = [
      `${PAYSTACK_BASE}/bank?country=nigeria&perPage=200`,
      `${PAYSTACK_BASE}/bank?currency=NGN&perPage=200`,
      `${PAYSTACK_BASE}/bank?country=nigeria`
    ];
    let banks = null, lastErr = "";
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Revora/1.0 (+https://revoracrm.online)"
          }
        });
        const text = await res.text();
        let body = null;
        try { body = JSON.parse(text); } catch { /* not JSON */ }
        if (!body) { lastErr = `Paystack answered ${res.status} with a web page, not data: ${text.slice(0, 160).replace(/\s+/g, " ")}`; console.error("paystack-list-banks:", lastErr); continue; }
        if (!res.ok || body?.status === false) { lastErr = body?.message || `Paystack /bank failed (${res.status})`; console.error("paystack-list-banks:", lastErr); continue; }
        const list = (body.data ?? []).map((b) => ({ name: b.name, code: b.code })).filter((b) => b.name && b.code);
        if (list.length) { banks = list; break; }
      } catch (e) { lastErr = String(e?.message ?? e); console.error("paystack-list-banks fetch:", lastErr); }
    }
    if (banks) { banks.sort((a, b) => a.name.localeCompare(b.name)); cached = banks; }
    else if (cached) banks = cached;
    else { console.error("paystack-list-banks: using built-in fallback list;", lastErr); return json({ banks: FALLBACK, fallback: true }); }
    return json({ banks });
  } catch (err) {
    console.error("paystack-list-banks error:", err);
    return json({
      error: err.message
    }, 500);
  }
});
