import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Customer order notifications over the shared WhatsApp Business line (same line and approved-template approach as
// send-payment-whatsapp). A database trigger on orders calls this once per step:
//   order_confirm_request -- the moment an order is placed: an approved TEMPLATE with Confirm / Cancel buttons (templates
//                            are the only thing WhatsApp delivers to a customer who has not messaged us in 24 hours)
//   order_confirm_reminder-- same buttons again, 30 minutes later, if the customer has not answered
//   order_received    -- (older) plain thank-you with the buyer's payment account; no longer sent on insert
//   order_confirmed   -- order_status -> valid (after the AI / customer-care call or the customer's tap): "preparing your order"
//   agent_accepted    -- the delivery agent accepted it
//   out_for_delivery  -- the parcel was picked up. Own rider: "on the way" + payment account. Courier (Shipbubble): short
//                        message with the courier's name and the cash-on-delivery amount (no link)
//   order_delivered   -- delivered; for own-rider orders not yet paid, the payment request follows. Courier orders are
//                        paid in cash to the courier, so no transfer request is sent
//   paid_claimed      -- the customer tapped "I've paid": re-check the payment and answer
//   care_assigned     -- not a customer message: a web push telling the customer-care agent an order was handed to them
//   order_confirm_tap -- the customer tapped Confirm order / Cancel order (forwarded by handle-whatsapp-reply)
//   order_text_reply  -- the customer typed a short yes / no (forwarded by handle-whatsapp-reply)
//   { action: "sweep" } -- cron every 5 minutes: sends the reminder, then flags the order for customer care
// Each step is sent at most once per order (unique order_id + event in order_notifications). Every send is logged
// there, so customer care can see what the customer was told. Templates must be approved in Meta's WhatsApp Manager
// (texts in docs/WHATSAPP_TEMPLATES.md); names are overridable with the WHATSAPP_TPL_* secrets. Where a plain message
// is possible (the customer's chat is open) it is used or kept as a fallback, so nothing is lost while templates are pending.
//
//   POST { order_id, event }   header x-cron-secret (database trigger) or the service-role bearer.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WA_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v18.0";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const TPL = {
  order_confirm_request: Deno.env.get("WHATSAPP_TPL_ORDER_CONFIRM_REQUEST") ?? "order_confirm_request_v1",
  order_confirm_reminder: Deno.env.get("WHATSAPP_TPL_ORDER_CONFIRM_REMINDER") ?? "order_confirm_reminder_v1",
  order_received: Deno.env.get("WHATSAPP_TPL_ORDER_RECEIVED") ?? "order_received_v1",
  order_confirmed: Deno.env.get("WHATSAPP_TPL_ORDER_PREPARING") ?? "order_preparing_v1",
  agent_accepted: Deno.env.get("WHATSAPP_TPL_AGENT_ACCEPTED") ?? "agent_accepted_v1",
  out_for_delivery: Deno.env.get("WHATSAPP_TPL_OUT_FOR_DELIVERY") ?? "out_for_delivery_v1",
  order_delivered: Deno.env.get("WHATSAPP_TPL_ORDER_DELIVERED") ?? "order_delivered_v1",
  payment_confirmed: Deno.env.get("WHATSAPP_TPL_CUSTOMER_CONFIRMED") ?? "payment_confirmed_customer_v1"
};
// Courier (Shipbubble) pickup message: name, product, courier, cash-on-delivery amount.
const TPL_SHIPPED = Deno.env.get("WHATSAPP_TPL_ORDER_SHIPPED") ?? "order_shipped_v1";
const json = (o, status = 200)=>new Response(JSON.stringify(o), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
function phoneOf(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("234")) return d;
  if (d.startsWith("0") && d.length === 11) return "234" + d.slice(1);
  if (d.length === 10) return "234" + d;
  return d;
}
// WhatsApp rejects template parameters that contain line breaks, tabs or runs of spaces (error 131009).
const cleanParam = (p)=>String(p ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "-";
async function waSend(payload) {
  const res = await fetch(`${GRAPH}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      ...payload
    })
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data?.error?.message || `WhatsApp send failed (${res.status})`);
  return String(data?.messages?.[0]?.id ?? "");
}
const sendTemplate = (to, name, params)=>waSend({
    to,
    type: "template",
    template: {
      name,
      language: {
        code: "en"
      },
      components: [
        {
          type: "body",
          parameters: params.map((p)=>({
              type: "text",
              text: cleanParam(p)
            }))
        }
      ]
    }
  });
// Template with quick-reply buttons: each button carries a payload that comes back in the webhook when it is tapped.
const sendTemplateButtons = (to, name, params, payloads)=>waSend({
    to,
    type: "template",
    template: {
      name,
      language: {
        code: "en"
      },
      components: [
        {
          type: "body",
          parameters: params.map((p)=>({
              type: "text",
              text: cleanParam(p)
            }))
        },
        ...payloads.map((payload, i)=>({
            type: "button",
            sub_type: "quick_reply",
            index: String(i),
            parameters: [
              {
                type: "payload",
                payload
              }
            ]
          }))
      ]
    }
  });
const sendText = (to, body)=>waSend({
    to,
    type: "text",
    text: {
      body
    }
  });
async function authorised(req) {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer && SERVICE_KEY && bearer === SERVICE_KEY) return true;
  const sent = req.headers.get("x-cron-secret");
  if (!sent) return false;
  const { data } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
  return !!data?.value && data.value === sent;
}
// Web push to the customer-care agent (same mechanism as care_assigned).
async function pushCare(ord, title, tag) {
  if (!ord?.care_agent_id) return null;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/handle-whatsapp-reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`
    },
    body: JSON.stringify({
      audience: {
        company_id: ord.company_id,
        user_ids: [
          ord.care_agent_id
        ]
      },
      notification: {
        title,
        body: `${ord.customer_name || "Customer"} · ${ord.product_name || "order"} · ₦${Number(ord.order_value_naira ?? 0).toLocaleString("en-NG")}`,
        url: "/care.html",
        tag
      }
    })
  }).catch(()=>null);
  return r?.status ?? null;
}
// The customer answered (button tap or a typed yes / no): confirm or cancel the order.
// Confirm sets order_status = valid, which is what starts delivery (the shipbubble dispatch trigger).
async function applyDecision(o, act, to) {
  const name = o.customer_name || "there";
  if (o.order_status !== "pending") {
    const msg = o.order_status === "valid" ? `Hi ${name}, your order is already confirmed. We'll message you when it's on the way.` : o.order_status === "cancelled" ? `Hi ${name}, this order was cancelled. If that was a mistake, just reply here and we'll help.` : null;
    if (msg) await sendText(to, msg).catch((e)=>console.error("status reply failed:", e.message));
    return {
      ok: true,
      skipped: `order is ${o.order_status}`
    };
  }
  if (act === "confirm") {
    // Our own confirmation text below replaces the generic "being prepared" notice, so mark that notice as already sent.
    await admin.from("order_notifications").insert({
      order_id: o.id,
      company_id: o.company_id,
      event: "order_confirmed",
      status: "sent"
    });
    const { data: upd, error } = await admin.from("orders").update({
      order_status: "valid"
    }).eq("id", o.id).eq("order_status", "pending").select("id");
    if (error || !upd?.length) {
      await admin.from("order_notifications").delete().eq("order_id", o.id).eq("event", "order_confirmed").is("wa_message_id", null);
      return {
        ok: false,
        error: error?.message ?? "order changed meanwhile"
      };
    }
    const cod = /pay on delivery|cash on delivery|\bcod\b/i.test(o.payment_method ?? "");
    await sendText(to, `Thank you ${name}! ✅ Your order is confirmed.${cod ? " You'll pay on delivery." : ""} We'll message you when your delivery is on the way.`).catch((e)=>console.error("confirm text failed:", e.message));
    return {
      ok: true,
      decision: "confirmed"
    };
  }
  const { data: upd, error } = await admin.from("orders").update({
    order_status: "cancelled"
  }).eq("id", o.id).eq("order_status", "pending").select("id");
  if (error || !upd?.length) return {
    ok: false,
    error: error?.message ?? "order changed meanwhile"
  };
  await sendText(to, `No problem ${name}, your order has been cancelled. If this was a mistake, just reply here and we'll help.`).catch((e)=>console.error("cancel text failed:", e.message));
  return {
    ok: true,
    decision: "cancelled"
  };
}
const YES_RE = /^\s*(yes|y|yeah|yea|yep|ok|okay|confirm|confirmed|i confirm|yes please|yes i confirm|sure|correct)[\s.!]*$/i;
const NO_RE = /^\s*(no|n|nope|cancel|cancelled|cancel order|stop|not me|i didn'?t order)[\s.!]*$/i;
// Cron: reminder 30 minutes after the first message, then a customer-care flag 30 minutes after the reminder.
async function sweep() {
  const now = Date.now();
  const ago = (m)=>new Date(now - m * 60_000).toISOString();
  const out = {
    reminded: 0,
    flagged: 0,
    errors: []
  };
  const isPending = async (id)=>{
    const { data } = await admin.from("orders").select("order_status").eq("id", id).maybeSingle();
    return data?.order_status === "pending";
  };
  const has = async (id, event)=>{
    const { data } = await admin.from("order_notifications").select("order_id").eq("order_id", id).eq("event", event).maybeSingle();
    return !!data;
  };
  const { data: reqs } = await admin.from("order_notifications").select("order_id").eq("event", "order_confirm_request").eq("status", "sent").lt("created_at", ago(30)).gt("created_at", ago(24 * 60)).limit(50);
  for (const r of reqs ?? []){
    try {
      if (!await isPending(r.order_id) || await has(r.order_id, "order_confirm_reminder")) continue;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-customer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`
        },
        body: JSON.stringify({
          order_id: r.order_id,
          event: "order_confirm_reminder"
        })
      });
      if (res.ok) out.reminded++;
      else out.errors.push(`reminder ${r.order_id}: ${res.status}`);
    } catch (e) {
      out.errors.push(`reminder ${r.order_id}: ${e.message}`);
    }
  }
  const { data: rems } = await admin.from("order_notifications").select("order_id").eq("event", "order_confirm_reminder").lt("created_at", ago(30)).gt("created_at", ago(24 * 60)).limit(50);
  for (const r of rems ?? []){
    try {
      if (!await isPending(r.order_id)) continue;
      const { data: ord } = await admin.from("orders").select("id, company_id, customer_name, product_name, order_value_naira, care_agent_id").eq("id", r.order_id).maybeSingle();
      if (!ord) continue;
      const { error: dup } = await admin.from("order_notifications").insert({
        order_id: ord.id,
        company_id: ord.company_id,
        event: "order_confirm_no_reply",
        status: "sent"
      });
      if (dup) continue; // already flagged
      await admin.from("orders").update({
        care_note: "No WhatsApp confirmation after a reminder. Please call the customer to confirm."
      }).eq("id", ord.id);
      await pushCare(ord, "Customer hasn't confirmed - please call", `noreply-${ord.id}`);
      out.flagged++;
    } catch (e) {
      out.errors.push(`flag ${r.order_id}: ${e.message}`);
    }
  }
  return out;
}
Deno.serve(async (req)=>{
  if (req.method !== "POST") return json({
    error: "POST only"
  }, 405);
  if (!await authorised(req)) return json({
    error: "unauthorized"
  }, 401);
  let body = {};
  try {
    body = await req.json();
  } catch  {
    return json({
      error: "Bad request"
    }, 400);
  }
  if (body.action === "sweep") {
    if (!WA_TOKEN || !WA_PHONE_ID) return json({
      error: "WhatsApp isn't configured"
    }, 500);
    return json({
      ok: true,
      ...await sweep()
    });
  }
  const orderId = String(body.order_id || ""), event = String(body.event || "");
  // The customer typed a short yes / no. Find their one pending order that was sent a confirmation request.
  if (event === "order_text_reply") {
    const text = String(body.text ?? "");
    const act = YES_RE.test(text) ? "confirm" : NO_RE.test(text) ? "cancel" : null;
    const to = phoneOf(String(body.from ?? ""));
    if (!act || !to || !WA_TOKEN || !WA_PHONE_ID) return json({
      ok: true,
      skipped: "not a yes/no"
    });
    const last10 = to.slice(-10);
    const { data: cands } = await admin.from("orders").select("id, company_id, customer_name, customer_phone, order_status, payment_method").eq("order_status", "pending").like("customer_phone", `%${last10}`).gt("ordered_at", new Date(Date.now() - 3 * 86400_000).toISOString()).limit(10);
    const asked = [];
    for (const c of cands ?? []){
      if (phoneOf(c.customer_phone) !== to) continue;
      const { data: n } = await admin.from("order_notifications").select("order_id").eq("order_id", c.id).eq("event", "order_confirm_request").maybeSingle();
      if (n) asked.push(c);
    }
    if (asked.length !== 1) return json({
      ok: true,
      skipped: asked.length ? "more than one pending order" : "no order waiting for confirmation"
    });
    return json(await applyDecision(asked[0], act, to));
  }
  if (!orderId || !(event in TPL || event === "paid_claimed" || event === "care_assigned" || event === "order_confirm_tap")) return json({
    error: "order_id and a valid event are required"
  }, 400);
  // Staff alert, not a customer message: tell the customer-care agent an order was handed to them (web push).
  if (event === "care_assigned") {
    const { data: ord } = await admin.from("orders").select("id, company_id, customer_name, product_name, order_value_naira, care_agent_id").eq("id", orderId).maybeSingle();
    if (!ord?.care_agent_id) return json({
      ok: true,
      skipped: "no care agent"
    });
    const k = `care_assigned_${ord.care_agent_id}`;
    const { error: dup } = await admin.from("order_notifications").insert({
      order_id: ord.id,
      company_id: ord.company_id,
      event: k,
      status: "sent"
    });
    if (dup) return json({
      ok: true,
      skipped: "already sent"
    });
    const push = await pushCare(ord, "New order to call", `care-${ord.id}`);
    return json({
      ok: true,
      event,
      push: push ?? "failed"
    });
  }
  if (!WA_TOKEN || !WA_PHONE_ID) return json({
    error: "WhatsApp isn't configured (BEOLIV_WHATSAPP_ACCESS_TOKEN / _PHONE_NUMBER_ID)."
  }, 500);
  const { data: o } = await admin.from("orders").select("id, company_id, customer_name, customer_phone, customer_address, customer_city, customer_state, product_name, order_value_naira, order_status, payment_method, delivery_agent_id, media_buyer_id, payment_narration_code, shipbubble_order_id, shipbubble_courier, cod_amount_naira, companies(name)").eq("id", orderId).maybeSingle();
  if (!o) return json({
    error: "Order not found"
  }, 404);
  const to = phoneOf(o.customer_phone);
  if (!to) return json({
    ok: true,
    skipped: "no phone"
  });
  // "I've paid" and the Confirm / Cancel buttons must come from the customer's own number (the webhook URL is public; the order id is not a secret).
  if ((event === "paid_claimed" || event === "order_confirm_tap") && phoneOf(String(body.from ?? "")) !== to) return json({
    ok: true,
    skipped: "sender is not the customer"
  });
  if (event === "order_confirm_tap") return json(await applyDecision(o, body.action === "cancel" ? "cancel" : "confirm", to));
  // One send per order and step (paid_claimed may repeat, so it gets its own key each time).
  const key = event === "paid_claimed" ? `paid_claimed_${Date.now()}` : event;
  const { error: dupErr } = await admin.from("order_notifications").insert({
    order_id: o.id,
    company_id: o.company_id,
    event: key,
    status: "sending"
  });
  if (dupErr) return json({
    ok: true,
    skipped: "already sent"
  });
  const finish = (status, wa, error)=>admin.from("order_notifications").update({
      status,
      wa_message_id: wa ?? null,
      error: error ?? null
    }).eq("order_id", o.id).eq("event", key);
  try {
    const name = o.customer_name || "there";
    const product = o.product_name || "your order";
    const brand = o.companies?.name || "our store";
    // A shipment booked with a courier through Shipbubble: the courier collects the cash and calls the customer, no own rider involved.
    const courierOrder = !!o.shipbubble_order_id;
    let agent = null;
    if (o.delivery_agent_id) {
      const { data: a } = await admin.from("delivery_agents").select("name, phone").eq("id", o.delivery_agent_id).maybeSingle();
      if (a) agent = {
        name: a.name || "your delivery agent",
        phone: a.phone || ""
      };
    }
    // The buyer's own payment account: shown to the customer when the order is placed and again when the rider is on the way.
    let acct = null;
    if (o.media_buyer_id && (event === "order_received" || event === "out_for_delivery" && !courierOrder)) {
      // Customers pay the company's account number; a company without one yet falls back to the media buyer's own.
      let { data: coA } = o.company_id ? await admin.from("companies").select("name, dedicated_account_number, dedicated_account_bank").eq("id", o.company_id).maybeSingle() : { data: null };
      if (o.company_id && coA && !coA.dedicated_account_number) {
        await fetch(`${SUPABASE_URL}/functions/v1/paystack-create-company-account`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` }, body: JSON.stringify({ company_id: o.company_id }) }).catch(()=>{});
        coA = (await admin.from("companies").select("name, dedicated_account_number, dedicated_account_bank").eq("id", o.company_id).maybeSingle()).data;
      }
      if (coA?.dedicated_account_number) acct = { bank: coA.dedicated_account_bank || "", number: coA.dedicated_account_number, holder: coA.name || brand };
      let { data: b } = acct ? { data: null } : await admin.from("media_buyers").select("name, dedicated_account_number, dedicated_account_bank").eq("id", o.media_buyer_id).maybeSingle();
      if (b && !b.dedicated_account_number) {
        await fetch(`${SUPABASE_URL}/functions/v1/paystack-create-account`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`
          },
          body: JSON.stringify({
            media_buyer_id: o.media_buyer_id
          })
        }).catch(()=>{});
        ({ data: b } = await admin.from("media_buyers").select("name, dedicated_account_number, dedicated_account_bank").eq("id", o.media_buyer_id).maybeSingle());
      }
      if (b?.dedicated_account_number) acct = {
        bank: b.dedicated_account_bank || "",
        number: b.dedicated_account_number,
        holder: `${brand} ${b.name || ""}`.trim()
      };
    }
    const amount = "₦" + Number(o.order_value_naira ?? 0).toLocaleString("en-NG");
    const payBlock = acct ? `\n\nTo pay by transfer:\n${acct.bank}\n${acct.number}\n${acct.holder}\nAmount: ${amount}${o.payment_narration_code ? `\nPut this code in the narration: ${o.payment_narration_code}` : ""}` : "";
    // A plain message (carrying the account) goes first: it works while the customer's WhatsApp conversation is open.
    // If WhatsApp refuses it (outside the 24-hour window), the approved template below is sent instead.
    const tryText = async (text)=>{
      try {
        return await sendText(to, text);
      } catch (e) {
        console.error("text send failed, using template:", e.message);
        return null;
      }
    };
    // Approved template first (works any time); if it is missing or refused, a plain message (works while the chat is open).
    const tplOrText = async (tpl, params, text)=>{
      try {
        return await sendTemplate(to, tpl, params);
      } catch (e) {
        console.error("template failed, sending text:", tpl, e.message);
        return await sendText(to, text);
      }
    };
    let wa = "";
    if (event === "order_confirm_request" || event === "order_confirm_reminder") {
      const payloads = [
        `CONFIRM_ORDER:${o.id}`,
        `CANCEL_ORDER:${o.id}`
      ];
      if (event === "order_confirm_request") {
        const addr = [
          o.customer_address,
          o.customer_city,
          o.customer_state
        ].filter(Boolean).join(", ");
        const amt = Number(o.order_value_naira ?? 0).toLocaleString("en-NG");
        try {
          wa = await sendTemplateButtons(to, TPL.order_confirm_request, [
            name,
            product,
            brand,
            amt,
            addr || "-"
          ], payloads);
        } catch (e) {
          console.error("confirm template failed, sending text:", e.message);
          wa = await sendText(to, `Hi ${name}, thank you for your order of ${product} from ${brand}. Amount: ${amount}. Reply YES to confirm it, or NO to cancel.`);
        }
      } else {
        try {
          wa = await sendTemplateButtons(to, TPL.order_confirm_reminder, [
            name,
            product
          ], payloads);
        } catch (e) {
          console.error("reminder template failed, sending text:", e.message);
          wa = await sendText(to, `Hi ${name}, we're still holding your order of ${product}. Reply YES to confirm it and we'll send it out today, or NO to cancel.`);
        }
      }
    } else if (event === "order_received") {
      wa = await tryText(`Hi ${name}, thank you for your order of ${product} from ${brand}! 🙏 Our team will call you shortly to confirm the details.${payBlock}`) ?? await sendTemplate(to, TPL.order_received, [
        name,
        product,
        brand
      ]);
    } else if (event === "order_confirmed") wa = await tplOrText(TPL.order_confirmed, [
      name,
      product
    ], `Hi ${name}, your order for ${product} is confirmed and being prepared. We'll message you when it's on the way.`);
    else if (event === "agent_accepted") wa = await tplOrText(TPL.agent_accepted, [
      name,
      agent?.name ?? "your delivery agent",
      agent?.phone ?? ""
    ], `Hi ${name}, ${agent?.name ?? "your delivery agent"}${agent?.phone ? ` (${agent.phone})` : ""} will deliver your ${product}.`);
    else if (event === "out_for_delivery" && courierOrder) {
      // Short courier update: who is bringing it, and how much to have ready. No tracking link.
      const courier = o.shipbubble_courier || "our courier";
      const codNaira = o.cod_amount_naira != null ? Number(o.cod_amount_naira) : /pay on delivery|cash on delivery|\bcod\b/i.test(o.payment_method ?? "") ? Number(o.order_value_naira ?? 0) : 0;
      if (codNaira > 0) {
        const amt = codNaira.toLocaleString("en-NG");
        wa = await tplOrText(TPL_SHIPPED, [
          name,
          product,
          courier,
          amt
        ], `Hi ${name}, your order of ${product} is on the way with ${courier}. Please keep your phone close, the courier will call you before delivery. Amount to pay on delivery: ₦${amt}.`);
      } else {
        wa = await sendText(to, `Hi ${name}, your order of ${product} is on the way with ${courier}. Please keep your phone close, the courier will call you before delivery.`);
      }
    } else if (event === "out_for_delivery") {
      wa = await tryText(`Hi ${name}, ${agent?.name ?? "your delivery agent"}${agent?.phone ? ` (${agent.phone})` : ""} is on the way with your ${product}. 🛵${payBlock ? `\n\nYou can pay now by transfer and your rider will confirm it.${payBlock}` : ""}`) ?? await sendTemplate(to, TPL.out_for_delivery, [
        name,
        agent?.name ?? "your delivery agent",
        agent?.phone ?? ""
      ]);
    } else if (event === "order_delivered") {
      wa = await tplOrText(TPL.order_delivered, [
        name,
        product
      ], `Hi ${name}, your ${product} has been delivered. Thank you for shopping with ${brand}! 🎉`);
      // Payment comes after delivery: send the account + code (+ "I've paid" button) unless it is already paid.
      // Courier orders are paid in cash to the courier (Shipbubble remits it to us), so no transfer request goes out for them.
      const { data: paid } = await admin.from("payments").select("id").eq("order_id", o.id).eq("status", "confirmed").limit(1);
      if (!paid?.length && !courierOrder) {
        await fetch(`${SUPABASE_URL}/functions/v1/send-payment-whatsapp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`
          },
          body: JSON.stringify({
            order_id: o.id,
            type: "payment_request",
            after_delivery: true
          })
        }).catch((e)=>console.error("payment_request failed:", e));
      }
    } else if (event === "paid_claimed") {
      // The customer tapped "I've paid". The Paystack webhook is the source of truth (code or name + amount match).
      const { data: paid } = await admin.from("payments").select("id").eq("order_id", o.id).eq("status", "confirmed").limit(1);
      if (paid?.length) wa = await sendText(to, `Thank you ${name}, we have received your payment. Your order is complete.`);
      else wa = await sendText(to, `Thanks ${name}. We haven't seen your payment yet; banks can take a few minutes. If you already sent it, reply with your transfer receipt and our team will confirm it.`);
    }
    await finish("sent", wa);
    return json({
      ok: true,
      event
    });
  } catch (err) {
    console.error("notify-customer error:", event, err);
    await finish("failed", undefined, String(err?.message ?? err).slice(0, 300));
    return json({
      ok: false,
      error: err?.message ?? "failed"
    }, 200);
  }
});
