import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Posts the next approved item from social_posts to Revora's Facebook Page and Instagram account.
//   Auth: the shared cron secret in x-cron-secret (same as managed-guard).
//   POST {}                         -> publish the oldest approved post that is due
//   POST { post_id, force? }        -> publish that post now (needs status approved unless force)
// Safe to re-run: a platform that already has its post id is never posted twice. After 3 tries a post is marked failed.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const G = "https://graph.facebook.com/v21.0";
const db = createClient(SUPABASE_URL, SERVICE);
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gget(path: string, tok = TOKEN) {
  const r = await fetch(`${G}/${path}${path.includes("?") ? "&" : "?"}access_token=${tok}`);
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) as any };
}
async function gpost(path: string, body: Record<string, unknown>, tok = TOKEN) {
  const r = await fetch(`${G}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: tok }) });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) as any };
}
const why = (r: { data: any; status: number }) => r.data?.error?.error_user_msg || r.data?.error?.message || `Meta said ${r.status}`;

// Instagram processes the media first; wait until it says FINISHED.
async function waitFinished(containerId: string, maxMs: number): Promise<string> {
  const end = Date.now() + maxMs;
  let code = "";
  while (Date.now() < end) {
    const s = await gget(`${containerId}?fields=status_code`);
    code = s.data?.status_code ?? "";
    if (code === "FINISHED" || code === "ERROR" || code === "EXPIRED") return code;
    await sleep(3000);
  }
  return code || "TIMEOUT";
}

async function postFacebook(post: any, s: any): Promise<{ id: string; link: string | null }> {
  const pt = await gget("me/accounts?fields=id,access_token&limit=50");
  const pageTok = (pt.data?.data ?? []).find((p: any) => String(p.id) === String(s.page_id))?.access_token;
  if (!pageTok) throw new Error("No Page access for the Revora Page");
  const caption = post.caption_fb ?? post.caption_ig ?? "";
  let id = "";
  if (post.kind === "image") {
    const r = await gpost(`${s.page_id}/photos`, { url: post.media_urls[0], caption, published: true }, pageTok);
    if (!r.ok) throw new Error(why(r)); id = r.data?.post_id ?? r.data?.id;
  } else if (post.kind === "carousel") {
    const ids: string[] = [];
    for (const url of post.media_urls.slice(0, 10)) {
      const r = await gpost(`${s.page_id}/photos`, { url, published: false }, pageTok);
      if (!r.ok) throw new Error(why(r)); ids.push(r.data.id);
    }
    const f = await gpost(`${s.page_id}/feed`, { message: caption, attached_media: ids.map((m) => ({ media_fbid: m })) }, pageTok);
    if (!f.ok) throw new Error(why(f)); id = f.data.id;
  } else {
    const r = await gpost(`${s.page_id}/videos`, { file_url: post.media_urls[0], description: caption }, pageTok);
    if (!r.ok) throw new Error(why(r)); id = r.data.id;
  }
  const l = await gget(`${id}?fields=permalink_url`, pageTok);
  const pl = l.data?.permalink_url as string | undefined;
  return { id, link: pl ? (pl.startsWith("http") ? pl : "https://facebook.com" + pl) : null };
}

async function postInstagram(post: any, s: any): Promise<{ id: string; link: string | null }> {
  const caption = post.caption_ig ?? post.caption_fb ?? "";
  let container = "";
  if (post.kind === "image") {
    const c = await gpost(`${s.ig_user_id}/media`, { image_url: post.media_urls[0], caption });
    if (!c.ok) throw new Error(why(c)); container = c.data.id;
  } else if (post.kind === "carousel") {
    const kids = await Promise.all(post.media_urls.slice(0, 10).map(async (url: string) => {
      const c = await gpost(`${s.ig_user_id}/media`, { image_url: url, is_carousel_item: true });
      if (!c.ok) throw new Error(why(c)); return c.data.id as string;
    }));
    for (const k of kids) { const st = await waitFinished(k, 60000); if (st !== "FINISHED") throw new Error(`Instagram could not process a slide (${st})`); }
    const c = await gpost(`${s.ig_user_id}/media`, { media_type: "CAROUSEL", children: kids.join(","), caption });
    if (!c.ok) throw new Error(why(c)); container = c.data.id;
  } else {
    const c = await gpost(`${s.ig_user_id}/media`, { media_type: "REELS", video_url: post.media_urls[0], caption, share_to_feed: true });
    if (!c.ok) throw new Error(why(c)); container = c.data.id;
  }
  const st = await waitFinished(container, post.kind === "video" ? 110000 : 60000);
  if (st !== "FINISHED") throw new Error(`Instagram could not process the post (${st})`);
  const p = await gpost(`${s.ig_user_id}/media_publish`, { creation_id: container });
  if (!p.ok) throw new Error(why(p));
  const m = await gget(`${p.data.id}?fields=permalink`);
  return { id: p.data.id, link: m.data?.permalink ?? null };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const given = req.headers.get("x-cron-secret") || body?.cron_secret || "";
  const { data: sec } = await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
  if (!given || (given !== sec?.value && given !== CRON_SECRET)) return json({ error: "Unauthorized" }, 401);
  if (!TOKEN) return json({ error: "Meta is not connected" }, 500);

  const { data: s } = await db.from("social_settings").select("*").eq("id", 1).maybeSingle();
  if (!s) return json({ error: "No social settings" }, 500);
  if (s.paused && !body?.post_id) return json({ skipped: "paused" });

  let post: any = null;
  if (body?.post_id) {
    const { data } = await db.from("social_posts").select("*").eq("id", body.post_id).maybeSingle();
    if (!data) return json({ error: "Unknown post" }, 404);
    if (data.status !== "approved" && !body?.force) return json({ error: `Post is ${data.status}, not approved` }, 400);
    if (data.status === "posted") return json({ error: "Already posted" }, 400);
    post = data;
  } else {
    const { data } = await db.from("social_posts").select("*").eq("status", "approved")
      .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`)
      .order("scheduled_for", { ascending: true, nullsFirst: true }).limit(1);
    post = data?.[0] ?? null;
  }
  if (!post) return json({ posted: 0, note: "nothing due" });

  const attempts = (post.attempts ?? 0) + 1;
  await db.from("social_posts").update({ attempts }).eq("id", post.id);

  const upd: Record<string, unknown> = {};
  const errors: string[] = [];
  const wantFb = (post.platforms ?? []).includes("facebook");
  const wantIg = (post.platforms ?? []).includes("instagram");

  if (wantFb && !post.fb_post_id) {
    try { const r = await postFacebook(post, s); upd.fb_post_id = r.id; upd.fb_link = r.link; post.fb_post_id = r.id; }
    catch (e) { errors.push("Facebook: " + (e as Error).message); }
  }
  if (wantIg && !post.ig_media_id) {
    try { const r = await postInstagram(post, s); upd.ig_media_id = r.id; upd.ig_link = r.link; post.ig_media_id = r.id; }
    catch (e) { errors.push("Instagram: " + (e as Error).message); }
  }

  const done = (!wantFb || post.fb_post_id) && (!wantIg || post.ig_media_id);
  if (done) { upd.status = "posted"; upd.posted_at = new Date().toISOString(); upd.error = errors.length ? errors.join(" | ") : null; }
  else if (attempts >= 3) { upd.status = "failed"; upd.error = errors.join(" | "); }
  else { upd.error = errors.join(" | "); } // stays approved: the next run retries only what is missing
  await db.from("social_posts").update(upd).eq("id", post.id);

  if (done) {
    for (const url of post.media_urls) {
      const { data: a } = await db.from("social_assets").select("id, times_used").eq("url", url).maybeSingle();
      if (a) await db.from("social_assets").update({ last_used_at: new Date().toISOString() }).eq("id", a.id);
    }
  }
  return json({ post_id: post.id, status: upd.status ?? "approved", attempts, fb: post.fb_post_id ?? null, ig: post.ig_media_id ?? null, errors });
});
