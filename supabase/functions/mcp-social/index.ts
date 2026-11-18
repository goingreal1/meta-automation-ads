// Revora MCP tool group "mcp-social": post to Revora's own Facebook Page and Instagram from ChatGPT or Claude (platform admins only).
// Same shape as mcp-studio: only the `mcp` router calls this, with the service key. The router audits, limits and formats it.
//
// ALSO HERE (the project is at its Edge Function limit, so these features live in this function):
//   - UPLOAD LINKS: tool get_upload_link + PUBLIC actions upload_info, upload_sign, upload_finish (checked by the link token only)
//     purpose zip: the person uploads a website .zip (or an Elementor .json the page packs into a zip); upload_import hands it to mcp-code site_import_zip (a draft site),
//     optionally copies outside pictures into Revora storage (mirror_images), upload_publish flips it live/draft.
//   - LIVE EDIT LINKS: tool get_edit_link + PUBLIC actions edit_load, edit_save (live or draft), edit_discard_draft, edit_undo, edit_upload_sign, edit_upload_finish
//     Sites built as FILES (settings.storage = files) keep their source in site_files and are rebuilt from it on every AI change.
//     So for those sites the editor reads and writes the file's body through mcp-code (site_write_file / site_rollback), with a version check.
//   - CAMPAIGN EDIT LINKS: tool get_ad_copy_link + PUBLIC actions plan_load, plan_save, plan_upload_sign, plan_upload_finish
//     The person edits a DRAFT plan (ai_plans.plan) from a private link: campaign name, ad set settings, copies, headlines, pictures.
// Tokens are stored only as hashes (tables upload_links, edit_links, plan_edit_links), expire, and are limited to one product / one site / one plan.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { withR2 } from "../_shared/r2storage.ts";
import { AwsClient } from "npm:aws4fetch@1.0.20";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const admin = withR2(createClient(SUPABASE_URL, SERVICE_KEY));
const SITE = "https://metaautomationads.vercel.app";
const BUCKET = "creative-vault";
// Ad pictures and videos live on Cloudflare R2 (not Supabase Storage). If R2 is not configured the old bucket is used.
const R2A = Deno.env.get("R2_ACCOUNT_ID") ?? "", R2B = Deno.env.get("R2_BUCKET") ?? "";
let R2P = (Deno.env.get("R2_PUBLIC_URL") ?? "").trim().replace(/\/+$/, "");
if (R2P && !/^https?:\/\//.test(R2P)) R2P = "https://" + R2P;
const R2_ON = !!(R2A && R2B && R2P && Deno.env.get("R2_ACCESS_KEY_ID"));
const r2c = R2_ON ? new AwsClient({ accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!, secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!, service: "s3", region: "auto" }) : null;
const r2enc = (k: string) => k.split("/").map(encodeURIComponent).join("/");
const r2url = (k: string) => `https://${R2A}.r2.cloudflarestorage.com/${R2B}/${r2enc(k)}`;
const CT_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
const rmFile = async (path: string) => { if (R2_ON) await r2c!.fetch(r2url(path), { method: "DELETE" }).catch(() => {}); else await admin.storage.from(BUCKET).remove([path]); };
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, accept, x-client-info, apikey",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id"
};
const jres = (obj, status = 200)=>new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
const str = (d)=>({
    type: "string",
    description: d
  });
const OBJ = (properties, required = [])=>({
    type: "object",
    properties,
    required,
    additionalProperties: false
  });
async function social(body, c) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/social-admin`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch  {
    return {
      error: `Unexpected reply (${r.status})`
    };
  }
}
async function isHqAdmin(c) {
  const { data } = await admin.from("platform_admins").select("user_id").eq("user_id", c.userId).maybeSingle();
  return !!data;
}
const NOT_ADMIN = {
  error: "Only Revora HQ admins can post to the Revora Page and Instagram."
};
const brief = (p)=>({
    id: p.id,
    kind: p.kind,
    status: p.status,
    pictures: (p.media_urls ?? []).length,
    scheduled_for: p.scheduled_for,
    posted_at: p.posted_at,
    instagram_link: p.ig_link,
    facebook_link: p.fb_link,
    error: p.error,
    first_line: String(p.caption_ig ?? "").split("\n")[0].slice(0, 90)
  });
// -- shared helpers --
const sha256hex = async (t)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b)=>b.toString(16).padStart(2, "0")).join("");
const hexRand = (n)=>Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b)=>b.toString(16).padStart(2, "0")).join("");
const normName = (t)=>String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm"
};
const VIDEO_EXT = new Set([
  "mp4",
  "mov",
  "webm"
]);
const IMAGE_MAX = 20 * 1024 * 1024;
const VIDEO_MAX = (R2_ON ? 200 : 50) * 1024 * 1024;
const LINK_MINUTES = 60;
const EDIT_HOURS = 24;
const ZIP_MAX = 50 * 1024 * 1024;
// mcp-code runs the website import. The zip link calls it as the person who made the link.
async function codeCall(tool, args, userId, companyId, role) {
  const ctx = {
    token: "",
    userId,
    email: null,
    companyId,
    role,
    mediaBuyerId: null,
    displayName: "Zip import"
  };
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/mcp-code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": SERVICE_KEY
      },
      body: JSON.stringify({
        action: "call",
        tool,
        args,
        ctx
      })
    });
    const j = await r.json().catch(()=>null);
    return j?.out ?? {
      error: "The website importer did not answer. Try again."
    };
  } catch  {
    return {
      error: "The website importer did not answer. Try again."
    };
  }
}
// Copies pictures that an imported page loads from other websites into Revora's own storage, so the page keeps working if the original site goes away.
async function mirrorImages(siteId, userId, companyId, role) {
  const { data: files } = await admin.from("site_files").select("path, content, version").eq("site_id", siteId).like("path", "%.html");
  const re = /https?:\/\/[^\s"'()<>\\]+?\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[^\s"'()<>\\]*)?/gi;
  let ownHost = "";
  try {
    ownHost = new URL(SUPABASE_URL).hostname;
  } catch  {}
  const okHost = (u)=>{
    try {
      const h = new URL(u).hostname;
      return u.startsWith("https://") && h !== ownHost && h !== "localhost" && !/^[\d.]+$/.test(h) && !h.includes(":") && !h.endsWith(".internal") && !h.endsWith(".local");
    } catch  {
      return false;
    }
  };
  const cache = new Map();
  let copied = 0, failed = 0;
  const one = async (u)=>{
    try {
      const r = await fetch(u, {
        signal: AbortSignal.timeout(15000)
      });
      const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!r.ok || !type.startsWith("image/")) throw new Error("not an image");
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("size");
      const ext = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/svg+xml": "svg",
        "image/avif": "avif"
      }[type] ?? "jpg";
      const path = `imports/${siteId}/ext/${(await sha256hex(u)).slice(0, 12)}.${ext}`;
      const up = await admin.storage.from("site-media").upload(path, bytes, {
        contentType: type,
        upsert: true
      });
      if (up.error) throw new Error("store");
      cache.set(u, admin.storage.from("site-media").getPublicUrl(path).data.publicUrl);
      copied++;
    } catch  {
      cache.set(u, null);
      failed++;
    }
  };
  const all = new Set();
  for (const f of files ?? [])for (const m of String(f.content).match(re) ?? [])if (okHost(m)) all.add(m);
  const list = [
    ...all
  ].slice(0, 60);
  for(let i = 0; i < list.length; i += 6)await Promise.all(list.slice(i, i + 6).map(one));
  for (const f of files ?? []){
    let next = String(f.content);
    for (const [u, n] of cache)if (n) next = next.split(u).join(n);
    if (next !== f.content) await codeCall("site_write_file", {
      site_id: siteId,
      path: f.path,
      content: next,
      if_version: f.version
    }, userId, companyId, role);
  }
  return {
    copied,
    failed
  };
}
const folderOf = (purpose)=>purpose === "website" ? "site-images" : "ai-import";
const extOf = (name, mime)=>{
  const fromMime = EXT_BY_MIME[String(mime ?? "").toLowerCase()];
  if (fromMime) return fromMime;
  const m = String(name ?? "").match(/\.(png|jpe?g|webp|mp4|mov|webm)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : null;
};
// -- upload links --
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
// The public actions the upload page calls. They are checked by the link token only.
async function publicUpload(b) {
  const L = await loadLink(b?.token);
  if (L.error) return jres({
    error: L.error
  }, L.status ?? 403);
  const l = L.l;
  const { data: product } = await admin.from("products").select("id, product_name, media_buyer_id").eq("id", l.product_id).eq("company_id", l.company_id).maybeSingle();
  if (!product) return jres({
    error: "The product for this link no longer exists."
  }, 404);
  const remaining = Math.max(Number(l.max_files) - Number(l.files_added), 0);
  const act = String(b?.action ?? "");
  if (act === "upload_info") {
    return jres({
      product: product.product_name,
      purpose: l.purpose,
      expires_at: l.expires_at,
      remaining,
      max_files: l.max_files,
      image_max_mb: IMAGE_MAX / 1048576,
      video_max_mb: l.purpose === "website" ? 0 : VIDEO_MAX / 1048576,
      accepts: l.purpose === "zip" ? "a .zip file" : l.purpose === "website" ? "png, jpg, webp" : "png, jpg, webp, mp4, mov, webm",
      zip_max_mb: ZIP_MAX / 1048576,
      key: ANON_KEY
    });
  }
  if (act === "upload_sign") {
    if (remaining < 1) return jres({
      error: "This link has reached its file limit. Ask your assistant for a new one."
    }, 429);
    if (l.purpose === "zip") {
      if (!/\.zip$/i.test(String(b?.name ?? ""))) return jres({
        error: "Choose a .zip file."
      }, 400);
      const zs = Number(b?.size);
      if (!Number.isFinite(zs) || zs <= 0) return jres({
        error: "Could not read the file size."
      }, 400);
      if (zs > ZIP_MAX) return jres({
        error: `That zip is too big. The limit is ${ZIP_MAX / 1048576} MB.`
      }, 413);
      const zpath = `site-zips/${l.company_id}/${crypto.randomUUID()}.zip`;
      const { data: zd, error: ze } = await admin.storage.from(BUCKET).createSignedUploadUrl(zpath);
      if (ze || !zd?.token) return jres({
        error: "Could not prepare the upload. Try again."
      }, 500);
      return jres({
        path: zpath,
        upload_url: `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${zpath}?token=${encodeURIComponent(zd.token)}`,
        key: ANON_KEY
      });
    }
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
    if (R2_ON) {
      const u = new URL(r2url(path));
      u.searchParams.set("X-Amz-Expires", "900");
      const ct = CT_BY_EXT[ext] ?? "application/octet-stream";
      const sg = await r2c!.sign(new Request(u.toString(), { method: "PUT", headers: { "content-type": ct } }), { aws: { signQuery: true } });
      return jres({ path, upload_url: sg.url, r2: true, content_type: ct, key: ANON_KEY });
    }
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) return jres({
      error: "Could not prepare the upload. Try again."
    }, 500);
    return jres({
      path,
      upload_url: `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}?token=${encodeURIComponent(data.token)}`,
      key: ANON_KEY
    });
  }
  if (act === "upload_finish") {
    if (l.purpose === "zip") return jres({
      error: "Use the import step for a zip."
    }, 400);
    const path = String(b?.path ?? "");
    const re = new RegExp(`^${folderOf(l.purpose)}/${l.company_id}/([0-9a-f-]{36})\\.(png|jpg|webp|mp4|mov|webm)$`);
    const m = path.match(re);
    if (!m) return jres({
      error: "That file does not belong to this link."
    }, 400);
    const ext = m[2];
    const isVideo = VIDEO_EXT.has(ext);
    const dir = path.slice(0, path.lastIndexOf("/"));
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    let obj: any;
    if (R2_ON) {
      const h = await r2c!.fetch(r2url(path), { method: "HEAD" });
      if (!h.ok) return jres({
        error: "The upload did not arrive. Please try that file again."
      }, 404);
      obj = { metadata: { size: Number(h.headers.get("content-length") ?? 0), mimetype: h.headers.get("content-type") ?? "" } };
    } else {
      const { data: found } = await admin.storage.from(BUCKET).list(dir, {
        limit: 5,
        search: fileName
      });
      obj = (found ?? []).find((o)=>o.name === fileName);
      if (!obj) return jres({
        error: "The upload did not arrive. Please try that file again."
      }, 404);
    }
    const size = Number(obj.metadata?.size ?? 0);
    const mime = String(obj.metadata?.mimetype ?? "").toLowerCase();
    const cap = isVideo ? VIDEO_MAX : IMAGE_MAX;
    if (!size || size > cap || mime && !EXT_BY_MIME[mime]) {
      await rmFile(path);
      return jres({
        error: size > cap ? `That file is too big. The limit is ${cap / 1048576} MB for ${isVideo ? "videos" : "images"}.` : "That file type is not allowed. It was removed."
      }, 400);
    }
    const publicUrl = R2_ON ? `${R2P}/${r2enc(path)}` : admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
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
        await rmFile(path);
        return jres({
          error: "Could not save the picture. Try again."
        }, 500);
      }
    } else {
      const { error } = await admin.from("creative_assets").insert({
        company_id: l.company_id,
        file_name: name,
        storage_path: path,
        storage_provider: R2_ON ? "r2" : "supabase",
        public_url: publicUrl,
        asset_type: isVideo ? "video" : "image",
        product_id: product.id,
        uploaded_by: "upload_link",
        test_status: "untested",
        uploaded_at: new Date().toISOString()
      });
      if (error) {
        await rmFile(path);
        return jres({
          error: "Could not save the file. Try again."
        }, 500);
      }
    }
    await admin.from("upload_links").update({
      files_added: Number(l.files_added) + 1
    }).eq("id", l.id);
    // Phone videos (.mov, HEVC) do not play in Chrome: have the converter make an .mp4 in the background (it can only touch this one file).
    if (isVideo && l.purpose !== "website") {
      try {
        const [{ data: sec }, { data: arow }] = await Promise.all([
          admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle(),
          admin.from("creative_assets").select("id").eq("company_id", l.company_id).eq("public_url", publicUrl).limit(1).maybeSingle()
        ]);
        if (sec?.value && arow?.id) {
          const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(sec.value)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
          const sig = await crypto.subtle.sign("HMAC", km, new TextEncoder().encode(`transcode:${arow.id}`));
          const ticket = [...new Uint8Array(sig)].map((x)=>x.toString(16).padStart(2, "0")).join("");
          // @ts-ignore EdgeRuntime is provided by Supabase
          EdgeRuntime.waitUntil(fetch(`${SITE}/api/transcode`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset_id: arow.id, ticket }) }).catch(()=>{}));
        }
      } catch (_e) { /* the original file is kept */ }
    }
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
  // Zip links: the page uploaded the .zip, now Revora reads it and builds the site as files (a draft). Nothing goes live here.
  if (act === "upload_import" || act === "upload_publish") {
    if (l.purpose !== "zip") return jres({
      error: "This link is not for a website zip."
    }, 400);
    const { data: prof } = await admin.from("profiles").select("role").eq("id", l.user_id).maybeSingle();
    const role = String(prof?.role ?? "");
    if (![
      "owner",
      "admin",
      "buyer"
    ].includes(role)) return jres({
      error: "Only owners, admins and media buyers can import websites."
    }, 403);
    if (act === "upload_import") {
      if (remaining < 1) return jres({
        error: "This link was already used. Ask your assistant for a new one."
      }, 429);
      const zpath = String(b?.path ?? "");
      if (!new RegExp(`^site-zips/${l.company_id}/[0-9a-f-]{36}\\.zip$`).test(zpath)) return jres({
        error: "That file does not belong to this link."
      }, 400);
      const zdir = zpath.slice(0, zpath.lastIndexOf("/")), zfile = zpath.slice(zpath.lastIndexOf("/") + 1);
      const { data: zfound } = await admin.storage.from(BUCKET).list(zdir, {
        limit: 5,
        search: zfile
      });
      const zobj = (zfound ?? []).find((o)=>o.name === zfile);
      if (!zobj) return jres({
        error: "The upload did not arrive. Please choose the file again."
      }, 404);
      const zsize = Number(zobj.metadata?.size ?? 0);
      if (!zsize || zsize > ZIP_MAX) {
        await admin.storage.from(BUCKET).remove([
          zpath
        ]);
        return jres({
          error: `That zip is too big. The limit is ${ZIP_MAX / 1048576} MB.`
        }, 400);
      }
      const zurl = admin.storage.from(BUCKET).getPublicUrl(zpath).data.publicUrl;
      const args = {
        zip_url: zurl,
        product_name: product.product_name
      };
      if (b?.pixel_mode === "keep" || b?.pixel_mode === "swap") args.pixel_mode = b.pixel_mode;
      const out = await codeCall("site_import_zip", args, l.user_id, l.company_id, role);
      if (out?.needs_decision) return jres({
        needs_decision: true,
        question: out.question,
        options: out.options,
        found_pixels: out.found_pixels,
        revora_pixel: out.revora_pixel
      });
      if (out?.error) return jres({
        error: String(out.error)
      }, 400);
      await admin.from("upload_links").update({
        files_added: Number(l.files_added) + 1
      }).eq("id", l.id);
      await admin.storage.from(BUCKET).remove([
        zpath
      ]);
      let images = undefined;
      if (b?.mirror_images === true && out?.site_id) {
        try {
          images = await mirrorImages(String(out.site_id), l.user_id, l.company_id, role);
        } catch  {
          images = {
            copied: 0,
            failed: -1
          };
        }
      }
      return jres({
        ok: true,
        ...out,
        product: product.product_name,
        ...images ? {
          images_copied: images
        } : {}
      });
    }
    const sid = String(b?.site_id ?? "");
    if (!UUID_RE.test(sid)) return jres({
      error: "Which website?"
    }, 400);
    const { data: st } = await admin.from("sites").select("id, product_id").eq("id", sid).eq("company_id", l.company_id).maybeSingle();
    if (!st || st.product_id !== l.product_id) return jres({
      error: "That website does not belong to this link."
    }, 403);
    const out2 = await codeCall("site_set_live", {
      site_id: sid,
      live: b?.live === true
    }, l.user_id, l.company_id, role);
    if (out2?.error) return jres({
      error: String(out2.error)
    }, 400);
    return jres({
      ok: true,
      ...out2
    });
  }
  return jres({
    error: "bad_action"
  }, 400);
}
// -- live edit links --
const MAX_HTML = 1_000_000;
const countOf = (s, re)=>(String(s).match(re) ?? []).length;
const RE_SCRIPT = /<script/gi, RE_ON = /\son[a-z]+\s*=/gi, RE_JS = /javascript:/gi;
const BODY_RE = /<body([^>]*)>([\s\S]*?)<\/body>/i;
const fileOf = (slug)=>slug === "" ? "index.html" : slug === "thank-you" ? "thanks.html" : `${slug}.html`;
const scriptsGrew = (html, old)=>countOf(html, RE_SCRIPT) > countOf(old, RE_SCRIPT) || countOf(html, RE_ON) > countOf(old, RE_ON) || countOf(html, RE_JS) > countOf(old, RE_JS);
async function loadEdit(token) {
  const t = String(token ?? "");
  const bad = {
    error: "This edit link is not valid. Ask your assistant for a new one.",
    status: 403
  };
  if (!/^[0-9a-f]{32}$/.test(t)) return bad;
  const { data: l } = await admin.from("edit_links").select("*").eq("secret_hash", await sha256hex(t)).maybeSingle();
  if (!l) return bad;
  if (new Date(l.expires_at).getTime() < Date.now()) return {
    error: "This edit link has expired. Ask your assistant for a new one.",
    status: 410
  };
  return {
    l
  };
}
async function publicEdit(b) {
  const L = await loadEdit(b?.token);
  if (L.error) return jres({
    error: L.error
  }, L.status ?? 403);
  const l = L.l;
  const act = String(b?.action ?? "");
  const { data: site } = await admin.from("sites").select("id, name, slug, status, product_id, media_buyer_id, settings").eq("id", l.site_id).eq("company_id", l.company_id).maybeSingle();
  if (!site) return jres({
    error: "The website for this link no longer exists."
  }, 404);
  const filesMode = site.settings?.storage === "files";
  const findPage = async (slug)=>{
    const { data } = await admin.from("site_pages").select("id, slug, title, kind, html, css, project, seo, updated_at").eq("site_id", l.site_id).eq("company_id", l.company_id).eq("slug", slug).limit(1);
    return (data ?? [])[0] ?? null;
  };
  const stripDraft = (seo)=>{
    const { draft_html: _a, draft_saved_at: _b, draft_base_version: _c, ...rest } = seo ?? {};
    return rest;
  };
  const getFile = async (path)=>{
    const { data } = await admin.from("site_files").select("content, version").eq("site_id", l.site_id).eq("path", path).maybeSingle();
    return data;
  };
  // Files sites are written through mcp-code so the file, its history and the built page always agree with what the assistant sees.
  const code = async (tool, args)=>{
    const ctx = {
      token: "",
      userId: l.user_id,
      email: null,
      companyId: l.company_id,
      role: "admin",
      mediaBuyerId: null,
      displayName: "Live editor"
    };
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/mcp-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-key": SERVICE_KEY
        },
        body: JSON.stringify({
          action: "call",
          tool,
          args,
          ctx
        })
      });
      const j = await r.json().catch(()=>null);
      return j?.out ?? {
        error: "The page builder did not answer. Try again."
      };
    } catch  {
      return {
        error: "The page builder did not answer. Try again."
      };
    }
  };
  const clearDraft = async (slug)=>{
    const cur = await findPage(slug);
    if (cur && cur.seo && "draft_html" in cur.seo) await admin.from("site_pages").update({
      seo: stripDraft(cur.seo)
    }).eq("id", cur.id);
  };
  if (act === "edit_load") {
    const { data: all } = await admin.from("site_pages").select("id, slug, title, kind").eq("site_id", l.site_id).eq("company_id", l.company_id).order("created_at");
    const pages = all ?? [];
    if (!pages.length) return jres({
      error: "This website has no pages yet."
    }, 404);
    const want = typeof b?.page === "string" ? b.page : l.page_slug || null;
    const pick = (want !== null ? pages.find((p)=>p.slug === want) : null) ?? pages.find((p)=>p.kind === "page") ?? pages[0];
    const full = await findPage(pick.slug);
    if (!full) return jres({
      error: "Could not open that page."
    }, 404);
    const seo = full.seo ?? {};
    const hasDraft = typeof seo.draft_html === "string" && seo.draft_html.length > 0;
    let html = hasDraft ? seo.draft_html : full.html ?? "";
    let mode = "pages", baseVersion = null, canUndo = !!seo.previous_version?.html;
    if (filesMode) {
      const f = await getFile(fileOf(full.slug));
      const m = f ? String(f.content).match(BODY_RE) : null;
      if (!f || !m) return jres({
        error: "This page's file cannot be opened for editing from a link. Ask your assistant to change it."
      }, 422);
      mode = "files";
      html = hasDraft ? seo.draft_html : m[2];
      baseVersion = hasDraft && Number.isFinite(Number(seo.draft_base_version)) ? Number(seo.draft_base_version) : f.version;
      canUndo = f.version > 1;
    }
    return jres({
      site: {
        name: site.name,
        slug: site.slug,
        status: site.status
      },
      pages: pages.map((p)=>({
          slug: p.slug,
          title: p.title,
          kind: p.kind
        })),
      page: {
        slug: full.slug,
        title: full.title,
        kind: full.kind,
        html,
        css: full.css ?? "",
        mode,
        base_version: baseVersion,
        from_builder: filesMode ? false : !!full.project,
        has_draft: hasDraft,
        can_undo: canUndo,
        updated_at: full.updated_at,
        seo: {
          head_html: seo.head_html ?? "",
          body_class: seo.body_class ?? "",
          body_style: seo.body_style ?? "",
          fonts_url: seo.fonts_url ?? ""
        }
      },
      expires_at: l.expires_at,
      key: ANON_KEY
    });
  }
  if (act === "edit_save") {
    const slug = typeof b?.page === "string" ? b.page : null;
    const html = typeof b?.html === "string" ? b.html : null;
    const isDraft = b?.draft === true;
    if (slug === null || html === null) return jres({
      error: "Nothing to save."
    }, 400);
    if (html.length > MAX_HTML) return jres({
      error: "This page is too big to save (over 1 MB)."
    }, 413);
    if (html.trim().length < 20) return jres({
      error: "The page looks empty. Not saved."
    }, 400);
    const row = await findPage(slug);
    if (!row) return jres({
      error: "That page no longer exists."
    }, 404);
    const seo = row.seo ?? {};
    const now = new Date().toISOString();
    if (filesMode) {
      if (/<\/body/i.test(html)) return jres({
        error: "The page contains a stray closing body tag. Not saved."
      }, 400);
      const path = fileOf(slug);
      const f = await getFile(path);
      const m = f ? String(f.content).match(BODY_RE) : null;
      if (!f || !m) return jres({
        error: "That page's file could not be found."
      }, 404);
      if (scriptsGrew(html, m[2])) return jres({
        error: "Edits from this link cannot add scripts or code. Not saved."
      }, 400);
      const bv = Number(b?.base_version);
      if (isDraft) {
        const { error } = await admin.from("site_pages").update({
          seo: {
            ...seo,
            draft_html: html,
            draft_saved_at: now,
            draft_base_version: Number.isFinite(bv) && bv > 0 ? bv : f.version
          }
        }).eq("id", row.id);
        if (error) return jres({
          error: "Could not save the draft. Try again."
        }, 500);
        return jres({
          ok: true,
          draft: true
        });
      }
      if (!Number.isFinite(bv) || bv !== f.version) return jres({
        error: "This page was changed somewhere else (for example by your assistant) since you opened it. Reload the link, then edit again.",
        conflict: true
      }, 409);
      const next = f.content.replace(BODY_RE, (_x, attrs)=>`<body${attrs}>${html}</body>`);
      const out = await code("site_write_file", {
        site_id: l.site_id,
        path,
        content: next,
        if_version: f.version
      });
      if (out?.error) {
        const conflict = /conflict|changed by someone/i.test(String(out.error));
        return jres({
          error: String(out.error),
          conflict
        }, conflict ? 409 : 400);
      }
      await clearDraft(slug);
      const cur = await findPage(slug);
      return jres({
        ok: true,
        version: out?.version ?? f.version + 1,
        can_undo: true,
        updated_at: cur?.updated_at ?? now
      });
    }
    if (b?.base_updated_at && row.updated_at && new Date(b.base_updated_at).getTime() !== new Date(row.updated_at).getTime()) return jres({
      error: "This page was changed somewhere else since you opened it. Reload the link, then edit again.",
      conflict: true
    }, 409);
    const old = String(row.html ?? "");
    if (scriptsGrew(html, old)) return jres({
      error: "Edits from this link cannot add scripts or code. Not saved."
    }, 400);
    if (isDraft) {
      // A draft is kept beside the live page and is never shown to visitors. updated_at is left alone.
      const { error } = await admin.from("site_pages").update({
        seo: {
          ...seo,
          draft_html: html,
          draft_saved_at: now
        }
      }).eq("id", row.id);
      if (error) return jres({
        error: "Could not save the draft. Try again."
      }, 500);
      return jres({
        ok: true,
        draft: true
      });
    }
    const next = {
      ...stripDraft(seo),
      custom_html: true,
      previous_version: {
        html: row.html,
        css: row.css,
        project: row.project ?? null,
        was_custom_html: !!seo.custom_html,
        saved_at: now
      }
    };
    const { data: upd, error } = await admin.from("site_pages").update({
      html,
      project: null,
      seo: next,
      updated_at: now
    }).eq("id", row.id).select("updated_at").limit(1);
    if (error) return jres({
      error: "Could not save. Try again."
    }, 500);
    return jres({
      ok: true,
      updated_at: (upd ?? [])[0]?.updated_at ?? now,
      can_undo: true
    });
  }
  if (act === "edit_discard_draft") {
    const slug = typeof b?.page === "string" ? b.page : null;
    if (slug === null) return jres({
      error: "Which page?"
    }, 400);
    const row = await findPage(slug);
    if (!row) return jres({
      error: "That page no longer exists."
    }, 404);
    const { error } = await admin.from("site_pages").update({
      seo: stripDraft(row.seo)
    }).eq("id", row.id);
    if (error) return jres({
      error: "Could not discard the draft. Try again."
    }, 500);
    return jres({
      ok: true
    });
  }
  if (act === "edit_undo") {
    const slug = typeof b?.page === "string" ? b.page : null;
    if (slug === null) return jres({
      error: "Which page?"
    }, 400);
    const row = await findPage(slug);
    if (!row) return jres({
      error: "That page no longer exists."
    }, 404);
    const seo = row.seo ?? {};
    if (filesMode) {
      const path = fileOf(slug);
      const f = await getFile(path);
      if (!f || f.version <= 1) return jres({
        error: "There is no earlier version to go back to."
      }, 404);
      const { data: prev } = await admin.from("site_file_versions").select("version").eq("site_id", l.site_id).eq("path", path).lt("version", f.version).order("version", {
        ascending: false
      }).limit(1);
      const target = (prev ?? [])[0]?.version;
      if (!target) return jres({
        error: "There is no earlier version to go back to."
      }, 404);
      const out = await code("site_rollback", {
        site_id: l.site_id,
        path,
        version: target
      });
      if (out?.error) return jres({
        error: String(out.error)
      }, 400);
      await clearDraft(slug);
      const cur = await findPage(slug);
      return jres({
        ok: true,
        updated_at: cur?.updated_at ?? new Date().toISOString()
      });
    }
    const prev = seo.previous_version;
    if (!prev?.html) return jres({
      error: "There is no earlier version to go back to."
    }, 404);
    const now = new Date().toISOString();
    const next = {
      ...stripDraft(seo),
      custom_html: !!prev.was_custom_html,
      previous_version: {
        html: row.html,
        css: row.css,
        project: row.project ?? null,
        was_custom_html: !!seo.custom_html,
        saved_at: now
      }
    };
    const { data: upd, error } = await admin.from("site_pages").update({
      html: prev.html,
      css: prev.css ?? row.css,
      project: prev.project ?? null,
      seo: next,
      updated_at: now
    }).eq("id", row.id).select("updated_at").limit(1);
    if (error) return jres({
      error: "Could not go back. Try again."
    }, 500);
    return jres({
      ok: true,
      updated_at: (upd ?? [])[0]?.updated_at ?? now
    });
  }
  if (act === "edit_upload_sign") {
    const ext = extOf(String(b?.name ?? ""), String(b?.content_type ?? ""));
    if (!ext || VIDEO_EXT.has(ext)) return jres({
      error: "Only png, jpg or webp pictures can be used here."
    }, 400);
    const size = Number(b?.size);
    if (!Number.isFinite(size) || size <= 0) return jres({
      error: "Could not read the file size."
    }, 400);
    if (size > IMAGE_MAX) return jres({
      error: `That picture is too big. The limit is ${IMAGE_MAX / 1048576} MB.`
    }, 413);
    const path = `site-images/${l.company_id}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) return jres({
      error: "Could not prepare the upload. Try again."
    }, 500);
    return jres({
      path,
      upload_url: `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}?token=${encodeURIComponent(data.token)}`,
      key: ANON_KEY
    });
  }
  if (act === "edit_upload_finish") {
    const path = String(b?.path ?? "");
    const m = path.match(new RegExp(`^site-images/${l.company_id}/([0-9a-f-]{36})\\.(png|jpg|webp)$`));
    if (!m) return jres({
      error: "That file does not belong to this link."
    }, 400);
    const dir = path.slice(0, path.lastIndexOf("/"));
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const { data: found } = await admin.storage.from(BUCKET).list(dir, {
      limit: 5,
      search: fileName
    });
    const obj = (found ?? []).find((o)=>o.name === fileName);
    if (!obj) return jres({
      error: "The upload did not arrive. Try again."
    }, 404);
    const size = Number(obj.metadata?.size ?? 0);
    const mime = String(obj.metadata?.mimetype ?? "").toLowerCase();
    if (!size || size > IMAGE_MAX || mime && !EXT_BY_MIME[mime]) {
      await admin.storage.from(BUCKET).remove([
        path
      ]);
      return jres({
        error: "That picture is too big or not allowed. It was removed."
      }, 400);
    }
    const url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    if (site.product_id) {
      const name = String(b?.name ?? "").replace(/[^\w .()\-]/g, "").trim().slice(0, 100) || `${site.name} page picture`;
      await admin.from("product_images").insert({
        company_id: l.company_id,
        product_id: site.product_id,
        media_buyer_id: site.media_buyer_id ?? null,
        name: /\.\w{2,5}$/.test(name) ? name : `${name}.${m[2]}`,
        url,
        storage_path: path,
        kind: "image",
        purpose: "website",
        created_by: l.user_id
      });
    }
    return jres({
      ok: true,
      url
    });
  }
  return jres({
    error: "bad_action"
  }, 400);
}
// -- campaign edit links: edit a DRAFT plan --
// ai_plans.plan: copies[{primary_text, headline, description}], ads[{asset_id, copy_index}] (the master list),
// adsets[{label, budget_naira, age_min, age_max, gender, states, placements, ..., ad_numbers:[1-based positions in the master list]}], asset_ids[].
// Same shape the mcp-plan tools use, with the same limits.
const PLAN_HOURS = 24, MAX_COPIES = 8, MAX_SET_ADS = 12, MAX_PLAN_ADS = 12;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const PLACEMENT_KEYS = [
  "fb_feed",
  "fb_reels",
  "fb_stories",
  "fb_marketplace",
  "fb_search",
  "fb_profile",
  "ig_feed",
  "ig_reels",
  "ig_stories",
  "ig_explore",
  "ig_profile",
  "threads",
  "wa_status",
  "an"
];
const clampN = (n, lo, hi)=>Math.min(Math.max(n, lo), hi);
const toPair = (x)=>({
    asset_id: String(x?.asset_id ?? "").trim(),
    copy_index: Math.round(Number(x?.copy_index) || 0)
  });
const planMaster = (plan)=>{
  const nCopies = Array.isArray(plan?.copies) ? plan.copies.length : 0;
  if (Array.isArray(plan?.ads) && plan.ads.length) return plan.ads.map(toPair);
  return (Array.isArray(plan?.asset_ids) ? plan.asset_ids : []).map((id, j)=>({
      asset_id: String(id),
      copy_index: nCopies ? j % nCopies : 0
    }));
};
const placementsOf = (s, plan)=>{
  const raw = Array.isArray(s?.placements) && s.placements.length ? s.placements : Array.isArray(plan?.placements) && plan.placements.length ? plan.placements : typeof s?.placements === "string" ? [
    s.placements
  ] : typeof plan?.placements === "string" ? [
    plan.placements
  ] : [
    "automatic"
  ];
  return raw.map(String);
};
const planSets = (plan)=>{
  const master = planMaster(plan);
  return (Array.isArray(plan?.adsets) ? plan.adsets : []).map((s, i)=>{
    const nums = Array.isArray(s?.ad_numbers) && s.ad_numbers.length ? s.ad_numbers.map(Number) : master.map((_, k)=>k + 1);
    return {
      settings: {
        label: String(s?.label ?? `Ad set ${i + 1}`),
        budget_naira: Number(s?.budget_naira) || 0,
        age_min: Number(s?.age_min) || 18,
        age_max: Number(s?.age_max) || 65,
        gender: s?.gender === "male" || s?.gender === "female" ? s.gender : "all",
        lifecycle: s?.lifecycle === "none" ? "none" : "broad",
        states: Array.isArray(s?.states) ? s.states.map(String) : [],
        placements: placementsOf(s, plan),
        cities: (Array.isArray(s?.cities) ? s.cities : []).map((x)=>String(x?.name ?? "")).filter(Boolean),
        interests: (Array.isArray(s?.interests) ? s.interests : []).map((x)=>String(x?.name ?? "")).filter(Boolean)
      },
      ads: nums.map((n)=>master[n - 1]).filter(Boolean)
    };
  });
};
const planHash = async (plan)=>sha256hex(JSON.stringify(plan ?? {}));
const lagosTime = (iso)=>iso ? new Date(iso).toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  }) + " (Nigeria time)" : null;
async function publicPlan(b) {
  const t = String(b?.token ?? "");
  const bad = {
    error: "This link is not valid. Ask your assistant for a new one."
  };
  if (!/^[0-9a-f]{32}$/.test(t)) return jres(bad, 403);
  const { data: l } = await admin.from("plan_edit_links").select("*").eq("secret_hash", await sha256hex(t)).maybeSingle();
  if (!l) return jres(bad, 403);
  if (new Date(l.expires_at).getTime() < Date.now()) return jres({
    error: "This link has expired. Ask your assistant for a new one."
  }, 410);
  const { data: row } = await admin.from("ai_plans").select("id, plan, status").eq("id", l.plan_id).eq("company_id", l.company_id).maybeSingle();
  if (!row?.plan) return jres({
    error: "This plan no longer exists."
  }, 404);
  const plan = row.plan;
  const act = String(b?.action ?? "");
  if (act === "plan_load") {
    const sets = planSets(plan);
    const master = planMaster(plan);
    const used = [
      ...new Set([
        ...master.map((m)=>m.asset_id),
        ...Array.isArray(plan.asset_ids) ? plan.asset_ids.map(String) : []
      ])
    ].filter((x)=>UUID_RE.test(x));
    const cols = "id, file_name, public_url, asset_type";
    const [{ data: a1 }, { data: a2 }, { data: opt }] = await Promise.all([
      used.length ? admin.from("creative_assets").select(cols).eq("company_id", l.company_id).in("id", used) : Promise.resolve({
        data: []
      }),
      plan.product_id ? admin.from("creative_assets").select(cols).eq("company_id", l.company_id).eq("product_id", plan.product_id).order("uploaded_at", {
        ascending: false
      }).limit(40) : Promise.resolve({
        data: []
      }),
      admin.from("ai_plan_options").select("start_time").eq("plan_id", row.id).maybeSingle()
    ]);
    const byId = new Map();
    for (const a of [
      ...a1 ?? [],
      ...a2 ?? []
    ])if (!byId.has(a.id)) byId.set(a.id, {
      id: a.id,
      name: a.file_name,
      url: a.public_url,
      type: a.asset_type
    });
    return jres({
      campaign: {
        name: plan.campaign_name ?? "Campaign",
        product: plan.product_name ?? "",
        status: row.status,
        objective: plan.objective ?? "",
        cta: plan.cta ?? "",
        budget_type: plan.budget_type ?? "",
        starts: lagosTime(opt?.start_time)
      },
      editable: row.status === "draft",
      copies: (Array.isArray(plan.copies) ? plan.copies : []).map((c)=>({
          primary_text: String(c?.primary_text ?? ""),
          headline: String(c?.headline ?? ""),
          description: String(c?.description ?? "")
        })),
      ad_sets: sets,
      assets: [
        ...byId.values()
      ],
      placement_keys: PLACEMENT_KEYS,
      base_hash: await planHash(plan),
      limits: {
        copies: MAX_COPIES,
        ads_per_set: MAX_SET_ADS,
        plan_ads: MAX_PLAN_ADS
      },
      expires_at: l.expires_at,
      key: ANON_KEY
    });
  }
  if (act === "plan_save") {
    if (row.status !== "draft") return jres({
      error: row.status === "launched" ? "This campaign is already launched, so it can no longer be edited from here." : "This plan can no longer be changed."
    }, 409);
    if (String(b?.base_hash ?? "") !== await planHash(plan)) return jres({
      error: "This plan was changed somewhere else (for example by your assistant) since you opened it. Reload the link, then edit again.",
      conflict: true
    }, 409);
    const rawCopies = Array.isArray(b?.copies) ? b.copies : [];
    if (!rawCopies.length || rawCopies.length > MAX_COPIES) return jres({
      error: `A plan needs between 1 and ${MAX_COPIES} copies.`
    }, 400);
    const copies = [];
    for(let i = 0; i < rawCopies.length; i++){
      const pt = String(rawCopies[i]?.primary_text ?? "").trim(), hl = String(rawCopies[i]?.headline ?? "").trim(), ds = String(rawCopies[i]?.description ?? "").trim();
      if (!pt) return jres({
        error: `Copy ${i + 1} has no main text. Fill it in or remove that copy.`
      }, 400);
      if (pt.length > 2200) return jres({
        error: `Copy ${i + 1}: the main text is over 2,200 characters.`
      }, 400);
      if (hl.length > 255 || ds.length > 255) return jres({
        error: `Copy ${i + 1}: the headline and description must each be under 255 characters.`
      }, 400);
      copies.push({
        ...plan.copies?.[i] ?? {},
        primary_text: pt,
        headline: hl,
        description: ds
      });
    }
    const oldSets = Array.isArray(plan.adsets) ? plan.adsets : [];
    const rawSets = Array.isArray(b?.ad_sets) ? b.ad_sets : [];
    if (rawSets.length !== oldSets.length) return jres({
      error: "The ad sets do not match this plan. Reload the link."
    }, 400);
    const allowed = new Set([
      ...planMaster(plan).map((m)=>m.asset_id),
      ...Array.isArray(plan.asset_ids) ? plan.asset_ids.map(String) : []
    ]);
    const wanted = new Set();
    for (const s of rawSets)for (const a of Array.isArray(s?.ads) ? s.ads : []){
      const id = String(a?.asset_id ?? "").trim();
      if (!allowed.has(id)) wanted.add(id);
    }
    if (wanted.size) {
      const ids = [
        ...wanted
      ];
      if (ids.some((x)=>!UUID_RE.test(x))) return jres({
        error: "One of the pictures is not allowed in this plan."
      }, 400);
      let q = admin.from("creative_assets").select("id").eq("company_id", l.company_id).in("id", ids);
      if (plan.product_id) q = q.eq("product_id", plan.product_id);
      const { data: ok } = await q;
      if ((ok ?? []).length !== ids.length) return jres({
        error: "One of the pictures does not belong to this product."
      }, 400);
    }
    // Ad set settings (same rules as the assistant's add_ad_set / update_plan).
    const patches = [];
    for(let i = 0; i < rawSets.length; i++){
      const sv = rawSets[i]?.settings && typeof rawSets[i].settings === "object" ? rawSets[i].settings : {};
      const who = `Ad set ${i + 1}: `;
      const p = {};
      if (sv.label !== undefined) {
        const label = String(sv.label).trim().slice(0, 40);
        if (!label) return jres({
          error: who + "give it a name."
        }, 400);
        p.label = label;
      }
      if (sv.budget_naira !== undefined) {
        const bn = Math.round(Number(sv.budget_naira));
        if (!(bn >= 1500)) return jres({
          error: who + "the daily budget must be at least ₦1,500."
        }, 400);
        p.budget_naira = clampN(bn, 1500, 5e5);
      }
      const amin = sv.age_min !== undefined ? clampN(Math.round(Number(sv.age_min)) || 18, 18, 65) : Number(oldSets[i]?.age_min) || 18;
      const amax = sv.age_max !== undefined ? clampN(Math.round(Number(sv.age_max)) || 65, 18, 65) : Number(oldSets[i]?.age_max) || 65;
      if (amin > amax) return jres({
        error: who + "the first age cannot be above the second."
      }, 400);
      if (sv.age_min !== undefined) p.age_min = amin;
      if (sv.age_max !== undefined) p.age_max = amax;
      if ([
        "all",
        "male",
        "female"
      ].includes(sv.gender)) p.gender = sv.gender;
      if ([
        "broad",
        "none"
      ].includes(sv.lifecycle)) p.lifecycle = sv.lifecycle;
      if (Array.isArray(sv.states)) p.states = sv.states.map((x)=>String(x).replace(/ state$/i, "").trim()).filter(Boolean).slice(0, 12);
      if (Array.isArray(sv.placements)) {
        const asked = [
          ...new Set(sv.placements.map((x)=>String(x).trim().toLowerCase()).filter(Boolean))
        ];
        if (asked.includes("automatic") && asked.length > 1) return jres({
          error: who + "Automatic cannot be combined with other placements."
        }, 400);
        const badP = asked.filter((k)=>k !== "automatic" && !PLACEMENT_KEYS.includes(k));
        if (badP.length) return jres({
          error: who + `these placements are not valid: ${badP.join(", ")}.`
        }, 400);
        if (asked.length) p.placements = asked;
      }
      patches.push(p);
    }
    const master = [];
    const nums = [];
    for(let i = 0; i < rawSets.length; i++){
      const list = Array.isArray(rawSets[i]?.ads) ? rawSets[i].ads : [];
      if (!list.length) return jres({
        error: `${patches[i]?.label ?? oldSets[i]?.label ?? "Ad set " + (i + 1)} has no ads. Keep at least one ad in every ad set.`
      }, 400);
      if (list.length > MAX_SET_ADS) return jres({
        error: `An ad set holds at most ${MAX_SET_ADS} ads.`
      }, 400);
      const mine = [];
      for (const raw of list){
        const pr = toPair(raw);
        if (pr.copy_index < 0 || pr.copy_index >= copies.length) return jres({
          error: "An ad uses a copy that does not exist."
        }, 400);
        let k = master.findIndex((m)=>m.asset_id === pr.asset_id && m.copy_index === pr.copy_index);
        if (k < 0) {
          master.push(pr);
          k = master.length - 1;
        }
        if (!mine.includes(k + 1)) mine.push(k + 1);
      }
      nums.push(mine);
    }
    if (master.length > MAX_PLAN_ADS) return jres({
      error: `A plan holds at most ${MAX_PLAN_ADS} different ads (picture + copy). Reuse a copy or picture.`
    }, 400);
    const nextSets = oldSets.map((s, i)=>{
      const { ads: _x, ...rest } = s ?? {};
      return {
        ...rest,
        ...patches[i],
        ad_numbers: nums[i]
      };
    });
    for(let i = 0; i < nextSets.length; i++)if (`${plan.product_name ?? ""} · ${nextSets[i].label ?? ""} · Ad ${master.length}`.length > 120) return jres({
      error: `Ad set ${i + 1}: that name is too long with the product name. Use a shorter one.`
    }, 400);
    const next = {
      ...plan,
      copies,
      ads: master,
      asset_ids: [
        ...new Set([
          ...master.map((m)=>m.asset_id),
          ...Array.isArray(plan.asset_ids) ? plan.asset_ids.map(String) : []
        ])
      ],
      adsets: nextSets
    };
    if (typeof b?.campaign_name === "string") {
      const cn = b.campaign_name.trim().slice(0, 80);
      if (cn) next.campaign_name = cn;
    }
    const { data: upd, error } = await admin.from("ai_plans").update({
      plan: next
    }).eq("id", row.id).eq("status", "draft").select("id").limit(1);
    if (error || !(upd ?? []).length) return jres({
      error: "Could not save. Try again."
    }, 500);
    return jres({
      ok: true,
      base_hash: await planHash(next),
      total_ads: master.length
    });
  }
  if (act === "plan_upload_sign") {
    if (row.status !== "draft") return jres({
      error: "This plan can no longer be changed."
    }, 409);
    const ext = extOf(String(b?.name ?? ""), String(b?.content_type ?? ""));
    if (!ext) return jres({
      error: "Only png, jpg, webp images and mp4, mov, webm videos can be uploaded."
    }, 400);
    const size = Number(b?.size);
    if (!Number.isFinite(size) || size <= 0) return jres({
      error: "Could not read the file size."
    }, 400);
    const cap = VIDEO_EXT.has(ext) ? VIDEO_MAX : IMAGE_MAX;
    if (size > cap) return jres({
      error: `That file is too big. The limit is ${cap / 1048576} MB.`
    }, 413);
    const path = `ai-import/${l.company_id}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) return jres({
      error: "Could not prepare the upload. Try again."
    }, 500);
    return jres({
      path,
      upload_url: `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}?token=${encodeURIComponent(data.token)}`,
      key: ANON_KEY
    });
  }
  if (act === "plan_upload_finish") {
    const path = String(b?.path ?? "");
    const m = path.match(new RegExp(`^ai-import/${l.company_id}/([0-9a-f-]{36})\\.(png|jpg|webp|mp4|mov|webm)$`));
    if (!m) return jres({
      error: "That file does not belong to this link."
    }, 400);
    const isVideo = VIDEO_EXT.has(m[2]);
    const dir = path.slice(0, path.lastIndexOf("/"));
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const { data: found } = await admin.storage.from(BUCKET).list(dir, {
      limit: 5,
      search: fileName
    });
    const obj = (found ?? []).find((o)=>o.name === fileName);
    if (!obj) return jres({
      error: "The upload did not arrive. Try again."
    }, 404);
    const size = Number(obj.metadata?.size ?? 0);
    const mime = String(obj.metadata?.mimetype ?? "").toLowerCase();
    const cap = isVideo ? VIDEO_MAX : IMAGE_MAX;
    if (!size || size > cap || mime && !EXT_BY_MIME[mime]) {
      await admin.storage.from(BUCKET).remove([
        path
      ]);
      return jres({
        error: "That file is too big or not allowed. It was removed."
      }, 400);
    }
    const url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const { data: have } = await admin.from("creative_assets").select("id, file_name, public_url, asset_type").eq("company_id", l.company_id).eq("public_url", url).limit(1);
    if (have?.length) return jres({
      ok: true,
      asset: {
        id: have[0].id,
        name: have[0].file_name,
        url: have[0].public_url,
        type: have[0].asset_type
      }
    });
    const original = String(b?.name ?? "").replace(/[^\w .()\-]/g, "").trim().slice(0, 100) || `${plan.product_name ?? "Ad"} ${isVideo ? "video" : "image"} ${new Date().toISOString().slice(0, 10)}`;
    const name = /\.\w{2,5}$/.test(original) ? original : `${original}.${m[2]}`;
    const { data: ins, error } = await admin.from("creative_assets").insert({
      company_id: l.company_id,
      file_name: name,
      storage_path: path,
      public_url: url,
      asset_type: isVideo ? "video" : "image",
      product_id: plan.product_id ?? null,
      uploaded_by: "upload_link",
      test_status: "untested",
      uploaded_at: new Date().toISOString()
    }).select("id").limit(1);
    if (error || !(ins ?? []).length) {
      await admin.storage.from(BUCKET).remove([
        path
      ]);
      return jres({
        error: "Could not save the file. Try again."
      }, 500);
    }
    return jres({
      ok: true,
      asset: {
        id: ins[0].id,
        name,
        url,
        type: isVideo ? "video" : "image"
      }
    });
  }
  return jres({
    error: "bad_action"
  }, 400);
}
const TOOLS = [
  {
    name: "get_upload_link",
    title: "Get a link to upload pictures, videos or a website zip",
    description: "Make a private, short-lived web link where the person can upload pictures or videos from their phone or computer, and they are saved straight to a product. Use it when the person wants to add files and you cannot receive the file yourself (you are in an app that cannot pass files, import_media failed, or the file is a big video), or whenever they ask for an upload link. purpose ads = ad creatives (images and videos, up to 20 MB per image and 50 MB per video). purpose website = pictures for that product's sales page (images only). purpose zip = a finished website as one .zip file (up to 50 MB) OR a WordPress Elementor template (.json): the person opens the link, chooses the file, and Revora imports it as an editable file-based site (a DRAFT, nothing goes live) and shows its test link and thank-you link. An Elementor .json is converted to clean HTML first and its outside pictures are copied into Revora; the WordPress order form cannot run outside WordPress, so a marked spot is left for the person's own form or iframe. Give the person the link and tell them to open it, choose the files and wait for the green ticks. The link works for 60 minutes and takes up to max_files files (a zip link takes one). When they say they are done, call list_ad_creatives (ads), list_site_images (website) or site_list_files (zip) to confirm and show what arrived. The files are saved straight away, linked to the product, with no preview step.",
    inputSchema: OBJ({
      product_name: str("The product the files belong to (required)"),
      purpose: {
        type: "string",
        enum: [
          "ads",
          "website",
          "zip"
        ],
        description: "ads = ad creatives (images or videos). website = pictures for the product's sales page (images only). zip = a finished website as a .zip file (up to 50 MB) or an Elementor .json template that Revora imports as an editable site; the person opens the link, picks the file and it is imported as a draft."
      },
      max_files: {
        type: "number",
        description: "How many files the link accepts, 1 to 20. Default 10."
      }
    }, [
      "product_name",
      "purpose"
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    write: true,
    run: async (a, c)=>{
      if (![
        "owner",
        "admin",
        "buyer"
      ].includes(c.role)) return {
        error: "Only owners, admins and media buyers can add pictures or videos."
      };
      const purpose = a?.purpose === "website" ? "website" : a?.purpose === "ads" ? "ads" : a?.purpose === "zip" ? "zip" : null;
      if (!purpose) return {
        error: "purpose must be ads, website or zip."
      };
      const { data: prods } = await admin.from("products").select("id, product_name, media_buyer_id").eq("company_id", c.companyId);
      const all = prods ?? [];
      const n = normName(a?.product_name);
      let m = all.filter((p)=>normName(p.product_name) === n);
      if (!m.length && n) m = all.filter((p)=>normName(p.product_name).includes(n));
      if (c.role === "buyer") {
        const mine = m.filter((p)=>p.media_buyer_id === c.mediaBuyerId);
        if (m.length && !mine.length) return {
          error: "A media buyer can only add files to their own products. Ask the owner."
        };
        m = mine;
      }
      const p = m[0];
      if (!p) return {
        error: `No product called "${a?.product_name}". Their products: ${[
          ...new Set(all.map((x)=>x.product_name))
        ].join(", ") || "none yet"}.`
      };
      const maxFiles = purpose === "zip" ? 1 : Math.min(Math.max(Math.round(Number(a?.max_files)) || 10, 1), 20);
      await admin.from("upload_links").delete().lt("expires_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
      const token = hexRand(16);
      const expires = new Date(Date.now() + LINK_MINUTES * 60 * 1000).toISOString();
      const { error } = await admin.from("upload_links").insert({
        secret_hash: await sha256hex(token),
        company_id: c.companyId,
        user_id: c.userId,
        product_id: p.id,
        purpose,
        max_files: maxFiles,
        expires_at: expires
      });
      if (error) return {
        error: "Could not make the link. Try again."
      };
      if (purpose === "zip") return {
        ok: true,
        upload_link: `${SITE}/zip.html?t=${token}`,
        product: p.product_name,
        purpose,
        valid_for_minutes: LINK_MINUTES,
        accepts: "one .zip file (up to 50 MB) or one Elementor .json template",
        next: `Give the person this link now: open it, choose the website .zip or the Elementor .json and wait for the import to finish. It works for ${LINK_MINUTES} minutes. The site is created as a DRAFT for ${p.product_name} and the page shows its test link and thank-you link; nothing goes live until the person taps Publish there or says yes to you. If the page already has a different Meta pixel the person is asked whether to keep it or swap it. For an Elementor .json the form is a marked placeholder (data-form-placeholder) to fill with the person's own iframe or form. Afterwards you can read and edit the site with site_list_files and the other site tools.`
      };
      return {
        ok: true,
        upload_link: `${SITE}/upload.html?t=${token}`,
        product: p.product_name,
        purpose,
        valid_for_minutes: LINK_MINUTES,
        max_files: maxFiles,
        accepts: purpose === "website" ? "png, jpg, webp images, up to 20 MB each" : "png, jpg, webp images (up to 20 MB) and mp4, mov, webm videos (up to 50 MB)",
        next: `Give the person this link now: open it, choose the files, wait for the green ticks. It works for ${LINK_MINUTES} minutes and keeps them private to this product. When they say they are done, call ${purpose === "website" ? "list_site_images" : "list_ad_creatives"} for ${p.product_name} and show what arrived. Files are saved straight away and linked to ${p.product_name}.`
      };
    }
  },
  {
    name: "get_edit_link",
    title: "Get a link to edit a live website directly",
    description: "Make a private web link (works 24 hours, no login) that opens the person's real website as a live page they can edit by themselves: double-click or tap any text to retype it, change text colour, background colour, text size, pictures, background pictures and button links, add a new section by pasting HTML, then press Save draft (kept private) or Publish live (goes live at once, with a backup and an Undo button). Use it when the person wants to fix wording, change a headline, swap a picture, change colours or add a section on their sales page or website and would rather do it themselves, or whenever they ask for an edit link. This is NOT the visual builder: do not use the builder link for this. Anyone holding the link can edit that one website until it expires, so give it only to the person. Choose the website with site_name (the website's name or its product's name). page is optional: the page's slug, default the main page. The person's published edits are saved into the site's own files/HTML, so you will see them the next time you read the page: always read the page again (get_sales_page with include_html, or site_read_file) before you change it.",
    inputSchema: OBJ({
      site_name: str("The website's name or its product's name"),
      page: str("Optional: the slug of the page to open first. Default the main page.")
    }, [
      "site_name"
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    write: true,
    run: async (a, c)=>{
      if (![
        "owner",
        "admin",
        "buyer"
      ].includes(c.role)) return {
        error: "Only owners, admins and media buyers can edit websites."
      };
      const [{ data: sitesRaw }, { data: prods }] = await Promise.all([
        admin.from("sites").select("id, name, slug, status, product_id, media_buyer_id").eq("company_id", c.companyId),
        admin.from("products").select("id, product_name").eq("company_id", c.companyId)
      ]);
      const pname = new Map((prods ?? []).map((p)=>[
          p.id,
          p.product_name
        ]));
      let sites = sitesRaw ?? [];
      if (c.role === "buyer") sites = sites.filter((s)=>s.media_buyer_id === c.mediaBuyerId);
      const n = normName(a?.site_name);
      if (!n) return {
        error: "Which website? Give its name."
      };
      const names = (s)=>[
          normName(s.name),
          normName(s.slug),
          normName(pname.get(s.product_id) ?? "")
        ].filter(Boolean);
      let m = sites.filter((s)=>names(s).includes(n));
      if (!m.length) m = sites.filter((s)=>names(s).some((x)=>x.includes(n) || n.includes(x)));
      if (m.length > 1) return {
        error: `More than one website matches. Which one? ${m.map((s)=>s.name).join(", ")}.`
      };
      const s = m[0];
      if (!s) return {
        error: `No website called "${a?.site_name}". Their websites: ${sites.map((x)=>x.name).join(", ") || "none yet"}.`
      };
      await admin.from("edit_links").delete().lt("expires_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
      const token = hexRand(16);
      const expires = new Date(Date.now() + EDIT_HOURS * 3600 * 1000).toISOString();
      const { error } = await admin.from("edit_links").insert({
        secret_hash: await sha256hex(token),
        company_id: c.companyId,
        user_id: c.userId,
        site_id: s.id,
        page_slug: typeof a?.page === "string" ? a.page : "",
        expires_at: expires
      });
      if (error) return {
        error: "Could not make the link. Try again."
      };
      return {
        ok: true,
        edit_link: `${SITE}/edit.html?t=${token}`,
        website: s.name,
        valid_for_hours: EDIT_HOURS,
        next: `Give the person this link now. It opens ${s.name} as a live page: tap any words to select them, then Edit text; use the bar to change colours, size, pictures and links; use Add section to paste HTML. Save draft keeps changes private; Publish live goes live at once, with a backup and an Undo button. Anyone with the link can edit until it expires in ${EDIT_HOURS} hours, so keep it private. The person's published edits are saved into the site itself: before you change this page later, read its latest version again so their edits are kept.`
      };
    }
  },
  {
    name: "get_ad_copy_link",
    title: "Get a link to edit a draft campaign: ad sets, copy, headlines and pictures",
    description: "Make a private web link (works 24 hours, no login) where the person opens a DRAFT campaign plan on their phone and edits it by themselves: campaign name, every ad set's settings (name, daily budget, ages, gender, states, placements), the ad copy (main text, headline, description, several copies), which copy and which picture or video each ad uses (one copy can be applied to several ads at once), and uploading new pictures or videos. Use it after plan_campaign when the person wants to write or change copy, headlines, pictures or ad set settings themselves, or whenever they ask for a link to edit or add to a campaign. The plan must still be a draft: nothing is sent to Meta by this link, and launching stays a separate step that needs the person's clear yes (the WhatsApp Launch button or the launch card). Choose the plan with plan_id (from plan_campaign or list_plans) or campaign_name; with neither, the person's latest draft is used. Anyone holding the link can edit that one plan until it expires, so give it only to the person. Their saved changes live in the plan itself: ALWAYS call get_plan again before you change the draft or launch it, so their edits are kept.",
    inputSchema: OBJ({
      plan_id: str("Draft plan id from plan_campaign or list_plans"),
      campaign_name: str("Or the campaign's name, if you do not have the id")
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    write: true,
    run: async (a, c)=>{
      if (![
        "owner",
        "admin",
        "buyer"
      ].includes(c.role)) return {
        error: "Only owners, admins and media buyers can edit campaign plans."
      };
      const isAdm = c.role === "owner" || c.role === "admin";
      let q = admin.from("ai_plans").select("id, status, created_at, user_id, plan").eq("company_id", c.companyId).order("created_at", {
        ascending: false
      }).limit(40);
      if (!isAdm) q = q.eq("user_id", c.userId);
      const { data } = await q;
      const plans = (data ?? []).filter((p)=>p.status !== "cancelled");
      let p = null;
      const id = String(a?.plan_id ?? "").trim();
      if (id) {
        if (!UUID_RE.test(id)) return {
          error: "plan_id must be the id from plan_campaign or list_plans."
        };
        p = plans.find((x)=>x.id === id);
        if (!p) return {
          error: "That plan was not found on this account."
        };
      } else if (String(a?.campaign_name ?? "").trim()) {
        const n = normName(a.campaign_name);
        const m = plans.filter((x)=>normName(x.plan?.campaign_name).includes(n) || n.includes(normName(x.plan?.campaign_name)));
        const drafts = m.filter((x)=>x.status === "draft");
        p = (drafts.length ? drafts : m)[0];
        if (!p) return {
          error: `No plan called "${a.campaign_name}". Call list_plans.`
        };
      } else {
        p = plans.find((x)=>x.status === "draft");
        if (!p) return {
          error: "There is no draft plan to edit. Create one with plan_campaign first."
        };
      }
      if (p.status !== "draft") return {
        error: "That campaign is already launched. This link only edits drafts. To change a live ad, use edit_ad."
      };
      await admin.from("plan_edit_links").delete().lt("expires_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
      const token = hexRand(16);
      const expires = new Date(Date.now() + PLAN_HOURS * 3600 * 1000).toISOString();
      const { error } = await admin.from("plan_edit_links").insert({
        secret_hash: await sha256hex(token),
        company_id: c.companyId,
        user_id: c.userId,
        plan_id: p.id,
        expires_at: expires
      });
      if (error) return {
        error: "Could not make the link. Try again."
      };
      return {
        ok: true,
        ad_copy_link: `${SITE}/ads.html?t=${token}`,
        plan_id: p.id,
        campaign: p.plan?.campaign_name,
        valid_for_hours: PLAN_HOURS,
        next: `Give the person this link now. It opens ${p.plan?.campaign_name ?? "the draft"}: they can edit the campaign name, each ad set's settings, the copy, headlines and descriptions, choose which copy and picture each ad uses, upload pictures or videos, then press Save. Nothing goes to Meta until the plan is launched, which still needs their clear yes (the WhatsApp Launch button or the launch card). Anyone with the link can edit until it expires in ${PLAN_HOURS} hours, so keep it private. After they say they saved, call get_plan again to read their changes before you change or launch the draft.`
      };
    }
  },
  {
    name: "social_list_posts",
    title: "Revora social posts",
    description: "List the posts for Revora's own Facebook Page and Instagram (@revora.ads): drafts, scheduled, posted and failed, with links to the live ones. For Revora HQ admins only. Not for customers' ads.",
    inputSchema: OBJ({
      status: {
        type: "string",
        enum: [
          "draft",
          "approved",
          "posted",
          "failed",
          "skipped"
        ],
        description: "Only this status. Omit for all."
      }
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false
    },
    run: async (a, c)=>{
      if (!await isHqAdmin(c)) return NOT_ADMIN;
      const r = await social({
        action: "list",
        status: a?.status,
        limit: 20
      }, c);
      return r.error ? r : {
        posts: (r.posts ?? []).map(brief),
        auto_approve: r.settings?.auto_approve ?? false
      };
    }
  },
  {
    name: "social_import_media",
    title: "Use a picture or video from this chat for a social post",
    description: "Bring a picture (png, jpg or webp, up to 10 MB) or a video (mp4 or mov, up to 100 MB) that is in this chat into Revora's social storage, so it can be posted. Returns a public link to pass to social_create_post as media_urls. Pass the file as media; media_url only if you were given a public link. Revora HQ admins only. It does not post anything.",
    inputSchema: OBJ({
      media: {
        type: "object",
        description: "The picture or video from the chat (file input).",
        properties: {
          download_url: {
            type: "string"
          },
          file_id: {
            type: "string"
          }
        }
      },
      media_url: str("A public https link to the file, only if media is not available")
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    write: true,
    meta: {
      "openai/fileParams": [
        "media"
      ]
    },
    run: async (a, c)=>{
      if (!await isHqAdmin(c)) return NOT_ADMIN;
      const src = String(a?.media?.download_url ?? a?.media_url ?? "");
      if (!/^https:\/\//.test(src)) return {
        error: "I did not receive the file. Ask the person to upload it again."
      };
      const host = (()=>{
        try {
          return new URL(src).hostname;
        } catch  {
          return "";
        }
      })();
      if (!host || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || host.endsWith(".internal") || host.endsWith(".local")) return {
        error: "That is not a public file link."
      };
      const r = await fetch(src).catch(()=>null);
      if (!r?.ok) return {
        error: "Could not download the file (the link may have expired). Send it again."
      };
      const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "video/quicktime": "mov"
      }[type];
      if (!ext) return {
        error: "Only png, jpg, webp, mp4 or mov files are supported."
      };
      const bytes = new Uint8Array(await r.arrayBuffer());
      const max = ext === "mp4" || ext === "mov" ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
      if (bytes.length > max) return {
        error: `That file is over ${max / 1024 / 1024} MB. Send a smaller one.`
      };
      const d = new Date();
      const path = `chat/${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;
      const up = await admin.storage.from("social-media").upload(path, bytes, {
        contentType: type
      });
      if (up.error) return {
        error: "Could not store the file: " + up.error.message
      };
      const url = admin.storage.from("social-media").getPublicUrl(path).data.publicUrl;
      return {
        ok: true,
        media_url: url,
        kind: ext === "mp4" || ext === "mov" ? "video" : "picture",
        note: "Stored. Use this media_url in social_create_post. Nothing has been posted."
      };
    }
  },
  {
    name: "social_create_post",
    title: "Create a Revora social post",
    description: "Post to Revora's own Facebook Page and Instagram (@revora.ads). The PERSON writes the caption (or tells you what to write); never invent claims, numbers or testimonials. Media: 1 picture, 2 to 10 pictures (a swipeable carousel, in the order given: the first is the cover), or 1 video (posts as a Reel). mode draft saves it and sends the person a WhatsApp approval message; schedule posts at scheduled_for (ISO time, Lagos is UTC+1); post_now posts immediately. ALWAYS call first WITHOUT confirmed: it returns a preview. Show the person the caption, the pictures in order and the time, and only after a clear yes call again with the same details and confirmed true. Revora HQ admins only. Not for customers' ads.",
    inputSchema: OBJ({
      media_urls: {
        type: "array",
        items: {
          type: "string"
        },
        description: "1 to 10 public links from social_import_media (or other public https links), in the order they should appear"
      },
      caption_ig: str("The Instagram caption, exactly as the person wants it (max 2,200 characters). Hashtags go at the end."),
      caption_fb: str("The Facebook caption. Optional: the Instagram caption is used if left out."),
      mode: {
        type: "string",
        enum: [
          "draft",
          "schedule",
          "post_now"
        ],
        description: "draft, schedule or post_now"
      },
      scheduled_for: str("For schedule: the time as an ISO string, e.g. 2026-10-15T17:30:00Z. Lagos time is UTC+1."),
      confirmed: {
        type: "boolean",
        description: "True ONLY after the person clearly said yes to the preview."
      }
    }, [
      "media_urls",
      "caption_ig",
      "mode"
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    write: true,
    run: async (a, c)=>{
      if (!await isHqAdmin(c)) return NOT_ADMIN;
      const urls = Array.isArray(a?.media_urls) ? a.media_urls : [];
      const mode = String(a?.mode ?? "draft");
      if (mode !== "draft" && a?.confirmed !== true) {
        return {
          needs_confirmation: true,
          not_posted_yet: true,
          preview: {
            media_in_order: urls,
            instagram_caption: a?.caption_ig,
            facebook_caption: a?.caption_fb || "(same as Instagram)",
            when: mode === "post_now" ? "right now" : a?.scheduled_for,
            goes_to: "Facebook Page Revora and Instagram @revora.ads"
          },
          next: "NOT posted yet. Show this to the person and ask. Call again with confirmed true only after a clear yes."
        };
      }
      const r = await social({
        action: "create",
        media_urls: urls,
        caption_ig: a?.caption_ig,
        caption_fb: a?.caption_fb,
        mode,
        scheduled_for: a?.scheduled_for,
        source: "mcp"
      }, c);
      if (r.error) return r;
      return {
        ok: true,
        post: brief(r.post),
        note: r.note,
        publisher: r.publisher
      };
    }
  },
  {
    name: "social_manage_post",
    title: "Approve, post, skip or edit a Revora social post",
    description: "Act on an existing Revora social post from social_list_posts: approve (it posts at its scheduled time, or at once if none), post_now, skip, delete (only if not posted), or edit_caption / reschedule. ALWAYS call first WITHOUT confirmed for approve and post_now: it returns a summary to show the person; only after a clear yes call again with confirmed true. Revora HQ admins only.",
    inputSchema: OBJ({
      id: str("The post id from social_list_posts"),
      do: {
        type: "string",
        enum: [
          "approve",
          "post_now",
          "skip",
          "delete",
          "edit_caption",
          "reschedule"
        ],
        description: "What to do"
      },
      caption_ig: str("For edit_caption: the new Instagram caption"),
      caption_fb: str("For edit_caption: the new Facebook caption (optional)"),
      scheduled_for: str("For reschedule or approve: ISO time"),
      confirmed: {
        type: "boolean",
        description: "True ONLY after the person clearly said yes (needed for approve and post_now)."
      }
    }, [
      "id",
      "do"
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    write: true,
    run: async (a, c)=>{
      if (!await isHqAdmin(c)) return NOT_ADMIN;
      const id = String(a?.id ?? "");
      const doit = String(a?.do ?? "");
      if ((doit === "approve" || doit === "post_now") && a?.confirmed !== true) {
        const l = await social({
          action: "list",
          limit: 60
        }, c);
        const p = (l.posts ?? []).find((x)=>x.id === id);
        if (!p) return {
          error: "I can't find that post. Call social_list_posts."
        };
        return {
          needs_confirmation: true,
          not_posted_yet: true,
          post: brief(p),
          instagram_caption: p.caption_ig,
          pictures_in_order: p.media_urls,
          next: `NOT done yet. Show this to the person and ask if they want to ${doit === "post_now" ? "post it right now" : "approve it"}. Call again with confirmed true only after a clear yes.`
        };
      }
      let r;
      if (doit === "approve") r = await social({
        action: "set_status",
        id,
        status: "approved",
        scheduled_for: a?.scheduled_for
      }, c);
      else if (doit === "post_now") r = await social({
        action: "post_now",
        id
      }, c);
      else if (doit === "skip") r = await social({
        action: "set_status",
        id,
        status: "skipped"
      }, c);
      else if (doit === "delete") r = await social({
        action: "delete",
        id
      }, c);
      else if (doit === "edit_caption") r = await social({
        action: "update",
        id,
        caption_ig: a?.caption_ig,
        caption_fb: a?.caption_fb
      }, c);
      else if (doit === "reschedule") r = await social({
        action: "update",
        id,
        scheduled_for: a?.scheduled_for
      }, c);
      else return {
        error: "do must be approve, post_now, skip, delete, edit_caption or reschedule."
      };
      if (r.error) return r;
      return {
        ok: true,
        post: r.post ? brief(r.post) : undefined,
        publisher: r.publisher
      };
    }
  }
];
const BY_NAME = new Map(TOOLS.map((t)=>[
    t.name,
    t
  ]));
const safeEqKey = (a, b)=>{
  if (!b || a.length !== b.length) return false;
  let d = 0;
  for(let i = 0; i < a.length; i++)d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
// Internal tool group of the Revora MCP server (mcp-social). The `mcp` router calls this with the service key.
//   { action: "list" } -> the tool definitions;  { action: "call", tool, args, ctx } -> { out } (the router audits, limits and formats it)
// The upload page, the live editor and the campaign page call { action: "upload_*" | "edit_*" | "plan_*", token, ... } with no key: those are checked by the link token alone.
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS
  });
  let b = null;
  try {
    b = await req.json();
  } catch  {
    b = null;
  }
  if (typeof b?.action === "string" && b.action.startsWith("upload_")) return publicUpload(b);
  if (typeof b?.action === "string" && b.action.startsWith("edit_")) return publicEdit(b);
  if (typeof b?.action === "string" && b.action.startsWith("plan_")) return publicPlan(b);
  if (!safeEqKey(req.headers.get("x-internal-key") ?? "", SERVICE_KEY)) return jres({
    error: "forbidden"
  }, 403);
  if (!b) return jres({
    error: "bad_request"
  }, 400);
  if (b?.action === "list") return jres({
    group: "mcp-social",
    tools: TOOLS.map((t)=>({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
        meta: t.meta,
        write: t.write,
        heavy: t.heavy
      }))
  });
  if (b?.action === "call") {
    const t = BY_NAME.get(String(b?.tool ?? ""));
    if (!t) return jres({
      error: "unknown_tool"
    }, 404);
    let out;
    try {
      out = await t.run(b?.args && typeof b.args === "object" ? b.args : {}, b.ctx);
    } catch (e) {
      out = {
        error: e.message
      };
    }
    return jres({
      out
    });
  }
  return jres({
    error: "bad_action"
  }, 400);
});
