/* Server-rendered public site page: /s/<slug>[/<page>]  (rewritten here by vercel.json).
   Visitors get finished HTML + CSS in the first response (fast, indexable). The order form,
   bank card and other dynamic widgets are mounted by rv/form.js after load. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rrkhkhgdxhmogxxtbvyt.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJya2hraGdkeGhtb2d4eHRidnl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwNTc3ODgsImV4cCI6MjEwMTYzMzc4OH0.zAWC-s3PVsYi_EIHibbqLkCQ0u095ppDh-2l_DA-_Pc";
const ROOT = path.join(__dirname, "..");

// Sites must be served from their own origin (see rv/config.js) so pasted scripts can't reach dashboard sessions.
function siteOrigin() {
  if (process.env.RV_SITE_ORIGIN !== undefined) return process.env.RV_SITE_ORIGIN;
  const ctx = { window: {} };
  try { vm.runInNewContext(fs.readFileSync(path.join(ROOT, "rv", "config.js"), "utf8"), ctx); } catch (e) {}
  return ctx.window.RV_SITE_ORIGIN || "";
}

let ASSETS = null;
function assets() {
  if (ASSETS) return ASSETS;
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "rv", "blocks.js"), "utf8"), ctx);
  ASSETS = { baseCss: ctx.window.RVBlocks.BASE_CSS, formCss: fs.readFileSync(path.join(ROOT, "rv", "form.css"), "utf8") };
  return ASSETS;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// Small per-instance cache so repeat visits (and every ad click, whose fbclid makes the CDN key unique) skip the upstream call.
const CACHE = new Map();
const TTL = 30 * 1000;
async function loadSite(slug, page) {
  const key = slug + "/" + page, hit = CACHE.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const url = SUPABASE_URL + "/functions/v1/get-site-public?slug=" + encodeURIComponent(slug) + "&page=" + encodeURIComponent(page);
  const r = await fetch(url, { headers: { apikey: ANON, Authorization: "Bearer " + ANON } });
  const v = { status: r.status, data: await r.json().catch(() => ({})) };
  if (v.status === 200 || v.status === 404) CACHE.set(key, { t: Date.now(), v });
  if (CACHE.size > 200) CACHE.delete(CACHE.keys().next().value);
  return v;
}

function notFound(res, msg, status) {
  res.statusCode = status || 404;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, s-maxage=10");
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title><body style="font:16px/1.5 system-ui,sans-serif;color:#555;text-align:center;padding:18vh 24px">' + esc(msg || "This page isn't available.") + "</body>");
}

function render(d, query) {
  const { baseCss, formCss } = assets();
  const site = d.site, page = d.page, seo = page.seo || {};
  const snippets = d.snippets || [];
  const hasFbq = snippets.some((s) => /fbq\(/.test(s.code || "")) || /fbq\(/.test(seo.head_html || "");
  const title = seo.title || page.title || site.name;
  const fonts = (site.settings && site.settings.theme && site.settings.theme.fonts_url) || "";
  const pixel = d.pixel_id && !hasFbq
    ? "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','" + esc(d.pixel_id).replace(/'/g, "") + "');fbq('track','PageView');</script>"
    : "";
  const at = (loc) => snippets.filter((s) => s.location === loc).map((s) => s.code || "").join("\n");
  const data = { site: d.site, page: { id: page.id, slug: page.slug, kind: page.kind }, product: d.product, pixel_id: d.pixel_id };
  const bodyAttrs = (seo.body_class ? ' class="' + esc(seo.body_class) + '"' : "") + (seo.body_style ? ' style="' + esc(seo.body_style) + '"' : "");
  return "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>" + esc(title) + "</title>" +
    (seo.description ? '<meta name="description" content="' + esc(seo.description) + '"><meta property="og:description" content="' + esc(seo.description) + '">' : "") +
    '<meta property="og:title" content="' + esc(title) + '">' + (seo.image ? '<meta property="og:image" content="' + esc(seo.image) + '">' : "") +
    (seo.noindex ? '<meta name="robots" content="noindex">' : "") + (seo.favicon ? '<link rel="icon" href="' + esc(seo.favicon) + '">' : "") +
    (fonts ? '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="' + esc(fonts) + '">' : "") +
    "<style>" + baseCss + "</style><style>" + formCss + "</style><style>[data-rv-form]:empty{min-height:420px}</style><style>" + (page.css || "").replace(/<\/style/gi, "<\\/style") + "</style>" +
    (seo.head_html || "") + "\n" + at("head") + pixel + "</head><body" + bodyAttrs + ">" + at("body_start") +
    '<div id="rv-root">' + (page.html || "") + "</div>" + at("footer") +
    "<script>window.__RV=" + jsonForScript(data) + ";</script>" +
    '<script src="/rv/form.js" defer></script>' +
    "<script>window.addEventListener('DOMContentLoaded',function(){var d=window.__RV,root=document.getElementById('rv-root');if(window.RV)window.RV.mountAll(root,d,{preview:false});" +
    "root.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^=\"#\"]');if(!a||a.getAttribute('href')==='#')return;var t=document.getElementById(a.getAttribute('href').slice(1));if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth',block:'start'});}});});</script>" +
    "</body></html>";
}

module.exports = async function handler(req, res) {
  try {
    const u = new URL(req.url, "http://x");
    const origin = siteOrigin(), host = String(req.headers && req.headers.host || "").toLowerCase();
    if (origin && host && host !== new URL(origin).host.toLowerCase() && !/^localhost/.test(host)) {
      const orig = (req.headers["x-vercel-forwarded-url"] || "") || "";
      const parts = u.searchParams.get("slug") ? [u.searchParams.get("slug"), u.searchParams.get("page")] : [];
      const qs = new URLSearchParams(u.search); qs.delete("slug"); qs.delete("page");
      res.statusCode = 302;
      res.setHeader("location", origin + "/s/" + parts.filter(Boolean).join("/") + (qs.toString() ? "?" + qs.toString() : ""));
      return res.end();
    }
    let slug = (u.searchParams.get("slug") || "").toLowerCase(), pg = (u.searchParams.get("page") || "").toLowerCase();
    if (!slug) {
      const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
      if (parts[0] === "s") { slug = (parts[1] || "").toLowerCase(); pg = (parts[2] || "").toLowerCase(); }
    }
    if (!slug) return notFound(res, "This page doesn't exist.");
    const r = await loadSite(slug, pg);
    if (r.status === 404 || !r.data || r.data.error) return notFound(res, "This page isn't available.", r.status === 404 ? 404 : 502);
    const html = render(r.data, u.searchParams);
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=0, s-maxage=30, stale-while-revalidate=300");
    res.end(html);
  } catch (e) {
    console.error("site render failed", e);
    notFound(res, "Something went wrong. Please refresh in a moment.", 503);
  }
};
module.exports.render = render;
