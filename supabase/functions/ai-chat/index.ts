import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Powers the "AI Assistant" chat panel in dashboard_new.html and, through action run_tool, the MCP server.
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
type Ctx = { companyId: string; role: string; mediaBuyerId: string | null; deliveryAgentId: string | null; userId: string; displayName: string; authHeader: string; account: ActiveAccount | null; proposals: any[]; cards: any[] };


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
- PRODUCT FIRST: before any ad copy be completely sure which product it is for. If the person names a product, use exactly that one; if they do not and there is more than one, ask. If write_ad_copy replies that it needs info, ask the person that one question, save their answer with save_product_facts, then try again. Never write copy for a product from the business type alone.
- RUNNING ADS FOR THEM (you are their personal senior media buyer): when they ask to launch ads, do it by conversation and cards. Order: (1) know the product (see PRODUCT FIRST); (2) ALWAYS ask, with ONE ask_questions card, anything the person has not already told you: where ads send people (their WEBSITE to buy, or WHATSAPP chat), daily budget per ad set, who should see it and where, how many ad sets and ads. Never assume a destination or budget, and never call plan_campaign until they have answered; (3) if they have not given copy, call write_ad_copy; (4) call show_creatives with the first ad's copy, then wait for their pick. Creatives are listed per product with every image and video (vault uploads AND the product photo); say how many of each exist and that none is a video if so. One creative can be reused in several ads, so 3 creatives can make 5 ads with different copy (use ads[]); (5) turn plain audience wishes into real targeting with search_audiences (interests, job types like business owners or students, cities) and Nigerian state names; (6) call plan_campaign. If they explicitly say to decide the structure, use: 3 ad sets (an interest audience, a broad audience, one more angle), 3 ads per ad set, the budget split by expected value. You can never launch: only their tap on Approve on the plan card launches, so never say anything is live until they tell you it is. Use check_pixel for any question about the pixel or tracking.
- EXPLAINING RESULTS: never dump a list of metrics. Start with a one-sentence answer, then explain in plain words what the few numbers that matter mean (spend, results, cost per result against their target), then call review_ads_card for the Keep, Watch and Stop groups with real ids and tap buttons. Do not repeat the card's contents in text. Judge ads only after about 2 to 3 times the target cost per result in spend. To scale a winner: raise budget 20 percent, or duplicate it into the same campaign (the winner keeps running and the copy goes live; never kill a winner). A BAD ad is relaunched: offer duplicate (a fresh live copy) and the old one is switched off in the same tap. Only bad ads are ever stopped.
- Use only facts from the product record or what the user told you. Never invent claims, testimonials, numbers, discounts or registration numbers.
- META AD POLICY: no guaranteed results; no before-and-after claims for body, weight or skin; no implying you know a person's health, body, finances or identity; no medical cures; no shocking or misleading claims; no fake urgency. Health and wellness copy talks about support, comfort and experience, not cures.
- ADVICE: when asked what to do (launch, kill, scale, budget, testing), give a clear recommendation first, then the reason in a sentence or two with the real numbers. If the data needed is not available, say so and say how to get it. Test one change at a time; give each new creative about 2-3 times the target cost per result in spend before judging; scale winners gradually.
- If they ask for a different language or tone in chat (for example "write it in full Pidgin" or "in Yoruba"), do that for that request.
- Ask at most one short clarifying question, and only when you truly cannot proceed.`;

// ── Examples from the person's own past ads ───────────────────────────────
type CopyEx = { text: string; headline: string; description: string; spend: number | null; cost: number | null; ctr: number | null; note: string; product?: string | null; same?: boolean };
const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function adCopyFromCreative(cr: any): { text: string; headline: string; description: string } {
  const ld = cr?.object_story_spec?.link_data ?? cr?.object_story_spec?.video_data ?? {};
  const afs = cr?.asset_feed_spec ?? {};
  const text = String(cr?.body ?? ld.message ?? ld.description ?? afs?.bodies?.[0]?.text ?? "").trim();
  const headline = String(cr?.title ?? ld.name ?? ld.title ?? afs?.titles?.[0]?.text ?? "").trim();
  const description = String(ld.link_description ?? afs?.descriptions?.[0]?.text ?? "").trim();
  return { text, headline, description };
}

async function getCopyExamples(ctx: Ctx, productName = ""): Promise<{ winners: CopyEx[]; losers: CopyEx[]; others: CopyEx[]; source: string }> {
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
          const tgt = norm(productName);
          rows.push({ text: clip(c.text, 1100), headline: c.headline, description: c.description, spend: m ? Number(m.spend) : null, cost: m?.cost_per_result != null ? Number(m.cost_per_result) : null, ctr: m?.ctr != null ? Number(m.ctr) : null, note: m?.kind === "purchase" ? "cost per purchase" : "cost per WhatsApp message", product: tgt && !norm(`${ad.name} ${c.headline} ${c.text}`).includes(tgt) ? "another product" : null, same: tgt ? norm(`${ad.name} ${c.headline} ${c.text}`).includes(tgt) : undefined });
        }
        const judged = rows.filter((r) => r.spend != null && r.spend >= 1500 && r.same !== false);
        out.winners = judged.filter((r) => r.cost != null).sort((a, b) => (a.cost as number) - (b.cost as number)).slice(0, 5);
        const winSet = new Set(out.winners);
        out.losers = judged.filter((r) => !winSet.has(r) && (r.cost == null || (r.spend as number) >= 3000)).sort((a, b) => ((b.cost ?? 1e9) as number) - ((a.cost ?? 1e9) as number)).slice(0, 3);
        out.others = rows.filter((r) => !winSet.has(r) && !out.losers.includes(r)).sort((a, b) => Number(b.same !== false) - Number(a.same !== false)).slice(0, 4);
        if (rows.length) out.source = "this ad account";
      }
    }
  } catch (_e) { /* fall through to the company's saved copy */ }
  // 2. Ads this seller imported into their library (kept even after the ads are paused or deleted).
  // The seller's library follows the PERSON, not the ad account: their own past ads first (so it survives switching accounts),
  // then the rest of the company's. Rows about the same product are used as proof; rows about other products are style only.
  if (out.winners.length + out.others.length < 3) {
    const cols = "primary_text, headline, description, spend, cost_per_result, ctr, result_kind, product_name, media_buyer_id, source";
    const { data: lib } = await supabase.from("ad_library").select(cols)
      .eq("company_id", ctx.companyId).neq("source", "ai_draft").order("cost_per_result", { ascending: true, nullsFirst: false }).limit(150).then((r: any) => r).catch(() => ({ data: [] }));
    const target = norm(productName);
    const mine = (l: any) => ctx.role === "buyer" ? (l.media_buyer_id === ctx.mediaBuyerId ? 0 : 1) : 0;
    const rows: CopyEx[] = (lib ?? []).slice().sort((a: any, b: any) => mine(a) - mine(b)).map((l: any) => ({
      text: clip(String(l.primary_text), 1100), headline: l.headline ?? "", description: l.description ?? "",
      spend: l.spend != null ? Number(l.spend) : null, cost: l.cost_per_result != null ? Number(l.cost_per_result) : null, ctr: l.ctr != null ? Number(l.ctr) : null,
      note: l.result_kind === "purchase" ? "cost per purchase" : "cost per WhatsApp message", product: l.product_name ?? null,
      same: !!target && (norm(l.product_name) === target || norm(l.primary_text).includes(target)),
    }));
    // When we know the product, only same-product ads count as winners or losers; the rest is tone reference.
    const pool = target ? rows.filter((r) => r.same) : rows;
    const judged = pool.filter((r) => r.cost != null && (r.spend ?? 0) >= 1500);
    if (!out.winners.length) out.winners = judged.sort((a, b) => (a.cost as number) - (b.cost as number)).slice(0, 5);
    const used = new Set(out.winners);
    if (!out.losers.length) out.losers = pool.filter((r) => !used.has(r) && (r.spend ?? 0) >= 3000 && (r.cost == null || r.cost > 0)).sort((a, b) => ((b.cost ?? 1e9) as number) - ((a.cost ?? 1e9) as number)).slice(0, 3);
    out.others.push(...rows.filter((r) => !used.has(r) && !out.losers.includes(r)).sort((a, b) => Number(!!b.same) - Number(!!a.same)).slice(0, 4));
    if (rows.length && out.source === "none") out.source = "this seller's ad library";
  }
  if (out.winners.length < 2) {
    const { data: co } = await supabase.from("companies").select("business_types").eq("id", ctx.companyId).maybeSingle();
    const niche = (co?.business_types ?? [])[0];
    if (niche) {
      const { data: pool } = await supabase.from("ad_library").select("primary_text, headline, description, spend, cost_per_result, ctr, result_kind")
        .eq("share_to_niche", true).eq("niche", niche).neq("company_id", ctx.companyId).gte("spend", 3000).not("cost_per_result", "is", null)
        .order("cost_per_result", { ascending: true }).limit(3).then((r: any) => r).catch(() => ({ data: [] }));
      for (const l of pool ?? []) out.winners.push({ text: clip(String(l.primary_text), 1100), headline: l.headline ?? "", description: l.description ?? "", spend: Number(l.spend), cost: Number(l.cost_per_result), ctr: l.ctr != null ? Number(l.ctr) : null, note: l.result_kind === "purchase" ? "cost per purchase" : "cost per WhatsApp message", product: "another seller's ad", same: false });
      if (pool?.length && out.source === "none") out.source = "proven ads in this niche";
    }
  }
  // 4. The company's own saved ads (no live results), when still thin.
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

// Pulls every ad (with its copy and lifetime results) from one of the seller's ad accounts into ad_library.
async function importLibrary(body: any, p: { companyId: string; role: string; mediaBuyerId: string | null }) {
  const id = String(body?.ad_account_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Pick an ad account first.");
  let q = supabase.from("ad_accounts").select("id, meta_ad_account_id, meta_connection_id, media_buyer_id").eq("id", id).eq("company_id", p.companyId);
  if (p.role === "buyer") q = q.eq("media_buyer_id", p.mediaBuyerId);
  const { data: acct } = await q.maybeSingle();
  if (!acct) throw new Error("That ad account isn't yours.");
  const actId = String(acct.meta_ad_account_id ?? "").replace(/^act_/, "");
  if (!/^\d+$/.test(actId)) throw new Error("This ad account has no Meta ID.");
  let token = META_TOKEN_SHARED;
  if (acct.meta_connection_id) {
    const { data: conn } = await supabase.from("meta_connections").select("access_token, status").eq("id", acct.meta_connection_id).eq("company_id", p.companyId).maybeSingle();
    if (conn?.status === "active" && conn.access_token) token = conn.access_token;
  }
  const { data: co } = await supabase.from("companies").select("business_types").eq("id", p.companyId).maybeSingle();
  const niche = (co?.business_types ?? [])[0] ?? null;
  const { data: prods } = await supabase.from("products").select("id, product_name").eq("company_id", p.companyId);
  const productOf = (txt: string) => { const t = norm(txt); const hit = (prods ?? []).filter((x: any) => norm(x.product_name).length > 2 && t.includes(norm(x.product_name))).sort((a: any, b: any) => b.product_name.length - a.product_name.length)[0]; return hit ? { id: hit.id, name: hit.product_name } : null; };
  const share = body?.share_to_niche === true && ["owner", "admin"].includes(p.role);
  const fields = "id,name,effective_status,creative{body,title,object_story_spec,asset_feed_spec},insights.date_preset(maximum){spend,ctr,actions,cost_per_action_type}";
  let url: string | null = `https://graph.facebook.com/v21.0/act_${actId}/ads?fields=${encodeURIComponent(fields)}&limit=50&access_token=${token}`;
  const rows: any[] = []; let seen = 0;
  for (let page = 0; url && page < 8; page++) {
    const r = await fetch(url).then((x) => x.json());
    if (r?.error) throw new Error("Meta: " + (r.error.message || "could not read the ads"));
    for (const ad of r.data ?? []) {
      seen++;
      const c = adCopyFromCreative(ad.creative);
      if (c.text.length < 30) continue;
      const ins = ad.insights?.data?.[0];
      const acts: any[] = ins?.actions ?? [];
      const get = (t: string[]) => acts.find((a) => t.includes(a.action_type));
      const buy = get(["purchase", "offsite_conversion.fb_pixel_purchase"]);
      const msg = get(["onsite_conversion.messaging_conversation_started_7d"]);
      const hit = buy ?? msg;
      const kind = buy ? "purchase" : msg ? "message" : null;
      const costRow = (ins?.cost_per_action_type ?? []).find((a: any) => a.action_type === hit?.action_type);
      const prod = productOf(`${ad.name ?? ""} ${c.headline} ${c.text}`);
      rows.push({
        product_id: prod?.id ?? null, product_name: prod?.name ?? null, source: "meta_import",
        company_id: p.companyId, media_buyer_id: acct.media_buyer_id, ad_account_id: acct.id, meta_ad_id: String(ad.id), name: ad.name ?? null,
        primary_text: c.text, headline: c.headline || null, description: c.description || null, niche, effective_status: ad.effective_status ?? null,
        spend: ins?.spend != null ? Number(ins.spend) : null, results: hit ? Number(hit.value) : null, cost_per_result: costRow ? Number(costRow.value) : null,
        ctr: ins?.ctr != null ? Number(ins.ctr) : null, result_kind: kind, share_to_niche: share, imported_at: new Date().toISOString(),
      });
    }
    url = r?.paging?.next ?? null;
  }
  if (rows.length) {
    const { error } = await supabase.from("ad_library").upsert(rows, { onConflict: "company_id,meta_ad_id" });
    if (error) throw new Error("Could not save: " + error.message);
  }
  return { imported: rows.length, scanned: seen, with_results: rows.filter((r) => r.cost_per_result != null).length, shared: share };
}

// Saves copy the person chose to keep (from a chat message) to their own library, reusable on any ad account.
async function saveCopy(body: any, p: { companyId: string; role: string; mediaBuyerId: string | null }) {
  const md = String(body?.raw_markdown ?? "").slice(0, 20000);
  if (!md.trim()) throw new Error("Nothing to save.");
  const { data: prods } = await supabase.from("products").select("id, product_name").eq("company_id", p.companyId);
  const { data: co } = await supabase.from("companies").select("business_types").eq("id", p.companyId).maybeSingle();
  const chunks = md.split(/^#{2,3}\s*Ad\s*\d+[^\n]*$/mi).slice(1);
  const rows: any[] = [];
  for (const ch of chunks.length ? chunks : [md]) {
    const code = ch.match(/```[a-z]*\n([\s\S]*?)```/i);
    const primary = (code ? code[1] : "").trim();
    if (primary.length < 30) continue;
    const hl = ch.match(/\*\*Headlines?:\*\*\s*([\s\S]*?)(?:\n\s*\*\*|$)/i);
    const headline = hl ? (hl[1].split("\n").map((x) => x.replace(/^[\s\-*\d.)]+/, "").trim()).find(Boolean) ?? "") : "";
    const ds = ch.match(/\*\*Description:\*\*\s*(.+)/i);
    const t = norm(ch);
    const prod = (prods ?? []).filter((x: any) => norm(x.product_name).length > 2 && t.includes(norm(x.product_name))).sort((a: any, b: any) => b.product_name.length - a.product_name.length)[0];
    rows.push({
      company_id: p.companyId, media_buyer_id: p.mediaBuyerId, meta_ad_id: "saved-" + crypto.randomUUID(), name: "Saved from the assistant",
      primary_text: primary, headline: headline.slice(0, 200) || null, description: ds ? ds[1].trim().slice(0, 200) : null,
      niche: (co?.business_types ?? [])[0] ?? null, source: "saved", product_id: prod?.id ?? null, product_name: prod?.product_name ?? null, share_to_niche: false,
    });
  }
  if (!rows.length) throw new Error("I couldn't find ad copy in that message.");
  const { error } = await supabase.from("ad_library").insert(rows);
  if (error) throw new Error("Could not save: " + error.message);
  return { saved: rows.length, products: [...new Set(rows.map((r) => r.product_name).filter(Boolean))] };
}

// ── CARDS, CAMPAIGN PLANS AND LAUNCH ───────────────────────────────────────
// Tools return interactive cards (questions, creatives, plan, review) next to the text answer.
// Nothing here spends money by itself: launching happens only from the plan card's Approve button
// (action approve_plan), never from a model tool call.
const AM = (auth: string, body: any) => fetch(ADS_URL, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null);
const GRAPH = "https://graph.facebook.com/v21.0";

async function tokenForAccount(acct: any, companyId: string): Promise<string> {
  if (acct?.meta_connection_id) {
    const { data: conn } = await supabase.from("meta_connections").select("access_token, status").eq("id", acct.meta_connection_id).eq("company_id", companyId).maybeSingle();
    if (conn?.status === "active" && conn.access_token) return conn.access_token;
  }
  return META_TOKEN_SHARED;
}

function askQuestionsTool(args: any, ctx: Ctx) {
  const qs = (Array.isArray(args?.questions) ? args.questions : []).slice(0, 4).map((q: any, i: number) => ({
    id: String(q?.id || `q${i + 1}`).slice(0, 30), label: String(q?.label || "").slice(0, 160),
    options: (Array.isArray(q?.options) ? q.options : []).map((o: any) => String(o).slice(0, 60)).slice(0, 8),
    multi: q?.multi === true, recommended: q?.recommended ? String(q.recommended).slice(0, 60) : null,
  })).filter((q: any) => q.label && q.options.length >= 2);
  if (!qs.length) return { error: "Each question needs a label and at least two options." };
  ctx.cards.push({ type: "questions", title: String(args?.title || "A few quick questions").slice(0, 80), subtitle: String(args?.subtitle || "Tap to answer. You can change anything later.").slice(0, 120), questions: qs });
  return { ok: true, note: "The question card is on screen. Write ONE short line before it, then stop and wait for their answers. Do not ask the same questions in text." };
}

const productKey = (n: unknown) => String(n ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// One list of every image/video the person owns, from the creative_library view (vault uploads + product photos), grouped by product name so duplicate product rows never hide anything.
async function loadCreativeLibrary(companyId: string, productName?: string | null) {
  const key = productKey(productName);
  const { data } = await supabase.from("creative_library").select("library_id, source, product_id, product_name, product_key, kind, url, name, times_used, last_uploaded").eq("company_id", companyId).limit(500);
  const seen = new Set<string>(); const rows: any[] = [];
  for (const r of (data ?? []).slice().sort((a: any, b: any) => (key && b.product_key === key ? 1 : 0) - (key && a.product_key === key ? 1 : 0) || String(b.last_uploaded).localeCompare(String(a.last_uploaded)))) {
    if (!/^https:\/\//.test(String(r.url)) || seen.has(r.url)) continue;
    seen.add(r.url);
    rows.push({ id: r.library_id, url: r.url, type: r.kind, name: r.name, source: r.source, product: r.product_name ?? null, match: !!key && r.product_key === key, times_used: r.times_used ?? 0 });
  }
  return rows;
}

async function showCreativesTool(args: any, ctx: Ctx) {
  const all = await loadCreativeLibrary(ctx.companyId, args?.product_name);
  const hasName = !!productKey(args?.product_name);
  const assets = [...all.filter((a) => a.match), ...all.filter((a) => !a.match)].slice(0, 24);
  const matched = assets.filter((a) => a.match);
  ctx.cards.push({
    type: "creatives", product: String(args?.product_name || "").slice(0, 80), assets,
    preselect: matched.slice(0, 6).map((a) => a.id),
    copy: { primary_text: String(args?.primary_text || "").slice(0, 2000), headline: String(args?.headline || "").slice(0, 200), description: String(args?.description || "").slice(0, 200) },
  });
  return {
    ok: true, found: assets.length, for_this_product: hasName ? { images: matched.filter((a) => a.type === "image").length, videos: matched.filter((a) => a.type === "video").length, items: matched.map((a) => ({ id: a.id, type: a.type, source: a.source, name: a.name })) } : undefined,
    note: "The creative card is on screen. It lists EVERY image and video for this product, including the product photo. State the exact counts in plain words (e.g. 3 vault images + 1 product photo, no video) and say when there is no video. A creative may be reused across several ads. Write one short line, then stop and wait for their choice.",
  };
}

async function searchAudiencesTool(args: any, ctx: Ctx) {
  if (!ctx.account) return { error: "No ad account is selected." };
  const r = await AM(ctx.authHeader, { action: "targeting_search", ad_account_id: ctx.account.id, q: String(args?.query || ""), kind: args?.kind === "city" ? "city" : "interest" });
  if (!r?.ok) return { error: r?.error || "Search failed." };
  return { results: (r.results || []).slice(0, 10), note: "Use the id and name exactly as returned when planning." };
}

async function estimateReachTool(args: any, ctx: Ctx) {
  if (!ctx.account) return { error: "No ad account is selected." };
  const r = await AM(ctx.authHeader, { action: "reach_estimate", ad_account_id: ctx.account.id, states: args?.states, cities: args?.cities, interests: args?.interests, age_min: args?.age_min, age_max: args?.age_max, gender: args?.gender });
  if (!r?.ok) return { error: r?.error || "Meta could not estimate that." };
  return { people_lower: r.lower, people_upper: r.upper, ready: r.ready };
}

async function checkPixelTool(ctx: Ctx) {
  if (!ctx.account) return { error: "No ad account is selected." };
  const { data: acct } = await supabase.from("ad_accounts").select("meta_pixel_id, meta_connection_id, pixel_name").eq("id", ctx.account.id).eq("company_id", ctx.companyId).maybeSingle();
  const pixel = String(acct?.meta_pixel_id ?? "").match(/\d+/)?.[0];
  if (!pixel) return { connected: false, note: "No pixel is saved on this ad account. It can be set in Settings, Ad accounts." };
  const token = await tokenForAccount(acct, ctx.companyId);
  const info = await fetch(`${GRAPH}/${pixel}?fields=name,last_fired_time,is_unavailable&access_token=${token}`).then((r) => r.json()).catch(() => null);
  if (info?.error) return { connected: true, pixel_id: pixel, error: "Meta would not show this pixel with the saved login: " + String(info.error.message).slice(0, 160) };
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const st = await fetch(`${GRAPH}/${pixel}/stats?aggregation=event&start_time=${since}&access_token=${token}`).then((r) => r.json()).catch(() => null);
  const events: Record<string, number> = {};
  for (const bucket of st?.data ?? []) for (const e of bucket?.data ?? []) events[e.value] = (events[e.value] || 0) + Number(e.count || 0);
  const last = info?.last_fired_time ? new Date(info.last_fired_time) : null;
  const hoursAgo = last ? Math.round((Date.now() - last.getTime()) / 3600_000) : null;
  const firing = hoursAgo != null && hoursAgo < 48;
  return {
    connected: true, pixel_id: pixel, name: info?.name ?? acct?.pixel_name ?? null, firing, last_fired_hours_ago: hoursAgo, events_last_7_days: events,
    purchase_events_last_7_days: events["Purchase"] ?? 0,
    verdict: firing ? (events["Purchase"] ? "Pixel is firing and Purchase events are arriving." : "Pixel is firing, but no Purchase event in 7 days. Check the order form or the paid-purchase setting.") : "Pixel has not fired in the last 2 days, so ads cannot optimise for orders until it does.",
  };
}

const norm0 = (n: unknown) => Math.max(0, Math.round(Number(n) || 0));
function whoText(a: any) {
  const g = a.gender === "female" ? "Women" : a.gender === "male" ? "Men" : "Everyone";
  const ints = (a.interests || []).map((i: any) => i.name).slice(0, 3).join(", ");
  return `${g} ${a.age_min} to ${a.age_max}${ints ? `, ${ints}` : ""}`;
}
function whereText(a: any) {
  const p = [...(a.states || []), ...(a.cities || []).map((c: any) => c.name)];
  return p.length ? p.join(", ") : "All Nigeria";
}
async function planCard(plan: any, planId: string, ctx: { authHeader: string; accountId: string; companyId: string; userId: string }, estimate = true) {
  const rows = await Promise.all((plan.adsets || []).map(async (a: any) => {
    let reach: string | null = null;
    if (estimate) {
      const r = await AM(ctx.authHeader, { action: "reach_estimate", ad_account_id: ctx.accountId, states: a.states, cities: a.cities, interests: a.interests, age_min: a.age_min, age_max: a.age_max, gender: a.gender, optimization_goal: plan.destination === "website" ? "LINK_CLICKS" : "CONVERSATIONS" });
      if (r?.ok && r.upper) reach = `${r.lower ? (r.lower / 1e6).toFixed(1) : "0"}M to ${(r.upper / 1e6).toFixed(1)}M`;
    }
    return { label: a.label, who: whoText(a), where: whereText(a), budget: a.budget_naira, reach, states: a.states || [], age_min: a.age_min, age_max: a.age_max };
  }));
  const total = rows.reduce((s: number, r: any) => s + r.budget, 0);
  const { data: kr } = await supabase.from("kill_rules").select("kind, enabled, auto_kill, max_cost_per_result, min_spend").eq("profile_id", ctx.userId).limit(5).then((x: any) => x, () => ({ data: [] }));
  const wantKind = plan.destination === "website" ? "purchase" : "messaging";
  const rule = (kr ?? []).find((r: any) => r.enabled && r.kind === wantKind);
  const adsPerSet = Array.isArray(plan.ads) && plan.ads.length ? plan.ads.length : plan.asset_ids.length;
  return {
    type: "plan", plan_id: planId, status: "draft", title: `${plan.product_name} · ${plan.destination === "website" ? "Website orders" : "WhatsApp messages"}`,
    summary: `1 campaign · ${rows.length} ad set${rows.length > 1 ? "s" : ""} · ${rows.length * adsPerSet} ads · ${fmtNaira(total)} a day`,
    adsets: rows, creatives: `${adsPerSet} ad${adsPerSet > 1 ? "s" : ""} per ad set from ${plan.asset_ids.length} creative${plan.asset_ids.length > 1 ? "s" : ""} and ${plan.copies.length} copy version${plan.copies.length > 1 ? "s" : ""}`,
    pixel: plan.pixel_ok === null ? null : plan.pixel_ok, rules: rule ? `Your ${plan.destination === "website" ? "website purchase" : "WhatsApp message"} kill rule: ${rule.auto_kill === false ? "flag" : "pause"} an ad when it passes ${fmtNaira(Number(rule.min_spend))} spend with cost per ${plan.destination === "website" ? "purchase" : "message"} above ${fmtNaira(Number(rule.max_cost_per_result))}.` : `No ${plan.destination === "website" ? "website purchase" : "WhatsApp message"} kill rule set yet, so nothing will be paused automatically for this campaign. Set one in Settings.`,
    warnings: plan.warnings || [], campaign_name: plan.campaign_name,
  };
}

async function planCampaignTool(args: any, ctx: Ctx) {
  if (!["owner", "admin", "buyer"].includes(ctx.role)) return { error: "Only owners, admins and media buyers can plan campaigns." };
  if (!ctx.account) return { error: "No ad account is selected. Ask the person to pick one at the top of the dashboard." };
  const pname = String(args?.product_name ?? "").trim();
  const { data: prods } = await supabase.from("products").select("id, product_name, whatsapp_number, landing_page_url").eq("company_id", ctx.companyId).ilike("product_name", `%${pname.replace(/[%_]/g, "")}%`).limit(5);
  const product = (prods ?? [])[0];
  if (!pname || !product) return { needs_info: true, message: "Which product is this campaign for? Ask, using their product names." };
  const { data: acct } = await supabase.from("ad_accounts").select("id, whatsapp_number, meta_pixel_id, fb_page_id, balance_naira").eq("id", ctx.account.id).eq("company_id", ctx.companyId).maybeSingle();
  if (!acct) return { error: "That ad account is not available." };
  if (!acct.fb_page_id) return { needs_info: true, message: "This ad account has no Facebook page saved, so ads cannot be created. Tell the person to connect the page in Settings, Ad accounts." };
  if (args?.destination !== "website" && args?.destination !== "whatsapp") return { needs_info: true, message: "Ask whether people should land on their WEBSITE (to buy) or message them on WHATSAPP. Do not assume." };
  if (args?.person_confirmed !== true) return { needs_info: true, message: "The person has not confirmed the setup yet. Ask (one ask_questions card) for anything missing: destination, daily budget per ad set, who to reach and where, and which creatives; then call again with person_confirmed true only if they said it." };
  const dest = args.destination as "website" | "whatsapp";
  const wa = String(acct.whatsapp_number || product.whatsapp_number || "").replace(/[^\d]/g, "");
  const link = String(args?.landing_url || product.landing_page_url || "").trim();
  if (dest === "whatsapp" && !wa) return { needs_info: true, message: "No WhatsApp number is saved on this ad account or product. Ask which WhatsApp number people should message." };
  if (dest === "website" && !/^https:\/\//.test(link)) return { needs_info: true, message: "Need the website link people should land on. Ask for it." };
  const wanted = [...new Set([...(Array.isArray(args?.asset_ids) ? args.asset_ids : []), ...(Array.isArray(args?.ads) ? args.ads.map((x: any) => x?.asset_id) : [])].map(String))].slice(0, 12);
  const idMap = new Map<string, string>(); // token the person picked -> creative_assets.id
  const direct = wanted.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (direct.length) {
    const { data: rows } = await supabase.from("creative_assets").select("id, public_url").eq("company_id", ctx.companyId).in("id", direct);
    for (const r of rows ?? []) idMap.set(r.id, r.id);
    // a library id is the representative row of its image; if only a sibling row was passed it still resolves above
  }
  for (const tok of wanted.filter((x) => /^product:[0-9a-f-]{36}:(photo|ad)$/i.test(x))) {
    const [, pid, which] = tok.split(":");
    const { data: pr } = await supabase.from("products").select("id, product_name, product_image_url, ad_image_url").eq("id", pid).eq("company_id", ctx.companyId).maybeSingle();
    const url = which === "ad" ? pr?.ad_image_url : pr?.product_image_url;
    if (!pr || !/^https:\/\//.test(String(url ?? ""))) continue;
    const { data: ex } = await supabase.from("creative_assets").select("id").eq("company_id", ctx.companyId).eq("public_url", url).limit(1);
    let cid = ex?.[0]?.id as string | undefined;
    if (!cid) {
      const m = String(url).match(/\/object\/public\/creative-vault\/(.+)$/);
      const { data: ins } = await supabase.from("creative_assets").insert({ file_name: `${pr.product_name} ${which === "ad" ? "ad image" : "photo"}`, storage_path: m ? decodeURIComponent(m[1]) : null, public_url: url, asset_type: "image", product_id: pr.id, company_id: ctx.companyId, uploaded_by: "ai_chat", test_status: "untested", uploaded_at: new Date().toISOString() }).select("id").single();
      cid = ins?.id;
    }
    if (cid) idMap.set(tok, cid);
  }
  const resolve = (t: unknown) => idMap.get(String(t));
  const assetIds = [...new Set([...idMap.values()])];
  if (!assetIds.length) return { needs_info: true, message: "No creatives chosen yet. Call show_creatives and wait for the person to choose." };
  const copies = (Array.isArray(args?.copies) ? args.copies : []).map((c: any) => ({ primary_text: String(c?.primary_text || "").trim().slice(0, 2000), headline: String(c?.headline || "").trim().slice(0, 200), description: String(c?.description || "").trim().slice(0, 200) })).filter((c: any) => c.primary_text.length >= 30).slice(0, 8);
  if (!copies.length) return { needs_info: true, message: "No ad copy yet. Call write_ad_copy first (or use the copy the person chose) and pass it in copies." };
  // Each ad = one creative + one copy. A creative may appear in several ads (reuse). Without an explicit list, every creative gets the next copy in turn.
  let ads: { asset_id: string; copy_index: number }[] = (Array.isArray(args?.ads) ? args.ads : [])
    .map((x: any) => ({ asset_id: resolve(x?.asset_id) as string, copy_index: Math.round(Number(x?.copy_index) || 0) }))
    .filter((x: any) => x.asset_id && x.copy_index >= 0 && x.copy_index < copies.length).slice(0, 12);
  if (Array.isArray(args?.ads) && args.ads.length && ads.length !== Math.min(args.ads.length, 12)) return { needs_info: true, message: `Some ads point to a creative or copy that does not exist (copy_index is 0 to ${copies.length - 1}). Fix the ads list and call again.` };
  if (!ads.length) ads = assetIds.map((id, j) => ({ asset_id: id, copy_index: j % copies.length }));
  const adsets = (Array.isArray(args?.adsets) ? args.adsets : []).slice(0, 6).map((a: any, i: number) => {
    const amin = Math.min(Math.max(Math.round(Number(a?.age_min) || 25), 18), 65);
    const amax = Math.min(Math.max(Math.round(Number(a?.age_max) || 55), amin), 65);
    return {
      label: String(a?.label || `Ad set ${i + 1}`).slice(0, 60), budget_naira: Math.min(Math.max(norm0(a?.budget_naira), 1000), 500000),
      age_min: amin, age_max: amax, gender: ["all", "male", "female"].includes(a?.gender) ? a.gender : "all",
      states: (Array.isArray(a?.states) ? a.states : []).map((s: any) => String(s).replace(/ state$/i, "").trim()).filter(Boolean).slice(0, 12),
      cities: (Array.isArray(a?.cities) ? a.cities : []).filter((c: any) => /^\d+$/.test(String(c?.key))).map((c: any) => ({ key: String(c.key), name: String(c.name || ""), region: String(c.region || ""), radius: 17 })).slice(0, 10),
      interests: (Array.isArray(a?.interests) ? a.interests : []).filter((x: any) => /^\d+$/.test(String(x?.id))).map((x: any) => ({ id: String(x.id), name: String(x.name || "") })).slice(0, 8),
    };
  });
  if (!adsets.length || (Array.isArray(args.adsets) ? args.adsets : []).some((a: any) => !(Number(a?.budget_naira) >= 1000))) return { needs_info: true, message: "Every ad set needs a daily budget the person stated (at least ₦1,000). Ask for it; never pick one yourself." };
  const warnings: string[] = [];
  const total = adsets.reduce((s: number, a: any) => s + a.budget_naira, 0);
  if (acct.balance_naira != null && Number(acct.balance_naira) < total) warnings.push(`The account balance is about ${fmtNaira(Number(acct.balance_naira))}, less than one day of this plan (${fmtNaira(total)}). Top up before launching.`);
  if (!acct.meta_pixel_id && dest === "website") warnings.push("No pixel is saved on this ad account, so a website campaign cannot track orders.");
  const plan = {
    product_id: product.id, product_name: product.product_name, ad_account_id: acct.id, destination: dest, whatsapp_number: dest === "whatsapp" ? wa : null, landing_url: dest === "website" ? link : null,
    campaign_name: String(args?.campaign_name || `${product.product_name} ${new Date().toISOString().slice(0, 10)}`).slice(0, 100),
    cta: String(args?.cta || (dest === "whatsapp" ? "WHATSAPP_MESSAGE" : "SHOP_NOW")).slice(0, 40), asset_ids: assetIds, ads, copies, adsets, warnings, pixel_ok: dest === "website" ? !!acct.meta_pixel_id : null,
  };
  const { data: row, error } = await supabase.from("ai_plans").insert({ company_id: ctx.companyId, user_id: ctx.userId, ad_account_id: acct.id, plan }).select("id").single();
  if (error || !row) return { error: "Could not save the plan: " + (error?.message ?? "unknown") };
  ctx.cards.push(await planCard(plan, row.id, { authHeader: ctx.authHeader, accountId: acct.id, companyId: ctx.companyId, userId: ctx.userId }));
  return { ok: true, plan_id: row.id, note: "The plan card is on screen with Approve, Edit and Cancel buttons. Write one or two sentences on why you chose this structure, then stop. You CANNOT launch: only the person's tap on Approve launches. Never say it is live." };
}

function reviewCardTool(args: any, ctx: Ctx) {
  const clean = (arr: any) => (Array.isArray(arr) ? arr : []).slice(0, 6).map((x: any) => ({
    id: /^\d+$/.test(String(x?.id)) ? String(x.id) : null, level: x?.level === "adset" ? "adset" : "ad", name: String(x?.name || "").slice(0, 80), why: String(x?.why || "").slice(0, 220),
    actions: (Array.isArray(x?.actions) ? x.actions : []).slice(0, 3).map((a: any) => ({
      kind: ["pause", "resume", "budget", "duplicate"].includes(a?.kind) ? a.kind : null, label: String(a?.label || "").slice(0, 40),
      new_daily_budget: a?.new_daily_budget ? norm0(a.new_daily_budget) : null, current_daily_budget: a?.current_daily_budget ? norm0(a.current_daily_budget) : null,
    })).filter((a: any) => a.kind && a.label),
  }));
  ctx.cards.push({
    type: "review", account_id: ctx.account?.id ?? null, headline: String(args?.headline || "").slice(0, 160),
    keep: clean(args?.keep), watch: { count: norm0(args?.watch_count), note: String(args?.watch_note || "").slice(0, 200) }, stop: clean(args?.stop),
  });
  return { ok: true, note: "The review card is on screen. Do not repeat its contents. Write the one-sentence answer and a short plain-words explanation of what the numbers mean (what you wrote as headline, total spend, results and cost per result against their target), then stop." };
}

async function duplicateObject(body: any, p: { companyId: string; role: string; mediaBuyerId: string | null }) {
  const level = body?.level === "adset" ? "adset" : "ad";
  const objectId = String(body?.object_id ?? "");
  if (!/^\d+$/.test(objectId)) throw new Error("Invalid id.");
  let q = supabase.from("ad_accounts").select("id, meta_connection_id, media_buyer_id").eq("id", String(body?.ad_account_id ?? "")).eq("company_id", p.companyId);
  if (p.role === "buyer") q = q.eq("media_buyer_id", p.mediaBuyerId);
  const { data: acct } = await q.maybeSingle();
  if (!acct) throw new Error("That ad account is not yours.");
  const token = await tokenForAccount(acct, p.companyId);
  const form = new URLSearchParams({ access_token: token, status_option: body?.start_paused === false ? "INHERITED_FROM_SOURCE" : "PAUSED" });
  if (level === "adset") form.set("deep_copy", "true");
  const r = await fetch(`${GRAPH}/${objectId}/copies`, { method: "POST", body: form }).then((x) => x.json()).catch(() => null);
  if (!r || r.error) throw new Error("Meta: " + (r?.error?.error_user_msg || r?.error?.message || "could not duplicate").slice(0, 200));
  const newId = r.copied_ad_id || r.copied_adset_id || r.ad_object_ids?.[0]?.copied_id || null;
  await supabase.from("ad_kill_log").insert({ company_id: p.companyId, ad_account_id: acct.id, level, meta_object_id: objectId, object_name: String(body?.object_name || ""), action: "duplicated", source: "ai_chat", reason: "Duplicated by the AI media buyer after the person tapped it" }).then(() => {}, () => {});
  return { ok: true, new_id: newId, note: "Copied as paused. Turn it on when you are ready." };
}

async function planAction(body: any, p: { companyId: string; role: string; mediaBuyerId: string | null; userId: string; authHeader: string }) {
  if (!["owner", "admin", "buyer"].includes(p.role)) throw new Error("Only owners, admins and media buyers can launch.");
  const { data: row } = await supabase.from("ai_plans").select("id, plan, status, user_id, ad_account_id").eq("id", String(body?.plan_id ?? "")).eq("company_id", p.companyId).maybeSingle();
  if (!row) throw new Error("That plan was not found.");
  if (row.user_id !== p.userId && !["owner", "admin"].includes(p.role)) throw new Error("This plan belongs to someone else.");
  const plan = row.plan;
  if (body.action === "cancel_plan") { await supabase.from("ai_plans").update({ status: "cancelled" }).eq("id", row.id).eq("status", "draft"); return { ok: true }; }
  if (row.status !== "draft") throw new Error(row.status === "launched" ? "This plan is already launched." : "This plan can no longer be changed.");
  let q = supabase.from("ad_accounts").select("id, media_buyer_id").eq("id", row.ad_account_id).eq("company_id", p.companyId);
  if (p.role === "buyer") q = q.eq("media_buyer_id", p.mediaBuyerId);
  const { data: acct } = await q.maybeSingle();
  if (!acct) throw new Error("That ad account is not yours.");

  if (body.action === "update_plan") {
    const e = body.edits || {};
    if (typeof e.campaign_name === "string" && e.campaign_name.trim()) plan.campaign_name = e.campaign_name.trim().slice(0, 100);
    (Array.isArray(e.adsets) ? e.adsets : []).forEach((ea: any, i: number) => {
      const a = plan.adsets[i]; if (!a) return;
      if (ea.budget_naira != null) a.budget_naira = Math.min(Math.max(norm0(ea.budget_naira), 1000), 500000);
      if (ea.age_min != null) a.age_min = Math.min(Math.max(norm0(ea.age_min), 18), 65);
      if (ea.age_max != null) a.age_max = Math.min(Math.max(norm0(ea.age_max), a.age_min), 65);
      if (Array.isArray(ea.states)) a.states = ea.states.map((s: any) => String(s).replace(/ state$/i, "").trim()).filter(Boolean).slice(0, 12);
      if (ea.remove === true && plan.adsets.length > 1) a.__remove = true;
    });
    plan.adsets = plan.adsets.filter((a: any) => !a.__remove);
    await supabase.from("ai_plans").update({ plan }).eq("id", row.id);
    return { ok: true, card: await planCard(plan, row.id, { authHeader: p.authHeader, accountId: acct.id, companyId: p.companyId, userId: p.userId }) };
  }

  // approve_plan: the only path that creates anything on Meta. Same rows the campaign builder writes, then the same launcher.
  const claim = await supabase.from("ai_plans").update({ status: "launching" }).eq("id", row.id).eq("status", "draft").select("id");
  if (!claim.data?.length) throw new Error("This plan is already being launched.");
  try {
    const { data: srcs } = await supabase.from("creative_assets").select("id, file_name, storage_path, public_url, asset_type, meta_video_id, meta_image_hash, mechanism, format").eq("company_id", p.companyId).in("id", plan.asset_ids);
    const planAds: { asset_id: string; copy_index: number }[] = Array.isArray(plan.ads) && plan.ads.length ? plan.ads : plan.asset_ids.map((id: string, j: number) => ({ asset_id: id, copy_index: j % plan.copies.length }));
    const sources = planAds.map((x) => (srcs ?? []).find((s: any) => s.id === x.asset_id));
    if (!sources.length || sources.some((x: any) => !x)) throw new Error("The chosen creatives are no longer available.");
    const batch = crypto.randomUUID();
    const ids: string[] = [];
    for (let i = 0; i < plan.adsets.length; i++) {
      for (let j = 0; j < sources.length; j++) {
        const s: any = sources[j], c = plan.copies[planAds[j].copy_index] ?? plan.copies[0];
        const { data: ins, error } = await supabase.from("creative_assets").insert({
          file_name: s.file_name, storage_path: s.storage_path, public_url: s.public_url, asset_type: s.asset_type, meta_video_id: s.meta_video_id ?? null, meta_image_hash: s.meta_image_hash ?? null,
          mechanism: s.mechanism, format: s.format, primary_text: c.primary_text, headline: c.headline, description: c.description, cta_type: plan.cta,
          uploaded_by: "ai_chat", ad_account_id: acct.id, company_id: p.companyId, test_status: "untested", uploaded_at: new Date().toISOString(),
          ad_set_sort_order: i, ad_name: `${plan.product_name} · ${plan.adsets[i].label} · Ad ${j + 1}`.slice(0, 120),
          product_id: plan.product_id, destination_type: plan.destination, whatsapp_number: plan.whatsapp_number, landing_page_url: plan.landing_url,
          campaign_name: plan.campaign_name, campaign_objective: "OUTCOME_SALES", budget_type: "abo", launch_batch_id: batch,
        }).select("id").single();
        if (error || !ins) throw new Error("Could not stage an ad: " + (error?.message ?? "unknown"));
        ids.push(ins.id);
      }
    }
    const cfgs = plan.adsets.map((a: any, i: number) => ({
      creative_id: ids[0], company_id: p.companyId, label: a.label, budget_naira: a.budget_naira, age_min: a.age_min, age_max: a.age_max, gender: a.gender,
      geo_type: a.states.length || a.cities.length ? "states" : "nationwide", states: a.states.length ? a.states : null, cities: a.cities.length ? a.cities : null,
      interests: a.interests.length ? a.interests : null, sort_order: i, advantage_audience: !a.interests.length,
    }));
    const { error: cErr } = await supabase.from("ad_set_configs").insert(cfgs);
    if (cErr) throw new Error("Could not save the ad sets: " + cErr.message);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-auto-launch-tests`, { method: "POST", headers: { Authorization: p.authHeader, "Content-Type": "application/json" }, body: JSON.stringify({ creative_ids: ids }) }).then((r) => r.json()).catch(() => null);
    if (!res || res.error) throw new Error(res?.error || "The launcher did not answer.");
    await supabase.from("ai_plans").update({ status: "launched", launched_at: new Date().toISOString(), result: res }).eq("id", row.id);
    return { ok: true, message: res.message || "Launched.", ads: ids.length, ad_sets: plan.adsets.length };
  } catch (e) {
    await supabase.from("ai_plans").update({ status: "draft" }).eq("id", row.id);
    throw e;
  }
}

// What a connected assistant (the MCP server) needs to write ads itself: the product facts, the seller's own winners and losers, the language and the craft rules.
async function copyContextTool(args: any, ctx: Ctx) {
  const name = String(args?.product_name ?? "").trim();
  const { data: all } = await supabase.from("products").select("product_name, default_order_value_naira, description, benefits, safety_notes, nafdac_reg_no, destination_type, is_active").eq("company_id", ctx.companyId);
  const q = norm(name);
  const product = (all ?? []).filter((x: any) => q && (norm(x.product_name) === q || norm(x.product_name).includes(q) || q.includes(norm(x.product_name))))
    .sort((a: any, b: any) => (String(b.description ?? "").length + String(b.benefits ?? "").length) - (String(a.description ?? "").length + String(a.benefits ?? "").length))[0];
  if (!product) return { needs_info: true, message: `No product called "${name}". Their products: ${[...new Set((all ?? []).map((x: any) => x.product_name))].join(", ") || "none yet"}. Ask which one.` };
  const known = product.description || product.benefits;
  const prof = await loadProfileBrief(ctx.companyId);
  const ex = renderExamples(await getCopyExamples(ctx, product.product_name));
  return {
    product, product_facts_missing: !known,
    instructions: known ? "Write the ads yourself using ONLY these product facts. Every ad is about this one product. Never borrow another product's claims." : "The record has no description or benefits. Do NOT write copy yet. Ask the user what the product is, who it is for and its top 3 benefits, save them with save_product_facts, then call this again.",
    language_rule: LANGUAGE_RULES[prof.language], business_and_niche: prof.text, examples_from_their_own_ads: ex, craft_rules: COPY_CRAFT,
  };
}

function renderExamples(ex: Awaited<ReturnType<typeof getCopyExamples>>): string {
  const fmt = (e: CopyEx, i: number) => `#${i + 1}${e.same === false ? ` [DIFFERENT PRODUCT${e.product && e.product !== "another product" ? ": " + e.product : ""}. Borrow rhythm and voice only, never its product, claims or words]` : ""}${e.cost != null ? ` (${e.note}: ${fmtNaira(e.cost)} on ${fmtNaira(e.spend ?? 0)} spend${e.ctr != null ? `, CTR ${e.ctr.toFixed(1)}%` : ""})` : ""}\nPrimary text: ${e.text}${e.headline ? `\nHeadline: ${e.headline}` : ""}${e.description ? `\nDescription: ${e.description}` : ""}`;
  const parts: string[] = [];
  if (ex.winners.length) parts.push(`ADS THAT WORKED FOR THIS SELLER (best results first). Study their voice, hooks, rhythm, length and what they promise. Write in this seller's own proven style. Never copy lines:\n${ex.winners.map(fmt).join("\n\n")}`);
  if (ex.losers.length) parts.push(`ADS THAT DID NOT WORK (spent money, weak results). Avoid what made them flat:\n${ex.losers.map(fmt).join("\n\n")}`);
  if (ex.others.length) parts.push(`OTHER ADS FROM THIS SELLER (no results available). Use only for tone (and for facts only if the ad is not marked DIFFERENT PRODUCT):\n${ex.others.map(fmt).join("\n\n")}`);
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
  const PCOLS = "id, product_name, default_order_value_naira, description, benefits, safety_notes, nafdac_reg_no, destination_type, landing_page_url, is_active";
  const productName = String(args?.product_name ?? "").trim();
  const { data: all } = await supabase.from("products").select(PCOLS).eq("company_id", ctx.companyId).order("is_active", { ascending: false });
  const names = [...new Set((all ?? []).map((x: any) => String(x.product_name)))];
  let product: any = null;
  if (productName) {
    const q = norm(productName);
    const hits = (all ?? []).filter((x: any) => norm(x.product_name) === q).concat((all ?? []).filter((x: any) => norm(x.product_name) !== q && (norm(x.product_name).includes(q) || q.includes(norm(x.product_name)))));
    // Several rows can share a name (duplicates): prefer the one with the most detail.
    product = hits.sort((x: any, y: any) => (String(y.description ?? "").length + String(y.benefits ?? "").length) - (String(x.description ?? "").length + String(x.benefits ?? "").length))[0] ?? null;
    if (!product && !args?.facts) return { needs_info: true, message: `I could not find a product called "${productName}" in this workspace. Ask which one they mean${names.length ? ` (their products: ${names.join(", ")})` : ""}, or ask them to tell you what it is. Do not write copy yet.` };
  } else if (!args?.facts) {
    const active = (all ?? []).filter((x: any) => x.is_active !== false);
    if (active.length === 1) product = active[0];
    else return { needs_info: true, message: `Ask which product the ads are for${names.length ? ` (their products: ${names.join(", ")})` : ""}. Do not guess and do not write copy yet.` };
  }
  // What do we actually know about this product? The record, past ads that name it, or what the person just told us.
  let known = "";
  if (product) {
    const bits = [product.description && `About: ${product.description}`, product.benefits && `Benefits: ${product.benefits}`, product.safety_notes && `Safety notes: ${product.safety_notes}`].filter(Boolean);
    known = bits.join("\n");
    if (!known && !args?.facts) {
      const { data: past } = await supabase.from("ad_library").select("primary_text, headline").eq("company_id", ctx.companyId).ilike("product_name", product.product_name).neq("source", "ai_draft").limit(3);
      if (past?.length) known = "From the seller's own past ads for this product (treat as the truth about what it is):\n" + past.map((r: any) => `- ${String(r.headline ?? "")} | ${String(r.primary_text).slice(0, 500)}`).join("\n");
    }
    if (!known && !args?.facts) return { needs_info: true, product: product.product_name, message: `The record for "${product.product_name}" has no description, benefits or past ads, so you do not know what it is. Do NOT write copy and do NOT guess from the business type. Ask the person ONE short message: what the product is, what it helps with, who it is for, and its top 3 benefits. When they answer, call save_product_facts and then write_ad_copy.` };
  }
  const goalFactsFromUser = args?.facts ? String(args.facts).slice(0, 1200) : "";
  const goal = args?.goal === "website" ? "website (people click through to order)" : "WhatsApp (people tap to chat and order)";
  const cta = args?.goal === "website" ? "Shop Now, Order Now or Learn More" : "Send message";
  const count = Math.min(Math.max(Number(args?.count) || 3, 1), 5);
  const langKey = typeof args?.language === "string" && LANGUAGE_RULES[args.language] ? args.language : brief.language;
  const langRule = typeof args?.language_note === "string" && args.language_note.trim() ? `LANGUAGE: ${String(args.language_note).slice(0, 200)}` : LANGUAGE_RULES[langKey];
  const examples = renderExamples(await getCopyExamples(ctx, product?.product_name ?? productName));
  const productText = `PRODUCT LOCK. Every ad is about this ONE product and nothing else:
NAME: ${product?.product_name ?? productName ?? "(from the person's facts)"}${product?.default_order_value_naira ? ` · price ${fmtNaira(Number(product.default_order_value_naira))}` : ""}
${known ? `WHAT WE KNOW:\n${known}` : ""}${goalFactsFromUser ? `\nTOLD BY THE PERSON IN CHAT:\n${goalFactsFromUser}` : ""}${product?.nafdac_reg_no ? `\nNAFDAC no.: ${product.nafdac_reg_no}` : ""}
The business may sell several kinds of products and the niche notes above are general. They NEVER decide what this product is. Only the facts above do. Do not mention, imply or borrow any other product, ingredient, body area or use (for example do not write about skin, cream or hair unless the facts say so). If something is not in the facts, leave it out or use a [placeholder].`;
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
    { role: "user", content: `${context}\n\nHere are the drafts:\n\n${draft}\n\nEDIT THEM into the final version. Rules: keep ${count} ads. FIRST run a PRODUCT CHECK: every ad must be only about the locked product; delete or rewrite any sentence that mentions another product type, use, ingredient or body area not in the facts. Then, for each line ask "could this be about any product?" and rewrite if yes. Remove every banned phrase. Make hooks sharper and more specific, keep the long-form length and the bouncy rhythm, check every claim against the product record (remove anything not supported), fix any Meta policy risk, keep the language rule. Output ONLY this markdown for each ad, nothing else:\n\n### Ad N: <angle name>\n**Hook options:** (3 short lines, the first is the one used)\n**Primary text:**\n\`\`\`\n<full primary text>\n\`\`\`\n**Headlines:** (3 options, about 40 characters each)\n**Description:** <about 30 characters>\n**CTA button:** ${cta}\n**Why it should work:** <one sentence>` },
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
  if (body?.action === "import_library") {
    if (!["owner", "admin", "buyer"].includes(profile.role)) return json({ error: "Only owners, admins and buyers can import ads." }, 403);
    try { return json(await importLibrary(body, { companyId: profile.company_id, role: profile.role, mediaBuyerId: profile.media_buyer_id })); }
    catch (e) { return json({ error: (e as Error).message }, 500); }
  }
  if (body?.action === "save_copy") {
    if (!["owner", "admin", "buyer"].includes(profile.role)) return json({ error: "Only owners, admins and buyers can save copy." }, 403);
    try { return json(await saveCopy(body, { companyId: profile.company_id, role: profile.role, mediaBuyerId: profile.media_buyer_id })); }
    catch (e) { return json({ error: (e as Error).message }, 500); }
  }
  if (["approve_plan", "update_plan", "cancel_plan"].includes(body?.action)) {
    try { return json(await planAction(body, { companyId: profile.company_id, role: profile.role, mediaBuyerId: profile.media_buyer_id, userId: user.id, authHeader })); }
    catch (e) { return json({ error: (e as Error).message }, 400); }
  }
  if (body?.action === "duplicate") {
    if (!["owner", "admin", "buyer"].includes(profile.role)) return json({ error: "Only owners, admins and buyers can duplicate ads." }, 403);
    try { return json(await duplicateObject(body, { companyId: profile.company_id, role: profile.role, mediaBuyerId: profile.media_buyer_id })); }
    catch (e) { return json({ error: (e as Error).message }, 400); }
  }
  if (body?.action === "run_tool") {
    // Used by the MCP server: the same tools the dashboard assistant has, same scoping, nothing that moves money.
    const ALLOWED = new Set(["list_ad_accounts", "get_ad_account_performance", "get_live_ads", "query_data", "get_wallet_balance", "get_product", "check_pixel", "search_audiences", "estimate_reach", "show_creatives", "write_ad_copy", "get_copy_context", "save_product_facts", "plan_campaign"]);
    const tool = String(body?.tool ?? "");
    if (!ALLOWED.has(tool)) return json({ error: "That tool is not available here." }, 400);
    const rctx: Ctx = { companyId: profile.company_id, role: profile.role, mediaBuyerId: profile.media_buyer_id, deliveryAgentId: profile.delivery_agent_id, userId: user.id, displayName: profile.display_name || "", authHeader, account: null, proposals: [], cards: [] };
    const aid = typeof body?.ad_account_id === "string" ? body.ad_account_id : "";
    if (/^[0-9a-f-]{36}$/i.test(aid)) {
      let aq = supabase.from("ad_accounts").select("id, name, nickname, balance_naira, low_balance_threshold_naira, media_buyer_id").eq("id", aid).eq("company_id", rctx.companyId);
      if (rctx.role === "buyer") aq = aq.eq("media_buyer_id", rctx.mediaBuyerId);
      const { data: a } = await aq.maybeSingle();
      if (a) rctx.account = { id: a.id, name: a.nickname || a.name || a.id, balance: a.balance_naira ?? null, lowThreshold: a.low_balance_threshold_naira ?? null };
    }
    const targs = body?.args && typeof body.args === "object" ? body.args : {};
    try {
      let result: unknown;
      if (tool === "write_ad_copy") {
        if (!OPENAI_API_KEY) return json({ error: "AI copy is not switched on." }, 400);
        const { data: cn } = await supabase.from("companies").select("name").eq("id", rctx.companyId).maybeSingle();
        const brief = await buildBusinessBrief(rctx.companyId, cn?.name || "the company");
        result = await writeAdCopy(targs, rctx, brief);
      } else if (tool === "get_copy_context") result = await copyContextTool(targs, rctx);
      else result = await runTool(tool, targs, rctx);
      return json({ result, cards: rctx.cards });
    } catch (e) { return json({ error: (e as Error).message }, 500); }
  }
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
    authHeader, account: null, proposals: [], cards: [],
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
        description: "Write finished ad copy (long-form primary text, headlines, description, hooks, CTA) for a product. It reads the seller's past ads, product record and niche, writes in two passes and returns polished markdown. ALWAYS use this for any request to write ad copy, hooks, headlines or descriptions. Show its copy_markdown exactly as returned. If it returns needs_info, ask the person that question instead.",
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
        name: "ask_questions",
        description: "Show the person a card of 1-4 quick tap-to-answer questions (each with 2-8 short options) instead of asking in text. Use whenever you need choices from them, such as where ads should send people, how many ad sets, who should see the ads. Pre-mark your recommendation. Never ask what you can decide yourself.",
        parameters: { type: "object", properties: {
          title: { type: "string" }, subtitle: { type: "string" },
          questions: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, options: { type: "array", items: { type: "string" } }, multi: { type: "boolean" }, recommended: { type: "string" } }, required: ["label", "options"] } },
        }, required: ["questions"] },
      },
    },
    {
      type: "function", function: {
        name: "show_creatives",
        description: "Show a card with the person's existing creatives for a product (tick to use), an upload button and a generate button, plus the ad copy to review. Call it after the copy is written. Pass the first ad's primary text, headline and description so they appear editable on the card.",
        parameters: { type: "object", properties: { product_name: { type: "string" }, primary_text: { type: "string" }, headline: { type: "string" }, description: { type: "string" } }, required: [] },
      },
    },
    {
      type: "function", function: {
        name: "search_audiences",
        description: "Find real Meta targeting options. kind 'interest' returns interests and job-type audiences (id + name + size) for plain descriptions like business owners, students, new mums, gut health. kind 'city' returns Nigerian cities (key, name, region). Use the exact id and name when planning.",
        parameters: { type: "object", properties: { query: { type: "string" }, kind: { type: "string", enum: ["interest", "city"] } }, required: ["query"] },
      },
    },
    {
      type: "function", function: {
        name: "estimate_reach",
        description: "Ask Meta how many people an audience reaches (states, cities, interests, ages, gender).",
        parameters: { type: "object", properties: { states: { type: "array", items: { type: "string" } }, cities: { type: "array", items: { type: "object", properties: { key: { type: "string" }, radius: { type: "number" } } } }, interests: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } }, age_min: { type: "number" }, age_max: { type: "number" }, gender: { type: "string", enum: ["all", "male", "female"] } }, required: [] },
      },
    },
    {
      type: "function", function: {
        name: "check_pixel",
        description: "Check whether the selected ad account's Meta pixel is connected and firing, with event counts for the last 7 days (PageView, Purchase and so on) and a plain verdict.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function", function: {
        name: "plan_campaign",
        description: "Build the campaign plan and show it as a card with Approve, Edit and Cancel buttons. It does NOT launch anything: only the person's tap on Approve launches. Needs, all stated by the person: product, destination (website or WhatsApp), 1-6 ad sets (who, where, daily budget), the chosen creative ids, how many ads per ad set (use ads[] to reuse creatives), and the ad copy versions. Never call it before copy and creatives exist.",
        parameters: { type: "object", properties: {
          product_name: { type: "string" }, destination: { type: "string", enum: ["whatsapp", "website"] }, landing_url: { type: "string" }, campaign_name: { type: "string" },
          asset_ids: { type: "array", items: { type: "string" }, description: "Creative ids the person chose on the creative card (ids as shown on the card, including product:<uuid>:photo)." },
          ads: { type: "array", description: "The exact ads per ad set when the person wants more ads than creatives: one entry per ad. A creative can appear in several ads (reuse). Example for 3 creatives and 5 copies: [{asset_id:A,copy_index:0},{asset_id:B,copy_index:1},{asset_id:C,copy_index:2},{asset_id:A,copy_index:3},{asset_id:B,copy_index:4}]. Count the entries: that is the number of ads per ad set.", items: { type: "object", properties: { asset_id: { type: "string" }, copy_index: { type: "number" } }, required: ["asset_id", "copy_index"] } },
          person_confirmed: { type: "boolean", description: "true ONLY when the person themselves stated destination (website or WhatsApp), the daily budget per ad set, who/where, and the creatives. Never guess; ask first." },
          copies: { type: "array", items: { type: "object", properties: { primary_text: { type: "string" }, headline: { type: "string" }, description: { type: "string" } }, required: ["primary_text"] } },
          adsets: { type: "array", items: { type: "object", properties: {
            label: { type: "string" }, budget_naira: { type: "number" }, age_min: { type: "number" }, age_max: { type: "number" }, gender: { type: "string", enum: ["all", "male", "female"] },
            states: { type: "array", items: { type: "string" } }, cities: { type: "array", items: { type: "object", properties: { key: { type: "string" }, name: { type: "string" }, region: { type: "string" } } } },
            interests: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } },
          }, required: ["label", "budget_naira"] } },
        }, required: ["product_name", "destination", "adsets", "asset_ids", "copies", "person_confirmed"] },
      },
    },
    {
      type: "function", function: {
        name: "review_ads_card",
        description: "After get_live_ads, show the review card: ads to KEEP (and scale or duplicate), how many to WATCH, and ads to STOP, each with a plain reason and tap buttons. Action kinds: pause, resume, budget (give new_daily_budget and current_daily_budget in Naira), duplicate. Use real ids from get_live_ads.",
        parameters: { type: "object", properties: {
          headline: { type: "string", description: "One sentence answer, e.g. One ad is carrying the campaign and one is wasting money." },
          keep: { type: "array", items: { type: "object", properties: { id: { type: "string" }, level: { type: "string", enum: ["ad", "adset"] }, name: { type: "string" }, why: { type: "string" }, actions: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["pause", "resume", "budget", "duplicate"] }, label: { type: "string" }, new_daily_budget: { type: "number" }, current_daily_budget: { type: "number" } } } } }, required: ["id", "name", "why"] } },
          watch_count: { type: "number" }, watch_note: { type: "string" },
          stop: { type: "array", items: { type: "object", properties: { id: { type: "string" }, level: { type: "string", enum: ["ad", "adset"] }, name: { type: "string" }, why: { type: "string" }, actions: { type: "array", items: { type: "object", properties: { kind: { type: "string" }, label: { type: "string" } } } } }, required: ["id", "name", "why"] } },
        }, required: ["headline"] },
      },
    },
    {
      type: "function", function: {
        name: "save_product_facts",
        description: "Save what the person told you about a product (what it is, benefits, safety notes) onto its product record so ad copy is always about the right product. Use it right after they answer your question about an unfamiliar or empty product. Use only their words, no embellishment.",
        parameters: {
          type: "object",
          properties: {
            product_name: { type: "string" },
            description: { type: "string", description: "What the product is and what it is for, in plain words, as the person said it." },
            benefits: { type: "string", description: "Its main benefits, short lines." },
            safety_notes: { type: "string" },
          },
          required: ["product_name", "description"],
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
    for (let step = 0; step < 8; step++) {
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
        return json({ answer: msg.content?.trim() || "I couldn't generate a response from your data just now — try again.", quick_replies: quickReplies, pending_payment: pendingPayment, proposals: ctx.proposals, cards: ctx.cards, active_account: ctx.account ? { id: ctx.account.id, name: ctx.account.name } : null });
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
  cost_per_result: r0(m.cost_per_result), reach: m.reach, frequency: r0(m.frequency, 2), ctr_percent_all_clicks: r0(m.ctr, 2), impressions: m.impressions, link_clicks: m.clicks,
});

async function runTool(name: string, args: any, ctx: Ctx): Promise<unknown> {
  switch (name) {
    case "ask_questions": return askQuestionsTool(args, ctx);
    case "show_creatives": return await showCreativesTool(args, ctx);
    case "search_audiences": return await searchAudiencesTool(args, ctx);
    case "estimate_reach": return await estimateReachTool(args, ctx);
    case "check_pixel": return await checkPixelTool(ctx);
    case "plan_campaign": return await planCampaignTool(args, ctx);
    case "review_ads_card": return reviewCardTool(args, ctx);

    case "save_product_facts": {
      if (!["owner", "admin", "buyer"].includes(ctx.role)) return { error: "Only owners, admins and media buyers can edit products." };
      const q = String(args?.product_name ?? "").trim();
      if (!q || !String(args?.description ?? "").trim()) return { error: "product_name and description are required." };
      const { data: rows } = await supabase.from("products").select("id, product_name").eq("company_id", ctx.companyId).ilike("product_name", `%${q.replace(/[%_]/g, "")}%`).limit(5);
      if (!rows?.length) return { error: `No product matching "${q}".` };
      const patch: Record<string, string> = { description: String(args.description).trim().slice(0, 2000) };
      if (args.benefits) patch.benefits = String(args.benefits).trim().slice(0, 2000);
      if (args.safety_notes) patch.safety_notes = String(args.safety_notes).trim().slice(0, 1000);
      const { error } = await supabase.from("products").update(patch).in("id", rows.map((r: any) => r.id));
      if (error) return { error: error.message };
      return { ok: true, updated: rows.length, note: "Saved. Now call write_ad_copy for this product." };
    }

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

      // Live from Meta first: the synced daily_metrics table can lag or miss ad sets, which made spend look far too low.
      const range = days <= 1 ? "today" : days <= 3 ? "last3" : days <= 7 ? "last7" : days <= 30 ? "last30" : "lifetime";
      const live = await AM(ctx.authHeader, { action: "list", ad_account_id: account.id, range });
      if (live?.ok && Array.isArray(live.campaigns)) {
        const sum = (k: string) => live.campaigns.reduce((t: number, c: any) => t + Number(c[k] || 0), 0);
        const spend = sum("spend"), imp = sum("impressions"), clicks = sum("clicks"), msgs = sum("conversations"), buys = sum("purchases");
        return {
          ad_account: account.name || account.nickname, source: "live from Meta", range_used: range, days_asked: days,
          spend: fmtNaira(spend), messages: msgs, purchases: buys, impressions: imp, link_clicks: clicks,
          ctr_pct: imp ? ((clicks / imp) * 100).toFixed(2) : "0.00",
          per_campaign: live.campaigns.filter((c: any) => Number(c.spend || 0) > 0).map((c: any) => ({
            campaign: c.name, status: c.effective_status, spend: fmtNaira(Number(c.spend || 0)), results: c.kind === "purchase" ? Number(c.purchases || 0) : Number(c.conversations || 0),
            result_type: c.kind === "purchase" ? "purchases" : "messages", cost_per_result: c.cost_per_result != null ? fmtNaira(Number(c.cost_per_result)) : "n/a",
          })),
          note: range === "lifetime" && days > 30 ? "Lifetime figures, because more than 30 days was asked." : undefined,
        };
      }

      const { data: adSets } = await supabase.from("ad_sets").select("id, adset_name, status").eq("ad_account_id", account.id).eq("company_id", ctx.companyId);
      const adSetIds = (adSets || []).map(a => a.id);
      if (!adSetIds.length) return { ad_account: account.name || account.nickname, note: "This ad account has no ad sets yet, so there's no performance data." };

      const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const { data: metrics, error: metErr } = await supabase.from("daily_metrics")
        .select("ad_set_id, spend_naira, impressions, clicks, ctr, orders, cost_per_order_naira, metric_date")
        .in("ad_set_id", adSetIds).is("ad_set_ad_id", null).gte("metric_date", sinceIso);
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

  if (table === "daily_metrics") q = q.is("ad_set_ad_id", null); // ad-set grain only; ad rows would double count
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
    supabase.from("daily_metrics").select("ad_set_id, spend_naira, orders, ctr, cost_per_order_naira, metric_date").eq("company_id", companyId).is("ad_set_ad_id", null).gte("metric_date", sinceIso.slice(0, 10)).limit(2000),
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
    ? await supabase.from("daily_metrics").select("ad_set_id, spend_naira, ctr, cost_per_order_naira, orders, metric_date").in("ad_set_id", adSetIds).is("ad_set_ad_id", null).gte("metric_date", sinceIso.slice(0, 10)).limit(2000)
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
