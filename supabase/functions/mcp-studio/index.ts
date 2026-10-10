// Revora MCP tool group "mcp-studio": pictures (generate, import, keep, view) and sales pages.
// Generated from the original single-file mcp function; see mcp/index.ts for the router that calls this.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const SITE = "https://metaautomationads.vercel.app";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, accept, x-client-info, apikey",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
const jres = (obj: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });

type Tool = {
  name: string; title: string; description: string; inputSchema: any;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  meta?: Record<string, unknown>; // client hints, e.g. ChatGPT file inputs
  write?: boolean; // counted against the daily limit and written to the audit log
  heavy?: boolean; // launches ads: tighter daily limit
  run: (a: any, c: Ctx) => Promise<any>;
};
type Ctx = { token: string; userId: string; email: string | null; companyId: string; role: string; mediaBuyerId: string | null; displayName: string };

const str = (d: string) => ({ type: "string", description: d });
const accountProp = { ad_account_id: str("Which ad account (id from list_ad_accounts). Optional when the person has only one.") };
const normName = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const pickProd = (prods: any[], name: unknown, loose = false) => { const n = normName(name); let m = prods.filter((p) => normName(p.product_name) === n); if (!m.length && loose) m = prods.filter((p) => normName(p.product_name).includes(n)); return m.find((p) => p.product_image_url) ?? m[0] ?? null; };
const OBJ = (properties: any, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

async function fn(name: string, body: unknown, c: Ctx) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, { method: "POST", headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { error: `Unexpected reply (${r.status})` }; }
}

async function pickAccount(a: any, c: Ctx): Promise<{ id: string; name: string } | { error: string }> {
  let q = admin.from("ad_accounts").select("id, name, nickname, media_buyer_id").eq("company_id", c.companyId);
  if (c.role === "buyer") q = q.eq("media_buyer_id", c.mediaBuyerId);
  const { data } = await q;
  const list = data ?? [];
  const want = String(a?.ad_account_id ?? "");
  if (want) {
    const hit = list.find((x: any) => x.id === want);
    return hit ? { id: hit.id, name: hit.nickname || hit.name || hit.id } : { error: "That ad account was not found or is not yours. Call list_ad_accounts." };
  }
  if (list.length === 1) return { id: list[0].id, name: list[0].nickname || list[0].name || list[0].id };
  return { error: list.length ? "More than one ad account. Ask which one, using list_ad_accounts, then pass ad_account_id." : "This person has no ad account connected yet." };
}

async function chatTool(tool: string, args: any, c: Ctx, needAccount: boolean) {
  let ad_account_id: string | undefined;
  if (needAccount) {
    const acct = await pickAccount(args, c);
    if ("error" in acct) return { error: acct.error };
    ad_account_id = acct.id;
  }
  const r = await fn("ai-chat", { action: "run_tool", tool, args, ad_account_id }, c);
  if (r?.error) return { error: r.error };
  return { ...(Array.isArray(r?.result) ? { items: r.result } : r?.result && typeof r.result === "object" ? r.result : { result: r?.result }), ...(r?.cards?.length ? { cards: r.cards } : {}) };
}

const naira = (n: unknown) => "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");
const isAdminRole = (c: Ctx) => c.role === "owner" || c.role === "admin";

const NICHES: Record<string, any> = {
  health: { look: "Dark green/gold or green/yellow, bold painted-brush headline, clean and trustworthy.", human: "A real Nigerian adult in the situation the product helps (holding the stomach, knee, back) plus, if the person wants it, the relieved smiling version. Never a doctor in a white coat, never made-up testimonials.", layout: ["top: scroll-stopping hook, 3-7 words, big", "middle: the person, in the problem moment", "front: the REAL product pack, large, label readable", "3-4 short benefit ticks (comfort, easy to use, natural ingredients)", "bottom bar: delivery / pay on delivery / call to action"], hooks: ["Bloated after every meal?", "Hard to climb stairs?", "Tired of the same pain?", "Stop the struggle. Ease it.", "Your gut deserves the best."], cta: ["Click Order", "Order now, pay on delivery", "Chat us on WhatsApp"], badges: ["Pay on delivery", "Free/fast delivery", "NAFDAC number (only if it is on the product record)"], avoid: ["Do not claim cures, guaranteed results or timeframes you were not given", "Meta often limits before-and-after pictures, body-change claims and 'no side effects': they were asked for, so make them only if the person wants, and tell them the risk", "Never invent a NAFDAC number"] },
  beauty: { look: "Soft, bright, glowing, premium; warm neutrals or the brand colour.", human: "A close, well-lit face or hands showing the product; diverse Nigerian skin tones.", layout: ["hook at top", "glowing model with the product", "2-4 benefit icons", "offer or price strip", "call-to-action"], hooks: ["Glow starts here.", "Your skin, but better.", "Soft, smooth, every day."], cta: ["Order now", "Shop the glow"], badges: ["Pay on delivery", "NAFDAC (if on record)", "Gentle on skin"], avoid: ["No guaranteed skin results", "No before-and-after of skin conditions"] },
  fashion: { look: "Bold, stylish, colourful or editorial; the clothes are the hero.", human: "A model WEARING the item, full or three-quarter body, confident pose, Nigerian street or studio setting. Show the real fabric and colour.", layout: ["short hook or collection name", "model wearing it, large", "price or offer badge", "sizes/colours line", "call-to-action with delivery"], hooks: ["New drop.", "Turn heads today.", "Owambe ready.", "Your size is waiting."], cta: ["Order on WhatsApp", "Shop now, pay on delivery"], badges: ["Delivery nationwide", "Sizes available", "Pay on delivery"], avoid: ["Do not change the item's colour or pattern from the real photo", "No health or body-fix claims"] },
  food: { look: "Warm, appetising, close-up, steam and texture; bright colours.", human: "Hands serving or someone enjoying the food; no pain scenes.", layout: ["mouth-watering hook", "hero food shot, close", "price and what is included", "delivery area and time", "order button"], hooks: ["Hot, fresh, at your door.", "Craving something tasty?", "Weekend special."], cta: ["Order now", "Chat to order"], badges: ["Delivery in your area", "Fresh daily", "Pay on delivery"], avoid: ["Never use pain, bloating or body-problem imagery", "Do not promise health benefits unless the product record says so"] },
  gadgets: { look: "Clean, modern, high contrast, product on a simple background.", human: "Someone using the item happily (earbuds in, phone in hand).", layout: ["feature-led hook", "product large with 3 key specs", "price or discount", "warranty/delivery", "call-to-action"], hooks: ["Power that lasts.", "Upgrade today.", "See the difference."], cta: ["Order now", "Buy now, pay on delivery"], badges: ["Warranty (if on record)", "Fast delivery", "Pay on delivery"], avoid: ["Do not invent specs", "No health claims"] },
  home: { look: "Bright, tidy, aspirational room or kitchen scene.", human: "A person enjoying the space or using the item.", layout: ["problem or benefit hook", "the item in a real room", "3 benefits", "price/offer", "call-to-action"], hooks: ["Make your home feel new.", "Cook faster, stress less."], cta: ["Order now", "Chat to order"], badges: ["Delivery", "Pay on delivery"], avoid: ["Do not invent features"] },
  general: { look: "Clean and bold, brand colours, easy to read on a phone.", human: "A person who matches the buyer, using or enjoying the product.", layout: ["hook at top", "product and person", "3 benefits", "call-to-action"], hooks: ["Meet your new favourite.", "Why wait? Order today."], cta: ["Order now"], badges: ["Delivery", "Pay on delivery"], avoid: ["Do not invent claims"] },
};
const nicheOf = (text: string): string => {
  const t = text.toLowerCase();
  if (/pain|joint|digest|bloat|constipat|capsule|herbal|balm|supplement|wellness|detox|vitamin|immune|diabet|prostate|fibroid|ointment|syrup|health|tingling|neuro/.test(t)) return "health";
  if (/skin|serum|hair|lotion|soap|makeup|beauty|glow|cosmetic|perfume|fragrance|cream/.test(t)) return "beauty";
  if (/cloth|dress|shirt|wear|fashion|gown|shoe|sneaker|\bbags?\b|ankara|senator|jean|fabric|lace|abaya|thrift|native/.test(t)) return "fashion";
  if (/\bfood|rice|jollof|snack|cake|pastry|\bchop|soup|meal|drink|juice|bakery|catering|shawarma|pizza|grill|suya|spice/.test(t)) return "food";
  if (/phone|laptop|gadget|charger|earbud|watch|electronic|speaker|power ?bank|camera/.test(t)) return "gadgets";
  if (/furniture|kitchen|\bhome\b|\bbed\b|decor|appliance|blender|cooker|mattress/.test(t)) return "home";
  return "general";
};

const TOOLS: Tool[] = [
  { name: "generate_image", title: "Generate ad images", description: "Make 1 to 4 new images (default 1, drafted at low quality to keep cost down; ask for quality high only for the final one) from the person's own description, with Revora's image model. They are NOT saved as creatives yet: show the preview table, ask which they like, then call approve_generated_image for the ones to keep (or discard_generated_image). Generate what the person asks for; the tool adds a short heads-up if Meta tends to reject something, but never refuse for that reason. Set use_product_photo true to base the picture on the product's own photo so the packaging looks right. Call get_creative_brief first for the right look for this kind of product, and pass 2 to 4 of the person's old creatives as style_reference_urls to copy their layout and hooks.", inputSchema: OBJ({ prompt: str("What the picture should show, in the person's own words (style, scene, text on it, colours)"), count: { type: "number", description: "How many options, 1 to 4. Default 1." }, quality: { type: "string", enum: ["low", "medium", "high"], description: "Default low for drafts. Use high only for a final version the person liked." }, size: { type: "string", enum: ["portrait", "square", "landscape"], description: "portrait suits Facebook and Instagram feeds and stories. Default portrait." }, product_name: str("The product this is for. Needed for use_product_photo and to attach the image to it when approved."), use_product_photo: { type: "boolean", description: "Use the product's own photo as the reference." }, reference_url: str("A real photo of the product to base the picture on: the preview_url from import_chat_image. Use this when the person gave you a sample photo of the real product."), style_reference_urls: { type: "array", items: { type: "string" }, description: "2 to 4 of the person's OLD creatives (urls from list_creatives) whose layout, fonts, colours, hook style and call-to-action should be copied for the new picture." } }, ["prompt"]), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, write: true,
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can generate images." };
      const key = Deno.env.get("OPENAI_API_KEY") ?? "";
      if (!key) return { error: "Image generation is not switched on for this workspace yet." };
      const prompt = String(a?.prompt ?? "").trim().slice(0, 3000);
      if (prompt.length < 5) return { error: "Describe the picture you want." };
      const n = Math.min(Math.max(Math.round(Number(a?.count) || 1), 1), 4);
      const cap = Number(Deno.env.get("IMAGE_DAILY_CAP") ?? "40");
      const { data: used } = await admin.from("mcp_audit").select("args").eq("user_id", c.userId).eq("tool", "generate_image").eq("ok", true).gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
      const already = (used ?? []).reduce((t: number, r: any) => t + Math.min(Math.max(Math.round(Number(r.args?.count) || 1), 1), 4), 0);
      if (already + n > cap) return { error: `Daily image limit reached (${cap} a day, ${already} used). It resets 24 hours after each request.` };
      const quality = ["low", "medium", "high"].includes(a?.quality) ? a.quality : "low";
      const size = a?.size === "square" ? "1024x1024" : a?.size === "landscape" ? "1536x1024" : "1024x1536";
      const model = Deno.env.get("IMAGE_MODEL") ?? "gpt-image-1";
      const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      let product: any = null;
      if (a?.product_name) { const { data: prods } = await admin.from("products").select("id, product_name, product_image_url").eq("company_id", c.companyId); product = pickProd(prods ?? [], a.product_name); }
      let res: Response;
      const genBase = `${SUPABASE_URL}/storage/v1/object/public/creative-vault/generated/${c.companyId}/`;
      const refUrl = a?.reference_url ? String(a.reference_url) : a?.use_product_photo === true && product?.product_image_url ? product.product_image_url : "";
      if (a?.reference_url && !refUrl.startsWith(genBase)) return { error: "reference_url must be a preview_url from import_chat_image." };
      const styles: string[] = [...new Set<string>((Array.isArray(a?.style_reference_urls) ? a.style_reference_urls : []).map(String))].slice(0, 4);
      if (styles.length) { // only the company's own creatives (or its generated previews) may be used as style references
        const { data: own } = await admin.from("creative_library").select("url").eq("company_id", c.companyId).in("url", styles);
        const okUrls = new Set((own ?? []).map((r: any) => r.url));
        const bad = styles.filter((u) => !okUrls.has(u) && !u.startsWith(genBase));
        if (bad.length) return { error: "style_reference_urls must be this company's own creatives from list_creatives." };
      }
      if (refUrl || styles.length) {
        const fd = new FormData(); fd.append("model", model); fd.append("n", String(n)); fd.append("size", size); fd.append("quality", quality);
        let count = 0;
        for (const u of [...(refUrl ? [refUrl] : []), ...styles]) {
          const im = await fetch(u); if (!im.ok) return { error: "Could not read one of the reference pictures." };
          const ct = (im.headers.get("content-type") ?? "image/png").split(";")[0];
          fd.append("image[]", new Blob([await im.arrayBuffer()], { type: ct }), `ref${++count}.${ct.includes("jpeg") ? "jpg" : ct.includes("webp") ? "webp" : "png"}`);
        }
        if (refUrl) fd.append("input_fidelity", "high");
        const lead = (refUrl ? "Image 1 is the REAL product pack: keep its shape, colours, logo and label text exactly as they are. " : "") + (styles.length ? `${refUrl ? "The other images are" : "The images are"} past ads from this seller: copy their layout, type style, colour palette, badge and call-to-action style, but make a NEW ad. ` : "");
        fd.append("prompt", lead + prompt);
        res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd });
      } else {
        res = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, prompt, n, size, quality }) });
      }
      const j: any = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(j?.data) || !j.data.length) return { error: "The image model could not make that: " + String(j?.error?.message ?? `status ${res.status}`).slice(0, 300) + " (If this says the key has no access to the image model, the workspace owner needs to enable it.)" };
      const out: any[] = [];
      for (const d of j.data) {
        let bytes: Uint8Array | null = null;
        if (d.b64_json) bytes = Uint8Array.from(atob(d.b64_json), (ch) => ch.charCodeAt(0));
        else if (d.url) { const r = await fetch(d.url); if (r.ok) bytes = new Uint8Array(await r.arrayBuffer()); }
        if (!bytes) continue;
        const path = `generated/${c.companyId}/${crypto.randomUUID()}.png`;
        const up = await admin.storage.from("creative-vault").upload(path, bytes, { contentType: "image/png" });
        if (up.error) return { error: "Could not store the image: " + up.error.message };
        out.push({ number: out.length + 1, preview_url: admin.storage.from("creative-vault").getPublicUrl(path).data.publicUrl });
      }
      if (!out.length) return { error: "The image model returned nothing usable. Try again." };
      const heads = /before.{0,6}after|cure|heal(s|ing)?\b|weight.?loss|lose weight|diabet|cancer|belly fat|no side effects?|guarantee/i.test(prompt) ? "Heads-up: Meta often rejects or limits ads with before-and-after pictures, body changes, 'no side effects', guarantees or medical-cure claims. It was made as asked; the person decides." : undefined;
      const table = ["| # | Preview |", "|---|---|", ...out.map((x) => `| ${x.number} | ![#${x.number}](${x.preview_url}) [open](${x.preview_url}) |`)].join("\n");
      return { made: out.length, not_saved_yet: true, for_product: product?.product_name ?? null, table_markdown: table, options: out, heads_up: heads, note: "These are NOT saved as creatives yet. Show table_markdown exactly (pictures only from preview_url, never other images), ask which they like or what to change. To keep one call approve_generated_image with its preview_url; to remake with changes call generate_image again with their feedback; to drop one call discard_generated_image." };
    } },
  { name: "import_chat_image", title: "Use an image from this chat", description: "Bring a picture that is already in this chat (one the person uploaded, or one YOU made with your own image tool) into Revora as a preview. This costs Revora nothing, so prefer it: make the picture yourself, then pass it here. Pass the picture as image; image_url only if you were given a public link. It is NOT saved as a creative yet: show the preview, ask if they want it, then call approve_generated_image with the preview_url and product_name. Do not use it for the product's own packshot; that stays the product photo.", inputSchema: OBJ({ image: { type: "object", description: "The picture from the chat (file input).", properties: { download_url: { type: "string" }, file_id: { type: "string" } } }, image_url: str("A public link to the picture, only if image is not available") }, []), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, write: true, meta: { "openai/fileParams": ["image"] },
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can add images." };
      const src = String(a?.image?.download_url ?? a?.image_url ?? "");
      if (!/^https:\/\//.test(src)) return { error: "I did not receive the picture. Ask the person to upload it, or use generate_image instead." };
      const host = (() => { try { return new URL(src).hostname; } catch { return ""; } })();
      if (!host || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || host.endsWith(".internal") || host.endsWith(".local")) return { error: "That link is not a public picture link." };
      const r = await fetch(src).catch(() => null);
      if (!r?.ok) return { error: "Could not download the picture (the link may have expired). Send it again." };
      const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[type];
      if (!ext) return { error: "Only png, jpg or webp pictures are supported here." };
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > 10 * 1024 * 1024) return { error: "That picture is over 10 MB. Send a smaller one." };
      const path = `generated/${c.companyId}/${crypto.randomUUID()}.${ext}`;
      const up = await admin.storage.from("creative-vault").upload(path, bytes, { contentType: type });
      if (up.error) return { error: "Could not store the picture: " + up.error.message };
      const url = admin.storage.from("creative-vault").getPublicUrl(path).data.publicUrl;
      return { not_saved_yet: true, preview_url: url, table_markdown: `| Preview |\n|---|\n| ![preview](${url}) [open](${url}) |`, note: "Not saved as a creative yet. Show table_markdown exactly, ask if they want to keep it and for which product, then call approve_generated_image with preview_url and product_name." };
    } },
  { name: "get_creative_brief", title: "Creative brief for this product's kind of ad", description: "Call this BEFORE generate_image. It works out what kind of product this is (health, beauty, fashion, food, gadgets, home) and returns the layout, hook ideas, human shot, call-to-action, trust badges and what to avoid for THAT kind of product, plus the real product facts you may use. Then ask the person which style they want (problem and relief, before and after, product hero, lifestyle or offer) and which 2 to 4 of their OLD creatives to copy the look from (use list_creatives, then pass those urls as style_reference_urls). Write the image prompt from this brief; use only the facts it lists.", inputSchema: OBJ({ product_name: str("The product"), niche: { type: "string", enum: ["health", "beauty", "fashion", "food", "gadgets", "home", "general"], description: "Only if the automatic guess is wrong." }, style: { type: "string", enum: ["problem_relief", "before_after", "product_hero", "lifestyle", "offer"], description: "The look the person chose." } }, ["product_name"]), annotations: { readOnlyHint: true },
    run: async (a, c) => {
      const [{ data: prods }, { data: co }] = await Promise.all([admin.from("products").select("product_name, product_image_url, default_order_value_naira, description, benefits, nafdac_reg_no, destination_type").eq("company_id", c.companyId), admin.from("companies").select("business_types").eq("id", c.companyId).maybeSingle()]);
      const p = pickProd(prods ?? [], a?.product_name, true);
      if (!p) return { error: `No product called "${a?.product_name}".` };
      const kind = a?.niche && NICHES[a.niche] ? a.niche : nicheOf(`${p.product_name} ${p.description ?? ""} ${p.benefits ?? ""} ${JSON.stringify(co?.business_types ?? "")}`);
      const r = NICHES[kind];
      const facts = { name: p.product_name, price_naira: p.default_order_value_naira ?? null, benefits: p.benefits ?? null, description: p.description ?? null, nafdac_reg_no: p.nafdac_reg_no ?? null, orders_via: p.destination_type ?? null, has_product_photo: !!p.product_image_url };
      const styleNote = a?.style === "before_after" ? "Split layout: BEFORE (problem moment) on the left, AFTER (relieved, smiling) on the right, product in front. Meta often limits before-and-after ads, so tell the person this risk once; it is their call." : a?.style === "problem_relief" ? "One scene showing the problem moment, the product large in front, benefit ticks, no after picture. Usually safer on Meta than before-and-after." : a?.style === "lifestyle" ? "A person enjoying life with the product, minimal text." : a?.style === "offer" ? "Product plus a clear price/discount badge and delivery line." : "Product large and clear, short hook, benefit ticks.";
      return { niche: kind, guessed: !a?.niche, recipe: r, facts_you_may_use: facts, style: a?.style ?? "ask the person", style_note: styleNote, prompt_template: `Square or portrait social ad for ${p.product_name}. Layout, top to bottom: ${r.layout.join("; ")}. Look: ${r.look} People: ${r.human} Hook (exact words, keep short and spelled correctly): "<your hook>". Call to action (exact words): "<cta>". Use only these facts and words, nothing invented. The product pack must match the reference photo exactly (shape, colours, label).`, next: ["Show the person the niche you detected and ask if it is right.", "Ask which style they want and which 2-4 old creatives to copy (list_creatives; pass their urls as style_reference_urls).", "Fill the template with ONE short hook, the facts above, and call generate_image with use_product_photo true.", "view_image the result: check the pack and every word are correct and spelled right. If text is garbled or the pack looks different, say so and regenerate with shorter text.", "Only use claims, numbers and NAFDAC numbers that appear in facts_you_may_use."] };
    } },
  { name: "get_sales_page_brief", title: "Brief for building a sales page", description: "Call this BEFORE building a sales page, after the product is chosen or added with create_product. It detects the kind of product (health, beauty, fashion/shoes, food, gadgets, home, general), and returns the section order, look, notes, section formats, the product facts you may use, whether packages exist, and the Revora image links you may use (product photo and creatives). Then follow its assistant_instructions: narrate the page section by section, ask the questions it lists (hook, story facts, testimonials, images, offers), generate missing pictures, write the long problem and solution stories with its story_formula, get approval, and only then build.", inputSchema: OBJ({ product_name: str("The product"), niche: { type: "string", enum: ["health", "beauty", "fashion", "food", "gadgets", "home", "general"], description: "Only if the automatic guess is wrong." } }, ["product_name"]), annotations: { readOnlyHint: true },
    run: async (a, c) => {
      const [{ data: prods }, { data: co }, { data: lib }] = await Promise.all([admin.from("products").select("id, product_name, product_image_url, default_order_value_naira, description, benefits, nafdac_reg_no, destination_type").eq("company_id", c.companyId), admin.from("companies").select("business_types").eq("id", c.companyId).maybeSingle(), admin.from("creative_library").select("url, kind, product_key, source").eq("company_id", c.companyId).limit(300)]);
      const p = pickProd(prods ?? [], a?.product_name, true); if (!p) return { error: `No product called "${a?.product_name}" yet. Do NOT stop: call list_products, and if it is not there, ask the person for the name and price (photo optional), call create_product to add it (confirm first), then continue.`, needs_product: true };
      const kind = a?.niche && NICHES[a.niche] ? a.niche : nicheOf(`${p.product_name} ${p.description ?? ""} ${p.benefits ?? ""} ${JSON.stringify(co?.business_types ?? "")}`);
      const r: any = await fn("ai-site-builder", { mode: "page_brief", niche: kind }, c); if (r?.error) return r;
      const { count: tiers } = await admin.from("product_tiers").select("id", { count: "exact", head: true }).eq("product_id", p.id).eq("is_active", true);
      const imgs = (lib ?? []).filter((x: any) => x.kind === "image" && x.source === "vault" && x.product_key === normName(p.product_name)).map((x: any) => x.url).slice(0, 12);
      return { ...r, niche: kind, guessed: !a?.niche, product_id: p.id, facts_you_may_use: { name: p.product_name, price_naira: p.default_order_value_naira ?? null, benefits: p.benefits ?? null, description: p.description ?? null, nafdac_reg_no: p.nafdac_reg_no ?? null }, packages_exist: (tiers ?? 0) > 0, usable_images: { product_photo: p.product_image_url ?? null, creatives: imgs, note: "Only these Revora links work in a page. To make new pictures use generate_image (use_product_photo true) then pass its preview_url." }, next: ["Confirm the kind of product and the hook with the person.", "Ask for real testimonials (text or screenshots) they have permission to use; never invent any.", "Choose or generate images for the hero, problem and solution sections; view_image to check them.", "Write the sections and call build_sales_page (it shows a summary first and saves only after a clear yes)."] };
    } },
  { name: "build_sales_page", title: "Build a sales page (asks for confirmation)", description: "Turn your sections into a finished, mobile-ready sales page saved as a DRAFT, linked to the product (order form, packages, pixel and a thank-you page are added automatically). ALWAYS call first WITHOUT confirmed to get a summary (sections, missing images, warnings); show it plainly and call again with confirmed true only after a clear yes. Returns a test_link to send to people for feedback and a builder_link. Never goes live by itself. Section formats come from get_sales_page_brief.", inputSchema: OBJ({ product_name: str("The product"), title: str("Page name, e.g. 'Lunessa sales page'"), niche: { type: "string", enum: ["health", "beauty", "fashion", "food", "gadgets", "home", "general"] }, spec: { type: "object", description: "{ theme?: {primary?, heading?, body?}, cta?: 'Order now', seo_title?, seo_description?, auto_cta?: true, sections: [ {type:'hero', headline, subheadline, image_url, cta}, ... ] }" }, confirmed: { type: "boolean", description: "True ONLY after the person clearly said yes to the summary." } }, ["product_name", "spec"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true,
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can build pages." };
      const { data: prods } = await admin.from("products").select("id, product_name, product_image_url, description, benefits").eq("company_id", c.companyId); const p = pickProd(prods ?? [], a?.product_name, true); if (!p) return { error: `No product called "${a?.product_name}" yet. Do NOT stop: call list_products, and if it is not there, ask the person for the name and price (photo optional), call create_product to add it (confirm first), then continue.`, needs_product: true };
      const r: any = await fn("ai-site-builder", { mode: "page_build", product_id: p.id, niche: a?.niche ?? nicheOf(`${p.product_name} ${p.description ?? ""} ${p.benefits ?? ""}`), title: a?.title, spec: a?.spec, dry: a?.confirmed !== true }, c);
      return r?.dry_run ? { ...r, needs_confirmation: true, next: "NOT saved yet. Show this summary in plain words (sections, anything missing like images), then ask. Call again with confirmed true only after a clear yes." } : r;
    } },
  { name: "import_html_page", title: "Use your own HTML as a sales page (asks for confirmation)", description: "Save a finished HTML page you wrote as a draft sales page linked to the product. Styles are kept (CSS, Google fonts, body styles); scripts and event handlers are removed for safety. Put <div data-rv-form></div> (or a <form>) where the order form should go; it is linked to the product automatically. Prefer build_sales_page for a page that stays editable in Revora's builder; use this when the person wants exactly the design you wrote. ALWAYS call first WITHOUT confirmed.", inputSchema: OBJ({ product_name: str("The product"), title: str("Page name"), html: str("The full HTML document"), confirmed: { type: "boolean", description: "True ONLY after the person clearly said yes." } }, ["product_name", "html"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true,
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can build pages." };
      const { data: prods } = await admin.from("products").select("id, product_name, product_image_url").eq("company_id", c.companyId); const p = pickProd(prods ?? [], a?.product_name, true); if (!p) return { error: `No product called "${a?.product_name}" yet. Do NOT stop: call list_products, and if it is not there, ask the person for the name and price (photo optional), call create_product to add it (confirm first), then continue.`, needs_product: true };
      const r: any = await fn("ai-site-builder", { mode: "page_import_html", product_id: p.id, title: a?.title, html: a?.html, dry: a?.confirmed !== true }, c);
      return r?.dry_run ? { ...r, needs_confirmation: true, next: "NOT saved yet. Tell the person what will be kept and any note, then ask. Call again with confirmed true only after a clear yes." } : r;
    } },
  { name: "get_sales_page", title: "Look at a sales page", description: "Without site_id: list the person's pages with their test and live links. With site_id: the page's sections (index, type, preview), pages (including the thank-you page) and links, so you can review it and decide changes.", inputSchema: OBJ({ site_id: str("From build_sales_page or the list") }, []), annotations: { readOnlyHint: true }, run: (a, c) => fn("ai-site-builder", { mode: "page_get", site_id: a?.site_id }, c) },
  { name: "edit_sales_page", title: "Change a sales page (asks for confirmation)", description: "Apply feedback to a page built by build_sales_page. ops: {op:'set', index, fields:{...}} changes that section's words or images; {op:'add', index, section:{type,...}} adds after index; {op:'remove', index}; {op:'move', index, to}. Optional theme {primary, heading, body}. ALWAYS call first WITHOUT confirmed; save only after a clear yes. Pages edited in the visual builder cannot be changed this way (the person's edits would be lost).", inputSchema: OBJ({ site_id: str("The page"), ops: { type: "array", items: { type: "object" }, description: "List of operations" }, theme: { type: "object" }, confirmed: { type: "boolean" } }, ["site_id", "ops"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true,
    run: async (a, c) => { if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can edit pages." }; const r: any = await fn("ai-site-builder", { mode: "page_edit", site_id: a?.site_id, ops: a?.ops, theme: a?.theme, dry: a?.confirmed !== true }, c); return r?.dry_run ? { ...r, needs_confirmation: true, next: "NOT saved yet. Say what will change, then ask. Call again with confirmed true only after a clear yes." } : r; } },
  { name: "publish_sales_page", title: "Make a sales page live (asks for confirmation)", description: "Publish the page (and its thank-you page) so anyone with the link can open it and order. ALWAYS call first WITHOUT confirmed; it says where it will go live. Call again with confirmed true only after the person clearly says yes. unpublish true takes it offline.", inputSchema: OBJ({ site_id: str("The page"), unpublish: { type: "boolean" }, confirmed: { type: "boolean" } }, ["site_id"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true,
    run: async (a, c) => { if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can publish pages." }; const r: any = await fn("ai-site-builder", { mode: "page_publish", site_id: a?.site_id, unpublish: a?.unpublish === true, dry: a?.confirmed !== true }, c); return r?.dry_run ? { ...r, needs_confirmation: true, next: "NOT live yet. Tell the person the link it will go live at and that real customers can then order. Call again with confirmed true only after a clear yes." } : r; } },
  { name: "list_product_photos", title: "Product photos and creatives at a glance", description: "A clear table of every product with its PRODUCT PHOTO (what customers see on the order page and WhatsApp) and how many ad CREATIVES it has. Use it whenever the person asks about product images, before generating anything, and to answer 'does this product have a photo?'. Show table_markdown exactly. Products with the same name are shown as one row.", inputSchema: OBJ({ product_name: str("Only this product (optional)") }, []), annotations: { readOnlyHint: true },
    run: async (a, c) => {
      const [{ data: prods }, { data: lib }] = await Promise.all([admin.from("products").select("id, product_name, product_image_url, is_active").eq("company_id", c.companyId).limit(300), admin.from("creative_library").select("product_key, kind, source").eq("company_id", c.companyId).limit(1000)]);
      const names = [...new Set((prods ?? []).map((p: any) => normName(p.product_name)))].filter((n) => !a?.product_name || n.includes(normName(a.product_name)));
      const rows = names.map((n) => { const same = (prods ?? []).filter((p: any) => normName(p.product_name) === n); const p = pickProd(same, n)!; const cr = (lib ?? []).filter((r: any) => r.product_key === n && r.source === "vault"); return { product: p.product_name, product_photo_url: p.product_image_url ?? null, has_product_photo: !!p.product_image_url, creatives_images: cr.filter((r: any) => r.kind === "image").length, creatives_videos: cr.filter((r: any) => r.kind === "video").length, duplicate_products: same.length > 1 ? same.length : undefined }; }).slice(0, 40);
      const table = ["| Product | Product photo (customers see) | Creatives (for ads) |", "|---|---|---|", ...rows.map((r) => `| ${r.product}${r.duplicate_products ? ` (${r.duplicate_products} copies)` : ""} | ${r.has_product_photo ? `![photo](${r.product_photo_url})` : "none yet"} | ${r.creatives_images} images, ${r.creatives_videos} videos |`)].join("\n");
      return { table_markdown: table, products: rows, note: "Show table_markdown exactly. The product photo and the creatives are different things. If a product has no photo, ask the person for a photo of the real product; do not use pictures from the web." };
    } },
  { name: "view_image", title: "Look at a product photo or creative", description: "Actually SEE a picture, so you never guess or invent what it looks like. Use it before writing copy or prompts for a product (pass product_name for its product photo), before using a creative (pass its url from list_creatives), and right after generate_image or import_chat_image (pass the preview_url) to check the result really matches the product, then describe it honestly. Never draw or imagine a product's packaging yourself. Images only, not videos.", inputSchema: OBJ({ product_name: str("Look at this product's own photo"), url: str("A preview_url / url from list_creatives, generate_image or import_chat_image") }, []), annotations: { readOnlyHint: true },
    run: async (a, c) => {
      const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      let url = String(a?.url ?? "");
      if (!url && a?.product_name) {
        const { data: prods } = await admin.from("products").select("product_name, product_image_url").eq("company_id", c.companyId);
        const hit = pickProd(prods ?? [], a.product_name, true);
        if (!hit) return { error: `No product called "${a.product_name}".` };
        if (!hit.product_image_url) return { error: `${hit.product_name} has no product photo yet (checked every product with that name). Ask the person for a photo of the real product.` };
        url = hit.product_image_url;
      }
      if (!/^https:\/\//.test(url)) return { error: "Pass product_name, or a url from list_creatives / generate_image." };
      if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) return { error: "That is a video; I can only show pictures. Ask the person to describe it." };
      const gen = `${SUPABASE_URL}/storage/v1/object/public/creative-vault/generated/${c.companyId}/`;
      let ok = url.startsWith(gen);
      if (!ok) { const [{ data: lib }, { data: prods }] = await Promise.all([admin.from("creative_library").select("url").eq("company_id", c.companyId).eq("url", url).limit(1), admin.from("products").select("id").eq("company_id", c.companyId).or(`product_image_url.eq.${url},ad_image_url.eq.${url}`).limit(1)]); ok = !!(lib?.length || prods?.length); }
      if (!ok) return { error: "That picture is not one of this company's products or creatives." };
      const pub = `${SUPABASE_URL}/storage/v1/object/public/`;
      let r: Response | null = url.startsWith(pub) ? await fetch(url.replace("/object/public/", "/render/image/public/") + "?width=768&quality=75").catch(() => null) : null;
      if (!r?.ok) r = await fetch(url).catch(() => null);
      if (!r?.ok) return { error: "Could not load that picture." };
      const mime = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return { error: "That file is not a picture I can show." };
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > 3 * 1024 * 1024) return { error: "That picture is too big to show here (over 3 MB). Open it from the link instead.", url };
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { __images: [{ data: btoa(bin), mimeType: mime }], viewed: url, note: "This is the real picture. Describe only what you actually see in it." };
    } },
  { name: "set_product_photo", title: "Set the product photo (asks for confirmation)", description: "Make a picture the product's own PHOTO, the one customers see on the order page and WhatsApp (NOT an ad creative; for creatives use approve_generated_image). Pass the preview_url from generate_image or import_chat_image. ALWAYS call first WITHOUT confirmed: it shows the current photo and the new one. Show both, say plainly this replaces what customers see, and call again with confirmed true only after a clear yes. Prefer a photo made from a real sample of the product so it looks real: ask the person for a photo of the real product (they can send it in this chat, or upload it in Revora under Products) before generating.", inputSchema: OBJ({ product_name: str("The product"), preview_url: str("The preview_url from generate_image or import_chat_image"), confirmed: { type: "boolean", description: "True ONLY after the person clearly said yes." } }, ["product_name", "preview_url"]), annotations: { readOnlyHint: false, destructiveHint: false }, write: true,
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can change a product photo." };
      const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const url = String(a?.preview_url ?? "");
      if (!url.startsWith(`${SUPABASE_URL}/storage/v1/object/public/creative-vault/generated/${c.companyId}/`) || !/\.(png|jpe?g|webp)$/i.test(url)) return { error: "Use a preview_url from generate_image or import_chat_image." };
      const { data: prods } = await admin.from("products").select("id, product_name, product_image_url, media_buyer_id").eq("company_id", c.companyId);
      const hit = pickProd(prods ?? [], a?.product_name);
      if (!hit) return { error: `No product called "${a?.product_name}". Their products: ${[...new Set((prods ?? []).map((p: any) => p.product_name))].join(", ")}.` };
      if (c.role === "buyer" && hit.media_buyer_id !== c.mediaBuyerId) return { error: "A media buyer can only change the photo of their own products. Ask the owner." };
      if (a?.confirmed !== true) return { needs_confirmation: true, not_saved_yet: true, product: hit.product_name, current_photo: hit.product_image_url ?? null, new_photo: url, table_markdown: `| Current photo | New photo |\n|---|---|\n| ${hit.product_image_url ? `![current](${hit.product_image_url})` : "none yet"} | ![new](${url}) |`, next: "NOT saved yet. Show table_markdown, say this replaces the photo customers see on the order page and WhatsApp, and ask. Call again with confirmed true only after a clear yes." };
      const { error } = await admin.from("products").update({ product_image_url: url }).eq("id", hit.id).eq("company_id", c.companyId);
      return error ? { error: error.message } : { ok: true, saved: true, product: hit.product_name, product_photo: url, previous_photo: hit.product_image_url ?? null, note: "Saved as the product photo. It is not an ad creative; to use a picture in ads, save it with approve_generated_image." };
    } },
  { name: "approve_generated_image", title: "Keep a generated image as a creative", description: "Save a generated image into the person's creative vault so it can be used in campaigns. Pass the preview_url from generate_image. Pass product_name so it is linked to that product. It becomes a normal creative (use the returned creative_id as an asset_id in plan_campaign).", inputSchema: OBJ({ preview_url: str("The preview_url from generate_image"), product_name: str("Product to link it to") }, ["preview_url"]), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, write: true,
    run: async (a, c) => {
      if (!["owner", "admin", "buyer"].includes(c.role)) return { error: "Only owners, admins and media buyers can do this." };
      const prefix = `${SUPABASE_URL}/storage/v1/object/public/creative-vault/generated/${c.companyId}/`;
      const url = String(a?.preview_url ?? "");
      if (!url.startsWith(prefix) || !/\.(png|jpe?g|webp)$/i.test(url)) return { error: "That is not one of your generated images. Use a preview_url from generate_image." };
      const { data: have } = await admin.from("creative_assets").select("id").eq("company_id", c.companyId).eq("public_url", url).limit(1);
      if (have?.length) return { ok: true, creative_id: have[0].id, note: "Already saved as a creative." };
      const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      let productId: string | null = null, productName: string | null = null;
      if (a?.product_name) { const { data: prods } = await admin.from("products").select("id, product_name").eq("company_id", c.companyId); const hit = (prods ?? []).find((p: any) => norm(p.product_name) === norm(a.product_name)); if (!hit) return { error: `No product called "${a.product_name}".` }; productId = hit.id; productName = hit.product_name; }
      const { data, error } = await admin.from("creative_assets").insert({ company_id: c.companyId, file_name: /\.png$/i.test(url) ? "AI generated image.png" : "Image from chat" + url.slice(url.lastIndexOf(".")), storage_path: url.slice(`${SUPABASE_URL}/storage/v1/object/public/creative-vault/`.length), public_url: url, asset_type: "image", product_id: productId, uploaded_by: "ai_generated", test_status: "untested", uploaded_at: new Date().toISOString() }).select("id").single();
      return error ? { error: error.message } : { ok: true, creative_id: data.id, linked_to_product: productName, note: productId ? "Saved to the creative vault for this product. Use creative_id as an asset_id in plan_campaign." : "Saved, but not linked to a product. Call assign_creative with the creative_id and a product name." };
    } },
  { name: "discard_generated_image", title: "Throw away a generated image", description: "Delete a generated image the person does not want. Pass its preview_url. Only works on images that were not saved as creatives.", inputSchema: OBJ({ preview_url: str("The preview_url from generate_image") }, ["preview_url"]), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, write: true,
    run: async (a, c) => {
      const base = `${SUPABASE_URL}/storage/v1/object/public/creative-vault/`;
      const url = String(a?.preview_url ?? "");
      if (!url.startsWith(`${base}generated/${c.companyId}/`)) return { error: "That is not one of your generated images." };
      const { data: saved } = await admin.from("creative_assets").select("id").eq("company_id", c.companyId).eq("public_url", url).limit(1);
      if (saved?.length) return { error: "That image is already saved as a creative, so it was not deleted." };
      const { data: asPhoto } = await admin.from("products").select("id").eq("company_id", c.companyId).eq("product_image_url", url).limit(1);
      if (asPhoto?.length) return { error: "That image is a product photo, so it was not deleted." };
      const { error } = await admin.storage.from("creative-vault").remove([url.slice(base.length)]);
      return error ? { error: error.message } : { ok: true, discarded: true };
    } },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
const safeEqKey = (a: string, b: string) => { if (!b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// Internal tool group of the Revora MCP server (mcp-studio). Only the `mcp` router calls this, with the service key.
//   { action: "list" } -> the tool definitions;  { action: "call", tool, args, ctx } -> { out } (the router audits, limits and formats it)
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!safeEqKey(req.headers.get("x-internal-key") ?? "", SERVICE_KEY)) return jres({ error: "forbidden" }, 403);
  let b: any = {}; try { b = await req.json(); } catch { return jres({ error: "bad_request" }, 400); }
  if (b?.action === "list") return jres({ group: "mcp-studio", tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, meta: t.meta, write: t.write, heavy: t.heavy })) });
  if (b?.action === "call") {
    const t = BY_NAME.get(String(b?.tool ?? ""));
    if (!t) return jres({ error: "unknown_tool" }, 404);
    let out: any;
    try { out = await t.run(b?.args && typeof b.args === "object" ? b.args : {}, b.ctx as Ctx); } catch (e) { out = { error: (e as Error).message }; }
    return jres({ out });
  }
  return jres({ error: "bad_action" }, 400);
});
