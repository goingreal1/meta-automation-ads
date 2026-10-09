// Sales pages built by an assistant (ChatGPT / Claude through the Revora MCP).
// The assistant never writes layout code: it sends an ordered list of sections with its words and our image links, and this file
// turns them into the same ready-made blocks the visual builder uses (rv-* classes + data-rv-form), so the page is mobile-ready,
// takes orders for the linked product, fires the product's pixel, and can still be opened in the builder.
// No AI call happens here. Modes: page_brief, page_build, page_get, page_edit, page_publish, page_import_html.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SITE = "https://metaautomationads.vercel.app";
const FONT_Q: Record<string, string> = { "Inter": "Inter:wght@400;500;600;700;800", "Poppins": "Poppins:wght@400;500;600;700;800", "Montserrat": "Montserrat:wght@400;500;600;700;800", "DM Sans": "DM+Sans:wght@400;500;600;700", "Plus Jakarta Sans": "Plus+Jakarta+Sans:wght@400;500;600;700;800", "Playfair Display": "Playfair+Display:wght@500;600;700;800", "Fraunces": "Fraunces:wght@500;600;700", "Lora": "Lora:wght@400;500;600;700", "Nunito": "Nunito:wght@400;600;700;800", "Roboto": "Roboto:wght@400;500;700;900" };
const plain = (s: unknown, max: number) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const esc = (s: unknown, max = 400) => plain(s, max).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const list = (v: unknown, n: number) => (Array.isArray(v) ? v : []).slice(0, n);
const naira = (n: unknown) => "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");

// Look and section order per kind of product. The order is the point: each kind of buyer needs a different story.
const NICHES: Record<string, any> = {
  health: { theme: { primary: "#1a7a5e", heading: "Poppins", body: "Inter" }, look: "Trustworthy and calm: deep green with warm accents, big bold hook over a real photo, plenty of white space, real faces.",
    order: ["offerbar", "hero", "problem", "solution", "benefits", "before_after", "how_to", "testimonials", "offer", "packages", "trust", "guarantee", "faq", "form", "footer"],
    notes: ["Hero: ONE hook of 3-8 words that names the problem or the relief (e.g. 'Stop bloating', 'Ease your joint pain'); a time claim like 'in 7 days' is the seller's own claim, so only use one the seller gave, and mention that Meta and NAFDAC can limit time and result claims.", "Problem: describe it in the customer's own words, with a real-looking person in the problem moment.", "Solution: introduce the product and show the REAL pack photo; benefits as short ticks about comfort and support, no cures.", "Before/after only if the seller wants it and has real photos or illustrations; add a one-line disclaimer.", "Testimonials: ONLY real ones the seller gave you (set confirmed_real true). Never invent names, quotes or results.", "Put an order button after every image section (done automatically)."], disclaimer: "These statements have not been evaluated by NAFDAC. This product is not intended to diagnose, treat, cure or prevent any disease. Individual results may vary." },
  beauty: { theme: { primary: "#b5486b", heading: "Playfair Display", body: "Nunito" }, look: "Soft, premium, airy: blush or neutral palette, elegant serif headings, close-up glowing skin, generous spacing.",
    order: ["offerbar", "hero", "problem", "solution", "benefits", "how_to", "before_after", "testimonials", "packages", "guarantee", "faq", "form", "footer"],
    notes: ["Hero: a beautiful close-up with a short promise ('Glow starts here').", "No guaranteed skin results or skin-condition before/after.", "Show how to use it in 3 simple steps."], disclaimer: "Results vary from person to person. Patch test before first use." },
  fashion: { theme: { primary: "#111111", heading: "Montserrat", body: "Inter" }, look: "Editorial and bold: black and white with one accent, full-bleed model photos, sizes and colours clear, price visible.",
    order: ["offerbar", "hero", "text", "image", "benefits", "testimonials", "offer", "packages", "trust", "faq", "form", "footer"],
    notes: ["Hero: the collection or item on a model; hook = the occasion or feeling ('Owambe ready').", "Show several photos of the item (front, back, detail) as image sections; mention sizes and colours.", "Packages = sizes/bundles from the product tiers."], disclaimer: "" },
  food: { theme: { primary: "#e8590c", heading: "Nunito", body: "Poppins" }, look: "Warm and appetising: orange and cream, big close-up food photos, friendly rounded type, delivery info prominent.",
    order: ["offerbar", "hero", "text", "image", "benefits", "testimonials", "offer", "packages", "trust", "faq", "form", "footer"],
    notes: ["Hero: the dish, steaming and close.", "Say what is included, portion sizes, delivery area and time, only from the seller's facts.", "No pain or body-problem imagery and no health claims unless the product record has them."], disclaimer: "" },
  gadgets: { theme: { primary: "#2563eb", heading: "Plus Jakarta Sans", body: "Inter" }, look: "Clean and modern: white and blue, product on a plain background, spec icons, comparison and warranty.",
    order: ["offerbar", "hero", "benefits", "image", "how_to", "testimonials", "offer", "packages", "trust", "guarantee", "faq", "form", "footer"],
    notes: ["Lead with the main feature; list specs only from the product record.", "Warranty only if the seller gave it."], disclaimer: "" },
  home: { theme: { primary: "#0f766e", heading: "DM Sans", body: "Inter" }, look: "Bright and tidy: teal and white, lifestyle room shots.", order: ["offerbar", "hero", "problem", "solution", "benefits", "image", "testimonials", "packages", "trust", "faq", "form", "footer"], notes: ["Show the item in a real room."], disclaimer: "" },
  general: { theme: { primary: "#1a7a5e", heading: "Poppins", body: "Inter" }, look: "Clean and bold with brand colours.", order: ["offerbar", "hero", "problem", "solution", "benefits", "testimonials", "packages", "trust", "faq", "form", "footer"], notes: [], disclaimer: "" },
};
const IMAGE_NEEDS: Record<string, string> = { hero: "wide photo for the header background (optional but strongly recommended)", problem: "image of the person in the problem moment", solution: "image of the real product pack (use the product photo)", before_after: "before and after pictures", testimonials: "customer photos or screenshots, only real ones", image: "product or lifestyle photo" };

// ---- rendering --------------------------------------------------------------------------------------------------------
type Ctx = { cta: string; tiers: any[]; siteName: string; disclaimer: string; bold?: boolean };
const img = (u: unknown, alt: unknown) => (okUrl(u) ? `<img class="rv-img" src="${esc(u, 600)}" alt="${esc(alt, 120)}" loading="lazy">` : "");
const okUrl = (u: unknown) => /^https:\/\/[^\s"'<>]+$/.test(String(u ?? "")) && String(u).startsWith(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/`);
const paras = (v: unknown) => list(v, 8).map((p) => `<p class="rv-p">${esc(p, 600)}</p>`).join("");
const ticks = (v: unknown, mark = "") => `<ul class="rv-ticks">${list(v, 12).map((t) => `<li><span>${mark}${esc(t, 200)}</span></li>`).join("")}</ul>`;
const ctaBtn = (c: Ctx, text?: unknown) => c.bold ? blueCta(text || c.cta) : `<section class="rv-sec tight"><div class="rv-wrap narrow"><a class="rv-btn block" href="#order">${esc(text || c.cta, 60)}</a></div></section>`;

const br = (t: unknown, max = 200) => esc(t, max).split("|").join("<br>");
const tone = (t: unknown) => (/^[a-z ]{0,24}$/.test(String(t ?? "")) ? String(t ?? "") : "");
const hex6 = (v: unknown, d: string) => (/^#[0-9a-fA-F]{6}$/.test(String(v ?? "")) ? String(v) : d);
const bImg = (u: unknown, alt = "", st = "") => (okUrl(u) ? `<img class="rv-img" style="border-radius:0${st}" src="${esc(u, 600)}" alt="${esc(alt, 120)}" loading="lazy">` : "");
const embed = (url: unknown) => { const u = String(url ?? ""); let m = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(u); if (m) return `<iframe src="https://www.youtube-nocookie.com/embed/${m[1]}?rel=0&modestbranding=1&playsinline=1" title="Video" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen loading="lazy"></iframe>`; m = /vimeo\.com\/(?:video\/)?(\d+)/.exec(u); return m ? `<iframe src="https://player.vimeo.com/video/${m[1]}" title="Video" allow="fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>` : ""; };
const blueCta = (text?: unknown) => `<section class="rv-sec tight rv-center" style="padding-top:22px;padding-bottom:22px"><div class="rv-wrap narrow"><a class="rv-btn blue cart fit" href="#order">${esc(text || "Click Here To Order", 60)}</a></div></section>`;
const R: Record<string, (s: any, c: Ctx) => string> = {
  banner: (s) => `<section class="rv-banner" style="background:${hex6(s.color, "#a32a25")};padding:30px 16px"><div class="rv-wrap narrow"><h1 class="rv-bh" style="color:#f2f2f2;font-weight:700">${esc(s.text, 200)}</h1></div></section>`,
  headline: (s) => `<section class="rv-sec tight"><div class="rv-wrap narrow"><h2 class="rv-hc ${tone(s.tone)}">${br(s.text)}</h2></div></section>`,
  blue_cta: (s) => blueCta(s.text),
  reviews: (s) => `<section class="rv-sec tight"><div class="rv-wrap"><h2 class="rv-hc red fb" style="margin-bottom:22px;font-weight:800">${esc(s.title || "Check our customers honest review", 160)}</h2><div class="rv-cols c2 keep top" style="gap:14px">${list(s.images, 8).map((u) => bImg(u)).join("")}</div></div></section>`,
  warning: (s) => `<section class="rv-sec tight"><div class="rv-wrap narrow"><p class="rv-hc red up sm" style="margin:0">${esc(s.text, 300)}</p></div></section>`,
  video: (s) => { const e = embed(s.url); return e ? `<section class="rv-sec tight" style="padding-top:8px;padding-bottom:8px"><div class="rv-wrap"><div class="rv-vcard" style="border-radius:0;padding:16px 20px 22px"><div class="rv-stars">\u2605\u2605\u2605\u2605\u2605</div><h3 class="rv-hc" style="color:#0b0b0b;font-size:clamp(26px,7vw,36px);margin:6px 0 14px">${esc(s.title || "Happy customer", 80)}</h3><div class="rv-video" data-src="${esc(s.url, 300)}" data-ratio="16:9" style="border-radius:0">${e}</div></div></div></section>` : ""; },
  problems_list: (s) => `<section class="rv-sec rv-redsec" style="padding:34px 18px"><div class="rv-wrap narrow"><h2 class="rv-hc" style="margin-bottom:18px">${esc(s.title, 160)}</h2><ul class="rv-list x">${list(s.items, 10).map((t) => `<li>${esc(t, 260)}</li>`).join("")}</ul></div></section>`,
  guarantee_dark: (s) => `<section class="rv-sec rv-darksec" style="padding:30px 16px 36px"><div class="rv-wrap narrow"><h2 class="rv-hc up sm" style="font-weight:600">${esc(s.title, 220)}</h2>${bImg(s.image_url)}${s.subtitle ? `<h3 class="rv-hc sm">${esc(s.subtitle, 200)}</h3>` : ""}${s.note ? `<p class="rv-hc up sm" style="font-weight:600;margin:0">${esc(s.note, 240)}</p>` : ""}</div></section>`,
  promo: (s) => `<section class="rv-sec tight"><div class="rv-wrap narrow">${list(s.lines, 6).map((l) => `<p class="rv-hc sm">${esc(l, 200)}</p>`).join("")}</div></section>`,
  offerbar: (s) => `<div class="rv-top stick">${esc(s.text, 200)}</div>`,
  hero: (s, c) => `<section class="rv-sec rv-hero-img rv-center" style="background-image:linear-gradient(rgba(10,18,15,.58),rgba(10,18,15,.72))${okUrl(s.image_url) ? `,url('${esc(s.image_url, 600)}')` : ",linear-gradient(135deg,var(--p),#0f1413)"};background-size:cover;background-position:center;padding:96px 20px"><div class="rv-wrap narrow"><h1 class="rv-h1">${esc(s.headline, 140)}</h1>${s.subheadline ? `<p class="rv-lead">${esc(s.subheadline, 260)}</p>` : ""}<a class="rv-btn" href="#order">${esc(s.cta || c.cta, 60)}</a></div></section>`,
  problem: (s) => `<section class="rv-sec"><div class="rv-wrap narrow rv-story"><h2 class="rv-h2">${esc(s.title, 160)}</h2>${paras(s.paragraphs)}${s.bullets ? ticks(s.bullets, "✕ ") : ""}${img(s.image_url, s.image_alt || s.title)}</div></section>`,
  solution: (s) => `<section class="rv-sec alt"><div class="rv-wrap narrow rv-story"><h2 class="rv-h2">${esc(s.title, 160)}</h2>${paras(s.paragraphs)}${s.bullets ? ticks(s.bullets) : ""}${img(s.image_url, s.image_alt || s.title)}</div></section>`,
  text: (s) => `<section class="rv-sec"><div class="rv-wrap narrow rv-story">${s.title ? `<h2 class="rv-h2">${esc(s.title, 160)}</h2>` : ""}${paras(s.paragraphs)}${img(s.image_url, s.image_alt || s.title)}</div></section>`,
  image: (s) => `<section class="rv-sec tight"><div class="rv-wrap">${img(s.image_url, s.image_alt)}${s.caption ? `<p class="rv-sub rv-center">${esc(s.caption, 200)}</p>` : ""}</div></section>`,
  benefits: (s) => `<section class="rv-sec alt"><div class="rv-wrap narrow"><div class="rv-center"><h2 class="rv-h2">${esc(s.title || "Why people love it", 160)}</h2></div>${ticks(s.items)}</div></section>`,
  before_after: (s) => `<section class="rv-sec"><div class="rv-wrap"><div class="rv-center"><h2 class="rv-h2">${esc(s.title || "Before and after", 160)}</h2></div><div class="rv-cols top"><div><span class="rv-pill">${esc(s.before_label || "Before", 30)}</span>${img(s.before_url, "Before")}</div><div><span class="rv-pill">${esc(s.after_label || "After", 30)}</span>${img(s.after_url, "After")}</div></div>${s.note ? `<p class="rv-sub rv-center">${esc(s.note, 240)}</p>` : ""}</div></section>`,
  how_to: (s) => `<section class="rv-sec"><div class="rv-wrap narrow"><div class="rv-center"><h2 class="rv-h2">${esc(s.title || "How to use it", 160)}</h2></div><ul class="rv-ticks">${list(s.steps, 8).map((t, i) => `<li><span><b>Step ${i + 1}:</b> ${esc(t, 220)}</span></li>`).join("")}</ul></div></section>`,
  testimonials: (s) => { const it = list(s.items, 6).filter((x: any) => x?.quote && x?.name); return `<section class="rv-sec alt"><div class="rv-wrap"><div class="rv-center"><span class="rv-eyebrow">Real customers</span><h2 class="rv-h2">${esc(s.title || "What people are saying", 160)}</h2></div><div class="rv-cols ${it.length >= 3 ? "c3" : ""} top">${it.map((x: any) => `<div class="rv-card rv-tcard">${okUrl(x.image_url) ? `<img class="rv-img rv-tph" src="${esc(x.image_url, 600)}" alt="">` : ""}<div class="rv-tb"><div class="rv-stars">★★★★★</div><p class="rv-quote">“${esc(x.quote, 400)}”</p><div class="rv-who"><div><b>${esc(x.name, 60)}</b>${esc(x.place, 60)}</div></div></div></div>`).join("")}</div></div></section>`; },
  offer: (s) => `<section class="rv-sec tight"><div class="rv-wrap narrow"><div class="rv-pricebox rv-center"><h3 class="rv-h3">${esc(s.title, 120)}</h3>${s.text ? `<p class="rv-p">${esc(s.text, 300)}</p>` : ""}</div></div></section>`,
  packages: (s, c) => {
    if (!c.tiers.length) return "";
    if (c.bold || s.style === "cards") { const bars = ["#d3d78f", "#e8002d", "#eee84a"], was = list(s.was_prices, 6); return `<section class="rv-sec tight" id="packages" style="padding-top:18px"><div class="rv-wrap"><div class="rv-cols auto top" style="gap:44px">${c.tiers.map((t, n) => `<div class="rv-pkg3"><div class="bar" style="background:${bars[n % 3]}">${esc(t.badge || (n === 0 ? "Starter Pack" : "Package " + (n + 1)), 40)}</div><div class="q">${esc(t.label, 60)}</div>${bImg(t.image_url)}${(() => { const fs = String(t.features ?? "").split(/[\n;,]+/).map((f) => f.trim()).filter(Boolean).slice(0, 6); return fs.length ? `<ul>${fs.map((f) => `<li>${esc(f, 120)}</li>`).join("")}</ul>` : ""; })()}<span class="now">${naira(t.price_naira)}</span>${was[n] ? `<span class="was">${esc(was[n], 20)}</span>` : ""}<a class="rv-btn pill cart" href="#order" data-rv-tier="${n + 1}">${esc(s.button || "Order this", 40)}</a></div>`).join("")}</div></div></section>`; }
    return `<section class="rv-sec" id="packages"><div class="rv-wrap"><div class="rv-center"><span class="rv-eyebrow">Special offer</span><h2 class="rv-h2">${esc(s.title || "Choose your package", 120)}</h2></div><div class="rv-cols auto top">${c.tiers.map((t, n) => `<div class="rv-card" style="text-align:center;padding:22px">${t.badge ? `<span class="rv-pill">${esc(t.badge, 30)}</span>` : ""}<h3 class="rv-h3">${esc(t.label, 60)}</h3><p class="rv-price">${naira(t.price_naira)}</p>${t.features ? `<p class="rv-sub">${esc(t.features, 200)}</p>` : ""}<a class="rv-btn block" href="#order" data-rv-tier="${n + 1}">Order this</a></div>`).join("")}</div></div></section>`;
  },
  trust: (s) => `<section class="rv-sec tight"><div class="rv-wrap narrow">${ticks(s.items)}</div></section>`,
  guarantee: (s) => `<section class="rv-sec tight"><div class="rv-wrap narrow"><div class="rv-guar"><div class="em">🛡️</div><div><h3 class="rv-h3">${esc(s.title || "Our promise to you", 120)}</h3><p class="rv-p" style="margin:0">${esc(s.text, 300)}</p></div></div></div></section>`,
  faq: (s) => `<section class="rv-sec"><div class="rv-wrap narrow rv-faq"><div class="rv-center"><span class="rv-eyebrow">Questions</span><h2 class="rv-h2">${esc(s.title || "Frequently asked questions", 120)}</h2></div>${list(s.items, 10).filter((x: any) => x?.q && x?.a).map((x: any) => `<details><summary>${esc(x.q, 200)}</summary><p>${esc(x.a, 500)}</p></details>`).join("")}</div></section>`,
  form: (s, c) => s.notice || c.bold ? `<section class="rv-sec tight" id="order" style="padding-top:34px"><div class="rv-wrap narrow"><h2 class="rv-hc red fb up" style="font-weight:800;font-size:clamp(28px,7.6vw,40px);margin-bottom:22px">${esc(s.title || "Fill this form to order", 120)}</h2>${list(s.notice, 3).length ? `<div class="rv-formbox">${list(s.notice, 3).map((p) => `<p>${esc(p, 300)}</p>`).join("")}</div><div style="height:26px"></div>` : ""}<div data-rv-form="1" data-rv-button="${esc(s.button || "Submit Form", 40)}"></div></div></section>` : `<section class="rv-sec alt" id="order"><div class="rv-wrap narrow"><div class="rv-center"><span class="rv-eyebrow">Order now</span><h2 class="rv-h2">${esc(s.title || "Fill the form to order", 120)}</h2><p class="rv-sub">Pay on delivery</p></div><div data-rv-form="1"></div></div></section>`,
  footer: (s, c) => (s.dark || c.bold) ? `<footer class="rv-foot-dark" style="padding-bottom:96px"><p>Copyright \u00a9 <span data-rv-year>2026</span> ${esc(c.siteName, 80)}. All rights reserved.</p>${(s.disclaimer ?? c.disclaimer) ? `<h2 class="rv-hc">DISCLAIMER</h2><p style="margin:0">${esc(s.disclaimer ?? c.disclaimer, 400)}</p>` : ""}</footer>` : `<footer class="rv-footer"><p style="margin:0 0 6px">&copy; <span data-rv-year>2026</span> ${esc(c.siteName, 80)}. All rights reserved.</p>${(s.disclaimer ?? c.disclaimer) ? `<p style="margin:0;font-size:12px;opacity:.8">${esc(s.disclaimer ?? c.disclaimer, 400)}</p>` : ""}</footer>`,
  cta: (s, c) => ctaBtn(c, s.text),
};
const HAS_IMAGE = new Set(["problem", "solution", "text", "image", "before_after", "reviews", "video", "guarantee_dark"]);

export function renderPage(spec: any, c: Ctx): { html: string; warnings: string[]; needs_images: string[] } {
  const warnings: string[] = [], needs: string[] = [];
  let secs: any[] = list(spec?.sections, 30).filter((s) => s && R[s.type]);
  secs = secs.filter((s) => {
    if (["testimonials", "reviews", "video"].includes(s.type) && s.confirmed_real !== true) { warnings.push("Customer testimonials, review screenshots and videos were left out: they must be real ones the seller gave you, with confirmed_real true."); return false; }
    if (s.type === "packages" && !c.tiers.length) { warnings.push("No package cards: this product has no packages yet (add them in Revora under Products)."); return false; }
    return true;
  });
  if (!secs.some((s) => s.type === "form")) secs.push({ type: "form" });
  if (!secs.some((s) => s.type === "footer")) secs.push({ type: "footer" });
  const out: string[] = [];
  secs.forEach((s, i) => {
    if (s.type === "hero" && !okUrl(s.image_url)) needs.push("hero (background image)");
    if (["problem", "solution", "before_after"].includes(s.type) && !okUrl(s.image_url) && !(s.type === "before_after" && okUrl(s.before_url) && okUrl(s.after_url))) needs.push(`${s.type} (${IMAGE_NEEDS[s.type]})`);
    out.push(R[s.type](s, c));
    const nxt = secs[i + 1]?.type;
    if (spec?.auto_cta !== false && HAS_IMAGE.has(s.type) && (okUrl(s.image_url) || okUrl(s.before_url) || list(s.images, 8).some(okUrl) || s.type === "video") && nxt !== "cta" && nxt !== "blue_cta" && nxt !== "form" && s.type !== "hero") out.push(ctaBtn(c));
  });
  if (spec?.auto_cta !== false) out.push(`<div class="rv-sticky rv-float"><a class="rv-btn block${c.bold ? " cart" : ""}" href="#order">${esc(c.bold ? (c.cta === "Order now" ? "CLICK HERE TO ORDER NOW !!!" : c.cta) : c.cta, 60)}</a></div>`);
  return { html: out.join("\n"), warnings, needs_images: needs };
}

const THANKS = (name: string) => `<section class="rv-sec rv-center"><div class="rv-wrap narrow"><div class="rv-ico" style="width:72px;height:72px;font-size:36px;border-radius:50%">✓</div><h1 class="rv-h2">Thank you, your order is in!</h1><p class="rv-lead">A team member will contact you shortly to confirm your order and delivery details.</p><div data-rv-bank="1"></div><p class="rv-sub">Reference: <b data-rv-ref="1"></b></p></div></section>\n<footer class="rv-footer"><p style="margin:0">&copy; <span data-rv-year>2026</span> ${esc(name, 80)}.</p></footer>`;

function themeOf(niche: string, t: any, bold = false) {
  const base = bold ? { primary: "#e0301e", heading: "Roboto", body: "Montserrat" } : (NICHES[niche] ?? NICHES.general).theme, hex = (v: any, d: string) => (/^#[0-9a-fA-F]{6}$/.test(String(v ?? "")) ? String(v) : d);
  const th = { primary: hex(t?.primary, base.primary), heading: FONT_Q[t?.heading] ? t.heading : base.heading, body: FONT_Q[t?.body] ? t.body : base.body };
  const fams = [...new Set([th.heading, th.body])].map((f) => "family=" + FONT_Q[f]).join("&");
  return { ...th, fonts_url: `https://fonts.googleapis.com/css2?${fams}&display=swap`, css: `:root{--p:${th.primary};--r:12px;--fh:'${th.heading}',system-ui,sans-serif;--fb:'${th.body}',system-ui,sans-serif}\n.rv-hero-img h1{text-shadow:0 2px 14px rgba(0,0,0,.4)}.rv-card{box-shadow:0 6px 24px rgba(0,0,0,.06)}${bold ? ".rv-sec .rv-img{border-radius:0}" : ""}` };
}

// Safe import of a finished HTML page the assistant wrote: styles are KEPT (moved into the page css), scripts and handlers are removed.
export function importHtml(raw: string) {
  let h = String(raw || "").slice(0, 400_000);
  const css = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n").replace(/@import[^;]+;/gi, "").replace(/expression\(|javascript:|behavior:/gi, "").slice(0, 200_000);
  const fonts = [...h.matchAll(/<link[^>]+href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["'][^>]*>/gi)].map((m) => `<link rel="stylesheet" href="${m[1].replace(/"/g, "")}">`).join("");
  const body = (h.match(/<body([^>]*)>([\s\S]*?)<\/body>/i) ?? []);
  const attrs = body[1] ?? "";
  h = body[2] ?? h.replace(/<head[\s\S]*?<\/head>/i, "").replace(/<\/?(html|body)[^>]*>/gi, "");
  h = h.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<(script|object|noscript|template)\b[\s\S]*?<\/\1>/gi, "").replace(/<\/?(script|object|noscript|template|embed|base|meta|link)\b[^>]*>/gi, "").replace(/<iframe\b(?![^>]*src=["']https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\/)[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/(href|src|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"').replace(/<form\b[^>]*>/gi, '<div data-rv-form="1">').replace(/<\/form>/gi, "</div>");
  const cls = (attrs.match(/class=["']([^"']*)["']/i) ?? [])[1] ?? "", sty = (attrs.match(/style=["']([^"']*)["']/i) ?? [])[1] ?? "";
  return { html: h.trim(), css, head_html: fonts, body_class: cls.slice(0, 120), body_style: sty.replace(/url\(|expression/gi, "").slice(0, 300) };
}

// Every page must belong to a media buyer, or the orders it takes belong to nobody and the buyer never sees them.
// Their own buyer record first (a buyer, or a personal workspace owner); otherwise the company's only active buyer.
async function pickBuyer(admin: SupabaseClient, companyId: string, userId: string): Promise<{ id: string | null; warning?: string }> {
  const { data: me } = await admin.from("profiles").select("media_buyer_id").eq("id", userId).maybeSingle();
  if (me?.media_buyer_id) return { id: me.media_buyer_id };
  const { data: bs } = await admin.from("media_buyers").select("id").eq("company_id", companyId).eq("active", true).limit(2);
  if ((bs ?? []).length === 1) return { id: bs![0].id };
  return { id: null, warning: "No media buyer is attached to this page, so its orders will not show under any buyer. Ask the person which media buyer owns the page and set it in Revora (Websites) before publishing." };
}

// ---- modes ------------------------------------------------------------------------------------------------------------
export async function handlePage(admin: SupabaseClient, mode: string, b: any, companyId: string, userId: string): Promise<{ status: number; body: any }> {
  const ok = (body: any) => ({ status: 200, body: { ok: true, ...body } }), bad = (error: string, status = 400) => ({ status, body: { error } });
  const niche = NICHES[b.niche] ? b.niche : "general";

  if (mode === "page_brief") {
    const n = NICHES[niche];
    return ok({ niche, look: n.look, section_order: n.order, section_notes: n.notes, images_needed: IMAGE_NEEDS, theme: n.theme, default_disclaimer: n.disclaimer || null,
      sections: { offerbar: "{text}", hero: "{headline, subheadline?, image_url?, cta?}", problem: "{title, paragraphs[], bullets[]?, image_url?, image_alt?}", solution: "{title, paragraphs[], bullets[]?, image_url?}", benefits: "{title?, items[]}", before_after: "{title?, before_url, after_url, note?}", how_to: "{title?, steps[]}", testimonials: "{title?, items:[{quote,name,place?,image_url?}], confirmed_real:true}", offer: "{title, text?}", packages: "{title?} (cards come from the product's packages)", trust: "{items[]}", guarantee: "{title?, text}", faq: "{title?, items:[{q,a}]}", form: "{title?}", footer: "{disclaimer?}", text: "{title?, paragraphs[], image_url?}", image: "{image_url, caption?}", cta: "{text?}" },
      looks: { classic: "Clean modern page (default).", bold: "Direct-response sales letter, the style Nigerian health sellers use: red banner, huge centered headlines, big images, blue and red order buttons after every block, review screenshots, video testimonials, red symptom list, dark guarantee, price cards with crossed-out prices, red notice above the form, dark disclaimer footer. Set spec.style to 'bold' to use it." }, bold_order: ["banner", "headline (the 7-day promise)", "image (hero)", "story", "blue_cta", "reviews", "warning", "headline", "video", "video", "headline", "blue_cta", "problems_list", "headline", "image (offer)", "blue_cta", "headline", "image (benefits)", "blue_cta", "headline", "reviews (more)", "blue_cta", "image (pack)", "headline", "image (100% safe seal)", "headline", "guarantee_dark", "blue_cta", "headline (how much)", "promo", "image (cash on delivery stamp)", "warning (only order if ready to pay)", "packages (price cards)", "form (with notice)", "footer (dark)"], bold_sections: { banner: "{text, color?}", headline: "{text (use | for a line break), tone?: 'red'|'up'|'red up'|'sm'|'left fb sm'}", blue_cta: "{text?}", reviews: "{title?, images[] (real screenshots), confirmed_real:true}", warning: "{text}", video: "{title?, url (YouTube or Vimeo), confirmed_real:true}", problems_list: "{title, items[]}", guarantee_dark: "{title, image_url?, subtitle?, note?}", promo: "{lines[]}", packages: "{button?, was_prices?: ['\u20a639,000', ...]} (cards use the product's packages and their images)", form: "{title?, notice?: [paragraphs], button?}", footer: "{disclaimer?}" },

      assistant_instructions: ["RUN THIS AS AN INTERVIEW, NOT A GUESS. Never build from a one-line request.", "Step 1: in plain words, narrate the whole page section by section (use section_guide), saying for each what it will say and which picture it needs. Mark each picture as: I HAVE IT (usable_images), I CAN MAKE IT (generate_image with the real product photo), or I NEED IT FROM YOU (customer photos, review screenshots, videos).", "Step 2: ask the questions in ONE short message (see questions): who suffers and how, how long, what they tried, how it is used, price and packages, delivery, guarantee, which claims the seller is happy to make, real testimonials. Give a suggested answer where you can so they only have to say yes or fix it.", "Step 3: make the missing pictures with generate_image (use_product_photo true when the pack is shown), view_image each one, and re-make any with garbled text or a wrong pack. Never use a picture where the pack label looks wrong; use the real product photo instead.", "Step 4: write the two long stories (problem, then solution) using story_formula and show them to the person for approval before building. Keep their words, their language (English or Pidgin) and their facts.", "Step 5: call build_sales_page without confirmed, explain the summary, build only after a clear yes, then share the test_link and ask for feedback section by section, applying changes with edit_sales_page."],
      questions: ["Who is this for (age, gender, situation) and what exactly do they suffer?", "How long have they usually had it, and what have they tried before?", "What is the one promise or hook you want at the very top? (only claims you are happy to stand by)", "How do people use the product (dose, time, how long)? What can they honestly expect?", "Prices and packages: what offers do you run, and is there a real guarantee or free delivery?", "Do you have REAL customer testimonials, chat or review screenshots, or video links I may use? (If not, we skip them and add them later.)", "Any NAFDAC number, delivery areas or delivery time to show?"],
      story_formula: { problem_story: "About 250 to 400 words in 4 to 6 short paragraphs: (1) a moment the reader recognises, in their own words; (2) what it costs them day to day (food, clothes, work, mood, relationships); (3) what they have already tried and why it left them tired of trying; (4) normalise it, they are not alone and it is not their fault; (5) close with a question that turns toward the solution. No fear tactics, no medical diagnosis, no guaranteed results.", solution_story: "About 200 to 300 words in 3 to 5 short paragraphs: (1) introduce the product plainly and who it is for; (2) what it is and how it is used, using only the seller's facts; (3) why it fits the problem just described, in careful words about support and comfort; (4) what to expect and to be consistent, no cure or timeframe unless the seller gave one; (5) reassurance: pay on delivery, delivery, any real guarantee, then a call to action.", voice: "Short sentences, simple words, one idea per paragraph, talk to one person ('you'). Match the seller's language and tone. Read it aloud: if it sounds like a brochure, simplify it." },
      section_guide: { banner: { purpose: "Stop the scroll by naming the problem as a question.", ask: "What is the problem in the customer's own words?", image: "none" }, headline: { purpose: "State the promise or introduce the product.", ask: "Is there a promise or timeframe you can stand behind?", image: "none" }, image: { purpose: "Show the person in the problem moment, or the real pack.", ask: "Do you have a photo? Otherwise I can make one.", image: "problem photo, offer image, or pack" }, text: { purpose: "The long problem story (see story_formula).", ask: "Tell me their daily struggle and what they have tried.", image: "optional" }, blue_cta: { purpose: "A button after each block so the buyer never has to scroll back.", ask: "none", image: "none" }, problems_list: { purpose: "Let the reader tick off symptoms so they say 'that is me'.", ask: "List 4 to 6 signs your customers describe.", image: "none" }, solution: { purpose: "The solution story with the real pack.", ask: "How is it used, and what makes it different?", image: "real product photo" }, benefits: { purpose: "3 to 5 short benefits in comfort and support words.", ask: "What do customers say they like?", image: "none" }, reviews: { purpose: "Proof: real chat or review screenshots.", ask: "Send the screenshots you have permission to use.", image: "the screenshots" }, video: { purpose: "Proof: a real customer video.", ask: "Send a YouTube or Vimeo link.", image: "none" }, guarantee_dark: { purpose: "Remove fear with a real guarantee.", ask: "Do you really offer a refund or replacement, and on what terms?", image: "seal (optional)" }, promo: { purpose: "Real urgency or bonuses, only if true.", ask: "Is there a real deadline, stock limit or free bonus?", image: "none" }, packages: { purpose: "Price cards from the product packages.", ask: "Which packages and crossed-out prices are real?", image: "package pictures (set on the product)" }, form: { purpose: "Take the order; ready to pay notice.", ask: "Any special note before they order?", image: "none" }, footer: { purpose: "Business name and disclaimer.", ask: "Business name to show?", image: "none" } },
      rules: ["Write every word yourself from the product facts; never invent prices, results, numbers, testimonials, certifications or NAFDAC numbers.", "Image urls must be Revora links (creative vault, product photo, generated previews). Never use pictures from other websites.", "An order button is added after every image section and a floating button is added automatically.", "The order form, packages, pixel and thank-you page are linked to the product automatically."] });
  }

  const sid = String(b.site_id ?? "");
  const loadSite = async () => { const { data } = await admin.from("sites").select("id, name, slug, status, product_id, settings").eq("id", sid).eq("company_id", companyId).maybeSingle(); return data; };
  // Links use the company's own connected domain when it has one (the domain's main site opens at its root, other sites at /s/<slug>), else the platform address.
  const links = async (s: any) => {
    const { data: doms } = await admin.from("site_domains").select("hostname, site_id").eq("company_id", companyId).eq("status", "active").order("created_at");
    const d = (doms ?? []).find((x: any) => x.site_id === s.id) ?? (doms ?? [])[0];
    const base = d ? `https://${d.hostname}${d.site_id === s.id ? "" : `/s/${s.slug}`}` : `${SITE}/s/${s.slug}`;
    return { site_id: s.id, builder_link: `${SITE}/builder.html?site=${s.id}`, test_link: `${base}${d && d.site_id === s.id ? "/" : ""}?preview=1&pt=${s.settings?.preview_token ?? ""}`, live_link: s.status === "published" ? (base + (d && d.site_id === s.id ? "/" : "")) : null, address: d ? d.hostname : "platform address", status: s.status };
  };

  if (mode === "page_build") {
    const spec = b.spec ?? {};
    const { data: prod } = await admin.from("products").select("id, product_name, company_id").eq("id", String(b.product_id ?? "")).eq("company_id", companyId).maybeSingle();
    if (!prod) return bad("Product not found.");
    const buyer = await pickBuyer(admin, companyId, userId);
    const { data: tiers } = await admin.from("product_tiers").select("label, price_naira, features, badge, image_url").eq("product_id", prod.id).eq("is_active", true).order("sort_order", { ascending: true });
    const bold = spec.style === "bold";
    const th = themeOf(niche, spec.theme, bold);
    const r = renderPage(spec, { cta: plain(spec.cta, 60) || "Order now", tiers: tiers ?? [], siteName: plain(b.business_name, 80) || prod.product_name, disclaimer: NICHES[niche].disclaimer, bold });
    if (!r.html) return bad("No sections to build.");
    const summary = { sections: list(spec.sections, 30).map((s: any) => s?.type), warnings: [...r.warnings, ...(buyer.warning ? [buyer.warning] : [])], still_needs_images: r.needs_images, packages_found: (tiers ?? []).length };
    if (b.dry) return ok({ dry_run: true, not_saved_yet: true, ...summary });
    let s: any;
    if (sid) { s = await loadSite(); if (!s) return bad("Page not found.", 404); await admin.from("sites").update({ settings: { ...(s.settings ?? {}), theme: { fonts_url: th.fonts_url, primary: th.primary, heading: th.heading, body: th.body } }, updated_at: new Date().toISOString() }).eq("id", s.id); } else {
      const base = prod.product_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "page";
      for (let i = 0; i < 4 && !s; i++) { const slug = `${base}-${crypto.randomUUID().slice(0, 4)}`; const { data, error } = await admin.from("sites").insert({ company_id: companyId, name: plain(b.title, 80) || `${prod.product_name} page`, slug, status: "draft", product_id: prod.id, media_buyer_id: buyer.id, settings: { theme: { fonts_url: th.fonts_url, primary: th.primary, heading: th.heading, body: th.body }, niche, preview_token: crypto.randomUUID().replace(/-/g, "") } }).select("id, name, slug, status, product_id, settings").single(); if (!error) s = data; }
      if (!s) return bad("Could not create the site. Try again.", 500);
    }
    const page = { title: plain(b.title, 80) || prod.product_name, html: r.html, css: th.css, project: null, seo: { title: plain(spec.seo_title, 70) || plain(b.title, 70) || prod.product_name, description: plain(spec.seo_description, 160), noindex: true, spec } };
    const { data: ex } = await admin.from("site_pages").select("id, project").eq("site_id", s.id).eq("slug", "").maybeSingle();
    if (ex?.project) return bad("This page was edited in the visual builder, so rebuilding it here would overwrite those edits. Edit it in the builder, or build a new page.", 409);
    if (ex) await admin.from("site_pages").update({ ...page, updated_at: new Date().toISOString() }).eq("id", ex.id);
    else await admin.from("site_pages").insert({ site_id: s.id, company_id: companyId, slug: "", kind: "page", ...page });
    const { data: th2 } = await admin.from("site_pages").select("id").eq("site_id", s.id).eq("kind", "thanks").maybeSingle();
    if (!th2) await admin.from("site_pages").insert({ site_id: s.id, company_id: companyId, slug: "thank-you", kind: "thanks", title: "Thank you", html: THANKS(plain(b.business_name, 80) || prod.product_name), css: th.css, seo: { noindex: true } });
    return ok({ saved: true, ...(await links(s)), ...summary, next: "Draft saved and linked to the product (order form, packages, pixel and a thank-you page are included). Send the test_link to people to review, then change anything with edit_sales_page. Nothing is live until publish_sales_page." });
  }

  if (mode === "page_import_html") {
    const { data: prod } = await admin.from("products").select("id, product_name").eq("id", String(b.product_id ?? "")).eq("company_id", companyId).maybeSingle();
    if (!prod) return bad("Product not found.");
    const buyer = await pickBuyer(admin, companyId, userId);
    const im = importHtml(b.html);
    if (!im.html) return bad("That HTML had no page content.");
    const hasForm = im.html.includes("data-rv-form");
    const summary = { characters_of_html: im.html.length, characters_of_css: im.css.length, fonts_kept: !!im.head_html, order_form_present: hasForm, buyer_attached: !!buyer.id, ...(buyer.warning ? { buyer_warning: buyer.warning } : {}), note: hasForm ? "" : "No order form found: add a <div data-rv-form></div> where the form should go, or the page cannot take orders." };
    if (b.dry) return ok({ dry_run: true, not_saved_yet: true, ...summary });
    const base = prod.product_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "page";
    const { data: s, error } = await admin.from("sites").insert({ company_id: companyId, name: plain(b.title, 80) || `${prod.product_name} page`, slug: `${base}-${crypto.randomUUID().slice(0, 4)}`, status: "draft", product_id: prod.id, media_buyer_id: buyer.id, settings: { preview_token: crypto.randomUUID().replace(/-/g, "") } }).select("id, name, slug, status, product_id, settings").single();
    if (error || !s) return bad("Could not create the site.", 500);
    await admin.from("site_pages").insert({ site_id: s.id, company_id: companyId, slug: "", kind: "page", title: plain(b.title, 80) || prod.product_name, html: im.html, css: im.css, seo: { custom_html: true, noindex: true, head_html: im.head_html, body_class: im.body_class, body_style: im.body_style } });
    await admin.from("site_pages").insert({ site_id: s.id, company_id: companyId, slug: "thank-you", kind: "thanks", title: "Thank you", html: THANKS(prod.product_name), css: "", seo: { noindex: true } });
    return ok({ saved: true, ...(await links(s)), ...summary, next: "Imported with its styles kept. Check it with the test_link. Opening it in the visual builder may rearrange custom styling, so edit this one by sending changed HTML again." });
  }

  if (mode === "page_get") {
    if (!sid) { const { data } = await admin.from("sites").select("id, name, slug, status, settings, product_id").eq("company_id", companyId).order("created_at", { ascending: false }).limit(20); return ok({ sites: await Promise.all((data ?? []).map(async (s: any) => ({ name: s.name, ...(await links(s)) }))) }); }
    const s = await loadSite(); if (!s) return bad("Page not found.", 404);
    const { data: pages } = await admin.from("site_pages").select("slug, kind, title, project, seo, published_at").eq("site_id", s.id);
    const home = (pages ?? []).find((p: any) => p.slug === "");
    return ok({ name: s.name, ...(await links(s)), pages: (pages ?? []).map((p: any) => ({ slug: p.slug, kind: p.kind, title: p.title, published: !!p.published_at })), sections: list(home?.seo?.spec?.sections, 30).map((x: any, i: number) => ({ index: i, type: x?.type, preview: plain(x?.headline ?? x?.title ?? x?.text ?? (x?.paragraphs ?? [])[0] ?? "", 90) })), edited_in_builder: !!home?.project, custom_html: !!home?.seo?.custom_html });
  }

  if (mode === "page_edit") {
    const s = await loadSite(); if (!s) return bad("Page not found.", 404);
    const { data: home } = await admin.from("site_pages").select("id, project, seo, css").eq("site_id", s.id).eq("slug", "").maybeSingle();
    if (!home?.seo?.spec) return bad("This page was not built by the assistant (or was imported), so it can't be edited section by section here.");
    if (home.project) return bad("This page was edited in the visual builder; change it there, so those edits are not lost.", 409);
    const spec = JSON.parse(JSON.stringify(home.seo.spec));
    spec.sections = list(spec.sections, 30);
    for (const o of list(b.ops, 12)) {
      const i = Number(o?.index);
      if (o?.op === "set" && spec.sections[i] && o.fields && typeof o.fields === "object") spec.sections[i] = { ...spec.sections[i], ...o.fields, type: spec.sections[i].type };
      else if (o?.op === "add" && R[o?.section?.type]) spec.sections.splice(Number.isInteger(i) ? Math.min(Math.max(i + 1, 0), spec.sections.length) : spec.sections.length, 0, o.section);
      else if (o?.op === "remove" && spec.sections[i]) spec.sections.splice(i, 1);
      else if (o?.op === "move" && spec.sections[i] && Number.isInteger(Number(o.to))) { const [x] = spec.sections.splice(i, 1); spec.sections.splice(Math.min(Math.max(Number(o.to), 0), spec.sections.length), 0, x); }
    }
    if (b.theme) spec.theme = { ...(spec.theme ?? {}), ...b.theme };
    return handlePage(admin, "page_build", { ...b, site_id: s.id, spec, product_id: s.product_id, niche: s.settings?.niche ?? niche, title: b.title }, companyId, userId);
  }

  if (mode === "page_publish") {
    const s = await loadSite(); if (!s) return bad("Page not found.", 404);
    const { data: pages } = await admin.from("site_pages").select("html").eq("site_id", s.id);
    if (!(pages ?? []).some((p: any) => String(p.html).includes("data-rv-form"))) return bad("This page has no order form, so it can't take orders yet.");
    if (b.dry) return ok({ dry_run: true, not_saved_yet: true, will_go_live_at: (await links({ ...s, status: "published" })).live_link });
    const now = new Date().toISOString();
    await admin.from("sites").update({ status: b.unpublish ? "draft" : "published", updated_at: now }).eq("id", s.id);
    await admin.from("site_pages").update({ published_at: b.unpublish ? null : now }).eq("site_id", s.id);
    return ok({ ...(await links({ ...s, status: b.unpublish ? "draft" : "published" })), note: b.unpublish ? "Page taken offline." : "Page is live. noindex stays on until you turn search indexing on in the builder." });
  }
  return bad("Unknown mode");
}
