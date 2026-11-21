import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// launch-wa: WhatsApp approval for ad launches that an AI assistant prepared through the Revora MCP.
//   event "prepare"  { approval_id }      called by a DB trigger when launch_plan creates a launch approval:
//                                         sends the campaign details, a "Review and edit" link BUTTON (ads.html), then Launch / Cancel buttons.
//   event "reply"    { payload, from }    called by handle-whatsapp-reply when a LAUNCH_OK / LAUNCH_NO button is tapped.
//   event "launched" { plan_id }          called by a DB trigger when a plan becomes launched: sends the result message.
// The button ids carry a one-time secret that is only ever inside the WhatsApp message, never in a tool result,
// so the AI assistant cannot approve for the person. The tap must also come from the requester's own WhatsApp number.
// The edit link opens a page that only changes the draft; it has no Launch button. Opening it extends the approval to 24 hours.
// Outside WhatsApp's 24h window the template launch_approval_v2 (link button + Launch + Cancel) is used, falling back to launch_approval_v1 (Launch + Cancel) while v2 is not approved.
// Kill switch: app_secrets.launch_whatsapp = 'off'.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? SERVICE_KEY;
const WA_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const WA_PHONE = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const TEMPLATE = Deno.env.get("WHATSAPP_TPL_LAUNCH_APPROVAL") ?? "launch_approval_v1";
const TEMPLATE_V2 = Deno.env.get("WHATSAPP_TPL_LAUNCH_APPROVAL_V2") ?? "launch_approval_v2";
const SITE = "https://dash.revoracrm.online";
const LINK_HOURS = 24;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const UUID = /^[0-9a-f-]{36}$/i;
const jres = (obj, status = 200)=>new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
const safeEq = (a, b)=>{
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for(let i = 0; i < a.length; i++)d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const hexRand = (n)=>Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b)=>b.toString(16).padStart(2, "0")).join("");
const sha256hex = async (t)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b)=>b.toString(16).padStart(2, "0")).join("");
const naira = (n)=>"₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");
const lagos = (iso)=>iso ? new Date(iso).toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  }) + " (Nigeria time)" : null;
const digits = (s)=>String(s ?? "").replace(/\D/g, "");
const waNumber = (raw)=>{
  const d = digits(raw);
  if (!d) return "";
  return d.startsWith("0") ? "234" + d.slice(1) : d;
};
const sameNumber = (a, b)=>{
  const x = waNumber(a), y = waNumber(b);
  return !!x && !!y && x === y;
};
async function authorized(req) {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (SERVICE_KEY && safeEq(bearer, SERVICE_KEY)) return true;
  const cron = req.headers.get("x-cron-secret") ?? "";
  if (!cron) return false;
  const { data } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
  return !!data?.value && safeEq(cron, data.value);
}
async function enabled() {
  const { data } = await admin.from("app_secrets").select("value").eq("key", "launch_whatsapp").maybeSingle();
  return String(data?.value ?? "on").toLowerCase() !== "off";
}
async function userNumber(userId) {
  const { data } = await admin.from("profiles").select("whatsapp_number").eq("id", userId).maybeSingle();
  return data?.whatsapp_number ?? null;
}
async function waSend(to, body) {
  const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      ...body
    })
  });
  const j = await r.json().catch(()=>null);
  if (!r.ok) throw new Error(j?.error?.message ?? `WhatsApp answered ${r.status}`);
  return j;
}
const waText = (to, text)=>waSend(to, {
    type: "text",
    text: {
      body: text.slice(0, 4000),
      preview_url: true
    }
  });
// A single tappable link button (WhatsApp allows one link button per message; it cannot share a message with reply buttons).
const waLinkButton = (to, text, label, url)=>waSend(to, {
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: {
        text: text.slice(0, 1000)
      },
      action: {
        name: "cta_url",
        parameters: {
          display_text: label.slice(0, 20),
          url
        }
      }
    }
  });
async function describe(planId) {
  const { data: row } = await admin.from("ai_plans").select("plan").eq("id", planId).maybeSingle();
  const plan = row?.plan ?? {};
  const sets = Array.isArray(plan.adsets) ? plan.adsets : [];
  const copies = Array.isArray(plan.copies) ? plan.copies : [];
  const master = Array.isArray(plan.ads) && plan.ads.length ? plan.ads.map((p)=>({
      asset_id: String(p?.asset_id ?? ""),
      copy_index: Math.round(Number(p?.copy_index) || 0)
    })) : (Array.isArray(plan.asset_ids) ? plan.asset_ids : []).map((id, j)=>({
      asset_id: String(id),
      copy_index: copies.length ? j % copies.length : 0
    }));
  const nums = sets.map((s)=>Array.isArray(s?.ad_numbers) && s.ad_numbers.length ? s.ad_numbers.map(Number) : master.map((_, k)=>k + 1));
  const ids = [
    ...new Set(master.map((m)=>m.asset_id))
  ].filter((x)=>UUID.test(x));
  const { data: files } = ids.length ? await admin.from("creative_assets").select("id, file_name, public_url, asset_type").in("id", ids) : {
    data: []
  };
  const fileOf = new Map((files ?? []).map((f)=>[
      f.id,
      f
    ]));
  const { data: opt } = await admin.from("ai_plan_options").select("start_time, end_time").eq("plan_id", planId).maybeSingle();
  const campaign = String(plan.campaign_name ?? "Campaign");
  const budgetN = sets.reduce((n, s)=>n + (Number(s?.budget_naira) || 0), 0) || Number(plan.daily_budget) || 0;
  const totalAds = nums.reduce((n, x)=>n + x.length, 0) || master.length;
  const paused = plan.launch_paused === true;
  const startText = lagos(opt?.start_time) ?? "Right away";
  const endText = lagos(opt?.end_time);
  const perSet = sets.map((s, i)=>`• ${s?.label ?? "Ad set " + (i + 1)}: ${nums[i]?.length ?? 0} ad${(nums[i]?.length ?? 0) === 1 ? "" : "s"}${s?.budget_naira ? " (" + naira(s.budget_naira) + "/day)" : ""}`);
  const adBlocks = master.slice(0, 6).map((m, k)=>{
    const f = fileOf.get(m.asset_id);
    const cp = copies[m.copy_index];
    return [
      `*Ad ${k + 1}*`,
      f?.public_url ? `${f.asset_type === "video" ? "Video" : "Image"}: ${f.public_url}` : null,
      cp?.headline ? `Headline: ${cp.headline}` : null,
      cp?.primary_text ? `Text: ${String(cp.primary_text).slice(0, 300)}` : null
    ].filter(Boolean).join("\n");
  });
  const details = [
    `🚀 *Launch request: ${campaign}*`,
    plan.product_name ? `Product: ${plan.product_name}` : null,
    plan.objective ? `Objective: ${plan.objective}` : null,
    `Budget: ${budgetN ? naira(budgetN) + "/day" : "not set"} (${String(plan.budget_type ?? "abo").toUpperCase()})`,
    `Ad sets: ${sets.length} · Ads: ${totalAds}`,
    ...perSet,
    `Starts: ${startText}${endText ? " · Ends: " + endText : ""}`,
    `Status: ${paused ? "starts paused" : "goes live as soon as you approve"}`,
    "",
    ...adBlocks,
    master.length > 6 ? `…and ${master.length - 6} more ad(s)` : null
  ].filter((x)=>x !== null).join("\n");
  const question = `Launch *${campaign}*? ${budgetN ? naira(budgetN) + "/day, " : ""}${totalAds} ad${totalAds === 1 ? "" : "s"}, ${paused ? "starts paused" : "goes live on approval"}. Only you can approve: your AI assistant cannot tap these buttons.`;
  return {
    campaign,
    budget: budgetN ? naira(budgetN) + "/day" : "not set",
    adsText: `${totalAds} ad${totalAds === 1 ? "" : "s"} in ${sets.length} ad set${sets.length === 1 ? "" : "s"}`,
    startText,
    details,
    question,
    totalAds,
    paused
  };
}
async function prepare(id) {
  if (!UUID.test(id)) return {
    ok: false,
    reason: "bad id"
  };
  if (!WA_TOKEN || !WA_PHONE) return {
    ok: false,
    reason: "whatsapp not configured"
  };
  if (!await enabled()) return {
    ok: false,
    reason: "disabled"
  };
  const { data: ap } = await admin.from("launch_approvals").select("*").eq("id", id).maybeSingle();
  if (!ap || ap.used_at || Date.parse(ap.expires_at) < Date.now()) return {
    ok: false,
    reason: "approval not open"
  };
  const to = waNumber(await userNumber(ap.user_id));
  if (!to) {
    await admin.from("launch_approvals").update({
      wa_status: "no_number"
    }).eq("id", id);
    return {
      ok: false,
      reason: "no whatsapp number on this profile"
    };
  }
  const d = await describe(ap.plan_id);
  const secret = hexRand(8);
  await admin.from("launch_approvals").update({
    wa_secret_hash: await sha256hex(secret),
    wa_status: "sending"
  }).eq("id", id);
  const okId = `LAUNCH_OK:${id}:${secret}`, noId = `LAUNCH_NO:${id}:${secret}`;
  // A private link to review and edit the whole draft. It only changes the draft; launching stays on the buttons below.
  let linkTok = "", link = "";
  try {
    const tok = hexRand(16);
    const exp = new Date(Date.now() + LINK_HOURS * 3600 * 1000).toISOString();
    const { error: le } = await admin.from("plan_edit_links").insert({
      secret_hash: await sha256hex(tok),
      company_id: ap.company_id,
      user_id: ap.user_id,
      plan_id: ap.plan_id,
      expires_at: exp
    });
    if (!le) {
      linkTok = tok;
      link = `${SITE}/ads.html?t=${tok}`;
      // Editing takes longer than the usual approval time, so the approval lasts as long as the link.
      await admin.from("launch_approvals").update({
        expires_at: exp
      }).eq("id", id);
    }
  } catch  {
    linkTok = "";
    link = "";
  }
  let status = "";
  try {
    await waText(to, d.details);
    if (link) {
      // The link comes as a tappable button. If WhatsApp refuses the button message, send the plain link instead.
      try {
        await waLinkButton(to, "✏️ Want to change anything first? Open every ad and ad set: copy, headlines, pictures, budget and audience.", "Review and edit", link);
      } catch  {
        await waText(to, `✏️ Review and edit every ad and ad set (copy, headlines, pictures, budget, audience):\n${link}`).catch(()=>{});
      }
    }
    await waSend(to, {
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: d.question.slice(0, 1000)
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: okId,
                title: "✅ Launch"
              }
            },
            {
              type: "reply",
              reply: {
                id: noId,
                title: "❌ Cancel"
              }
            }
          ]
        }
      }
    });
    status = "sent";
  } catch (e1) {
    // Free-form messages only deliver inside WhatsApp's 24h window. Outside it, an approved template is needed:
    // v2 has a link button plus Launch and Cancel; v1 has Launch and Cancel only (used while v2 is not approved).
    const bodyP = {
      type: "body",
      parameters: [
        d.campaign,
        d.budget,
        d.adsText,
        d.startText
      ].map((t)=>({
          type: "text",
          text: String(t).slice(0, 60) || "-"
        }))
    };
    let sent = false;
    if (linkTok) {
      try {
        await waSend(to, {
          type: "template",
          template: {
            name: TEMPLATE_V2,
            language: {
              code: "en"
            },
            components: [
              bodyP,
              {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [
                  {
                    type: "text",
                    text: linkTok
                  }
                ]
              },
              {
                type: "button",
                sub_type: "quick_reply",
                index: "1",
                parameters: [
                  {
                    type: "payload",
                    payload: okId
                  }
                ]
              },
              {
                type: "button",
                sub_type: "quick_reply",
                index: "2",
                parameters: [
                  {
                    type: "payload",
                    payload: noId
                  }
                ]
              }
            ]
          }
        });
        status = "template_sent";
        sent = true;
      } catch  {}
    }
    if (!sent) {
      try {
        await waSend(to, {
          type: "template",
          template: {
            name: TEMPLATE,
            language: {
              code: "en"
            },
            components: [
              bodyP,
              {
                type: "button",
                sub_type: "quick_reply",
                index: "0",
                parameters: [
                  {
                    type: "payload",
                    payload: okId
                  }
                ]
              },
              {
                type: "button",
                sub_type: "quick_reply",
                index: "1",
                parameters: [
                  {
                    type: "payload",
                    payload: noId
                  }
                ]
              }
            ]
          }
        });
        status = "template_sent";
      } catch (_e2) {
        status = ("failed: " + e1.message).slice(0, 200);
      }
    }
  }
  await admin.from("launch_approvals").update({
    wa_status: status
  }).eq("id", id);
  return {
    ok: status === "sent" || status === "template_sent",
    status
  };
}
async function reply(payload, from) {
  const m = payload.match(/^LAUNCH_(OK|NO):([0-9a-f-]{36}):([0-9a-f]{16})$/i);
  if (!m) return {
    ignored: true
  };
  const act = m[1].toUpperCase(), id = m[2], secret = m[3].toLowerCase();
  const { data: ap } = await admin.from("launch_approvals").select("*").eq("id", id).maybeSingle();
  if (!ap || !ap.wa_secret_hash || !safeEq(await sha256hex(secret), ap.wa_secret_hash)) {
    console.warn("launch-wa: button with a wrong or used secret ignored");
    return {
      ignored: true
    };
  }
  if (!sameNumber(from, await userNumber(ap.user_id))) {
    console.warn("launch-wa: tap from a number that is not the requester ignored");
    return {
      ignored: true
    };
  }
  const to = waNumber(from);
  if (ap.used_at) {
    await waText(to, "This launch was already handled.").catch(()=>{});
    return {
      ok: true,
      already: true
    };
  }
  if (Date.parse(ap.expires_at) < Date.now()) {
    await waText(to, "⌛ This approval expired. Ask your assistant to prepare the launch again.").catch(()=>{});
    return {
      ok: true,
      expired: true
    };
  }
  const { data: pl } = await admin.from("ai_plans").select("status, plan").eq("id", ap.plan_id).maybeSingle();
  const name = String(pl?.plan?.campaign_name ?? "your campaign");
  if (act === "NO") {
    await admin.from("launch_approvals").update({
      used_at: new Date().toISOString(),
      wa_status: "cancelled",
      wa_secret_hash: null
    }).eq("id", id).is("used_at", null);
    await waText(to, `❌ Cancelled. ${name} was not launched. The draft is still saved if you want to change it.`).catch(()=>{});
    return {
      ok: true,
      cancelled: true
    };
  }
  if (pl?.status === "launched") {
    await waText(to, `${name} is already launched.`).catch(()=>{});
    return {
      ok: true,
      already: true
    };
  }
  if (pl?.status !== "draft") {
    await waText(to, `This plan is ${pl?.status ?? "missing"} and cannot be launched.`).catch(()=>{});
    return {
      ok: true
    };
  }
  const { data: opt } = await admin.from("ai_plan_options").select("start_time").eq("plan_id", ap.plan_id).maybeSingle();
  if (opt?.start_time && Date.parse(opt.start_time) < Date.now() + 60_000) {
    await waText(to, "The scheduled start time has passed. Ask your assistant to set a new start time, then launch again.").catch(()=>{});
    return {
      ok: true
    };
  }
  // Take the approval once, so a double tap cannot launch twice.
  const { data: took } = await admin.from("launch_approvals").update({
    used_at: new Date().toISOString(),
    wa_status: "launching_via_wa"
  }).eq("id", id).is("used_at", null).select("id");
  if (!took?.length) return {
    ok: true,
    already: true
  };
  const fail = async (why)=>{
    await admin.from("launch_approvals").update({
      used_at: null,
      wa_status: "sent"
    }).eq("id", id);
    await waText(to, `⚠️ ${why} Tap Launch again, or use the Launch card in your assistant.`).catch(()=>{});
    return {
      ok: false,
      error: why
    };
  };
  try {
    // Act as the person: a short-lived sign-in made on the server (no email is sent).
    const { data: u } = await admin.auth.admin.getUserById(ap.user_id);
    const { data: lk } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: u?.user?.email ?? ""
    });
    const th = lk?.properties?.hashed_token;
    const vr = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "magiclink",
        token_hash: th
      })
    });
    const vj = await vr.json().catch(()=>null);
    if (!vj?.access_token) return await fail("Could not sign in to start the launch.");
    const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vj.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "approve_plan",
        plan_id: ap.plan_id
      })
    });
    const j = await r.json().catch(()=>({
        error: `Unexpected reply (${r.status})`
      }));
    await admin.from("mcp_audit").insert({
      company_id: ap.company_id,
      user_id: ap.user_id,
      tool: "launch_plan",
      args: {
        plan_id: ap.plan_id,
        via: "whatsapp"
      },
      ok: !j?.error,
      client: "launch-whatsapp"
    }).then(()=>{}, ()=>{});
    if (j?.error) return await fail(`Launch failed: ${String(j.error).slice(0, 200)}.`);
    await admin.from("launch_approvals").update({
      wa_status: "launched_via_wa",
      wa_secret_hash: null
    }).eq("id", id);
    const d = await describe(ap.plan_id);
    await waText(to, `✅ Launched: ${d.campaign}\n${d.budget} · ${d.adsText}\n${d.paused ? "Created paused. Turn it on in Ads Manager or Revora." : "It is going live now. Check it in Ads Manager."}`).catch(()=>{});
    return {
      ok: true,
      launched: true
    };
  } catch (e) {
    return await fail("Could not start the launch.");
  }
}
async function launched(planId) {
  if (!UUID.test(planId) || !WA_TOKEN || !WA_PHONE || !await enabled()) return {
    skipped: true
  };
  const { data: aps } = await admin.from("launch_approvals").select("id, user_id, used_at, wa_status").eq("plan_id", planId).order("created_at", {
    ascending: false
  }).limit(1);
  const ap = aps?.[0];
  // Only plans an assistant launched through a card tap get this message; the WhatsApp path sends its own, dashboard launches send none.
  if (!ap || !ap.used_at || String(ap.wa_status ?? "").startsWith("launch")) return {
    skipped: true
  };
  const to = waNumber(await userNumber(ap.user_id));
  if (!to) return {
    skipped: true
  };
  await admin.from("launch_approvals").update({
    wa_status: "launched_notified"
  }).eq("id", ap.id);
  const d = await describe(planId);
  await waText(to, `✅ Launched: ${d.campaign}\n${d.budget} · ${d.adsText}\n${d.paused ? "Created paused. Turn it on in Ads Manager or Revora." : "It is going live now. Check it in Ads Manager."}`).catch(()=>{});
  return {
    ok: true
  };
}
Deno.serve(async (req)=>{
  if (req.method !== "POST") return jres({
    error: "POST only"
  }, 405);
  if (!await authorized(req)) return jres({
    error: "unauthorized"
  }, 401);
  let b = {};
  try {
    b = await req.json();
  } catch  {
    return jres({
      error: "bad_request"
    }, 400);
  }
  try {
    if (b?.event === "prepare") return jres(await prepare(String(b.approval_id ?? "")));
    if (b?.event === "reply") return jres(await reply(String(b.payload ?? ""), String(b.from ?? "")));
    if (b?.event === "launched") return jres(await launched(String(b.plan_id ?? "")));
    return jres({
      error: "unknown_event"
    }, 400);
  } catch (e) {
    console.error("launch-wa error:", e.message);
    return jres({
      error: e.message
    }, 500);
  }
});
