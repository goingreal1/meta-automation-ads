import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Caller must be the service role (internal) or a signed-in dashboard user --
// the public anon key alone is not enough.
type Caller = { service: boolean; company_id: string | null; role: string | null };
async function getCaller(req: Request, admin: ReturnType<typeof createClient>): Promise<Caller | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  if (SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) return { service: true, company_id: null, role: null };
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await admin.from("profiles").select("company_id, role").eq("id", data.user.id).maybeSingle();
  if (!p?.company_id) return null;
  return { service: false, company_id: p.company_id, role: p.role };
}
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v18.0";

const META_LOOKALIKE_SEED_AUDIENCE_ID = Deno.env.get("META_LOOKALIKE_SEED_AUDIENCE_ID");
const META_RETARGETING_AUDIENCE_ID = Deno.env.get("META_RETARGETING_AUDIENCE_ID");

// Helper to batch push to Meta Custom Audience
async function syncToCustomAudience(audienceId: string, users: any[]) {
  if (!users || users.length === 0) return 0;
  
  // Prepare payload format
  const data = users.map(u => {
    // Both must be hashed. If missing, pass empty string (or omit, but schema dictates order)
    // Actually, Meta allows partial matching, but let's send only what we have.
    // To simplify, if we define schema: ["EMAIL", "PHONE"], we must provide an array of length 2 for each row.
    return [
      u.hashed_email ?? "",
      u.hashed_phone ?? ""
    ];
  }).filter(row => row[0] !== "" || row[1] !== "");

  if (data.length === 0) return 0;

  // Meta allows up to 10,000 per request, we chunk by 10,000 just in case
  const CHUNK_SIZE = 10000;
  let totalAdded = 0;

  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE);
    
    const payload = {
      payload: {
        schema: ["EMAIL", "PHONE"],
        data: chunk
      },
      access_token: META_ACCESS_TOKEN
    };

    try {
      const resp = await fetch(`${META_GRAPH_BASE}/${audienceId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await resp.json();
      if (result.num_received) {
        totalAdded += result.num_received;
        console.log(`? Synced ${result.num_received} users to audience ${audienceId}`);
      } else {
        console.error(`? Meta Sync Error for audience ${audienceId}:`, result);
      }
    } catch (e) {
      console.error(`Network error syncing to audience ${audienceId}:`, e);
    }
  }
  return totalAdded;
}

// Hash function since DB stores plaintext
async function hashData(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  let normalized = value.trim().toLowerCase();
  if (/^[+\d\s()-]+$/.test(value) && !value.includes('@')) {
    normalized = value.replace(/\D/g, "");
    if (normalized.startsWith("0") && normalized.length === 11) {
      normalized = "234" + normalized.substring(1);
    }
  }
  const msgUint8 = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type, Authorization" },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const caller = await getCaller(req, supabase);
    if (!caller) return json({ error: "Not signed in" }, 401);
    // Pushes hashed customer data to a Meta audience, so owner/admin only.
    if (!caller.service && !["owner", "admin"].includes(caller.role ?? "")) return json({ error: "Forbidden" }, 403);

    let seedSynced = 0;
    let retargetingSynced = 0;

    // 1. Sync Lookalike Seed (Delivered Orders)
    if (META_LOOKALIKE_SEED_AUDIENCE_ID) {
      // Fetch delivered orders
      const { data: deliveredOrders, error } = await supabase
        .from('orders')
        .select('customer_email, customer_phone')
        .eq('order_status', 'delivered');

      if (!error && deliveredOrders) {
        // Hash data
        const hashedUsers = await Promise.all(deliveredOrders.map(async (o) => ({
          hashed_email: await hashData(o.customer_email),
          hashed_phone: await hashData(o.customer_phone)
        })));
        seedSynced = await syncToCustomAudience(META_LOOKALIKE_SEED_AUDIENCE_ID, hashedUsers);
      }
    } else {
      console.log("?? META_LOOKALIKE_SEED_AUDIENCE_ID not set. Skipping seed sync.");
    }

    // 2. Sync Warm Retargeting (Pending Orders)
    if (META_RETARGETING_AUDIENCE_ID) {
      // Fetch pending orders
      const { data: pendingOrders, error } = await supabase
        .from('orders')
        .select('customer_email, customer_phone')
        .eq('order_status', 'pending');

      if (!error && pendingOrders) {
        // Hash data
        const hashedUsers = await Promise.all(pendingOrders.map(async (o) => ({
          hashed_email: await hashData(o.customer_email),
          hashed_phone: await hashData(o.customer_phone)
        })));
        retargetingSynced = await syncToCustomAudience(META_RETARGETING_AUDIENCE_ID, hashedUsers);
      }
    } else {
      console.log("?? META_RETARGETING_AUDIENCE_ID not set. Skipping retargeting sync.");
    }

    return new Response(JSON.stringify({
      success: true,
      seed_synced: seedSynced,
      retargeting_synced: retargetingSynced
    }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });

  } catch (err: any) {
    console.error("Sync Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
});
