// Revora MCP tool group "mcp-code": sites as real FILES (an IDE for the assistant).
// A file-based site keeps its source in site_files (index.html, thanks.html, styles.css, scripts.js, assets/js/*.js, ...) with a version on every file.
// Every write rebuilds the site_pages rows that the public renderer (get-site-public) already reads, so nothing that is live changes.
// Sites made before this group existed have no files and are not touched by these tools.
// v4: scripts, forms, inline handlers, <meta>/<link> tags and styles are KEPT as written (nothing is silently stripped).
//     Instead, code that could reach the Revora app, hidden (obfuscated) code, miners, <base> and meta-refresh are REFUSED with a clear message,
//     external scripts must come from known hosts, and forms may only post to Revora, WhatsApp or Formspree.
//     CSS and JS files may sit in folders and are bundled into the page; scripts.js and styles.css apply to every page.
// v5: links (test link and fallback live link) now point at the isolated sites origin, never the dashboard origin.
//     The renderer (api/site.js) is server-rendered, so DOMContentLoaded works normally (the v4 timing warning was wrong and is gone).
//     The Meta pixel warning now only fires for a pixel in the body (a pixel in <head> makes Revora skip its own).
// v6: site_import_zip (bring a whole site in from a .zip as files) and site_set_live (publish or unpublish an imported site).
//     Imported sites (settings.imported) keep foreign scripts, forms, iframes and pixels as written, so later edits are not blocked by the
//     script host and form rules. The rules that protect the Revora app (BAD list) still apply to everyone.
// Called only by the `mcp` router with the service key: { action: "list" } and { action: "call", tool, args, ctx }.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { withR2, R2_ON, r2PublicBase } from "../_shared/r2storage.ts";
import { unzip, planImport, swapPixel, hoistPixel } from "./import_plan.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = withR2(createClient(SUPABASE_URL, SERVICE_KEY));
const SITE = "https://dash.revoracrm.online"; // dashboard + builder (never serves customer pages in links we hand out)
const SITES = "https://revora-sites.vercel.app"; // isolated project that serves customer pages only (RV_SITE_ORIGIN)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-internal-key"
};
const jres = (obj, status = 200)=>new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
const safeEqKey = (a, b)=>{
  if (!b || a.length !== b.length) return false;
  let d = 0;
  for(let i = 0; i < a.length; i++)d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
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
const normName = (t)=>String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const pickProd = (prods, name, loose = false)=>{
  const n = normName(name);
  let m = prods.filter((p)=>normName(p.product_name) === n);
  if (!m.length && loose) m = prods.filter((p)=>normName(p.product_name).includes(n));
  return m.find((p)=>p.product_image_url) ?? m[0] ?? null;
};
const plain = (s, max)=>String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const esc = (s, max = 400)=>plain(s, max).replace(/[&<>"]/g, (c)=>({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;"
    })[c]);
const nl = (s)=>String(s ?? "").replace(/\r\n?/g, "\n");
const byteLen = (s)=>new TextEncoder().encode(s).length;
const MAX_FILE_CHARS = 400_000;
const MAX_FILES = 60;
const KEEP_VERSIONS = 50;
const MAX_ZIP = 50 * 1024 * 1024;
const BUCKET = 'site-media';
// Pages (.html) sit at the top level. CSS and JS may sit in folders (up to 3 deep), e.g. assets/js/cart.js.
const PATH_RE = /^[a-z0-9][a-z0-9_-]{0,40}(\/[a-z0-9][a-z0-9_.-]{0,40}){0,3}\.(html|css|js)$/;
// External scripts are allowed only from these hosts (and their subdomains). A site can add more in settings.allow_script_hosts.
const SCRIPT_HOSTS = [
  'connect.facebook.net',
  'www.facebook.com',
  'analytics.tiktok.com',
  'www.googletagmanager.com',
  'www.google-analytics.com',
  'googleads.g.doubleclick.net',
  'www.clarity.ms',
  'static.hotjar.com',
  'script.hotjar.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'code.jquery.com',
  'ajax.googleapis.com',
  'cdn.tailwindcss.com',
  'js.paystack.co',
  'checkout.flutterwave.com',
  'www.youtube.com',
  'player.vimeo.com',
  'embed.tawk.to',
  'sc-static.net',
  'static.ads-twitter.com',
  'snap.licdn.com',
  'tags.tiqcdn.com'
];
const CONVENTIONS = [
  "Files: index.html is the main page, thanks.html is the thank-you page (served as thank-you), and any other name.html you add is served at /<n>. Pages sit at the top level. CSS and JS can sit in folders (assets/css/site.css, assets/js/cart.js). styles.css and scripts.js apply to every page. Only .html, .css and .js, lowercase names.",
  "Write complete HTML documents. Everything you write is kept as written: <style> blocks, <meta> and <link> tags (SEO title and description, Open Graph, icons, fonts), inline and external scripts, forms and inline event handlers. Local files are bundled into the page: <script src=\"assets/js/cart.js\"></script> and <link rel=\"stylesheet\" href=\"assets/css/site.css\"> are replaced by the file's content when the page is built.",
  "Pages are rendered on the server, so inline scripts run as the browser reads the page and DOMContentLoaded works normally. Put scripts at the end of the body so the elements above them exist.",
  "Revora installs the Meta pixel automatically (page view and order events). If you add your own pixel, put it in <head>: Revora then skips its own. A pixel in the body is double-counted. Other tracking scripts (TikTok, Google, Clarity, Hotjar) are fine anywhere.",
  "External scripts are allowed only from known hosts (Meta, TikTok, Google, Clarity, Hotjar, jsDelivr, cdnjs, unpkg, jQuery, Tailwind, Paystack, Flutterwave, YouTube, Vimeo, Tawk and similar). The owner can add a host in the site settings (allow_script_hosts). Forms may post only to Revora, WhatsApp (wa.me) or Formspree, or stay on the page. Sites imported from a .zip (site_import_zip) are exempt from the script host and form rules: their own scripts, pixel, iframes and order forms stay as written.",
  "Revora refuses code that could reach the Revora app or its login and session data, hidden (obfuscated) code, crypto miners, <base> tags and meta-refresh redirects. Everything else is yours.",
  "Put <div data-rv-form=\"1\"></div> where the order form goes: index.html needs one to take orders. A button that should pick a package is <a href=\"#order\" data-rv-tier=\"1\"> (1 is the first package).",
  "Revora's ready-made classes work (rv-sec, rv-wrap narrow, rv-h2, rv-lead, rv-btn, rv-card, rv-ticks, rv-footer and so on), and you can write your own CSS.",
  "Use Revora image links only (product photo, creatives, generate_image previews), never pictures from other websites.",
  "Sales page sequence for health, beauty and fashion: an order bar at the top with the package picker and a pay on delivery line; then the hero as stacked blocks (a BIG HEADER that names the problem and puts the fear of leaving it alone in the reader, a SMALL body of two or three lines that explains it, then ONE image that shows that problem; never put the header on top of a background image); an offer card (crossed-out price, today's price, trust ticks, order button); problem sections that repeat header, small body, image, order button; the solution with the real pack; testimonial cards; packages, FAQ, order form, footer. Every button jumps to the order form. Mobile first, big ALL-CAPS hook headers, short body text.",
  "Write what the person asks for. If a claim is heavy, give ONE short heads-up that Meta may restrict the ad account, then follow their decision without repeating it. Claims come from the product facts or the person; never invent testimonials, numbers or certifications (use the person's real ones or clear placeholders).",
  "To change something: site_read_file the part you need, then site_patch_file with a small old_str and new_str and the version you read. Do not resend a whole file for a small change.",
  "Go live with publish_sales_page (it asks the person first). On a live site every write shows to customers at once; site_rollback undoes it. A site imported from a .zip goes live with site_set_live instead."
];
// ---- safety: refuse dangerous code, keep everything else --------------------------------------------------------------
const BAD = [
  [
    /<base\b/i,
    'a <base> tag'
  ],
  [
    /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i,
    'a meta-refresh redirect'
  ],
  [
    /metaautomationads\.vercel\.app|\/auth\/v1\b|supabase\.auth\b|service_role|sb-[a-z0-9]+-auth-token/i,
    'code that reaches the Revora app, its login or its session data'
  ],
  [
    /eval\s*\(\s*(atob|unescape|decodeURIComponent)|new\s+Function\s*\(\s*(atob|unescape)/i,
    'hidden (obfuscated) code execution'
  ],
  [
    /coinhive|cryptonight|coin-hive|webminer/i,
    'a crypto miner'
  ],
  [
    /\b(top|parent)\s*\.\s*(location|document)/i,
    'code that reaches outside the page (top or parent)'
  ],
  [
    /<(iframe|script|embed|object)\b[^>]*\b(src|data)\s*=\s*["']?\s*(javascript\s*:|data\s*:\s*text\/html)/i,
    'an embedded javascript: or data: page'
  ]
];
const isAbs = (u)=>/^(https?:)?\/\//i.test(u.trim());
const hostOk = (u, settings)=>{
  try {
    const t = u.trim();
    if (/^http:/i.test(t)) return false;
    const h = new URL(t.startsWith('//') ? 'https:' + t : t).hostname.toLowerCase();
    const extra = Array.isArray(settings?.allow_script_hosts) ? settings.allow_script_hosts.map((x)=>String(x).toLowerCase()) : [];
    return [
      ...SCRIPT_HOSTS,
      ...extra
    ].some((a)=>h === a || h.endsWith('.' + a));
  } catch  {
    return false;
  }
};
const actionOk = (a)=>{
  const t = a.trim();
  if (!isAbs(t)) return !/^(javascript|data):/i.test(t);
  if (t.startsWith(SUPABASE_URL + '/functions/v1/')) return true;
  try {
    const h = new URL(t.startsWith('//') ? 'https:' + t : t).hostname.toLowerCase();
    return [
      'formspree.io',
      'wa.me',
      'api.whatsapp.com'
    ].includes(h);
  } catch  {
    return false;
  }
};
// Returns a message when the file must be refused, otherwise null. CSS is cleaned at build time instead of refused.
// Imported sites (settings.imported) skip the script host and form rules: their own scripts, forms and iframes stay as written.
function scan(path, content, settings) {
  if (path.endsWith('.css')) return null;
  for (const [re, why] of BAD)if (re.test(content)) return `Blocked: this file contains ${why}. Revora refuses code that could reach the Revora app or run hidden code. Remove it and save again.`;
  if (path.endsWith('.html') && settings?.imported !== true) {
    for (const m of content.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)){
      if (isAbs(m[1]) && !hostOk(m[1], settings)) return `Blocked: the script ${m[1].slice(0, 120)} is not from an allowed host (or is not https). Use a known host, or ask the site owner to add its domain to allow_script_hosts in the site settings.`;
    }
    for (const m of content.matchAll(/<form\b[^>]*\baction\s*=\s*["']([^"']*)["']/gi)){
      if (!actionOk(m[1])) return `Blocked: a form posts to ${m[1].slice(0, 120)}. Forms may only post to Revora, WhatsApp (wa.me) or Formspree, or stay on the page (use data-rv-form for the order form).`;
    }
  }
  return null;
}
// ---- page preparation: keep everything, bundle local files ------------------------------------------------------------
const localPath = (s)=>{
  const t = String(s || '').trim().toLowerCase().replace(/^\.?\//, '').split(/[?#]/)[0];
  return isAbs(t) || /^[a-z]+:/.test(t) ? null : t;
};
const inlineJs = (code)=>'<script>' + code.replace(/<\/script/gi, '<\\/script') + '</script>';
function prepare(raw, byPath) {
  const src = String(raw || '').slice(0, 400_000);
  const headInner = (src.match(/<head[^>]*>([\s\S]*?)<\/head>/i) ?? [])[1] ?? '';
  const bm = src.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  const attrs = bm ? bm[1] : '';
  let body = bm ? bm[2] : src.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<\/?(html|body)[^>]*>/gi, '');
  const cssParts = [];
  const grab = (s)=>s.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m, c)=>{
      cssParts.push(c);
      return '';
    });
  const bundle = (s)=>s.replace(/<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi, (tag)=>{
      const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) ?? [])[1];
      const p = href ? localPath(href) : null;
      if (p && byPath.has(p)) {
        cssParts.push(byPath.get(p));
        return '';
      }
      return tag;
    }).replace(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, srcv)=>{
      const p = localPath(srcv);
      return p && byPath.has(p) ? inlineJs(byPath.get(p)) : tag;
    });
  let head = bundle(grab(headInner));
  body = bundle(grab(body));
  head = head.replace(/<title[\s\S]*?<\/title>/i, '').replace(/<meta\b[^>]*\bcharset\b[^>]*>/gi, '').replace(/<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/gi, '');
  const css = cssParts.join('\n').replace(/expression\s*\(|javascript\s*:|behavior\s*:/gi, '').slice(0, 300_000);
  const cls = (attrs.match(/class=["']([^"']*)["']/i) ?? [])[1] ?? '', sty = (attrs.match(/style=["']([^"']*)["']/i) ?? [])[1] ?? '';
  const title = ((headInner.match(/<title[^>]*>([^<]{1,120})<\/title>/i) ?? [])[1] ?? '').trim();
  const description = ((headInner.match(/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["']([^"']{1,300})["']/i) ?? [])[1] ?? '').trim();
  return {
    html: body.trim(),
    css,
    head_html: head.trim(),
    body_class: cls.slice(0, 120),
    body_style: sty.replace(/expression/gi, '').slice(0, 300),
    title,
    description
  };
}
async function pickBuyer(companyId, userId) {
  const { data: me } = await admin.from("profiles").select("media_buyer_id").eq("id", userId).maybeSingle();
  if (me?.media_buyer_id) return {
    id: me.media_buyer_id
  };
  const { data: bs } = await admin.from("media_buyers").select("id").eq("company_id", companyId).eq("active", true).limit(2);
  if ((bs ?? []).length === 1) return {
    id: bs[0].id
  };
  return {
    id: null,
    warning: "No media buyer is attached to this site, so its orders will not show under any buyer. Ask the person which media buyer owns it and set it in Revora (Websites) before publishing."
  };
}
async function links(s, companyId) {
  const { data: doms } = await admin.from("site_domains").select("hostname, site_id").eq("company_id", companyId).eq("status", "active").order("created_at");
  const d = (doms ?? []).find((x)=>x.site_id === s.id) ?? (doms ?? [])[0];
  const root = !!d && d.site_id === s.id;
  const base = d ? `https://${d.hostname}${root ? "" : `/s/${s.slug}`}` : `${SITES}/s/${s.slug}`;
  return {
    site_id: s.id,
    builder_link: `${SITE}/builder.html?site=${s.id}`,
    test_link: `${base}${root ? "/" : ""}?preview=1&pt=${s.settings?.preview_token ?? ""}`,
    live_link: s.status === "published" ? base + (root ? "/" : "") : null,
    status: s.status
  };
}
const roleGate = (c)=>[
    "owner",
    "admin",
    "buyer"
  ].includes(c.role) ? null : {
    error: "Only owners, admins and media buyers can work on sites."
  };
async function loadSite(a, c) {
  const sid = String(a?.site_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(sid)) return {
    error: "site_id is required (from site_new or site_list_files)."
  };
  const { data: s } = await admin.from("sites").select("id, name, slug, status, product_id, settings, media_buyer_id, company_id").eq("id", sid).eq("company_id", c.companyId).maybeSingle();
  if (!s) return {
    error: "That site was not found."
  };
  if (c.role === "buyer" && s.media_buyer_id !== c.mediaBuyerId) return {
    error: "A media buyer can only work on their own sites. Ask the owner."
  };
  if (s.settings?.storage !== "files") return {
    error: "This site was built before file mode, so it has no files. To change it, use get_sales_page with include_html and import_html_page. To work with files, create a new site with site_new."
  };
  return {
    site: s
  };
}
function cleanPath(v) {
  const p = String(v ?? "").trim().toLowerCase().replace(/^\.?\//, "");
  if (!PATH_RE.test(p)) return {
    error: "Use lowercase names ending in .html, .css or .js. Pages (.html) sit at the top level, for example index.html; css and js can sit in folders, for example assets/js/cart.js."
  };
  if (p.endsWith(".html") && p.includes("/")) return {
    error: "Pages (.html) cannot sit in folders. Keep pages at the top level and put css and js in folders."
  };
  return {
    path: p
  };
}
async function getFile(siteId, path) {
  const { data } = await admin.from("site_files").select("id, path, content, version, updated_at").eq("site_id", siteId).eq("path", path).maybeSingle();
  return data;
}
async function snapshot(s, path, version, content, action, c) {
  await admin.from("site_file_versions").insert({
    company_id: c.companyId,
    site_id: s.id,
    path,
    version,
    content,
    action,
    saved_by: c.userId,
    saved_via: "mcp"
  });
  const { data: old } = await admin.from("site_file_versions").select("id").eq("site_id", s.id).eq("path", path).order("version", {
    ascending: false
  }).range(KEEP_VERSIONS, KEEP_VERSIONS + 500);
  if (old?.length) await admin.from("site_file_versions").delete().in("id", old.map((r)=>r.id));
}
async function nextVersion(siteId, path) {
  const { data } = await admin.from("site_file_versions").select("version").eq("site_id", siteId).eq("path", path).order("version", {
    ascending: false
  }).limit(1);
  return (data?.[0]?.version ?? 0) + 1;
}
// Create or replace one file. expect = the version the caller read (checked when given).
async function saveFile(s, path, content, action, c, expect) {
  if (content.length > MAX_FILE_CHARS) return {
    error: `That file is too big (over ${MAX_FILE_CHARS.toLocaleString("en")} characters).`
  };
  const now = new Date().toISOString();
  const ex = await getFile(s.id, path);
  if (ex) {
    if (expect != null && Number(expect) !== ex.version) return {
      error: `Version conflict: ${path} is now version ${ex.version}, not ${expect}. Someone changed it since you read it. Read it again, then repeat your change.`,
      current_version: ex.version
    };
    const nv = Math.max(ex.version, await nextVersion(s.id, path) - 1) + 1;
    const { data: up } = await admin.from("site_files").update({
      content,
      version: nv,
      updated_by: c.userId,
      updated_via: "mcp",
      updated_at: now
    }).eq("id", ex.id).eq("version", ex.version).select("version");
    if (!up?.length) return {
      error: `${path} was changed by someone else just now. Read it again, then repeat your change.`,
      current_version: (await getFile(s.id, path))?.version
    };
    await snapshot(s, path, nv, content, action, c);
    return {
      version: nv,
      created: false
    };
  }
  const { count } = await admin.from("site_files").select("id", {
    count: "exact",
    head: true
  }).eq("site_id", s.id);
  if ((count ?? 0) >= MAX_FILES) return {
    error: `A site can have at most ${MAX_FILES} files.`
  };
  const nv = await nextVersion(s.id, path);
  const { error } = await admin.from("site_files").insert({
    company_id: c.companyId,
    site_id: s.id,
    path,
    content,
    version: nv,
    updated_by: c.userId,
    updated_via: "mcp"
  });
  if (error) return {
    error: "Could not save the file: " + error.message
  };
  await snapshot(s, path, nv, content, action, c);
  return {
    version: nv,
    created: true
  };
}
// Rebuild the site_pages rows (what customers see) from the files.
async function build(s, c) {
  const { data: files } = await admin.from("site_files").select("path, content").eq("site_id", s.id);
  const all = files ?? [];
  const byPath = new Map(all.map((f)=>[
      f.path,
      f.content
    ]));
  const styles = byPath.get("styles.css") ?? "";
  const globalJs = byPath.get("scripts.js") ?? "";
  const { data: existing } = await admin.from("site_pages").select("id, slug, title, seo, published_at").eq("site_id", s.id);
  const ex = new Map((existing ?? []).map((p)=>[
      p.slug,
      p
    ]));
  const keep = new Set(), pages = [], warnings = [];
  const live = s.status === "published";
  const now = new Date().toISOString();
  const storage = `${SUPABASE_URL}/storage/v1/object/public/`;
  for (const f of all.filter((x)=>String(x.path).endsWith(".html"))){
    const base = String(f.path).slice(0, -5);
    const slug = base === "index" ? "" : base === "thanks" ? "thank-you" : base;
    const kind = base === "thanks" ? "thanks" : "page";
    keep.add(slug);
    const im = prepare(f.content, byPath);
    if (!im.html) {
      warnings.push(`${f.path} has no page content, so the page was left as it was.`);
      continue;
    }
    // Revora skips its own pixel when fbq( is in the head or in a tracking snippet, but not when it is in the body.
    if (s.settings?.imported !== true && /fbq\s*\(/.test(im.html)) warnings.push(`${f.path}: a Meta pixel in the body is counted on top of the pixel Revora installs. Move yours into <head> (Revora then skips its own) or remove it.`);
    const outside = [
      ...f.content.matchAll(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/gi)
    ].map((m)=>m[1]).filter((u)=>!u.startsWith(storage) && !(R2_ON && u.startsWith(r2PublicBase() + "/")));
    if (outside.length && s.settings?.imported !== true) warnings.push(`${f.path}: ${outside.length} picture(s) are not Revora links, so they may not load or may be slow.`);
    if (slug === "" && !im.html.includes("data-rv-form") && s.settings?.external_form !== true) warnings.push("index.html has no <div data-rv-form=\"1\"></div>, so the page cannot take orders and cannot be published.");
    const css = [
      styles,
      byPath.get(base + ".css"),
      im.css
    ].filter(Boolean).join("\n");
    const html = globalJs ? im.html + "\n" + inlineJs(globalJs) : im.html;
    const e = ex.get(slug);
    const title = im.title || e?.title || base;
    // preserve_head (set only by hand on converted imports, e.g. WordPress/Elementor pages): keep the page's saved head content and full body class/style instead of regenerating them.
    const keepHead = e?.seo?.preserve_head === true;
    const seo = {
      ...e?.seo ?? {},
      custom_html: true,
      source: "files",
      noindex: e?.seo?.noindex ?? true,
      title: e?.seo?.title ?? title,
      description: e?.seo?.description ?? (im.description || undefined),
      head_html: keepHead ? e.seo.head_html ?? "" : im.head_html,
      body_class: keepHead ? e.seo.body_class ?? "" : im.body_class,
      body_style: keepHead ? e.seo.body_style ?? "" : im.body_style
    };
    if (e) {
      const { error } = await admin.from("site_pages").update({
        title,
        html,
        css,
        project: null,
        seo,
        updated_at: now
      }).eq("id", e.id);
      if (error) return {
        error: `Saved the file, but could not rebuild ${f.path}: ${error.message}`
      };
    } else {
      const { error } = await admin.from("site_pages").insert({
        site_id: s.id,
        company_id: s.company_id,
        slug,
        kind,
        title,
        html,
        css,
        seo,
        published_at: live ? now : null
      });
      if (error) return {
        error: `Saved the file, but could not build ${f.path}: ${error.message}`
      };
    }
    pages.push({
      slug,
      file: f.path
    });
  }
  for (const p of existing ?? [])if (p.seo?.source === "files" && !keep.has(p.slug)) await admin.from("site_pages").delete().eq("id", p.id);
  await admin.from("sites").update({
    updated_at: now
  }).eq("id", s.id);
  return {
    pages,
    warnings
  };
}
async function finish(s, c, extra) {
  const b = await build(s, c);
  if ("error" in b) return {
    ...extra,
    error: b.error,
    note: "The file change is saved (see version). Fix the problem and write again, or use site_rollback."
  };
  const live = s.status === "published";
  return {
    ok: true,
    ...extra,
    page_rebuilt: true,
    pages: b.pages,
    ...b.warnings.length ? {
      warnings: b.warnings
    } : {},
    ...await links(s, c.companyId),
    live,
    note: live ? "This site is LIVE: the change is already showing to customers. site_rollback undoes it." : "Draft: check the test_link. Go live with publish_sales_page when the person says yes."
  };
}
const lineOf = (text, index)=>text.slice(0, index).split("\n").length;
async function removeSite(siteId) {
  await admin.from('site_file_versions').delete().eq('site_id', siteId);
  await admin.from('site_files').delete().eq('site_id', siteId);
  await admin.from('site_pages').delete().eq('site_id', siteId);
  await admin.from('sites').delete().eq('id', siteId);
  const { data: objs } = await admin.storage.from(BUCKET).list(`imports/${siteId}`, {
    limit: 500
  });
  if (objs?.length) await admin.storage.from(BUCKET).remove(objs.map((o)=>`imports/${siteId}/${o.name}`));
}
async function setLive(siteId, live) {
  const now = new Date().toISOString();
  await admin.from('sites').update({
    status: live ? 'published' : 'draft',
    updated_at: now
  }).eq('id', siteId);
  await admin.from('site_pages').update({
    published_at: live ? now : null
  }).eq('site_id', siteId);
}
async function thanksLinks(s, companyId) {
  const l = await links(s, companyId);
  const [h, q] = String(l.test_link).split('?');
  const home = h.replace(/\/$/, '');
  return {
    test: `${home}/thank-you?${q}`,
    live: s.status === 'published' ? `${home}/thank-you` : null
  };
}
const STARTER_HEAD = (title)=>`<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title, 80)}</title>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap">\n</head>`;
const starterIndex = (title, business)=>`${STARTER_HEAD(title)}\n<body>\n<section class="rv-sec rv-center">\n  <div class="rv-wrap narrow">\n    <h1 class="rv-h2">${esc(title, 80)}</h1>\n    <p class="rv-sub">Small body: explain the problem in two or three short lines.</p>\n    <div class="rv-card" style="min-height:220px;display:flex;align-items:center;justify-content:center">Image that shows the problem in the header (use a Revora image link)</div>\n    <a class="rv-btn" href="#order">Order now</a>\n  </div>\n</section>\n<section class="rv-sec alt" id="order">\n  <div class="rv-wrap narrow">\n    <div class="rv-center"><h2 class="rv-h2">Fill the form to order</h2><p class="rv-sub">Pay on delivery</p></div>\n    <div data-rv-form="1"></div>\n  </div>\n</section>\n<footer class="rv-footer"><p style="margin:0">&copy; <span data-rv-year>2026</span> ${esc(business, 80)}. All rights reserved.</p></footer>\n</body>\n</html>\n`;
const starterThanks = (title, business)=>`${STARTER_HEAD("Thank you")}\n<body>\n<section class="rv-sec rv-center">\n  <div class="rv-wrap narrow">\n    <div class="rv-ico" style="width:72px;height:72px;font-size:36px;border-radius:50%">✓</div>\n    <h1 class="rv-h2">Thank you, your order is in!</h1>\n    <p class="rv-lead">A team member will contact you shortly to confirm your order and delivery details.</p>\n    <div data-rv-bank="1"></div>\n    <p class="rv-sub">Reference: <b data-rv-ref="1"></b></p>\n  </div>\n</section>\n<footer class="rv-footer"><p style="margin:0">&copy; <span data-rv-year>2026</span> ${esc(business, 80)}.</p></footer>\n</body>\n</html>\n`;
const STARTER_CSS = `/* Site-wide styles: applied to every page of this site. */\n:root{--p:#1a7a5e;--r:12px;--fh:'Poppins',system-ui,sans-serif;--fb:'Inter',system-ui,sans-serif}\n`;
const STARTER_JS = '/* Site-wide JavaScript: added at the end of every page. */\n';
const TOOLS = [
  {
    name: "site_new",
    title: "Start a new site as files",
    description: "Create a new DRAFT site for a product whose source is real files you can read and patch like an IDE: index.html (main page), thanks.html (thank-you page), styles.css and scripts.js, already linked to the product (order form, packages, pixel and thank-you page work automatically). Returns the file list, the product facts and packages you may use, and the conventions to follow. Then write the real page with site_write_file and refine it with site_read_file and site_patch_file. Scripts, forms, handlers, meta tags and styles are kept as you write them; css and js can sit in folders like assets/js/cart.js. Nothing is live until publish_sales_page. Use this for NEW pages; older pages cannot be turned into files here.",
    inputSchema: OBJ({
      product_name: str("The product"),
      title: str("Site name, e.g. 'Aura Glow sales page'"),
      business_name: str("Name shown in the footer (default: the product name)")
    }, [
      "product_name"
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false
    },
    write: true,
    run: async (a, c)=>{
      const g = roleGate(c);
      if (g) return g;
      const { data: prods } = await admin.from("products").select("id, product_name, product_image_url, default_order_value_naira, description, benefits").eq("company_id", c.companyId);
      const p = pickProd(prods ?? [], a?.product_name, true);
      if (!p) return {
        error: `No product called "${a?.product_name}" yet. Call list_products, or add it with create_product first.`,
        needs_product: true
      };
      const buyer = await pickBuyer(c.companyId, c.userId);
      const base = p.product_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "site";
      const title = plain(a?.title, 80) || `${p.product_name} page`, business = plain(a?.business_name, 80) || p.product_name;
      let s = null;
      for(let i = 0; i < 4 && !s; i++){
        const { data, error } = await admin.from("sites").insert({
          company_id: c.companyId,
          name: title,
          slug: `${base}-${crypto.randomUUID().slice(0, 4)}`,
          status: "draft",
          product_id: p.id,
          media_buyer_id: buyer.id,
          settings: {
            storage: "files",
            preview_token: crypto.randomUUID().replace(/-/g, "")
          }
        }).select("id, name, slug, status, product_id, settings, media_buyer_id, company_id").single();
        if (!error) s = data;
      }
      if (!s) return {
        error: "Could not create the site. Try again."
      };
      const starters = [
        [
          "index.html",
          starterIndex(title, business)
        ],
        [
          "thanks.html",
          starterThanks(title, business)
        ],
        [
          "styles.css",
          STARTER_CSS
        ],
        [
          "scripts.js",
          STARTER_JS
        ]
      ];
      for (const [path, content] of starters){
        const r = await saveFile(s, path, content, "create", c);
        if ("error" in r) {
          await admin.from("sites").delete().eq("id", s.id);
          return {
            error: r.error
          };
        }
      }
      const { data: tiers } = await admin.from("product_tiers").select("label, price_naira, features, badge, image_url").eq("product_id", p.id).eq("is_active", true).order("sort_order", {
        ascending: true
      });
      const out = await finish(s, c, {
        created: true,
        name: title,
        files: starters.map(([path, content])=>({
            path,
            version: 1,
            bytes: byteLen(content)
          })),
        product: {
          name: p.product_name,
          price_naira: p.default_order_value_naira ?? null,
          benefits: p.benefits ?? null,
          description: p.description ?? null,
          photo: p.product_image_url ?? null
        },
        packages: (tiers ?? []).map((t, i)=>({
            number: i + 1,
            label: t.label,
            price_naira: t.price_naira,
            features: t.features ?? null,
            badge: t.badge ?? null,
            image_url: t.image_url ?? null
          })),
        conventions: CONVENTIONS
      });
      if (buyer.warning) out.buyer_warning = buyer.warning;
      return out;
    }
  },
  {
    name: "site_list_files",
    title: "List a site's files",
    description: "Without site_id: the person's file-based sites (made with site_new). With site_id: the file tree (path, version, size, lines), the product facts and packages, the links, and the conventions. Call this first when you are about to change a site.",
    inputSchema: OBJ({
      site_id: str("The site (from site_new or the list)")
    }, []),
    annotations: {
      readOnlyHint: true
    },
    run: async (a, c)=>{
      const g = roleGate(c);
      if (g) return g;
      if (!a?.site_id) {
        let q = admin.from("sites").select("id, name, slug, status, settings, media_buyer_id, updated_at").eq("company_id", c.companyId).eq("settings->>storage", "files").order("updated_at", {
          ascending: false
        }).limit(30);
        if (c.role === "buyer") q = q.eq("media_buyer_id", c.mediaBuyerId);
        const { data } = await q;
        return {
          sites: await Promise.all((data ?? []).map(async (s)=>({
              name: s.name,
              ...await links(s, c.companyId)
            }))),
          note: "Only sites made with site_new have files. Older pages are changed with get_sales_page and import_html_page."
        };
      }
      const r = await loadSite(a, c);
      if ("error" in r) return r;
      const s = r.site;
      const [{ data: files }, { data: p }] = await Promise.all([
        admin.from("site_files").select("path, content, version, updated_at, updated_via").eq("site_id", s.id).order("path"),
        s.product_id ? admin.from("products").select("id, product_name, default_order_value_naira, benefits, description, product_image_url").eq("id", s.product_id).maybeSingle() : Promise.resolve({
          data: null
        })
      ]);
      const { data: tiers } = p ? await admin.from("product_tiers").select("label, price_naira, features, badge, image_url").eq("product_id", p.id).eq("is_active", true).order("sort_order", {
        ascending: true
      }) : {
        data: []
      };
      return {
        name: s.name,
        ...await links(s, c.companyId),
        files: (files ?? []).map((f)=>({
            path: f.path,
            version: f.version,
            bytes: byteLen(f.content),
            lines: f.content.split("\n").length,
            updated_at: f.updated_at,
            updated_via: f.updated_via
          })),
        product: p ? {
          name: p.product_name,
          price_naira: p.default_order_value_naira,
          benefits: p.benefits,
          description: p.description,
          photo: p.product_image_url
        } : null,
        packages: (tiers ?? []).map((t, i)=>({
            number: i + 1,
            label: t.label,
            price_naira: t.price_naira,
            features: t.features ?? null,
            badge: t.badge ?? null,
            image_url: t.image_url ?? null
          })),
        conventions: CONVENTIONS
      };
    }
  },
  {
    name: "site_read_file",
    title: "Read a file (or part of it)",
    description: "Read a site file with line numbers. Pass start_line and end_line to read only the part you need (up to 800 lines per call; the default is the first 400). Returns the file's version: pass it as if_version when you change the file. The line numbers are for reference only; never include them in old_str or in new content.",
    inputSchema: OBJ({
      site_id: str("The site"),
      path: str("e.g. index.html or assets/js/cart.js"),
      start_line: {
        type: "number",
        description: "First line to read (1 is the first). Default 1."
      },
      end_line: {
        type: "number",
        description: "Last line to read. Default start_line + 399."
      }
    }, [
      "site_id",
      "path"
    ]),
    annotations: {
      readOnlyHint: true
    },
    run: async (a, c)=>{
      const g = roleGate(c);
      if (g) return g;
      const r = await loadSite(a, c);
      if ("error" in r) return r;
      const cp = cleanPath(a?.path);
      if ("error" in cp) return cp;
      const f = await getFile(r.site.id, cp.path);
      if (!f) return {
        error: `${cp.path} does not exist. Call site_list_files to see the files.`
      };
      const lines = f.content.split("\n"), total = lines.length;
      const start = Math.min(Math.max(Math.round(Number(a?.start_line)) || 1, 1), total);
      const wantEnd = Math.round(Number(a?.end_line)) || start + 399;
      let end = Math.min(Math.max(wantEnd, start), start + 799, total), size = 0;
      const shown = [];
      for(let i = start; i <= end; i++){
        const row = `${i}\t${lines[i - 1]}`;
        if (size + row.length > 60000 && shown.length) {
          end = i - 1;
          break;
        }
        shown.push(row);
        size += row.length + 1;
      }
      return {
        path: cp.path,
        version: f.version,
        total_lines: total,
        shown_lines: `${start}-${end}`,
        content: shown.join("\n"),
        ...end < total ? {
          more: `Call again with start_line ${end + 1} to continue.`
        } : {}
      };
    }
  },
  {
    name: "site_search",
    title: "Search the site's files",
    description: "Find text across all the files of a site (like grep). Returns file, line number and the line. Use it to locate the part to read or patch instead of reading whole files. Plain text, case-insensitive by default; set regex true for a regular expression.",
    inputSchema: OBJ({
      site_id: str("The site"),
      query: str("Text or regular expression to find"),
      regex: {
        type: "boolean",
        description: "Treat query as a regular expression."
      },
      case_sensitive: {
        type: "boolean"
      },
      path: str("Search only this file (optional)")
    }, [
      "site_id",
      "query"
    ]),
    annotations: {
      readOnlyHint: true
    },
    run: async (a, c)=>{
      const g = roleGate(c);
      if (g) return g;
      const r = await loadSite(a, c);
      if ("error" in r) return r;
      const q = String(a?.query ?? "");
      if (!q) return {
        error: "Give the text to search for."
      };
      let re;
      try {
        re = new RegExp(a?.regex === true ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), a?.case_sensitive === true ? "" : "i");
      } catch  {
        return {
          error: "That is not a valid regular expression."
        };
      }
      let fq = admin.from("site_files").select("path, content, version").eq("site_id", r.site.id).order("path");
      if (a?.path) {
        const cp = cleanPath(a.path);
        if ("error" in cp) return cp;
        fq = fq.eq("path", cp.path);
      }
      const { data: files } = await fq;
      const matches = [];
      let more = false;
      for (const f of files ?? []){
        const ls = String(f.content).split("\n");
        for(let i = 0; i < ls.length; i++)if (re.test(ls[i])) {
          if (matches.length >= 60) {
            more = true;
            break;
          }
          matches.push({
            path: f.path,
            line: i + 1,
            text: ls[i].length > 300 ? ls[i].slice(0, 300) + " …" : ls[i]
          });
        }
        if (more) break;
      }
      return {
        query: q,
        found: matches.length,
        ...more ? {
          note: "More than 60 matches: narrow the search."
        } : {},
        matches
      };
    }
  },
  {
    name: "site_write_file",
    title: "Create or replace a whole file",
    description: "Create a new file, or replace a file completely. Use it for a new file or a real rewrite; for a small change use site_patch_file instead. Replacing an existing file needs if_version (the version from site_read_file or site_list_files) so you never overwrite someone else's newer work. Pages are .html at the top level; css and js files can sit in folders (assets/js/cart.js) and are bundled into the page. Your scripts, forms, handlers, meta tags and styles are kept as written; code that could reach the Revora app or run hidden code is refused. The page customers see is rebuilt at once. On a live site the change is live immediately.",
    inputSchema: OBJ({
      site_id: str("The site"),
      path: str("e.g. index.html, thanks.html, styles.css, scripts.js, about.html, assets/js/cart.js"),
      content: str("The complete file content"),
      if_version: {
        type: "number",
        description: "Required when the file already exists: the version you last read."
      }
    }, [
      "site_id",
      "path",
      "content"
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false
    },
    write: true,
    run: async (a, c)=>{
      const g = roleGate(c);
      if (g) return g;
      const r = await loadSite(a, c);
      if ("error" in r) return r;
      const cp = cleanPath(a?.path);
      if ("error" in cp) return cp;
      const content = nl(a?.content);
      if (!content.trim()) return {
        error: "The file content is empty. To remove a file use site_delete_file."
      };
      const bad = scan(cp.path, content, r.site.settings);
      if (bad) return {
        error: bad
      };
      const cur = await getFile(r.site.id, cp.path);
      if (cur && a?.if_version == null) return {
        error: `${cp.path} already exists (version ${cur.version}). Read it first and pass if_version ${cur.version}, or use site_patch_file for a small change.`,
        current_version: cur.version
      };
      const w = await saveFile(r.site, cp.path, content, cur ? "write" : "create", c, a?.if_version == null ? null : Number(a.if_version));
      if ("error" in w) return w;
      return finish(r.site, c, {
        path: cp.path,
        version: w.version,
        created: w.created,
        bytes: byteLen(content)
      });
    }
  },
  {
    name: "site_patch_file",
    title: "Change part of a file (find and replace)",
    description: "Make a small, exact edit: replace old_str with new_str inside one file, leaving everything else untouched, so nothing is ever cut off. old_str must match exactly (spaces and line breaks included) and be unique in the file, or set replace_all true. Copy it from site_read_file without the line numbers. Pass if_version (from your last read) so you never overwrite someone else's newer work. To insert, make old_str the line you insert next to and include it again in new_str. To delete, use an empty new_str. Code that could reach the Revora app or run hidden code is refused. The page customers see is rebuilt at once; on a live site the change is live immediately.",
    inputSchema: OBJ({
      site_id: str("The site"),
      path: str("e.g. index.html"),
      old_str: str("The exact text to replace"),
      new_str: str("The replacement (empty to delete)"),
      if_version: {
        type: "number",
        description: "The version you last read of this file."
      },
      replace_all: {
        type: "boolean",
        description: "Replace every match instead of requiring exactly one."
      }
    }, [
      "site_id",
      "path",
      "old_str",
      "new_str"
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false
    },
    write: true,
    run: async (a, c)=>{
      const g = roleGate(c);
      if (g) return g;
      const r = await loadSite(a, c);
      if ("error" in r) return r;
      const cp = cleanPath(a?.path);
      if ("error" in cp) return cp;
      const f = await getFile(r.site.id, cp.path);
      if (!f) return {
        error: `${cp.path} does not exist. Call site_list_files to see the files.`
      };
      const oldS = nl(a?.old_str), newS = nl(a?.new_str);
      if (!oldS) return {
        error: "old_str is empty. Give the exact text to replace."
      };
      if (oldS === newS) return {
        error: "old_str and new_str are the same, so nothing would change."
      };
      if (a?.if_version != null && Number(a.if_version) !== f.version) return {
        error: `Version conflict: ${cp.path} is now version ${f.version}, not ${a.if_version}. Read it again, then repeat your change.`,
        current_version: f.version
      };
      const parts = f.content.split(oldS), n = parts.length - 1;
      if (n === 0) return {
        error: "old_str was not found. It must match exactly, including spaces and line breaks. Use site_search to find it, then site_read_file to copy it.",
        current_version: f.version
      };
      if (n > 1 && a?.replace_all !== true) {
        const at = [];
        let i = -1;
        while(at.length < 10 && (i = f.content.indexOf(oldS, i + 1)) !== -1)at.push(lineOf(f.content, i));
        return {
          error: `old_str matches ${n} places (lines ${at.join(", ")}). Add more surrounding text to make it unique, or set replace_all true.`,
          current_version: f.version
        };
      }
      const next = parts.join(newS);
      const bad = scan(cp.path, next, r.site.settings);
      if (bad) return {
        error: bad,
        current_version: f.version
      };
      const w = await saveFile(r.site, cp.path, next, "patch", c, f.version);
      if ("error" in w) return w;
      return finish(r.site, c, {
        path: cp.path,
        version: w.version,
        replaced: n,
        bytes: byteLen(next)
      });
    }
  },
  {
    name: "site_delete_file",
    title: "Delete a file",
    description: "Delete a file from the site (a deleted file can be brought back with site_rollback). index.html and styles.css cannot be deleted. Deleting a page file such as thanks.html removes that page.",
    inputSchema: OBJ({
      site_id: str("The site"),
      path: str("The file")
    }, [
      "site_id",
      "path"
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true
    },
    write: true,
    run: async (a, c)=>{
      const g = roleGate(c);
      if (g) return g;
      const r = await loadSite(a, c);
      if ("error" in r) return r;
      const cp = cleanPath(a?.path);
      if ("error" in cp) return cp;
      if (cp.path === "index.html" || cp.path === "styles.css") return {
        error: `${cp.path} cannot be deleted. Replace it with site_write_file instead.`
      };
      const f = await getFile(r.site.id, cp.path);
      if (!f) return {
        error: `${cp.path} does not exist.`
      };
      const nv = await nextVersion(r.site.id, cp.path);
      await snapshot(r.site, cp.path, nv, f.content, "delete", c);
      const { error } = await admin.from("site_files").delete().eq("id", f.id);
      if (error) return {
        error: "Could not delete the file: " + error.message
      };
      return finish(r.site, c, {
        path: cp.path,
        deleted: true,
        restore_with: `site_rollback with path ${cp.path} and version ${nv - 1}`
      });
    }
  },
  {
    name: "site_history",
    title: "Version history of a file",
    description: "List the saved versions of a file (newest first): version, what happened, when, and the size. Use it to find the version to go back to with site_rollback. Works for deleted files too. The last 50 versions of each file are kept.",
    inputSchema: OBJ({
      site_id: str("The site"),
      path: str("The file")
    }, [
      "site_id",
      "path"
    ]),
    annotations: {
      readOnlyHint: true
    },
    run: async (a, c)=>{
      const g = roleGate(c);
      if (g) return g;
      const r = await loadSite(a, c);
      if ("error" in r) return r;
      const cp = cleanPath(a?.path);
      if ("error" in cp) return cp;
      const { data } = await admin.from("site_file_versions").select("version, action, saved_at, saved_via, content").eq("site_id", r.site.id).eq("path", cp.path).order("version", {
        ascending: false
      }).limit(KEEP_VERSIONS);
      const cur = await getFile(r.site.id, cp.path);
      return {
        path: cp.path,
        current_version: cur?.version ?? null,
        exists: !!cur,
        versions: (data ?? []).map((v)=>({
            version: v.version,
            action: v.action,
            saved_at: v.saved_at,
            saved_via: v.saved_via,
            bytes: byteLen(v.content)
          }))
      };
    }
  },
  {
    name: "site_rollback",
    title: "Go back to an earlier version of a file",
    description: "Put a file back to an earlier version from site_history. The old content is saved as a NEW version (history is never lost), so a rollback can itself be undone. Also brings back a deleted file. The page customers see is rebuilt at once; on a live site the change is live immediately.",
    inputSchema: OBJ({
      site_id: str("The site"),
      path: str("The file"),
      version: {
        type: "number",
        description: "The version to restore, from site_history"
      }
    }, [
      "site_id",
      "path",
      "version"
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false
    },
    write: true,
    run: async (a, c)=>{
      const g = roleGate(c);
      if (g) return g;
      const r = await loadSite(a, c);
      if ("error" in r) return r;
      const cp = cleanPath(a?.path);
      if ("error" in cp) return cp;
      const want = Math.round(Number(a?.version));
      if (!want || want < 1) return {
        error: "Give the version number from site_history."
      };
      const { data: v } = await admin.from("site_file_versions").select("content, version").eq("site_id", r.site.id).eq("path", cp.path).eq("version", want).maybeSingle();
      if (!v) return {
        error: `Version ${want} of ${cp.path} was not found. Call site_history.`
      };
      const cur = await getFile(r.site.id, cp.path);
      if (cur && cur.content === v.content) return {
        ok: true,
        path: cp.path,
        version: cur.version,
        note: "The file already has exactly that content. Nothing changed."
      };
      const w = await saveFile(r.site, cp.path, v.content, "rollback", c, null);
      if ("error" in w) return w;
      return finish(r.site, c, {
        path: cp.path,
        version: w.version,
        restored_from_version: want
      });
    }
  },
  {
    name: 'site_import_zip',
    title: 'Import a whole website from a .zip',
    description: 'Bring a finished website in from a .zip as a FILE-BASED site, so it can be edited afterwards with site_read_file, site_patch_file and the other site tools. Give a public https link to the .zip (zip_url). Revora reads the zip, finds the main page (index.html) and the thank-you page, keeps the pictures, videos and fonts (stored on Revora) and every css and js file, and rewrites the local paths so they work. NOTHING the person wrote is removed: their own scripts, Meta pixel, embedded forms, iframes and CRM order forms stay exactly as written (the person may work for a company with its own CRM). Only code that could reach the Revora app or run hidden code is refused. It returns the page URL and the thank-you URL (test links now, live links once published). If the page already has a Meta pixel that differs from the product ad account pixel, NOTHING is created and the answer is needs_decision: ask the person whether to keep their pixel (Revora then installs none of its own) or swap its id for the ad account pixel, then call again with pixel_mode keep or swap. The site is created as a draft; publish with site_set_live after the person says yes (or pass publish true if they already said so).',
    inputSchema: OBJ({
      zip_url: str('Public https link that downloads the .zip directly (up to 50 MB)'),
      product_name: str('The product this site is for (optional when the person has only one product)'),
      title: str('Site name (default: product name + site)'),
      pixel_mode: {
        type: 'string',
        enum: [
          'keep',
          'swap'
        ],
        description: 'Only after needs_decision: keep = leave the page pixel as written, swap = replace its id with the ad account pixel.'
      },
      publish: {
        type: 'boolean',
        description: 'true to go live straight away. Only when the person already said yes.'
      }
    }, [
      'zip_url'
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false
    },
    write: true,
    run: async (a, c)=>{
      const g = roleGate(c);
      if (g) return g;
      const url = String(a?.zip_url ?? '');
      if (!/^https:\/\//i.test(url)) return {
        error: 'Give a public https link to the .zip in zip_url.'
      };
      let host = '';
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch  {
        return {
          error: 'That link is not valid.'
        };
      }
      if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(host) || !host.includes('.')) return {
        error: 'That link cannot be used.'
      };
      const { data: prods } = await admin.from('products').select('id, product_name, product_image_url, ad_accounts(meta_pixel_id)').eq('company_id', c.companyId).eq('is_active', true);
      let prod = null;
      if (a?.product_name) {
        prod = pickProd(prods ?? [], a.product_name, true);
        if (!prod) return {
          error: `No product called "${a.product_name}". Create the product first.`,
          needs_product: true
        };
      } else if ((prods ?? []).length === 1) prod = prods[0];
      else return {
        error: 'Which product is this site for? Send product_name.',
        needs_product: true,
        products: (prods ?? []).map((p)=>p.product_name).slice(0, 30)
      };
      const aa = Array.isArray(prod.ad_accounts) ? prod.ad_accounts[0] : prod.ad_accounts;
      const revoraPixel = aa?.meta_pixel_id ? String(aa.meta_pixel_id) : null;
      const r = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000)
      });
      if (!r.ok) return {
        error: `Could not download the zip (${r.status}).`
      };
      if (Number(r.headers.get('content-length') ?? 0) > MAX_ZIP) return {
        error: `The zip is over ${MAX_ZIP / 1048576} MB.`
      };
      const zipBytes = new Uint8Array(await r.arrayBuffer());
      if (zipBytes.length > MAX_ZIP) return {
        error: `The zip is over ${MAX_ZIP / 1048576} MB.`
      };
      if (zipBytes.length < 22 || zipBytes[0] !== 0x50 || zipBytes[1] !== 0x4b) return {
        error: 'That link did not give a .zip file. For Google Drive or Dropbox, use the direct download link.'
      };
      let entries;
      try {
        entries = await unzip(zipBytes);
      } catch (e) {
        return {
          error: e.message
        };
      }
      const siteId = crypto.randomUUID();
      // Imported pictures, videos and fonts are stored on Cloudflare R2 when it is configured (key = site-media/imports/<site>/<file>).
      const assetBase = R2_ON ? `${r2PublicBase()}/${BUCKET}/imports/${siteId}/` : `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/imports/${siteId}/`;
      let plan;
      try {
        plan = planImport(entries, assetBase);
      } catch (e) {
        return {
          error: e.message
        };
      }
      if (plan.pages.length + plan.textFiles.length > MAX_FILES - 1) return {
        error: `The site has ${plan.pages.length + plan.textFiles.length} pages, stylesheets and scripts; the limit is ${MAX_FILES - 1}.`
      };
      for (const f of [
        ...plan.pages,
        ...plan.textFiles
      ]){
        if (f.file.endsWith('.css')) continue;
        for (const [re, why] of BAD)if (re.test(f.content)) return {
          error: `Blocked: ${f.from} contains ${why}. Revora refuses code that could reach the Revora app or run hidden code. Remove it and upload again.`
        };
      }
      const found = plan.pixels.ids;
      let mode = a?.pixel_mode === 'swap' ? 'swap' : a?.pixel_mode === 'keep' ? 'keep' : null;
      if (mode === 'swap' && !revoraPixel) return {
        error: "This product's ad account has no Meta pixel saved, so there is nothing to swap to. Choose keep, or connect the pixel first."
      };
      if (!mode && found.length > 0 && !!revoraPixel && found.some((i)=>i !== revoraPixel)) {
        return {
          needs_decision: true,
          decision: 'pixel',
          question: `The page already has its own Meta pixel (${found.join(', ')}), which is not the pixel on this product's ad account (${revoraPixel}). What should Revora do?`,
          found_pixels: found,
          revora_pixel: revoraPixel,
          options: [
            {
              pixel_mode: 'keep',
              meaning: 'Keep their pixel exactly as it is. Revora installs none of its own, so nothing is counted twice.'
            },
            {
              pixel_mode: 'swap',
              meaning: `Replace their pixel id(s) with the ad account pixel ${revoraPixel}. Revora still adds nothing of its own, and events go to the ad account pixel.`
            }
          ],
          next: 'Ask the person which one, then call site_import_zip again with the same zip_url and pixel_mode set. Nothing has been created yet.'
        };
      }
      if (!mode) mode = 'keep';
      const buyer = await pickBuyer(c.companyId, c.userId);
      const slugBase = String(prod.product_name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'site';
      const title = plain(a?.title, 80) || `${prod.product_name} site`;
      const hasRvForm = plan.pages.some((p)=>p.content.includes('data-rv-form'));
      const settings = {
        storage: 'files',
        preview_token: crypto.randomUUID().replace(/-/g, ''),
        imported: true,
        external_form: !hasRvForm,
        pixel_mode: mode,
        pixel_found: found,
        allow_script_hosts: plan.hosts.scripts,
        import: {
          source: 'zip',
          at: new Date().toISOString(),
          pages: plan.pages.map((p)=>p.from)
        }
      };
      let site = null;
      for(let i = 0; i < 4 && !site; i++){
        const { data, error } = await admin.from('sites').insert({
          id: siteId,
          company_id: c.companyId,
          name: title,
          slug: `${slugBase}-${crypto.randomUUID().slice(0, 4)}`,
          status: 'draft',
          product_id: prod.id,
          media_buyer_id: buyer.id,
          settings
        }).select('id, name, slug, status, product_id, settings, media_buyer_id, company_id').single();
        if (!error) site = data;
      }
      if (!site) return {
        error: 'Could not create the site. Try again.'
      };
      const failed = [];
      let uploaded = 0;
      const queue = [
        ...plan.assets
      ];
      await Promise.all([
        0,
        1,
        2
      ].map(async ()=>{
        for(let x = queue.shift(); x; x = queue.shift()){
          const { error } = await admin.storage.from(BUCKET).upload(`imports/${siteId}/${x.name}`, x.bytes, {
            contentType: x.mime,
            upsert: true,
            cacheControl: '31536000'
          });
          if (error) failed.push({
            file: x.from,
            why: /size|exceed|too large|413/i.test(error.message) ? `too big for storage (${Math.round(x.bytes.length / 1048576)} MB)` : error.message.slice(0, 120)
          });
          else uploaded++;
        }
      }));
      const rows = [];
      for (const t of plan.textFiles)rows.push({
        path: t.file,
        content: t.content
      });
      for (const p of plan.pages){
        let ct = p.content;
        if (mode === 'swap' && revoraPixel) ct = swapPixel(ct, revoraPixel);
        if (mode === 'keep' && plan.pixels.inBodyOnly.includes(p.file)) ct = hoistPixel(ct);
        rows.push({
          path: p.file,
          content: ct
        });
      }
      for (const row of rows){
        const w = await saveFile(site, row.path, row.content, 'create', c);
        if ('error' in w) {
          await removeSite(siteId);
          return {
            error: `Could not save ${row.path}: ${w.error}`
          };
        }
      }
      const b = await build(site, c);
      if ('error' in b) {
        await removeSite(siteId);
        return {
          error: `The files were read but the pages could not be built: ${b.error}`
        };
      }
      const wantLive = a?.publish === true;
      if (wantLive) await setLive(siteId, true);
      const s2 = {
        ...site,
        status: wantLive ? 'published' : 'draft'
      };
      const hasThanks = plan.pages.some((p)=>p.role === 'thanks');
      const l = await links(s2, c.companyId);
      const th = hasThanks ? await thanksLinks(s2, c.companyId) : null;
      const warnings = [
        ...plan.warnings,
        ...b.warnings
      ];
      if (failed.length) warnings.push(`${failed.length} file(s) could not be stored and will not show on the page: ${failed.map((f)=>`${f.file} (${f.why})`).join('; ')}.`);
      if (buyer.warning) warnings.push(buyer.warning);
      return {
        ok: true,
        imported: true,
        site_id: siteId,
        name: title,
        page_url: {
          test: l.test_link,
          live: l.live_link
        },
        thank_you_url: th,
        builder_link: l.builder_link,
        live: wantLive,
        pages: plan.pages.map((p)=>({
            from: p.from,
            as: p.file,
            role: p.role
          })),
        files_uploaded: uploaded,
        files_failed: failed,
        pixel: {
          found,
          revora_pixel: revoraPixel,
          mode,
          note: !found.length ? 'No Meta pixel in the page, so Revora installs the ad account pixel itself.' : mode === 'swap' ? "Their pixel id was replaced by the ad account's pixel. Revora installs nothing extra." : 'Their pixel was kept as written. Revora installs nothing extra.'
        },
        kept_as_written: {
          external_scripts: plan.hosts.scripts,
          embedded_forms_from: plan.hosts.iframes,
          form_posts_to: plan.hosts.formActions,
          revora_order_form: hasRvForm
        },
        notes: plan.notes,
        warnings,
        next: wantLive ? 'The site is live.' : 'It is a draft: the test links work now. Tell the person the URLs, and use site_set_live (live true) once they say yes. To change anything, use site_read_file and site_patch_file.'
      };
    }
  },
  {
    name: 'site_set_live',
    title: 'Publish or unpublish an imported site',
    description: 'Put a site that was imported from a .zip live (live true) or back to draft (live false). Ask the person first before going live. Sites made with site_new go live with publish_sales_page instead, which needs the Revora order form on the page; imported sites may use their own form or CRM.',
    inputSchema: OBJ({
      site_id: str('The imported site (from site_import_zip)'),
      live: {
        type: 'boolean',
        description: 'true to publish, false to take it back to draft'
      }
    }, [
      'site_id',
      'live'
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false
    },
    write: true,
    run: async (a, c)=>{
      const g = roleGate(c);
      if (g) return g;
      const r = await loadSite(a, c);
      if ('error' in r) return r;
      if (r.site.settings?.imported !== true) return {
        error: 'This site was not imported from a zip. Use publish_sales_page for it.'
      };
      const live = a?.live === true;
      await setLive(r.site.id, live);
      const s2 = {
        ...r.site,
        status: live ? 'published' : 'draft'
      };
      const { data: th } = await admin.from('site_pages').select('id').eq('site_id', r.site.id).eq('kind', 'thanks').limit(1);
      return {
        ok: true,
        live,
        ...await links(s2, c.companyId),
        thank_you_url: th?.length ? await thanksLinks(s2, c.companyId) : null
      };
    }
  }
];
const BY_NAME = new Map(TOOLS.map((t)=>[
    t.name,
    t
  ]));
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS
  });
  if (!safeEqKey(req.headers.get("x-internal-key") ?? "", SERVICE_KEY)) return jres({
    error: "forbidden"
  }, 403);
  let b = {};
  try {
    b = await req.json();
  } catch  {
    return jres({
      error: "bad_request"
    }, 400);
  }
  if (b?.action === "list") return jres({
    group: "mcp-code",
    tools: TOOLS.map((t)=>({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
        write: t.write
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
