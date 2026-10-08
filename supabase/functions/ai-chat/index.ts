import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Powers the "AI Assistant" chat panel in dashboard_new.html.
//
// Two layers of grounding:
//  1. An upfront role-scoped DATA snapshot (buildXContext below) so common
//     questions ("which creative is winning?") answer in one round trip.
//  2. Real OpenAI function calling (TOOLS below) so the model can look up
//     anything NOT in that snapshot -- ad account balances, wallet balance,
//     pending fund requests -- and even take real actions (request funds,
//     approve a request), the same as clicking the matching button in the
//     dashboard itself. It can call several tools in a loop before answering.
//
// RLS on these tables is company-wide (everyone in a company can read every
// row), and this function uses the SERVICE ROLE key for its own queries
// (so it can act on the user's behalf), so every single query below filters
// explicitly by company_id -- and by media_buyer_id for a buyer -- rather
// than relying on RLS. Action tools additionally re-check the caller's role
// before doing anything, regardless of what the model asks for.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

function fmtNaira(n: number) {
  return "₦" + Math.round(n || 0).toLocaleString("en-NG");
}

type ActiveAccount = { id: string; name: string; balance: number | null; lowThreshold: number | null };
type Ctx = { companyId: string; role: string; mediaBuyerId: string | null; deliveryAgentId: string | null; userId: string; displayName: string; authHeader: string; account: ActiveAccount | null; proposals: any[] };


// ── BUSINESS KNOWLEDGE ──────────────────────────────────────────────────────
// Nobody should have to write a system prompt. The assistant reads the company's profile (from
// onboarding) and its own products, works out what kind of business this is and writes for it.
const META_TOKEN_SHARED = Deno.env.get("META_ACCESS_TOKEN") ?? "";

const VERTICALS: Record<string, string> = {
  health_wellness: "Health & wellness: sell comfort, routine, energy and peace of mind, never cures. Hooks come from daily moments (morning, work, after meals, sleep). Proof = ingredients, how to use, NAFDAC number (only if in the record), customer experience. Objections: 'is it safe?', 'will it work for me?', 'is it original?'. Never diagnose, name diseases as promises, or show before/after.",
  beauty_skincare: "Beauty & skincare: sell the feeling and the routine (soft, glowing, confident), texture, scent, how it fits a busy day. Proof = ingredients, skin-type fit, how long a pack lasts, customer reviews if provided. Objections: 'will it suit my skin?', 'is it fake?', 'how long till I see change?'. Avoid unrealistic or overnight promises and negative comments about the viewer's body or skin.",
  food_drinks: "Food & drinks: make people hungry. Sensory words (smoky, crispy, hot, fresh), the moment (lunch break, weekend, family), freshness, portion, delivery time, hygiene. Proof = ingredients, kitchen, delivery area and time, bulk/party pricing. Objections: 'is it fresh?', 'will it reach me on time?', 'is it clean?'. Mention allergens where relevant.",
  fashion_clothing: "Fashion & clothing: sell the compliment and the occasion (owambe, office, date, Sunday service), fit, fabric, sizes, colours, how it looks on real bodies. Proof = size range, fabric, quick delivery, exchange policy if provided. Objections: 'will it fit?', 'is the colour the same?', 'will it fade or tear?'. Show variety and scarcity honestly (limited pieces).",
  shoes_bags: "Shoes & bags: sell comfort, durability, how it completes an outfit, sizes and colours. Proof = material, sole/stitching, size chart, wear-all-day comfort. Objections: 'is it original leather?', 'will my size fit?', 'will it last?'. Use scenes: standing all day, long commute, event night.",
  perfume_fragrance: "Perfume & fragrance: sell identity and memory without claiming to know the viewer. Describe notes in plain words (fresh, sweet, woody), longevity, occasions, gifting. Proof = notes, lasting hours (only if provided), bottle size. Objections: 'will it last?', 'is it original?', 'will I like the smell?'. Gifting and bundle hooks work well.",
  gadgets_electronics: "Gadgets & electronics: sell what it lets people do (battery all day, no more NEPA stress, faster work), specs in plain language, warranty and originality. Proof = specs, warranty, what's in the box, delivery and testing before payment. Objections: 'is it original?', 'what if it spoils?', 'can I test it?'. Compare to the annoying old way, not to brands.",
  home_living: "Home & living: sell how the home feels and the problem removed (clutter, heat, stress, cleaning time). Proof = size, material, easy setup, delivery and assembly. Objections: 'will it fit my space?', 'is it sturdy?', 'delivery damage?'.",
  baby_kids: "Baby & kids: parents want safe, easy and loved by the child. Calm, reassuring tone, never fear-based. Proof = material, age range, safety notes from the record. Objections: 'is it safe?', 'will my child like it?'. Avoid health claims about children.",
  agro_farm: "Agro & farm: sell yield, freshness, price per quantity and reliability. Proof = quantity, source, delivery or pick-up, bulk pricing. Objections: 'quality?', 'can I trust delivery?'. Plain, practical, numbers first.",
  services: "Services: sell the outcome and the process. Hooks come from the pain of the old way, a before/after in time or effort (not a guaranteed result), and clear next steps. Proof = process, timeline, what's included, past work if provided. Objections: 'is it worth it?', 'what if it fails?', 'who will do it?'. CTA = book, message or call.",
  courses_digital: "Courses & digital: sell the skill and the change in what the person can do, not the content list. Proof = what they will build, who it's for, time needed, support. Objections: 'will I finish?', 'is it for beginners?', 'is it worth the money?'. No income guarantees.",
  real_estate: "Real estate: sell the lifestyle and the security of the asset. Plain facts first: location, size, price, title/document status as provided, payment plan. Objections: 'is the title clean?', 'how do I inspect?'. Never invent documents or guarantees of returns.",
  other: "General business: work out what the customer is really buying, the situation they are in, and what stops them. Lead with the customer's moment, not the product.",
};

const LANGUAGE_RULES: Record<string, string> = {
  pidgin_mix: "LANGUAGE: English with natural Nigerian Pidgin flavour mixed in where it makes the line stronger (not every line). Authentic, not a caricature. Keep it easy for any Nigerian to read.",
  english: "LANGUAGE: plain, warm Nigerian English. No Pidgin unless asked.",
  pidgin: "LANGUAGE: mostly Nigerian Pidgin, readable and natural, with simple English words where Pidgin would be unclear.",
  yoruba_mix: "LANGUAGE: English with light Yoruba expressions where natural. Keep spelling simple and correct.",
  igbo_mix: "LANGUAGE: English with light Igbo expressions where natural. Keep spelling simple and correct.",
  hausa_mix: "LANGUAGE: English with light Hausa expressions where natural. Keep spelling simple and correct.",
};

const COPY_CRAFT = `COPY CRAFT (this is what separates a scroll-stopper from a boring ad):
LENGTH AND SHAPE: primary text is LONG-FORM but easy to read: usually 120-260 words, in short paragraphs of 1-2 lines with white space, rhythm that goes short, long, short, and every line earning its place. Not a wall of text, not a one-liner.
STRUCTURE: (1) HOOK: first 1-2 lines, visible before "See more"; it must stop the thumb. (2) RELATE: a scene the buyer recognises, in their words. (3) TURN: the moment things could be different, with the product as the answer. (4) DETAILS/PROOF: 3-6 concrete benefits or facts from the product record, as short lines or emoji bullets. (5) EASE: why ordering is safe and simple (pay on delivery, delivery area, quick reply), ONLY if true for this business. (6) ONE CALL TO ACTION with the exact next step.
HOOK TECHNIQUES (use a different one per ad): a specific number or detail; a scene ("It's 6pm in traffic and..."); a contrast (old way vs new way); a myth-bust; a confession or story opener (only if the story is supplied); a curiosity gap; a call-out of a SITUATION (never of a person's body, health, finances or identity); a question that names a moment; a local expression or Pidgin line that sounds like real talk; a time-bound or limited offer (only if real).
BANNED: "Are you tired of", "Say goodbye to", "game changer", "revolutionary", "unlock", "look no further", "in today's world", "we are pleased to", generic adjectives with no proof, shouting in capitals, more than 6 emojis.
HEADLINES: at most about 40 characters, benefit, curiosity or offer, not a repeat of the hook. DESCRIPTION: at most about 30 characters, a supporting fact.
EVERY LINE must be specific: a number, a sense, a moment or a proof. If a line could be about any product, rewrite it.`;

async function loadProfileBrief(companyId: string): Promise<{ text: string; language: string; types: string[] }> {
  const { data: c } = await supabase.from("companies")
    .select("name, account_type, business_types, sales_channels, fulfilment, description, team_size, buyers_count, monthly_ad_spend, copy_language, country")
    .eq("id", companyId).maybeSingle();
  const types: string[] = c?.business_types ?? [];
  const lang = c?.copy_language && LANGUAGE_RULES[c.copy_language] ? c.copy_language : "pidgin_mix";
  const bits = [
    c?.description ? `About the business (their words): ${String(c.description).slice(0, 800)}` : "",
    types.length ? `Business type: ${types.join(", ").replace(/_/g, " ")}` : "",
    c?.sales_channels?.length ? `Sells via: ${c.sales_channels.join(", ").replace(/_/g, " ")}` : "",
    c?.fulfilment ? `Delivery: ${String(c.fulfilment).replace(/_/g, " ")}` : "",
    c?.account_type === "personal" ? "This is a single media buyer working on their own." : (c?.team_size ? `Team size: ${c.team_size}${c?.buyers_count ? `, ${c.buyers_count} media buyers` : ""}` : ""),
    c?.monthly_ad_spend ? `Monthly ad spend: ${String(c.monthly_ad_spend).replace(/_/g, " ")}` : "",
  ].filter(Boolean);
  const packs = types.map((t) => VERTICALS[t]).filter(Boolean);
  const text = (bits.length ? bits.join("\n") + "\n" : "") + (packs.length ? `NICHE KNOWLEDGE (use it, do not recite it):\n${packs.join("\n")}\n` : "");
  return { text, language: lang, types };
}

async function buildBusinessBrief(companyId: string, companyName: string): Promise<{ text: string; language: string }> {
  const [{ data: products }, { data: sites }, profile] = await Promise.all([
    supabase.from("products")
      .select("product_name, default_order_value_naira, description, benefits, safety_notes, nafdac_reg_no, destination_type, is_active, landing_page_url")
      .eq("company_id", companyId).order("is_active", { ascending: false }).limit(30),
    supabase.from("sites").select("name, slug, status").eq("company_id", companyId).limit(20),
    loadProfileBrief(companyId),
  ]);
  const clip = (t: unknown, n: number) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
  const lines = (products ?? []).map((p: any) => {
    const bits = [
      `• ${p.product_name}${p.is_active === false ? " (inactive)" : ""}`,
      p.default_order_value_naira ? `price ${fmtNaira(Number(p.default_order_value_naira))}` : "",
      p.destination_type ? `sold via ${p.destination_type}` : "",
      p.description ? `about: ${clip(p.description, 400)}` : "",
      p.benefits ? `benefits: ${clip(p.benefits, 300)}` : "",
      p.safety_notes ? `safety notes: ${clip(p.safety_notes, 200)}` : "",
      p.nafdac_reg_no ? `NAFDAC no. ${p.nafdac_reg_no}` : "",
    ].filter(Boolean);
    return bits.join(" · ");
  });
  const siteLine = (sites ?? []).length ? `Websites: ${(sites ?? []).map((s: any) => `${s.name} (${s.status})`).join(", ")}.` : "";
  const text = `BUSINESS: ${companyName}.\n${profile.text}` +
    (lines.length ? `PRODUCTS (their own catalogue, the only products you may talk about as theirs):\n${lines.join("\n")}` : "PRODUCTS: none added yet. If asked for ad copy, ask them to name the product, who it is for, and the price, or to add it under Products.") +
    (siteLine ? `\n${siteLine}` : "");
  return { text, language: profile.language };
}

const PLAYBOOK = `HOW TO BE USEFUL FOR ANY BUSINESS (you already know this; nobody needs to teach you their niche):
- Work out the kind of business from the profile and products above and adapt your language, proof and tone to it and to Nigerian buyers. Never ask the user to write you instructions or a "system prompt".
- WRITING AD COPY (primary text, headlines, descriptions, hooks, CTAs): ALWAYS call write_ad_copy and show what it returns exactly as written, with at most one short line before it (which ad to test first and why). Do not write ad copy yourself, and do not shorten or rewrite its output. Pass the product name, the platform goal (WhatsApp or website) and any angle or language the person asked for.
- Use only facts from the product record or what the user told you. Never invent claims, testimonials, numbers, discounts or registration numbers.
- META AD POLICY: no guaranteed results; no before-and-after claims for body, weight or skin; no implying you know a person's health, body, finances or identity; no medical cures; no shocking or misleading claims; no fake urgency. Health and wellness copy talks about support, comfort and experience, not cures.
- ADVICE: when asked what to do (launch, kill, scale, budget, testing), give a clear recommendation first, then the reason in a sentence or two with the real numbers. If the data needed is not available, say so and say how to get it. Test one change at a time; give each new creative about 2-3 times the target cost per result in spend before judging; scale winners gradually.
- If they ask for a different language or tone in chat (for example "write it in full Pidgin" or "in Yoruba"), do that for that request.
- Ask at most one short clarifying question, and only when you truly cannot proceed.`;

// ── Examples from the person's own past ads ───────────────────────────────
type CopyEx = { text: string; headline: string; description: string; spend: number | null; cost: number | null; ctr: number | null; note: string };

function adCopyFromCreative(cr: any): { text: string; headline: string; description: string } {
  const ld = cr?.object_story_spec?.link_data ?? cr?.object_story_spec?.video_data ?? {};
  const afs = cr?.asset_feed_spec ?? {};
  const text = String(cr?.body ?? ld.message ?? ld.description ?? afs?.bodies?.[0]?.text ?? "").trim();
  const headline = String(cr?.title ?? ld.name ?? ld.title ?? afs?.titles?.[0]?.text ?? "").trim();
  const description = String(ld.link_description ?? afs?.descriptions?.[0]?.text ?? "").trim();
  return { text, headline, description };
}

async function getCopyExamples(ctx: Ctx): Promise<{ winners: CopyEx[]; losers: CopyEx[]; others: CopyEx[]; source: string }> {
  const out = { winners: [] as CopyEx[], losers: [] as CopyEx[], others: [] as CopyEx[], source: "none" };
  const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + "…" : t);
  // 1. Live from the person's selected ad account: real copy + real results.
  try {
    if (ctx.account && ["owner", "admin", "buyer"].includes(ctx.role)) {
      const { data: acct } = await supabase.from("ad_accounts").select("meta_ad_account_id, meta_connection_id").eq("id", ctx.account.id).eq("company_id", ctx.companyId).maybeSingle();
      const actId = String(acct?.meta_ad_account_id ?? "").replace(/^act_/, "");
      if (/^\d+$/.test(actId)) {
        let token = META_TOKEN_SHARED;
        if (acct?.meta_connection_id) {
          const { data: conn } = await supabase.from("meta_connections").select("access_token, status").eq("id", acct.meta_connection_id).maybeSingle();
          if (conn?.status === "active" && conn.access_token) token = conn.access_token;
        }
        const fields = "id,name,effective_status,creative{body,title,object_story_spec,asset_feed_spec}";
        const [adsRes, perfRes] = await Promise.all([
          fetch(`https://graph.facebook.com/v21.0/act_${actId}/ads?fields=${encodeURIComponent(fields)}&limit=120&access_token=${token}`).then((r) => r.json()).catch(() => null),
          fetch(ADS_URL, { method: "POST", headers: { Authorization: ctx.authHeader, "Content-Type": "application/json" }, body: JSON.stringify({ action: "list", ad_account_id: ctx.account.id, range: "last30" }) }).then((r) => r.json()).catch(() => null),
        ]);
        const perf = new Map<string, any>((perfRes?.ads ?? []).map((a: any) => [String(a.id), a]));
        const rows: CopyEx[] = [];
        for (const ad of adsRes?.data ?? []) {
          const c = adCopyFromCreative(ad.creative);
          if (c.text.length < 40) continue;
          const m = perf.get(String(ad.id));
          rows.push({ text: clip(c.text, 1100), headline: c.headline, description: c.description, spend: m ? Number(m.spend) : null, cost: m?.cost_per_result != null ? Number(m.cost_per_result) : null, ctr: m?.ctr != null ? Number(m.ctr) : null, note: m?.kind === "purchase" ? "cost per purchase" : "cost per WhatsApp message" });
        }
        const judged = rows.filter((r) => r.spend != null && r.spend >= 1500);
        out.winners = judged.filter((r) => r.cost != null).sort((a, b) => (a.cost as number) - (b.cost as number)).slice(0, 5);
        const winSet = new Set(out.winners);
        out.losers = judged.filter((r) => !winSet.has(r) && (r.cost == null || (r.spend as number) >= 3000)).sort((a, b) => ((b.cost ?? 1e9) as number) - ((a.cost ?? 1e9) as number)).slice(0, 3);
        out.others = rows.filter((r) => !winSet.has(r) && !out.losers.includes(r)).slice(0, 4);
        if (rows.length) out.source = "this ad account";
      }
    }
  } catch (_e) { /* fall through to the company's saved copy */ }
  // 2. The company's own saved ads (no live results), when the account gave us little.
  if (out.winners.length + out.others.length < 3) {
    const { data: saved } = await supabase.from("creatives").select("primary_text, headline").eq("company_id", ctx.companyId).order("created_at", { ascending: false }).limit(40).then((r: any) => r).catch(() => ({ data: [] }));
    for (const s of saved ?? []) {
      const t = String(s.primary_text ?? "").trim();
      if (t.length < 60) continue;
      out.others.push({ text: clip(t, 1100), headline: String(s.headline ?? ""), description: "", spend: null, cost: null, ctr: null, note: "no results on file" });
      if (out.others.length >= 6) break;
    }
    if (out.others.length && out.source === "none") out.source = "the company's saved ads";
  }
  return out;
}

function renderExamples(ex: Awaited<ReturnType<typeof getCopyExamples>>): string {
  const fmt = (e: CopyEx, i: number) => `#${i + 1}${e.cost != null ? ` (${e.note}: ${fmtNaira(e.cost)} on ${fmtNaira(e.spend ?? 0)} spend${e.ctr != null ? `, CTR ${e.ctr.toFixed(1)}%` : ""})` : ""}\nPrimary text: ${e.text}${e.headline ? `\nHeadline: ${e.headline}` : ""}${e.description ? `\nDescription: ${e.description}` : ""}`;
  const parts: string[] = [];
  if (ex.winners.length) parts.push(`ADS THAT WORKED FOR THIS SELLER (best results first). Study their voice, hooks, rhythm, length and what they promise. Write in this seller's own proven style. Never copy lines:\n${ex.winners.map(fmt).join("\n\n")}`);
  if (ex.losers.length) parts.push(`ADS THAT DID NOT WORK (spent money, weak results). Avoid what made them flat:\n${ex.losers.map(fmt).join("\n\n")}`);
  if (ex.others.length) parts.push(`OTHER ADS FROM THIS SELLER (no results available). Use only for tone and the facts they state:\n${ex.others.map(fmt).join("\n\n")}`);
  return parts.join("\n\n") || "No past ads found for this seller yet. Lean on the product record and the niche knowledge.";
}

async function callOpenAI(messages: any[], temperature: number, maxTokens: number): Promise<string> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", messages, temperature, max_tokens: maxTokens }),
  });
  const o = await r.json();
  if (!r.ok) throw new Error(o?.error?.message || "AI request failed");
  return String(o?.choices?.[0]?.message?.content ?? "").trim();
}

// Two passes: a wild writer that finds hooks, then a strict editor that fixes weak lines and policy risk.
async function writeAdCopy(args: any, ctx: Ctx, brief: { text: string; language: string }): Promise<unknown> {
  const productName = String(args?.product_name ?? "").trim();
  let product: any = null;
  if (productName) {
    const { data } = await supabase.from("products")
      .select("product_name, default_order_value_naira, description, benefits, safety_notes, nafdac_reg_no, destination_type, landing_page_url")
      .eq("company_id", ctx.companyId).ilike("product_name", `%${productName.replace(/[%_]/g, "")}%`).limit(1);
    product = data?.[0] ?? null;
  }
  if (!product && !args?.facts) {
    const { data: any1 } = await supabase.from("products").select("product_name, default_order_value_naira, description, benefits, safety_notes, nafdac_reg_no, destination_type, landing_page_url").eq("company_id", ctx.companyId).eq("is_active", true).limit(1);
    product = any1?.[0] ?? null;
  }
  const goal = args?.goal === "website" ? "website (people click through to order)" : "WhatsApp (people tap to chat and order)";
  const cta = args?.goal === "website" ? "Shop Now, Order Now or Learn More" : "Send message";
  const count = Math.min(Math.max(Number(args?.count) || 3, 1), 5);
  const langKey = typeof args?.language === "string" && LANGUAGE_RULES[args.language] ? args.language : brief.language;
  const langRule = typeof args?.language_note === "string" && args.language_note.trim() ? `LANGUAGE: ${String(args.language_note).slice(0, 200)}` : LANGUAGE_RULES[langKey];
  const examples = renderExamples(await getCopyExamples(ctx));
  const productText = product
    ? `PRODUCT: ${product.product_name}${product.default_order_value_naira ? ` · price ${fmtNaira(Number(product.default_order_value_naira))}` : ""}\nAbout: ${product.description ?? "-"}\nBenefits: ${product.benefits ?? "-"}\nSafety notes: ${product.safety_notes ?? "-"}${product.nafdac_reg_no ? `\nNAFDAC no.: ${product.nafdac_reg_no}` : ""}`
    : `PRODUCT / OFFER FACTS (from the user): ${String(args?.facts ?? "none given").slice(0, 1200)}`;
  const ask = `Write ${count} complete Facebook/Instagram ads for the product below. Ad goal: ${goal}. ${args?.angle ? `Requested angle: ${String(args.angle).slice(0, 200)}.` : "Each ad uses a different angle and a different hook technique."} ${args?.notes ? `Extra notes: ${String(args.notes).slice(0, 400)}` : ""}`;
  const context = `${brief.text}\n\n${productText}\n\n${examples}\n\n${COPY_CRAFT}\n\n${langRule}\n\nMETA POLICY: no guaranteed results; no before-and-after claims; never imply you know the viewer's health, body, finances or identity; no medical cures; no fake urgency; no invented facts, testimonials, discounts or registration numbers (use [placeholders] where a fact is missing).`;

  // Pass 1: ideation (hot)
  const draft = await callOpenAI([
    { role: "system", content: "You are a world-class direct-response copywriter for Nigerian online sellers. You write scroll-stopping, bouncy, catchy, hooky long-form ad copy that reads like a real person talking, not like an advert. " + context },
    { role: "user", content: `${ask}\n\nFirst list 12 DIFFERENT hook lines (each uses a different technique) numbered H1-H12, no explanations. Then write the ${count} full ads. Each ad: "Hook options" (its chosen hook plus 2 alternates), "Primary text" (long-form per the craft rules), "Headline" (3 options), "Description", "CTA button" (${cta}).` },
  ], 0.95, 3200);

  // Pass 2: ruthless editor (cool)
  const final = await callOpenAI([
    { role: "system", content: "You are a ruthless senior ad editor. You improve copy without losing its energy." },
    { role: "user", content: `${context}\n\nHere are the drafts:\n\n${draft}\n\nEDIT THEM into the final version. Rules: keep ${count} ads. For each line ask "could this be about any product?" and rewrite if yes. Remove every banned phrase. Make hooks sharper and more specific, keep the long-form length and the bouncy rhythm, check every claim against the product record (remove anything not supported), fix any Meta policy risk, keep the language rule. Output ONLY this markdown for each ad, nothing else:\n\n### Ad N: <angle name>\n**Hook options:** (3 short lines, the first is the one used)\n**Primary text:**\n\`\`\`\n<full primary text>\n\`\`\`\n**Headlines:** (3 options, about 40 characters each)\n**Description:** <about 30 characters>\n**CTA button:** ${cta}\n**Why it should work:** <one sentence>` },
  ], 0.45, 3600);
  return { copy_markdown: final, note: "Show copy_markdown exactly as written. Do not rewrite or shorten it." };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401);

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: "Not signed in" }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, role, display_name, media_buyer_id, delivery_agent_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.company_id) return json({ error: "No company on this account yet" }, 400);

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const question = (body?.question || "").toString().trim();
  if (!question) return json({ error: "A question is required" }, 400);
  // Short rolling history from the frontend (role/content pairs only) so a
  // follow-up like "yes, 50000" after the assistant asks "how much?" still
  // makes sense. Capped and sanitized -- never trust shape from the client.
  const history: { role: string; content: string }[] = Array.isArray(body?.history)
    ? body.history.filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string").slice(-12)
    : [];

  if (!OPENAI_API_KEY) {
    return json({
      answer: "AI chat isn't switched on yet for this workspace — an admin needs to add an OPENAI_API_KEY in Supabase (Project Settings → Edge Functions → Secrets) before I can answer questions.",
    });
  }

  const ctx: Ctx = {
    companyId: profile.company_id, role: profile.role, mediaBuyerId: profile.media_buyer_id,
    deliveryAgentId: profile.delivery_agent_id, userId: user.id, displayName: profile.display_name || "",
    authHeader, account: null, proposals: [],
  };

  // The ad account the person currently has switched in on the dashboard.
  // Verified server-side: it must belong to their company (and, for a buyer, to them).
  const activeId = typeof body?.active_ad_account_id === "string" ? body.active_ad_account_id : "";
  if (/^[0-9a-f-]{36}$/i.test(activeId)) {
    let aq = supabase.from("ad_accounts").select("id, name, nickname, balance_naira, low_balance_threshold_naira, media_buyer_id")
      .eq("id", activeId).eq("company_id", ctx.companyId);
    if (ctx.role === "buyer") aq = aq.eq("media_buyer_id", ctx.mediaBuyerId);
    const { data: a } = await aq.maybeSingle();
    if (a) ctx.account = { id: a.id, name: a.nickname || a.name || a.id, balance: a.balance_naira ?? null, lowThreshold: a.low_balance_threshold_naira ?? null };
  }
  let killRules: any[] = [];
  if (["owner", "admin", "buyer"].includes(ctx.role)) {
    const { data: kr } = await supabase.from("kill_rules").select("kind, enabled, auto_kill, max_cost_per_result, min_spend, min_hours").eq("profile_id", ctx.userId);
    killRules = kr || [];
  }

  const { data: companyRow } = await supabase.from("companies").select("name").eq("id", ctx.companyId).maybeSingle();
  const companyName = companyRow?.name || "the company";

  let data: Record<string, unknown>;
  const sinceIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  try {
    if (ctx.role === "owner" || ctx.role === "admin") data = await buildAdminContext(ctx.companyId, sinceIso);
    else if (ctx.role === "buyer") data = await buildBuyerContext(ctx.companyId, ctx.mediaBuyerId, sinceIso);
    else if (ctx.role === "customer_care") data = await buildCareContext(ctx.companyId, sinceIso);
    else if (ctx.role === "delivery_agent") data = await buildDeliveryContext(ctx.companyId, ctx.deliveryAgentId, sinceIso);
    else data = { note: "No specific data view defined for this role yet." };
  } catch (e) {
    return json({ error: "Couldn't pull your data: " + (e as Error).message }, 500);
  }

  const brief = await buildBusinessBrief(ctx.companyId, companyName).catch(() => ({ text: `BUSINESS: ${companyName}.`, language: "pidgin_mix" }));
  const businessBrief = brief.text;

  const roleLabel: Record<string, string> = {
    owner: "the company owner", admin: "an admin", buyer: "a media buyer",
    customer_care: "a customer care agent", delivery_agent: "a delivery agent",
  };

  const systemPrompt = `You are the AI assistant built into ${companyName}'s operations dashboard (a media-buying + order/delivery CRM for Nigerian e-commerce).
You are talking to ${ctx.displayName || "a team member"}, who is ${roleLabel[ctx.role] || ctx.role} at this company.

You have two sources of truth:
1. A DATA snapshot below (last 7 days unless noted) for common questions.
2. Tools you can call for anything not already in that snapshot, or to take a real action (request funds, approve a fund request). Prefer calling a tool over saying you don't have data — you very likely can look it up. Only say you can't help if a tool call genuinely comes back empty or errors.

Rules:
- Never invent numbers, names, balances or outcomes. Only state what the DATA or a tool result actually returned.
- Money is in Naira — use ₦.
- Be concise and direct: short paragraphs or bullet points, not a wall of text. This person is busy.
- For an action tool (request_funds, approve_fund_request): if the user already gave you what's needed (e.g. "request 50000 for TikTok ads"), just call it — don't ask for confirmation first, the same way clicking the button on the dashboard doesn't ask twice. Only ask a clarifying question if something required is actually missing (e.g. no amount given).
- request_funds only works for a buyer; approve_fund_request and list_pending_fund_requests only work for an owner/admin. If the signed-in person's role doesn't allow it, say so plainly instead of calling the tool.
- If you call list_ad_accounts and there's more than one account, list them clearly (name + balance) in your answer so the person can see all of them at once.
- For performance/KPI questions about a specific ad account (spend, CTR, orders, CPA, impressions, clicks) use get_ad_account_performance, not list_ad_accounts (that one only has balance). If the name is ambiguous it'll tell you the matches it found.
- query_data is your general-purpose lookup for anything else across the site: orders (search by customer name/phone, filter by status), ad sets, daily performance metrics, creatives, products, the leaderboard (media_buyers), pending approvals, AI call logs (voice_calls), and website leads. Use it instead of saying you don't have something.
- Sending real money (e.g. "send 5k to 238193057227 Paga") is DIFFERENT from request_funds/approve_fund_request: it is owner/admin only, and you can NEVER send it yourself. Call resolve_bank_account with the account number, bank name, and amount they stated. That ONLY verifies whose account it is -- it never moves money. Once it comes back verified, tell them the account name it resolved to and that you've put up a confirm card for them -- the actual send happens only when they click Confirm and re-enter their password on the dashboard, which you cannot do for them. Never say the money has been sent or is on its way -- you don't know that; only the confirm step knows.
- A buyer sending money is narrower: resolve_meta_transfer_account only works for a buyer sending their OWN already-approved fund request into their Meta/Facebook Ads billing account. It automatically finds their approved request and rejects the account outright if it doesn't resolve to a Facebook/Meta name. If they have more than one approved request it comes back ambiguous with a list -- ask which one, then call it again passing amount_naira set to the exact amount they picked so it can tell them apart (it can't be identified by date alone). Same as resolve_bank_account, it only verifies -- the real send still needs their Confirm-and-password step on the dashboard.

- ACTIVE AD ACCOUNT: ${ctx.account ? `the person is currently working in the ad account "${ctx.account.name}" (id ${ctx.account.id})${ctx.account.balance != null ? `, prepaid balance about ${fmtNaira(ctx.account.balance)}` : ""}. When they say "my ad account", "this account", "my ads", "how are my ads doing" etc., they mean THIS one — NEVER ask which ad account. Only talk about a different account if they name one.` : "none is selected right now (the person is on the all-accounts view). If they ask about ads, call list_ad_accounts and ask which one only if there is more than one."}
- For ad set / ad level questions call get_live_ads (live from Meta: spend, messages/conversations, cost per message, reach, frequency, CTR per ad set and per ad). List the ads under each ad set when asked, and comment on what is working or not. Judge against THIS PERSON'S kill thresholds (below), not made-up benchmarks; the tool also marks ads that break them.
- KILL THRESHOLDS for this person (their own settings): ${killRules.length ? JSON.stringify(killRules.map(r => ({ type: r.kind === "messaging" ? "WhatsApp message ads" : "website purchase ads", rule_on: r.enabled, auto_pause: r.auto_kill, kill_if_cost_per_result_above_naira: Number(r.max_cost_per_result), only_judge_after_spend_naira: Number(r.min_spend), only_judge_after_hours: Number(r.min_hours) }))) : "none set yet — tell them they can set them in Settings → Ad kill rules."}
- Taking action on ads: use propose_status_change (pause/kill/resume an ad, ad set or campaign) and propose_budget_change (scale a daily budget). These NEVER execute directly — they put a confirm card in the chat and the person taps Confirm. So after calling one, say what you propose and why, and that it is waiting for their tap. Never say it is done. Get the ids from get_live_ads. You may propose several at once. Do not propose pausing something just because it is new — respect the min spend/hours in their thresholds.
- Creating a whole new campaign from chat is coming soon; for now point them to the Create/Launch button.

${businessBrief}

${PLAYBOOK}

DATA (JSON):
${JSON.stringify(data)}`;

  const TOOLS = [
    {
      type: "function", function: {
        name: "write_ad_copy",
        description: "Write finished ad copy (long-form primary text, headlines, description, hooks, CTA) for a product. It reads the seller's past ads, product record and niche, writes in two passes and returns polished markdown. ALWAYS use this for any request to write ad copy, hooks, headlines or descriptions. Show its copy_markdown exactly as returned.",
        parameters: {
          type: "object",
          properties: {
            product_name: { type: "string", description: "Which product (name or part of it). Omit only if the person gave the facts themselves." },
            facts: { type: "string", description: "Product or offer facts supplied by the person in chat, when there is no product record." },
            goal: { type: "string", enum: ["whatsapp", "website"], description: "Where the ad sends people. Default whatsapp." },
            count: { type: "number", description: "How many ads (1-5). Default 3." },
            angle: { type: "string", description: "A specific angle the person asked for, if any." },
            language: { type: "string", enum: ["pidgin_mix", "english", "pidgin", "yoruba_mix", "igbo_mix", "hausa_mix"], description: "Only if the person asked for a language different from their default." },
            language_note: { type: "string", description: "Free-text language request, e.g. 'full Pidgin' or 'Yoruba and English'." },
            notes: { type: "string", description: "Anything else the person asked for (offer, audience, tone)." },
          },
          required: [],
        },
      },
    },
    {
      type: "function", function: {
        name: "get_product",
        description: "Full details of one of the company's products (description, benefits, safety notes, price, landing page) by name. Use before writing ad copy, descriptions or answering detailed product questions when the short summary in the prompt is not enough.",
        parameters: { type: "object", properties: { product_name: { type: "string", description: "Product name or part of it" } }, required: ["product_name"] },
      },
    },
    {
      type: "function", function: {
        name: "list_ad_accounts",
        description: "List Meta ad accounts (with their cached balance) visible to this user. Use for balance/status questions. For spend/CTR/orders/CPA use get_ad_account_performance instead.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function", function: {
        name: "get_ad_account_performance",
        description: "Get real KPIs for one ad account by name: total spend, orders, CTR, clicks, impressions, cost per order, plus a per-ad-set breakdown. Use this for any 'how is X account performing' / 'KPI' / 'metrics' question.",
        parameters: {
          type: "object",
          properties: {
            ad_account_name: { type: "string", description: "The ad account's name or nickname (partial match is fine, e.g. 'Femi tec' or 'BEYCEE')" },
            days: { type: "number", description: "How many days back to look. Defaults to 7." },
          },
          required: ["ad_account_name"],
        },
      },
    },
    {
      type: "function", function: {
        name: "get_live_ads",
        description: "LIVE from Meta: every campaign > ad set > ad in the person's currently selected ad account (or another account by id) with status, daily budget, spend, conversations (messages), cost per message, reach, frequency, CTR, plus whether each ad breaks the person's kill thresholds. Use for any question about ad sets, ads, what is working, what to kill or scale.",
        parameters: {
          type: "object",
          properties: {
            range: { type: "string", enum: ["today", "yesterday", "last3", "last7", "last30", "lifetime"], description: "Date range, default last7." },
            ad_account_id: { type: "string", description: "Only pass to look at a different ad account than the selected one." },
            only_active: { type: "boolean", description: "Only show running items (default true). Pass false to include paused ones." },
          },
          required: [],
        },
      },
    },
    {
      type: "function", function: {
        name: "propose_status_change",
        description: "PROPOSE pausing (kill) or resuming a campaign, ad set or ad. Does not execute -- shows a confirm card the person taps. Owner/admin/buyer only.",
        parameters: {
          type: "object",
          properties: {
            level: { type: "string", enum: ["campaign", "adset", "ad"] },
            object_id: { type: "string", description: "Meta id from get_live_ads" },
            object_name: { type: "string" },
            status: { type: "string", enum: ["PAUSED", "ACTIVE"] },
            reason: { type: "string", description: "One short sentence with the numbers behind it." },
            ad_account_id: { type: "string", description: "Only if not the selected account." },
          },
          required: ["level", "object_id", "status", "reason"],
        },
      },
    },
    {
      type: "function", function: {
        name: "propose_budget_change",
        description: "PROPOSE changing the daily budget of an ad set or campaign (scale up or down), in Naira. Does not execute -- shows a confirm card. Owner/admin/buyer only.",
        parameters: {
          type: "object",
          properties: {
            level: { type: "string", enum: ["campaign", "adset"] },
            object_id: { type: "string" },
            object_name: { type: "string" },
            current_daily_budget: { type: "number", description: "Naira, from get_live_ads" },
            new_daily_budget: { type: "number", description: "Naira" },
            reason: { type: "string" },
            ad_account_id: { type: "string", description: "Only if not the selected account." },
          },
          required: ["level", "object_id", "new_daily_budget", "reason"],
        },
      },
    },
    {
      type: "function", function: {
        name: "query_data",
        description: "General-purpose lookup across the company's live data. Use for anything not covered by a more specific tool: find an order by customer name/phone, list orders by status, look up ad sets, creatives, products, pending approvals, AI call logs, website leads, or the buyer leaderboard.",
        parameters: {
          type: "object",
          properties: {
            table: {
              type: "string",
              enum: ["orders", "ad_sets", "daily_metrics", "creative_assets", "products", "media_buyers", "pending_approvals", "voice_calls", "website_leads"],
              description: "Which table to query.",
            },
            search: { type: "string", description: "Free-text search (e.g. a customer name, phone number, or ad set name) -- matched against that table's main name/identifier field." },
            filters: {
              type: "object",
              description: "Exact-match filters as {column: value} or {column: [value1,value2]} for 'one of these'. Only columns relevant to the chosen table are honored.",
              additionalProperties: true,
            },
            days: { type: "number", description: "Only return rows from the last N days (uses each table's own date column). Omit for no date filter." },
            limit: { type: "number", description: "Max rows to return, default 20, max 50." },
          },
          required: ["table"],
        },
      },
    },
    {
      type: "function", function: {
        name: "get_wallet_balance",
        description: "Get the funding wallet balance: company-wide breakdown for an owner/admin, or just the signed-in buyer's own balance for a buyer.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function", function: {
        name: "request_funds",
        description: "Submit a fund request for the signed-in buyer, exactly like clicking 'Request funds' on the Wallet tab. Buyer role only.",
        parameters: {
          type: "object",
          properties: {
            amount_naira: { type: "number", description: "Amount in Naira to request" },
            note: { type: "string", description: "Optional note on what it's for" },
          },
          required: ["amount_naira"],
        },
      },
    },
    {
      type: "function", function: {
        name: "list_pending_fund_requests",
        description: "List fund requests awaiting approval, with buyer name and amount. Owner/admin only.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function", function: {
        name: "approve_fund_request",
        description: "Approve a pending fund request by id, exactly like clicking 'Approve' on the Wallet tab. Owner/admin only.",
        parameters: {
          type: "object",
          properties: { fund_request_id: { type: "string", description: "The fund request's id, from list_pending_fund_requests" } },
          required: ["fund_request_id"],
        },
      },
    },
    {
      type: "function", function: {
        name: "resolve_bank_account",
        description: "Verify who a bank account belongs to before sending money, exactly like Paystack's own account lookup. This ONLY verifies -- it never moves money. Owner/admin only. After this returns, a confirm-and-send card appears on the dashboard; the person must click it and enter their password for anything to actually be sent.",
        parameters: {
          type: "object",
          properties: {
            account_number: { type: "string", description: "The destination account number" },
            bank_name: { type: "string", description: "The bank name, e.g. 'Opay', 'Paga', 'GTBank', 'Access Bank'" },
            amount_naira: { type: "number", description: "Amount in Naira the person wants to send" },
            note: { type: "string", description: "Optional note on what this payment is for, e.g. 'Facebook Ads'" },
          },
          required: ["account_number", "bank_name", "amount_naira"],
        },
      },
    },
    {
      type: "function", function: {
        name: "resolve_meta_transfer_account",
        description: "For a buyer only: verify a destination account before sending THEIR OWN already-approved fund request balance into Meta/Facebook Ads billing. Finds their approved request automatically (the amount is fixed by that approval, never chosen here) and the account is rejected unless it resolves to a Facebook/Meta name. This ONLY verifies -- it never moves money.",
        parameters: {
          type: "object",
          properties: {
            account_number: { type: "string", description: "The destination account number (today's one-time Meta Ads top-up account from Ads Manager)" },
            bank_name: { type: "string", description: "The bank name, e.g. 'Zenith Bank', 'GTBank'" },
            amount_naira: { type: "number", description: "Only needed if the buyer has more than one approved fund request: the amount (in Naira) of the specific approved request they picked, e.g. from a disambiguation list you showed them." },
          },
          required: ["account_number", "bank_name"],
        },
      },
    },
  ];

  const messages: any[] = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: question }];
  let quickReplies: string[] = [];
  let pendingPayment: unknown = null;

  try {
    for (let step = 0; step < 6; step++) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // This OpenAI project's key doesn't have access to the -mini/-nano
          // tiers (confirmed live: gpt-4o-mini/gpt-4.1-mini/gpt-4.1-nano/o4-mini
          // all 403 "does not have access to model") -- only gpt-4o and
          // gpt-3.5-turbo work on this account. Using gpt-4o for quality + tool use.
          model: "gpt-4o",
          messages,
          tools: TOOLS,
          tool_choice: "auto",
          temperature: 0.4,
          max_tokens: 2200,
        }),
      });
      const out = await r.json();
      if (!r.ok) return json({ error: out?.error?.message || "AI request failed" }, 502);

      const msg = out?.choices?.[0]?.message;
      if (!msg) return json({ error: "AI returned no response" }, 502);
      messages.push(msg);

      if (!msg.tool_calls || !msg.tool_calls.length) {
        return json({ answer: msg.content?.trim() || "I couldn't generate a response from your data just now — try again.", quick_replies: quickReplies, pending_payment: pendingPayment, proposals: ctx.proposals, active_account: ctx.account ? { id: ctx.account.id, name: ctx.account.name } : null });
      }

      for (const tc of msg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* malformed args */ }
        const result = tc.function.name === "write_ad_copy" ? await writeAdCopy(args, ctx, brief).catch((e) => ({ error: "Could not write the copy: " + (e as Error).message })) : await runTool(tc.function.name, args, ctx);
        if (tc.function.name === "list_ad_accounts" && Array.isArray(result) && result.length > 1) {
          quickReplies = result.slice(0, 6).map((a: any) => `What's the balance on ${a.name}?`);
        }
        if (tc.function.name === "get_ad_account_performance" && (result as any)?.ambiguous) {
          quickReplies = ((result as any).matches || []).slice(0, 6).map((n: string) => `KPI for ${n}`);
        }
        if (tc.function.name === "resolve_bank_account" && (result as any)?.verified) {
          pendingPayment = result;
        }
        if (tc.function.name === "resolve_meta_transfer_account") {
          if ((result as any)?.verified) pendingPayment = result;
          if ((result as any)?.ambiguous) quickReplies = ((result as any).matches || []).slice(0, 6).map((m: string) => `Use ${m}`);
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    }
    return json({ error: "That took too many steps to work out — try asking in a simpler way." }, 502);
  } catch (e) {
    return json({ error: "AI request failed: " + (e as Error).message }, 502);
  }
});

// ── Tool execution -- the same actions the dashboard's own buttons take ───

const ADS_URL = `${SUPABASE_URL}/functions/v1/ads-manager`;

// Resolve which account a tool call is about: the one they named, else the selected one.
// Always re-verified against the person's company (and ownership for a buyer).
async function accountFor(ctx: Ctx, requested?: string): Promise<ActiveAccount | { error: string }> {
  if (!requested || requested === ctx.account?.id) {
    return ctx.account ?? { error: "No ad account is selected. Ask which one (use list_ad_accounts)." };
  }
  let q = supabase.from("ad_accounts").select("id, name, nickname, balance_naira, low_balance_threshold_naira, media_buyer_id")
    .eq("id", requested).eq("company_id", ctx.companyId);
  if (ctx.role === "buyer") q = q.eq("media_buyer_id", ctx.mediaBuyerId);
  const { data: a } = await q.maybeSingle();
  if (!a) return { error: "That ad account was not found or is not yours." };
  return { id: a.id, name: a.nickname || a.name || a.id, balance: a.balance_naira ?? null, lowThreshold: a.low_balance_threshold_naira ?? null };
}

const r0 = (n: number | null | undefined, d = 0) => (n == null ? null : Number(Number(n).toFixed(d)));
const slimMetrics = (m: any) => ({
  spend: r0(m.spend), messages: m.kind === "messaging" ? m.conversations : undefined, purchases: m.kind === "purchase" ? m.purchases : undefined,
  cost_per_result: r0(m.cost_per_result), reach: m.reach, frequency: r0(m.frequency, 2), ctr_percent: r0(m.ctr, 2), impressions: m.impressions, link_clicks: m.clicks,
});

async function runTool(name: string, args: any, ctx: Ctx): Promise<unknown> {
  switch (name) {
    case "get_product": {
      const q = String(args?.product_name ?? "").trim();
      if (!q) return { error: "product_name is required" };
      const { data } = await supabase.from("products")
        .select("product_name, default_order_value_naira, description, benefits, safety_notes, nafdac_reg_no, destination_type, landing_page_url, is_active, stock_on_hand")
        .eq("company_id", ctx.companyId).ilike("product_name", `%${q.replace(/[%_]/g, "")}%`).limit(3);
      if (!data?.length) return { error: `No product matching "${q}". Ask which product they mean, or tell them to add it under Products.` };
      return { products: data };
    }

    case "get_live_ads": {
      if (!["owner", "admin", "buyer"].includes(ctx.role)) return { error: "Only owners, admins and media buyers can see live ads." };
      const acct = await accountFor(ctx, args?.ad_account_id);
      if ("error" in acct) return acct;
      const range = ["today", "yesterday", "last3", "last7", "last30", "lifetime"].includes(args?.range) ? args.range : "last7";
      const res = await fetch(ADS_URL, { method: "POST", headers: { Authorization: ctx.authHeader, "Content-Type": "application/json" }, body: JSON.stringify({ action: "list", ad_account_id: acct.id, range }) });
      const d = await res.json().catch(() => null);
      if (!d?.ok) return { error: d?.error || "Could not load live ads from Meta." };
      const onlyActive = args?.only_active !== false;
      const live = (x: any) => x.effective_status === "ACTIVE" || x.effective_status === "WITH_ISSUES";
      const adsByAdset: Record<string, any[]> = {};
      for (const a of d.ads) {
        if (onlyActive && !live(a) && !(a.spend > 0)) continue;
        (adsByAdset[a.adset_id] ??= []).push({
          id: a.id, name: a.name, status: a.effective_status, ...slimMetrics(a),
          breaks_threshold: a.suggestion?.kill ? a.suggestion.reason : undefined,
        });
      }
      const setsByCamp: Record<string, any[]> = {};
      for (const s of d.adsets) {
        const ads = adsByAdset[s.id] || [];
        if (onlyActive && !live(s) && !(s.spend > 0)) continue;
        (setsByCamp[s.campaign_id] ??= []).push({
          id: s.id, name: s.name, status: s.effective_status, type: s.kind, daily_budget: s.daily_budget, ...slimMetrics(s), ads,
        });
      }
      const campaigns = d.campaigns
        .filter((c: any) => !onlyActive || live(c) || c.spend > 0)
        .map((c: any) => ({ id: c.id, name: c.name, status: c.effective_status, daily_budget: c.daily_budget, ...slimMetrics(c), ad_sets: setsByCamp[c.id] || [] }))
        .filter((c: any) => c.ad_sets.length);
      return { account: acct.name, account_id: acct.id, range, note: "cost_per_result is cost per message for WhatsApp ads, per purchase for website ads. daily_budget is Naira.", campaigns };
    }

    case "propose_status_change": {
      if (!["owner", "admin", "buyer"].includes(ctx.role)) return { error: "Only owners, admins and media buyers can change ads." };
      const acct = await accountFor(ctx, args?.ad_account_id);
      if ("error" in acct) return acct;
      if (!["campaign", "adset", "ad"].includes(args?.level) || !/^\d+$/.test(String(args?.object_id))) return { error: "Invalid level or object_id." };
      if (!["PAUSED", "ACTIVE"].includes(args?.status)) return { error: "status must be PAUSED or ACTIVE." };
      ctx.proposals.push({ kind: "status", ad_account_id: acct.id, account_name: acct.name, level: args.level, object_id: String(args.object_id), object_name: String(args.object_name || ""), status: args.status, reason: String(args.reason || "").slice(0, 300) });
      return { ok: true, note: "Confirm card shown to the person. Not executed until they tap Confirm." };
    }

    case "propose_budget_change": {
      if (!["owner", "admin", "buyer"].includes(ctx.role)) return { error: "Only owners, admins and media buyers can change ads." };
      const acct = await accountFor(ctx, args?.ad_account_id);
      if ("error" in acct) return acct;
      const nb = Number(args?.new_daily_budget);
      if (!["campaign", "adset"].includes(args?.level) || !/^\d+$/.test(String(args?.object_id))) return { error: "Invalid level or object_id." };
      if (!Number.isFinite(nb) || nb < 500 || nb > 5_000_000) return { error: "new_daily_budget must be between ₦500 and ₦5,000,000." };
      ctx.proposals.push({ kind: "budget", ad_account_id: acct.id, account_name: acct.name, level: args.level, object_id: String(args.object_id), object_name: String(args.object_name || ""), current_daily_budget: Number(args.current_daily_budget) || null, new_daily_budget: Math.round(nb), reason: String(args.reason || "").slice(0, 300) });
      return { ok: true, note: "Confirm card shown to the person. Not executed until they tap Confirm." };
    }

    case "list_ad_accounts": {
      let q = supabase.from("ad_accounts")
        .select("id, name, nickname, status, balance_naira, balance_updated_at, low_balance_threshold_naira, media_buyer_id")
        .eq("company_id", ctx.companyId);
      if (ctx.role === "buyer") q = q.eq("media_buyer_id", ctx.mediaBuyerId);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return (data || []).map(a => ({
        id: a.id, name: a.name || a.nickname || a.id, status: a.status,
        balance: fmtNaira(a.balance_naira), balance_last_updated: a.balance_updated_at,
        low_balance_threshold: a.low_balance_threshold_naira != null ? fmtNaira(a.low_balance_threshold_naira) : null,
      }));
    }

    case "get_ad_account_performance": {
      const nameQuery = (args?.ad_account_name || "").toString().trim();
      if (!nameQuery) return { error: "ad_account_name is required." };
      const days = Math.min(Math.max(Number(args?.days) || 7, 1), 90);

      let acctQ = supabase.from("ad_accounts").select("id, name, nickname").eq("company_id", ctx.companyId)
        .or(`name.ilike.%${nameQuery}%,nickname.ilike.%${nameQuery}%`);
      if (ctx.role === "buyer") acctQ = acctQ.eq("media_buyer_id", ctx.mediaBuyerId);
      const { data: accounts, error: acctErr } = await acctQ.limit(10);
      if (acctErr) return { error: acctErr.message };
      if (!accounts || accounts.length === 0) return { error: `No ad account matching "${nameQuery}" found.` };
      if (accounts.length > 1) {
        return { ambiguous: true, matches: accounts.map(a => a.name || a.nickname || a.id) };
      }
      const account = accounts[0];

      const { data: adSets } = await supabase.from("ad_sets").select("id, adset_name, status").eq("ad_account_id", account.id).eq("company_id", ctx.companyId);
      const adSetIds = (adSets || []).map(a => a.id);
      if (!adSetIds.length) return { ad_account: account.name || account.nickname, note: "This ad account has no ad sets yet, so there's no performance data." };

      const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const { data: metrics, error: metErr } = await supabase.from("daily_metrics")
        .select("ad_set_id, spend_naira, impressions, clicks, ctr, orders, cost_per_order_naira, metric_date")
        .in("ad_set_id", adSetIds).gte("metric_date", sinceIso);
      if (metErr) return { error: metErr.message };

      const adSetNameById = new Map((adSets || []).map(a => [a.id, a.adset_name]));
      const perAdSet = new Map<string, { spend: number; orders: number; impressions: number; clicks: number }>();
      let totalSpend = 0, totalOrders = 0, totalImpressions = 0, totalClicks = 0;
      for (const m of metrics || []) {
        totalSpend += Number(m.spend_naira || 0);
        totalOrders += Number(m.orders || 0);
        totalImpressions += Number(m.impressions || 0);
        totalClicks += Number(m.clicks || 0);
        const p = perAdSet.get(m.ad_set_id) || { spend: 0, orders: 0, impressions: 0, clicks: 0 };
        p.spend += Number(m.spend_naira || 0); p.orders += Number(m.orders || 0);
        p.impressions += Number(m.impressions || 0); p.clicks += Number(m.clicks || 0);
        perAdSet.set(m.ad_set_id, p);
      }
      return {
        ad_account: account.name || account.nickname,
        period_days: days,
        spend: fmtNaira(totalSpend),
        orders: totalOrders,
        cost_per_order: totalOrders ? fmtNaira(totalSpend / totalOrders) : "n/a",
        ctr_pct: totalImpressions ? ((totalClicks / totalImpressions) * 100).toFixed(2) : "0.00",
        impressions: totalImpressions,
        clicks: totalClicks,
        per_ad_set: [...perAdSet.entries()].map(([id, p]) => ({
          ad_set: adSetNameById.get(id) || id, status: (adSets || []).find(a => a.id === id)?.status,
          spend: fmtNaira(p.spend), orders: p.orders, cost_per_order: p.orders ? fmtNaira(p.spend / p.orders) : "n/a",
        })),
      };
    }

    case "query_data": {
      return await runQueryData(args, ctx);
    }

    case "get_wallet_balance": {
      const [{ data: buyers }, { data: payments }, { data: fundRequests }, { data: withdrawals }] = await Promise.all([
        supabase.from("media_buyers").select("id, name").eq("company_id", ctx.companyId),
        supabase.from("payments").select("media_buyer_id, amount_naira, source").eq("company_id", ctx.companyId).eq("status", "confirmed"),
        supabase.from("fund_requests").select("media_buyer_id, amount_naira, status").eq("company_id", ctx.companyId),
        supabase.from("admin_withdrawals").select("amount_naira, status").eq("company_id", ctx.companyId),
      ]);
      const per: Record<string, { confirmed: number; approved: number; transferred: number }> = {};
      for (const b of buyers || []) per[b.id] = { confirmed: 0, approved: 0, transferred: 0 };
      let companyTopups = 0;
      for (const p of payments || []) {
        if (p.media_buyer_id) { per[p.media_buyer_id] = per[p.media_buyer_id] || { confirmed: 0, approved: 0, transferred: 0 }; per[p.media_buyer_id].confirmed += Number(p.amount_naira || 0); }
        else if (p.source === "admin_topup") companyTopups += Number(p.amount_naira || 0);
      }
      let approvedTotal = 0, transferredTotal = 0;
      for (const f of fundRequests || []) {
        if (f.status !== "approved" && f.status !== "transferred") continue;
        per[f.media_buyer_id] = per[f.media_buyer_id] || { confirmed: 0, approved: 0, transferred: 0 };
        if (f.status === "approved") { per[f.media_buyer_id].approved += Number(f.amount_naira || 0); approvedTotal += Number(f.amount_naira || 0); }
        else { per[f.media_buyer_id].transferred += Number(f.amount_naira || 0); transferredTotal += Number(f.amount_naira || 0); }
      }
      const withdrawnTotal = (withdrawals || []).filter(w => w.status === "sent").reduce((s, w) => s + Number(w.amount_naira || 0), 0);
      const fundingWalletBalance = companyTopups - approvedTotal - transferredTotal - withdrawnTotal;

      if (ctx.role === "buyer") {
        const mine = ctx.mediaBuyerId ? per[ctx.mediaBuyerId] || { confirmed: 0, approved: 0, transferred: 0 } : { confirmed: 0, approved: 0, transferred: 0 };
        return { your_confirmed_revenue: fmtNaira(mine.confirmed), your_approved_not_yet_sent: fmtNaira(mine.approved), your_transferred_to_ad_account: fmtNaira(mine.transferred) };
      }
      return {
        company_funding_wallet_balance: fmtNaira(fundingWalletBalance),
        company_total_topups: fmtNaira(companyTopups),
        approved_awaiting_transfer: fmtNaira(approvedTotal),
        already_transferred_to_ad_accounts: fmtNaira(transferredTotal),
        withdrawn_by_admin: fmtNaira(withdrawnTotal),
        per_buyer: (buyers || []).map(b => ({ name: b.name, confirmed_revenue: fmtNaira(per[b.id]?.confirmed || 0), approved_not_yet_sent: fmtNaira(per[b.id]?.approved || 0) })),
      };
    }

    case "request_funds": {
      if (ctx.role !== "buyer" || !ctx.mediaBuyerId) return { error: "Only a media buyer can request funds. This account isn't a buyer." };
      const amount = Number(args?.amount_naira);
      if (!amount || amount <= 0) return { error: "A valid positive amount_naira is required." };
      const { data: inserted, error } = await supabase.from("fund_requests").insert({
        company_id: ctx.companyId, media_buyer_id: ctx.mediaBuyerId, amount_naira: amount, note: args?.note || null,
      }).select().single();
      if (error) return { error: "Could not submit request: " + error.message };
      // Same notifications the dashboard's own "Request funds" button fires -- fire-and-forget.
      fetch(`${SUPABASE_URL}/functions/v1/send-internal-whatsapp`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "fund_request_submitted", fund_request_id: inserted.id }) }).catch(() => {});
      fetch(`${SUPABASE_URL}/functions/v1/send-internal-email`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "fund_request_submitted", fund_request_id: inserted.id }) }).catch(() => {});
      return { ok: true, submitted: { id: inserted.id, amount: fmtNaira(amount), note: args?.note || null, status: "pending" } };
    }

    case "list_pending_fund_requests": {
      if (ctx.role !== "owner" && ctx.role !== "admin") return { error: "Only an owner/admin can see pending fund requests." };
      const { data: requests, error } = await supabase.from("fund_requests").select("id, media_buyer_id, amount_naira, note, requested_at").eq("company_id", ctx.companyId).eq("status", "pending").order("requested_at", { ascending: true });
      if (error) return { error: error.message };
      const { data: buyers } = await supabase.from("media_buyers").select("id, name").eq("company_id", ctx.companyId);
      const nameById = new Map((buyers || []).map(b => [b.id, b.name]));
      return (requests || []).map(r => ({ fund_request_id: r.id, buyer: nameById.get(r.media_buyer_id) || "Unknown", amount: fmtNaira(r.amount_naira), note: r.note, requested_at: r.requested_at }));
    }

    case "approve_fund_request": {
      if (ctx.role !== "owner" && ctx.role !== "admin") return { error: "Only an owner/admin can approve fund requests." };
      const id = args?.fund_request_id;
      if (!id) return { error: "fund_request_id is required." };
      const { data: existing } = await supabase.from("fund_requests").select("id, company_id, status, amount_naira, media_buyer_id").eq("id", id).maybeSingle();
      if (!existing || existing.company_id !== ctx.companyId) return { error: "Fund request not found." };
      if (existing.status !== "pending") return { error: `This request is already "${existing.status}", not pending.` };
      const { error } = await supabase.from("fund_requests").update({ status: "approved", decided_at: new Date().toISOString(), decided_by: ctx.userId }).eq("id", id);
      if (error) return { error: error.message };
      return { ok: true, approved: { fund_request_id: id, amount: fmtNaira(existing.amount_naira) } };
    }

    case "resolve_bank_account": {
      if (ctx.role !== "owner" && ctx.role !== "admin") return { error: "Only an owner/admin can send money this way." };
      const accountNumber = (args?.account_number || "").toString().trim();
      const bankNameQuery = (args?.bank_name || "").toString().trim();
      const amount = Number(args?.amount_naira);
      if (!accountNumber || !bankNameQuery) return { error: "account_number and bank_name are required." };
      if (!amount || amount <= 0) return { error: "A valid positive amount_naira is required." };
      const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
      if (!PAYSTACK_SECRET_KEY) return { error: "Paystack isn't configured yet (PAYSTACK_SECRET_KEY missing)." };

      const bankListRes = await fetch("https://api.paystack.co/bank?country=nigeria", { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
      const bankList = await bankListRes.json().catch(() => null);
      if (!bankListRes.ok || !bankList?.data) return { error: "Could not load the bank list from Paystack." };

      const q = bankNameQuery.toLowerCase();
      const exact = bankList.data.find((b: any) => b.name.toLowerCase() === q);
      const matches = exact ? [exact] : bankList.data.filter((b: any) => b.name.toLowerCase().includes(q) || (b.slug || "").toLowerCase().includes(q));
      if (!matches.length) return { error: `No bank matching "${bankNameQuery}" found.` };
      if (matches.length > 1) return { ambiguous: true, matches: matches.slice(0, 8).map((b: any) => b.name) };
      const bank = matches[0];

      const resolveRes = await fetch(`https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bank.code)}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
      const resolved = await resolveRes.json().catch(() => null);
      if (!resolveRes.ok || !resolved?.data?.account_name) return { error: resolved?.message || "Could not verify this account. Double-check the account number and bank." };

      return {
        verified: true,
        account_number: accountNumber,
        bank_name: bank.name,
        bank_code: bank.code,
        account_name: resolved.data.account_name,
        amount_naira: amount,
        amount: fmtNaira(amount),
        note: args?.note || null,
      };
    }

    case "resolve_meta_transfer_account": {
      if (ctx.role !== "buyer" || !ctx.mediaBuyerId) return { error: "This is only for media buyers sending their own approved funds." };
      const accountNumber = (args?.account_number || "").toString().trim();
      const bankNameQuery = (args?.bank_name || "").toString().trim();
      if (!accountNumber || !bankNameQuery) return { error: "account_number and bank_name are required." };

      const { data: approved } = await supabase.from("fund_requests")
        .select("id, amount_naira, note, requested_at")
        .eq("company_id", ctx.companyId).eq("media_buyer_id", ctx.mediaBuyerId)
        .eq("status", "approved").is("paystack_transfer_code", null)
        .order("requested_at", { ascending: true });
      if (!approved || !approved.length) return { error: "You have no approved fund requests ready to transfer. Request funds first and wait for admin approval." };

      let fr = approved[0];
      if (approved.length > 1) {
        const pickedAmount = args?.amount_naira != null ? Number(args.amount_naira) : null;
        const picked = pickedAmount != null ? approved.find(f => Number(f.amount_naira) === pickedAmount) : null;
        if (!picked) {
          return { ambiguous: true, matches: approved.map(f => `${fmtNaira(f.amount_naira)} request from ${new Date(f.requested_at).toLocaleDateString()}`) };
        }
        fr = picked;
      }

      const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
      if (!PAYSTACK_SECRET_KEY) return { error: "Paystack isn't configured yet (PAYSTACK_SECRET_KEY missing)." };

      const bankListRes = await fetch("https://api.paystack.co/bank?country=nigeria", { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
      const bankList = await bankListRes.json().catch(() => null);
      if (!bankListRes.ok || !bankList?.data) return { error: "Could not load the bank list from Paystack." };

      const q = bankNameQuery.toLowerCase();
      const exact = bankList.data.find((b: any) => b.name.toLowerCase() === q);
      const matches = exact ? [exact] : bankList.data.filter((b: any) => b.name.toLowerCase().includes(q) || (b.slug || "").toLowerCase().includes(q));
      if (!matches.length) return { error: `No bank matching "${bankNameQuery}" found.` };
      if (matches.length > 1) return { ambiguous: true, matches: matches.slice(0, 8).map((b: any) => b.name) };
      const bank = matches[0];

      const resolveRes = await fetch(`https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bank.code)}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
      const resolved = await resolveRes.json().catch(() => null);
      if (!resolveRes.ok || !resolved?.data?.account_name) return { error: resolved?.message || "Could not verify this account. Double-check the account number and bank." };
      const accountName = resolved.data.account_name;

      if (!/facebook|meta/i.test(accountName)) {
        return { error: `This account resolved to "${accountName}", which isn't a Facebook/Meta account. Only transfers into your Meta Ads billing account are allowed -- double-check you copied today's top-up account number from Ads Manager, not an old one.` };
      }

      return {
        verified: true,
        kind: "meta_transfer",
        fund_request_id: fr.id,
        account_number: accountNumber,
        bank_name: bank.name,
        bank_code: bank.code,
        account_name: accountName,
        amount_naira: fr.amount_naira,
        amount: fmtNaira(fr.amount_naira),
        note: "Meta/Facebook Ads billing top-up",
      };
    }

    default:
      return { error: "Unknown tool: " + name };
  }
}

// ── query_data: one generic, safe lookup tool covering most of the rest of
// the site (orders, ad sets, metrics, creatives, products, leaderboard,
// approvals, call logs, website leads). Every table is allow-listed by
// name, selectable columns, filterable columns and which roles may see it
// at all -- mirroring what that role already sees in the dashboard's own
// tabs (HIDDEN_TABS_BY_ROLE in dashboard_new.html). company_id is always
// forced server-side; a buyer additionally gets forced to their own rows
// where the table has an owner column, regardless of what's asked. ───────

type TableConfig = {
  columns: string[];
  allowedRoles: string[];
  buyerCol?: string;
  deliveryCol?: string;
  dateCol?: string;
  filterable: string[];
  searchCols?: string[];
};

const TABLE_CONFIGS: Record<string, TableConfig> = {
  orders: {
    columns: ["id", "customer_name", "customer_phone", "customer_city", "customer_state", "product_name", "quantity", "order_value_naira", "order_status", "payment_method", "media_buyer_id", "delivery_agent_id", "assignment_status", "possible_duplicate", "followup_attempts", "ordered_at", "delivered_at"],
    allowedRoles: ["owner", "admin", "buyer", "customer_care", "delivery_agent"],
    buyerCol: "media_buyer_id", deliveryCol: "delivery_agent_id", dateCol: "ordered_at",
    filterable: ["order_status", "media_buyer_id", "delivery_agent_id", "possible_duplicate", "assignment_status"],
    searchCols: ["customer_name", "customer_phone"],
  },
  ad_sets: {
    columns: ["id", "adset_name", "campaign_id", "creative_id", "status", "media_buyer_id", "ad_account_id", "budget_naira", "targeting_type", "created_at"],
    allowedRoles: ["owner", "admin", "buyer"],
    buyerCol: "media_buyer_id", dateCol: "created_at",
    filterable: ["status", "media_buyer_id", "ad_account_id", "campaign_id"],
    searchCols: ["adset_name"],
  },
  daily_metrics: {
    columns: ["ad_set_id", "metric_date", "spend_naira", "impressions", "clicks", "ctr", "cpc_naira", "cpm_naira", "orders", "cost_per_order_naira", "frequency"],
    allowedRoles: ["owner", "admin", "buyer"],
    dateCol: "metric_date",
    filterable: ["ad_set_id"],
  },
  creative_assets: {
    columns: ["id", "headline", "file_name", "asset_type", "test_status", "campaign_name", "product_id", "uploaded_at"],
    allowedRoles: ["owner", "admin", "buyer"],
    dateCol: "uploaded_at",
    filterable: ["test_status", "product_id"],
    searchCols: ["headline", "file_name", "campaign_name"],
  },
  products: {
    columns: ["id", "product_name", "default_order_value_naira", "currency", "is_active", "stock_on_hand", "low_stock_threshold", "destination_type"],
    allowedRoles: ["owner", "admin", "buyer", "customer_care"],
    filterable: ["is_active"],
    searchCols: ["product_name"],
  },
  media_buyers: {
    columns: ["id", "name", "code", "active"],
    allowedRoles: ["owner", "admin", "buyer"],
    filterable: ["active"],
    searchCols: ["name"],
  },
  pending_approvals: {
    columns: ["id", "approval_type", "reason", "status", "requested_at", "responded_at"],
    allowedRoles: ["owner", "admin", "buyer"],
    dateCol: "requested_at",
    filterable: ["status", "approval_type"],
  },
  voice_calls: {
    columns: ["id", "order_id", "status", "summary", "needs_human", "duration_secs", "created_at"],
    allowedRoles: ["owner", "admin", "customer_care"],
    dateCol: "created_at",
    filterable: ["status", "needs_human"],
  },
  website_leads: {
    columns: ["id", "name", "phone", "product_name", "city", "state", "package", "status", "created_at"],
    allowedRoles: ["owner", "admin", "customer_care"],
    dateCol: "created_at",
    filterable: ["status"],
    searchCols: ["name", "phone"],
  },
};

async function runQueryData(args: any, ctx: Ctx): Promise<unknown> {
  const table = (args?.table || "").toString();
  const cfg = TABLE_CONFIGS[table];
  if (!cfg) return { error: `Unknown table "${table}". Allowed: ${Object.keys(TABLE_CONFIGS).join(", ")}` };
  if (!cfg.allowedRoles.includes(ctx.role)) return { error: `Your role (${ctx.role}) isn't allowed to query ${table}.` };

  let q = supabase.from(table).select(cfg.columns.join(", ")).eq("company_id", ctx.companyId);

  if (ctx.role === "buyer" && cfg.buyerCol) q = q.eq(cfg.buyerCol, ctx.mediaBuyerId);
  if (ctx.role === "delivery_agent") {
    if (table !== "orders" || !cfg.deliveryCol) return { error: "As a delivery agent you can only query your own orders." };
    q = q.eq(cfg.deliveryCol, ctx.deliveryAgentId);
  }

  // daily_metrics has no owning-buyer column of its own -- scope a buyer to
  // metrics on just their own ad sets instead.
  if (table === "daily_metrics" && ctx.role === "buyer") {
    const { data: myAdSets } = await supabase.from("ad_sets").select("id").eq("company_id", ctx.companyId).eq("media_buyer_id", ctx.mediaBuyerId);
    const ids = (myAdSets || []).map(a => a.id);
    if (!ids.length) return [];
    q = q.in("ad_set_id", ids);
  }

  const filters = args?.filters && typeof args.filters === "object" ? args.filters : {};
  for (const [col, val] of Object.entries(filters)) {
    if (!cfg.filterable.includes(col)) continue;
    q = Array.isArray(val) ? q.in(col, val) : q.eq(col, val as any);
  }

  if (args?.search && cfg.searchCols?.length) {
    const term = String(args.search).trim();
    if (term) q = q.or(cfg.searchCols.map(c => `${c}.ilike.%${term}%`).join(","));
  }

  if (args?.days && cfg.dateCol) {
    const sinceDate = new Date(Date.now() - Math.min(Number(args.days) || 7, 365) * 24 * 3600 * 1000).toISOString();
    q = q.gte(cfg.dateCol, cfg.dateCol === "metric_date" ? sinceDate.slice(0, 10) : sinceDate);
  }

  const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 50);
  q = q.limit(limit);
  if (cfg.dateCol) q = q.order(cfg.dateCol, { ascending: false });

  const { data, error } = await q;
  if (error) return { error: error.message };
  return data;
}

// ── Role-scoped upfront context builders ──────────────────────────────────

async function buildAdminContext(companyId: string, sinceIso: string) {
  const [{ data: buyers }, { data: adSets }, { data: metrics }, { data: orders }, { data: calls }, { data: approvals }, { data: creatives }] = await Promise.all([
    supabase.from("media_buyers").select("id, name, code").eq("company_id", companyId).eq("active", true),
    supabase.from("ad_sets").select("id, adset_name, media_buyer_id, creative_id, status, campaign_id").eq("company_id", companyId).limit(500),
    supabase.from("daily_metrics").select("ad_set_id, spend_naira, orders, ctr, cost_per_order_naira, metric_date").eq("company_id", companyId).gte("metric_date", sinceIso.slice(0, 10)).limit(2000),
    supabase.from("orders").select("id, media_buyer_id, ad_set_id, creative_id, order_status, order_value_naira, possible_duplicate, followup_attempts, ordered_at").eq("company_id", companyId).gte("ordered_at", sinceIso).limit(2000),
    supabase.from("voice_calls").select("status, needs_human").eq("company_id", companyId).gte("created_at", sinceIso).limit(2000),
    supabase.from("pending_approvals").select("id").eq("company_id", companyId).eq("status", "pending"),
    supabase.from("creative_assets").select("id, headline, file_name").eq("company_id", companyId).limit(500),
  ]);

  const adSetById = new Map((adSets || []).map(a => [a.id, a]));
  const creativeById = new Map((creatives || []).map(c => [c.id, c]));

  const buyerStats = new Map<string, { name: string; code: string; spend: number; orders: number; delivered: number; value: number }>();
  for (const b of buyers || []) buyerStats.set(b.id, { name: b.name, code: b.code, spend: 0, orders: 0, delivered: 0, value: 0 });
  for (const m of metrics || []) {
    const buyerId = adSetById.get(m.ad_set_id)?.media_buyer_id;
    if (buyerId && buyerStats.has(buyerId)) buyerStats.get(buyerId)!.spend += Number(m.spend_naira || 0);
  }
  for (const o of orders || []) {
    if (o.media_buyer_id && buyerStats.has(o.media_buyer_id)) {
      const s = buyerStats.get(o.media_buyer_id)!;
      s.orders++;
      s.value += Number(o.order_value_naira || 0);
      if (o.order_status === "delivered") s.delivered++;
    }
  }

  const ordersByAdSet = new Map<string, number>();
  const ordersByCreative = new Map<string, number>();
  for (const o of orders || []) {
    if (o.ad_set_id) ordersByAdSet.set(o.ad_set_id, (ordersByAdSet.get(o.ad_set_id) || 0) + 1);
    if (o.creative_id) ordersByCreative.set(o.creative_id, (ordersByCreative.get(o.creative_id) || 0) + 1);
  }
  const topAdSets = [...ordersByAdSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, n]) => ({ ad_set: adSetById.get(id)?.adset_name || id, orders: n }));
  const topCreatives = [...ordersByCreative.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, n]) => ({ creative: creativeById.get(id)?.headline || creativeById.get(id)?.file_name || id, orders: n }));

  const callStatusCounts: Record<string, number> = {};
  let needsHuman = 0;
  for (const c of calls || []) { callStatusCounts[c.status] = (callStatusCounts[c.status] || 0) + 1; if (c.needs_human) needsHuman++; }

  return {
    period: "last 7 days",
    buyers: [...buyerStats.values()].map(s => ({
      name: s.name, code: s.code, spend: fmtNaira(s.spend), orders: s.orders, delivered: s.delivered,
      order_value: fmtNaira(s.value), cpa: s.orders ? fmtNaira(s.spend / s.orders) : "n/a",
    })),
    top_ad_sets_by_orders: topAdSets,
    top_creatives_by_orders: topCreatives,
    ai_call_agent_outcomes_last_7_days: callStatusCounts,
    calls_flagged_needing_a_human: needsHuman,
    pending_approvals_awaiting_review: (approvals || []).length,
    possible_duplicate_orders: (orders || []).filter(o => o.possible_duplicate).length,
    orders_stuck_after_followup_attempts: (orders || []).filter(o => (o.followup_attempts || 0) > 0).length,
    total_orders_last_7_days: (orders || []).length,
  };
}

async function buildBuyerContext(companyId: string, mediaBuyerId: string | null, sinceIso: string) {
  if (!mediaBuyerId) return { note: "This account isn't linked to a media buyer profile yet, so there's no campaign/order data to show." };

  const [{ data: adSets }, { data: creatives }, { data: orders }] = await Promise.all([
    supabase.from("ad_sets").select("id, adset_name, creative_id, status").eq("company_id", companyId).eq("media_buyer_id", mediaBuyerId).limit(300),
    supabase.from("creative_assets").select("id, headline, file_name").eq("company_id", companyId).limit(300),
    supabase.from("orders").select("id, order_status, order_value_naira, ad_set_id, creative_id, ordered_at, delivery_agent_id, assignment_status").eq("company_id", companyId).eq("media_buyer_id", mediaBuyerId).gte("ordered_at", sinceIso).limit(1000),
  ]);
  const adSetIds = (adSets || []).map(a => a.id);
  const { data: metrics } = adSetIds.length
    ? await supabase.from("daily_metrics").select("ad_set_id, spend_naira, ctr, cost_per_order_naira, orders, metric_date").in("ad_set_id", adSetIds).gte("metric_date", sinceIso.slice(0, 10)).limit(2000)
    : { data: [] as any[] };

  const adSetById = new Map((adSets || []).map(a => [a.id, a]));
  const creativeById = new Map((creatives || []).map(c => [c.id, c]));

  const totalSpend = (metrics || []).reduce((s, m) => s + Number(m.spend_naira || 0), 0);
  const avgCtr = (metrics || []).length ? (metrics || []).reduce((s, m) => s + Number(m.ctr || 0), 0) / (metrics || []).length : 0;

  const ordersByAdSet = new Map<string, number>();
  for (const o of orders || []) if (o.ad_set_id) ordersByAdSet.set(o.ad_set_id, (ordersByAdSet.get(o.ad_set_id) || 0) + 1);
  const topAdSets = [...ordersByAdSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, n]) => ({ ad_set: adSetById.get(id)?.adset_name || id, orders: n, creative: creativeById.get(adSetById.get(id)?.creative_id)?.headline || null }));

  const orderIds = (orders || []).map(o => o.id);
  const { data: calls } = orderIds.length
    ? await supabase.from("voice_calls").select("order_id, status").in("order_id", orderIds).gte("created_at", sinceIso).limit(1000)
    : { data: [] as any[] };
  const callStatusCounts: Record<string, number> = {};
  for (const c of calls || []) callStatusCounts[c.status] = (callStatusCounts[c.status] || 0) + 1;
  const ordersWithDeliveryAgent = (orders || []).filter(o => o.delivery_agent_id).length;
  const ordersAwaitingRiderAcceptance = (orders || []).filter(o => o.assignment_status === "offered").length;

  return {
    period: "last 7 days",
    campaigns_summary: { active_ad_sets: (adSets || []).filter(a => a.status === "active" || a.status === "ACTIVE").length, total_ad_sets: (adSets || []).length, spend: fmtNaira(totalSpend), avg_ctr_pct: avgCtr.toFixed(2) },
    top_ad_sets_by_orders: topAdSets,
    orders_summary: {
      total: (orders || []).length,
      delivered: (orders || []).filter(o => o.order_status === "delivered").length,
      pending: (orders || []).filter(o => o.order_status === "pending").length,
      value: fmtNaira((orders || []).reduce((s, o) => s + Number(o.order_value_naira || 0), 0)),
    },
    ai_call_agent_on_new_orders: {
      calls_made: (calls || []).length,
      outcomes: callStatusCounts,
      note: "Every new order automatically gets an AI call attempt to confirm it; outcomes are also visible to Customer Care in the Support Queue, and confirmed orders move to a delivery agent for dispatch.",
    },
    delivery_handoff: { orders_assigned_to_a_delivery_agent: ordersWithDeliveryAgent, orders_awaiting_rider_acceptance: ordersAwaitingRiderAcceptance },
  };
}

async function buildCareContext(companyId: string, sinceIso: string) {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, customer_name, customer_phone, order_status, possible_duplicate, followup_attempts, ordered_at")
    .eq("company_id", companyId)
    .gte("ordered_at", sinceIso)
    .limit(1000);
  const orderById = new Map((orders || []).map(o => [o.id, o]));

  const { data: calls } = await supabase
    .from("voice_calls")
    .select("order_id, status, summary, red_flags, needs_human, created_at")
    .eq("company_id", companyId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(500);

  const needsAttention = (calls || [])
    .filter(c => c.needs_human || c.status === "failed" || c.status === "no_answer")
    .slice(0, 20)
    .map(c => ({
      customer: orderById.get(c.order_id)?.customer_name || "Unknown",
      phone: orderById.get(c.order_id)?.customer_phone || null,
      call_status: c.status, needs_human: c.needs_human, red_flags: c.red_flags, summary: c.summary,
    }));

  const duplicates = (orders || []).filter(o => o.possible_duplicate)
    .map(o => ({ customer: o.customer_name, phone: o.customer_phone, status: o.order_status }));
  const stuck = (orders || []).filter(o => (o.followup_attempts || 0) > 0)
    .map(o => ({ customer: o.customer_name, phone: o.customer_phone, status: o.order_status, followup_attempts: o.followup_attempts }));

  return {
    period: "last 7 days",
    calls_needing_a_human_right_now: needsAttention,
    possible_duplicate_orders: duplicates,
    stuck_orders_after_followup_attempts: stuck,
    totals: { orders_last_7_days: (orders || []).length, calls_last_7_days: (calls || []).length },
  };
}

async function buildDeliveryContext(companyId: string, deliveryAgentId: string | null, sinceIso: string) {
  if (!deliveryAgentId) return { note: "This account isn't linked to a delivery agent profile yet." };
  const { data: orders } = await supabase
    .from("orders")
    .select("id, customer_name, customer_city, order_status, assignment_status, order_value_naira, ordered_at")
    .eq("company_id", companyId)
    .eq("delivery_agent_id", deliveryAgentId)
    .gte("ordered_at", sinceIso)
    .limit(500);
  return {
    period: "last 7 days",
    awaiting_your_acceptance: (orders || []).filter(o => o.assignment_status === "offered").map(o => ({ customer: o.customer_name, city: o.customer_city })),
    active_deliveries: (orders || []).filter(o => o.assignment_status === "accepted" && o.order_status !== "delivered").length,
    delivered_this_period: (orders || []).filter(o => o.order_status === "delivered").length,
  };
}
