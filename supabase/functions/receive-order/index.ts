import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v18.0";

// Helper: Normalize and Hash string using SHA-256
async function hashData(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  
  // Normalize string: lowercase and trim
  let normalized = value.trim().toLowerCase();
  
  // If it looks like a phone number, remove non-numeric chars
  if (/^[+\d\s()-]+$/.test(value) && !value.includes('@')) {
    normalized = value.replace(/\D/g, "");
    // Default country code logic could be added here, assuming Nigerian (+234) if starts with 0
    if (normalized.startsWith("0") && normalized.length === 11) {
      normalized = "234" + normalized.substring(1);
    }
  }

  const msgUint8 = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

Deno.serve(async (req: Request) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST' } });
  }

  try {
    const payload = await req.json();

    const email = payload.email || payload.customer_email;
    const phone = payload.phone || payload.customer_phone;
    const event_id = payload.event_id;
    const product_name = payload.product_name;
    const quantity = payload.quantity ? parseInt(payload.quantity) : 1;
    const customer_name = payload.customer_name || payload.first_name + " " + (payload.last_name || "");
    const customer_address = payload.customer_address || payload.address;
    const order_value_naira = payload.order_value_naira ? parseFloat(payload.order_value_naira) : 19000 * quantity;
    const ad_set_id = payload.ad_set_id;
    const creative_id = payload.creative_id;

    if (!event_id) {
      return new Response(JSON.stringify({ error: "Missing event_id" }), { status: 400 });
    }

    const hashedEmail = await hashData(email);
    const hashedPhone = await hashData(phone);
    const firstName = payload.first_name || (payload.customer_name ? payload.customer_name.split(' ')[0] : undefined);
    const lastName = payload.last_name || (payload.customer_name && payload.customer_name.includes(' ') ? payload.customer_name.substring(payload.customer_name.indexOf(' ') + 1) : undefined);
    const hashedFn = await hashData(firstName);
    const hashedLn = await hashData(lastName);

    let capiSuccess = false;

    // Send to Meta CAPI
    if (META_ACCESS_TOKEN && META_PIXEL_ID) {
      const capiPayload = {
        data: [
          {
            event_name: "Purchase",
            event_time: Math.floor(Date.now() / 1000),
            action_source: "website",
            event_id: event_id,
            user_data: {
              em: hashedEmail ? [hashedEmail] : undefined,
              ph: hashedPhone ? [hashedPhone] : undefined,
              fn: hashedFn ? [hashedFn] : undefined,
              ln: hashedLn ? [hashedLn] : undefined,
              client_ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
              client_user_agent: req.headers.get("user-agent"),
            },
            custom_data: {
              currency: "NGN",
              value: order_value_naira,
            }
          }
        ]
      };

      try {
        const capiRes = await fetch(`${META_GRAPH_BASE}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify(capiPayload),
        });
        
        const capiData = await capiRes.json();
        if (capiData.events_received) {
          capiSuccess = true;
          console.log(`? CAPI Purchase event fired for ${event_id}`);
        } else {
          console.error(`? CAPI Error:`, capiData);
        }
      } catch (err) {
        console.error("CAPI Network Error:", err);
      }
    }

    // Insert into Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Convert empty string ad_set_id / creative_id to null for UUID columns
    const finalAdSetId = (ad_set_id && ad_set_id.trim() !== '') ? ad_set_id : null;
    const finalCreativeId = (creative_id && creative_id.trim() !== '') ? creative_id : null;

    const { error: dbError } = await supabase.from('orders').upsert({
      event_id,
      customer_email: email,
      customer_phone: phone,
      customer_name,
      customer_address,
      product_name,
      quantity,
      order_value_naira,
      capi_sent: capiSuccess,
      ad_set_id: finalAdSetId,
      creative_id: finalCreativeId,
      order_status: 'pending'
    }, { onConflict: 'event_id' });

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      event_id, 
      capi_sent: capiSuccess 
    }), { 
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
    });

  } catch (err: any) {
    console.error("Webhook processing error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
});
