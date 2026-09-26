import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { detectRedFlags } from "../_shared/safety.ts";

// ElevenLabs post-call webhook (Agents platform -> Settings -> Webhooks).
// Public endpoint (verify_jwt = false); authenticity comes from the HMAC
// "ElevenLabs-Signature: t=<unix>,v0=<hex>" header over "<t>.<raw body>".
//
// For each finished call it:
//   - stores transcript, summary and duration on voice_calls
//   - moves a pending order to "valid" when the agent collected order_confirmed = true
//   - flags the call for a human callback when the customer raised a medical
//     red flag, asked for a human, or wants to cancel -- the backstop for the
//     live transfer the agent itself is instructed to do.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ELEVENLABS_WEBHOOK_SECRET = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
const SIGNATURE_TOLERANCE_SECS = 30 * 60;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

async function verifySignature(header: string | null, rawBody: string): Promise<boolean> {
  if (!header || !ELEVENLABS_WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v0 || Math.abs(Date.now() / 1000 - t) > SIGNATURE_TOLERANCE_SECS) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(ELEVENLABS_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts.t}.${rawBody}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare.
  if (hex.length !== parts.v0.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ parts.v0.charCodeAt(i);
  return diff === 0;
}

// data_collection_results values look like { value: true, rationale: "..." }.
function collected(analysis: any, key: string): unknown {
  return analysis?.data_collection_results?.[key]?.value;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const raw = await req.text();
  if (!(await verifySignature(req.headers.get("elevenlabs-signature"), raw))) {
    return json({ error: "Invalid signature" }, 401);
  }

  try {
    const event = JSON.parse(raw);
    const data = event?.data ?? {};
    const conversationId = data.conversation_id as string | undefined;
    if (!conversationId) return json({ ignored: "no conversation_id" });

    const { data: call } = await supabase
      .from("voice_calls")
      .select("id, order_id")
      .eq("elevenlabs_conversation_id", conversationId)
      .maybeSingle();
    // Inbound calls / calls not placed by this CRM -- nothing to attach to.
    if (!call) return json({ ignored: "unknown conversation" });

    if (event.type === "call_initiation_failure") {
      await supabase.from("voice_calls").update({
        status: "failed",
        error: data.failure_reason ?? "call initiation failed",
        ended_at: new Date().toISOString(),
      }).eq("id", call.id);
      return json({ ok: true });
    }

    if (event.type !== "post_call_transcription") return json({ ignored: event.type });

    const transcript: any[] = data.transcript ?? [];
    const analysis = data.analysis ?? {};
    const customerTurns = transcript.filter((t) => t.role === "user").map((t) => String(t.message ?? ""));

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
      ended_at: new Date().toISOString(),
    }).eq("id", call.id);

    // Only promote from pending: never override a status a human already set.
    if (call.order_id && collected(analysis, "order_confirmed") === true && !wantsCancel) {
      await supabase.from("orders")
        .update({ order_status: "valid", updated_at: new Date().toISOString() })
        .eq("id", call.order_id)
        .eq("order_status", "pending");
    }

    return json({ ok: true, red_flags: redFlags });
  } catch (err: any) {
    console.error("elevenlabs-webhook error:", err);
    return json({ error: err.message }, 500);
  }
});
