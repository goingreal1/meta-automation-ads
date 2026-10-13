import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Welcome message for a brand-new Revora owner, sent on the global WhatsApp Business number the moment company setup
// finishes (called by complete-signup). A new sign-up has never messaged us, so this must be a Meta-approved TEMPLATE;
// a plain text would be rejected outside the 24h window, so there is deliberately no text fallback. If the template is
// not approved yet the send fails quietly and sign-up carries on.
//
// Template (create it in WhatsApp Manager, category Utility if Meta allows, language English):
//   name:    revora_welcome_v1
//   body:    Hi {{1}}, welcome to Revora! 🎉 I'm here to help you connect your ad account and add your first product. What would you like to do first?
//   buttons: Quick replies -> "Connect my ad account", "Add my product", "Talk to a person"
// Tapping a button sends us a message (payloads welcome_connect / welcome_product / welcome_human), which opens the 24h window.
//
//   POST { phone: "234XXXXXXXXXX", name?: string }   (service role only)

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const TEMPLATE = Deno.env.get("WHATSAPP_TPL_WELCOME") ?? "revora_welcome_v1";
const META_GRAPH_BASE = "https://graph.facebook.com/v18.0";

const BUTTON_PAYLOADS = ["welcome_connect", "welcome_product", "welcome_human"];

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // Internal only: the caller must present the service role key.
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!SUPABASE_SERVICE_ROLE_KEY || bearer !== SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Not allowed." }, 401);
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return json({ sent: false, reason: "WhatsApp is not configured." });

  const body = await req.json().catch(() => ({}));
  const phone = String(body?.phone ?? "").replace(/\D/g, "");
  if (!/^234\d{10}$/.test(phone)) return json({ sent: false, reason: "Invalid phone." }, 400);
  const first = String(body?.name ?? "").trim().split(/\s+/)[0].slice(0, 30) || "there";

  const res = await fetch(`${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: TEMPLATE,
        language: { code: "en" },
        components: [
          { type: "body", parameters: [{ type: "text", text: first }] },
          ...BUTTON_PAYLOADS.map((payload, index) => ({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] })),
        ],
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("welcome template failed:", res.status, JSON.stringify(data?.error ?? data).slice(0, 300));
    return json({ sent: false, reason: data?.error?.message ?? "WhatsApp rejected the message." });
  }
  return json({ sent: true });
});
