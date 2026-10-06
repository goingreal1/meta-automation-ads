import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// A pending order whose confirmation call didn't land (no answer, declined,
// or the dial itself failed) previously just sat there forever -- place-order-call
// only ever places ONE automatic call per order, with no retry and no
// follow-up of any kind. Run every 30 minutes via pg_cron:
//
//   pending order, call attempt concluded (done/failed, not confirmed),
//   >= 2h since it was ordered / since the last follow-up step
//     -> attempt 0: queue a real second call attempt (place-order-call, force)
//     -> attempt 1 (that retry also didn't land): stop auto-calling, flag the
//        call for a human (same needs_human mechanism the Support Queue /
//        "AI calls needing a human" panel already watches) and send the
//        customer a WhatsApp nudge
//
// A customer_phone that never produced any voice_calls row at all (invalid
// number -- place-order-call rejected it) skips straight to the flag+nudge
// step, since there's no call left to retry.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v18.0";

// "order_followup_v1": Hi {{1}}, we tried reaching you about your order for
// {{2}} but couldn't get through. Reply to this message or call us back to
// confirm it -- otherwise we'll hold off on sending it out.
// Needs approval in Meta's WhatsApp Manager before this will actually
// deliver, same caveat as send-payment-whatsapp's templates.
const TPL_FOLLOWUP = Deno.env.get("WHATSAPP_TPL_ORDER_FOLLOWUP") ?? "order_followup_v1";

const STUCK_AFTER_HOURS = 2;
const BATCH_LIMIT = 50;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

async function sendFollowupWhatsApp(toPhone: string, customerName: string, productName: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) throw new Error("WhatsApp not configured");
  const res = await fetch(`${META_GRAPH_BASE}/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhone,
      type: "template",
      template: {
        name: TPL_FOLLOWUP,
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: (customerName || "there").trim().split(" ")[0] },
            { type: "text", text: productName || "your order" },
          ],
        }],
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "WhatsApp send failed");
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // Internal-only: callers send the service-role key.
  if (!SUPABASE_SERVICE_ROLE_KEY || req.headers.get("Authorization") !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const cutoff = new Date(Date.now() - STUCK_AFTER_HOURS * 3600_000).toISOString();
    const summary = { retried: 0, escalated: 0, skipped: 0, errors: [] as string[] };

    const { data: candidates, error } = await supabase
      .from("orders")
      .select("id, customer_name, customer_phone, product_name, ordered_at, followup_attempts, last_followup_at")
      .eq("order_status", "pending")
      .lt("followup_attempts", 2)
      .lt("ordered_at", cutoff)
      .limit(BATCH_LIMIT);
    if (error) throw error;

    for (const order of candidates ?? []) {
      try {
        // Don't re-evaluate an order whose last step was within the window --
        // give a just-queued retry call time to actually ring before deciding
        // it also didn't land.
        if (order.last_followup_at && new Date(order.last_followup_at).getTime() > Date.now() - STUCK_AFTER_HOURS * 3600_000) {
          summary.skipped++;
          continue;
        }

        const { data: calls } = await supabase
          .from("voice_calls")
          .select("id, status")
          .eq("order_id", order.id)
          .order("created_at", { ascending: false })
          .limit(1);
        const latestCall = calls?.[0];

        // Still ringing or queued -- not stuck yet, leave it alone.
        if (latestCall && !["done", "failed"].includes(latestCall.status)) {
          summary.skipped++;
          continue;
        }

        if (order.followup_attempts === 0 && latestCall) {
          // Real second attempt -- place-order-call normally only ever
          // places one call per order; force bypasses that guard.
          const res = await fetch(`${SUPABASE_URL}/functions/v1/place-order-call`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ order_id: order.id, force: true }),
          });
          if (!res.ok) throw new Error(`place-order-call retry failed: ${await res.text()}`);
          await supabase.from("orders").update({ followup_attempts: 1, last_followup_at: new Date().toISOString() }).eq("id", order.id);
          summary.retried++;
          continue;
        }

        // Either the retry also didn't land, or there was never a callable
        // number to begin with -- stop automating, flag it, nudge the customer.
        if (latestCall) {
          await supabase.from("voice_calls").update({
            needs_human: true,
            red_flags: ["stuck_no_confirmation"],
          }).eq("id", latestCall.id);
        }
        try {
          await sendFollowupWhatsApp(order.customer_phone, order.customer_name, order.product_name);
        } catch (waErr: any) {
          // Flag still lands even if WhatsApp isn't configured/approved yet --
          // a human seeing it in the queue is the real backstop either way.
          summary.errors.push(`order ${order.id} WhatsApp: ${waErr.message}`);
        }
        await supabase.from("orders").update({ followup_attempts: 2, last_followup_at: new Date().toISOString() }).eq("id", order.id);
        summary.escalated++;
      } catch (err: any) {
        summary.errors.push(`order ${order.id}: ${err.message}`);
      }
    }

    return json({ success: true, summary });
  } catch (err: any) {
    console.error("stuck-order-followup error:", err);
    return json({ error: err.message }, 500);
  }
});
