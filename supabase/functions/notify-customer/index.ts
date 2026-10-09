import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Customer order notifications over the shared WhatsApp Business line (same line and approved-template approach as
// send-payment-whatsapp). A database trigger on orders calls this once per step:
//   order_received    -- the moment an order is placed ("our team will call you")
//   order_confirmed   -- order_status -> valid (after the AI / customer-care call): "preparing your order"
//   agent_accepted    -- the delivery agent accepted it
//   out_for_delivery  -- the agent tapped "On the way"
//   order_delivered   -- delivered; then the payment request (account + code + "I've paid" button) follows
//   paid_claimed      -- the customer tapped "I've paid": re-check the payment and answer
// Each step is sent at most once per order (unique order_id + event in order_notifications). Every send is logged
// there, so customer care can see what the customer was told. Templates must be approved in Meta's WhatsApp Manager
// (texts in docs/WHATSAPP_TEMPLATES.md); names are overridable with the WHATSAPP_TPL_* secrets.
//
//   POST { order_id, event }   header x-cron-secret (database trigger) or the service-role bearer.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WA_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v18.0";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const TPL: Record<string, string> = {
  order_received: Deno.env.get("WHATSAPP_TPL_ORDER_RECEIVED") ?? "order_received_v1",
  order_confirmed: Deno.env.get("WHATSAPP_TPL_ORDER_PREPARING") ?? "order_preparing_v1",
  agent_accepted: Deno.env.get("WHATSAPP_TPL_AGENT_ACCEPTED") ?? "agent_accepted_v1",
  out_for_delivery: Deno.env.get("WHATSAPP_TPL_OUT_FOR_DELIVERY") ?? "out_for_delivery_v1",
  order_delivered: Deno.env.get("WHATSAPP_TPL_ORDER_DELIVERED") ?? "order_delivered_v1",
  payment_confirmed: Deno.env.get("WHATSAPP_TPL_CUSTOMER_CONFIRMED") ?? "payment_confirmed_customer_v1",
};

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

function phoneOf(raw: string | null): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("234")) return d;
  if (d.startsWith("0") && d.length === 11) return "234" + d.slice(1);
  if (d.length === 10) return "234" + d;
  return d;
}

async function waSend(payload: Record<string, unknown>) {
  const res = await fetch(`${GRAPH}/${WA_PHONE_ID}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `WhatsApp send failed (${res.status})`);
  return String(data?.messages?.[0]?.id ?? "");
}
const sendTemplate = (to: string, name: string, params: string[]) =>
  waSend({ to, type: "template", template: { name, language: { code: "en" }, components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p || "-" })) }] } });
const sendText = (to: string, body: string) => waSend({ to, type: "text", text: { body } });

async function authorised(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer && SERVICE_KEY && bearer === SERVICE_KEY) return true;
  const sent = req.headers.get("x-cron-secret");
  if (!sent) return false;
  const { data } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
  return !!data?.value && data.value === sent;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await authorised(req))) return json({ error: "unauthorized" }, 401);
  if (!WA_TOKEN || !WA_PHONE_ID) return json({ error: "WhatsApp isn't configured (BEOLIV_WHATSAPP_ACCESS_TOKEN / _PHONE_NUMBER_ID)." }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const orderId = String(body.order_id || ""), event = String(body.event || "");
  if (!orderId || !(event in TPL || event === "paid_claimed")) return json({ error: "order_id and a valid event are required" }, 400);

  const { data: o } = await admin.from("orders")
    .select("id, company_id, customer_name, customer_phone, product_name, order_value_naira, order_status, delivery_agent_id, media_buyer_id, payment_narration_code, companies(name)")
    .eq("id", orderId).maybeSingle();
  if (!o) return json({ error: "Order not found" }, 404);
  const to = phoneOf(o.customer_phone);
  if (!to) return json({ ok: true, skipped: "no phone" });
  // "I've paid" must come from the customer's own number (the webhook URL is public; the order id is not a secret).
  if (event === "paid_claimed" && phoneOf(String(body.from ?? "")) !== to) return json({ ok: true, skipped: "sender is not the customer" });

  // One send per order and step (paid_claimed may repeat, so it gets its own key each time).
  const key = event === "paid_claimed" ? `paid_claimed_${Date.now()}` : event;
  const { error: dupErr } = await admin.from("order_notifications").insert({ order_id: o.id, company_id: o.company_id, event: key, status: "sending" });
  if (dupErr) return json({ ok: true, skipped: "already sent" });
  const finish = (status: string, wa?: string, error?: string) =>
    admin.from("order_notifications").update({ status, wa_message_id: wa ?? null, error: error ?? null }).eq("order_id", o.id).eq("event", key);

  try {
    const name = o.customer_name || "there";
    const product = o.product_name || "your order";
    const brand = (o as any).companies?.name || "our store";
    let agent: { name: string; phone: string } | null = null;
    if (o.delivery_agent_id) {
      const { data: a } = await admin.from("delivery_agents").select("name, phone").eq("id", o.delivery_agent_id).maybeSingle();
      if (a) agent = { name: a.name || "your delivery agent", phone: a.phone || "" };
    }

    // The buyer's own payment account: shown to the customer when the order is placed and again when the rider is on the way.
    let acct: { bank: string; number: string; holder: string } | null = null;
    if (o.media_buyer_id && (event === "order_received" || event === "out_for_delivery")) {
      let { data: b } = await admin.from("media_buyers").select("name, dedicated_account_number, dedicated_account_bank").eq("id", o.media_buyer_id).maybeSingle();
      if (b && !b.dedicated_account_number) {
        await fetch(`${SUPABASE_URL}/functions/v1/paystack-create-account`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` }, body: JSON.stringify({ media_buyer_id: o.media_buyer_id }) }).catch(() => {});
        ({ data: b } = await admin.from("media_buyers").select("name, dedicated_account_number, dedicated_account_bank").eq("id", o.media_buyer_id).maybeSingle());
      }
      if (b?.dedicated_account_number) acct = { bank: b.dedicated_account_bank || "", number: b.dedicated_account_number, holder: `${brand} ${b.name || ""}`.trim() };
    }
    const amount = "₦" + Number(o.order_value_naira ?? 0).toLocaleString("en-NG");
    const payBlock = acct ? `\n\nTo pay by transfer:\n${acct.bank}\n${acct.number}\n${acct.holder}\nAmount: ${amount}${o.payment_narration_code ? `\nPut this code in the narration: ${o.payment_narration_code}` : ""}` : "";
    // A plain message (carrying the account) goes first: it works while the customer's WhatsApp conversation is open.
    // If WhatsApp refuses it (outside the 24-hour window), the approved template below is sent instead.
    const tryText = async (text: string): Promise<string | null> => { try { return await sendText(to, text); } catch (e) { console.error("text send failed, using template:", (e as Error).message); return null; } };

    // Approved template first (works any time); if it is missing or refused, a plain message (works while the chat is open).
    const tplOrText = async (tpl: string, params: string[], text: string): Promise<string> => {
      try { return await sendTemplate(to, tpl, params); } catch (e) { console.error("template failed, sending text:", tpl, (e as Error).message); return await sendText(to, text); }
    };

    let wa = "";
    if (event === "order_received") {
      wa = (await tryText(`Hi ${name}, thank you for your order of ${product} from ${brand}! 🙏 Our team will call you shortly to confirm the details.${payBlock}`)) ?? await sendTemplate(to, TPL.order_received, [name, product, brand]);
    }
    else if (event === "order_confirmed") wa = await tplOrText(TPL.order_confirmed, [name, product], `Hi ${name}, your order for ${product} is confirmed and being prepared. We'll message you when a rider is assigned.`);
    else if (event === "agent_accepted") wa = await tplOrText(TPL.agent_accepted, [name, agent?.name ?? "your delivery agent", agent?.phone ?? ""], `Hi ${name}, ${agent?.name ?? "your delivery agent"}${agent?.phone ? ` (${agent.phone})` : ""} will deliver your ${product}.`);
    else if (event === "out_for_delivery") {
      wa = (await tryText(`Hi ${name}, ${agent?.name ?? "your delivery agent"}${agent?.phone ? ` (${agent.phone})` : ""} is on the way with your ${product}. 🛵${payBlock ? `\n\nYou can pay now by transfer and your rider will confirm it.${payBlock}` : ""}`)) ?? await sendTemplate(to, TPL.out_for_delivery, [name, agent?.name ?? "your delivery agent", agent?.phone ?? ""]);
    }
    else if (event === "order_delivered") {
      wa = await tplOrText(TPL.order_delivered, [name, product], `Hi ${name}, your ${product} has been delivered. Thank you for shopping with ${brand}! 🎉`);
      // Payment comes after delivery: send the account + code (+ "I've paid" button) unless it is already paid.
      const { data: paid } = await admin.from("payments").select("id").eq("order_id", o.id).eq("status", "confirmed").limit(1);
      if (!paid?.length) {
        await fetch(`${SUPABASE_URL}/functions/v1/send-payment-whatsapp`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ order_id: o.id, type: "payment_request", after_delivery: true }),
        }).catch((e) => console.error("payment_request failed:", e));
      }
    } else if (event === "paid_claimed") {
      // The customer tapped "I've paid". The Paystack webhook is the source of truth (code or name + amount match).
      const { data: paid } = await admin.from("payments").select("id").eq("order_id", o.id).eq("status", "confirmed").limit(1);
      if (paid?.length) wa = await sendText(to, `Thank you ${name}, we have received your payment. Your order is complete.`);
      else wa = await sendText(to, `Thanks ${name}. We haven't seen your payment yet; banks can take a few minutes. If you already sent it, reply with your transfer receipt and our team will confirm it.`);
    }
    await finish("sent", wa);
    return json({ ok: true, event });
  } catch (err: any) {
    console.error("notify-customer error:", event, err);
    await finish("failed", undefined, String(err?.message ?? err).slice(0, 300));
    return json({ ok: false, error: err?.message ?? "failed" }, 200);
  }
});
