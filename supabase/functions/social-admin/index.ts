import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Revora's own social posting (Facebook Page + Instagram), run by platform admins from HQ -> Social or from ChatGPT/Claude (mcp-studio tools).
//   POST (Authorization: user session; must be in platform_admins)
//     { action: "list", status?, limit? }
//     { action: "upload_url", filename, content_type }                     -> a one-time upload link into the social-media bucket
//     { action: "create", media_urls[], caption_ig, caption_fb?, mode: "draft" | "schedule" | "post_now", scheduled_for?, source? }
//     { action: "set_status", id, status: "approved" | "skipped" | "draft", scheduled_for? }
//     { action: "post_now", id }
//     { action: "update", id, caption_ig?, caption_fb?, scheduled_for? }
//     { action: "delete", id }                                              -> only for posts that have not gone out
// Captions are always written by a person (or by the assistant in the person's own chat); nothing here writes captions on its own.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WA_TOKEN = Deno.env.get("BEOLIV_WHATSAPP_ACCESS_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("BEOLIV_WHATSAPP_PHONE_NUMBER_ID") ?? "";
const TPL_APPROVAL = Deno.env.get("WHATSAPP_TPL_POST_APPROVAL") ?? "revora_post_approval_v1";
const HQ_URL = "https://hq.revoracrm.app";
const db = createClient(SUPABASE_URL, SERVICE);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

const IMG_EXT = ["jpg", "jpeg", "png", "webp"];
const VID_EXT = ["mp4", "mov"];
const extOf = (u: string) => (u.split("?")[0].split(".").pop() ?? "").toLowerCase();
const isHttps = (u: unknown) => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u);
const watTime = (iso: string) => new Date(new Date(iso).getTime() + 3600_000).toISOString().replace("T", " ").slice(0, 16) + " (Lagos)";

// Tell the HQ admins on WhatsApp that a post is waiting. Template first (needed outside the 24h chat window), plain text as the fallback.
async function notifyWaiting(post: any) {
  try {
    if (!WA_TOKEN || !WA_PHONE_ID) return;
    const { data } = await db.from("platform_admins").select("user_id");
    const ids = (data ?? []).map((r: any) => r.user_id);
    if (!ids.length) return;
    const { data: profs } = await db.from("profiles").select("whatsapp_number").in("id", ids).not("whatsapp_number", "is", null);
    const when = post.scheduled_for ? watTime(post.scheduled_for) : "as soon as you approve";
    const hook = String(post.caption_ig ?? "").split("\n")[0].slice(0, 90) || "(no caption)";
    for (const p of profs ?? []) {
      const send = (body: Record<string, unknown>) => fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: p.whatsapp_number, ...body }),
      });
      const t = await send({ type: "template", template: { name: TPL_APPROVAL, language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: when }, { type: "text", text: hook }] }] } });
      if (!t.ok) await send({ type: "text", text: { body: `📣 A post is waiting for your approval.\n\nWhen: ${when}\n"${hook}"\n\nOpen Revora HQ → Social to approve or skip it:\n${HQ_URL}` } });
    }
  } catch (e) { console.error("notifyWaiting", (e as Error).message); }
}

async function runPublisher(postId: string): Promise<any> {
  const { data: sec } = await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 110_000);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/social-publisher`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": sec?.value ?? "" }, body: JSON.stringify({ post_id: postId }), signal: ctl.signal });
    return await r.json().catch(() => ({ error: `Publisher answered ${r.status}` }));
  } catch { return { still_posting: true, note: "It is still posting. Check the list in a minute." }; }
  finally { clearTimeout(timer); }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { data: u } = await db.auth.getUser((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const { data: pa } = await db.from("platform_admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (!pa) return json({ error: "Only Revora HQ admins can post to the Revora Page and Instagram." }, 403);
    const b = await req.json().catch(() => ({}));
    const action = b?.action;

    if (action === "list") {
      let q = db.from("social_posts").select("*").order("scheduled_for", { ascending: false, nullsFirst: true }).limit(Math.min(Number(b?.limit) || 30, 60));
      if (b?.status) q = q.eq("status", String(b.status));
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      const { data: s } = await db.from("social_settings").select("auto_approve, paused, post_hour_wat").eq("id", 1).maybeSingle();
      return json({ posts: data ?? [], settings: s });
    }

    if (action === "upload_url") {
      const ext = (String(b?.filename ?? "").split(".").pop() ?? "").toLowerCase();
      if (![...IMG_EXT, ...VID_EXT].includes(ext)) return json({ error: "Use a jpg, png, webp, mp4 or mov file." }, 400);
      const d = new Date();
      const path = `uploads/${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await db.storage.from("social-media").createSignedUploadUrl(path);
      if (error || !data) return json({ error: error?.message ?? "Could not prepare the upload." }, 500);
      return json({ upload_url: data.signedUrl, token: data.token, path, public_url: db.storage.from("social-media").getPublicUrl(path).data.publicUrl });
    }

    if (action === "create") {
      const urls: string[] = Array.isArray(b?.media_urls) ? b.media_urls : [];
      if (!urls.length || urls.length > 10 || !urls.every(isHttps)) return json({ error: "Give 1 to 10 picture or video links (https)." }, 400);
      const exts = urls.map(extOf);
      const hasVideo = exts.some((e) => VID_EXT.includes(e));
      if (hasVideo && urls.length > 1) return json({ error: "A video goes on its own. For several pictures, send only pictures." }, 400);
      if (!hasVideo && !exts.every((e) => IMG_EXT.includes(e))) return json({ error: "Pictures must be jpg, png or webp." }, 400);
      const caption_ig = String(b?.caption_ig ?? "").trim();
      if (!caption_ig) return json({ error: "Write the caption first. Revora does not write captions on its own." }, 400);
      if (caption_ig.length > 2200) return json({ error: "The Instagram caption is over 2,200 characters." }, 400);
      const caption_fb = String(b?.caption_fb ?? "").trim() || caption_ig;
      const mode = String(b?.mode ?? "draft");
      if (!["draft", "schedule", "post_now"].includes(mode)) return json({ error: "mode must be draft, schedule or post_now." }, 400);
      let when: string | null = null;
      if (mode === "schedule") {
        const t = new Date(String(b?.scheduled_for ?? ""));
        if (isNaN(t.getTime()) || t.getTime() < Date.now() + 60_000) return json({ error: "Give a future time for scheduled_for." }, 400);
        when = t.toISOString();
      } else if (mode === "draft" && b?.scheduled_for) {
        const t = new Date(String(b.scheduled_for)); if (!isNaN(t.getTime())) when = t.toISOString();
      } else if (mode === "post_now") when = new Date().toISOString();
      const { data: row, error } = await db.from("social_posts").insert({
        kind: hasVideo ? "video" : urls.length > 1 ? "carousel" : "image", media_urls: urls, caption_ig, caption_fb,
        status: mode === "draft" ? "draft" : "approved", scheduled_for: when, source: String(b?.source ?? "hq").slice(0, 20),
      }).select("*").single();
      if (error) return json({ error: error.message }, 500);
      if (mode === "draft") { await notifyWaiting(row); return json({ ok: true, post: row, note: "Saved as a draft. A WhatsApp message was sent so you can approve it." }); }
      if (mode === "post_now") { const r = await runPublisher(row.id); const { data: after } = await db.from("social_posts").select("*").eq("id", row.id).maybeSingle(); return json({ ok: true, post: after ?? row, publisher: r }); }
      return json({ ok: true, post: row, note: "Scheduled. It posts at that time." });
    }

    if (action === "set_status") {
      const status = String(b?.status ?? "");
      if (!["approved", "skipped", "draft"].includes(status)) return json({ error: "status must be approved, skipped or draft." }, 400);
      const { data: cur } = await db.from("social_posts").select("status, scheduled_for").eq("id", b?.id).maybeSingle();
      if (!cur) return json({ error: "Unknown post." }, 404);
      if (cur.status === "posted") return json({ error: "That post is already live." }, 400);
      const upd: Record<string, unknown> = { status, error: null, attempts: 0 };
      if (b?.scheduled_for) { const t = new Date(String(b.scheduled_for)); if (isNaN(t.getTime())) return json({ error: "Bad scheduled_for." }, 400); upd.scheduled_for = t.toISOString(); }
      else if (status === "approved" && (!cur.scheduled_for || new Date(cur.scheduled_for).getTime() < Date.now())) upd.scheduled_for = new Date().toISOString();
      const { data, error } = await db.from("social_posts").update(upd).eq("id", b.id).select("*").single();
      return error ? json({ error: error.message }, 500) : json({ ok: true, post: data });
    }

    if (action === "post_now") {
      const { data: cur } = await db.from("social_posts").select("status").eq("id", b?.id).maybeSingle();
      if (!cur) return json({ error: "Unknown post." }, 404);
      if (cur.status === "posted") return json({ error: "That post is already live." }, 400);
      await db.from("social_posts").update({ status: "approved", scheduled_for: new Date().toISOString(), error: null, attempts: 0 }).eq("id", b.id);
      const r = await runPublisher(b.id);
      const { data: after } = await db.from("social_posts").select("*").eq("id", b.id).maybeSingle();
      return json({ ok: true, post: after, publisher: r });
    }

    if (action === "update") {
      const { data: cur } = await db.from("social_posts").select("status").eq("id", b?.id).maybeSingle();
      if (!cur) return json({ error: "Unknown post." }, 404);
      if (cur.status === "posted") return json({ error: "That post is already live." }, 400);
      const upd: Record<string, unknown> = {};
      if (typeof b?.caption_ig === "string") upd.caption_ig = b.caption_ig.trim().slice(0, 2200);
      if (typeof b?.caption_fb === "string") upd.caption_fb = b.caption_fb.trim();
      if (b?.scheduled_for) { const t = new Date(String(b.scheduled_for)); if (isNaN(t.getTime())) return json({ error: "Bad scheduled_for." }, 400); upd.scheduled_for = t.toISOString(); }
      if (!Object.keys(upd).length) return json({ error: "Nothing to change." }, 400);
      const { data, error } = await db.from("social_posts").update(upd).eq("id", b.id).select("*").single();
      return error ? json({ error: error.message }, 500) : json({ ok: true, post: data });
    }

    if (action === "delete") {
      const { data: cur } = await db.from("social_posts").select("status").eq("id", b?.id).maybeSingle();
      if (!cur) return json({ error: "Unknown post." }, 404);
      if (cur.status === "posted") return json({ error: "A live post cannot be deleted here. Delete it in Facebook or Instagram." }, 400);
      const { error } = await db.from("social_posts").delete().eq("id", b.id);
      return error ? json({ error: error.message }, 500) : json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
