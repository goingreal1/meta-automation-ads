import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Dashboard actions for Shipbubble deliveries. Shipbubble does the dispatching, so there are no riders to assign:
//   POST { action: "retry",   order_id }   book the delivery again (after fixing the address, or after a failed attempt)
//   POST { action: "rates",   order_id }   check the address and show courier prices without booking anything
// Allowed for owners, admins and customer care of the order's own company. Bookings go through create-shipbubble-delivery.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(SUPABASE_URL, SERVICE);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json({ error: "Please log in." }, 401);
  const { data: me } = await db.from("profiles").select("role, company_id").eq("id", u.user.id).maybeSingle();
  if (!me || !["owner", "admin", "customer_care"].includes(me.role)) return json({ error: "Not allowed." }, 403);

  const body = await req.json().catch(() => ({}));
  const orderId = String(body?.order_id ?? "");
  if (!orderId) return json({ error: "order_id is required." }, 400);
  const { data: order } = await db.from("orders").select("id, company_id, order_status, shipbubble_order_id").eq("id", orderId).maybeSingle();
  if (!order || order.company_id !== me.company_id) return json({ error: "Order not found." }, 404);

  const action = body?.action;
  if (action !== "retry" && action !== "rates") return json({ error: "Unknown action." }, 400);
  if (action === "retry") {
    if (order.shipbubble_order_id) return json({ error: "This order already has a delivery booked." }, 409);
    if (order.order_status !== "valid") return json({ error: "Only confirmed orders can be booked." }, 409);
    await db.from("orders").update({ shipbubble_attempts: 0, shipbubble_error: null }).eq("id", orderId);
  }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/create-shipbubble-delivery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: orderId, dry_run: action === "rates", force: true }),
  });
  const out = await r.json().catch(() => ({}));
  return json(out, r.ok ? 200 : 502);
});
