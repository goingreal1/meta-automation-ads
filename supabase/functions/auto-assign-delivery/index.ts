import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Rider assignment: offers a newly-confirmed order to one active delivery
// agent in the matching zone, waits for them to accept/decline from their
// "My deliveries" screen, and re-offers to the next candidate on a decline
// or timeout. Called two ways:
//   - fire-and-forget right after elevenlabs-webhook promotes an order to
//     "valid" (so an AI-confirmed order gets offered within seconds)
//   - every 5 minutes via pg_cron (handles orders customer care confirmed
//     by hand, and re-offers anything that timed out unanswered)
// Either call runs the exact same full sweep -- it's cheap and idempotent,
// so there's no reason to special-case the webhook call to one order.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const OFFER_TIMEOUT_MINUTES = 5;

// A service-role token can be a different (but equally valid) string from the
// env key -- pg_cron stores its own copy -- so besides the exact match, prove
// the token by asking the Auth admin API, which only a service-role key can use.
async function isServiceCaller(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) return true;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1`, { headers: { apikey: token, Authorization: `Bearer ${token}` } });
    return r.status === 200;
  } catch { return false; }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

// Loose text match -- the real geo data in this schema is just two free-text
// fields (an agent's "zone", an order's customer_city/customer_state), with
// no shared taxonomy between them ("Lagos Mainland" the zone vs "Lagos" the
// state). Either containing the other is treated as a match; this is a
// best-effort stand-in for real geocoding, not a precise one.
function zoneMatches(zone: string | null, city: string | null, state: string | null): boolean {
  if (!zone) return false;
  const z = zone.toLowerCase();
  for (const field of [city, state]) {
    if (!field) continue;
    const f = field.toLowerCase();
    if (z.includes(f) || f.includes(z)) return true;
  }
  return false;
}

const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameArea = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
// How well a rider covers an order: 3 = same state and city, 2 = same state, 1 = old free-text zone matches, 0 = no match.
function areaScore(a: { zone: string | null; state: string | null; city: string | null }, city: string | null, state: string | null): number {
  if (norm(a.state)) {
    if (!sameArea(norm(a.state), norm(state))) return 0;
    return sameArea(norm(a.city), norm(city)) ? 3 : 2;
  }
  return zoneMatches(a.zone, city, state) ? 1 : 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // Internal-only: callers send the service-role key.
  if (!(await isServiceCaller(req))) return json({ error: "unauthorized" }, 401);

  try {
    const now = new Date();
    const timeoutCutoff = new Date(now.getTime() - OFFER_TIMEOUT_MINUTES * 60 * 1000).toISOString();
    const summary = { expired: 0, offered: 0, errors: [] as string[] };

    // 1. Expire anything nobody answered in time, freeing it back up.
    const { data: expiring } = await supabase
      .from("orders")
      .select("id, company_id, delivery_agent_id")
      .eq("assignment_status", "offered")
      .lt("assignment_offered_at", timeoutCutoff);

    for (const o of expiring ?? []) {
      await supabase.from("orders").update({
        delivery_agent_id: null, assignment_status: "expired",
      }).eq("id", o.id);
      await supabase.from("assignment_offers")
        .update({ outcome: "expired", responded_at: now.toISOString() })
        .eq("order_id", o.id).eq("delivery_agent_id", o.delivery_agent_id).eq("outcome", "offered");
      summary.expired++;
    }

    // 2. Offer every valid, unassigned order to one candidate agent.
    const { data: candidates, error: candErr } = await supabase
      .from("orders")
      .select("id, company_id, customer_city, customer_state")
      .eq("order_status", "valid")
      .is("delivery_agent_id", null)
      .is("assignment_status", null)
      .limit(200);
    if (candErr) throw candErr;

    for (const order of candidates ?? []) {
      try {
        const [{ data: agents }, { data: declined }, { data: activeLoad }] = await Promise.all([
          supabase.from("delivery_agents").select("id, zone, state, city").eq("company_id", order.company_id).eq("active", true),
          supabase.from("assignment_offers").select("delivery_agent_id").eq("order_id", order.id).in("outcome", ["declined", "expired"]),
          supabase.from("orders").select("delivery_agent_id").eq("company_id", order.company_id).in("assignment_status", ["offered", "accepted"]),
        ]);
        const triedAgentIds = new Set((declined ?? []).map((d) => d.delivery_agent_id));
        const eligible = (agents ?? []).filter((a) => !triedAgentIds.has(a.id));
        if (!eligible.length) continue; // nobody left to offer this to -- stays unassigned for a human to handle

        const loadByAgent = new Map<string, number>();
        for (const row of activeLoad ?? []) {
          if (!row.delivery_agent_id) continue;
          loadByAgent.set(row.delivery_agent_id, (loadByAgent.get(row.delivery_agent_id) ?? 0) + 1);
        }

        // Prefer a zone match; fall back to least-loaded of everyone eligible
        // when there's no zone match at all (most demo orders have no city
        // set, and a real one shouldn't get stuck forever over missing data).
        const scored = eligible.map((a) => ({ a, score: areaScore(a, order.customer_city, order.customer_state) }));
        const best = Math.max(...scored.map((x) => x.score));
        const pool = best > 0 ? scored.filter((x) => x.score === best).map((x) => x.a) : eligible;
        pool.sort((a, b) => (loadByAgent.get(a.id) ?? 0) - (loadByAgent.get(b.id) ?? 0));
        const chosen = pool[0];

        // .is(..., null) is the SQL "IS NULL" test; .eq(..., null) matches nothing, which silently left every order unassigned.
        const { data: claimed, error: updErr } = await supabase.from("orders").update({
          delivery_agent_id: chosen.id, assignment_status: "offered", assignment_offered_at: now.toISOString(),
        }).eq("id", order.id).is("assignment_status", null).select("id"); // guard against a concurrent run double-offering
        if (updErr) throw updErr;
        if (!claimed || !claimed.length) continue;

        await supabase.from("assignment_offers").insert({
          company_id: order.company_id, order_id: order.id, delivery_agent_id: chosen.id, outcome: "offered",
        });
        summary.offered++;
        // Buzz the rider's phone (web push through the shared push endpoint). A missing subscription just means no buzz.
        try {
          const { data: riders } = await supabase.from("profiles").select("id").eq("delivery_agent_id", chosen.id);
          const uids = (riders ?? []).map((x: any) => x.id);
          if (uids.length) {
            await fetch(`${SUPABASE_URL}/functions/v1/handle-whatsapp-reply`, {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({ audience: { company_id: order.company_id, user_ids: uids }, notification: { title: "New delivery for you", body: `${order.customer_city || order.customer_state || "New order"}: tap to accept within ${OFFER_TIMEOUT_MINUTES} minutes`, url: "/rider.html", tag: `offer-${order.id}` } }),
            });
          }
        } catch (e) { console.error("rider push failed:", (e as Error).message); }
      } catch (err: any) {
        summary.errors.push(`order ${order.id}: ${err.message}`);
      }
    }

    return json({ success: true, summary });
  } catch (err: any) {
    console.error("auto-assign-delivery error:", err);
    return json({ error: err.message }, 500);
  }
});
