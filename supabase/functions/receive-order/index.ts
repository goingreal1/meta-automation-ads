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
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
  }

  try {
    const payload = await req.json();

    const email = payload.email || payload.customer_email;
    const phone = payload.phone || payload.customer_phone;
    const event_id = payload.event_id;
    const product_name = payload.product_name;
    let quantity = payload.quantity ? parseInt(payload.quantity) : 1;
    const customer_name = payload.customer_name || payload.first_name + " " + (payload.last_name || "");
    const customer_address = payload.customer_address || payload.address;
    const customer_city = payload.customer_city as string | undefined;
    const customer_state = payload.customer_state as string | undefined;
    const customer_country = (payload.customer_country as string | undefined) || "NG";
    const payment_method = payload.payment_method as string | undefined;
    let order_value_naira = payload.order_value_naira ? parseFloat(payload.order_value_naira) : 19000 * quantity;
    const currency = (payload.currency as string | undefined)?.toUpperCase() || "NGN";
    const ad_set_id = payload.ad_set_id;
    const creative_id = payload.creative_id;
    const product_id = payload.product_id as string | undefined;
    const tier_id = payload.tier_id as string | undefined;
    // Meta click/browser IDs for CAPI match quality — fbc can also be reconstructed from a bare fbclid
    const fbp = payload.fbp as string | undefined;
    const fbc = (payload.fbc as string | undefined) ??
      (payload.fbclid ? `fb.1.${Math.floor(Date.now() / 1000)}.${payload.fbclid}` : undefined);

    if (!event_id) {
      return new Response(JSON.stringify({ error: "Missing event_id" }), { status: 400 });
    }

    const hashedEmail = await hashData(email);
    const hashedPhone = await hashData(phone);
    const firstName = payload.first_name || (payload.customer_name ? payload.customer_name.split(' ')[0] : undefined);
    const lastName = payload.last_name || (payload.customer_name && payload.customer_name.includes(' ') ? payload.customer_name.substring(payload.customer_name.indexOf(' ') + 1) : undefined);
    const hashedFn = await hashData(firstName);
    const hashedLn = await hashData(lastName);

    // Insert into Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Which company this order belongs to, in a shared multi-tenant platform
    // (see CRM_FULL_ARCHITECTURE_PLAN.md Phase 1). order.html always sends
    // product_id -- the reliable path, since every product belongs to exactly
    // one company. Older/hand-built sales pages (e.g. sales-ginaris-herbal.html)
    // predate that field and only ever send ad_set_id, so that's the fallback.
    // If neither resolves, the order is left company_id = null: invisible to
    // every dashboard until someone fixes it by hand, rather than guessing --
    // see the migration's note on why that's the deliberately safe failure mode.
    // Resolved up front (not just before the insert) because the CAPI pixel
    // config below also needs to know which company's pixel to fire to.
    let companyId: string | null = null;
    // The order's own ad_accounts row, resolved the exact same way
    // get-product-public resolves it for the browser pixel (product_id ->
    // products.ad_account_id, falling back to ad_set_id -> ad_sets.ad_account_id
    // for older hand-built sales pages that predate product_id). Kept in sync
    // with that lookup deliberately: the server CAPI event and the browser
    // pixel event share one event_id for Meta's dedup, so they MUST fire to
    // the same pixel or that dedup (and match quality) breaks.
    let resolvedAdAccountId: string | null = null;
    if (product_id) {
      const { data: productRow } = await supabase.from('products').select('company_id, ad_account_id').eq('id', product_id).maybeSingle();
      companyId = productRow?.company_id ?? null;
      resolvedAdAccountId = productRow?.ad_account_id ?? null;
    }
    if (!companyId && ad_set_id) {
      const { data: adSetCompanyRow } = await supabase.from('ad_sets').select('company_id').eq('id', ad_set_id).maybeSingle();
      companyId = adSetCompanyRow?.company_id ?? null;
    }
    if (!resolvedAdAccountId && ad_set_id) {
      const { data: adSetRow } = await supabase.from('ad_sets').select('ad_account_id').eq('id', ad_set_id).maybeSingle();
      resolvedAdAccountId = adSetRow?.ad_account_id ?? null;
    }
    if (!companyId) {
      console.error(`receive-order: could not resolve a company for event_id ${event_id} (product_id=${product_id ?? 'none'}, ad_set_id=${ad_set_id ?? 'none'}) -- order will be saved but invisible until this is fixed.`);
    }

    // A package-tier order (order.html's selectable cards -- "1 piece" /
    // "3-piece bundle" etc.) carries tier_id instead of a client-computed
    // price: the real quantity/price come from this lookup, never from
    // whatever order_value_naira the browser happened to send, so a
    // tampered request can't check out at an arbitrary price.
    if (tier_id && product_id) {
      const { data: tierRow } = await supabase
        .from('product_tiers')
        .select('quantity, price_naira')
        .eq('id', tier_id)
        .eq('product_id', product_id)
        .eq('is_active', true)
        .maybeSingle();
      if (tierRow) {
        quantity = tierRow.quantity;
        order_value_naira = Number(tierRow.price_naira);
      }
    }

    // CAPI pixel/token: resolved per ad_account, same as the browser pixel,
    // so a company running several buyers/pixels fires each order to the
    // RIGHT one instead of one shared value. The access token comes from
    // whichever buyer connected that specific ad account (meta_connections,
    // via ad_accounts.meta_connection_id) -- not a separate credential to
    // manage per pixel. Falls back to company_settings (a company-wide
    // override, e.g. for a manually-added account with no OAuth connection),
    // then the original global env vars for a company that's configured
    // neither (keeps the one pre-multi-tenancy company working unchanged).
    let capiPixelId: string | null = null;
    let capiAccessToken: string | null = null;
    if (resolvedAdAccountId) {
      const { data: acctRow } = await supabase
        .from('ad_accounts')
        .select('meta_pixel_id, meta_connection_id')
        .eq('id', resolvedAdAccountId)
        .maybeSingle();
      capiPixelId = acctRow?.meta_pixel_id ?? null;
      if (acctRow?.meta_connection_id) {
        const { data: connRow } = await supabase.from('meta_connections').select('access_token').eq('id', acctRow.meta_connection_id).maybeSingle();
        capiAccessToken = connRow?.access_token ?? null;
      }
    }
    if ((!capiPixelId || !capiAccessToken) && companyId) {
      const { data: settings } = await supabase.from('company_settings').select('meta_pixel_id, meta_access_token').eq('company_id', companyId).maybeSingle();
      if (!capiPixelId) capiPixelId = settings?.meta_pixel_id ?? null;
      if (!capiAccessToken) capiAccessToken = settings?.meta_access_token ?? null;
    }
    if (!capiPixelId) capiPixelId = META_PIXEL_ID;
    if (!capiAccessToken) capiAccessToken = META_ACCESS_TOKEN;

    let capiSuccess = false;

    // Send to Meta CAPI
    if (capiAccessToken && capiPixelId) {
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
              fbp: fbp || undefined,
              fbc: fbc || undefined,
            },
            custom_data: {
              currency: currency,
              value: order_value_naira,
            }
          }
        ]
      };

      try {
        const capiRes = await fetch(`${META_GRAPH_BASE}/${capiPixelId}/events?access_token=${capiAccessToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

    // Convert empty string ad_set_id / creative_id to null for UUID columns
    let finalAdSetId = (ad_set_id && ad_set_id.trim() !== '') ? ad_set_id : null;
    let finalCreativeId = (creative_id && creative_id.trim() !== '') ? creative_id : null;

    // orders.creative_id references `creatives` (the Meta-synced table sync-meta-structure
    // populates), NOT `creative_assets` (the pre-launch Vault) — the crid param from the ad
    // link is a creative_assets id, which won't exist there until sync-meta-structure links
    // it up later (via creative_assets.linked_creative_id). So this is expected to null out
    // for most orders placed before that sync catches up — that's fine, not an error case;
    // creative-level attribution is joined later via ad_sets.creative_id once populated.
    if (finalCreativeId) {
      const { data: creativeRow } = await supabase
        .from('creatives')
        .select('id')
        .eq('id', finalCreativeId)
        .maybeSingle();
      if (!creativeRow) finalCreativeId = null;
    }

    // Derive ad_account_id from the ad set so the dashboard's per-account order filter
    // (which matches on ad_account_id, not ad_set_id) actually finds this order.
    // If ad_set_id doesn't correspond to a real row (stale link, deleted ad set, bad
    // input), fall back to null rather than letting the FK constraint reject the whole order.
    let finalAdAccountId: string | null = null;
    if (finalAdSetId) {
      const { data: adSetRow } = await supabase
        .from('ad_sets')
        .select('ad_account_id')
        .eq('id', finalAdSetId)
        .maybeSingle();
      if (adSetRow) {
        finalAdAccountId = adSetRow.ad_account_id ?? null;
      } else {
        finalAdSetId = null;
      }
    }

    // Explicit buyer from the ad link (?buyer=<id>, passed through checkout)
    // wins; otherwise the orders trigger inherits it from the ad set. The
    // Order Forms tab generates links with the buyer's own id (already an
    // opaque UUID -- no separate "code" for a customer-facing link to leak
    // or for a buyer to mistype/guess someone else's). The short [CODE] used
    // in ad set names is a different mechanism entirely (Meta ad set names
    // need something human-typeable), so older/hand-built sales pages that
    // still pass a code are supported as a fallback, not the primary path.
    let mediaBuyerId: string | null = null;
    const buyerParam = (payload.buyer || payload.buyer_code || payload.utm_buyer) as string | undefined;
    if (buyerParam && companyId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(buyerParam.trim());
      const { data: buyerRow } = await supabase
        .from('media_buyers')
        .select('id')
        .eq(isUuid ? 'id' : 'code', isUuid ? buyerParam.trim() : buyerParam.trim().toUpperCase())
        .eq('company_id', companyId)
        .maybeSingle();
      mediaBuyerId = buyerRow?.id ?? null;
    }

    const { data: orderRow, error: dbError } = await supabase.from('orders').upsert({
      company_id: companyId,
      // Was resolved above (to look up company_id/ad_account_id) but never
      // actually stored on the order -- confirmed real gap, the thing stock
      // tracking's delivered-decrement trigger needs to know which product.
      product_id: product_id || null,
      event_id,
      customer_email: email,
      customer_phone: phone,
      customer_name,
      customer_address,
      customer_city,
      customer_state,
      customer_country,
      payment_method,
      product_name,
      quantity,
      order_value_naira,
      currency,
      capi_sent: capiSuccess,
      ad_set_id: finalAdSetId,
      creative_id: finalCreativeId,
      ad_account_id: finalAdAccountId,
      ...(mediaBuyerId ? { media_buyer_id: mediaBuyerId } : {}),
      fbclid: payload.fbclid || null,
      meta_ad_id: payload.ad_id || payload.meta_ad_id || null,
      order_status: 'pending'
    }, { onConflict: 'event_id' }).select('id').single();

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    // Kick off the AI confirmation call. place-order-call dedupes per order
    // (so checkout retries of the same event_id don't ring twice) and holds
    // it until calling hours if it's night in Lagos. Not awaited past the
    // request -- the customer's checkout shouldn't wait on telephony.
    if (orderRow?.id) {
      const callRequest = fetch(`${SUPABASE_URL}/functions/v1/place-order-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ order_id: orderRow.id }),
      }).then(r => r.text()).then(t => console.log("place-order-call:", t))
        .catch(err => console.error("place-order-call failed:", err));
      const edgeRuntime = (globalThis as any).EdgeRuntime;
      if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(callRequest);
      else await callRequest;
    }

    // Narration code the customer is asked to include in their transfer --
    // paystack-webhook's primary (not guaranteed, see its own comment)
    // signal for matching a deposit to this exact order. Short, human-typeable.
    // Also ensures the buyer's own Paystack Dedicated Virtual Account exists
    // (one per buyer, reused across every order of theirs -- not per order).
    let payment: { account_number: string; bank_name: string; account_name: string; narration_code: string } | null = null;
    if (orderRow?.id) {
      const narrationCode = `PAY${orderRow.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      await supabase.from("orders").update({ payment_narration_code: narrationCode }).eq("id", orderRow.id);

      if (mediaBuyerId) {
        try {
          const payRes = await fetch(`${SUPABASE_URL}/functions/v1/paystack-create-account`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ media_buyer_id: mediaBuyerId }),
          });
          const payBody = await payRes.json();
          if (payRes.ok && !payBody.error) payment = { ...payBody, narration_code: narrationCode };
          else console.error("paystack-create-account failed:", payBody.error);
        } catch (err) {
          console.error("paystack-create-account failed:", err);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      event_id,
      capi_sent: capiSuccess,
      payment,
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
