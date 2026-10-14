// Revora MCP tool group "mcp-social": post to Revora's own Facebook Page and Instagram from ChatGPT or Claude (platform admins only).
// Same shape as mcp-studio: only the `mcp` router calls this, with the service key. The router audits, limits and formats it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, accept, x-client-info, apikey",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
const jres = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

type Tool = {
  name: string; title: string; description: string; inputSchema: any;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  meta?: Record<string, unknown>;
  write?: boolean;
  heavy?: boolean;
  run: (a: any, c: Ctx) => Promise<any>;
};
type Ctx = { token: string; userId: string; email: string | null; companyId: string; role: string; mediaBuyerId: string | null; displayName: string };

const str = (d: string) => ({ type: "string", description: d });
const OBJ = (properties: any, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

async function social(body: unknown, c: Ctx): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/social-admin`, { method: "POST", headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { error: `Unexpected reply (${r.status})` }; }
}
async function isHqAdmin(c: Ctx): Promise<boolean> {
  const { data } = await admin.from("platform_admins").select("user_id").eq("user_id", c.userId).maybeSingle();
  return !!data;
}
const NOT_ADMIN = { error: "Only Revora HQ admins can post to the Revora Page and Instagram." };
const brief = (p: any) => ({ id: p.id, kind: p.kind, status: p.status, pictures: (p.media_urls ?? []).length, scheduled_for: p.scheduled_for, posted_at: p.posted_at, instagram_link: p.ig_link, facebook_link: p.fb_link, error: p.error, first_line: String(p.caption_ig ?? "").split("\n")[0].slice(0, 90) });

const TOOLS: Tool[] = [
  { name: "social_list_posts", title: "Revora social posts", description: "List the posts for Revora's own Facebook Page and Instagram (@revora.ads): drafts, scheduled, posted and failed, with links to the live ones. For Revora HQ admins only. Not for customers' ads.",
    inputSchema: OBJ({ status: { type: "string", enum: ["draft", "approved", "posted", "failed", "skipped"], description: "Only this status. Omit for all." } }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a, c) => {
      if (!(await isHqAdmin(c))) return NOT_ADMIN;
      const r = await social({ action: "list", status: a?.status, limit: 20 }, c);
      return r.error ? r : { posts: (r.posts ?? []).map(brief), auto_approve: r.settings?.auto_approve ?? false };
    } },

  { name: "social_import_media", title: "Use a picture or video from this chat for a social post", description: "Bring a picture (png, jpg or webp, up to 10 MB) or a video (mp4 or mov, up to 100 MB) that is in this chat into Revora's social storage, so it can be posted. Returns a public link to pass to social_create_post as media_urls. Pass the file as media; media_url only if you were given a public link. Revora HQ admins only. It does not post anything.",
    inputSchema: OBJ({ media: { type: "object", description: "The picture or video from the chat (file input).", properties: { download_url: { type: "string" }, file_id: { type: "string" } } }, media_url: str("A public https link to the file, only if media is not available") }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, write: true, meta: { "openai/fileParams": ["media"] },
    run: async (a, c) => {
      if (!(await isHqAdmin(c))) return NOT_ADMIN;
      const src = String(a?.media?.download_url ?? a?.media_url ?? "");
      if (!/^https:\/\//.test(src)) return { error: "I did not receive the file. Ask the person to upload it again." };
      const host = (() => { try { return new URL(src).hostname; } catch { return ""; } })();
      if (!host || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || host.endsWith(".internal") || host.endsWith(".local")) return { error: "That is not a public file link." };
      const r = await fetch(src).catch(() => null);
      if (!r?.ok) return { error: "Could not download the file (the link may have expired). Send it again." };
      const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov" } as Record<string, string>)[type];
      if (!ext) return { error: "Only png, jpg, webp, mp4 or mov files are supported." };
      const bytes = new Uint8Array(await r.arrayBuffer());
      const max = ext === "mp4" || ext === "mov" ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
      if (bytes.length > max) return { error: `That file is over ${max / 1024 / 1024} MB. Send a smaller one.` };
      const d = new Date();
      const path = `chat/${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;
      const up = await admin.storage.from("social-media").upload(path, bytes, { contentType: type });
      if (up.error) return { error: "Could not store the file: " + up.error.message };
      const url = admin.storage.from("social-media").getPublicUrl(path).data.publicUrl;
      return { ok: true, media_url: url, kind: ext === "mp4" || ext === "mov" ? "video" : "picture", note: "Stored. Use this media_url in social_create_post. Nothing has been posted." };
    } },

  { name: "social_create_post", title: "Create a Revora social post", description: "Post to Revora's own Facebook Page and Instagram (@revora.ads). The PERSON writes the caption (or tells you what to write); never invent claims, numbers or testimonials. Media: 1 picture, 2 to 10 pictures (a swipeable carousel, in the order given: the first is the cover), or 1 video (posts as a Reel). mode draft saves it and sends the person a WhatsApp approval message; schedule posts at scheduled_for (ISO time, Lagos is UTC+1); post_now posts immediately. ALWAYS call first WITHOUT confirmed: it returns a preview. Show the person the caption, the pictures in order and the time, and only after a clear yes call again with the same details and confirmed true. Revora HQ admins only. Not for customers' ads.",
    inputSchema: OBJ({
      media_urls: { type: "array", items: { type: "string" }, description: "1 to 10 public links from social_import_media (or other public https links), in the order they should appear" },
      caption_ig: str("The Instagram caption, exactly as the person wants it (max 2,200 characters). Hashtags go at the end."),
      caption_fb: str("The Facebook caption. Optional: the Instagram caption is used if left out."),
      mode: { type: "string", enum: ["draft", "schedule", "post_now"], description: "draft, schedule or post_now" },
      scheduled_for: str("For schedule: the time as an ISO string, e.g. 2026-10-15T17:30:00Z. Lagos time is UTC+1."),
      confirmed: { type: "boolean", description: "True ONLY after the person clearly said yes to the preview." },
    }, ["media_urls", "caption_ig", "mode"]),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, write: true,
    run: async (a, c) => {
      if (!(await isHqAdmin(c))) return NOT_ADMIN;
      const urls: string[] = Array.isArray(a?.media_urls) ? a.media_urls : [];
      const mode = String(a?.mode ?? "draft");
      if (mode !== "draft" && a?.confirmed !== true) {
        return { needs_confirmation: true, not_posted_yet: true, preview: { media_in_order: urls, instagram_caption: a?.caption_ig, facebook_caption: a?.caption_fb || "(same as Instagram)", when: mode === "post_now" ? "right now" : a?.scheduled_for, goes_to: "Facebook Page Revora and Instagram @revora.ads" }, next: "NOT posted yet. Show this to the person and ask. Call again with confirmed true only after a clear yes." };
      }
      const r = await social({ action: "create", media_urls: urls, caption_ig: a?.caption_ig, caption_fb: a?.caption_fb, mode, scheduled_for: a?.scheduled_for, source: "mcp" }, c);
      if (r.error) return r;
      return { ok: true, post: brief(r.post), note: r.note, publisher: r.publisher };
    } },

  { name: "social_manage_post", title: "Approve, post, skip or edit a Revora social post", description: "Act on an existing Revora social post from social_list_posts: approve (it posts at its scheduled time, or at once if none), post_now, skip, delete (only if not posted), or edit_caption / reschedule. ALWAYS call first WITHOUT confirmed for approve and post_now: it returns a summary to show the person; only after a clear yes call again with confirmed true. Revora HQ admins only.",
    inputSchema: OBJ({
      id: str("The post id from social_list_posts"),
      do: { type: "string", enum: ["approve", "post_now", "skip", "delete", "edit_caption", "reschedule"], description: "What to do" },
      caption_ig: str("For edit_caption: the new Instagram caption"),
      caption_fb: str("For edit_caption: the new Facebook caption (optional)"),
      scheduled_for: str("For reschedule or approve: ISO time"),
      confirmed: { type: "boolean", description: "True ONLY after the person clearly said yes (needed for approve and post_now)." },
    }, ["id", "do"]),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, write: true,
    run: async (a, c) => {
      if (!(await isHqAdmin(c))) return NOT_ADMIN;
      const id = String(a?.id ?? ""); const doit = String(a?.do ?? "");
      if ((doit === "approve" || doit === "post_now") && a?.confirmed !== true) {
        const l = await social({ action: "list", limit: 60 }, c);
        const p = (l.posts ?? []).find((x: any) => x.id === id);
        if (!p) return { error: "I can't find that post. Call social_list_posts." };
        return { needs_confirmation: true, not_posted_yet: true, post: brief(p), instagram_caption: p.caption_ig, pictures_in_order: p.media_urls, next: `NOT done yet. Show this to the person and ask if they want to ${doit === "post_now" ? "post it right now" : "approve it"}. Call again with confirmed true only after a clear yes.` };
      }
      let r: any;
      if (doit === "approve") r = await social({ action: "set_status", id, status: "approved", scheduled_for: a?.scheduled_for }, c);
      else if (doit === "post_now") r = await social({ action: "post_now", id }, c);
      else if (doit === "skip") r = await social({ action: "set_status", id, status: "skipped" }, c);
      else if (doit === "delete") r = await social({ action: "delete", id }, c);
      else if (doit === "edit_caption") r = await social({ action: "update", id, caption_ig: a?.caption_ig, caption_fb: a?.caption_fb }, c);
      else if (doit === "reschedule") r = await social({ action: "update", id, scheduled_for: a?.scheduled_for }, c);
      else return { error: "do must be approve, post_now, skip, delete, edit_caption or reschedule." };
      if (r.error) return r;
      return { ok: true, post: r.post ? brief(r.post) : undefined, publisher: r.publisher };
    } },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
const safeEqKey = (a: string, b: string) => { if (!b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// Internal tool group of the Revora MCP server (mcp-social). Only the `mcp` router calls this, with the service key.
//   { action: "list" } -> the tool definitions;  { action: "call", tool, args, ctx } -> { out } (the router audits, limits and formats it)
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!safeEqKey(req.headers.get("x-internal-key") ?? "", SERVICE_KEY)) return jres({ error: "forbidden" }, 403);
  let b: any = {}; try { b = await req.json(); } catch { return jres({ error: "bad_request" }, 400); }
  if (b?.action === "list") return jres({ group: "mcp-social", tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, meta: t.meta, write: t.write, heavy: t.heavy })) });
  if (b?.action === "call") {
    const t = BY_NAME.get(String(b?.tool ?? ""));
    if (!t) return jres({ error: "unknown_tool" }, 404);
    let out: any;
    try { out = await t.run(b?.args && typeof b.args === "object" ? b.args : {}, b.ctx as Ctx); } catch (e) { out = { error: (e as Error).message }; }
    return jres({ out });
  }
  return jres({ error: "bad_action" }, 400);
});
