// Revora direct-to-Cloudflare-R2 uploads for upload links (the page from get_upload_link: pictures and videos for ads or the website).
// The browser asks this function for a short-lived signed PUT link, sends the file STRAIGHT to R2 (it never passes through Revora),
// then calls upload_finish so Revora checks the file really arrived and saves it as a creative or a website picture.
// Public actions, checked by the upload-link token only (same links and same rules as mcp-social): upload_info, upload_sign, upload_finish.
// Switched on by five secrets on this function: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL.
// Until they are all set, upload_info answers r2:false and the page keeps using Supabase Storage as before. GET shows which secrets are missing (names only).
// (This slug used to be a retired 410 stub; the project is at its function limit, so it is reused.)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const R2_ACCOUNT = Deno.env.get("R2_ACCOUNT_ID") ?? "";
const R2_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const R2_SECRET = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const R2_BUCKET = Deno.env.get("R2_BUCKET") ?? "";
const R2_PUBLIC = (Deno.env.get("R2_PUBLIC_URL") ?? "").replace(/\/+$/, "");
const r2Ready = ()=>!!(R2_ACCOUNT && R2_KEY_ID && R2_SECRET && R2_BUCKET && R2_PUBLIC);
const IMAGE_MAX = 20 * 1024 * 1024;
const VIDEO_MAX = 500 * 1024 * 1024;
const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm"
};
const MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm"
};
const VIDEO_EXT = new Set([
  "mp4",
  "mov",
  "webm"
]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info"
};
const jres = (obj, status = 200)=>new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
// -- hashing and AWS Signature V4 (query-string form), checked against the AWS documentation example --
const enc = new TextEncoder();
const hex = (b)=>Array.from(new Uint8Array(b)).map((x)=>x.toString(16).padStart(2, "0")).join("");
const sha256hex = async (t)=>hex(await crypto.subtle.digest("SHA-256", enc.encode(t)));
const uriEnc = (t)=>encodeURIComponent(t).replace(/[!'()*]/g, (c)=>"%" + c.charCodeAt(0).toString(16).toUpperCase());
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, [
    "sign"
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
async function r2Sign(method, path, signedHeaders = {}, expires = 900) {
  const host = `${R2_ACCOUNT}.r2.cloudflarestorage.com`, region = "auto";
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8), scope = `${day}/${region}/s3/aws4_request`;
  const hdrs = {
    host,
    ...Object.fromEntries(Object.entries(signedHeaders).map(([k, v])=>[
        k.toLowerCase(),
        String(v).trim()
      ]))
  };
  const names = Object.keys(hdrs).sort();
  const q = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${R2_KEY_ID}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": names.join(";")
  };
  const canonQuery = Object.keys(q).sort().map((k)=>`${uriEnc(k)}=${uriEnc(q[k])}`).join("&");
  const canonPath = `/${R2_BUCKET}/${path}`.split("/").map(uriEnc).join("/");
  const canonReq = [
    method,
    canonPath,
    canonQuery,
    names.map((n)=>`${n}:${hdrs[n]}\n`).join(""),
    names.join(";"),
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const toSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256hex(canonReq)
  ].join("\n");
  let k = await hmac(enc.encode("AWS4" + R2_SECRET), day);
  for (const part of [
    region,
    "s3",
    "aws4_request"
  ])k = await hmac(k, part);
  return `https://${host}${canonPath}?${canonQuery}&X-Amz-Signature=${hex(await hmac(k, toSign))}`;
}
async function r2Head(path) {
  const r = await fetch(await r2Sign("HEAD", path, {}, 120), {
    method: "HEAD"
  }).catch(()=>null);
  if (!r?.ok) return null;
  return {
    size: Number(r.headers.get("content-length") ?? 0),
    mime: String(r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
  };
}
async function r2Remove(path) {
  await fetch(await r2Sign("DELETE", path, {}, 120), {
    method: "DELETE"
  }).catch(()=>null);
}
// -- upload links (same table and rules as mcp-social) --
const extOf = (name, mime)=>{
  const fromMime = EXT_BY_MIME[String(mime ?? "").toLowerCase()];
  if (fromMime) return fromMime;
  const m = String(name ?? "").match(/\.(png|jpe?g|webp|mp4|mov|webm)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : null;
};
const folderOf = (purpose)=>purpose === "website" ? "site-images" : "ai-import";
async function loadLink(token) {
  const t = String(token ?? "");
  if (!/^[0-9a-f]{32}$/.test(t)) return {
    error: "This upload link is not valid. Ask your assistant for a new one.",
    status: 403
  };
  const { data: l } = await admin.from("upload_links").select("*").eq("secret_hash", await sha256hex(t)).maybeSingle();
  if (!l) return {
    error: "This upload link is not valid. Ask your assistant for a new one.",
    status: 403
  };
  if (new Date(l.expires_at).getTime() < Date.now()) return {
    error: "This upload link has expired. Ask your assistant for a new one.",
    status: 410
  };
  return {
    l
  };
}
async function handle(req) {
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS
  });
  if (req.method === "GET") {
    const missing = [
      [
        "R2_ACCOUNT_ID",
        R2_ACCOUNT
      ],
      [
        "R2_ACCESS_KEY_ID",
        R2_KEY_ID
      ],
      [
        "R2_SECRET_ACCESS_KEY",
        R2_SECRET
      ],
      [
        "R2_BUCKET",
        R2_BUCKET
      ],
      [
        "R2_PUBLIC_URL",
        R2_PUBLIC
      ]
    ].filter(([, v])=>!v).map(([k])=>k);
    return jres({
      r2_ready: missing.length === 0,
      missing
    });
  }
  if (req.method !== "POST") return jres({
    error: "method_not_allowed"
  }, 405);
  let b;
  try {
    b = await req.json();
  } catch  {
    return jres({
      error: "bad_request"
    }, 400);
  }
  const act = String(b?.action ?? "");
  const L = await loadLink(b?.token);
  if (L.error) return jres({
    error: L.error
  }, L.status ?? 403);
  const l = L.l;
  // Zip links (website import) stay on Supabase Storage: the page falls back to mcp-social for them.
  const usable = r2Ready() && (l.purpose === "ads" || l.purpose === "website");
  const { data: product } = await admin.from("products").select("id, product_name, media_buyer_id").eq("id", l.product_id).eq("company_id", l.company_id).maybeSingle();
  if (!product) return jres({
    error: "The product for this link no longer exists."
  }, 404);
  const remaining = Math.max(Number(l.max_files) - Number(l.files_added), 0);
  if (act === "upload_info") {
    return jres({
      r2: usable,
      product: product.product_name,
      purpose: l.purpose,
      expires_at: l.expires_at,
      remaining,
      max_files: l.max_files,
      image_max_mb: IMAGE_MAX / 1048576,
      video_max_mb: l.purpose === "website" ? 0 : VIDEO_MAX / 1048576,
      accepts: l.purpose === "website" ? "png, jpg, webp" : "png, jpg, webp, mp4, mov, webm"
    });
  }
  if (!usable) return jres({
    error: "Direct uploads are not switched on for this link."
  }, 409);
  if (act === "upload_sign") {
    if (remaining < 1) return jres({
      error: "This link has reached its file limit. Ask your assistant for a new one."
    }, 429);
    const ext = extOf(String(b?.name ?? ""), String(b?.content_type ?? ""));
    if (!ext) return jres({
      error: "Only png, jpg, webp images and mp4, mov, webm videos can be uploaded."
    }, 400);
    const isVideo = VIDEO_EXT.has(ext);
    if (isVideo && l.purpose === "website") return jres({
      error: "Website pictures must be images. Ask your assistant for an ads upload link to add a video."
    }, 400);
    const size = Number(b?.size);
    if (!Number.isFinite(size) || size <= 0) return jres({
      error: "Could not read the file size."
    }, 400);
    const cap = isVideo ? VIDEO_MAX : IMAGE_MAX;
    if (size > cap) return jres({
      error: `That file is too big. The limit is ${cap / 1048576} MB for ${isVideo ? "videos" : "images"}.`
    }, 413);
    const path = `${folderOf(l.purpose)}/${l.company_id}/${crypto.randomUUID()}.${ext}`;
    const headers = {
      "Content-Type": MIME_BY_EXT[ext]
    };
    return jres({
      path,
      method: "PUT",
      upload_url: await r2Sign("PUT", path, headers, 900),
      headers
    });
  }
  if (act === "upload_finish") {
    const path = String(b?.path ?? "");
    const m = path.match(new RegExp(`^${folderOf(l.purpose)}/${l.company_id}/([0-9a-f-]{36})\\.(png|jpg|webp|mp4|mov|webm)$`));
    if (!m) return jres({
      error: "That file does not belong to this link."
    }, 400);
    const ext = m[2], isVideo = VIDEO_EXT.has(ext);
    const obj = await r2Head(path);
    if (!obj) return jres({
      error: "The upload did not arrive. Please try that file again."
    }, 404);
    const cap = isVideo ? VIDEO_MAX : IMAGE_MAX;
    if (!obj.size || obj.size > cap || obj.mime !== MIME_BY_EXT[ext]) {
      await r2Remove(path);
      return jres({
        error: obj.size > cap ? `That file is too big. The limit is ${cap / 1048576} MB for ${isVideo ? "videos" : "images"}.` : "That file type is not allowed. It was removed."
      }, 400);
    }
    const publicUrl = `${R2_PUBLIC}/${path}`;
    const original = String(b?.name ?? "").replace(/[^\w .()\-]/g, "").trim().slice(0, 100);
    const label = original || `${product.product_name} ${l.purpose === "website" ? "site image" : isVideo ? "ad video" : "ad image"} ${new Date().toISOString().slice(0, 10)}`;
    const name = /\.\w{2,5}$/.test(label) ? label : `${label}.${ext}`;
    // Finishing the same file twice does nothing the second time.
    const [{ data: d1 }, { data: d2 }] = await Promise.all([
      admin.from("creative_assets").select("id").eq("company_id", l.company_id).eq("public_url", publicUrl).limit(1),
      admin.from("product_images").select("id").eq("company_id", l.company_id).eq("url", publicUrl).limit(1)
    ]);
    if (d1?.length || d2?.length) return jres({
      ok: true,
      already: true,
      name,
      preview_url: publicUrl,
      remaining
    });
    if (l.purpose === "website") {
      const { error } = await admin.from("product_images").insert({
        company_id: l.company_id,
        product_id: product.id,
        media_buyer_id: product.media_buyer_id ?? null,
        name,
        url: publicUrl,
        storage_path: path,
        kind: "image",
        purpose: "website",
        created_by: l.user_id
      });
      if (error) {
        await r2Remove(path);
        return jres({
          error: "Could not save the picture. Try again."
        }, 500);
      }
    } else {
      const { error } = await admin.from("creative_assets").insert({
        company_id: l.company_id,
        file_name: name,
        storage_path: path,
        storage_provider: "r2",
        public_url: publicUrl,
        asset_type: isVideo ? "video" : "image",
        product_id: product.id,
        uploaded_by: "upload_link",
        test_status: "untested",
        uploaded_at: new Date().toISOString()
      });
      if (error) {
        await r2Remove(path);
        return jres({
          error: "Could not save the file. Try again."
        }, 500);
      }
    }
    await admin.from("upload_links").update({
      files_added: Number(l.files_added) + 1
    }).eq("id", l.id);
    return jres({
      ok: true,
      saved: true,
      purpose: l.purpose,
      type: isVideo ? "video" : "image",
      name,
      preview_url: publicUrl,
      remaining: Math.max(remaining - 1, 0)
    });
  }
  return jres({
    error: "bad_action"
  }, 400);
}
Deno.serve((req)=>handle(req).catch((e)=>jres({
      error: e.message
    }, 500)));
