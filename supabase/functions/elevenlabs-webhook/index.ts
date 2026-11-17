import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { detectRedFlags } from "../_shared/safety.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ELEVENLABS_WEBHOOK_SECRET = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
const SIGNATURE_TOLERANCE_SECS = 30 * 60;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {
    name: "HMAC",
    hash: "SHA-256"
  }, false, [
    "sign"
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [
    ...new Uint8Array(sig)
  ].map((b)=>b.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++)diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifySignature(header, rawBody) {
  if (!header) return undefined;
  const parts = Object.fromEntries(header.split(",").map((p)=>p.split("=", 2)));
  const t = Number(parts.t);
  if (!t || !parts.v0 || Math.abs(Date.now() / 1000 - t) > SIGNATURE_TOLERANCE_SECS) return undefined;
  const message = `${parts.t}.${rawBody}`;
  if (ELEVENLABS_WEBHOOK_SECRET) {
    const hex = await hmacHex(ELEVENLABS_WEBHOOK_SECRET, message);
    if (constantTimeEqual(hex, parts.v0)) return {
      companyId: null
    };
  }
  const { data: perCompanySecrets } = await supabase.from("company_settings").select("company_id, elevenlabs_webhook_secret").not("elevenlabs_webhook_secret", "is", null);
  for (const row of perCompanySecrets ?? []){
    const hex = await hmacHex(row.elevenlabs_webhook_secret, message);
    if (constantTimeEqual(hex, parts.v0)) return {
      companyId: row.company_id
    };
  }
  return undefined;
}
function collected(analysis, key) {
  return analysis?.data_collection_results?.[key]?.value;
}
Deno.serve(async (req)=>{
  if (req.method !== "POST") return json({
    error: "POST only"
  }, 405);
  const raw = await req.text();
  const verified = await verifySignature(req.headers.get("elevenlabs-signature"), raw);
  if (!verified) {
    return json({
      error: "Invalid signature"
    }, 401);
  }
  try {
    const event = JSON.parse(raw);
    const data = event?.data ?? {};
    const conversationId = data.conversation_id;
    if (!conversationId) return json({
      ignored: "no conversation_id"
    });
    const { data: call } = await supabase.from("voice_calls").select("id, order_id").eq("elevenlabs_conversation_id", conversationId).maybeSingle();
    if (!call) return json({
      ignored: "unknown conversation"
    });
    if (event.type === "call_initiation_failure") {
      await supabase.from("voice_calls").update({
        status: "failed",
        error: data.failure_reason ?? "call initiation failed",
        ended_at: new Date().toISOString()
      }).eq("id", call.id);
      return json({
        ok: true
      });
    }
    if (event.type !== "post_call_transcription") return json({
      ignored: event.type
    });
    const transcript = data.transcript ?? [];
    const analysis = data.analysis ?? {};
    const customerTurns = transcript.filter((t)=>t.role === "user").map((t)=>String(t.message ?? ""));
    const redFlags = detectRedFlags(customerTurns);
    const wantsHuman = collected(analysis, "wants_human") === true;
    const wantsCancel = collected(analysis, "wants_to_cancel") === true;
    if (wantsHuman) redFlags.push("asked_for_human");
    if (wantsCancel) redFlags.push("wants_to_cancel");
    await supabase.from("voice_calls").update({
      status: "done",
      transcript,
      summary: analysis.transcript_summary ?? null,
      duration_secs: data.metadata?.call_duration_secs ?? null,
      red_flags: redFlags,
      needs_human: redFlags.length > 0,
      ended_at: new Date().toISOString()
    }).eq("id", call.id);
    // Only promote from pending: never override a status a human already set.
    if (call.order_id && collected(analysis, "order_confirmed") === true && !wantsCancel) {
      const { data: promoted } = await supabase.from("orders").update({
        order_status: "valid",
        updated_at: new Date().toISOString()
      }).eq("id", call.order_id).eq("order_status", "pending").select("id");
      // Fire-and-forget -- the webhook's own response to ElevenLabs shouldn't
      // wait on a WhatsApp send. Tells the customer where to pay and the
      // assigned agent what to expect.
      if (promoted?.length) {
        fetch(`${SUPABASE_URL}/functions/v1/send-payment-whatsapp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({
            order_id: call.order_id,
            type: "payment_request"
          })
        }).catch((err)=>console.error("send-payment-whatsapp failed:", err));
        // Offers this order to a rider right away instead of waiting for the
        // next cron sweep -- same fire-and-forget pattern as the line above.
        fetch(`${SUPABASE_URL}/functions/v1/auto-assign-delivery`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          }
        }).catch((err)=>console.error("auto-assign-delivery failed:", err));
      }
    }
    return json({
      ok: true,
      red_flags: redFlags
    });
  } catch (err) {
    console.error("elevenlabs-webhook error:", err);
    return json({
      error: err.message
    }, 500);
  }
});
