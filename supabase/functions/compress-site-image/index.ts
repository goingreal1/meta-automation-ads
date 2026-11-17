import { createClient } from "jsr:@supabase/supabase-js@2";
// Compresses website images right after they are uploaded.
// Called by a database trigger on storage.objects (see compress_site_image trigger).
// Scope: bucket site-media, and creative-vault/site-images/ only. Ad creatives are NOT touched.
// The original is copied to the private bucket site-image-originals first, so nothing is lost.
// The compressed copy (fits inside 1600px wide, quality 80, WebP) replaces the file at the same path/URL.
// resize=contain keeps the WHOLE image (never crops); it never enlarges a small image.
const SECRET = "Zq8Wn3Vx7Lp2Rt5Yh9Bc4Md6Kf1Ge0Ja";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(SUPABASE_URL, KEY);
const BACKUP = "site-image-originals";
const MIN_BYTES = 400 * 1024; // smaller files are already fine
const MAX_BYTES = 20 * 1024 * 1024; // the resizer refuses very large files
const WIDTH = 1600;
const QUALITY = 80;
const json = (o, s = 200)=>new Response(JSON.stringify(o), {
    status: s,
    headers: {
      "Content-Type": "application/json"
    }
  });
const inScope = (bucket, name)=>bucket === "site-media" || bucket === "creative-vault" && name.startsWith("site-images/");
Deno.serve(async (req)=>{
  if (req.method !== "POST") return json({
    error: "POST only"
  }, 405);
  const b = await req.json().catch(()=>null);
  if (!b || b.secret !== SECRET) return json({
    error: "unauthorized"
  }, 401);
  const bucket = String(b.bucket ?? ""), name = String(b.name ?? "");
  if (!name || name.includes("..") || !inScope(bucket, name)) return json({
    skipped: "out of scope"
  });
  const enc = name.split("/").map(encodeURIComponent).join("/");
  const auth = {
    Authorization: `Bearer ${KEY}`
  };
  // Put the saved original back (used to undo a compression).
  if (b.restore) {
    const g = await fetch(`${SUPABASE_URL}/storage/v1/object/${BACKUP}/${bucket}/${enc}`, {
      headers: auth
    });
    if (!g.ok) return json({
      error: `no backup found (${g.status})`
    }, 404);
    const ct = g.headers.get("content-type") || "image/png";
    const bytes = new Uint8Array(await g.arrayBuffer());
    const up = await sb.storage.from(bucket).update(name, bytes, {
      contentType: ct,
      cacheControl: "3600",
      upsert: true
    });
    if (up.error) return json({
      error: "restore failed: " + up.error.message
    }, 500);
    return json({
      restored: true,
      bytes: bytes.length,
      contentType: ct
    });
  }
  if (!/\.(png|jpe?g)$/i.test(name)) return json({
    skipped: "not a png/jpg"
  });
  const o = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${enc}`, {
    headers: auth
  });
  if (!o.ok) return json({
    skipped: `cannot read original (${o.status})`
  });
  const ctype = (o.headers.get("content-type") || "").toLowerCase();
  if (!/^image\/(png|jpe?g)/.test(ctype)) return json({
    skipped: `content-type ${ctype}`
  });
  const orig = new Uint8Array(await o.arrayBuffer());
  if (orig.length < MIN_BYTES) return json({
    skipped: "already small",
    bytes: orig.length
  });
  if (orig.length > MAX_BYTES) return json({
    skipped: "too large to resize",
    bytes: orig.length
  });
  const r = await fetch(`${SUPABASE_URL}/storage/v1/render/image/authenticated/${bucket}/${enc}?width=${WIDTH}&height=6000&resize=contain&quality=${QUALITY}`, {
    headers: {
      ...auth,
      Accept: "image/webp,image/*;q=0.8"
    }
  });
  if (!r.ok) return json({
    skipped: `resize refused (${r.status})`
  });
  const rtype = (r.headers.get("content-type") || "").toLowerCase();
  const out = new Uint8Array(await r.arrayBuffer());
  if (!rtype.startsWith("image/webp") || out.length === 0 || out.length > orig.length * 0.8) {
    return json({
      skipped: "no real saving",
      original: orig.length,
      compressed: out.length,
      type: rtype
    });
  }
  if (b.dry_run) return json({
    dry_run: true,
    original: orig.length,
    compressed: out.length
  });
  // Keep the original first. If this fails, the original file is left untouched.
  const bk = await sb.storage.from(BACKUP).upload(`${bucket}/${name}`, orig, {
    contentType: ctype,
    upsert: false
  });
  if (bk.error && !/exist|duplicate/i.test(bk.error.message)) return json({
    error: "backup failed, original kept: " + bk.error.message
  }, 500);
  const up = await sb.storage.from(bucket).update(name, out, {
    contentType: "image/webp",
    cacheControl: "3600",
    upsert: true
  });
  if (up.error) return json({
    error: "could not replace file: " + up.error.message
  }, 500);
  return json({
    compressed: true,
    original: orig.length,
    compressed_bytes: out.length
  });
});
