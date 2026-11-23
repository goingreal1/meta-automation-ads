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
    let companyId = null, role = "", buyerId = null, userId = "";
    const isPlatform = !!given && given === sec;
    if (!isPlatform) {
      const { data: u } = await db.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
      if (!u?.user) return json({
        error: "Not signed in"
      }, 401);
      userId = u.user.id;
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
    // Platform-only, read-only: scan many posts of one Page for recent comments (counts, plus the newest few).
    if (isPlatform && String(b.action ?? "") === "comments_scan") {
      const ids = (Array.isArray(b.post_ids) ? b.post_ids : []).map((x)=>String(x).replace(/[^0-9_]/g, "")).filter((x)=>x.includes("_")).slice(0, 320);
      const pid = String(b.page_id ?? "").match(/\d+/)?.[0];
      if (!pid || !ids.length) return json({ error: "page_id and post_ids are needed." }, 400);
      const since = Date.now() - (Number(b.days) || 30) * 86400000;
      let pt;
      try { pt = await pageToken(pid, SHARED); } catch (e) { return json({ ok: false, error: e.message.slice(0, 200) }); }
      const out = { scanned: 0, errors: 0, posts_with_recent: 0, recent_total: 0, all_time_total: 0, newest: [] as any[], first_error: "" };
      let k = 0;
      const worker = async ()=>{
        while (k < ids.length) {
          const id = ids[k++];
          try {
            const r = await g(`/${id}/comments?summary=total_count&filter=toplevel&order=reverse_chronological&limit=25&fields=id,message,created_time,comment_count`, pt);
            out.scanned++;
            out.all_time_total += Number(r?.summary?.total_count ?? 0);
            const recent = (r?.data ?? []).filter((c)=>Date.parse(c.created_time) >= since);
            if (recent.length) out.posts_with_recent++;
            out.recent_total += recent.length;
            for (const c of recent) out.newest.push({ post_id: id, at: c.created_time, text: String(c.message ?? "").slice(0, 100), replies: c.comment_count ?? 0 });
          } catch (e) { out.errors++; if (!out.first_error) out.first_error = e.message.slice(0, 160); }
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      out.newest.sort((a, b)=>String(b.at).localeCompare(String(a.at)));
      out.newest = out.newest.slice(0, 15);
      return json({ ok: true, page_id: pid, days: Number(b.days) || 30, ...out });
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
    // ======== COMMENTS INBOX ========
    const digits = (v)=>String(v ?? "").match(/\d+/)?.[0] ?? "";
    const tokenOf = async (acct)=>{
      if (acct?.meta_connection_id) { const { data: conn } = await db.from("meta_connections").select("access_token, status").eq("id", acct.meta_connection_id).maybeSingle(); if (conn?.status === "active" && conn.access_token) return conn.access_token; }
      return SHARED;
    };
    // Platform (cron): read new comments on each Page's own posts and on its ad posts, and keep them in page_comments.
    if (isPlatform && String(b.action ?? "") === "comments_sync") {
      const { data: accts } = await db.from("ad_accounts").select("id, company_id, fb_page_id, meta_connection_id, status").eq("status", "active").not("fb_page_id", "is", null);
      const pages = new Map<string, any>();
      for (const a of accts ?? []) { const pid = digits(a.fb_page_id); if (pid && (!b.company_id || a.company_id === b.company_id) && !pages.has(a.company_id + ":" + pid)) pages.set(a.company_id + ":" + pid, { company_id: a.company_id, pid, acct: a }); }
      const report: any[] = [];
      for (const { company_id, pid, acct } of pages.values()) {
        const rep: any = { page: pid, scanned: 0, new_comments: 0, errors: 0 };
        try {
          const pt = await pageToken(pid, await tokenOf(acct));
          const { data: ads } = await db.from("learn_objects").select("meta_id, name, creative").eq("company_id", company_id).eq("level", "ad").filter("creative->>post_id", "like", `${pid}\\_%`).limit(2000);
          const byPost = new Map<string, { ad_id: string; ad_name: string }>();
          for (const x of ads ?? []) byPost.set(String(x.creative?.post_id), { ad_id: x.meta_id, ad_name: String(x.name ?? "").slice(0, 120) });
          const adIds = [...byPost.values()].map((v)=>v.ad_id);
          const { data: act } = adIds.length ? await db.from("learn_insights").select("object_id").in("object_id", adIds.slice(0, 1000)).eq("level", "ad").eq("breakdown", "total").eq("win", "30d").gt("spend", 0) : { data: [] };
          const active = new Set((act ?? []).map((r: any)=>r.object_id));
          let recent: string[] = [];
          try { recent = ((await g(`/${pid}/posts?fields=id&limit=15`, pt))?.data ?? []).map((p: any)=>String(p.id)); } catch (_) { /* a Page without posts access still has ad posts */ }
          const all = [...new Set([...recent, ...[...byPost.keys()]])];
          const { data: seen } = all.length ? await db.from("page_post_scan").select("post_id, last_scanned_at").in("post_id", all.slice(0, 1500)) : { data: [] };
          const seenAt = new Map((seen ?? []).map((r: any)=>[r.post_id, r.last_scanned_at ? Date.parse(r.last_scanned_at) : 0]));
          const hot = all.filter((id)=>recent.includes(id) || active.has(byPost.get(id)?.ad_id ?? "")).slice(0, 25);
          const cold = all.filter((id)=>!hot.includes(id)).sort((x, y)=>(seenAt.get(x) ?? 0) - (seenAt.get(y) ?? 0)).slice(0, 15);
          let todo = [...hot, ...cold];
          if (Array.isArray(b.post_ids) && b.post_ids.length) todo = b.post_ids.map(String).filter((id)=>id.startsWith(pid + "_")).slice(0, 60);
          let k = 0;
          const worker = async ()=>{
            while (k < todo.length) {
              const postId = todo[k++];
              try {
                const r = await g(`/${postId}/comments?filter=stream&order=reverse_chronological&limit=30&summary=total_count&fields=id,message,created_time,from{id,name},parent{id}`, pt);
                const info = byPost.get(postId);
                const rows = (r?.data ?? []).map((c: any)=>({ company_id, page_id: pid, post_id: postId, comment_id: String(c.id), parent_comment_id: c.parent?.id ? String(c.parent.id) : null, from_id: c.from?.id ? String(c.from.id) : null, from_name: c.from?.name ?? null, message: String(c.message ?? "").slice(0, 4000), created_time: c.created_time, ad_id: info?.ad_id ?? null, ad_name: info?.ad_name ?? null, is_page_reply: String(c.from?.id ?? "") === pid, status: String(c.from?.id ?? "") === pid ? "replied" : (Date.now() - Date.parse(c.created_time) > 14 * 86400000 ? "ignored" : "new") }));
                if (rows.length) {
                  const { data: ins } = await db.from("page_comments").upsert(rows, { onConflict: "comment_id", ignoreDuplicates: true }).select("id, from_id");
                  rep.new_comments += (ins ?? []).length;
                  const answered = rows.filter((x: any)=>x.is_page_reply && x.parent_comment_id).map((x: any)=>x.parent_comment_id);
                  if (answered.length) await db.from("page_comments").update({ status: "replied" }).in("comment_id", answered).eq("status", "new");
                }
                await db.from("page_post_scan").upsert({ post_id: postId, page_id: pid, company_id, ad_id: info?.ad_id ?? null, ad_name: info?.ad_name ?? null, last_scanned_at: new Date().toISOString(), comment_count: Number(r?.summary?.total_count ?? 0) }, { onConflict: "post_id" });
                rep.scanned++;
              } catch (e) { rep.errors++; rep.first_error = String(e.message ?? e).slice(0, 120); }
            }
          };
          await Promise.all(Array.from({ length: 6 }, worker));
        } catch (e) { rep.error = String(e.message ?? e).slice(0, 160); }
        report.push(rep);
      }
      return json({ ok: true, pages: report });
    }
    // Signed-in people: the Pages they can use, reading/answering a comment (always on their own Pages).
    if (!isPlatform && ["my_pages", "comments_reply", "comments_hide", "comments_suggest", "comments_read"].includes(String(b.action ?? ""))) {
      let aq = db.from("ad_accounts").select("id, nickname, fb_page_id, meta_connection_id, media_buyer_id").eq("company_id", companyId).eq("status", "active").not("fb_page_id", "is", null);
      const { data: mine } = await aq;
      const allowed = (mine ?? []).filter((a: any)=>role !== "buyer" || a.media_buyer_id === buyerId);
      if (b.action === "my_pages") {
        const seenP = new Set<string>(), out: any[] = [];
        for (const a of allowed) { const pid = digits(a.fb_page_id); if (!pid || seenP.has(pid)) continue; seenP.add(pid); let name = null; try { name = (await g(`/${pid}?fields=name`, await tokenOf(a)))?.name ?? null; } catch (_) { /* the id alone still works */ } out.push({ page_id: pid, name, ad_account_id: a.id, ad_account: a.nickname }); if (out.length >= 12) break; }
        return json({ ok: true, pages: out });
      }
      const { data: row } = await db.from("page_comments").select("*").eq("id", String(b.id ?? "")).maybeSingle();
      const acct = row && row.company_id === companyId ? allowed.find((a: any)=>digits(a.fb_page_id) === row.page_id) : null;
      if (!row || !acct) return json({ error: "Comment not found." }, 404);
      if (b.action === "comments_read") { await db.from("page_comments").update({ read_at: new Date().toISOString() }).eq("id", row.id); return json({ ok: true }); }
      if (b.action === "comments_suggest") {
        const key = Deno.env.get("OPENAI_API_KEY") ?? "";
        if (!key) return json({ error: "The AI is not switched on." }, 503);
        const { data: ad } = await db.from("learn_objects").select("name, creative").eq("company_id", companyId).eq("level", "ad").filter("creative->>post_id", "eq", row.post_id).limit(1).maybeSingle();
        const sys = "You write ONE short, warm public reply (at most 2 sentences) to a customer's comment on a seller's Facebook post or ad. Use the same language and tone as the comment (English or Pidgin). Use ONLY facts in AD. If they ask a price or how to order and AD does not say, invite them to send a message. Never promise results or cures, never invent prices, offers or claims. No hashtags. Return only the reply text.";
        const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.4, max_tokens: 120, messages: [{ role: "system", content: sys }, { role: "user", content: `AD:\n${JSON.stringify({ headline: ad?.creative?.headline, text: String(ad?.creative?.primary_text ?? "").slice(0, 900) })}\n\nCOMMENT from ${row.from_name ?? "a customer"}:\n${String(row.message ?? "").slice(0, 600)}` }] }) });
        const j = await r.json().catch(()=>({}));
        if (!r.ok) return json({ error: String(j?.error?.message ?? "The AI could not answer").slice(0, 200) });
        return json({ ok: true, suggestion: String(j?.choices?.[0]?.message?.content ?? "").trim().slice(0, 600) });
      }
      let pt;
      try { pt = await pageToken(row.page_id, await tokenOf(acct)); } catch (e) { return json({ ok: false, error: e.message.slice(0, 200) }); }
      if (b.action === "comments_hide") {
        try { await g(`/${row.comment_id}`, pt, "POST", { is_hidden: b.hidden === false ? "false" : "true" }); await db.from("page_comments").update({ status: b.hidden === false ? "new" : "hidden" }).eq("id", row.id); return json({ ok: true }); } catch (e) { return json({ ok: false, error: e.message.slice(0, 200) }); }
      }
      // reply: public, so the person must have confirmed it
      if (b.confirmed !== true) return json({ error: "Confirm first: this replies in public." }, 400);
      const message = String(b.message ?? "").trim().slice(0, 2000);
      if (!message) return json({ error: "Write the reply first." }, 400);
      try {
        const r = await g(`/${row.comment_id}/comments`, pt, "POST", { message });
        await db.from("page_comments").update({ status: "replied", reply_text: message, reply_comment_id: String(r?.id ?? ""), replied_by: userId || null, replied_at: new Date().toISOString(), read_at: new Date().toISOString() }).eq("id", row.id);
        return json({ ok: true, reply_comment_id: r?.id ?? null });
      } catch (e) { return json({ ok: false, error: e.message.slice(0, 250) }); }
    }
    // A creative's own Page: "Post to my page" starts from the creative (its ad account, or its product's), never from a client-chosen account.
    if (["post_preview", "post_creative"].includes(String(b.action ?? ""))) {
      const { data: cr } = await db.from("creative_assets").select("id, company_id, public_url, asset_type, primary_text, headline, ad_account_id, product_id").eq("id", String(b.creative_id ?? "")).maybeSingle();
      if (!cr || (companyId && cr.company_id !== companyId)) return json({ error: "Creative not found." }, 404);
      let aid = cr.ad_account_id as string | null;
      if (!aid && cr.product_id) aid = (await db.from("products").select("ad_account_id").eq("id", cr.product_id).maybeSingle()).data?.ad_account_id ?? null;
      // The person can pick another of their own Pages (never one that is not on their ad accounts).
      if (b.page_id) {
        let pq = db.from("ad_accounts").select("id, fb_page_id, media_buyer_id").eq("status", "active").not("fb_page_id", "is", null);
        if (companyId) pq = pq.eq("company_id", cr.company_id);
        const { data: pa } = await pq;
        const hit = (pa ?? []).find((a: any)=>String(a.fb_page_id ?? "").match(/\d+/)?.[0] === String(b.page_id).match(/\d+/)?.[0] && (role !== "buyer" || a.media_buyer_id === buyerId));
        if (!hit) return json({ error: "That Page is not on your ad accounts." }, 403);
        aid = hit.id;
      }
      if (!aid) return json({ error: "This creative has no ad account yet, so no Page. Assign it to a product that has an ad account first." }, 400);
      if (!["image", "video"].includes(String(cr.asset_type))) return json({ error: "Only a single picture or video can be posted." }, 400);
      b.ad_account_id = aid; b._creative = cr;
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
    if (b._creative) {
      const cr = b._creative;
      let pageName = null;
      try { pageName = (await g(`/${pageId}?fields=name`, token))?.name ?? null; } catch (_) { /* the name is only for the preview */ }
      if (b.action === "post_preview") return json({ ok: true, page_id: pageId, page_name: pageName, kind: cr.asset_type, caption: cr.primary_text ?? "", url: cr.public_url });
      if (b.confirmed !== true) return json({ error: "Confirm first: this publishes on the Page." }, 400);
      const msg = String(b.message ?? cr.primary_text ?? "").slice(0, 5000);
      if (!msg.trim()) return json({ error: "Write a caption first." }, 400);
      try {
        const pt = await pageToken(pageId, token);
        let postId = "", link = null;
        if (cr.asset_type === "video") {
          const r = await g(`/${pageId}/videos`, pt, "POST", { file_url: cr.public_url, description: msg, published: "true" });
          postId = String(r?.id ?? ""); link = postId ? `https://www.facebook.com/${pageId}/videos/${postId}` : null;
        } else {
          const r = await g(`/${pageId}/photos`, pt, "POST", { url: cr.public_url, caption: msg, published: "true" });
          postId = String(r?.post_id ?? r?.id ?? "");
          try { const l = (await g(`/${postId}?fields=permalink_url`, pt))?.permalink_url ?? null; link = l && l.startsWith("/") ? "https://www.facebook.com" + l : l; } catch (_) { /* the post exists even if the link cannot be read */ }
        }
        return json({ ok: true, page_id: pageId, page_name: pageName, post_id: postId, link });
      } catch (e) { return json({ ok: false, error: e.message.slice(0, 300) }); }
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
