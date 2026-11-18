import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

// Media storage on Cloudflare R2. Browsers upload straight to R2 with a short-lived signed link, so big files never pass
// through an edge function. Files are public by link (R2_PUBLIC_URL), the same way the old Supabase buckets were.
//   POST { action: "sign", folder, filename, contentType, size }   (logged-in user)  -> { uploadUrl, publicUrl, key }
//   POST { action: "put", folder, filename, contentType, base64 }  (logged-in user)  -> { publicUrl, key }   (small files from server-side callers)
//   POST { action: "delete", key }                                  (owner of the key's folder segment) -> { ok }
//   POST { action: "setup_cors" }                                   (x-cron-secret)    -> allows browser PUT from the Revora sites
// Keys look like  <folder>/<user id>/<random>-<clean name>

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const ACCOUNT = Deno.env.get("R2_ACCOUNT_ID") ?? "";
const BUCKET = Deno.env.get("R2_BUCKET") ?? "";
const PUBLIC = (() => { const u = (Deno.env.get("R2_PUBLIC_URL") ?? "").trim().replace(/\/+$/, ""); return u && !/^https?:\/\//.test(u) ? "https://" + u : u; })();
const FOLDERS = new Set(["site-media", "ad-fit", "creative-vault", "social-media", "draft-media", "site-image-originals", "uploads"]);
const MAX_BYTES = 200 * 1024 * 1024;
const TYPES = /^(image\/(png|jpe?g|webp|gif|avif|svg\+xml)|video\/(mp4|quicktime|webm)|audio\/(mpeg|mp4|aac|wav|ogg|webm)|application\/pdf|text\/(plain|html|css|javascript)|application\/(json|zip))$/;

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors } });
const db = createClient(SUPABASE_URL, SERVICE);
const r2 = new AwsClient({ accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "", secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "", service: "s3", region: "auto" });
const base = () => `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}`;
// Repeated dots are collapsed: a name like "One..mp4" used to produce a key containing "..", which the register step
// (rightly) rejects as a path-traversal attempt, so the upload failed with "That upload doesn't belong to you."
const clean = (s: string) => String(s || "file").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[-.]+|[-.]+$/g, "").slice(-60) || "file";
const encKey = (k: string) => k.split("/").map(encodeURIComponent).join("/");

async function whoami(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data?.user?.id ?? null;
}
function makeKey(folder: string, uid: string, filename: string) {
  return `${folder}/${uid}/${crypto.randomUUID().slice(0, 12)}-${clean(filename)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ACCOUNT || !BUCKET || !PUBLIC) return json({ error: "Media storage is not configured." }, 503);
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "setup_cors") {
    const given = req.headers.get("x-cron-secret") || "";
    if (!given || given !== CRON_SECRET) return json({ error: "Unauthorized" }, 401);
    const xml = `<CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin><AllowedMethod>PUT</AllowedMethod><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>86400</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
    const r = await r2.fetch(`${base()}?cors`, { method: "PUT", body: xml, headers: { "content-type": "application/xml" } });
    return json({ status: r.status, body: (await r.text()).slice(0, 300) });
  }

  const uid = await whoami(req);
  if (!uid) return json({ error: "Please log in." }, 401);

  if (action === "sign" || action === "put") {
    const folder = String(body?.folder ?? "");
    const contentType = String(body?.contentType ?? "application/octet-stream").toLowerCase();
    if (!FOLDERS.has(folder)) return json({ error: "Unknown folder." }, 400);
    if (!TYPES.test(contentType)) return json({ error: "This file type isn't allowed." }, 400);
    const key = makeKey(folder, uid, body?.filename);
    const publicUrl = `${PUBLIC}/${encKey(key)}`;
    if (action === "sign") {
      const size = Number(body?.size ?? 0);
      if (size > MAX_BYTES) return json({ error: "That file is too large (200 MB max)." }, 413);
      const u = new URL(`${base()}/${encKey(key)}`); u.searchParams.set("X-Amz-Expires", "900");
      const signed = await r2.sign(new Request(u.toString(), { method: "PUT", headers: { "content-type": contentType } }), { aws: { signQuery: true } });
      return json({ uploadUrl: signed.url, publicUrl, key, headers: { "Content-Type": contentType } });
    }
    const bytes = Uint8Array.from(atob(String(body?.base64 ?? "")), (c) => c.charCodeAt(0));
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) return json({ error: "Use a signed upload for files over 20 MB." }, 413);
    const r = await r2.fetch(`${base()}/${encKey(key)}`, { method: "PUT", body: bytes, headers: { "content-type": contentType, "cache-control": "public, max-age=31536000" } });
    if (!r.ok) return json({ error: "Upload failed.", status: r.status }, 502);
    return json({ publicUrl, key });
  }

  if (action === "delete") {
    const key = String(body?.key ?? "");
    const parts = key.split("/");
    if (parts.length < 3 || !FOLDERS.has(parts[0]) || parts[1] !== uid) return json({ error: "Not allowed." }, 403);
    const r = await r2.fetch(`${base()}/${encKey(key)}`, { method: "DELETE" });
    return json({ ok: r.ok || r.status === 404 });
  }
  return json({ error: "Unknown action." }, 400);
});
