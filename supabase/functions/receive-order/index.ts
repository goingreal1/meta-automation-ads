import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v18.0";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
async function hashData(value) {
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
  const hashHex = hashArray.map((b)=>b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }
  try {
    const payload = await req.json();
    const email = payload.email || payload.customer_email;
    const phone = payload.phone || payload.customer_phone;
    const event_id = payload.event_id;
    let product_name = payload.product_name;
    let quantity = payload.quantity ? parseInt(payload.quantity) : 1;
    const customer_name = payload.customer_name || payload.first_name + " " + (payload.last_name || "");
    const customer_address = payload.customer_address || payload.address;
    const customer_city = payload.customer_city;
    const customer_state = payload.customer_state;
    const customer_country = payload.customer_country || "NG";
    const payment_method = payload.payment_method;
    let order_value_naira = payload.order_value_naira ? parseFloat(payload.order_value_naira) : 19000 * quantity;
    const currency = payload.currency?.toUpperCase() || "NGN";
    const ad_set_id = payload.ad_set_id;
    const creative_id = payload.creative_id;
    const product_id = payload.product_id;
    const tier_id = payload.tier_id;
    let form_data = null;
    if (payload.form_data && typeof payload.form_data === 'object' && !Array.isArray(payload.form_data)) {
      const entries = Object.entries(payload.form_data).slice(0, 20).map(([k, v])=>[
          String(k).slice(0, 80),
          String(v ?? '').slice(0, 500)
        ]).filter(([k, v])=>k && v);
      if (entries.length) form_data = Object.fromEntries(entries);
    }
    const fbp = payload.fbp;
    const fbc = payload.fbc ?? (payload.fbclid ? `fb.1.${Math.floor(Date.now() / 1000)}.${payload.fbclid}` : undefined);
    if (!event_id) {
      return new Response(JSON.stringify({
        error: "Missing event_id"
      }), {
        status: 400
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let cartLines = null;
    const rawItems = Array.isArray(payload.items) ? payload.items : null;
    if (rawItems && rawItems.length) {
      const productIds = [
        ...new Set(rawItems.map((it)=>it?.product_id).filter(Boolean))
      ];
      const tierIds = [
        ...new Set(rawItems.map((it)=>it?.tier_id).filter(Boolean))
      ];
      const [{ data: productRows }, { data: tierRows }] = await Promise.all([
        productIds.length ? supabase.from('products').select('id, product_name, company_id, ad_account_id, default_order_value_naira').in('id', productIds) : Promise.resolve({
          data: []
        }),
        tierIds.length ? supabase.from('product_tiers').select('id, product_id, quantity, price_naira').in('id', tierIds).eq('is_active', true) : Promise.resolve({
          data: []
        })
      ]);
      const productById = new Map((productRows || []).map((p)=>[
          p.id,
          p
        ]));
      const tierById = new Map((tierRows || []).map((t)=>[
          t.id,
          t
        ]));
      const resolved = [];
      for (const it of rawItems){
        const product = it?.product_id ? productById.get(it.product_id) : null;
        if (!product) {
          console.error(`receive-order: cart item with unknown product_id ${it?.product_id} dropped`);
          continue;
        }
        const tier = it?.tier_id && tierById.get(it.tier_id)?.product_id === product.id ? tierById.get(it.tier_id) : null;
        const qty = tier ? tier.quantity : Math.max(1, parseInt(it?.quantity) || 1);
        const lineTotal = tier ? Number(tier.price_naira) : Number(product.default_order_value_naira || 0) * qty;
        resolved.push({
          product_id: product.id,
          product_name: product.product_name,
          quantity: qty,
          unit_price_naira: qty ? lineTotal / qty : lineTotal,
          line_total_naira: lineTotal,
          tier_id: tier ? tier.id : null,
          company_id: product.company_id ?? null,
          ad_account_id: product.ad_account_id ?? null
        });
      }
      const primaryCompanyId = resolved[0]?.company_id ?? null;
      cartLines = resolved.filter((l)=>l.company_id === primaryCompanyId);
      if (cartLines.length !== resolved.length) {
        console.error(`receive-order: cart had items from more than one company for event_id ${event_id} -- dropped the mismatched ones`);
      }
      if (!cartLines.length) {
        return new Response(JSON.stringify({
          error: "No valid cart items"
        }), {
          status: 400
        });
      }
    }
    const hashedEmail = await hashData(email);
    const hashedPhone = await hashData(phone);
    const firstName = payload.first_name || (payload.customer_name ? payload.customer_name.split(' ')[0] : undefined);
    const lastName = payload.last_name || (payload.customer_name && payload.customer_name.includes(' ') ? payload.customer_name.substring(payload.customer_name.indexOf(' ') + 1) : undefined);
    const hashedFn = await hashData(firstName);
    const hashedLn = await hashData(lastName);
    if (cartLines) {
      quantity = cartLines.reduce((s, l)=>s + l.quantity, 0);
      order_value_naira = cartLines.reduce((s, l)=>s + l.line_total_naira, 0);
      product_name = cartLines.length === 1 ? cartLines[0].product_name : `${cartLines[0].product_name} + ${cartLines.length - 1} more item${cartLines.length > 2 ? "s" : ""}`;
    }
    const finalProductId = cartLines ? cartLines.length === 1 ? cartLines[0].product_id : null : product_id || null;
    let companyId = null;
    let resolvedAdAccountId = null;
    if (cartLines) {
      companyId = cartLines[0].company_id;
      resolvedAdAccountId = cartLines[0].ad_account_id;
    } else if (product_id) {
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
    let siteRow = null;
    let sitePageId = null;
    const siteIdParam = payload.site_id;
    if (siteIdParam) {
      const { data: sRow } = await supabase.from('sites').select('id, company_id, ad_account_id, purchase_event, settings, media_buyer_id').eq('id', siteIdParam).maybeSingle();
      if (sRow && (!companyId || sRow.company_id === companyId)) {
        siteRow = sRow;
        if (!companyId) companyId = sRow.company_id;
        if (!resolvedAdAccountId) resolvedAdAccountId = sRow.ad_account_id ?? null;
        if (payload.site_page_id) {
          const { data: pg } = await supabase.from('site_pages').select('id').eq('id', payload.site_page_id).eq('site_id', sRow.id).maybeSingle();
          sitePageId = pg?.id ?? null;
        }
      }
    }
    if (!companyId) {
      console.error(`receive-order: could not resolve a company for event_id ${event_id} (product_id=${product_id ?? 'none'}, ad_set_id=${ad_set_id ?? 'none'}) -- order will be saved but invisible until this is fixed.`);
    }
    if (!cartLines && tier_id && product_id) {
      const { data: tierRow } = await supabase.from('product_tiers').select('quantity, price_naira').eq('id', tier_id).eq('product_id', product_id).eq('is_active', true).maybeSingle();
      if (tierRow) {
        quantity = tierRow.quantity;
        order_value_naira = Number(tierRow.price_naira);
      }
    }
    let capiPixelId = null;
    let capiAccessToken = null;
    if (resolvedAdAccountId) {
      const { data: acctRow } = await supabase.from('ad_accounts').select('meta_pixel_id, meta_connection_id').eq('id', resolvedAdAccountId).maybeSingle();
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
    if (!capiPixelId || !capiAccessToken) {
      const { data: firstProfile } = await supabase.from('profiles').select('company_id').order('created_at', {
        ascending: true
      }).limit(1).maybeSingle();
      if (companyId && firstProfile?.company_id === companyId) {
        if (!capiPixelId) capiPixelId = META_PIXEL_ID || null;
        if (!capiAccessToken) capiAccessToken = META_ACCESS_TOKEN || null;
      }
    }
    let capiSuccess = false;
    // 'paid' sites send their Purchase later, from meta-capi, once the order is delivered or paid.
    if (capiAccessToken && capiPixelId && siteRow?.purchase_event !== 'none' && siteRow?.purchase_event !== 'paid') {
      const capiPayload = {
        data: [
          {
            event_name: "Purchase",
            event_time: Math.floor(Date.now() / 1000),
            action_source: "website",
            event_id: event_id,
            user_data: {
              em: hashedEmail ? [
                hashedEmail
              ] : undefined,
              ph: hashedPhone ? [
                hashedPhone
              ] : undefined,
              fn: hashedFn ? [
                hashedFn
              ] : undefined,
              ln: hashedLn ? [
                hashedLn
              ] : undefined,
              client_ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
              client_user_agent: req.headers.get("user-agent"),
              fbp: fbp || undefined,
              fbc: fbc || undefined
            },
            custom_data: {
              currency: currency,
              value: order_value_naira
            }
          }
        ]
      };
      try {
        const capiRes = await fetch(`${META_GRAPH_BASE}/${capiPixelId}/events?access_token=${capiAccessToken}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(capiPayload)
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
    let finalAdSetId = ad_set_id && ad_set_id.trim() !== '' ? ad_set_id : null;
    let finalCreativeId = creative_id && creative_id.trim() !== '' ? creative_id : null;
    if (finalCreativeId) {
      const { data: creativeRow } = await supabase.from('creatives').select('id').eq('id', finalCreativeId).maybeSingle();
      if (!creativeRow) finalCreativeId = null;
    }
    let finalAdAccountId = null;
    if (finalAdSetId) {
      const { data: adSetRow } = await supabase.from('ad_sets').select('ad_account_id').eq('id', finalAdSetId).maybeSingle();
      if (adSetRow) {
        finalAdAccountId = adSetRow.ad_account_id ?? null;
      } else {
        finalAdSetId = null;
      }
    }
    let mediaBuyerId = null;
    const buyerParam = payload.buyer || payload.buyer_code || payload.utm_buyer;
    if (buyerParam && companyId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(buyerParam.trim());
      const { data: buyerRow } = await supabase.from('media_buyers').select('id').eq(isUuid ? 'id' : 'code', isUuid ? buyerParam.trim() : buyerParam.trim().toUpperCase()).eq('company_id', companyId).maybeSingle();
      mediaBuyerId = buyerRow?.id ?? null;
    }
    if (!mediaBuyerId && siteRow?.media_buyer_id) mediaBuyerId = siteRow.media_buyer_id;
    // A booking: the service, its price and the time slot are all checked HERE against the product's own settings.
    let bookingInfo = null;
    if (payload.booking && typeof payload.booking === 'object') {
      const fail = (m, code = 400)=>new Response(JSON.stringify({ error: m }), { status: code, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const { data: bp } = finalProductId ? await supabase.from('products').select('id, company_id, product_name, currency, booking_settings, product_type, accept_online, is_active').eq('id', finalProductId).maybeSingle() : { data: null };
      if (!bp || bp.product_type !== 'booking' || !bp.booking_settings || bp.is_active === false) return fail("This is not a bookable service.");
      const cfg = bp.booking_settings;
      const svc = (Array.isArray(cfg.services) ? cfg.services : []).find((x)=>String(x.id) === String(payload.booking.service_id));
      if (!svc) return fail("Please choose a service.");
      const startsAt = new Date(String(payload.booking.starts_at ?? ''));
      if (isNaN(startsAt.getTime())) return fail("Please choose a date and time.");
      const dur = Math.max(10, Math.min(600, Math.round(Number(svc.duration_min) || 60))), endsAt = new Date(startsAt.getTime() + dur * 60000);
      const lead = Number(cfg.lead_hours ?? 2), adv = Number(cfg.advance_days ?? 30);
      if (startsAt.getTime() < Date.now() + lead * 3600000 - 60000) return fail("That time is too soon. Please pick a later time.");
      if (startsAt.getTime() > Date.now() + (adv + 1) * 86400000) return fail("That date is too far ahead.");
      const off = Number(cfg.utc_offset_min ?? 60), local = new Date(startsAt.getTime() + off * 60000);
      const mins = local.getUTCHours() * 60 + local.getUTCMinutes(), tm = (v, d)=>{ const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? d)); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
      const openM = tm(cfg.open, '09:00'), closeM = tm(cfg.close, '18:00'), step = Math.max(5, Number(cfg.step_min) || 30);
      const days = Array.isArray(cfg.days) ? cfg.days.map(Number) : [1, 2, 3, 4, 5, 6];
      if (!days.includes(local.getUTCDay()) || mins < openM || mins + dur > closeM || (mins - openM) % step !== 0) return fail("That time is not available. Please pick another.");
      bookingInfo = { product: bp, svc, startsAt, endsAt, dur, price: Number(svc.price) || 0, capacity: Math.max(1, Number(cfg.capacity) || 1), notes: String(payload.booking.notes ?? '').slice(0, 500) };
      order_value_naira = bookingInfo.price; quantity = 1;
      product_name = `${bp.product_name} - ${svc.name}`;
    }
    // Paying online: the price is worked out HERE from the product (never from the browser), and the product must allow online payment.
    const payOnline = String(payment_method ?? '') === 'Pay online';
    let onlineAmount = 0;
    if (payOnline) {
      const { data: pr } = finalProductId ? await supabase.from('products').select('id, company_id, product_name, default_order_value_naira, currency, accept_online').eq('id', finalProductId).maybeSingle() : { data: null };
      if (!pr || !pr.accept_online) return new Response(JSON.stringify({ error: "Online payment is not available for this product." }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      if (String(pr.currency || 'NGN').toUpperCase() !== 'NGN') return new Response(JSON.stringify({ error: "Online payment is only available for naira products for now." }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      let unit = Number(pr.default_order_value_naira || 0), qty = Math.max(1, parseInt(String(quantity)) || 1), total = unit * qty;
      if (tier_id) {
        const { data: tr } = await supabase.from('product_tiers').select('id, quantity, price_naira').eq('id', tier_id).eq('product_id', pr.id).eq('is_active', true).maybeSingle();
        if (tr) { total = Number(tr.price_naira); qty = Number(tr.quantity); }
      }
      if (cartLines) total = cartLines.reduce((t, l)=>t + l.line_total_naira, 0);
      if (bookingInfo) total = bookingInfo.price;
      if (!(total >= 100)) return new Response(JSON.stringify({ error: "This order has no payable amount." }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      order_value_naira = Math.round(total);
      onlineAmount = order_value_naira;
    }
    const { data: orderRow, error: dbError } = await supabase.from('orders').upsert({
      company_id: companyId,
      product_id: finalProductId,
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
      ...mediaBuyerId ? {
        media_buyer_id: mediaBuyerId
      } : {},
      ...siteRow ? {
        site_id: siteRow.id
      } : {},
      ...sitePageId ? {
        site_page_id: sitePageId
      } : {},
      ...form_data ? {
        form_data
      } : {},
      fbclid: payload.fbclid || null,
      meta_ad_id: payload.ad_id || payload.meta_ad_id || null,
      meta_adset_id: payload.mas ? String(payload.mas).slice(0, 40) : null,
      meta_campaign_id: payload.mcm ? String(payload.mcm).slice(0, 40) : null,
      placement: payload.mpl ? String(payload.mpl).slice(0, 40) : null,
      session_key: payload.session_key ? String(payload.session_key).slice(0, 64) : null,
      order_status: 'pending',
      ...(payOnline ? { payment_status: 'pending' } : {})
    }, {
      onConflict: 'event_id'
    }).select('id').single();
    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }
    if (bookingInfo && orderRow?.id) {
      const { error: bErr } = await supabase.rpc('rv_create_booking', { p_company: companyId, p_product: bookingInfo.product.id, p_order: orderRow.id, p_service: bookingInfo.svc.name, p_duration: bookingInfo.dur, p_price: bookingInfo.price,
        p_start: bookingInfo.startsAt.toISOString(), p_end: bookingInfo.endsAt.toISOString(), p_name: customer_name, p_phone: phone, p_email: email ?? null, p_notes: bookingInfo.notes, p_status: payOnline ? 'pending_payment' : 'confirmed', p_hold_minutes: 20, p_capacity: bookingInfo.capacity });
      if (bErr) {
        await supabase.from('orders').update({ order_status: 'cancelled', payment_status: null }).eq('id', orderRow.id);
        const taken = /slot_taken/.test(bErr.message);
        return new Response(JSON.stringify({ error: taken ? "That time was just taken. Please pick another time." : "Could not save your booking. Please try again." }), { status: taken ? 409 : 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      if (!payOnline) await supabase.rpc('rv_notify', { p_company: companyId, p_category: 'orders', p_kind: 'booking_new', p_title: '📅 New booking', p_body: `${customer_name} booked ${bookingInfo.svc.name} for ${new Date(bookingInfo.startsAt.getTime() + Number(bookingInfo.product.booking_settings.utc_offset_min ?? 60) * 60000).toISOString().replace('T', ' ').slice(0, 16)}.`, p_url: '/dashboard_new.html?open=tab:bookings', p_severity: 'success', p_dedupe: 'booking:' + orderRow.id });
    }
    // Tie this visit's journey to the order it ended in.
    if (payload.session_key && siteRow?.id && orderRow?.id) await supabase.from('site_sessions').update({ ordered: true, order_id: orderRow.id, last_seen_at: new Date().toISOString() }).eq('site_id', siteRow.id).eq('session_key', String(payload.session_key).slice(0, 64)).then(()=>{}, ()=>{});
    if (cartLines && orderRow?.id) {
      await supabase.from('order_items').delete().eq('order_id', orderRow.id);
      const { error: itemsError } = await supabase.from('order_items').insert(cartLines.map((l)=>({
          order_id: orderRow.id,
          company_id: companyId,
          product_id: l.product_id,
          product_name: l.product_name,
          quantity: l.quantity,
          unit_price_naira: l.unit_price_naira,
          line_total_naira: l.line_total_naira,
          tier_id: l.tier_id
        })));
      if (itemsError) console.error(`receive-order: failed to save order_items for ${orderRow.id}:`, itemsError.message);
    }
    if (orderRow?.id && !payOnline && !bookingInfo && (!siteRow || siteRow.settings?.confirmation_call === true)) {
      const callRequest = fetch(`${SUPABASE_URL}/functions/v1/place-order-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          order_id: orderRow.id
        })
      }).then((r)=>r.text()).then((t)=>console.log("place-order-call:", t)).catch((err)=>console.error("place-order-call failed:", err));
      const edgeRuntime = globalThis.EdgeRuntime;
      if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(callRequest);
      else await callRequest;
    }
    if (payOnline && orderRow?.id) {
      if (!PAYSTACK_SECRET_KEY) return new Response(JSON.stringify({ error: "Online payment is not set up yet." }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const digits = String(phone ?? '').replace(/\D/g, '');
      const payEmail = email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email)) ? String(email) : `${digits || orderRow.id.slice(0, 8)}@orders.revora.app`;
      const reference = `rvs_${orderRow.id.replace(/-/g, '').slice(0, 16)}_${Date.now().toString(36)}`;
      let callback = String(payload.return_url ?? '');
      if (!/^https:\/\/[^\s]+$/.test(callback)) callback = '';
      const r = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: payEmail, amount: onlineAmount * 100, currency: 'NGN', reference, ...(callback ? { callback_url: callback } : {}), metadata: { kind: 'order_sale', order_id: orderRow.id, company_id: companyId, custom_fields: [{ display_name: 'Order', variable_name: 'order', value: String(product_name ?? '').slice(0, 80) }] } }) });
      const d = await r.json().catch(()=>null);
      if (!r.ok || !d?.status || !d?.data?.authorization_url) {
        await supabase.from('orders').update({ payment_status: null, order_status: 'cancelled' }).eq('id', orderRow.id);
        return new Response(JSON.stringify({ error: "Could not start the payment. Please try again." }), { status: 502, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      await supabase.from('orders').update({ paystack_reference: reference }).eq('id', orderRow.id);
      return new Response(JSON.stringify({ success: true, event_id, order_id: orderRow.id, pay_url: d.data.authorization_url, order_value_naira }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    let payment = null;
    // The payment reference code is always returned (even without a media buyer), so a manual "Pay now" button can show it.
    let narrationCodeOut = null;
    if (orderRow?.id) {
      const narrationCode = `PAY${orderRow.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      narrationCodeOut = narrationCode;
      await supabase.from("orders").update({
        payment_narration_code: narrationCode
      }).eq("id", orderRow.id);
      if (mediaBuyerId) {
        try {
          const payRes = await fetch(`${SUPABASE_URL}/functions/v1/paystack-create-account`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({
              media_buyer_id: mediaBuyerId
            })
          });
          const payBody = await payRes.json();
          if (payRes.ok && !payBody.error) payment = {
            ...payBody,
            narration_code: narrationCode
          };
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
      narration_code: narrationCodeOut,
      order_value_naira,
      ...(bookingInfo ? { booking: { service: bookingInfo.svc.name, starts_at: bookingInfo.startsAt.toISOString() } } : {})
    }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response(JSON.stringify({
      error: err.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
});
