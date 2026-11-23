import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const SHARED = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const G = "https://graph.facebook.com/v22.0";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-cron-secret"
};
const json = (o, status = 200)=>new Response(JSON.stringify(o), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
async function g(path, token, method = "GET", body) {
  const url = `${G}${path}${method === "GET" ? (path.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(token) : ""}`;
  const r = await fetch(url, method === "GET" ? void 0 : {
    method,
    body: new URLSearchParams({
      ...body ?? {},
      access_token: token
    })
  });
  const j = await r.json().catch(()=>({}));
  if (j?.error) throw new Error(j.error.error_user_msg || j.error.message || "Meta refused the request");
  return j;
}
async function pageToken(pageId, token) {
  try {
    const r = await g(`/${pageId}?fields=access_token`, token);
    if (r?.access_token) return r.access_token;
  } catch  {}
  const a = await g(`/me/accounts?fields=id,access_token&limit=200`, token);
  const hit = (a?.data ?? []).find((p)=>String(p.id) === String(pageId));
  if (hit?.access_token) return hit.access_token;
  throw new Error("Revora's Meta login cannot act for this Page yet. Share the Page with Revora's Business in Meta (Page access), then try again.");
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: CORS
  });
  try {
    const b = await req.json().catch(()=>({}));
    const sec = (await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle()).data?.value ?? "";
    const given = req.headers.get("x-cron-secret") ?? "";
    let companyId = null, role = "", buyerId = null;
    const isPlatform = !!given && given === sec;
    if (!isPlatform) {
      const { data: u } = await db.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
      if (!u?.user) return json({
        error: "Not signed in"
      }, 401);
      const { data: me } = await db.from("profiles").select("company_id, role, media_buyer_id").eq("id", u.user.id).maybeSingle();
      buyerId = me?.media_buyer_id ?? null;
      if (!me?.company_id || ![
        "owner",
        "admin",
        "buyer"
      ].includes(me.role)) return json({
        error: "Only owners, admins and media buyers can do this."
      }, 403);
      companyId = me.company_id;
      role = me.role;
    }
    // Platform-only, read-only: how many comments a Page post (or an ad's post) has, and a small sample.
    if (isPlatform && String(b.action ?? "") === "comments_read") {
      const postId = String(b.post_id ?? "").replace(/[^0-9_]/g, "");
      const pid = postId.split("_")[0];
      if (!pid || !postId.includes("_")) return json({ error: "A post id like pageid_postid is needed." }, 400);
      try {
        const pt = await pageToken(pid, SHARED);
        const r = await g(`/${postId}/comments?summary=total_count&filter=toplevel&order=reverse_chronological&limit=${Math.min(Number(b.limit) || 5, 10)}&fields=id,message,created_time,comment_count,can_comment,can_hide`, pt);
        return json({ ok: true, post_id: postId, total: r?.summary?.total_count ?? null, sample: (r?.data ?? []).map((c)=>({ id: c.id, text: String(c.message ?? "").slice(0, 120), at: c.created_time, replies: c.comment_count ?? 0, can_reply: c.can_comment ?? null, can_hide: c.can_hide ?? null })) });
      } catch (e) { return json({ ok: false, error: e.message.slice(0, 300) }); }
    }
    // Platform-only: publish one normal (organic) photo post on the Facebook Page of an ad account, with the Page's own token.
    if (isPlatform && String(b.action ?? "") === "post_photo") {
      const { data: ac } = await db.from("ad_accounts").select("id, fb_page_id").eq("id", String(b.ad_account_id ?? "")).maybeSingle();
      const pid = String(ac?.fb_page_id ?? "").match(/\d+/)?.[0];
      const img = String(b.image_url ?? ""), msg = String(b.message ?? "").slice(0, 5000);
      if (!pid) return json({ error: "This ad account has no Page saved." }, 400);
      if (!/^https:\/\//.test(img) || !msg.trim()) return json({ error: "A public https image_url and a message are needed." }, 400);
      try {
        const pt = await pageToken(pid, SHARED);
        const r = await g(`/${pid}/photos`, pt, "POST", { url: img, caption: msg, published: "true" });
        const postId = String(r?.post_id ?? r?.id ?? "");
        let link = null;
        try { link = (await g(`/${postId}?fields=permalink_url,created_time`, pt))?.permalink_url ?? null; } catch (_) { /* the post exists even if the link cannot be read */ }
        return json({ ok: true, page_id: pid, post_id: postId, link: link && link.startsWith("/") ? "https://www.facebook.com" + link : link });
      } catch (e) { return json({ ok: false, error: e.message.slice(0, 300) }, 200); }
    }
    let q = db.from("ad_accounts").select("id, company_id, fb_page_id, ig_user_id, meta_connection_id, media_buyer_id").eq("id", String(b.ad_account_id ?? ""));
    if (companyId) q = q.eq("company_id", companyId);
    const { data: acct } = await q.maybeSingle();
    if (!acct) return json({
      error: "That ad account was not found or is not yours."
    }, 404);
    if (role === "buyer" && acct.media_buyer_id !== buyerId) return json({
      error: "That ad account was not found or is not yours."
    }, 404);
    const pageId = String(acct.fb_page_id ?? "").match(/\d+/)?.[0];
    if (!pageId) return json({
      error: "This ad account has no Facebook Page saved. Link the Page in Settings first."
    }, 400);
    let token = SHARED;
    if (acct.meta_connection_id) {
      const { data: conn } = await db.from("meta_connections").select("access_token, status").eq("id", acct.meta_connection_id).maybeSingle();
      if (conn?.status === "active" && conn.access_token) token = conn.access_token;
    }
    const action = String(b.action ?? "");
    if (action === "diag") {
      const out = {
        page_id: pageId,
        ig_saved: acct.ig_user_id ?? null
      };
      try {
        out.page = await g(`/${pageId}?fields=name,link,instagram_business_account{id,username},connected_instagram_account{id,username},can_post`, token);
      } catch (e) {
        out.page_error = e.message;
      }
      try {
        const pt = await pageToken(pageId, token);
        out.page_token = true;
        try {
          out.leadgen_tos = (await g(`/${pageId}?fields=leadgen_tos_accepted`, pt)).leadgen_tos_accepted ?? null;
        } catch (e) {
          out.leadgen_tos_error = e.message.slice(0, 160);
        }
      } catch (e) {
        out.page_token = false;
        out.page_token_error = e.message;
      }
      return json({
        ok: true,
        ...out
      });
    }
    if (action === "detect_ig") {
      const p = await g(`/${pageId}?fields=instagram_business_account{id,username},connected_instagram_account{id,username}`, token);
      let ig = p?.instagram_business_account ?? p?.connected_instagram_account ?? null;
      if (!ig) {
        const a = await g(`/act_${String(await acctMetaId(acct.id))}/instagram_accounts?fields=id,username&limit=10`, token).catch(()=>null);
        ig = a?.data?.[0] ?? null;
      }
      if (!ig?.id) return json({
        ok: false,
        error: "No Instagram account is linked to this Facebook Page yet. In Meta Business Suite, connect the Instagram profile to the Page, then try again."
      });
      await db.from("ad_accounts").update({
        ig_user_id: String(ig.id)
      }).eq("id", acct.id);
      return json({
        ok: true,
        ig_user_id: String(ig.id),
        username: ig.username ?? null
      });
    }
    if (action === "forms_list") {
      const pt = await pageToken(pageId, token);
      const r = await g(`/${pageId}/leadgen_forms?fields=id,name,status,leads_count,created_time&limit=50`, pt);
      return json({
        ok: true,
        forms: r?.data ?? []
      });
    }
    if (action === "forms_create") {
      const name = String(b.name ?? "").trim().slice(0, 100);
      if (!name) return json({
        error: "Give the form a name."
      }, 400);
      const pt = await pageToken(pageId, token);
      const existing = await g(`/${pageId}/leadgen_forms?fields=id,name,status&limit=100`, pt).catch(()=>({
          data: []
        }));
      const hit = (existing?.data ?? []).find((f)=>f.name === name && f.status === "ACTIVE");
      if (hit) return json({
        ok: true,
        form_id: hit.id,
        name,
        existed: true
      });
      const allowed = [
        "FULL_NAME",
        "EMAIL",
        "PHONE",
        "CITY",
        "STATE"
      ];
      const fields = (Array.isArray(b.fields) && b.fields.length ? b.fields : [
        "FULL_NAME",
        "PHONE",
        "CITY"
      ]).map((x)=>String(x).toUpperCase()).filter((x)=>allowed.includes(x));
      const privacy = /^https:\/\//.test(String(b.privacy_url ?? "")) ? String(b.privacy_url) : "https://revoracrm.online/privacy.html";
      const params = {
        name,
        questions: JSON.stringify(fields.map((type)=>({
            type
          }))),
        privacy_policy: JSON.stringify({
          url: privacy,
          link_text: "Privacy policy"
        }),
        follow_up_action_url: /^https:\/\//.test(String(b.thank_you_url ?? "")) ? String(b.thank_you_url) : `https://www.facebook.com/${pageId}`,
        locale: "EN_US"
      };
      if (b.intro) params.context_card = JSON.stringify({
        title: String(b.intro).slice(0, 60),
        style: "PARAGRAPH_STYLE",
        content: [
          String(b.intro_text ?? b.intro).slice(0, 500)
        ],
        button_text: "Continue"
      });
      const r = await g(`/${pageId}/leadgen_forms`, pt, "POST", params);
      return json({
        ok: true,
        form_id: r.id,
        name,
        existed: false
      });
    }
    if (action === "leads") {
      const formId = String(b.form_id ?? "").match(/\d+/)?.[0];
      if (!formId) return json({
        error: "form_id is required"
      }, 400);
      const pt = await pageToken(pageId, token);
      const r = await g(`/${formId}/leads?fields=id,created_time,field_data&limit=${Math.min(Math.max(Number(b.limit) || 25, 1), 100)}`, pt);
      const leads = (r?.data ?? []).map((l)=>({
          id: l.id,
          created: l.created_time,
          ...Object.fromEntries((l.field_data ?? []).map((f)=>[
              f.name,
              (f.values ?? [])[0] ?? ""
            ]))
        }));
      return json({
        ok: true,
        leads
      });
    }
    return json({
      error: "Unknown action"
    }, 400);
  } catch (e) {
    return json({
      error: e.message
    }, 500);
  }
});
async function acctMetaId(id) {
  const { data } = await db.from("ad_accounts").select("meta_ad_account_id").eq("id", id).maybeSingle();
  return String(data?.meta_ad_account_id ?? "").replace(/^act_/, "").match(/\d+/)?.[0] ?? "";
}
