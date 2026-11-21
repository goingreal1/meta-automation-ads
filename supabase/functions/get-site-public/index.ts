import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Public, read-only site lookup for the /s/<slug> renderer (site.html).
//   GET /get-site-public?slug=<site slug>&page=<page slug, '' = home>
// Returns the published page (html/css), the tracking snippets that apply to it,
// the pixel to load, and the site's product (same safe slice as get-product-public).
// Unpublished sites/pages are never served publicly. ?preview=1 serves drafts only when the
// request carries the owning company's user token (Authorization: Bearer <user jwt>).
//
// Image optimizer: images stored in Supabase Storage are served through Supabase's image
// resizer (fits inside 1200px wide, quality 75, WebP for browsers that support it) and
// below-the-fold <img> tags are lazy-loaded. resize=contain keeps the WHOLE image: it never
// crops and never enlarges. Original files are never changed. A site can opt out with
// settings.image_optimize = false, and ?raw=1 skips it for debugging.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey"
};
function json(obj, status = 200, cache = "public, max-age=30") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cache,
      ...CORS
    }
  });
}
// ---------- Image optimizer ----------
const IMG_WIDTH = 1200;
const IMG_THUMB_WIDTH = 600;
const IMG_QUALITY = 75;
const escRe = (s)=>s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const OBJ_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/`;
// Only png / jpg / jpeg / webp. GIF (may be animated) and SVG are left alone.
const IMG_URL_RE = new RegExp(escRe(OBJ_PREFIX) + "([^\\s\"'()<>?#]+?\\.(?:png|jpe?g|webp))(?![A-Za-z0-9_.\\-])(\\?[^\\s\"'()<>#]*)?", "gi");
function optimizedUrl(path, query, width) {
  const extra = query ? "&" + query.slice(1) : "";
  // height=6000 + resize=contain: scale the whole picture down to fit the width, keep its shape, never crop.
  return `${SUPABASE_URL}/storage/v1/render/image/public/${path}?width=${width}&height=6000&resize=contain&quality=${IMG_QUALITY}${extra}`;
}
function optimizeUrlString(u, width) {
  if (typeof u !== "string" || !u) return u;
  try {
    return u.replace(IMG_URL_RE, (_m, path, q)=>optimizedUrl(path, q, width));
  } catch  {
    return u;
  }
}
function optimizeHtml(html) {
  if (typeof html !== "string" || !html) return html;
  try {
    let idx = 0;
    let out = html.replace(/<img\b[^>]*>/gi, (tag)=>{
      const i = idx++;
      let orig = null;
      let t = tag.replace(IMG_URL_RE, (full, path, q)=>{
        if (orig === null) orig = full;
        return optimizedUrl(path, q, IMG_WIDTH);
      });
      const add = [];
      if (i > 0 && !/\sloading\s*=/i.test(t)) add.push('loading="lazy"');
      if (!/\sdecoding\s*=/i.test(t)) add.push('decoding="async"');
      if (i === 0 && !/\sfetchpriority\s*=/i.test(t)) add.push('fetchpriority="high"');
      // If the resizer ever refuses an image, fall back to the original file so it never shows broken.
      if (orig && !/\sonerror\s*=/i.test(t)) add.push(`onerror="this.onerror=null;this.removeAttribute('srcset');this.src='${orig}'"`);
      if (!add.length) return t;
      return t.replace(/(\s*\/?>)$/, (m)=>" " + add.join(" ") + m);
    });
    // Background images and any other image links in the page.
    out = out.replace(IMG_URL_RE, (_m, path, q)=>optimizedUrl(path, q, IMG_WIDTH));
    return out;
  } catch  {
    return html;
  }
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: CORS
  });
  if (req.method !== "GET") return json({
    error: "GET only"
  }, 405);
  const url = new URL(req.url);
  let slug = (url.searchParams.get("slug") || "").toLowerCase();
  const pageSlug = (url.searchParams.get("page") || "").toLowerCase();
  const wantPreview = url.searchParams.get("preview") === "1";
  const rawImages = url.searchParams.get("raw") === "1";
  // Custom domain: ?host=<hostname>. The host picks the company; with no slug it serves the
  // domain's default site, with a slug it serves that site only if it belongs to the same company.
  const host = (url.searchParams.get("host") || "").toLowerCase().replace(/^www\./, "");
  let domain = null;
  if (host) {
    const { data: d } = await supabase.from("site_domains").select("company_id, site_id, status, hostname").in("hostname", [
      host,
      "www." + host
    ]).order("hostname").limit(1).maybeSingle();
    if (!d || d.status === "error") return json({
      error: "Domain not connected"
    }, 404);
    domain = d;
  }
  if (!slug && !domain) return json({
    error: "?slug= is required"
  }, 400);
  let siteQuery = supabase.from("sites").select("id, company_id, name, slug, status, product_id, ad_account_id, purchase_event, settings");
  if (slug) siteQuery = siteQuery.eq("slug", slug);
  else if (domain.site_id) siteQuery = siteQuery.eq("id", domain.site_id);
  else return json({
    error: "Site not found"
  }, 404);
  const { data: site } = await siteQuery.maybeSingle();
  if (!site || domain && site.company_id !== domain.company_id) return json({
    error: "Site not found"
  }, 404);
  slug = site.slug;
  // Drafts: only the owning company may see them.
  let isOwner = false;
  if (wantPreview) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (token) {
      const { data: u } = await supabase.auth.getUser(token);
      if (u?.user) {
        const { data: prof } = await supabase.from("profiles").select("company_id").eq("id", u.user.id).maybeSingle();
        isOwner = !!prof && prof.company_id === site.company_id;
      }
    }
  }
  // A private test link (?preview=1&pt=<token>) lets people without a login review a draft; the token is never sent to the public.
  const pt = url.searchParams.get("pt") || "";
  if (wantPreview && !isOwner && pt && pt === site.settings?.preview_token) isOwner = true;
  if (site.status !== "published" && !isOwner) return json({
    error: "Site not found"
  }, 404);
  const { data: page } = await supabase.from("site_pages").select("id, slug, title, kind, html, css, seo, project, published_at, updated_at").eq("site_id", site.id).eq("slug", pageSlug).maybeSingle();
  if (!page) return json({
    error: "Page not found"
  }, 404);
  if (!page.published_at && !isOwner) return json({
    error: "Page not found"
  }, 404);
  // Product + pixel
  let product = null;
  let pixelId = null;
  if (site.product_id) {
    const [{ data: p }, { data: tiers }] = await Promise.all([
      supabase.from("products").select(`id, product_name, currency, default_order_value_naira, is_active, description, benefits, product_image_url,
        whatsapp_number, is_service, accept_online, bank_name, bank_account_number, bank_account_name, payment_note, ad_accounts(meta_pixel_id)`).eq("id", site.product_id).maybeSingle(),
      supabase.from("product_tiers").select("id, label, quantity, price_naira, badge, image_url, features, is_default").eq("product_id", site.product_id).eq("is_active", true).order("sort_order", {
        ascending: true
      })
    ]);
    if (p && p.is_active) {
      product = {
        ...p,
        tiers: tiers ?? []
      };
      pixelId = p.ad_accounts?.meta_pixel_id ?? null;
      delete product.ad_accounts;
    }
  }
  if (site.ad_account_id) {
    const { data: acct } = await supabase.from("ad_accounts").select("meta_pixel_id").eq("id", site.ad_account_id).maybeSingle();
    if (acct?.meta_pixel_id) pixelId = acct.meta_pixel_id;
  }
  // Tracking snippets that apply: all / this site / this page
  const { data: snips } = await supabase.from("tracking_snippets").select("id, code, location, scope, site_ids, page_ids").eq("company_id", site.company_id).eq("is_active", true);
  const snippets = (snips ?? []).filter((s)=>s.scope === "all" || s.scope === "sites" && (s.site_ids || []).includes(site.id) || s.scope === "pages" && (s.page_ids || []).includes(page.id)).map((s)=>({
      id: s.id,
      code: s.code,
      location: s.location
    }));
  // A fingerprint of what the person sees (page, packages, name). Private test links use it to refresh by themselves when the page is saved.
  const stamp = String(page.updated_at ?? "") + "|" + JSON.stringify((product?.tiers ?? []).map((t)=>[
      t.id,
      t.label,
      t.price_naira,
      t.is_default
    ])) + "|" + String(site.name ?? "");
  if (wantPreview && pt && pt === site.settings?.preview_token) {
    const pollUrl = `${SUPABASE_URL}/functions/v1/get-site-public?slug=${encodeURIComponent(site.slug)}&page=${encodeURIComponent(pageSlug)}&preview=1&pt=${encodeURIComponent(pt)}`;
    const js = `(function(){try{var U=${JSON.stringify(pollUrl)},S=${JSON.stringify(stamp)};function t(){fetch(U,{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){if(j&&j.stamp&&j.stamp!==S)location.reload()}).catch(function(){})}setInterval(function(){if(!document.hidden)t()},3000);document.addEventListener("visibilitychange",function(){if(!document.hidden)t()})}catch(e){}})();`;
    snippets.push({
      id: "live-refresh",
      code: "<script>" + js.replace(/</g, "\\u003c") + "</script>",
      location: "head"
    });
  }
  // Where the form sends the customer after ordering: the site's published thank-you page, if it has one.
  // The site owner can pick a specific thank-you page, or turn the redirect off (settings.thanks_mode = "builtin");
  // otherwise the first published page of type "thanks" is used.
  const tmode = site.settings?.thanks_mode, tpage = site.settings?.thanks_page_id;
  let thanks = null;
  if (tmode !== "builtin") {
    if (tpage) {
      const { data: t1 } = await supabase.from("site_pages").select("slug").eq("site_id", site.id).eq("id", tpage).not("published_at", "is", null).maybeSingle();
      thanks = t1 ?? null;
    }
    if (!thanks) {
      const { data: t2 } = await supabase.from("site_pages").select("slug").eq("site_id", site.id).eq("kind", "thanks").not("published_at", "is", null).limit(1).maybeSingle();
      thanks = t2 ?? null;
    }
  }
  const { project: _p, ...pageOut } = page;
  // Serve smaller, faster images (see the note at the top). Skipped when the site opts out or ?raw=1 is passed.
  if (!rawImages && site.settings?.image_optimize !== false) {
    pageOut.html = optimizeHtml(pageOut.html);
    pageOut.css = optimizeUrlString(pageOut.css, IMG_WIDTH);
    if (product) {
      product.product_image_url = optimizeUrlString(product.product_image_url, IMG_THUMB_WIDTH);
      if (Array.isArray(product.tiers)) product.tiers = product.tiers.map((t)=>({
          ...t,
          image_url: optimizeUrlString(t.image_url, IMG_THUMB_WIDTH)
        }));
    }
  }
  return json({
    site: {
      id: site.id,
      name: site.name,
      slug: site.slug,
      purchase_event: site.purchase_event,
      settings: {
        ...site.settings,
        preview_token: undefined
      },
      thanks_slug: thanks ? thanks.slug : null
    },
    page: pageOut,
    product,
    pixel_id: pixelId,
    snippets,
    stamp
  }, 200, isOwner ? "no-store" : "public, max-age=30");
});
