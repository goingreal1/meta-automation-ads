import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AI site builder. The model never writes HTML: it only
//   plan  -> picks which of OUR ready-made blocks to use, in order, plus brand colours and fonts
//   copy  -> rewrites the text of those blocks for the product (text only, keyed by node id)
//   edit  -> turns a plain-English instruction about one element into a few safe operations
// Everything it returns is validated here and again in the builder, so a page can't be broken or injected into.
//
//   POST { mode, ... } + Authorization: Bearer <signed-in user's token>

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const DAILY_LIMIT = Number(Deno.env.get("AI_BUILDER_DAILY_LIMIT") ?? "60");
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

const FONTS = ["Inter", "Poppins", "Montserrat", "DM Sans", "Plus Jakarta Sans", "Playfair Display", "Fraunces", "Lora", "Nunito", "Roboto"];
const STYLE_PROPS = new Set(["color", "background-color", "font-size", "font-weight", "text-align", "padding", "padding-top", "padding-bottom", "padding-left", "padding-right", "margin", "margin-top", "margin-bottom", "border-radius", "width", "max-width", "letter-spacing", "line-height", "text-transform", "border", "box-shadow", "opacity", "background-image", "text-decoration", "font-style"]);
const SAFE_VALUE = /^[#a-zA-Z0-9%.,()\s\-+/'"]{1,160}$/;

function cleanStyle(s: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s || typeof s !== "object") return out;
  for (const [k0, v0] of Object.entries(s)) {
    const k = String(k0).toLowerCase(), v = String(v0 ?? "").trim();
    if (!STYLE_PROPS.has(k) || !v || !SAFE_VALUE.test(v) || /url\(|expression|@import|javascript|var\(--/i.test(v)) continue;
    if (k === "background-image" && !/^linear-gradient\(/i.test(v)) continue;
    out[k] = v;
  }
  return out;
}
const hex = (v: any, d: string) => (/^#[0-9a-fA-F]{6}$/.test(String(v ?? "")) ? String(v) : d);
const plain = (s: any, max: number) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);

async function ask(system: string, user: string, model: string, max = 3500): Promise<any> {
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: 0.5, max_tokens: max, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (res.ok) {
      const j = await res.json();
      try { return JSON.parse(j.choices?.[0]?.message?.content ?? "{}"); } catch { throw new Error("The AI answered in a way I couldn't read. Please try again."); }
    }
    const t = await res.text().catch(() => "");
    let code = "", msg = "";
    try { const e = JSON.parse(t)?.error; code = String(e?.code ?? e?.type ?? ""); msg = String(e?.message ?? ""); } catch { /* not json */ }
    lastErr = `${res.status} ${code} ${msg}`.trim();
    console.error("OpenAI error", model, lastErr);
    if (res.status === 429 && /quota|billing/i.test(code + msg)) throw new Error("The AI account has run out of credit. Please top up the OpenAI billing, then try again.");
    if (res.status === 401) throw new Error("The AI key on the server isn't valid. Please check the OPENAI_API_KEY secret.");
    if (res.status === 404 || /model/i.test(code)) throw new Error(`The AI model "${model}" isn't available for this key (${code || res.status}).`);
    if (res.status < 500 && res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error(`The AI service is busy (${lastErr.slice(0, 120) || "no details"}). Please try again in a moment.`);
}

const RULES = `Hard rules for all copy:
- Use ONLY facts given in the product data. Never invent prices, discounts, quantities, delivery times, certifications, ingredients, awards, review quotes or customer names.
- Never make medical claims (cure, treat, heal, guaranteed results). Describe support and comfort in careful, honest words.
- Plain text only. No HTML, no markdown. Keep each text about the same length as the original (never more than about 1.5x).
- Friendly, clear, persuasive English suitable for Nigerian online shoppers; no slang that is hard to read.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!OPENAI_API_KEY) return json({ error: "AI isn't set up on the server yet." }, 503);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Please sign in again." }, 401);
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return json({ error: "Please sign in again." }, 401);
  const { data: prof } = await admin.from("profiles").select("company_id").eq("id", u.user.id).maybeSingle();
  if (!prof?.company_id) return json({ error: "No company on this account." }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const mode = String(body.mode || "");
  if (!["plan", "copy", "edit"].includes(mode)) return json({ error: "Unknown mode" }, 400);

  // daily limit per company (a page build = 2 calls, an edit = 1)
  const { data: row } = await admin.from("ai_builder_usage").select("n").eq("company_id", prof.company_id).eq("day", new Date().toISOString().slice(0, 10)).maybeSingle();
  const used = row?.n ?? 0;
  if (used >= DAILY_LIMIT) return json({ error: `You've used today's AI limit (${DAILY_LIMIT} requests). It resets tomorrow.` }, 429);
  await admin.from("ai_builder_usage").upsert({ company_id: prof.company_id, day: new Date().toISOString().slice(0, 10), n: used + 1 });

  const product = body.product && typeof body.product === "object" ? {
    name: plain(body.product.name, 120), price: plain(body.product.price, 40), description: plain(body.product.description, 600), benefits: plain(body.product.benefits, 600),
    packages: (Array.isArray(body.product.packages) ? body.product.packages : []).slice(0, 8).map((t: any) => ({ label: plain(t.label, 60), price: plain(t.price, 30), features: plain(t.features, 200) })),
  } : null;
  const productText = product ? `PRODUCT DATA (the only facts you may use):\n${JSON.stringify(product)}` : "No product is connected, so write generic, honest copy and do not state any price.";

  try {
    if (mode === "plan") {
      const catalog = (Array.isArray(body.catalog) ? body.catalog : []).slice(0, 200).map((b: any) => ({ id: String(b.id), label: plain(b.label, 60), category: plain(b.category, 30) }));
      const ids = new Set(catalog.map((b: any) => b.id));
      const system = `You design high-converting, clean sales pages for cash-on-delivery products by choosing from a fixed list of ready-made blocks.
Return JSON: {"summary": "one friendly sentence on what you built", "theme": {"primary": "#RRGGBB", "heading": one of ${JSON.stringify(FONTS)}, "body": one of the same list}, "blocks": ["block-id", ...]}.
Rules: choose 8 to 16 block ids ONLY from the catalog, in page order. Start with an attention block (a top bar or hero/headline), tell the story (benefits, proof, reviews), show the offer/packages, then the order form ("order-form" or "sp-form"), then a footer. Include exactly one order form. Use at most one of each block unless repeating a call-to-action button. Pick a brand colour that suits the product and the user's wishes (strong, readable on white).`;
      const out = await ask(system, `${productText}\n\nUSER REQUEST: ${plain(body.prompt, 800)}\n\nBLOCK CATALOG:\n${JSON.stringify(catalog)}`, "gpt-4o");
      let blocks: string[] = (Array.isArray(out.blocks) ? out.blocks : []).map(String).filter((id: string) => ids.has(id));
      blocks = blocks.filter((id, i) => blocks.indexOf(id) === i || /cta|button|float/.test(id)).slice(0, 18);
      const formId = ["order-form", "sp-form"].find((f) => ids.has(f));
      if (formId && !blocks.some((b) => b === "order-form" || b === "sp-form")) blocks.push(formId);
      if (!blocks.length) return json({ error: "I couldn't pick blocks for that. Try describing the product and the style you like." }, 422);
      return json({ ok: true, summary: plain(out.summary, 240), theme: { primary: hex(out.theme?.primary, "#1a7a5e"), heading: FONTS.includes(out.theme?.heading) ? out.theme.heading : "Poppins", body: FONTS.includes(out.theme?.body) ? out.theme.body : "Inter" }, blocks });
    }

    if (mode === "copy") {
      const nodes = (Array.isArray(body.nodes) ? body.nodes : []).slice(0, 140).map((n: any) => ({ id: String(n.id), tag: plain(n.tag, 10), text: plain(n.text, 240) })).filter((n: any) => n.id && n.text);
      const system = `You rewrite the text of a sales page so it fits the product. You get a list of text slots (id, tag, current text) and the product data.
Return JSON: {"texts": {"<id>": "new text", ...}}. Include a slot only if you change it; keep all others as they are. Headings (h1-h3) are short and punchy; paragraphs are 1-2 sentences; list items are short benefits; button texts are 2-4 action words (for example "Order now"). Keep package names, prices and quantities exactly as they appear.
${RULES}`;
      const out = await ask(system, `${productText}\n\nUSER'S WISHES: ${plain(body.prompt, 600)}\n\nTEXT SLOTS:\n${JSON.stringify(nodes)}`, "gpt-4o", 5000);
      const byId: Record<string, any> = Object.fromEntries(nodes.map((n: any) => [n.id, n]));
      const texts: Record<string, string> = {};
      for (const [id, v] of Object.entries(out.texts ?? {})) { const n = byId[id]; if (!n) continue; const t = plain(v, Math.max(60, Math.round(n.text.length * 1.6) + 40)); if (t) texts[id] = t; }
      return json({ ok: true, texts });
    }

    // edit
    const catalog = (Array.isArray(body.catalog) ? body.catalog : []).slice(0, 200).map((b: any) => ({ id: String(b.id), label: plain(b.label, 60) }));
    const t = body.target || {};
    const system = `You edit ONE part of a sales page for a non-technical person, by returning a few safe operations as JSON:
{"say": "one short friendly sentence describing what you did", "ops": [ ... ]}
Allowed ops:
- {"op":"set_text","text":"new plain text"}  (replaces the text of the selected element)
- {"op":"set_style","style":{"color":"#hex","background-color":"#hex","font-size":"28px","font-weight":"700","text-align":"center","padding":"20px","border-radius":"16px","background-image":"linear-gradient(135deg,#f97316,#ec4899)", ...}}
  (only CSS properties in this list: ${[...STYLE_PROPS].join(", ")})
- {"op":"add_block","id":"<block id from the catalog>","where":"after"|"before"}  (adds a ready-made block next to the section that contains the selection)
- {"op":"delete"}  (removes the selected element; use only if the person clearly asks)
- {"op":"set_link","href":"#order"|"#packages"|"https://..."}  (only for buttons/links)
If the request is unclear or impossible with these ops, return {"say":"<a short question or explanation>","ops":[]}.
Prefer the smallest change that does what was asked. For colours use readable contrast.
${RULES}`;
    const out = await ask(system, `${productText}\n\nSELECTED ELEMENT: ${JSON.stringify({ tag: plain(t.tag, 10), kind: plain(t.kind, 20), text: plain(t.text, 400), classes: plain(t.classes, 120), section: plain(t.section, 80) })}\n\nPAGE OUTLINE (top to bottom): ${JSON.stringify((Array.isArray(body.outline) ? body.outline : []).slice(0, 30).map((o: any) => plain(o, 60)))}\n\nBLOCK CATALOG:\n${JSON.stringify(catalog)}\n\nTHE PERSON SAYS: ${plain(body.instruction, 600)}`, "gpt-4o", 1500);
    const ids = new Set(catalog.map((b: any) => b.id));
    const ops: any[] = [];
    for (const o of (Array.isArray(out.ops) ? out.ops : []).slice(0, 6)) {
      if (o?.op === "set_text") { const x = plain(o.text, 600); if (x) ops.push({ op: "set_text", text: x }); }
      else if (o?.op === "set_style") { const s = cleanStyle(o.style); if (Object.keys(s).length) ops.push({ op: "set_style", style: s }); }
      else if (o?.op === "add_block" && ids.has(String(o.id))) ops.push({ op: "add_block", id: String(o.id), where: o.where === "before" ? "before" : "after" });
      else if (o?.op === "delete") ops.push({ op: "delete" });
      else if (o?.op === "set_link" && /^(#[a-z0-9_-]{1,40}|https?:\/\/[^\s"'<>]{1,300})$/i.test(String(o.href ?? ""))) ops.push({ op: "set_link", href: String(o.href) });
    }
    return json({ ok: true, say: plain(out.say, 300), ops });
  } catch (e: any) {
    return json({ error: e.message || "Something went wrong." }, 502);
  }
});
