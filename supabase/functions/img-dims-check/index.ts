import { createClient } from "jsr:@supabase/supabase-js@2";
// Revora temporary upload links.
// NOTE: this function lives in the slot named "img-dims-check" (a retired diagnostic) because the project reached its function limit.
// It is the upload endpoint: https://<project>.supabase.co/functions/v1/img-dims-check . Rename it when functions can be added or removed.
//
// An AI assistant (ChatGPT, Claude, Gemini) that cannot import a picture or video from the chat asks Revora for an upload link
// (MCP tool request_media_upload). The person opens the link, picks the file, and it is stored in the company's own folder.
// The assistant then calls check_media_upload to see the file and keeps building.
//
// Public endpoint, protected by a one-time secret in the link (only its hash is stored). Links expire (30 minutes) and
// only ever write to creative-vault/generated/<company id>/ , the same place import_chat_image uses.
//   POST { action: "info",  id, secret }
//   POST { action: "sign",  id, secret, name, type, size }   -> a signed upload address for ONE file
//   POST { action: "done",  id, secret, path, name }         -> checks the stored file and records it
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const BUCKET = "creative-vault";
const MB = 1024 * 1024;
const MAX_IMAGE = 25 * MB;
const MAX_VIDEO = 100 * MB;
const MAX_FILES = 12;
const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};
const VIDEO_TYPES = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm"
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info"
};
const jres = (obj, status = 200)=>new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS
    }
  });
const sha256hex = async (t)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b)=>b.toString(16).padStart(2, "0")).join("");
const safeEq = (a, b)=>{
  if (a.length !== b.length) return false;
  let d = 0;
  for(let i = 0; i < a.length; i++)d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
async function load(id, secret) {
  const bad = {
    err: jres({
      error: "This upload link is not valid. Ask your assistant for a new one."
    }, 404)
  };
  if (typeof id !== "string" || typeof secret !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{32}$/.test(secret)) return bad;
  const { data: row } = await admin.from("media_upload_requests").select("*").eq("id", id).maybeSingle();
  if (!row || !safeEq(await sha256hex(secret), row.secret_hash)) return bad;
  if (new Date(row.expires_at).getTime() < Date.now()) return {
    err: jres({
      error: "This upload link has expired. Ask your assistant for a new one.",
      expired: true
    }, 410)
  };
  return {
    row
  };
}
const typeOk = (kind, type)=>kind !== "video" && IMAGE_TYPES[type] ? "image" : kind !== "image" && VIDEO_TYPES[type] ? "video" : null;
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS
  });
  if (req.method !== "POST") return jres({
    error: "POST only"
  }, 405);
  let b;
  try {
    b = await req.json();
  } catch  {
    return jres({
      error: "Bad request"
    }, 400);
  }
  const l = await load(b?.id, b?.secret);
  if ("err" in l) return l.err;
  const row = l.row;
  const files = Array.isArray(row.files) ? row.files : [];
  if (b.action === "info") {
    return jres({
      ok: true,
      kind: row.kind,
      note: row.note,
      product_name: row.product_name,
      expires_at: row.expires_at,
      uploaded: files.length,
      max_image_mb: MAX_IMAGE / MB,
      max_video_mb: MAX_VIDEO / MB,
      max_files: MAX_FILES,
      files: files.map((f)=>({
          url: f.url,
          kind: f.kind
        }))
    });
  }
  if (b.action === "sign") {
    const type = String(b.type ?? "").toLowerCase();
    const size = Number(b.size) || 0;
    const kind = typeOk(row.kind, type);
    if (!kind) return jres({
      error: row.kind === "video" ? "Please choose a video (mp4, mov or webm)." : row.kind === "image" ? "Please choose a picture (png, jpg or webp)." : "Please choose a picture (png, jpg, webp) or a video (mp4, mov, webm)."
    }, 400);
    if (kind === "image" && size > MAX_IMAGE) return jres({
      error: `That picture is over ${MAX_IMAGE / MB} MB. Choose a smaller one.`
    }, 400);
    if (kind === "video" && size > MAX_VIDEO) return jres({
      error: `That video is over ${MAX_VIDEO / MB} MB. Choose a shorter or smaller one.`
    }, 400);
    if (files.length >= MAX_FILES) return jres({
      error: `That is the most this link takes (${MAX_FILES} files). Ask your assistant for a new link.`
    }, 400);
    const ext = kind === "image" ? IMAGE_TYPES[type] : VIDEO_TYPES[type];
    const path = `generated/${row.company_id}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return jres({
      error: "Could not start the upload. Try again."
    }, 500);
    return jres({
      ok: true,
      path,
      upload_url: data.signedUrl,
      apikey: ANON_KEY,
      kind
    });
  }
  if (b.action === "done") {
    const path = String(b.path ?? "");
    if (!path.startsWith(`generated/${row.company_id}/`) || path.includes("..")) return jres({
      error: "That file does not belong to this link."
    }, 400);
    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    const head = await fetch(url, {
      method: "HEAD"
    }).catch(()=>null);
    if (!head?.ok) return jres({
      error: "The upload did not finish. Please try that file again."
    }, 404);
    const type = (head.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const size = Number(head.headers.get("content-length") ?? 0);
    const kind = typeOk(row.kind, type);
    const tooBig = kind === "image" ? size > MAX_IMAGE : size > MAX_VIDEO;
    if (!kind || tooBig) {
      await admin.storage.from(BUCKET).remove([
        path
      ]);
      return jres({
        error: "That file type or size is not allowed, so it was removed."
      }, 400);
    }
    if (!files.some((f)=>f.path === path)) {
      const clean = String(b.name ?? "").replace(/[^\w .()-]/g, "").slice(0, 80);
      files.push({
        path,
        url,
        kind,
        type,
        size,
        name: clean,
        uploaded_at: new Date().toISOString()
      });
      await admin.from("media_upload_requests").update({
        files,
        status: "uploaded"
      }).eq("id", row.id);
    }
    return jres({
      ok: true,
      url,
      kind,
      count: files.length
    });
  }
  return jres({
    error: "Unknown action"
  }, 400);
});
