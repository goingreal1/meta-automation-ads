import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Lets a buyer manage their own WhatsApp number(s) from the dashboard's Settings tab.
//   list_wabas / list_numbers / add_number / request_code / save_number / verify_code / remove  (use the buyer's Facebook login)
//   es_config   -> { app_id, config_id } for Facebook's WhatsApp Embedded Signup pop-up
//   es_complete -> finish a pop-up sign-up: code -> business token, register number, subscribe webhooks, save
// access_token is always the caller's own Supabase session token (proves who is signed in).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
// The "Facebook Login for Business" configuration made for WhatsApp Embedded Signup (public, not a secret).
const ES_CONFIG_ID = Deno.env.get("WHATSAPP_ES_CONFIG_ID") ?? "959056356702707";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
async function graph(path, token, method = "GET", body) {
  const url = new URL(`${META_GRAPH_BASE}/${path}`);
  if (method === "GET") {
    url.searchParams.set("access_token", token);
    const res = await fetch(url.toString());
    return {
      ok: res.ok,
      data: await res.json()
    };
  }
  const params = new URLSearchParams({
    ...body ?? {},
    access_token: token
  });
  const res = await fetch(url.toString(), {
    method: "POST",
    body: params
  });
  return {
    ok: res.ok,
    data: await res.json()
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  }
  try {
    const body = await req.json().catch(()=>({}));
    const { action, media_buyer_id: mediaBuyerId, access_token: sessionToken } = body;
    if (!action || !mediaBuyerId || !sessionToken) return json({
      error: "action, media_buyer_id and access_token are required"
    }, 400);
    const { data: userData, error: authErr } = await supabase.auth.getUser(sessionToken);
    if (authErr || !userData?.user) return json({
      error: "Your session has expired -- refresh and try again."
    }, 401);
    const { data: profile } = await supabase.from("profiles").select("role, company_id, media_buyer_id").eq("id", userData.user.id).maybeSingle();
    if (!profile) return json({
      error: "No profile found for this login."
    }, 403);
    const isAdmin = profile.role === "owner" || profile.role === "admin";
    if (!isAdmin && profile.media_buyer_id !== mediaBuyerId) return json({
      error: "You can only manage your own WhatsApp numbers."
    }, 403);
    const { data: buyer } = await supabase.from("media_buyers").select("id, company_id").eq("id", mediaBuyerId).maybeSingle();
    if (!buyer) return json({
      error: "Unknown media buyer."
    }, 404);
    if (action === "es_config") {
      if (!META_APP_ID) return json({
        error: "Meta app isn't configured on the server (META_APP_ID missing)."
      }, 500);
      return json({
        app_id: META_APP_ID,
        config_id: ES_CONFIG_ID
      });
    }
    if (action === "es_complete") {
      const { code, waba_id: wabaId, phone_number_id: phoneNumberId } = body;
      if (!code || !wabaId || !phoneNumberId) return json({
        error: "code, waba_id and phone_number_id are required."
      }, 400);
      if (!/^\d+$/.test(String(wabaId)) || !/^\d+$/.test(String(phoneNumberId))) return json({
        error: "Invalid WhatsApp account details."
      }, 400);
      if (buyer.company_id !== profile.company_id) return json({
        error: "Unknown media buyer."
      }, 404);
      if (!META_APP_ID || !META_APP_SECRET) return json({
        error: "Meta app isn't configured on the server."
      }, 500);
      const tokRes = await fetch(`${META_GRAPH_BASE}/oauth/access_token?` + new URLSearchParams({
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        code: String(code)
      }));
      const tok = await tokRes.json();
      if (!tokRes.ok || !tok.access_token) return json({
        error: tok?.error?.message || "Meta did not accept the sign-up code. Try again."
      }, 400);
      const esToken = tok.access_token;
      const num = await graph(`${phoneNumberId}?fields=display_phone_number,verified_name`, esToken);
      if (!num.ok) return json({
        error: num.data?.error?.message || "Could not read the number you connected."
      }, 400);
      const sub = await graph(`${wabaId}/subscribed_apps`, esToken, "POST");
      if (!sub.ok) console.error("subscribed_apps failed:", JSON.stringify(sub.data));
      const pin = String(100000 + Math.floor(Math.random() * 900000));
      const reg = await graph(`${phoneNumberId}/register`, esToken, "POST", {
        messaging_product: "whatsapp",
        pin
      });
      if (!reg.ok) console.error("register failed:", JSON.stringify(reg.data));
      const { data: row, error } = await supabase.from("buyer_whatsapp_numbers").upsert({
        company_id: buyer.company_id,
        media_buyer_id: mediaBuyerId,
        waba_id: String(wabaId),
        phone_number_id: String(phoneNumberId),
        display_phone_number: num.data?.display_phone_number ?? null,
        nickname: num.data?.verified_name ?? null,
        access_token: esToken,
        verified_at: new Date().toISOString(),
        status: "active"
      }, {
        onConflict: "phone_number_id"
      }).select("id").single();
      if (error) return json({
        error: `Could not save it: ${error.message}`
      }, 500);
      return json({
        saved: true,
        id: row.id,
        number: num.data?.display_phone_number ?? null,
        webhook_subscribed: sub.ok,
        registered: reg.ok,
        register_note: reg.ok ? null : reg.data?.error?.message || "register failed"
      });
    }
    const { data: conn } = await supabase.from("meta_connections").select("access_token").eq("media_buyer_id", mediaBuyerId).eq("status", "active").order("connected_at", {
      ascending: false
    }).limit(1).maybeSingle();
    if (!conn?.access_token) return json({
      error: "Connect Meta first (Settings -> Connect with Facebook) before adding a WhatsApp number."
    }, 400);
    const metaToken = conn.access_token;
    if (action === "list_wabas") {
      const { ok, data } = await graph(`me?fields=businesses{id,name,owned_whatsapp_business_accounts{id,name}}`, metaToken);
      if (!ok) return json({
        error: data.error?.message || "Could not list your Businesses."
      }, 400);
      const wabas = [];
      for (const b of data.businesses?.data ?? []){
        for (const w of b.owned_whatsapp_business_accounts?.data ?? []){
          wabas.push({
            id: w.id,
            name: w.name,
            business_name: b.name
          });
        }
      }
      return json({
        wabas
      });
    }
    if (action === "list_numbers") {
      const wabaId = body.waba_id;
      if (!wabaId) return json({
        error: "waba_id is required"
      }, 400);
      const { ok, data } = await graph(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status`, metaToken);
      if (!ok) return json({
        error: data.error?.message || "Could not list numbers on that WhatsApp Business Account."
      }, 400);
      return json({
        numbers: data.data ?? []
      });
    }
    if (action === "add_number") {
      const wabaId = body.waba_id;
      const cc = body.cc;
      const phoneNumber = body.phone_number;
      const verifiedName = body.verified_name || buyer.id;
      if (!wabaId || !cc || !phoneNumber) return json({
        error: "waba_id, cc and phone_number are required"
      }, 400);
      const { ok, data } = await graph(`${wabaId}/phone_numbers`, metaToken, "POST", {
        cc,
        phone_number: phoneNumber,
        verified_name: verifiedName
      });
      if (!ok) return json({
        error: data.error?.message || "Could not add that number."
      }, 400);
      return json({
        phone_number_id: data.id
      });
    }
    if (action === "request_code") {
      const phoneNumberId = body.phone_number_id;
      const codeMethod = body.code_method || "SMS";
      if (!phoneNumberId) return json({
        error: "phone_number_id is required"
      }, 400);
      const { ok, data } = await graph(`${phoneNumberId}/request_code`, metaToken, "POST", {
        code_method: codeMethod,
        language: "en_US"
      });
      if (!ok) return json({
        error: data.error?.message || "Could not send a verification code to that number."
      }, 400);
      return json({
        sent: true
      });
    }
    if (action === "save_number") {
      const phoneNumberId = body.phone_number_id;
      const wabaId = body.waba_id;
      const nickname = body.nickname || null;
      if (!phoneNumberId || !wabaId) return json({
        error: "phone_number_id and waba_id are required"
      }, 400);
      const { data: numInfo } = await graph(`${phoneNumberId}?fields=display_phone_number,verified_name`, metaToken);
      const { data: row, error } = await supabase.from("buyer_whatsapp_numbers").upsert({
        company_id: buyer.company_id,
        media_buyer_id: mediaBuyerId,
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        display_phone_number: numInfo?.display_phone_number ?? null,
        nickname: nickname || numInfo?.verified_name || null,
        access_token: metaToken,
        verified_at: new Date().toISOString(),
        status: "active"
      }, {
        onConflict: "phone_number_id"
      }).select("id").single();
      if (error) return json({
        error: `Could not save it: ${error.message}`
      }, 500);
      return json({
        saved: true,
        id: row.id
      });
    }
    if (action === "verify_code") {
      const phoneNumberId = body.phone_number_id;
      const code = body.code;
      const wabaId = body.waba_id;
      const nickname = body.nickname || null;
      if (!phoneNumberId || !code || !wabaId) return json({
        error: "phone_number_id, waba_id and code are required"
      }, 400);
      const { ok, data } = await graph(`${phoneNumberId}/verify_code`, metaToken, "POST", {
        code
      });
      if (!ok || data.success !== true) return json({
        error: data.error?.message || "That code didn't verify -- double check it and try again."
      }, 400);
      const { data: numInfo } = await graph(`${phoneNumberId}?fields=display_phone_number,verified_name`, metaToken);
      const { data: row, error } = await supabase.from("buyer_whatsapp_numbers").upsert({
        company_id: buyer.company_id,
        media_buyer_id: mediaBuyerId,
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        display_phone_number: numInfo?.display_phone_number ?? null,
        nickname: nickname || numInfo?.verified_name || null,
        access_token: metaToken,
        verified_at: new Date().toISOString(),
        status: "active"
      }, {
        onConflict: "phone_number_id"
      }).select("id").single();
      if (error) return json({
        error: `Verified, but could not save it: ${error.message}`
      }, 500);
      return json({
        saved: true,
        id: row.id
      });
    }
    if (action === "remove") {
      const id = body.id;
      if (!id) return json({
        error: "id is required"
      }, 400);
      const { error } = await supabase.from("buyer_whatsapp_numbers").update({
        status: "disconnected"
      }).eq("id", id).eq("media_buyer_id", mediaBuyerId);
      if (error) return json({
        error: error.message
      }, 500);
      return json({
        removed: true
      });
    }
    return json({
      error: `Unknown action: ${action}`
    }, 400);
  } catch (err) {
    console.error("manage-whatsapp-numbers error:", err);
    return json({
      error: err.message
    }, 500);
  }
});
