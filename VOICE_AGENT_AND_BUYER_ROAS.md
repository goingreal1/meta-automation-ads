# AI Order-Confirmation Calls + Media Buyer ROAS

This adds two things to the existing Supabase CRM:

1. **Per-media-buyer ROAS.** Meta spend (already synced hourly by `pull-meta-metrics`) and order revenue are both attributed to a media buyer, and the **Media Buyers** dashboard tab shows spend, orders, CPA, ROAS and delivered-cash ROAS for each buyer.
2. **AI confirmation calls.** Every web checkout (`receive-order`) triggers an ElevenLabs voice agent that calls the customer on their normal phone line in a cloned Nigerian voice. It confirms the order and address, and hands anything medical to a human.

```
Meta Marketing API ──hourly──► daily_metrics ──┐
                                               ├─► media_buyer_daily_roas ─► Media Buyers tab
checkout ─► receive-order ─► orders ───────────┘
                               │
                               └─► place-order-call ─► ElevenLabs agent ─► Twilio ─► customer's phone
                                                                  │
                        voice_calls ◄── elevenlabs-webhook ◄──────┘ (transcript, outcome, red flags)
```

---

## 1. Media buyer attribution

1. Add each buyer in **Dashboard → Media Buyers → Add media buyer** with a short code, e.g. `TUNDE`.
2. Buyers put their code **in square brackets** in the ad set name *or* the campaign name:
   `Lunessa Lagos F25-45 [TUNDE]`
3. That's it. Ad sets are tagged automatically when they are created or renamed, and orders inherit the buyer of the ad set they came from. Adding a buyer also backfills their ad sets and orders that already exist.
4. Optional override: add `buyer=TUNDE` to the checkout payload (e.g. carried from a `?buyer=TUNDE` URL parameter). This wins over the ad set.

In the ROAS figures, **Revenue** excludes cancelled and returned orders. **Delivered ROAS** counts only orders marked delivered, which is the real cash figure for pay-on-delivery. Spend and orders with no buyer code show up as *Unattributed*.

The checkout payload may now also carry `fbclid` and `ad_id`. Both are stored on the order, so attribution can be re-derived later.

---

## 2. ElevenLabs setup (one-time, in the ElevenLabs dashboard)

### Voice
Record 10–20 min of clean audio from a Nigerian voice artist (include product names, naira amounts and Lagos/Abuja place names). Create a **Professional Voice Clone** from it and select that voice on the agent.

### Phone number
**Agents → Phone Numbers → Import** a Twilio number, then copy its **phone number ID**. Use a number that Nigerian networks deliver reliably; test before launch.

### Agent
Create an agent and set:

**First message**
```
Hello {{customer_name}}, good day! This is Ada calling from {{business_name}} about the {{product_name}} order you just placed. Do you have a quick minute?
```

**System prompt**
```
You are Ada, a warm, polite order-confirmation assistant for {{business_name}}, a Nigerian herbal and wellness store. You speak clear Nigerian English and can switch to Pidgin if the customer does.

Your ONLY job on this call:
1. Confirm the customer placed the order: {{quantity}} x {{product_name}}, total {{order_value}}, payment: {{payment_method}}.
2. Confirm the delivery address: {{delivery_address}}, {{delivery_city}}, {{delivery_state}}. Note any correction exactly.
3. Tell them a delivery agent will call before arriving, and ask them to keep the money ready if paying on delivery.
4. Answer simple questions about delivery, price and how to use the product, using ONLY the knowledge base.

Safety rules (never break these):
- You are not a doctor. Never diagnose, never recommend treatment, never promise a cure or results.
- Always say our products are food supplements and do not replace medicine prescribed by a doctor.
- If the customer mentions being sick, a hospital, bleeding, an allergy or reaction, pregnancy or breastfeeding, a chronic illness (diabetes, BP, kidney, liver, etc.), prescription medicine, or anything about their health beyond simple usage: say "Let me connect you to our consultant right now," and use the transfer_to_number tool immediately. Do not try to answer.
- If they ask for a human, transfer them the same way.
- If they want to cancel, do not argue. Tell them a team member will call back, then end politely.
- Never ask for card details, PINs or OTPs.
Keep every reply short: one or two sentences.
```

**Tools**
- Enable the **Transfer to number** system tool and point it at your live consultant line (the "Lagos human" handoff).
- Enable **End call**.

**Analysis → Data collection** (the webhook reads these exact names)
| Identifier | Type | Description |
|---|---|---|
| `order_confirmed` | boolean | Customer confirmed they want the order delivered |
| `wants_to_cancel` | boolean | Customer asked to cancel or said they did not order |
| `wants_human` | boolean | Customer asked to speak with a person or was transferred |
| `address_correction` | string | Any correction to the delivery address, verbatim |

**Knowledge base**: upload each product's description, usage, dosage guidance, safety notes, NAFDAC number and delivery timelines (the same content as the Products tab).

### Post-call webhook
**Settings → Webhooks → Post-call**: URL `https://<project-ref>.supabase.co/functions/v1/elevenlabs-webhook`, with transcription events enabled. Copy the signing secret.

---

## 3. Supabase secrets, deploy and cron

```bash
supabase secrets set \
  ELEVENLABS_API_KEY=... \
  ELEVENLABS_AGENT_ID=... \
  ELEVENLABS_PHONE_NUMBER_ID=... \
  ELEVENLABS_WEBHOOK_SECRET=... \
  BUSINESS_NAME="Your Store Name"

supabase db push   # applies 20260926120000_media_buyers_roas_and_voice_calls.sql
supabase functions deploy place-order-call --no-verify-jwt
supabase functions deploy elevenlabs-webhook --no-verify-jwt
supabase functions deploy receive-order --no-verify-jwt
```

Calls are only placed between **08:00 and 20:00 Lagos time**. Orders that come in at night are queued. This cron job dials them in the morning:

```sql
select cron.schedule('dial-queued-order-calls', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/place-order-call',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{"process_due": true}'::jsonb);
$$);
```

---

## 4. How a call plays out

| Outcome | What the CRM does |
|---|---|
| Customer confirms | `voice_calls.status = done`. The order moves from **pending → valid** (only from pending; a status a human set is never overwritten). |
| Medical red flag, asks for a human, or wants to cancel | The agent transfers live. The webhook also scans the transcript (English and Pidgin keywords in `_shared/safety.ts`) and puts the call in **Media Buyers → AI calls needing a human** so nobody falls through. |
| Call fails to connect | `voice_calls.status = failed` with the reason. Retry from the SQL editor with `place-order-call {"order_id": "...", "force": true}`. |

Each order gets **one** automatic call, so checkout retries never ring the customer twice.

## Not in this slice (next steps)
- WhatsApp voice notes and ElevenLabs WhatsApp calling for WhatsApp-origin customers. The Beoliv bot already handles WhatsApp text; the red-flag detector in `_shared/safety.ts` can be reused there.
- Automatic re-dial for unanswered calls (currently manual).
- Per-buyer dashboard logins (all signed-in users currently see every buyer's numbers).
