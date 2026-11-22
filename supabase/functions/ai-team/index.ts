import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { withR2, R2_ON } from "../_shared/r2storage.ts";
import { lessonNote, videoNote, pageNote, runNote, failureNote, type Note } from "../_shared/learn_notes.ts";
import { type MetaRow, type Numbers, type KillRow, type Need, runRows, numbersForRun, teamLines, todayLine, proposeHook, hardStopCheck, campaignsToPause } from "../_shared/autopilot_watch.ts";

// AI Team: a team lead, a creative agent, a media buyer and customer service hold a LIVE daily meeting about the business.
// The meeting runs in the background and writes into ai_meeting_messages word by word; the page watches it with Realtime.
//   POST { action: "start", topic?, demo? }          -> { meeting_id }     starts a meeting (one at a time per business)
//   POST { action: "say", meeting_id, text }          -> { ok }            you speak in the meeting; the next agent answers you
//   POST { action: "settings", enabled?, auto_launch?, daily_budget_cap_naira? }   (owner/admin)
//   POST { action: "state" }                          -> { team, meetings: [...] }
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("AI_TEAM_MODEL") ?? "gpt-4o-mini";
const RUNWAY = Deno.env.get("RUNWAY_API_KEY") ?? "";
const db = withR2(createClient(SUPABASE_URL, SERVICE));
const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
// Decisions that need judgement (the written meeting decision, ad set design) use Claude when its key is set; otherwise the usual model.
async function decideJson(system: string, user: string): Promise<string> {
  if (ANTHROPIC) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 4000, system: system + "\nReturn ONLY the JSON object, nothing else.", messages: [{ role: "user", content: user }] }) });
      const o = await r.json().catch(() => ({}));
      const t = String(o?.content?.[0]?.text ?? "");
      const m = t.match(/\{[\s\S]*\}/);
      if (r.ok && m) return m[0];
    } catch (_) { /* fall back */ }
  }
  return await openaiStream([{ role: "system", content: system }, { role: "user", content: user }], async () => {}, true);
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors } });

type Speaker = "team_lead" | "creative" | "media_buyer" | "customer_service";
const AGENTS: Record<Speaker, { name: string; role: string; brief: string }> = {
  team_lead: { name: "Ada", role: "Team Lead", brief: "You lead the team. You read the numbers, decide what to push, how to position the product and how aggressive the creatives should be (bold hooks, urgency, strong offers, social proof). You push the others to commit to specific actions." },
  creative: { name: "Zara", role: "Creative Agent", brief: "You make the ad images (videos later). You propose concrete image concepts: the scene, the angle, the AGGRESSIVE hook text on the image, the call to action on the image (what the viewer does next, e.g. ORDER NOW - PAY ON DELIVERY), the offer line, and the primary text. Every image is three parts: hook band on top, the scene with the product pack clearly visible in the middle, call-to-action band and offer strip at the bottom. You study the winning ads the learner saw and write a stronger, new hook." },
  media_buyer: { name: "Tobi", role: "Media Buyer", brief: "You launch the campaigns at midnight from creatives that are already made. You say what to test, which products and how much budget, which country (from the product's market, never assumed), the ad sets (one broad plus different age bands and real interests, each with a reason), what you would kill early, and what worries you in the numbers." },
  customer_service: { name: "Ife", role: "Customer Service", brief: "You talk to the customers. You only report what the numbers show (cancellations, deliveries, stock). If there is no customer feedback in the data, say so plainly; never invent customer quotes." },
};
const rules = (verified: boolean) => `Rules for everyone:
- Speak like a real teammate in a meeting: 2 to 4 short sentences, plain words, no bullet lists, no headings, no emojis.
- Use ONLY the numbers in the briefing. If a number is missing, say it is missing. Never invent sales, quotes or results.
- THE REAL PICTURE IS live_meta_from_ads_manager (straight from Meta). For every campaign it has numbers for today, yesterday, the last 2 days (yesterday + today), the last 7 days, the last 14 days and the last 30 days. Decide on the RECENT picture first: today, then the last 7 and 14 days, and use the 30 days only as the longer background. A campaign that was good over 30 days but is weak today and this week is not winning now. Before you say anything is winning, losing or "performing well", look at those windows and name the campaign, the window and the numbers (spend, purchases or conversations, cost per purchase or conversation). A campaign is winning only if the live numbers say so. Never call a product a winner from orders alone, and never say "interest but no sales" unless you checked the purchases in those windows.
- YOU CAN ACT IN THIS MEETING. Zara really makes images (the picture appears under her message a few seconds later) and Tobi really shows campaign plans (a plan card appears under his message). Never say you cannot generate images or cannot show a plan: when the BOSS asks, say what you are making or showing now, in one or two sentences.
- If live_meta_note says the live numbers could not be read, say that plainly and do not guess results.
- LEARN FROM THE WINNERS: live_meta_from_ads_manager.accounts[].winners shows, for the best campaigns, how each ad set was set up (countries, ages, gender, interests, placements, budget, optimisation) and the ad copy, headline and picture of their best ads. When you propose new ads, say what you are copying from a winner (the hook, the angle, the audience) and what you are changing.
- A CAMPAIGN'S COUNTRY COMES ONLY FROM ITS TARGETING. For every winner, live_meta_from_ads_manager.accounts[].winners[].runs_in_countries (and each ad set's targeting) says where it really runs. The words, the people or the setting in an ad may mention another country (for example a Nigerian-sounding ad running in Kenya). Never take the country from the ad's wording or picture, and never say the audience is in a country the targeting does not list. When you talk about a winner, say which country its ad sets target.
- COUNTRY: every launch runs in a named country. If the product's market is not clear from the briefing or the winning campaigns, the Media Buyer asks the BOSS which country before the launch is decided.
- Budgets, spend and results in the briefing are in Nigerian naira (₦). Prices and offers written INSIDE an ad use the currency of the country the ad runs in (₦ for Nigeria, KSh for Kenya). The team works for one business.
- CLAIMS: ${verified
    ? "This business has been verified by Revora. For each product you may use the claims listed in that product's approved_claims, in those words. Do not state any product claim that is not listed there, and never promise a cure or guaranteed result. If approved_claims is empty for a product, treat it as having no claims."
    : "This business is not verified yet, so make no product claims beyond the plain product description (what it is, the price, the offer, delivery and payment options). Never say a product cures, treats or fixes a condition. Bold hooks, urgency and strong offers are fine."}
- HOOKS: the hook is the first thing on the picture and in the copy, so it must stop the thumb. Make it AGGRESSIVE and specific: name the exact reader and the fear or the curiosity ("40 AND IGNORING YOUR BP? WAKE UP.", "You can feel perfectly fine and still have high blood pressure"). Short, in capitals, confrontational, one idea. Never a soft slogan like "Take care of your health". Copy the STYLE of winning_ads_the_learner_saw and lessons_learned (not their words) and write a NEW hook for the new picture.
- VIDEO ANATOMY: winning_video_anatomy (when present) shows how the best videos were built, scene by scene: the hook in the first seconds, how the problem is shown, the proof, the offer and when the call to action comes, with the words on screen and spoken. When you propose a video or a still image, say which structure you copy (for example hook, then problem, then proof, then offer, then call to action) and what you change for the product and country. Do not invent scenes the briefing does not show.\n- EVERY IMAGE HAS A CALL TO ACTION: after the hook the viewer must know what to do next. Every image brief has a hook (headline_on_image), a call to action (cta_on_image, for example "ORDER NOW - PAY ON DELIVERY" or "TAP ORDER NOW") and an offer line (offer_line, for example "PAY ON DELIVERY + FREE NATIONWIDE SHIPPING", only offers the product really has).
- MARKETS: use each product's sells_in_countries from product_markets. A product named or linked for a country (for example "Kenya") sells there. Never assume Nigeria. If it is not set and not clear, the Media Buyer asks the BOSS before the launch. Do not copy a country from winning campaigns of another market.
- TARGETING: the Media Buyer designs several ad sets for each launch: one BROAD ad set plus ad sets with different age bands (for example 25-60, 40-65, 30-50) and, where it makes sense, real interests. Base ages and interests on winners_ad settings in the briefing and lessons_learned, and say why each ad set exists.
- Respect each product's own safety notes.`;

async function openaiStream(messages: { role: string; content: unknown }[], onText: (t: string) => Promise<void>, json_mode = false): Promise<string> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, stream: !json_mode, temperature: 0.8, ...(json_mode ? { response_format: { type: "json_object" } } : {}) }),
  });
  if (!r.ok) throw new Error(`OpenAI said ${r.status}: ${(await r.text()).slice(0, 200)}`);
  if (json_mode) { const o = await r.json(); return String(o?.choices?.[0]?.message?.content ?? ""); }
  const reader = r.body!.getReader(), dec = new TextDecoder();
  let buf = "", full = "", lastPush = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (d === "[DONE]") continue;
      try { const t = JSON.parse(d)?.choices?.[0]?.delta?.content; if (t) full += t; } catch { /* partial line */ }
    }
    if (Date.now() - lastPush > 500) { lastPush = Date.now(); await onText(full); }
  }
  await onText(full);
  return full;
}

// Canned meeting used only to test the screen without spending credit; it is clearly marked in the topic.
const DEMO: Record<Speaker, string[]> = {
  team_lead: ["Morning team. This is a demo meeting with sample lines, not your real numbers. In a real meeting I read your last 14 days and tell you what is selling.", "Decision for the demo: push one winning product with a bold, urgent angle, and test one new angle against it."],
  creative: ["I would make three image concepts for the lead product: a before-and-after close-up, a customer-style photo, and a bold offer card with the price."],
  media_buyer: ["I would launch the best two concepts at midnight with a small cap, and kill anything that spends past the limit without landing page views."],
  customer_service: ["In a real meeting I report cancellations and delivery issues from your orders. Demo mode has no real data."],
};
async function demoSpeak(sp: Speaker, n: number, onText: (t: string) => Promise<void>) {
  const text = DEMO[sp][Math.min(n, DEMO[sp].length - 1)]; let out = "";
  for (const w of text.split(" ")) { out += (out ? " " : "") + w; await onText(out); await new Promise((r) => setTimeout(r, 70)); }
  return text;
}

async function addMessage(meetingId: string, companyId: string, speaker: string, content: string, done: boolean): Promise<{ id: string; seq: number }> {
  for (let k = 0; k < 6; k++) {
    const { data: last } = await db.from("ai_meeting_messages").select("seq").eq("meeting_id", meetingId).order("seq", { ascending: false }).limit(1).maybeSingle();
    const seq = (last?.seq ?? 0) + 1;
    const { data, error } = await db.from("ai_meeting_messages").insert({ meeting_id: meetingId, company_id: companyId, seq, speaker, content, done }).select("id, seq").single();
    if (!error && data) return data;
  }
  throw new Error("Could not write to the meeting.");
}

// The creative agent: one Runway image per brief. The picture lands in the company's vault storage (R2) and waits for a person's approval.
// Images come from OpenAI (gpt-image-1, then dall-e-3 if that model is not open to this account). Runway is only used when there is no OpenAI key.
async function openaiImage(prompt: string, opts: { refs?: string[]; size?: string } = {}): Promise<{ bytes?: Uint8Array; error?: string }> {
  const size = opts.size ?? "1024x1024";
  const refs = (opts.refs ?? []).filter(Boolean).slice(0, 3);
  // reference pictures (the real product pack): fetched once, then every model is tried with the same bytes
  const refFiles: { blob: Blob; name: string }[] = [];
  for (const [k, u] of refs.entries()) {
    try { const im = await fetch(u); if (!im.ok) continue; const ct = (im.headers.get("content-type") ?? "image/png").split(";")[0]; refFiles.push({ blob: new Blob([await im.arrayBuffer()], { type: ct }), name: `ref${k + 1}.${ct.includes("jpeg") ? "jpg" : ct.includes("webp") ? "webp" : "png"}` }); } catch (_) { /* a reference that cannot be read is skipped */ }
  }
  const toBytes = (b64: string) => { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return bytes; };
  const tryModel = async (model: string, extra: Record<string, unknown>) => {
    let r: Response;
    if (refFiles.length) {
      const fd = new FormData();
      fd.append("model", model); fd.append("n", "1"); fd.append("size", size);
      for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
      for (const f of refFiles) fd.append("image[]", f.blob, f.name);
      fd.append("input_fidelity", "high");
      fd.append("prompt", ("Image 1 is the REAL product pack: keep its shape, colours, logo and label text exactly as they are. " + prompt).slice(0, 3000));
      r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${OPENAI}` }, body: fd });
    } else {
      r = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${OPENAI}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, prompt: prompt.slice(0, 3000), n: 1, size, ...extra }) });
    }
    const o = await r.json().catch(() => ({}));
    const b64 = o?.data?.[0]?.b64_json;
    if (r.ok && b64) return { bytes: toBytes(b64) };
    return { error: `${model}: ${o?.error?.message ?? r.status}` };
  };
  // the newest image model this account has first; each is tried with a quality setting and then without it
  const errs: string[] = [];
  for (const model of ["gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini"]) {
    for (const extra of [{ quality: "medium" }, {}]) {
      const r = await tryModel(model, extra);
      if (r.bytes) return r;
      errs.push(r.error ?? "");
      if (/does not exist|not found|access/i.test(r.error ?? "")) break; // this model is not open to the account: next model
    }
  }
  return { error: errs.join(" | ").slice(0, 280) };
}
async function generateImage(id: string, companyId: string) {
  const fail = (e: string) => db.from("ai_team_images").update({ status: "failed", error: e.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", id);
  try {
    const { data: im } = await db.from("ai_team_images").select("prompt, brief").eq("id", id).single();
    let bytes: Uint8Array | undefined;
    if (OPENAI) {
      const r = await openaiImage(String(im?.prompt ?? ""), { refs: im?.brief?._ref ? [String(im.brief._ref)] : [] });
      if (r.error || !r.bytes) return await fail(r.error ?? "OpenAI could not make this image.");
      bytes = r.bytes;
    } else {
      const h = { Authorization: `Bearer ${RUNWAY}`, "Content-Type": "application/json", "X-Runway-Version": "2024-11-06" };
      const r = await fetch("https://api.dev.runwayml.com/v1/text_to_image", { method: "POST", headers: h, body: JSON.stringify({ model: "gen4_image", promptText: String(im?.prompt ?? "").slice(0, 1000), ratio: "1024:1024" }) });
      const o = await r.json().catch(() => ({}));
      if (!r.ok || !o?.id) return await fail(`Runway said ${r.status}: ${JSON.stringify(o).slice(0, 160)}`);
      await db.from("ai_team_images").update({ runway_task: o.id }).eq("id", id);
      let url = "";
      for (let i = 0; i < 40; i++) { // up to ~2 minutes
        await new Promise((res) => setTimeout(res, 3000));
        const t = await fetch(`https://api.dev.runwayml.com/v1/tasks/${o.id}`, { headers: h }).then((x) => x.json()).catch(() => null);
        if (t?.status === "SUCCEEDED") { url = String(t.output?.[0] ?? ""); break; }
        if (t?.status === "FAILED" || t?.status === "CANCELLED") return await fail(String(t.failure ?? "Runway could not make this image."));
      }
      if (!url) return await fail("Runway took too long.");
      const img = await fetch(url); if (!img.ok) return await fail("Could not download the image.");
      bytes = new Uint8Array(await img.arrayBuffer());
    }
    const path = `ai-team/${companyId}/${id}.png`;
    const up = await db.storage.from("creative-vault").upload(path, bytes!, { contentType: "image/png", upsert: true });
    if (up.error) return await fail(up.error.message);
    const pub = db.storage.from("creative-vault").getPublicUrl(path).data.publicUrl;
    await db.from("ai_team_images").update({ status: "ready", image_url: pub, updated_at: new Date().toISOString() }).eq("id", id);
  } catch (e) { await fail(String((e as Error)?.message ?? e)); }
}

// ---- Phase 3: the media buyer ----
const normName = (t: unknown) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// The next launch moment in Lagos time (UTC+1, no daylight saving), at least 20 minutes away so Meta accepts it as a scheduled start.
function nextStart(hour: number): Date {
  const now = new Date(), lagosNow = new Date(now.getTime() + 3600_000);
  const d = new Date(Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate(), hour, 5) - 3600_000);
  while (d.getTime() < now.getTime() + 20 * 60_000) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
const lagosIso = (d: Date) => new Date(d.getTime() + 3600_000).toISOString().replace(/\.\d+Z$/, "+01:00");

// Tobi designs the ad sets for one launch: a broad one plus different age bands and real interests. Claude decides when its key is set.
// deno-lint-ignore no-explicit-any
async function designAdSets(companyId: string, prod: any, name: string, budget: number, countries: string[]) {
  const broad = (b: number) => ({ label: "Broad 25-60", age_min: 25, age_max: 60, gender: "all", interest_keywords: [] as string[], budget_naira: b, why: "Broad audience: let Meta find the buyers." });
  const n = Math.max(1, Math.min(4, Math.floor(budget / 2000)));
  if (n === 1) return [broad(budget)];
  try {
    const x = await extraBriefing(companyId);
    const raw = await decideJson(`You are Tobi, a senior media buyer. Design the ad sets for ONE launch. Return ONLY JSON {"ad_sets":[{"label": string, "age_min": number, "age_max": number, "gender": "all"|"male"|"female", "interest_keywords": [string], "why": string}]}. Exactly ${n} ad sets. The FIRST is BROAD: no interests and wide ages (copy the age range of the winning ads below when they show one, else 25-60). The others each test something different: a different age band (for example 40-65, 30-50, 35-60) and/or one to three real Meta interest names (short, common, English words a Meta interest search would find, that fit this product and its buyers). Ages stay within 18-65 and each band spans at least 15 years. "why" is one short sentence. Use the winners and lessons below; do not invent results.`,
      `Product: ${JSON.stringify({ name, description: String(prod?.description ?? "").slice(0, 600), benefits: String(prod?.benefits ?? "").slice(0, 400) })}\nCountries: ${countries.join(", ")}\nWinning ads the learner saw:\n${JSON.stringify(x.winning_ads_the_learner_saw ?? []).slice(0, 7000)}\nLessons:\n${JSON.stringify(x.lessons_learned ?? []).slice(0, 2000)}`);
    const o = JSON.parse(raw);
    // deno-lint-ignore no-explicit-any
    const sets: any[] = (Array.isArray(o?.ad_sets) ? o.ad_sets : []).slice(0, n);
    if (!sets.length) return [broad(budget)];
    const each = Math.floor(budget / sets.length / 100) * 100;
    if (each < 1500) return [broad(budget)];
    return sets.map((a, i) => {
      const lo = Math.min(Math.max(Math.round(Number(a?.age_min) || 25), 18), 55), hi = Math.min(Math.max(Math.round(Number(a?.age_max) || 60), lo + 15), 65);
      return { label: String(a?.label || `Ad set ${i + 1}`).slice(0, 50), age_min: lo, age_max: hi, gender: ["male", "female"].includes(a?.gender) ? a.gender : "all",
        interest_keywords: i === 0 ? [] : (Array.isArray(a?.interest_keywords) ? a.interest_keywords : []).map((k: unknown) => String(k).slice(0, 40)).filter(Boolean).slice(0, 3),
        budget_naira: i === sets.length - 1 ? budget - each * (sets.length - 1) : each, why: String(a?.why ?? "").slice(0, 160) };
    });
  } catch (_) { return [broad(budget)]; }
}

async function proposeLaunches(meetingId: string, companyId: string, userId: string) {
  const { data: m } = await db.from("ai_meetings").select("id, company_id, status, decision").eq("id", meetingId).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const plan: any[] = Array.isArray((m?.decision as any)?.launch_plan) ? (m!.decision as any).launch_plan.slice(0, 8) : [];
  if (!m || m.company_id !== companyId || m.status !== "done" || !plan.length) return { error: "This meeting has no launch plan yet." };
  const { data: had } = await db.from("ai_launches").select("id").eq("meeting_id", meetingId).limit(1);
  if (had?.length) return { error: "Launches for this meeting were already prepared." };
  const { data: team } = await db.from("ai_teams").select("daily_budget_cap_naira, launch_hour_lagos").eq("company_id", companyId).maybeSingle();
  const cap = Number(team?.daily_budget_cap_naira ?? 0), hour = Number(team?.launch_hour_lagos ?? 0);
  const startAt = nextStart(hour);
  const { data: imgs } = await db.from("ai_team_images").select("brief, creative_id").eq("meeting_id", meetingId).eq("status", "approved");
  const { data: prods } = await db.from("products").select("id, product_name, destination_type, landing_page_url, ad_account_id, is_active, target_countries, description, benefits").eq("company_id", companyId).eq("is_active", true);
  const todayStart = new Date(Math.floor((Date.now() + 3600_000) / 86400_000) * 86400_000 - 3600_000).toISOString();
  const { data: today } = await db.from("ai_launches").select("daily_budget_naira").eq("company_id", companyId).in("status", ["proposed", "scheduled"]).gte("created_at", todayStart);
  let committed = (today ?? []).reduce((a, r) => a + Number(r.daily_budget_naira || 0), 0);
  const out = [];
  for (const it of plan) {
    const name = String(it?.product ?? "").slice(0, 120), budget = Math.max(0, Math.round(Number(it?.daily_budget_naira) || 0));
    const base = { company_id: companyId, meeting_id: meetingId, product_name: name, daily_budget_naira: budget, kill_rule: it?.kill_rule ? String(it.kill_rule).slice(0, 300) : null, start_at: startAt.toISOString(), created_by: userId };
    const skip = async (why: string) => { const { data } = await db.from("ai_launches").insert({ ...base, status: "skipped", note: why }).select("*").single(); out.push(data); };
    const prod = (prods ?? []).filter((p) => normName(p.product_name) === normName(name)).sort((a, b) => Number(!!b.landing_page_url) - Number(!!a.landing_page_url))[0];
    if (!prod) { await skip("Could not match this to one of your active products."); continue; }
    if (!prod.ad_account_id) { await skip("This product has no ad account assigned."); continue; }
    // deno-lint-ignore no-explicit-any
    const mine = (imgs ?? []).filter((i: any) => i.creative_id && (i.brief?._i === it?.creative_brief_index || normName(i.brief?.product) === normName(name))).slice(0, 3);
    if (!mine.length) { await skip("No approved image for this product yet. Approve at least one image first."); continue; }
    if (!budget) { await skip("No daily budget in the plan."); continue; }
    if (!cap) { await skip("Set a daily spend cap in Settings first (it is ₦0, so the media buyer may not spend)."); continue; }
    if (committed + budget > cap) { await skip(`Over today's spend cap (₦${cap.toLocaleString()}); ₦${committed.toLocaleString()} is already committed.`); continue; }
    // Which country: what the meeting decided, else the product's own market, else Nigeria (the business default).
    const cc = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, 5);
    const countries = cc(it?.countries).length ? cc(it?.countries) : cc(prod.target_countries).length ? cc(prod.target_countries) : [];
    if (!countries.length) { await skip("Which country should this run in? Set the product's countries in the Catalog (or tell the team in the meeting). The team does not assume Nigeria."); continue; }
    const { data: acct } = await db.from("ad_accounts").select("id, name, nickname, media_buyer_id, status").eq("id", prod.ad_account_id).maybeSingle();
    if (!acct || String(acct.status ?? "active").toLowerCase() !== "active") { await skip("The product's ad account is not active."); continue; }
    const { data: buyer } = acct.media_buyer_id ? await db.from("media_buyers").select("name").eq("id", acct.media_buyer_id).maybeSingle() : { data: null };
    let url = prod.landing_page_url as string | null;
    if (!url && prod.destination_type !== "whatsapp") {
      const { data: s } = await db.from("sites").select("id, slug").eq("product_id", prod.id).eq("status", "published").limit(1).maybeSingle();
      if (s) { const { data: d } = await db.from("site_domains").select("hostname").eq("site_id", s.id).eq("status", "active").limit(1).maybeSingle(); url = d ? `https://${d.hostname}/` : null; }
    }
    if (prod.destination_type !== "whatsapp" && !url) { await skip("No landing page link for this product."); continue; }
    // deno-lint-ignore no-explicit-any
    const copies = mine.map((i: any) => ({ primary_text: String(i.brief?.primary_text ?? "").slice(0, 500) || name, headline: String(i.brief?.headline_on_image ?? "").slice(0, 80) }));
    const adSets = await designAdSets(companyId, prod, name, budget, countries);
    const { data } = await db.from("ai_launches").insert({
      ...base, status: "proposed", product_id: prod.id, ad_account_id: acct.id, account_name: acct.nickname || acct.name, media_buyer_id: acct.media_buyer_id, buyer_name: buyer?.name ?? null,
      // deno-lint-ignore no-explicit-any
      creative_ids: mine.map((i: any) => i.creative_id), destination: prod.destination_type ?? "website", landing_url: url, copies, countries, ad_sets: adSets,
    }).select("*").single();
    committed += budget; out.push(data);
  }
  const ready = out.filter((x) => x?.status === "proposed");
  if (ready.length) await notify(companyId, "ai_team_launches", meetingId, "AI Team: a launch plan needs your approval", `Tobi prepared ${ready.length} launch${ready.length === 1 ? "" : "es"}: ${ready.map((x) => `${x.product_name} (₦${Number(x.daily_budget_naira).toLocaleString()}/day, ${(x.countries ?? []).join("/")})`).join("; ")}. Open the AI Team page to review the ad sets and approve. Nothing launches without you.`);
  return { ok: true, launches: out };
}

// Runs as the person who approved it: plans the campaign with the same tools ChatGPT/Claude use, then launches it SCHEDULED to start at 12AM.
async function approveLaunch(launchId: string, ctx: Record<string, unknown>) {
  const { data: l } = await db.from("ai_launches").select("*").eq("id", launchId).maybeSingle();
  if (!l || l.company_id !== ctx.companyId) return { error: "Launch not found." };
  // Claim it first (proposed -> launching) so two runs can never create the same campaign twice.
  const { data: claimed } = await db.from("ai_launches").update({ status: "launching", updated_at: new Date().toISOString() }).eq("id", l.id).eq("status", "proposed").select("id");
  if (!claimed?.length) return { error: "This launch is not waiting for approval." };
  const { data: team } = await db.from("ai_teams").select("launch_hour_lagos").eq("company_id", l.company_id).maybeSingle();
  const start = nextStart(Number(team?.launch_hour_lagos ?? 0));
  // Budgets are counted in the ad account's own currency (Meta decides it); an autopilot launch also has a hard end date.
  const { data: acur } = await db.from("ad_accounts").select("currency").eq("id", l.ad_account_id).maybeSingle();
  const budgetCur = String(acur?.currency ?? "NGN").toUpperCase();
  const endAt = Number(l.run_days) > 0 ? new Date(start.getTime() + Number(l.run_days) * 86400_000) : null;
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/mcp-ads`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": SERVICE }, body: JSON.stringify({ action: "call", tool, args, ctx }) });
    const o = await r.json().catch(() => ({})); return o?.out ?? o;
  };
  const fail = async (why: string) => { await db.from("ai_launches").update({ status: "failed", note: why.slice(0, 400), updated_at: new Date().toISOString() }).eq("id", l.id); return { error: why }; };
  const copies = (l.copies as { primary_text: string; headline?: string }[]) ?? [];
  // The ad sets Tobi designed; each interest keyword is turned into the real Meta interest (id and name) first.
  // deno-lint-ignore no-explicit-any
  const specs: any[] = Array.isArray(l.ad_sets) && l.ad_sets.length ? l.ad_sets : [{ label: "AI Team", budget_naira: Number(l.daily_budget_naira) }];
  const adsets = [];
  for (const sp of specs) {
    const interests: { id: string; name: string }[] = [];
    for (const kw of (Array.isArray(sp.interest_keywords) ? sp.interest_keywords : []).slice(0, 3)) {
      const r = await call("search_audiences", { ad_account_id: l.ad_account_id, query: String(kw), kind: "interest" }).catch(() => null);
      const hit = (r?.results ?? [])[0]; if (hit?.id) interests.push({ id: String(hit.id), name: String(hit.name ?? kw) });
    }
    adsets.push({ label: String(sp.label ?? "AI Team").slice(0, 60), budget_naira: Number(sp.budget_naira) || Number(l.daily_budget_naira), ...(sp.age_min ? { age_min: sp.age_min, age_max: sp.age_max } : {}), ...(sp.gender ? { gender: sp.gender } : {}),
      ...(Array.isArray(l.countries) && l.countries.length ? { countries: l.countries } : {}), ...(interests.length ? { interests } : {}) });
  }
  const planned = await call("plan_campaign", {
    ad_account_id: l.ad_account_id, product_name: l.product_name, destination: l.destination ?? "website", objective: "sales", budget_type: "abo",
    ...(l.landing_url ? { landing_url: l.landing_url } : {}), campaign_name: `AI Team · ${l.product_name} · ${new Date(start.getTime() + 3600_000).toISOString().slice(0, 10)}`,
    asset_ids: l.creative_ids, copies, ads: (l.creative_ids as string[]).map((id, i) => ({ asset_id: id, copy_index: Math.min(i, copies.length - 1) })),
    adsets, person_confirmed: true, start_time: lagosIso(start), budget_currency: budgetCur, ...(endAt ? { end_time: lagosIso(endAt) } : {}),
  });
  const planId = planned?.plan_id ?? planned?.plan?.id ?? planned?.id;
  if (!planId) return await fail(String(planned?.message ?? planned?.error ?? "The campaign plan could not be made.").slice(0, 300));
  await db.from("ai_launches").update({ plan_id: String(planId) }).eq("id", l.id);
  const launched = await call("launch_plan", { plan_id: String(planId), person_approved: true });
  if (launched?.error) return await fail(String(launched.error));
  await db.from("ai_launches").update({ status: "scheduled", start_at: start.toISOString(), note: "Scheduled on Meta. It starts at the time shown.", updated_at: new Date().toISOString() }).eq("id", l.id);
  return { ok: true, start_at: start.toISOString() };
}

// ---- shared steps (used by the buttons and by the automatic daily flow) ----
async function makeImages(meetingId: string, companyId: string): Promise<{ error?: string; started?: number }> {
  const { data: m } = await db.from("ai_meetings").select("id, company_id, status, decision").eq("id", meetingId).maybeSingle();
  if (!m || m.company_id !== companyId) return { error: "Meeting not found." };
  // deno-lint-ignore no-explicit-any
  const briefs: any[] = Array.isArray((m.decision as any)?.creative_briefs) ? (m.decision as any).creative_briefs.slice(0, 5) : [];
  if (m.status !== "done" || !briefs.length) return { error: "This meeting has no image briefs yet." };
  const { data: already } = await db.from("ai_team_images").select("id").eq("meeting_id", m.id).limit(1);
  if (already?.length) return { error: "Images for this meeting were already requested." };
  const rows = [];
  const { data: pph } = await db.from("products").select("product_name, product_image_url").eq("company_id", companyId).eq("is_active", true);
  for (const [bi, br0] of briefs.entries()) {
    const photo = (pph ?? []).find((x) => normName(x.product_name) === normName(br0?.product))?.product_image_url;
    const br = { ...br0, _i: bi, ...(photo ? { _ref: photo } : {}) };
    const prompt = adLayout(br, `${String(br.image_concept ?? br.angle ?? "").slice(0, 600)} (advertising photo for ${String(br.product ?? "the product").slice(0, 80)})`).slice(0, 2900);
    const { data: r } = await db.from("ai_team_images").insert({ company_id: companyId, meeting_id: m.id, brief: br, prompt }).select("id").single();
    if (r) rows.push(r.id);
  }
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(Promise.all(rows.map((id) => generateImage(id, companyId))).then(async () => { const { data: t } = await db.from("ai_teams").select("auto_launch").eq("company_id", companyId).maybeSingle(); if (!t?.auto_launch) await notify(companyId, "ai_team_images", meetingId, "AI Team: images ready to review", `Zara made ${rows.length} image${rows.length === 1 ? "" : "s"}. Open the AI Team page to approve the ones you like; then Tobi prepares the launch plan for your approval.`); }));
  return { started: rows.length };
}

// Approving an image puts it in the Creative Vault (creative_assets), the same place uploaded creatives live, tied to its product.
// deno-lint-ignore no-explicit-any
async function approveImage(im: any, companyId: string, userId: string | null): Promise<{ error?: string; creative_id?: string }> {
  if (im.status !== "ready" || !im.image_url) return { error: "This image is not ready to approve." };
  const br = im.brief ?? {};
  const { data: prods } = await db.from("products").select("id, product_name, ad_account_id").eq("company_id", companyId).eq("is_active", true);
  const prod = (prods ?? []).find((p) => normName(p.product_name) === normName(br.product));
  const { data: cr, error } = await db.from("creative_assets").insert({
    company_id: companyId, file_name: `${im.id}.png`, storage_path: `creative-vault/ai-team/${companyId}/${im.id}.png`, public_url: im.image_url, asset_type: "image",
    storage_provider: R2_ON ? "r2" : "supabase", product_id: prod?.id ?? null, ad_account_id: prod?.ad_account_id ?? null,
    primary_text: br.primary_text ?? null, headline: br.headline_on_image ?? null, display_name: `AI Team · ${String(br.product ?? "Image").slice(0, 50)} · ${String(br.angle ?? "").slice(0, 40)}`.trim(), uploaded_by: userId,
  }).select("id").single();
  if (error || !cr) return { error: error?.message ?? "Could not add it to the vault." };
  await db.from("ai_team_images").update({ status: "approved", creative_id: cr.id, updated_at: new Date().toISOString() }).eq("id", im.id);
  return { creative_id: cr.id };
}

const notify = (companyId: string, kind: string, key: string, title: string, body: string, severity = "info") =>
  db.rpc("rv_notify", { p_company: companyId, p_category: "ads", p_kind: kind, p_title: title, p_body: body, p_url: "/ai-team.html", p_severity: severity, p_dedupe: `${kind}:${key}` });

// A short-lived sign-in for the owner who switched automatic mode on, so a launch runs with that person's own permissions.
async function mintToken(userId: string): Promise<string | null> {
  try {
    const { data: u } = await db.auth.admin.getUserById(userId);
    const email = u?.user?.email; if (!email) return null;
    const { data: gl } = await db.auth.admin.generateLink({ type: "magiclink", email });
    const th = gl?.properties?.hashed_token; if (!th) return null;
    const tmp = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: v } = await tmp.auth.verifyOtp({ token_hash: th, type: "magiclink" });
    return v?.session?.access_token ?? null;
  } catch { return null; }
}

// Runs every 5 minutes (pg_cron). Starts a due daily meeting; moves automatic meetings through images -> launches, one safe step at a time.
async function tick() {
  const log: string[] = [];
  { // live meetings: end them when their time is up or nobody has spoken for 45 minutes
    const idle = new Date(Date.now() - 45 * 60_000).toISOString(), nowIso = new Date().toISOString();
    const { data: over } = await db.from("ai_meetings").select("id, company_id").eq("status", "running").eq("mode", "live").or(`ends_at.lt.${nowIso},last_activity_at.lt.${idle}`).limit(3);
    for (const x of over ?? []) { await finishLive(x.id, x.company_id); log.push(`${x.id}: live meeting ended`); }
  }
  const nowL = new Date(Date.now() + 3600_000), lagosHour = nowL.getUTCHours();
  const dayStart = Date.UTC(nowL.getUTCFullYear(), nowL.getUTCMonth(), nowL.getUTCDate()) - 3600_000;
  const { data: teams } = await db.from("ai_teams").select("*").eq("enabled", true).eq("daily_meeting", true);
  for (const t of teams ?? []) {
    if (lagosHour < Number(t.meeting_hour_lagos)) continue;
    const since = new Date(dayStart + Number(t.meeting_hour_lagos) * 3600_000).toISOString();
    const { data: had } = await db.from("ai_meetings").select("id").eq("company_id", t.company_id).eq("trigger", "daily").gte("started_at", since).limit(1);
    if (had?.length) continue;
    if (!OPENAI) { log.push(`${t.company_id}: no OpenAI key`); continue; }
    const topic = "Daily strategy: what is selling, how to position it, what to make and launch tonight.";
    const { data: m } = await db.from("ai_meetings").insert({ company_id: t.company_id, topic, trigger: "daily", started_by: t.auto_launch_by ?? null, auto_stage: t.auto_launch ? "images" : null }).select("id").single();
    if (m) { // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil(runMeeting(m.id, t.company_id, topic, false, true, !!t.auto_launch)); log.push(`${t.company_id}: meeting started`); }
  }
  const { data: ms } = await db.from("ai_meetings").select("id, company_id, status, decision, auto_stage, started_at").eq("trigger", "daily").in("auto_stage", ["images", "launch"]).gt("started_at", new Date(Date.now() - 14 * 3600_000).toISOString());
  for (const m of ms ?? []) {
    if (m.status === "running") continue;
    const done = async (note: string, sev = "info") => { await db.from("ai_meetings").update({ auto_stage: "done", auto_note: note }).eq("id", m.id); await notify(m.company_id, "ai_team_auto", m.id, "AI Team: automatic run finished", note, sev); };
    if (m.status === "failed") { await done("The meeting failed, so nothing was made or launched.", "warn"); continue; }
    const { data: t } = await db.from("ai_teams").select("auto_launch, auto_launch_by").eq("company_id", m.company_id).maybeSingle();
    if (!t?.auto_launch || !t.auto_launch_by) { await db.from("ai_meetings").update({ auto_stage: "done", auto_note: "Automatic mode was switched off." }).eq("id", m.id); continue; }
    const by = t.auto_launch_by as string;
    if (m.auto_stage === "images") {
      const { data: imgs } = await db.from("ai_team_images").select("*").eq("meeting_id", m.id);
      if (!imgs?.length) {
        // deno-lint-ignore no-explicit-any
        const hasBriefs = Array.isArray((m.decision as any)?.creative_briefs) && (m.decision as any).creative_briefs.length;
        if ((!OPENAI && !RUNWAY) || !hasBriefs) { await done("The meeting is ready, but images could not be made automatically (" + (!OPENAI && !RUNWAY ? "no image key" : "no image briefs") + "). Open the AI Team page to continue.", "warn"); continue; }
        const r = await makeImages(m.id, m.company_id); log.push(`${m.id}: images ${r.error ?? r.started}`); if (r.error) await done(r.error, "warn"); continue;
      }
      // a worker that died leaves an image "generating" forever; give up on those after 8 minutes
      for (const i of imgs) if (i.status === "generating" && Date.now() - new Date(i.updated_at).getTime() > 8 * 60_000) await db.from("ai_team_images").update({ status: "failed", error: "Timed out." }).eq("id", i.id);
      if (imgs.some((i) => i.status === "generating" && Date.now() - new Date(i.updated_at).getTime() <= 8 * 60_000)) continue;
      let n = 0; for (const i of imgs) if (i.status === "ready") { const r = await approveImage(i, m.company_id, by); if (!r.error) n++; }
      if (!n && !imgs.some((i) => i.status === "approved")) { await done("No image could be made, so nothing was launched.", "warn"); continue; }
      await db.from("ai_meetings").update({ auto_stage: "launch" }).eq("id", m.id); log.push(`${m.id}: ${n} images approved`); continue;
    }
    if (m.auto_stage === "launch") {
      const { data: had } = await db.from("ai_launches").select("id").eq("meeting_id", m.id).limit(1);
      if (!had?.length) { const r = await proposeLaunches(m.id, m.company_id, by); if ("error" in r) { await done(String(r.error), "warn"); } continue; }
      const { data: next } = await db.from("ai_launches").select("id").eq("meeting_id", m.id).eq("status", "proposed").order("created_at").limit(1);
      if (next?.length) { // one launch per run keeps each run well inside the time limit
        const token = await mintToken(by);
        if (!token) { await done("Could not sign in as the owner to launch. Open the AI Team page to approve the launches.", "warn"); continue; }
        const { data: prof } = await db.from("profiles").select("role").eq("id", by).maybeSingle();
        if (!["owner", "admin"].includes(String(prof?.role ?? ""))) { await done("The person who switched automatic mode on is no longer an owner or admin, so nothing was launched.", "warn"); continue; }
        const r = await approveLaunch(next[0].id, { token, userId: by, email: null, companyId: m.company_id, role: prof?.role ?? "", mediaBuyerId: null, displayName: "" });
        log.push(`${m.id}: launch ${next[0].id} ${"error" in r ? "failed" : "scheduled"}`); continue;
      }
      const { data: ls } = await db.from("ai_launches").select("status, daily_budget_naira, product_name").eq("meeting_id", m.id);
      const ok = (ls ?? []).filter((l) => l.status === "scheduled"), bad = (ls ?? []).filter((l) => l.status === "failed");
      const spend = ok.reduce((a, l) => a + Number(l.daily_budget_naira || 0), 0);
      await done(ok.length ? `Scheduled ${ok.length} campaign${ok.length > 1 ? "s" : ""} (₦${spend.toLocaleString()}/day) to start at 12:05 AM: ${ok.map((l) => l.product_name).join(", ")}.${bad.length ? ` ${bad.length} could not be launched.` : ""}` : `Nothing was launched${bad.length ? ` (${bad.length} failed)` : ""}. Open the AI Team page to see why.`, ok.length ? "success" : "warn");
    }
  }
  return log;
}

// The real, live numbers from Meta (not the stored daily table): every campaign today / yesterday / last 2 days / last 7 / last 30 days,
// plus how the winning campaigns were built and what their ads say. Read through ads-manager with the internal key.
// What each product's market is (from the Catalog) and what the learner has seen win: real winning ads with their copy, plus confirmed lessons.
async function extraBriefing(companyId: string) {
  const out: Record<string, unknown> = {};
  try {
    const { data: prods } = await db.from("products").select("product_name, target_countries, landing_page_url, destination_type").eq("company_id", companyId).eq("is_active", true);
    out.product_markets = (prods ?? []).map((p) => ({ product: p.product_name, sells_in_countries: Array.isArray(p.target_countries) && p.target_countries.length ? p.target_countries : "NOT SET IN CATALOG (read the product name and link for a country; if still unclear ask the BOSS, never assume Nigeria)", landing_page: p.landing_page_url ? String(p.landing_page_url).slice(0, 90) : null }));
  } catch (_) { /* optional */ }
  try {
    const { data: win } = await db.from("learn_anatomy").select("ad_name, campaign_name, purchases, spend, creative, adset_settings").eq("company_id", companyId).gt("purchases", 0).order("purchases", { ascending: false }).limit(8);
    out.winning_ads_the_learner_saw = (win ?? []).map((w) => ({ ad: w.ad_name, campaign: w.campaign_name, purchases: w.purchases, spend_naira: Math.round(Number(w.spend) || 0), cost_per_purchase_naira: w.purchases ? Math.round(Number(w.spend) / Number(w.purchases)) : null,
      headline: String((w.creative as { headline?: string } | null)?.headline ?? "").slice(0, 140), opening_of_primary_text: String((w.creative as { primary_text?: string } | null)?.primary_text ?? "").replace(/\s+/g, " ").slice(0, 220), cta: (w.creative as { cta?: string } | null)?.cta ?? null, targeting: w.adset_settings ?? null }));
  } catch (_) { /* optional */ }
  try {
    // How the winning VIDEOS were built, scene by scene (frames at every scene change + the spoken words), so a new video or image can copy the structure.
    const { data: vids } = await db.from("learn_videos").select("ad_id, length_s, analysis, analyzed_at").eq("company_id", companyId).not("analysis", "is", null).order("analyzed_at", { ascending: false }).limit(3);
    if (vids?.length) out.winning_video_anatomy = vids.map((v) => { const a = (v.analysis ?? {}) as { scenes?: Array<Record<string, string>>; structure?: unknown; style?: string; how_to_recreate?: string; why_it_may_work?: string };
      return { length_seconds: v.length_s, structure: a.structure ?? null, style: a.style ?? null, why_it_may_work: a.why_it_may_work ?? null, how_to_recreate: a.how_to_recreate ?? null,
        scenes: (a.scenes ?? []).slice(0, 10).map((x) => ({ at_seconds: x.t, role: x.role, shows: String(x.shows ?? "").slice(0, 120), text_on_screen: String(x.text_on_screen ?? "").slice(0, 80), voiceover: String(x.voiceover ?? "").slice(0, 120) })) }; });
  } catch (_) { /* optional */ }
  try {
    const { data: les } = await db.from("learn_lessons").select("claim, how_to, confidence, scope, status").or(`company_id.eq.${companyId},scope.eq.global`).order("confidence", { ascending: false }).limit(10);
    if (les?.length) out.lessons_learned = les.map((l) => ({ lesson: l.claim, how_to_use: l.how_to, confidence: l.confidence }));
  } catch (_) { /* optional */ }
  return out;
}

async function liveMeta(companyId: string): Promise<{ data?: unknown; images: { url: string; label: string }[]; note?: string }> {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 55_000);
    const r = await fetch(`${SUPABASE_URL}/functions/v1/ads-manager`, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-internal-key": SERVICE }, body: JSON.stringify({ action: "team_snapshot", company_id: companyId }) });
    clearTimeout(t);
    const o = await r.json().catch(() => null);
    if (!r.ok || !o?.ok) return { images: [], note: "Live numbers from Meta could not be read for this meeting: " + String(o?.error ?? r.status).slice(0, 120) };
    // The winning ads' pictures, ranked: sold today first, then this week, then this month. Their links are only for looking (very long), so they are kept out of the written briefing.
    // deno-lint-ignore no-explicit-any
    const cand: { url: string; label: string; k: number[] }[] = [];
    // deno-lint-ignore no-explicit-any
    for (const a of (o.accounts ?? []) as any[]) for (const w of a.winners ?? []) for (const x of w.best_ads ?? []) {
      if (typeof x.picture_url === "string" && x.picture_url.startsWith("https://")) {
        const td = x.today?.purchases ?? 0, wk = x.last_7_days?.purchases ?? 0, mo = x.last_30_days?.purchases ?? 0;
        cand.push({ url: x.picture_url, label: `${x.name} (campaign ${w.campaign}): ${td} purchase${td === 1 ? "" : "s"} today, ${wk} in 7 days, ${mo} in 30 days`, k: [td, wk, mo] });
      }
      delete x.picture_url;
    }
    cand.sort((p, q) => q.k[0] - p.k[0] || q.k[1] - p.k[1] || q.k[2] - p.k[2]);
    for (const a of o.accounts ?? []) (a.campaigns ?? []).splice(12);
    return { data: o, images: cand.filter((c) => c.k[2] > 0).slice(0, 4).map(({ url, label }) => ({ url, label })) };
  } catch (e) { return { images: [], note: "Live numbers from Meta could not be read for this meeting: " + String((e as Error)?.message ?? e).slice(0, 100) }; }
}

// Every ad picture has three parts so the viewer knows what to do after the hook: hook band, scene with the product, call-to-action band with the offer.
// deno-lint-ignore no-explicit-any
function adLayout(br: any, scene: string): string {
  const t = (v: unknown, n: number) => String(v ?? "").replace(/["\n]+/g, " ").trim().slice(0, n);
  const hook = t(br?.headline_on_image, 90), cta = t(br?.cta_on_image, 50) || "ORDER NOW - PAY ON DELIVERY", offer = t(br?.offer_line, 70);
  return `${scene}. A finished, scroll-stopping square (1:1) social media ad made of THREE parts. TOP band: solid dark navy background with the hook ${hook ? `"${hook}"` : "(a short aggressive hook)"} in huge, bold, condensed capital letters, mostly yellow and white with the single most important word in red, filling the full width. MIDDLE: a photorealistic scene that matches the hook, with the product pack (a bottle or box) clearly visible and large in the foreground. BOTTOM: a bold red banner with the call to action "${cta}" in big white capital letters${offer ? `, and under it a dark rounded strip reading "${offer}"` : ""}. All text must be large, sharp and spelled exactly as written, with no extra words. ${PEOPLE_RULE} No logos or brand marks other than the product pack, no medical claims in the picture.`;
}

const PEOPLE_RULE = "PEOPLE IN PICTURES: show Black African people (natural Nigerian or Kenyan faces, skin tones, hair and clothing), of varied ages and genders. Where several people appear, mostly Black Africans and sometimes mixed with other ethnicities. Never show only white people unless the BOSS asks for it.";

// Meta's picture links refuse OpenAI's downloader (403), so this function downloads the picture itself and hands it over as data.
async function asDataUrl(url: string): Promise<string | null> {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12_000);
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; RevoraTeam/1.0)", Accept: "image/*" } });
    clearTimeout(t);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 500 || buf.length > 4_000_000) return null;
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:${(r.headers.get("content-type") ?? "image/jpeg").split(";")[0]};base64,${btoa(bin)}`;
  } catch { return null; }
}
async function loadPictures(images: { url: string; label: string }[]): Promise<{ url: string; label: string }[]> {
  const out = await Promise.all(images.map(async (im) => { const d = await asDataUrl(im.url); return d ? { url: d, label: im.label } : null; }));
  return out.filter(Boolean) as { url: string; label: string }[];
}

// Look at the winning pictures and write down, in words, what is in them and why they work, so every agent can use it.
async function readPictures(images: { url: string; label: string }[]): Promise<{ text?: unknown; note?: string }> {
  if (!images.length) return {};
  try {
    const got = await loadPictures(images);
    if (!got.length) return { note: "The winning pictures could not be downloaded from Meta." };
    images = got;
    const content: unknown[] = [{ type: "text", text: "These are the pictures of the ads that are selling right now (each is labelled with its results). For each picture, in order, describe what is in it (scene, people, objects, colours, any words on the picture) and the hook or emotion it uses. Return ONLY JSON {\"pictures\":[{\"label\": string, \"scene\": string, \"people\": string, \"words_on_image\": string, \"hook\": string, \"why_it_probably_works\": string}]}. Describe only what you can see." }];
    images.forEach((im, k) => { content.push({ type: "text", text: `Picture ${k + 1}: ${im.label}` }, { type: "image_url", image_url: { url: im.url } }); });
    const raw = await openaiStream([{ role: "user", content }], async () => {}, true);
    return { text: JSON.parse(raw)?.pictures };
  } catch (e) { return { note: "The winning pictures could not be read: " + String((e as Error)?.message ?? e).slice(0, 120) }; }
}

async function runMeeting(meetingId: string, companyId: string, topic: string, demo: boolean, daily = false, auto = false) {
  try {
    const { data: brief0 } = await db.rpc("rv_team_briefing", { p_company: companyId });
    const brief = { ...(brief0 ?? {}) } as Record<string, unknown>;
    delete brief.ads_last_7d; // the stored daily table lags and was wrong: the live Meta numbers below replace it
    const live = demo ? { images: [] as { url: string; label: string }[], data: undefined, note: undefined } : await liveMeta(companyId);
    const extra = await extraBriefing(companyId);
    const briefing = JSON.stringify({ live_meta_from_ads_manager: live.data ?? null, live_meta_note: live.note ?? null, ...extra, ...brief }).slice(0, 48000);
    // Who speaks, in order. After a person speaks, the next speaker answers them.
    const plan: Speaker[] = ["team_lead", "creative", "media_buyer", "customer_service", "team_lead", "creative", "media_buyer", "team_lead"];
    const count: Record<string, number> = {};
    for (const sp of plan) {
      const a = AGENTS[sp];
      const { data: msgs } = await db.from("ai_meeting_messages").select("speaker, content").eq("meeting_id", meetingId).order("seq");
      const transcript = (msgs ?? []).map((m) => `${m.speaker === "you" ? "BOSS (a person, answer them directly)" : (AGENTS[m.speaker as Speaker]?.name ?? m.speaker) + " (" + (AGENTS[m.speaker as Speaker]?.role ?? "") + ")"}: ${m.content}`).join("\n");
      const row = await addMessage(meetingId, companyId, sp, "", false);
      const push = async (t: string) => { await db.from("ai_meeting_messages").update({ content: t, updated_at: new Date().toISOString() }).eq("id", row.id); };
      const n = count[sp] = (count[sp] ?? -1) + 1;
           const msgs0 = [
        { role: "system", content: `You are ${a.name}, the ${a.role} of an AI marketing team for an online business that sells in Nigeria and Kenya. ${a.brief}\n\n${rules(!!(brief as { claims_verified?: boolean } | null)?.claims_verified)}\n\nMeeting topic: ${topic}\n\nBRIEFING (real data):\n${briefing}` },
        { role: "user", content: `Meeting so far:\n${transcript || "(nothing yet, you open the meeting)"}\n\nNow it is your turn, ${a.name}. ${sp === "team_lead" && !transcript ? "Open the meeting: say what the numbers show and what today's focus should be." : sp === "team_lead" && (count.team_lead ?? 0) > 1 ? "Close the meeting: state the decisions clearly (which products, which angles, how aggressive, what to launch tonight)." : "Respond to what was said and add your part."}` },
      ]; 
      const withImgs = sp === "creative" && live.images.length ? [msgs0[0], { role: "user", content: [{ type: "text", text: String((msgs0[1] as { content: string }).content) + "\n\nThe pictures attached are the best ads running now. Look at them before you propose images." }, ...live.images.map((u) => ({ type: "image_url", image_url: { url: u.url } }))] }] : msgs0;
      let text: string;
      if (demo) text = await demoSpeak(sp, n, push);
      else { try { text = await openaiStream(withImgs, push); } catch (e) { if (withImgs === msgs0) throw e; text = await openaiStream(msgs0, push); } }
      await db.from("ai_meeting_messages").update({ content: text.trim(), done: true, updated_at: new Date().toISOString() }).eq("id", row.id);
    }
    // The written decision the creative agent and media buyer will work from.
    let decision: unknown = { summary: "Demo meeting: no real decision was made.", demo: true };
    if (!demo) {
      const { data: msgs } = await db.from("ai_meeting_messages").select("speaker, content").eq("meeting_id", meetingId).order("seq");
      const transcript = (msgs ?? []).map((m) => `${AGENTS[m.speaker as Speaker]?.name ?? "BOSS"}: ${m.content}`).join("\n");
      const raw = await decideJson(`You write the official decision of an AI marketing team meeting. Return ONLY JSON: {"summary": string (2-3 sentences), "angles": [string], "creative_briefs": [{"product": string, "angle": string, "image_concept": string, "headline_on_image": string (an AGGRESSIVE, specific hook in capitals), "cta_on_image": string (what the viewer does next, e.g. ORDER NOW - PAY ON DELIVERY), "offer_line": string (only real offers, e.g. PAY ON DELIVERY + FREE NATIONWIDE SHIPPING), "primary_text": string}], "launch_plan": [{"product": string, "creative_brief_index": number, "daily_budget_naira": number, "countries": [string], "kill_rule": string}], "risks": [string]}. Use only products from the briefing. "countries" are two-letter country codes the launch targets, for example ["KE"] or ["NG"]; take them from what the meeting said or from the winning campaign for that product, and leave the list empty only if nobody said. Max 5 creative_briefs. Only use product claims the briefing allows (approved_claims when claims_verified is true, otherwise none).\n\nBRIEFING:\n${briefing}` , `Meeting transcript:\n${transcript}`);
      try { decision = JSON.parse(raw); } catch { decision = { summary: raw.slice(0, 600) }; }
    }
    await db.from("ai_meetings").update({ status: "done", decision, ended_at: new Date().toISOString() }).eq("id", meetingId);
    if (daily && !auto) await notify(companyId, "ai_team_ready", meetingId, "AI Team: today's meeting is ready", "The team made today's plan. Open the AI Team page to make the images and approve the launches.");
  } catch (e) {
    await db.from("ai_meetings").update({ status: "failed", error: String((e as Error)?.message ?? e).slice(0, 400), ended_at: new Date().toISOString() }).eq("id", meetingId);
  }
}


// ============ LIVE MEETINGS (people-paced) ============
// A live meeting stays open until a person ends it (or the time is up). The team opens it with the real numbers, then waits for the BOSS:
// every message the BOSS sends is answered by whoever it is for (one to three people, one after the other, with a pause between them).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pace = (t: string) => sleep(Math.min(6000, 1500 + t.length * 18));
const SPEAKERS: Speaker[] = ["team_lead", "creative", "media_buyer", "customer_service"];

async function assembleBriefing(companyId: string) {
  const { data: brief0 } = await db.rpc("rv_team_briefing", { p_company: companyId });
  const brief = { ...(brief0 ?? {}) } as Record<string, unknown>;
  delete brief.ads_last_7d; // the stored daily table lags: the live Meta numbers replace it
  const live = await liveMeta(companyId);
  const read = await readPictures(live.images);
  const extra = await extraBriefing(companyId);
  return { briefing: JSON.stringify({ live_meta_from_ads_manager: live.data ?? null, live_meta_note: live.note ?? null, ...extra, winning_pictures_described: read.text ?? null, winning_pictures_note: read.note ?? null, ...brief }).slice(0, 48000), images: live.images, verified: !!brief.claims_verified };
}

async function liveTurn(meetingId: string, companyId: string, sp: Speaker, instruction: string, m: { topic: string; briefing: string; images: { url: string; label: string }[]; verified: boolean }) {
  const a = AGENTS[sp];
  const { data: msgs } = await db.from("ai_meeting_messages").select("speaker, content").eq("meeting_id", meetingId).order("seq");
  const transcript = (msgs ?? []).map((x) => `${x.speaker === "you" ? "BOSS (a person, answer them directly)" : (AGENTS[x.speaker as Speaker]?.name ?? x.speaker) + " (" + (AGENTS[x.speaker as Speaker]?.role ?? "") + ")"}: ${x.content}`).join("\n");
  const row = await addMessage(meetingId, companyId, sp, "", false);
  const push = async (t: string) => { await db.from("ai_meeting_messages").update({ content: t, updated_at: new Date().toISOString() }).eq("id", row.id); };
  const system = `You are ${a.name}, the ${a.role} of an AI marketing team for an online business that sells in Nigeria and Kenya. ${a.brief}\n\n${rules(m.verified)}\n\nLIVE MEETING: you are talking with the BOSS (the person who runs this business) and three teammates. This is a conversation, not a presentation: say only YOUR part, in at most 3 short sentences, never repeat what a teammate just said, and answer the BOSS directly when they have spoken. When the BOSS gives a direction, accept it and say what you will do; nothing is ever launched without the BOSS approving it on the page. The BOSS's instructions beat your own ideas: if they say focus on a product or launch in a country, follow it. Ask the BOSS a short question only when you really need the answer (for example which country a product should be launched in when its target_countries are empty).\n\nMeeting topic: ${m.topic}\n\nBRIEFING (real data):\n${m.briefing}`;
  const user = `Meeting so far:\n${transcript || "(nothing yet)"}\n\n${instruction}`;
  const plain = [{ role: "system", content: system }, { role: "user", content: user }];
  const seen = sp === "creative" && m.images.length ? await loadPictures(m.images) : [];
  const withImgs = seen.length ? [plain[0], { role: "user", content: [{ type: "text", text: user + "\n\nThe pictures attached are the ads that are SELLING now, best first:\n" + seen.map((u, k) => `${k + 1}. ${u.label}`).join("\n") + "\nLook at them and learn from what works." }, ...seen.map((u) => ({ type: "image_url", image_url: { url: u.url } }))] }] : plain;
  let text: string;
  try { text = await openaiStream(withImgs, push); } catch (e) { if (withImgs === plain) throw e; text = await openaiStream(plain, push); }
  await db.from("ai_meeting_messages").update({ content: text.trim(), done: true, updated_at: new Date().toISOString() }).eq("id", row.id);
  return { text, id: row.id };
}

async function startLive(meetingId: string, companyId: string, topic: string) {
  try {
    const b = await assembleBriefing(companyId);
    await db.from("ai_meetings").update({ briefing: b.briefing, images: b.images }).eq("id", meetingId);
    const ctx = { topic, briefing: b.briefing, images: b.images, verified: b.verified };
    const steps: [Speaker, string][] = [
      ["team_lead", "Open the meeting in at most 4 short sentences. Say what the LIVE numbers show: which campaign is winning (name it) with its numbers for today, yesterday and the last 7 days, and anything spending without results. Then tell the BOSS you want their direction and hand over to Zara for the creative read."],
      ["creative", "Give your read in 2 or 3 sentences: look at the winning ads' copy, headlines and pictures (winners / best_ads) and say which hook or angle seems to be working and why. Do not propose new images yet."],
      ["media_buyer", "Give your read in 2 or 3 sentences: how the winning campaigns are set up (countries, ages, budgets) and what you would test next. If a product has no target_countries set, ask the BOSS which country it should run in."],
      ["customer_service", "Give your read in 2 or 3 sentences from the orders and stock in the briefing, and say if they do not match Meta's purchases. Mention anything customers or stock should change."],
      ["team_lead", "Close the opening in one or two sentences by asking the BOSS one clear question: what should the team focus on today? Then wait for the answer."],
    ];
    for (const [sp, ins] of steps) { const t = (await liveTurn(meetingId, companyId, sp, ins, ctx)).text; await db.from("ai_meetings").update({ last_activity_at: new Date().toISOString() }).eq("id", meetingId); await pace(t); }
  } catch (e) {
    await db.from("ai_meetings").update({ status: "failed", error: String((e as Error)?.message ?? e).slice(0, 400), ended_at: new Date().toISOString() }).eq("id", meetingId);
  }
}

async function routeSpeakers(meetingId: string, boss: string): Promise<{ speakers: Speaker[]; image: boolean; plan: boolean }> {
  const name = boss.toLowerCase();
  const named: Speaker[] = [];
  if (/\b(ada|strategy|team lead)\b/.test(name)) named.push("team_lead");
  if (/\b(zara|creative)\b/.test(name)) named.push("creative");
  if (/\b(tobi|media ?buy\w*)\b/.test(name)) named.push("media_buyer");
  if (/\b(ife|customer (care|service))\b/.test(name)) named.push("customer_service");
  let image = /\b(image|picture|photo|creative|visual|design|mock ?up|sample)\b/.test(name) && /\b(make|generate|create|show|give|draw|produce|send|see|let me see|example|sample)\b/.test(name);
  let plan = /\b(plan|structure|setup|set up|campaign plan|ad ?sets?|targeting)\b/.test(name) && /\b(show|give|let me see|see|what is|what's|share|display|send|present)\b/.test(name);
  try {
    const { data: msgs } = await db.from("ai_meeting_messages").select("speaker, content").eq("meeting_id", meetingId).order("seq", { ascending: false }).limit(6);
    const recent = (msgs ?? []).reverse().map((x) => `${x.speaker}: ${String(x.content).slice(0, 220)}`).join("\n");
    const raw = await openaiStream([
      { role: "system", content: `You decide who answers the BOSS in a live marketing meeting. People: team_lead (strategy, priorities), creative (images, hooks, copy), media_buyer (budgets, targeting, countries, launches, kill rules, campaign plans), customer_service (orders, customers, stock). Return ONLY JSON {"speakers":[...],"image":boolean,"plan":boolean}: speakers = 1 to 3 of those ids in speaking order (the person the BOSS is talking to first; others only if they have something genuinely new to add; if the BOSS gives a general direction, team_lead first, then whoever must act). image = true only if the BOSS is asking to SEE or MAKE a picture/creative/image/sample now. plan = true only if the BOSS is asking to SEE the campaign plan or structure now.` },
      { role: "user", content: `Recent messages:\n${recent}\n\nThe BOSS's last message is the last line starting with "you".` },
    ], async () => {}, true);
    const o = JSON.parse(raw);
    const list = (o?.speakers ?? []).filter((x: string) => SPEAKERS.includes(x as Speaker)) as Speaker[];
    image = !!o?.image || image; plan = !!o?.plan || plan;
    const out = [...new Set([...named, ...list])].slice(0, 3) as Speaker[];
    if (image && !out.includes("creative")) out.unshift("creative");
    if (plan && !out.includes("media_buyer")) out.unshift("media_buyer");
    return { speakers: out.slice(0, 3), image, plan };
  } catch (_) { /* fall back below */ }
  const fb: Speaker[] = named.length ? named.slice(0, 3) : ["team_lead", "media_buyer"];
  if (image && !fb.includes("creative")) fb.unshift("creative");
  if (plan && !fb.includes("media_buyer")) fb.unshift("media_buyer");
  return { speakers: fb.slice(0, 3), image, plan };
}

// What the team MAKES in the meeting (not just talks about): a real picture, and a real campaign plan.
async function makeChatImage(meetingId: string, companyId: string, rowId: string, said: string, topic: string, winners: { url: string; label: string }[]) {
  const ask = `Meeting topic: ${topic}\nCreative agent said: ${said}`;
  winners = await loadPictures(winners.slice(0, 3));
  const user: unknown = winners.length ? [{ type: "text", text: ask + "\n\nThe pictures attached are the ads that are SELLING now. Keep what makes them work (the concept, the emotion, the composition style) but make a NEW picture, not a copy.\n" + winners.slice(0, 3).map((u, k) => `${k + 1}. ${u.label}`).join("\n") }, ...winners.slice(0, 3).map((u) => ({ type: "image_url", image_url: { url: u.url } }))] : ask;
  const sys = { role: "system", content: `From the creative agent's message and the meeting, return ONLY JSON {"product": string, "angle": string, "headline_on_image": string (an AGGRESSIVE, specific hook in capitals), "cta_on_image": string (what the viewer does next, e.g. ORDER NOW - PAY ON DELIVERY), "offer_line": string (only real offers, e.g. PAY ON DELIVERY + FREE NATIONWIDE SHIPPING), "image_prompt": string}. image_prompt describes ONLY the middle scene of the ad (people, setting, lighting, mood, the product pack in the foreground), built on the concept of the winning pictures when they are shown. The hook band and the call-to-action band are added around it automatically. No medical claims in the picture.` };
  let raw: string;
  try { raw = await openaiStream([sys, { role: "user", content: user }], async () => {}, true); }
  catch (_) { raw = await openaiStream([sys, { role: "user", content: ask }], async () => {}, true); }
  let o: { product?: string; angle?: string; headline_on_image?: string; cta_on_image?: string; offer_line?: string; image_prompt?: string } = {};
  try { o = JSON.parse(raw); } catch { /* use the message itself */ }
  const prompt = adLayout(o, String(o.image_prompt || said).slice(0, 900)).slice(0, 2900);
  const { data: im } = await db.from("ai_team_images").insert({ company_id: companyId, meeting_id: meetingId, brief: { product: o.product ?? "Product", angle: o.angle ?? "Sample", headline_on_image: o.headline_on_image ?? "", _chat: true }, prompt }).select("id").single();
  if (!im) return;
  await db.from("ai_meeting_messages").update({ attachment: { type: "image", image_id: im.id } }).eq("id", rowId);
  await generateImage(im.id, companyId);
}
async function makeChatPlan(meetingId: string, companyId: string, rowId: string, m: { topic: string; briefing: string }) {
  const { data: msgs } = await db.from("ai_meeting_messages").select("speaker, content").eq("meeting_id", meetingId).order("seq");
  const transcript = (msgs ?? []).map((x) => `${AGENTS[x.speaker as Speaker]?.name ?? "BOSS"}: ${x.content}`).join("\n");
  const raw = await openaiStream([
    { role: "system", content: `You are the media buyer. Write the campaign plan the meeting is heading to. Return ONLY JSON {"campaign_name": string, "product": string, "objective": string, "destination": string, "countries": [string], "daily_budget_naira": number, "budget_type": "ABO"|"CBO", "start": string, "ad_sets": [{"label": string, "countries": [string], "ages": string, "genders": string, "interests": [string], "placements": string, "daily_budget_naira": number}], "ads": [{"headline": string, "primary_text": string, "format": string}], "kill_rule": string, "based_on": string, "open_questions": [string]}. Follow the BOSS's instructions first (product, country, budget). Copy the setup of the winning campaign for that product from the briefing where it fits and say which one in based_on. countries are two-letter codes. Put anything you still need from the BOSS in open_questions (for example the country if unknown). Use only facts from the briefing and the meeting; no invented numbers.\n\nBRIEFING:\n${m.briefing.slice(0, 20000)}` },
    { role: "user", content: `Meeting topic: ${m.topic}\n\nTranscript:\n${transcript}` },
  ], async () => {}, true);
  let plan: unknown = null; try { plan = JSON.parse(raw); } catch { /* none */ }
  if (plan) await db.from("ai_meeting_messages").update({ attachment: { type: "plan", plan } }).eq("id", rowId);
}

async function liveRespond(meetingId: string, companyId: string) {
  const stale = new Date(Date.now() - 3 * 60_000).toISOString();
  const { data: got } = await db.from("ai_meetings").update({ responding_since: new Date().toISOString() }).eq("id", meetingId).eq("status", "running").or(`responding_since.is.null,responding_since.lt.${stale}`).select("topic, briefing, images");
  if (!got?.length) return; // someone is already answering; they will see the new message when they finish
  try {
    let m = { topic: String(got[0].topic ?? ""), briefing: String(got[0].briefing ?? ""), images: ((got[0].images ?? []) as unknown[]).map((x) => typeof x === "string" ? { url: x, label: "a winning ad" } : x as { url: string; label: string }), verified: false };
    if (!m.briefing) { const b = await assembleBriefing(companyId); m = { ...m, briefing: b.briefing, images: b.images, verified: b.verified }; await db.from("ai_meetings").update({ briefing: b.briefing, images: b.images }).eq("id", meetingId); }
    else { const { data: t } = await db.rpc("rv_team_briefing", { p_company: companyId }); m.verified = !!(t as { claims_verified?: boolean } | null)?.claims_verified; }
    for (let round = 0; round < 4; round++) {
      const { data: last } = await db.from("ai_meeting_messages").select("speaker, content").eq("meeting_id", meetingId).order("seq", { ascending: false }).limit(1).maybeSingle();
      if (!last || last.speaker !== "you") break;
      const route = await routeSpeakers(meetingId, String(last.content));
      const speakers = route.speakers;
      await sleep(900);
      const jobs: Promise<unknown>[] = [];
      for (let i = 0; i < speakers.length; i++) {
        const sp = speakers[i];
        const wantImage = sp === "creative" && route.image, wantPlan = sp === "media_buyer" && route.plan;
        const ins = wantImage ? "The BOSS asked for a picture. In one or two sentences say what you are creating right now: say which winning ad (best seller first) the concept comes from, the scene, the people and the headline. The real picture appears under your message in a few seconds."
          : wantPlan ? "The BOSS asked to see the campaign plan. In one or two sentences say what the plan is (product, country, budget, how it is set up). The plan card appears under your message."
          : i === 0 ? "Answer the BOSS's last message directly." : "Add only what is NEW and useful after your teammate. If nothing is needed, say so in one short sentence.";
        const r = await liveTurn(meetingId, companyId, sp, ins, m);
        if (wantImage) jobs.push(makeChatImage(meetingId, companyId, r.id, r.text, m.topic, m.images).catch(async (e) => { await db.from("ai_meeting_messages").update({ attachment: { type: "error", text: "The picture could not be made: " + String((e as Error)?.message ?? e).slice(0, 120) } }).eq("id", r.id); }));
        if (wantPlan) jobs.push(makeChatPlan(meetingId, companyId, r.id, m).catch(() => {}));
        await db.from("ai_meetings").update({ responding_since: new Date().toISOString(), last_activity_at: new Date().toISOString() }).eq("id", meetingId);
        if (i < speakers.length - 1) await pace(r.text);
      }
      await Promise.all(jobs); // the picture and the plan finish here (the pictures take about half a minute)
    }
  } catch (e) {
    await addMessage(meetingId, companyId, "team_lead", "Sorry, I lost my connection for a moment. Please say that again.", true).catch(() => {});
  } finally {
    await db.from("ai_meetings").update({ responding_since: null, last_activity_at: new Date().toISOString() }).eq("id", meetingId);
  }
}

async function makeDecision(meetingId: string, briefing: string): Promise<unknown> {
  const { data: msgs } = await db.from("ai_meeting_messages").select("speaker, content").eq("meeting_id", meetingId).order("seq");
  const transcript = (msgs ?? []).map((m) => `${AGENTS[m.speaker as Speaker]?.name ?? "BOSS"}: ${m.content}`).join("\n");
  const raw = await decideJson(`You write the official decision of an AI marketing team meeting. Return ONLY JSON: {"summary": string (2-3 sentences), "angles": [string], "creative_briefs": [{"product": string, "angle": string, "image_concept": string, "headline_on_image": string (an AGGRESSIVE, specific hook in capitals), "cta_on_image": string (what the viewer does next, e.g. ORDER NOW - PAY ON DELIVERY), "offer_line": string (only real offers, e.g. PAY ON DELIVERY + FREE NATIONWIDE SHIPPING), "primary_text": string}], "launch_plan": [{"product": string, "creative_brief_index": number, "daily_budget_naira": number, "countries": [string], "kill_rule": string}], "risks": [string]}. THE BOSS'S INSTRUCTIONS IN THE TRANSCRIPT BEAT EVERYTHING: plan only what the BOSS asked for (the products, the countries, the budgets). "countries" are two-letter codes the launch targets, for example ["KE"] or ["NG"]; take them from the BOSS or from the product's target_countries or from the winning campaign for that product, and leave the list empty only if nobody said. If the BOSS asked for nothing to be launched, return an empty launch_plan. Use only products from the briefing. Max 5 creative_briefs. Only use product claims the briefing allows (approved_claims when claims_verified is true, otherwise none).\n\nBRIEFING:\n${briefing.slice(0, 20000)}` , `Meeting transcript:\n${transcript}`);
  try { return JSON.parse(raw); } catch { return { summary: raw.slice(0, 600) }; }
}

async function finishLive(meetingId: string, companyId: string) {
  // Claim the ending first so it happens once; the meeting shows as finished right away and the written decision follows.
  const { data: got } = await db.from("ai_meetings").update({ status: "done", ended_at: new Date().toISOString() }).eq("id", meetingId).eq("status", "running").select("topic, briefing, images");
  if (!got?.length) return;
  try {
    await db.from("ai_meetings").update({ responding_since: null }).eq("id", meetingId);
    const briefing = String(got[0].briefing ?? "");
    const m = { topic: String(got[0].topic ?? ""), briefing, images: [] as { url: string; label: string }[], verified: false };
    await liveTurn(meetingId, companyId, "team_lead", "The meeting is ending. Close it in two short sentences: thank the BOSS and say what the team agreed to do, or that nothing is decided yet. Say the written decision is being prepared.", m);
    const decision = await makeDecision(meetingId, briefing);
    await db.from("ai_meetings").update({ decision }).eq("id", meetingId);
  } catch (e) {
    await db.from("ai_meetings").update({ error: String((e as Error)?.message ?? e).slice(0, 300) }).eq("id", meetingId);
  }
}


// ============================ AUTOPILOT: product in, a launch ready for the owner's tap out ============================
// One run walks a product through research -> sales page -> tracking -> ads -> campaign plan, then WAITS for the owner to approve.
// Nothing is published, launched or paid for before that tap. After approval the launch is scheduled for midnight with a hard stop
// (its end date is set so the total can never pass the stop amount). Everything reuses the AI Team machinery above (meeting, images, launches).
const COUNTRY_CUR: Record<string, string> = { NG: "NGN", KE: "KES", GH: "GHS", ZA: "ZAR", UG: "UGX", TZ: "TZS", US: "USD", GB: "GBP", CA: "CAD", AE: "AED" };
const AP_STEPS: [string, string][] = [["research", "Research the product"], ["page", "Sales page"], ["tracking", "Pixel and thank-you page"], ["creatives", "Make the ads"], ["plan", "Plan campaign and audience"], ["launch", "Launch at midnight"], ["watch", "Watch and adjust"], ["learn", "Learn and loop"]];
type ApStep = { key: string; label: string; state: "wait" | "now" | "done" | "needs_you" | "failed"; note?: string; at?: string };
const apFresh = (): ApStep[] => AP_STEPS.map(([key, label]) => ({ key, label, state: "wait" as const }));
const apParse = (raw: string): Record<string, unknown> => { try { return JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : {}; } catch { return {}; } } };

async function apSet(id: string, key: string, state: ApStep["state"], note: string, patch: Record<string, unknown> = {}) {
  const { data: r } = await db.from("autopilot_runs").select("steps").eq("id", id).maybeSingle();
  const steps = ((r?.steps ?? apFresh()) as ApStep[]).map((s) => (s.key === key ? { ...s, state, note: note.slice(0, 300), at: new Date().toISOString() } : s));
  await db.from("autopilot_runs").update({ steps, step: key, updated_at: new Date().toISOString(), ...patch }).eq("id", id);
}

// What the team says it is doing, step by step, in its own names (Ada leads, Zara makes pictures, Tobi buys media, Ife watches orders).
async function apLog(id: string, who: "Ada" | "Zara" | "Tobi" | "Ife", text: string) {
  const { data: r } = await db.from("autopilot_runs").select("log").eq("id", id).maybeSingle();
  const log = [...((r?.log ?? []) as unknown[]), { t: new Date().toISOString(), who, text: text.slice(0, 320) }].slice(-80);
  await db.from("autopilot_runs").update({ log }).eq("id", id);
}
const SYMBOL: Record<string, string> = { NGN: "₦", KES: "KSh ", GHS: "GH₵", ZAR: "R", UGX: "USh ", TZS: "TSh ", USD: "$", GBP: "£", CAD: "CA$", AED: "AED " };
const moneyText = (n: number, cur: string) => `${SYMBOL[cur] ?? cur + " "}${Math.round(n).toLocaleString("en-US")}`;
const packsOf = (label: string) => { const t = String(label).toLowerCase(); const m = t.match(/buy\s*(\d+).*?get\s*(\d+)/); if (m) return Number(m[1]) + Number(m[2]); const pl = t.match(/(\d+)\s*\+\s*(\d+)/); if (pl) return Math.min(Number(pl[1]) + Number(pl[2]), 8); const n = t.match(/(\d+)/); return n ? Math.min(Number(n[1]), 6) : 1; };

// Reads the text that actually came out in a picture, so a wrong price or a garbled label is caught before it is used.
async function apReadText(url: string): Promise<string> {
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${OPENAI}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 200, messages: [{ role: "user", content: [{ type: "text", text: "List every word and number written in this picture, exactly as written, separated by ' | '. Nothing else." }, { type: "image_url", image_url: { url } }] }] }) });
    const j = await r.json().catch(() => ({})); return String(j?.choices?.[0]?.message?.content ?? "");
  } catch { return ""; }
}
// Makes one picture for the sales page and keeps it in the vault; returns its public address.
async function apMakeImage(run: Record<string, any>, name: string, prompt: string, opts: { refs?: string[]; size?: string; expect?: string[] } = {}): Promise<string | null> {
  for (let attempt = 0; attempt < (opts.expect?.length ? 2 : 1); attempt++) {
    const r = await openaiImage(prompt, { refs: opts.refs, size: opts.size });
    if (!r.bytes) continue;
    // The page builder only accepts pictures stored on Supabase itself, so these go to Supabase Storage directly (not through the R2 switch).
    const path = `autopilot/${run.company_id}/${run.id}/${name}-${attempt}.png`;
    const up = await createClient(SUPABASE_URL, SERVICE).storage.from("creative-vault").upload(path, r.bytes, { contentType: "image/png", upsert: true });
    if (up.error) continue;
    const url = `${SUPABASE_URL}/storage/v1/object/public/creative-vault/${path}`;
    if (!opts.expect?.length) return url;
    const read = (await apReadText(url)).toLowerCase().replace(/[\s,]/g, "");
    if (opts.expect.every((e) => read.includes(e.toLowerCase().replace(/[\s,]/g, "")))) return url;
  }
  return null;
}

// the facts the page and ads may use: only what the owner entered about the product
async function apProduct(productId: string, companyId: string) {
  const { data: p } = await db.from("products").select("id, product_name, description, benefits, safety_notes, ai_approved_claims, notes, payment_note, default_order_value_naira, currency, target_countries, landing_page_url, destination_type, ad_account_id, product_image_url, nafdac_reg_no, is_active, company_id").eq("id", productId).eq("company_id", companyId).maybeSingle();
  if (!p) return null;
  const { data: tiers } = await db.from("product_tiers").select("label, price_naira, features, image_url").eq("product_id", p.id).eq("is_active", true).order("sort_order", { ascending: true });
  return { ...p, tiers: tiers ?? [] };
}

// Calls a tool of the ad assistant (mcp-ads) as the owner who started the run.
async function apTool(run: Record<string, unknown>, tool: string, args: Record<string, unknown>) {
  const token = await mintToken(String(run.created_by ?? "")); if (!token) return { error: "could not sign in as the owner" };
  const { data: prof } = await db.from("profiles").select("role").eq("id", String(run.created_by)).maybeSingle();
  const ctx = { token, userId: run.created_by, email: null, companyId: run.company_id, role: prof?.role ?? "", mediaBuyerId: null, displayName: "" };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mcp-ads`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": SERVICE }, body: JSON.stringify({ action: "call", tool, args, ctx }) });
  const o = await r.json().catch(() => ({})); return o?.out ?? o;
}
async function apCode(run: Record<string, any>, tool: string, args: Record<string, unknown>) {
  const token = await mintToken(String(run.created_by ?? "")); if (!token) return { error: "could not sign in as the owner" };
  const { data: prof } = await db.from("profiles").select("role, media_buyer_id, display_name").eq("id", String(run.created_by)).maybeSingle();
  const ctx = { token, userId: run.created_by, email: null, companyId: run.company_id, role: prof?.role ?? "", mediaBuyerId: prof?.media_buyer_id ?? null, displayName: prof?.display_name ?? "" };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mcp-code`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": SERVICE }, body: JSON.stringify({ action: "call", tool, args, ctx }) });
  const o = await r.json().catch(() => ({})); return (o?.out ?? o) as Record<string, unknown>;
}
async function apBuilder(run: Record<string, unknown>, body: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-site-builder`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": SERVICE }, body: JSON.stringify({ ...body, company_id: run.company_id, user_id: run.created_by }) });
  const o = await r.json().catch(() => ({})); return { ok: r.ok, ...o } as Record<string, unknown>;
}

// ============ THE SELLER'S OWN PAGE FOR THIS PRODUCT ============
// If the product already has a page (an address the seller set, a live Revora site, or a draft site), the team never builds another one.
// It reads that page now (never changes it) and writes the ads, the video scripts and the ad copy so they echo the page.
const blockedHost = (h: string) => /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\])/i.test(h) || !/\./.test(h);
function apPageFacts(html: string) {
  const clean = String(html ?? "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const txt = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
  const title = txt((clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? "");
  const headings = [...clean.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => txt(m[2])).filter(Boolean).slice(0, 40);
  const buttons = [...new Set([...clean.matchAll(/<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)].map((m) => txt(m[1])).filter((t) => t.length > 2 && t.length < 60 && /order|buy|get|add to cart|shop|claim|click|pay|book/i.test(t)))].slice(0, 12);
  const prices = [...new Set([...clean.matchAll(/(?:₦|NGN|KSh|KES|GH₵|GHS|USh|TSh|\$|USD|£)\s?[\d][\d,]*/g)].map((m) => m[0].replace(/\s+/g, "")))].slice(0, 12);
  const text = txt(clean).slice(0, 7000);
  return { title, headings, buttons, prices, text, images: (clean.match(/<img\b/gi) ?? []).length, has_form: /data-rv-form|<form\b|<iframe/i.test(clean) };
}
async function apOwnPage(run: Record<string, any>, prod: Record<string, any>): Promise<null | { kind: "external" | "live" | "draft"; url: string; site_id?: string; title: string; headings: string[]; buttons: string[]; prices: string[]; text: string; images: number; has_form: boolean }> {
  const url = String(prod.landing_page_url ?? "").trim();
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url); if (blockedHost(u.hostname)) return null;
      const r = await fetch(u.toString(), { headers: { "User-Agent": "Mozilla/5.0 (compatible; RevoraAutopilot/1.0)" }, signal: AbortSignal.timeout(12_000), redirect: "follow" });
      if (r.ok) return { kind: "external", url, ...apPageFacts((await r.text()).slice(0, 400_000)) };
    } catch (_) { /* fall through to the product's own site */ }
  }
  const { data: sites } = await db.from("sites").select("id, status, created_at").eq("product_id", prod.id).order("created_at", { ascending: false }).limit(5);
  const s = (sites ?? []).find((x: any) => x.status === "published") ?? (sites ?? [])[0];
  if (!s) return url ? { kind: "external", url, title: "", headings: [], buttons: [], prices: [], text: "", images: 0, has_form: false } : null;
  const { data: pg } = await db.from("site_pages").select("html").eq("site_id", s.id).eq("slug", "").maybeSingle();
  if (!pg?.html) return null;
  const links = await apCode(run, "site_list_files", { site_id: s.id }).catch(() => ({} as Record<string, unknown>));
  const test = String((links as any).test_link ?? ""), live = String((links as any).live_link || test.split("?")[0]);
  return { kind: s.status === "published" ? "live" : "draft", url: s.status === "published" ? live : test, site_id: s.id, ...apPageFacts(pg.html) };
}
// Video scripts written from the seller's page, so the ad and the page say the same thing.
async function apScripts(run: Record<string, any>, prod: Record<string, any>, rs: Record<string, any>, own: Awaited<ReturnType<typeof apOwnPage>>) {
  const raw = await decideJson(`You write short video-ad scripts for a direct-response seller. Return ONLY JSON {"scripts":[{"title":string,"length_s":number,"scenes":[{"t":"0-3","shows":string,"voiceover":string,"on_screen_text":string}],"cta":string}]}. Write 2 scripts, 30 to 45 seconds each, for shoppers in ${run.market_countries.join(", ")}. Scene 1 is a hook that stops the scroll and names the problem. Use the SAME promise, offer, price and wording style as the seller's page so the ad and the page feel like one. Use ONLY facts from PRODUCT and PAGE: never invent claims, numbers, prices, testimonials or guarantees; no medical cures. Plain, direct words.`, `PRODUCT:\n${JSON.stringify({ name: prod.product_name, description: prod.description, benefits: prod.benefits, packages: prod.tiers }).slice(0, 3000)}\n\nPAGE (the seller's own):\n${JSON.stringify(own ? { headings: own.headings, prices: own.prices, buttons: own.buttons, text: own.text.slice(0, 3500) } : { note: "no page text; use research" }).slice(0, 5000)}\n\nRESEARCH:\n${JSON.stringify({ fears: rs.fears, problem_story: rs.problem_story, offer: rs.offer, hooks: rs.hooks }).slice(0, 2500)}`);
  const o = apParse(raw) as { scripts?: unknown[] };
  return (Array.isArray(o.scripts) ? o.scripts : []).slice(0, 2);
}

// 1. RESEARCH: the product, what already wins in this business, the sales pages it has read (screenshots, in order), and what to say.
async function apResearch(run: Record<string, any>) {
  const prod = await apProduct(run.product_id, run.company_id); if (!prod) throw new Error("The product is gone.");
  // The team never guesses what a product is. Without a description or benefits it would borrow from the other products' pages, so it stops and asks.
  const ownPage = await apOwnPage(run, prod);
  if (!String(prod.description ?? "").trim() && !String(prod.benefits ?? "").trim() && !String(prod.ai_approved_claims ?? "").trim() && !(ownPage && ownPage.text.length > 400)) {
    await apLog(run.id, "Ada", `I do not know what ${prod.product_name} is for yet, so I will not guess. Tell me in the Catalog what it is, who it is for and what it does (description and benefits), then tap Try again.`);
    throw new Error(`NEEDS: ${prod.product_name} has no description or benefits. Add what it is, who it is for and what it does in the Catalog, then tap Try again.`);
  }
  if (ownPage) await apLog(run.id, "Ada", `${prod.product_name} already has a page (${ownPage.kind === "draft" ? "a draft on Revora" : ownPage.kind === "live" ? "live on Revora" : "your own address"}). I read it: ${ownPage.headings.length} headings, ${ownPage.prices.length} prices, ${ownPage.buttons.length} order buttons. I will not build another page, and the ads and scripts will echo this one.`);
  await apLog(run.id, "Ada", "I am reading your winning ads and the sales pages we have seen, top to bottom, to plan what to say first.");
  const x = await extraBriefing(run.company_id);
  const { data: pg0 } = await db.from("learn_pages").select("url_norm, title, vision, blocks, text, word_count").contains("company_ids", [run.company_id]).eq("status", "ok").gte("word_count", 700).limit(60);
  const { data: lp0 } = await db.from("products").select("landing_page_url").eq("company_id", run.company_id).not("landing_page_url", "is", null);
  const trn = (u: string) => String(u ?? "").replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  const own = new Set((lp0 ?? []).map((x: any) => trn(x.landing_page_url)));
  const pages = (pg0 ?? []).filter((x: any) => !/metaautomationads|revoracrm|outreachhq\.xyz\/?$|\/order|thank|checkout/i.test(x.url_norm)).sort((a: any, b: any) => Number(own.has(trn(b.url_norm))) - Number(own.has(trn(a.url_norm))) || Number(!!b.vision) - Number(!!a.vision) || Number(b.word_count) - Number(a.word_count)).slice(0, 4);
  const read = pages.map((p: any) => ({ page: p.url_norm, title: p.title, section_headings_in_order: ((p.blocks ?? []) as { t: string; x: string }[]).filter((b) => /^h[1-3]$/.test(b.t)).slice(0, 40).map((b) => b.x), opening_text: String(p.text ?? "").slice(0, 1500), sections_seen_in_screenshots: (p.vision?.sections ?? p.vision?.structure ?? []).slice(0, 25), offer: p.vision?.offer, proof: p.vision?.social_proof, hooks: (p.vision?.hooks ?? []).slice(0, 8) }));
  const sys = `You are the research lead of an AI media-buying team. A direct-response seller in ${run.market_countries.join(", ")} will sell ONE product with paid Facebook and Instagram ads and a sales page. Study the product and what already sells for this business, then write the plan the page and the ads will follow. Return ONLY JSON:
{"audience":"who buys and why, in plain words","fears":["the fears or pains, in the customer's own words"],"problem_story":"3-4 sentences: the story of the problem a buyer lives with, then what made them look for a fix","solution":"how this product answers it, using ONLY the product facts","proof_available":["proof the seller really has (from the product facts or the pages read)"],"proof_missing":["proof the page needs but the seller has not given (real testimonials, photos, certificates). Never invent any"],"objections":["why a buyer hesitates"],"offer":"the offer to put forward, only from the product facts (price, packages, delivery, payment on delivery, guarantee)","hooks":["5 ad hooks, each one line, aggressive but true"],"angles":["3 ad angles"],"blueprint":[{"role":"one of: hook, fear, problem_story, solution, product, how_it_works, benefits, testimonials, assurance, offer_cards, faq, order_form","goal":"what this section must do for the buyer","guidance":"what to say, using only real facts"}],"offer_card_look":"how the best pages in PAGES_READ show their package or offer cards: what the picture shows (how many packs), how the price and the label are written, any badge like Best value. Say plainly if no page was read","page_summary":"only when OWN_PAGE is given: {headline, promise, offer, price_points[], proof_on_page[], tone, look}, taken ONLY from OWN_PAGE","niche":"health|beauty|fashion|food|gadgets|home|general"}
HARD RULES: use ONLY facts in PRODUCT. Never invent prices, claims, numbers, testimonials, certificates or guarantees. No medical cures or guaranteed results; for health products describe support in careful words and keep to ai_approved_claims when they exist. The blueprint order follows how the best pages in PAGES_READ are built (fear, then the problem story, then the solution, then proof, then assurance, then offer cards, then the order form); when no page was read, use that order. When OWN_PAGE is given it is the seller's real page for THIS product: its facts, promise, offer, prices and look are the source of truth next to PRODUCT, the blueprint describes that page as it is, and you do not plan a new page. PAGES_READ are mostly OTHER products. They show STRUCTURE and order only: never copy a number, claim, promise, condition or audience from them, and never take this product's subject from them. What this product is, who it is for and what it does come ONLY from PRODUCT; if PRODUCT does not say, put it in proof_missing and do not guess. The page text is for shoppers in ${run.market_countries.join(", ")}: their words, their currency (${run.market_currency}).`;
  const raw = await decideJson(sys, `PRODUCT:\n${JSON.stringify(prod).slice(0, 5000)}\n\nOWN_PAGE (the seller's real page for this product; read-only):\n${ownPage ? JSON.stringify({ title: ownPage.title, headings: ownPage.headings, buttons: ownPage.buttons, prices: ownPage.prices, text: ownPage.text.slice(0, 4500) }).slice(0, 7000) : "none"}\n\nWHAT ALREADY WINS (this business):\n${JSON.stringify({ winning_ads: x.winning_ads_the_learner_saw ?? [], winning_video_anatomy: x.winning_video_anatomy ?? [], lessons: x.lessons_learned ?? [] }).slice(0, 9000)}\n\nPAGES_READ (the seller's own pages: headings in page order, opening text, and what the screenshots showed):\n${JSON.stringify(read).slice(0, 9000)}`);
  const research = apParse(raw);
  if (!Array.isArray(research.blueprint) || !research.blueprint.length) throw new Error("The research did not come back in a usable shape. It will be tried again.");
  if (ownPage) research.own_page = { kind: ownPage.kind, url: ownPage.url, title: ownPage.title };
  const hooks = Array.isArray(research.hooks) ? research.hooks.length : 0;
  await apLog(run.id, "Ada", `Found it. Who buys: ${String(research.audience ?? "").slice(0, 140)}. The page will go: ${(research.blueprint as any[]).map((b) => b.role).join(", ")}.`);
  await apLog(run.id, "Ada", `Strongest hook so far: "${String((research.hooks as string[] | undefined)?.[0] ?? "").slice(0, 140)}".`);
  await apSet(run.id, "research", "done", `Read ${(pages ?? []).length} sales page${(pages ?? []).length === 1 ? "" : "s"} and ${((x.winning_ads_the_learner_saw as unknown[]) ?? []).length} winning ad${((x.winning_ads_the_learner_saw as unknown[]) ?? []).length === 1 ? "" : "s"}. ${hooks} hooks, ${(research.blueprint as unknown[]).length} sections planned.`, { research });
}

// 2. SALES PAGE: the owner's own page when there is one (read it, never change it); otherwise a draft built from the blueprint.
async function apPage(run: Record<string, any>): Promise<"wait" | void> {
  const prod = await apProduct(run.product_id, run.company_id); if (!prod) throw new Error("The product is gone.");
  const rs = (run.research ?? {}) as Record<string, any>;
  const own = await apOwnPage(run, prod);
  if (own) {
    await apLog(run.id, "Ada", `You already have a sales page for this product, so I will not build another one. I am checking it against the plan and I will only suggest improvements.`);
    let review: Record<string, unknown> = { read: own.text.length > 200 };
    if (own.text.length > 200) {
      const raw = await decideJson(`You review a seller's EXISTING sales page against the plan for it. Return ONLY JSON {"covers":[roles],"missing":[roles],"order_problems":[string],"suggestions":[string],"keep":[string]}. Roles come from: hook, fear, problem_story, solution, product, how_it_works, benefits, testimonials, assurance, offer_cards, faq, order_form. Be specific and short. These are OPTIONAL improvements for the owner to decide: only list what would clearly raise orders, never rewrite the page, and never suggest claims that are not in the product facts.`, `PLAN:\n${JSON.stringify(rs.blueprint ?? []).slice(0, 3000)}\n\nTHEIR PAGE:\n${JSON.stringify({ title: own.title, headings: own.headings, buttons: own.buttons, prices: own.prices, has_order_form: own.has_form, text: own.text.slice(0, 4500) }).slice(0, 7000)}`);
      review = { read: true, ...apParse(raw) };
    }
    const miss = Array.isArray((review as any).missing) ? (review as any).missing.length : 0, sug = Array.isArray((review as any).suggestions) ? (review as any).suggestions.length : 0;
    await apLog(run.id, "Ada", review.read ? `Your page is read. ${sug ? `${sug} optional improvement${sug === 1 ? "" : "s"} for you to decide on.` : "I would not change anything."} Nothing on it was changed.` : "I could not read much text on your page, so I will work from the product facts.");
    await apSet(run.id, "page", "done", review.read ? `Using your page (${own.kind === "external" ? "your own address" : own.kind === "live" ? "live on Revora" : "a draft on Revora"}). ${miss ? `It is missing: ${(review as any).missing.join(", ")}. ` : ""}${sug ? `${sug} optional improvement${sug === 1 ? "" : "s"}. ` : ""}Nothing on it was changed.` : "Using your page. Not much text could be read from it; nothing on it was changed.", { page: { mode: "existing", url: own.url, kind: own.kind, site_id: own.site_id ?? null, live_link: own.kind === "draft" ? own.url.split("?")[0] : own.url, publish_on_approval: own.kind === "draft", review, summary: rs.page_summary ?? null, prices: own.prices, buttons: own.buttons } });
    return;
  }
  // BUILD: a real file-based site (index.html, thanks.html, styles.css, scripts.js), written like the seller's own best pages.
  await apLog(run.id, "Ada", "There is no sales page for this product yet. I am going to write one as real HTML files, the way your best pages are built.");
  const photo = prod.product_image_url ? [String(prod.product_image_url)] : [];
  const cur = String(prod.currency ?? run.billing_currency ?? "NGN").toUpperCase();
  let img: Record<string, string> = {}, tierImgs: Record<string, string> = {};
  if ((run.page as any)?.mode === "drafting") { img = (run.page as any).img ?? {}; tierImgs = (run.page as any).tierImgs ?? {}; }
  else {
  // PHASE 1: Zara's pictures, made from the real product photo when there is one (stored on Supabase: the only place a site may take pictures from)
  await apLog(run.id, "Zara", photo.length ? "I have your product photo, so every picture shows the real pack." : "There is no product photo yet, so I will draw the pack from its description. Add a photo in the Catalog and I will redo them with the real pack.");
  const look = String(rs.offer_card_look ?? "").slice(0, 400);
  const scene = `${prod.product_name}, for shoppers in ${run.market_countries.join(", ")}`;
  const jobs: Promise<void>[] = [
    apMakeImage(run, "hero", `Wide, bright hero picture for a sales page: the real product pack in an appealing everyday setting for ${scene}. Warm natural light, uncluttered, no words, no logos other than the pack's own.`, { refs: photo, size: "1536x1024" }).then((u) => { if (u) img.hero = u; }),
    apMakeImage(run, "problem", `Realistic photo of an ordinary adult in ${run.market_countries.join(", ")} having a worried, tired moment at home, related to this: ${String((rs.fears ?? [])[0] ?? "the problem the product helps with")}. No medical equipment, no body parts exposed, no text, no before and after.`, { size: "1536x1024" }).then((u) => { if (u) img.problem = u; }),
    apMakeImage(run, "product", `Clean product shot for a sales page: the real pack on a simple surface with a few natural ingredient props. No words other than the pack's own.`, { refs: photo }).then((u) => { if (u) img.product = u; }),
  ];
  for (const [k, t] of (prod.tiers ?? []).slice(0, 4).entries()) {
    if (t.image_url) { tierImgs[String(t.label)] = String(t.image_url); continue; } // the seller's own card picture stays
    const n = packsOf(String(t.label)), price = moneyText(Number(t.price_naira), cur);
    jobs.push(apMakeImage(run, `offer-${k}`, `Offer card picture: ${n} ${n === 1 ? "pack" : "packs"} of the real product arranged neatly side by side on a clean light background. Write exactly two things on the picture: the label "${String(t.label).slice(0, 40)}" and the price "${price}", large and easy to read. No other words. Style the card like the winners: ${look || "clear pack count, big price, a simple badge"}.`, { refs: photo, expect: [price.replace(/[^0-9]/g, "")] }).then((u) => { if (u) tierImgs[String(t.label)] = u; }));
  }
  await apLog(run.id, "Zara", `Making ${jobs.length} pictures for the page: the hero, the problem moment, the product, and an offer card for each package with its price.`);
  await Promise.all(jobs);
  for (const t of (prod.tiers ?? [])) if (tierImgs[String(t.label)] && !t.image_url) await db.from("product_tiers").update({ image_url: tierImgs[String(t.label)] }).eq("product_id", prod.id).eq("label", t.label).is("image_url", null);
  const cardsMade = (prod.tiers ?? []).slice(0, 4).filter((t: any) => tierImgs[String(t.label)]).length;
  await apLog(run.id, "Zara", `Pictures done: ${["hero", "problem", "product"].filter((k) => img[k]).join(", ") || "none of the scene pictures"}, and ${cardsMade} of ${(prod.tiers ?? []).slice(0, 4).length} offer cards${cardsMade < (prod.tiers ?? []).slice(0, 4).length ? " (a price that would not come out right was left out)" : " with the price checked"}.`);
  await db.from("autopilot_runs").update({ page: { mode: "drafting", img, tierImgs } }).eq("id", run.id);
  return "wait"; // the page itself is written on the next pass, so no single pass runs too long
  }
  // PHASE 2: the seller's own best pages, read in full
  const ex = await apExamples(run);
  await apLog(run.id, "Ada", ex.pages.length ? `I read ${ex.pages.length} of your own pages in full: ${ex.pages.map((e) => e.host).join(", ")}. I will copy how they are laid out and how they push to order, not their words.` : "I found no sales pages of yours to learn from, so I will follow the standard sequence only.");
  // 3) the site and its files
  const made = await apCode(run, "site_new", { product_name: prod.product_name, title: `${prod.product_name} sales page`, business_name: prod.product_name });
  if ((made as any).error || !(made as any).site_id) throw new Error(String((made as any).error ?? "The site could not be started."));
  const siteId = String((made as any).site_id), conv = (((made as any).conventions ?? []) as string[]).join("\n- ");
  const versions: Record<string, number> = {}; for (const f of ((made as any).files ?? []) as { path: string; version: number }[]) versions[f.path] = f.version;
  const pkgs = ((made as any).packages ?? []) as { number: number; label: string; price_naira: number }[];
  await apLog(run.id, "Ada", "Writing the page now: index.html, styles.css and scripts.js. The thank-you page stays the standard one that marks each sale.");
  const sys = `You are a senior direct-response web developer and copywriter. Write the files of ONE mobile-first sales page as pure HTML, CSS and JS. Return ONLY JSON {"files":{"index.html":"...","styles.css":"...","scripts.js":"..."}}.
This site's rules (follow them exactly):\n- ${conv}
YOUR JOB: the page must grab attention in the first screen, then follow the sequence of the seller's own best pages in EXAMPLES: the same order of sections, the same density of order buttons, the same kind of hooks, the same look (colours, type, spacing). Copy the STRUCTURE and the STYLE, never their sentences, numbers, claims, health conditions or audience: the examples are other products, and what THIS product is and does comes only from PRODUCT.
SECTION PLAN (from research, in this order): ${JSON.stringify(rs.blueprint ?? []).slice(0, 2500)}
HARD RULES: use ONLY facts in PRODUCT (never invent prices, numbers, claims, testimonials, names, certificates, guarantees); leave out a section you have no real content for. No medical cures or guaranteed results. Every order button is <a href="#order" data-rv-tier="N"> (N = package number) or plain href="#order"; the order form is <section id="order"><div data-rv-form="1"></div></section> placed near the end. The big hook is a large bold header that names the problem and the fear of ignoring it, with a short body under it; never put text over a background picture. Pictures: ONLY the Revora links in PICTURES (use each where it fits), nothing from other sites. Prices are written in ${cur}. Write for shoppers in ${run.market_countries.join(", ")} in plain, direct words.`;
  const userText = `PRODUCT:\n${JSON.stringify({ name: prod.product_name, description: prod.description, benefits: prod.benefits, safety_notes: prod.safety_notes, approved_claims: prod.ai_approved_claims, notes: prod.notes, payment: prod.payment_note, nafdac: prod.nafdac_reg_no, packages: pkgs, currency: cur }).slice(0, 4500)}\n\nRESEARCH:\n${JSON.stringify({ audience: rs.audience, fears: rs.fears, problem_story: rs.problem_story, solution: rs.solution, objections: rs.objections, offer: rs.offer, hooks: rs.hooks, proof_available: rs.proof_available }).slice(0, 4500)}\n\nPICTURES (Revora links you may use):\n${JSON.stringify({ product_photo: prod.product_image_url ?? null, hero: img.hero ?? null, problem: img.problem ?? null, product: img.product ?? null, offer_cards: tierImgs })}\n\nEXAMPLES (the seller's own pages, source trimmed):\n${ex.pages.map((e, i) => `--- EXAMPLE ${i + 1}: ${e.url}\n${e.html}`).join("\n\n").slice(0, 60000)}`;
  let files = await apWriteFiles(sys, userText, ex.shots);
  const order = ["index.html", "styles.css", "scripts.js"];
  const saved: string[] = [], errs: string[] = [];
  const fix = (html: string) => { let h = html; if (!/data-rv-form/.test(h)) h = h.replace(/<\/body>/i, `<section id="order"><div data-rv-form="1"></div></section>\n</body>`); if (!/href="#order"/.test(h)) h = h.replace(/<\/body>/i, `<a href="#order" style="position:fixed;left:12px;right:12px;bottom:12px;z-index:50;text-align:center;padding:14px;border-radius:12px;background:#d4213d;color:#fff;font-weight:800;text-decoration:none">ORDER NOW</a>\n</body>`); return h; };
  for (let round = 0; round < 2; round++) {
    errs.length = 0;
    for (const path of order) {
      let content = String(files[path] ?? "").trim(); if (!content) continue;
      if (path === "index.html") content = fix(content);
      const w = await apCode(run, "site_write_file", { site_id: siteId, path, content, if_version: versions[path] ?? 1 });
      if ((w as any).error) errs.push(`${path}: ${String((w as any).error).slice(0, 300)}`); else { saved.push(path); if ((w as any).version) versions[path] = Number((w as any).version); }
    }
    if (!errs.length) break;
    await apLog(run.id, "Ada", `The site refused part of my files (${errs[0].slice(0, 160)}). I am fixing it.`);
    files = await apWriteFiles(sys + "\nThe site refused some files. Fix exactly these problems and return ALL the files again:\n" + errs.join("\n"), userText, ex.shots);
  }
  if (!saved.includes("index.html")) throw new Error(`The page was refused: ${errs.join(" | ").slice(0, 220)}`);
  const last = await apCode(run, "site_list_files", { site_id: siteId });
  const test = String((last as any).test_link ?? (made as any).test_link ?? ""), live = String((last as any).live_link || test.split("?")[0]);
  // 4) does the page load, and is the order form on it?
  let check = "I could not open the page to check it.";
  try { const r = await fetch(test, { headers: { "User-Agent": "RevoraAutopilot/1.0" } }); const t = await r.text(); check = r.ok ? (/data-rv-form|rv\/form\.js|rv-form/i.test(t) ? "The page loads and the order form is on it." : "The page loads, but I could not see the order form in it.") : `The page answered ${r.status}.`; } catch (_) { /* the check is a bonus */ }
  await apLog(run.id, "Tobi", check);
  await apLog(run.id, "Ada", `Page written: ${saved.join(", ")}. It stays a draft until you approve.`);
  const gaps = [...((rs.proof_missing ?? []) as string[]).slice(0, 4).map((s) => `proof: ${s}`), ...(photo.length ? [] : ["picture: the real product photo"])];
  await apSet(run.id, "page", "done", `Wrote a file-based page (${saved.join(", ")}) from ${ex.pages.length} of your own pages. It goes live only when you approve.${gaps.length ? ` Still needs: ${gaps.slice(0, 3).join("; ")}.` : ""}`, { page: { mode: "files", site_id: siteId, live_link: live, test_link: test, files: saved, examples: ex.pages.map((e) => e.url), gaps, check } });
}

// The seller's own sales pages, read in full (live HTML, trimmed) plus a few screenshots of the best one.
async function apExamples(run: Record<string, any>): Promise<{ pages: { url: string; host: string; html: string }[]; shots: { b64: string; type: string }[] }> {
  const { data: pgs } = await db.from("learn_pages").select("url_norm, word_count, shots, vision").contains("company_ids", [run.company_id]).eq("status", "ok").gte("word_count", 700).limit(60);
  const { data: lp } = await db.from("products").select("landing_page_url").eq("company_id", run.company_id).not("landing_page_url", "is", null);
  const tr = (u: string) => String(u ?? "").replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  const mine = new Set((lp ?? []).map((x: any) => tr(x.landing_page_url)));
  const bad = /metaautomationads|revoracrm|outreachhq\.xyz\/?$|\/order|thank|checkout/i;
  const ranked = (pgs ?? []).filter((x: any) => !bad.test(x.url_norm)).sort((a: any, b: any) => Number(mine.has(tr(b.url_norm))) - Number(mine.has(tr(a.url_norm))) || Number(!!b.vision) - Number(!!a.vision) || Number(b.word_count) - Number(a.word_count)).slice(0, 3);
  const pages: { url: string; host: string; html: string }[] = [];
  for (const x of ranked) {
    try {
      const r = await fetch(x.url_norm, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RevoraLearner/1.0)" }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const html = (await r.text()).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<svg[\s\S]*?<\/svg>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/data:[a-z\/+-]+;base64,[A-Za-z0-9+\/=]+/g, "data:").replace(/\s+/g, " ").slice(0, 20000);
      pages.push({ url: x.url_norm, host: new URL(x.url_norm).hostname, html });
    } catch (_) { /* a page that does not open is skipped */ }
  }
  const shots: { b64: string; type: string }[] = [];
  const top = ranked.find((x: any) => Array.isArray(x.shots) && x.shots.length);
  for (const sh of ((top?.shots ?? []) as { path: string }[]).slice(0, 3)) {
    try { const { data: f } = await db.storage.from("learn-shots").download(sh.path); if (f) { const u = new Uint8Array(await f.arrayBuffer()); let bin = ""; for (let k = 0; k < u.length; k += 8192) bin += String.fromCharCode(...u.subarray(k, k + 8192)); shots.push({ b64: btoa(bin), type: "image/jpeg" }); } } catch (_) { /* optional */ }
  }
  return { pages, shots };
}
// The page writer: the strongest model this account has, tried in order.
async function apWriteFiles(system: string, userText: string, shots: { b64: string; type: string }[]): Promise<Record<string, string>> {
  const models = [Deno.env.get("AUTOPILOT_PAGE_MODEL") ?? "", "gpt-4.1", "gpt-4o"].filter(Boolean);
  const content: unknown[] = [{ type: "text", text: userText }, ...shots.map((s) => ({ type: "image_url", image_url: { url: `data:${s.type};base64,${s.b64}`, detail: "low" } }))];
  let lastErr = "";
  for (const model of models) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${OPENAI}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0.4, max_tokens: model === "gpt-4o" ? 15000 : 30000, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content }] }), signal: AbortSignal.timeout(170_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { lastErr = `${model}: ${j?.error?.message ?? r.status}`; if (/does not exist|not found|access|max_tokens/i.test(lastErr)) continue; throw new Error(lastErr.slice(0, 200)); }
    const o = apParse(String(j.choices?.[0]?.message?.content ?? "")) as { files?: Record<string, string> };
    if (o.files && typeof o.files["index.html"] === "string") return o.files;
    lastErr = `${model}: the answer had no index.html`;
  }
  throw new Error(`The page could not be written (${lastErr.slice(0, 160)}).`);
}

// 3. TRACKING: is the pixel firing, and does a sale get marked on the thank-you page?
async function apTracking(run: Record<string, any>) {
  await apLog(run.id, "Tobi", "I am checking that the pixel fires and that a sale will be counted on the thank-you page.");
  const out = await apTool(run, "check_pixel", { ad_account_id: run.ad_account_id }).catch(() => null);
  const verdict = String((out as any)?.verdict ?? (out as any)?.message ?? (out as any)?.error ?? "").slice(0, 200);
  const pg = (run.page ?? {}) as Record<string, any>;
  const thanks = pg.mode === "built" || pg.mode === "files" ? "The thank-you page is built with the page and marks each sale." : "On your own page, add Revora's thank-you script to your thank-you page so each sale is marked.";
  const fine = /fir|connect|ok|healthy|received/i.test(verdict) && !/not (connected|firing)|no pixel/i.test(verdict);
  await apSet(run.id, "tracking", "done", `${fine ? "" : "Needs a look: "}${verdict || "The pixel could not be checked right now."} ${thanks}`);
}

// 4. ADS: a meeting of the team on THIS product (with the research), then the images, then the approved images go to the vault.
async function apCreatives(run: Record<string, any>): Promise<"wait" | "continue"> {
  const prod = await apProduct(run.product_id, run.company_id); if (!prod) throw new Error("The product is gone.");
  const rs = (run.research ?? {}) as Record<string, any>;
  if (!run.meeting_id) {
    const topic = `Autopilot for ${prod.product_name} in ${run.market_countries.join(", ")}. Make the ads for this product only. Angle: ${String((rs.angles ?? [])[0] ?? "").slice(0, 200)}. Offer: ${String(rs.offer ?? "").slice(0, 300)}. Fears to speak to: ${(rs.fears ?? []).slice(0, 4).join("; ").slice(0, 300)}. Hooks to build on: ${(rs.hooks ?? []).slice(0, 5).join(" | ").slice(0, 600)}. Use only facts in the product data; no invented claims.${rs.page_summary ? ` The seller\'s page already says: headline "${String(rs.page_summary.headline ?? "").slice(0, 160)}", promise "${String(rs.page_summary.promise ?? "").slice(0, 200)}", offer "${String(rs.page_summary.offer ?? "").slice(0, 200)}", tone ${String(rs.page_summary.tone ?? "").slice(0, 80)}. The ad hooks, headlines, primary text and the images must echo THIS page (same promise, same offer, same price, same words) so the ad and the page feel like one.` : ""}`;
    const { data: busy } = await db.from("ai_meetings").select("id").eq("company_id", run.company_id).eq("status", "running").limit(1).maybeSingle();
    if (busy) { await apSet(run.id, "creatives", "now", "Waiting for another team meeting to finish."); return "wait"; }
    const { data: m, error } = await db.from("ai_meetings").insert({ company_id: run.company_id, topic, trigger: "autopilot", started_by: run.created_by }).select("id").single();
    if (error || !m) throw new Error(error?.message ?? "Could not start the team meeting.");
    await db.from("autopilot_runs").update({ meeting_id: m.id }).eq("id", run.id);
    await apLog(run.id, "Ada", "Team meeting started on this product only, with the research in front of us. Zara, Tobi and I are agreeing the angle and the ad briefs.");
    await apSet(run.id, "creatives", "now", "The team is meeting about this product.");
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil(runMeeting(m.id, run.company_id, topic, false, false, false));
    return "wait";
  }
  const { data: m } = await db.from("ai_meetings").select("id, status, decision, started_at, error").eq("id", run.meeting_id).maybeSingle();
  if (!m) throw new Error("The meeting is gone.");
  if (m.status === "running") { if (Date.now() - new Date(m.started_at).getTime() > 25 * 60_000) throw new Error("The meeting took too long."); return "wait"; }
  if (m.status === "failed") throw new Error(String(m.error ?? "The meeting failed.").slice(0, 200));
  const dec = (m.decision ?? {}) as Record<string, any>;
  if (!dec.autopilot) { // pin the decision to this product, this budget and this market (the owner's numbers win over the meeting's)
    const briefs = (Array.isArray(dec.creative_briefs) ? dec.creative_briefs : []).slice(0, 5).map((b: any, i: number) => ({ ...b, product: prod.product_name, _i: i }));
    const plan = [{ product: prod.product_name, daily_budget_naira: Number(run.daily_budget), countries: run.market_countries, creative_brief_index: 0, kill_rule: `Pause an ad that spends ${Math.round(Number(run.daily_budget) / 2)} ${run.billing_currency} with no sale.` }];
    await db.from("ai_meetings").update({ decision: { ...dec, creative_briefs: briefs, launch_plan: plan, autopilot: true } }).eq("id", m.id);
    if (!briefs.length) throw new Error("The team did not write any ad briefs.");
  }
  const { data: imgs } = await db.from("ai_team_images").select("*").eq("meeting_id", m.id);
  if (!imgs?.length) { const r = await makeImages(m.id, run.company_id); if (r.error) throw new Error(r.error); await apLog(run.id, "Zara", `Briefs agreed. I am making ${r.started} ad image${r.started === 1 ? "" : "s"} now, each with a hook on top, the pack in the middle and the order button below.`); await apSet(run.id, "creatives", "now", `Zara is making ${r.started} images.`); return "wait"; }
  for (const i of imgs) if (i.status === "generating" && Date.now() - new Date(i.updated_at).getTime() > 8 * 60_000) await db.from("ai_team_images").update({ status: "failed", error: "Timed out." }).eq("id", i.id);
  if (imgs.some((i: any) => i.status === "generating" && Date.now() - new Date(i.updated_at).getTime() <= 8 * 60_000)) return "wait";
  let n = 0; for (const i of imgs) if (i.status === "ready") { const r = await approveImage(i, run.company_id, run.created_by); if (!r.error) n++; }
  const total = n + imgs.filter((i: any) => i.status === "approved").length;
  if (!total) throw new Error("No image could be made.");
  await apLog(run.id, "Zara", `${total} ad image${total === 1 ? "" : "s"} done and saved to your vault.`);
  try {
    const own2 = await apOwnPage(run, prod);
    const scripts = await apScripts(run, prod, rs, own2);
    if (scripts.length) { const { data: cur } = await db.from("autopilot_runs").select("page").eq("id", run.id).maybeSingle(); await db.from("autopilot_runs").update({ page: { ...((cur?.page ?? {}) as Record<string, unknown>), scripts } }).eq("id", run.id); await apLog(run.id, "Zara", `I also wrote ${scripts.length} video script${scripts.length === 1 ? "" : "s"} from your page (30 to 45 seconds each). You can read them below and film them or hand them to a creator.`); }
  } catch (_) { /* scripts are a bonus: the images already carry the run */ }
  await apSet(run.id, "creatives", "done", `${total} image${total === 1 ? "" : "s"} ready, each with a hook on top, the pack in the middle and the order button below.`);
  return "continue";
}

// 5. PLAN: campaign, ad sets and audience, in the account's own currency, then wait for the owner.
async function apPlan(run: Record<string, any>) {
  const prod = await apProduct(run.product_id, run.company_id); if (!prod) throw new Error("The product is gone.");
  const pg = (run.page ?? {}) as Record<string, any>;
  if (!prod.landing_page_url && (pg.mode === "built" || pg.mode === "files" || (pg.mode === "existing" && pg.publish_on_approval)) && pg.live_link) { await db.from("products").update({ landing_page_url: pg.live_link }).eq("id", prod.id); await db.from("autopilot_runs").update({ page: { ...pg, set_landing: true } }).eq("id", run.id); }
  const r = await proposeLaunches(run.meeting_id, run.company_id, run.created_by);
  if ("error" in r) throw new Error(String(r.error));
  const l = (r.launches ?? []).find((x: any) => x?.status === "proposed") ?? null;
  if (!l) { const why = (r.launches ?? []).map((x: any) => x?.note).filter(Boolean)[0] ?? "The launch could not be planned."; await apSet(run.id, "plan", "needs_you", String(why), { status: "waiting" }); return; }
  const days = Math.max(1, Math.floor(Number(run.total_budget) / Math.max(1, Number(run.daily_budget))));
  await db.from("ai_launches").update({ run_days: days, currency: run.billing_currency }).eq("id", l.id);
  for (const a of ((l.ad_sets ?? []) as any[]).slice(0, 4)) await apLog(run.id, "Tobi", `Ad set "${a.label}": ages ${a.age_min}-${a.age_max}${a.gender && a.gender !== "all" ? ", " + a.gender : ""}${(a.interest_keywords ?? []).length ? ", interests " + a.interest_keywords.join(", ") : ", broad so Meta finds the buyers"}, ${moneyText(Number(a.budget_naira), run.billing_currency)} a day. ${String(a.why ?? "")}`.slice(0, 300));
  await apLog(run.id, "Tobi", `Plan ready: ${moneyText(Number(run.daily_budget), run.billing_currency)} a day for ${days} day${days === 1 ? "" : "s"}, ending by itself so the total stays under ${moneyText(Number(run.total_budget), run.billing_currency)}. I will not launch anything until you tap approve.`);
  await apSet(run.id, "plan", "needs_you", `${(l.ad_sets ?? []).length} ad set${(l.ad_sets ?? []).length === 1 ? "" : "s"} in ${(l.countries ?? run.market_countries).join(", ")}, ${run.daily_budget} ${run.billing_currency} a day for ${days} day${days === 1 ? "" : "s"}. Waiting for your tap.`, { launch_id: l.id, status: "waiting" });
  await apSet(run.id, "launch", "wait", "Starts at midnight once you approve.");
  await notify(run.company_id, "autopilot_ready", run.id, "Autopilot: ready for your tap", `${prod.product_name} is ready: research, page, ads and campaign plan. Open Autopilot to approve the launch. Nothing runs until you do.`);
}

// 6. AFTER APPROVAL: the page goes live, the launch is scheduled (with its end date), then the run watches.
async function apApprove(runId: string, ctx: Record<string, unknown>) {
  const { data: run } = await db.from("autopilot_runs").select("*").eq("id", runId).maybeSingle();
  if (!run || run.company_id !== ctx.companyId) return { error: "Run not found." };
  if (run.status !== "waiting" || !run.launch_id) return { error: "This run is not waiting for approval." };
  const pg = (run.page ?? {}) as Record<string, any>;
  await apLog(run.id, "Tobi", "Approved. " + (pg.mode === "built" || pg.mode === "files" ? "Putting the page live first, then scheduling the campaign." : "Scheduling the campaign."));
  if ((pg.mode === "files" || (pg.mode === "existing" && pg.publish_on_approval)) && pg.site_id) {
    const r2 = await fetch(`${SUPABASE_URL}/functions/v1/mcp-studio`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": SERVICE }, body: JSON.stringify({ action: "call", tool: "publish_sales_page", args: { site_id: pg.site_id, confirmed: true }, ctx }) });
    const o2 = await r2.json().catch(() => ({})); const out2 = (o2?.out ?? o2) as Record<string, unknown>;
    if (!r2.ok || out2.error) { await apSet(run.id, "launch", "failed", `The page could not go live: ${String(out2.error ?? r2.status).slice(0, 200)}`); return { error: String(out2.error ?? "The page could not go live.") }; }
  }
  if (pg.mode === "built" && pg.site_id) {
    const pub = await apBuilder(run, { mode: "page_publish", site_id: pg.site_id });
    if (!pub.ok || pub.error) { await apSet(run.id, "launch", "failed", `The page could not go live: ${String(pub.error ?? "").slice(0, 200)}`); return { error: String(pub.error ?? "The page could not go live.") }; }
  }
  const r = await approveLaunch(String(run.launch_id), ctx);
  if ("error" in r) { await apSet(run.id, "launch", "failed", String(r.error).slice(0, 250)); return r; }
  await apLog(run.id, "Tobi", "Scheduled on Meta for midnight. I will watch spend and sales and pause what wastes money.");
  await apSet(run.id, "plan", "done", "Approved by you.");
  await apSet(run.id, "launch", "done", `Scheduled on Meta for midnight${run.total_budget ? `, ends by itself so the total stays under ${run.total_budget} ${run.billing_currency}` : ""}.`, { status: "live" });
  await apSet(run.id, "watch", "now", "The team watches the numbers and pauses what wastes money.");
  return { ok: true };
}

async function apStart(b: Record<string, any>, userId: string, companyId: string) {
  if (b.launch_mode === "alone") return { error: "Launching without your tap is not available yet. Autopilot asks you first." };
  const prod = await apProduct(String(b.product_id ?? ""), companyId);
  if (!prod || !prod.is_active) return { error: "Choose one of your active products." };
  if (!prod.ad_account_id) return { error: "This product has no ad account yet. Assign one in the Catalog first." };
  const daily = Math.round(Number(b.daily_budget) || 0), total = Math.round(Number(b.total_budget) || 0);
  if (daily < 500) return { error: "Set a daily testing budget." };
  if (total < daily) return { error: "The hard stop must be at least one day of budget." };
  const { data: dup } = await db.from("autopilot_runs").select("id").eq("product_id", prod.id).in("status", ["running", "waiting", "live"]).limit(1).maybeSingle();
  if (dup) return { error: "This product already has an autopilot run.", run_id: dup.id };
  const { data: acct } = await db.from("ad_accounts").select("id, currency, status").eq("id", prod.ad_account_id).maybeSingle();
  if (!acct || String(acct.status ?? "active").toLowerCase() !== "active") return { error: "The product's ad account is not active." };
  const { data: co } = await db.from("companies").select("country, currency").eq("id", companyId).maybeSingle();
  const cc = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, 5);
  const markets = cc(b.countries).length ? cc(b.countries) : cc(prod.target_countries).length ? cc(prod.target_countries) : cc([co?.country]);
  if (!markets.length) return { error: "Which country does this product sell in? Set it in the Catalog (target countries) first." };
  const { data: team } = await db.from("ai_teams").select("daily_budget_cap_naira").eq("company_id", companyId).maybeSingle();
  if (Number(team?.daily_budget_cap_naira ?? 0) < daily) await db.from("ai_teams").upsert({ company_id: companyId, daily_budget_cap_naira: daily, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  const { data: run, error } = await db.from("autopilot_runs").insert({ company_id: companyId, product_id: prod.id, ad_account_id: acct.id, created_by: userId, market_countries: markets, billing_currency: acct.currency ?? "NGN", market_currency: COUNTRY_CUR[markets[0]] ?? null, daily_budget: daily, total_budget: total, steps: apFresh() }).select("*").single();
  if (error || !run) return { error: error?.message ?? "Could not start." };
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(apAdvance(run.id));
  return { ok: true, run };
}

// One pass of the state machine. Locked so two passes never work on the same run.
async function apAdvance(id: string) {
  const nowIso = new Date().toISOString();
  const { data: got } = await db.from("autopilot_runs").update({ lock_until: new Date(Date.now() + 4 * 60_000).toISOString() }).eq("id", id).in("status", ["running", "waiting", "live"]).or(`lock_until.is.null,lock_until.lt.${nowIso}`).select("*");
  if (!got?.length) return;
  let cur = "";
  try {
    for (let guard = 0; guard < 6; guard++) {
      const { data: run } = await db.from("autopilot_runs").select("*").eq("id", id).maybeSingle();
      if (!run || !["running", "waiting", "live"].includes(run.status)) break;
      const step = ((run.steps ?? []) as ApStep[]).find((s) => s.state !== "done");
      if (!step) { await db.from("autopilot_runs").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", id); break; }
      cur = step.key;
      if (step.state === "failed" || step.state === "needs_you") break;
      if (run.status === "live") { await apWatch(run); break; }
      if (step.key === "research") { await apSet(id, "research", "now", "Reading your winning ads and sales pages."); await apResearch(run); continue; }
      if (step.key === "page") { await apSet(id, "page", "now", "Checking for a sales page."); const pr = await apPage(run); if (pr === "wait") break; continue; }
      if (step.key === "tracking") { await apSet(id, "tracking", "now", "Checking the pixel."); await apTracking(run); continue; }
      if (step.key === "creatives") { const r = await apCreatives(run); if (r === "wait") break; continue; }
      if (step.key === "plan") { if (step.state === "needs_you") break; await apPlan(run); break; }
      break; // launch waits for the owner's tap
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 250);
    if (cur && msg.startsWith("NEEDS:")) { await apSet(id, cur, "needs_you", msg.slice(6).trim(), { status: "waiting" }); }
    else if (cur) {
      const { data: r } = await db.from("autopilot_runs").select("steps").eq("id", id).maybeSingle();
      const tries = Number(((r?.steps ?? []) as any[]).find((s) => s.key === cur)?.tries ?? 0) + 1;
      // a step is tried three times (five minutes apart) before the run stops and tells the owner
      if (tries < 3) await db.from("autopilot_runs").update({ steps: ((r?.steps ?? []) as any[]).map((s) => (s.key === cur ? { ...s, state: "wait", note: `Trying again: ${msg}`.slice(0, 280), tries } : s)) }).eq("id", id);
      else { await apSet(id, cur, "failed", msg, { status: "failed", note: msg }); await notify((got[0] as any).company_id, "autopilot_failed", id, "Autopilot stopped", `A step failed: ${msg}`, "warn"); }
    }
  } finally { await db.from("autopilot_runs").update({ lock_until: null }).eq("id", id); }
}

// 7. WATCH: while live, every tick (about every 10 minutes) it records today's numbers for THIS run's campaign, says what the team did,
// proposes what needs the owner's tap, and when the last day has passed the run is done. It never launches, spends or moves money by itself.
async function apAdsList(token: string, adAccountId: string, range: "today" | "lifetime") {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ads-manager`, { method: "POST", headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", "Content-Type": "application/json" }, body: JSON.stringify({ action: "list", ad_account_id: adAccountId, range }) });
  const o = await r.json().catch(() => null);
  if (!o?.ok) throw new Error(String(o?.error ?? `Meta numbers unavailable (${r.status})`).slice(0, 160));
  return o as { campaigns?: MetaRow[]; adsets?: MetaRow[]; ads?: MetaRow[] };
}
const watToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

async function apWatch(run: Record<string, any>) {
  const { data: l } = await db.from("ai_launches").select("status, start_at, run_days, note, plan_id").eq("id", run.launch_id).maybeSingle();
  if (!l) return;
  const end = l.start_at && l.run_days ? new Date(new Date(l.start_at).getTime() + Number(l.run_days) * 86400_000) : null;
  const cur = String(run.billing_currency ?? "NGN"), money = (x: number) => moneyText(x, cur);
  const w = (run.watch ?? {}) as Record<string, any>;
  const finish = async () => {
    const lf = w.life as Numbers | undefined;
    await apLog(run.id, "Ada", lf ? `The run is over. In total: ${money(lf.spend)} spent, ${lf.orders} order${lf.orders === 1 ? "" : "s"}${lf.cost_per_order != null ? `, ${money(lf.cost_per_order)} an order` : ""}.` : "The run is over.");
    await apSet(run.id, "watch", "done", "The run is over.");
    await apSet(run.id, "learn", "done", "What sold and what did not goes into the daily learning notes.", { status: "done" });
  };
  if (end && Date.now() > end.getTime() + 3600_000) return await finish();
  if (l.start_at && new Date(l.start_at).getTime() > Date.now()) { await apSet(run.id, "watch", "now", `Scheduled. Starts ${new Date(l.start_at).toISOString().slice(0, 16).replace("T", " ")} UTC.`); return; }
  // look at Meta at most every 8 minutes
  if (w.checked_at && Date.now() - new Date(w.checked_at).getTime() < 8 * 60_000) return;
  let ids: string[] = Array.isArray(w.campaign_ids) ? w.campaign_ids : [];
  if (!ids.length && l.plan_id) { const { data: pl } = await db.from("ai_plans").select("result").eq("id", l.plan_id).maybeSingle(); ids = ((pl?.result as any)?.campaign_ids ?? []).filter(Boolean).map(String); }
  const save = (patch: Record<string, unknown>) => db.from("autopilot_runs").update({ watch: { ...w, ...patch, checked_at: new Date().toISOString() } }).eq("id", run.id);
  if (!ids.length) { await save({}); await apSet(run.id, "watch", "now", "Live. Waiting for Meta to show the campaign."); return; }
  const token = await mintToken(String(run.created_by ?? ""));
  if (!token) { await apSet(run.id, "watch", "now", "Live. I could not read the numbers just now; I will try again."); return; }
  let today: ReturnType<typeof runRows>, life: ReturnType<typeof runRows>;
  try { [today, life] = [runRows(await apAdsList(token, run.ad_account_id, "today"), ids), runRows(await apAdsList(token, run.ad_account_id, "lifetime"), ids)]; }
  catch (e) { await apSet(run.id, "watch", "now", `Live. Meta did not answer just now (${String((e as Error).message).slice(0, 80)}); I will try again.`); return; }
  const day = watToday(), t = numbersForRun(today), lf = numbersForRun(life);
  // HARD STOP safety net: the end date should keep the total under the stop, but Meta can overspend a day, so check the real total too.
  const hs = hardStopCheck({ lifeSpend: lf.spend, totalBudget: Number(run.total_budget), dailyBudget: Number(run.daily_budget), warned: !!w.stop_warned });
  if (hs.act === "warn") { await apLog(run.id, "Tobi", `${money(lf.spend)} of your ${money(Number(run.total_budget))} hard stop is spent. I will pause everything before it is passed.`); w.stop_warned = true; }
  if (hs.act === "stop") {
    const todo = campaignsToPause(life.campaigns);
    let failed = "";
    for (const c of todo) {
      const r = await apTool(run, "set_status", { ad_account_id: run.ad_account_id, level: "campaign", object_id: c.id, status: "PAUSED", reason: `Hard stop: ${moneyText(lf.spend, cur)} spent of ${moneyText(Number(run.total_budget), cur)}` }) as Record<string, any>;
      if (r?.error) failed = String(r.error).slice(0, 160);
    }
    if (failed) {
      await apLog(run.id, "Tobi", `The hard stop is reached (${money(lf.spend)} of ${money(Number(run.total_budget))}) but I could not pause the campaign: ${failed}. I will try again in a few minutes.`);
      await notify(run.company_id, "autopilot_stop_failed", `${run.id}:${Math.floor(Date.now() / 3600_000)}`, "Autopilot: hard stop could not pause", `The hard stop of ${money(Number(run.total_budget))} is reached but Meta did not let me pause the campaign. Please pause it in Ads Manager.`, "warn");
      await db.from("autopilot_runs").update({ watch: { ...w, checked_at: new Date().toISOString() } }).eq("id", run.id); return;
    }
    await apLog(run.id, "Tobi", `Hard stop reached: ${money(lf.spend)} spent of ${money(Number(run.total_budget))}, before the end date. I paused ${todo.length ? todo.length + " campaign" + (todo.length === 1 ? "" : "s") : "the campaign (it was already off)"} so nothing more is spent.`);
    await db.from("autopilot_runs").update({ watch: { ...w, campaign_ids: ids, today: t, life: lf, day, stopped_at: new Date().toISOString(), checked_at: new Date().toISOString() } }).eq("id", run.id);
    w.life = lf; await notify(run.company_id, "autopilot_stopped", run.id, "Autopilot: hard stop reached", `${money(lf.spend)} of ${money(Number(run.total_budget))} is spent, so the campaign was paused.`);
    return await finish();
  }
  // what the team did: pauses and budget moves in the auto-off log (ad_kill_log) on this run's campaign, ad sets and ads, since the last look
  const mine = new Set<string>([...ids, ...life.adsets.map((x) => String(x.id)), ...life.ads.map((x) => String(x.id))]);
  const since = String(w.kills_since ?? run.created_at);
  const { data: kills } = await db.from("ad_kill_log").select("level, meta_object_id, object_name, action, source, reason, created_at").eq("ad_account_id", run.ad_account_id).gt("created_at", since).order("created_at", { ascending: true }).limit(60);
  const myKills = ((kills ?? []) as KillRow[]).filter((k) => mine.has(String(k.meta_object_id)));
  for (const ln of teamLines(myKills)) await apLog(run.id, ln.who, ln.text);
  // a short history of the days so far (learn_daily); managed accounts are shown with Revora's markup, like everywhere else
  const { data: acct } = await db.from("ad_accounts").select("billing_mode, markup_pct").eq("id", run.ad_account_id).maybeSingle();
  const factor = acct?.billing_mode === "managed" ? 1 + Number(acct?.markup_pct ?? 0) / 100 : 1;
  const { data: hist } = await db.from("learn_daily").select("day, spend, purchases").eq("ad_account_id", run.ad_account_id).eq("level", "campaign").in("object_id", ids).gte("day", new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10)).order("day", { ascending: true });
  const byDay = new Map<string, { day: string; spend: number; orders: number }>();
  for (const h of hist ?? []) { const x = byDay.get(h.day) ?? { day: h.day, spend: 0, orders: 0 }; x.spend += Number(h.spend ?? 0) * factor; x.orders += Number(h.purchases ?? 0); byDay.set(h.day, x); }
  byDay.set(day, { day, spend: t.spend, orders: t.orders }); // today always comes from the live numbers
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-7).map((x) => ({ ...x, spend: Math.round(x.spend * 100) / 100 }));
  // say today in words: when an order arrives, and otherwise about every three hours
  const prevOrders = w.day === day ? Number(w.today?.orders ?? 0) : 0;
  const lastSay = w.said_at ? new Date(w.said_at).getTime() : 0;
  let said = false;
  if (t.orders > prevOrders) { const ln = todayLine(t, money); await apLog(run.id, ln.who, (t.orders - prevOrders === 1 ? "A new order came in. " : `${t.orders - prevOrders} new orders came in. `) + ln.text); said = true; }
  else if (Date.now() - lastSay > 3 * 3600_000) { const ln = todayLine(t, money); await apLog(run.id, ln.who, ln.text); said = true; }
  // needs you: a new hook, only when the money spent so far has bought nothing; it never goes live without a tap
  const needs: Need[] = Array.isArray(w.needs) ? w.needs : [];
  const used = (await db.from("ai_team_images").select("brief").eq("meeting_id", run.meeting_id)).data?.map((i: any) => String(i.brief?.headline_on_image ?? "")) ?? [];
  const hook = proposeHook({ hooks: ((run.research?.hooks ?? []) as unknown[]).map(String), used, lifeSpend: lf.spend, lifeOrders: lf.orders, dailyBudget: Number(run.daily_budget), needs });
  if (hook) {
    needs.push({ id: crypto.randomUUID(), kind: "hook", title: "Try a new hook", hook, body: `${money(lf.spend)} has been spent and nothing has sold yet. I would try this hook next: “${hook.slice(0, 160)}”. If you say yes I make the picture for it and keep it in your vault. It does not go live by itself.`, status: "open", at: new Date().toISOString() });
    await apLog(run.id, "Zara", `Nothing has sold after ${money(lf.spend)}. I have a new hook ready for you to look at: “${hook.slice(0, 140)}”. It needs your tap.`);
    await notify(run.company_id, "autopilot_needs_you", `${run.id}:${needs.length}`, "Autopilot: a new hook needs your tap", `Nothing has sold after ${money(lf.spend)}. The team has a new hook for you to look at.`);
  }
  await save({ campaign_ids: ids, stop_warned: !!w.stop_warned, day, today: t, life: lf, days, kills_since: new Date().toISOString(), needs, ...(said ? { said_at: new Date().toISOString() } : {}) });
  await apSet(run.id, "watch", "now", t.spend > 0 || lf.spend > 0 ? `Live. Today ${money(t.spend)} spent, ${t.orders} order${t.orders === 1 ? "" : "s"}.` : "Live. No spend yet today.");
}

// The owner's tap on an item the team put in "Needs you". Nothing here launches an ad or spends on Meta:
// "make" asks Zara for the picture (kept in the vault only after a second tap), "dismiss" closes the item.
async function apNeed(runId: string, companyId: string, userId: string, needId: string, decision: string) {
  const { data: run } = await db.from("autopilot_runs").select("*").eq("id", runId).maybeSingle();
  if (!run || run.company_id !== companyId) return { error: "Run not found." };
  const w = (run.watch ?? {}) as Record<string, any>;
  const needs: Need[] = Array.isArray(w.needs) ? w.needs : [];
  const nd = needs.find((x) => x.id === needId);
  if (!nd) return { error: "That item is not on the list any more." };
  const put = (patch: Partial<Need>) => db.from("autopilot_runs").update({ watch: { ...w, needs: needs.map((x) => (x.id === needId ? { ...x, ...patch } : x)) }, updated_at: new Date().toISOString() }).eq("id", runId);
  if (decision === "dismiss") { await put({ status: "dismissed" }); await apLog(runId, "Zara", "Understood, I will not use that hook."); return { ok: true }; }
  if (decision === "keep" || decision === "drop") {
    if (!nd.image_id) return { error: "There is no picture to decide on yet." };
    const { data: im } = await db.from("ai_team_images").select("*").eq("id", nd.image_id).maybeSingle();
    if (!im || im.company_id !== companyId) return { error: "Picture not found." };
    if (decision === "drop") { await db.from("ai_team_images").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", im.id); await put({ status: "dismissed" }); await apLog(runId, "Zara", "Dropped that picture."); return { ok: true }; }
    const r = await approveImage(im, companyId, userId);
    if (r.error) return { error: r.error };
    await put({ status: "dismissed" }); await apLog(runId, "Zara", "Saved the new picture in your vault. It is not in the campaign: nothing was launched and nothing was spent."); return { ok: true };
  }
  if (decision !== "make" || nd.kind !== "hook" || nd.status !== "open") return { error: "Nothing to do for that." };
  if (!OPENAI && !RUNWAY) return { error: "Image making is not switched on yet." };
  const prod = await apProduct(run.product_id, companyId);
  const br = { product: prod?.product_name ?? "", angle: "New hook from the watch step", image_concept: `The product pack shown clearly, in a real home setting, speaking to this hook: ${String(nd.hook ?? "")}`, headline_on_image: String(nd.hook ?? "").toUpperCase().slice(0, 90), cta_on_image: "ORDER NOW - PAY ON DELIVERY", primary_text: String(nd.hook ?? ""), ...(prod?.product_image_url ? { _ref: prod.product_image_url } : {}) };
  const { data: row, error } = await db.from("ai_team_images").insert({ company_id: companyId, meeting_id: run.meeting_id, brief: br, prompt: adLayout(br, `${br.image_concept} (advertising photo for ${br.product.slice(0, 80)})`).slice(0, 2900) }).select("id").single();
  if (error || !row) return { error: error?.message ?? "Could not start the picture." };
  await put({ status: "accepted", image_id: row.id });
  await apLog(runId, "Zara", `Making the picture for “${String(nd.hook ?? "").slice(0, 100)}”. When it is ready you can keep it in your vault or drop it.`);
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(generateImage(row.id, companyId));
  return { ok: true };
}

// ============================ LEARNING NOTES: what was learned, in plain words, one row per thing per day ============================
// Daily (pg_cron -> action learn_notes). For every business: new lessons, winning video/page findings, what each autopilot run did and how it ended,
// and what failed and why. Text only, built from rows already in the database (no model call, no Meta call, nothing is spent).
async function learnNotesDay(day: string) {
  const from = new Date(`${day}T00:00:00+01:00`).toISOString(), to = new Date(new Date(from).getTime() + 86400_000).toISOString();
  const { data: cos } = await db.from("ad_accounts").select("company_id");
  const companies = [...new Set([...(cos ?? []).map((x: any) => x.company_id), ...((await db.from("autopilot_runs").select("company_id").gte("updated_at", from).lt("updated_at", to)).data ?? []).map((x: any) => x.company_id)].filter(Boolean))].slice(0, 200);
  const { data: glob } = await db.from("learn_lessons").select("id, scope, feature, value, direction, n, winners, lift, confidence, claim, how_to").eq("scope", "global").gte("first_seen", from).lt("first_seen", to).limit(20);
  let written = 0; const errors: string[] = [];
  for (const companyId of companies as string[]) {
    const notes: Note[] = [];
    const { data: ls } = await db.from("learn_lessons").select("id, scope, feature, value, direction, n, winners, lift, confidence, claim, how_to").eq("company_id", companyId).gte("first_seen", from).lt("first_seen", to).limit(20);
    for (const l of [...(ls ?? []), ...(glob ?? [])]) notes.push(lessonNote(l as any));
    const { data: vs } = await db.from("learn_videos").select("video_id, ad_id, length_s, analysis").eq("company_id", companyId).gte("analyzed_at", from).lt("analyzed_at", to).limit(6);
    for (const v of vs ?? []) { const n = videoNote(v as any); if (n) notes.push(n); }
    const { data: pgs } = await db.from("learn_pages").select("url_norm, title, meta_description").contains("company_ids", [companyId]).eq("status", "ok").gte("fetched_at", from).lt("fetched_at", to).limit(8);
    const pn = pageNote((pgs ?? []) as any); if (pn) notes.push(pn);
    const { data: runs, error: runsErr } = await db.from("autopilot_runs").select("id, product_id, status, daily_budget, total_budget, billing_currency, market_countries, steps, watch, log, updated_at").eq("company_id", companyId).gte("updated_at", from).lt("updated_at", to).limit(10);
    if (runsErr) errors.push("runs: " + runsErr.message);
    const fails: { what: string; why: string; ref?: Record<string, unknown> }[] = [];
    for (const r of runs ?? []) {
      const { data: pr } = await db.from("products").select("product_name").eq("id", r.product_id).maybeSingle();
      notes.push(runNote(r as any, pr?.product_name ?? "a product", moneyText));
      for (const st of ((r.steps ?? []) as any[]).filter((x) => x.state === "failed")) fails.push({ what: `Autopilot step “${st.label}” for ${pr?.product_name ?? "a product"}`, why: st.note, ref: { run_id: r.id } });
    }
    const { data: bad } = await db.from("ai_launches").select("id, product_name, note").eq("company_id", companyId).eq("status", "failed").gte("updated_at", from).lt("updated_at", to).limit(6);
    for (const b of bad ?? []) fails.push({ what: `Launch of ${b.product_name}`, why: b.note, ref: { launch_id: b.id } });
    const { data: badImg } = await db.from("ai_team_images").select("id, brief, error").eq("company_id", companyId).eq("status", "failed").gte("updated_at", from).lt("updated_at", to).limit(6);
    for (const b of badImg ?? []) fails.push({ what: `Ad picture for ${String((b.brief as any)?.product ?? "a product")}`, why: b.error, ref: { image_id: b.id } });
    const fn = failureNote(day, fails); if (fn) notes.push(fn);
    if (!notes.length) continue;
    // two notes with the same title on one day (e.g. two cancelled runs of one product) become one note: bodies joined, refs listed
    const merged = new Map<string, { company_id: string; day: string; kind: string; title: string; body_md: string; source_refs: Record<string, unknown> }>();
    for (const n of notes) {
      const k = n.kind + "|" + n.title, o = merged.get(k);
      if (!o) merged.set(k, { company_id: companyId, day, kind: n.kind, title: n.title, body_md: n.body_md, source_refs: n.source_refs });
      else { o.body_md += "\n\n---\n\n" + n.body_md; o.source_refs = { ...o.source_refs, also: [...(((o.source_refs.also as unknown[]) ?? [])), n.source_refs] }; }
    }
    const rows = [...merged.values()];
    const { error } = await db.from("learn_notes").upsert(rows, { onConflict: "company_id,day,kind,title" });
    if (!error) written += rows.length; else errors.push("save: " + error.message);
  }
  return { day, companies: companies.length, notes: written, errors: errors.slice(0, 5) };
}

async function apTickAll() {
  const { data: runs } = await db.from("autopilot_runs").select("id").in("status", ["running", "waiting", "live"]).order("updated_at", { ascending: true }).limit(6);
  for (const r of runs ?? []) await apAdvance(r.id);
  return (runs ?? []).length;
}

async function apCancel(runId: string, companyId: string) {
  const { data: run } = await db.from("autopilot_runs").select("*").eq("id", runId).maybeSingle();
  if (!run || run.company_id !== companyId) return { error: "Run not found." };
  if (!["running", "waiting", "failed"].includes(run.status)) return { error: "Only a run that has not launched can be cancelled." };
  if (run.launch_id) await db.from("ai_launches").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", run.launch_id).eq("status", "proposed");
  const pg = (run.page ?? {}) as Record<string, any>;
  if (pg.set_landing) await db.from("products").update({ landing_page_url: null }).eq("id", run.product_id).eq("landing_page_url", pg.live_link);
  await db.from("autopilot_runs").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", runId);
  return { ok: true };
}
// Try the stuck step again (after the owner fixed what it asked for).
async function apRetry(runId: string, companyId: string) {
  const { data: run } = await db.from("autopilot_runs").select("*").eq("id", runId).maybeSingle();
  if (!run || run.company_id !== companyId) return { error: "Run not found." };
  if (!["waiting", "failed", "running"].includes(run.status)) return { error: "This run cannot be retried." };
  const steps = ((run.steps ?? []) as any[]).map((s) => (s.state === "failed" || s.state === "needs_you" ? { ...s, state: "wait", tries: 0, note: "Trying again." } : s));
  if (run.meeting_id) await db.from("ai_launches").delete().eq("meeting_id", run.meeting_id).in("status", ["skipped", "failed"]);
  await db.from("autopilot_runs").update({ steps, status: "running", note: null, lock_until: null, updated_at: new Date().toISOString() }).eq("id", runId);
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(apAdvance(runId));
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    const { data: sec } = await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
    if (!sec?.value || sec.value !== cron) return json({ error: "Not allowed." }, 401);
    const cb = await req.clone().json().catch(() => ({}));
    if (cb?.action === "learn_notes") { const day = /^\d{4}-\d{2}-\d{2}$/.test(String(cb.day ?? "")) ? String(cb.day) : new Date(Date.now() + 3600_000 - 86400_000).toISOString().slice(0, 10); return json({ ok: true, ...(await learnNotesDay(day)) }); }
    const log = await tick(); const aps = await apTickAll().catch(() => -1);
    return json({ ok: true, log, autopilot_runs_advanced: aps });
  }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: ud } = await db.auth.getUser(token);
  if (!ud?.user) return json({ error: "Please log in." }, 401);
  const { data: p } = await db.from("profiles").select("company_id, role").eq("id", ud.user.id).maybeSingle();
  if (!p?.company_id) return json({ error: "No company on this account." }, 403);
  // Owners, admins and media buyers all run the AI Team: settings, autopilot, images and launches (the spend limit still caps everything).
  const isOwner = ["owner", "admin", "buyer"].includes(String(p.role ?? ""));
  const canStart = isOwner || String(p.role ?? "") === "buyer"; // media buyers can call a meeting (it spends nothing); approving images and launches stays with the owner
  const b = await req.json().catch(() => ({}));
  const companyId = p.company_id as string;

  // VOICE IN: the page records a few seconds with the microphone and sends it here; this turns it into text (works on every phone and browser).
  if (b?.action === "transcribe") {
    if (!OPENAI) return json({ error: "Voice needs the OpenAI key." }, 503);
    const b64 = String(b?.audio ?? "");
    if (!b64 || b64.length > 9_000_000) return json({ error: "That recording is too long. Keep it under a minute." }, 400);
    const mime = String(b?.mime ?? "audio/webm").slice(0, 60);
    const ext = /mp4|m4a|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : /wav/.test(mime) ? "wav" : "webm";
    const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ask = async (model: string) => {
      const fd = new FormData();
      fd.append("file", new Blob([bytes], { type: mime }), `speech.${ext}`); fd.append("model", model);
      fd.append("prompt", "A business meeting about Facebook and Instagram ads for Nigeria and Kenya. Names: Ada, Zara, Tobi, Ife, Brahmi Shakti, Hyper T 500, Sillymarin, Revora, Meta, purchases, ad set, naira.");
      return await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${OPENAI}` }, body: fd });
    };
    let r = await ask("gpt-4o-mini-transcribe");
    if (!r.ok) r = await ask("whisper-1");
    const o = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: "OpenAI could not read the recording (" + r.status + "): " + String(o?.error?.message ?? "").slice(0, 120) }, 502);
    return json({ text: String(o?.text ?? "").trim() });
  }

  // VOICE: one OpenAI voice per role. Returns the audio itself (mp3).
  if (b?.action === "speak") {
    if (!OPENAI) return json({ error: "Voice needs the OpenAI key." }, 503);
    const VOICES: Record<string, string> = { team_lead: "nova", creative: "shimmer", media_buyer: "onyx", customer_service: "coral" };
    const text = String(b?.text ?? "").replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 700);
    if (!text) return json({ error: "Nothing to say." }, 400);
    const say = (voice: string) => fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { Authorization: `Bearer ${OPENAI}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "tts-1", voice, input: text, response_format: "mp3" }) });
    let r = await say(VOICES[String(b?.speaker)] ?? "alloy");
    if (!r.ok && r.status === 400) r = await say("alloy"); // a voice this account's model does not have
    if (!r.ok) return json({ error: "OpenAI voice said " + r.status + ": " + (await r.text()).slice(0, 160) }, 502);
    return new Response(r.body, { status: 200, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600", ...cors } });
  }

  if (b?.action === "state") {
    const { data: team } = await db.from("ai_teams").select("*").eq("company_id", companyId).maybeSingle();
    const { data: meetings } = await db.from("ai_meetings").select("id, status, topic, trigger, started_at, ended_at, decision, error, mode, ends_at, duration_minutes").eq("company_id", companyId).order("started_at", { ascending: false }).limit(15);
    const { data: images } = await db.from("ai_team_images").select("id, meeting_id, brief, status, image_url, error, created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(40);
    const { data: launches } = await db.from("ai_launches").select("id, meeting_id, product_name, account_name, buyer_name, daily_budget_naira, status, note, start_at, kill_rule, created_at, countries").eq("company_id", companyId).order("created_at", { ascending: false }).limit(40);
    return json({ launches: launches ?? [], team: team ?? { company_id: companyId, enabled: true, auto_launch: false, daily_budget_cap_naira: 0 }, meetings: meetings ?? [], images: images ?? [], ai_ready: !!OPENAI, images_ready: !!(OPENAI || RUNWAY), voice_ready: !!OPENAI, claims_verified: !!team?.claims_verified_at, can_manage: isOwner, can_start: canStart });
  }

  if (b?.action === "settings") {
    if (!isOwner) return json({ error: "You do not have access to change the team settings." }, 403);
    const patch: Record<string, unknown> = { company_id: companyId, updated_at: new Date().toISOString() };
    if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
    if (typeof b.auto_launch === "boolean") patch.auto_launch = b.auto_launch;
    if (typeof b.daily_meeting === "boolean") patch.daily_meeting = b.daily_meeting;
    if (b.meeting_hour_lagos != null) patch.meeting_hour_lagos = Math.min(23, Math.max(0, Math.round(Number(b.meeting_hour_lagos) || 0)));
    if (typeof b.auto_launch === "boolean") patch.auto_launch_by = b.auto_launch ? ud.user.id : null;
    if (b.daily_budget_cap_naira != null) patch.daily_budget_cap_naira = Math.max(0, Number(b.daily_budget_cap_naira) || 0);
    const { error } = await db.from("ai_teams").upsert(patch, { onConflict: "company_id" });
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }

  if (b?.action === "start") {
    if (!canStart) return json({ error: "Only the owner, an admin or a media buyer can call a meeting." }, 403);
    const demo = b?.demo === true;
    if (!demo && !OPENAI) return json({ error: "The AI team is not switched on yet: it needs the OpenAI key (OPENAI_API_KEY)." }, 503);
    const nowIso = new Date().toISOString();
    const { data: running } = await db.from("ai_meetings").select("id").eq("company_id", companyId).eq("status", "running").or(`and(mode.eq.live,ends_at.gt.${nowIso}),started_at.gt.${new Date(Date.now() - 6 * 60_000).toISOString()}`).limit(1).maybeSingle();
    if (running) return json({ error: "A meeting is already running.", meeting_id: running.id }, 409);
    const topic = String(b?.topic ?? "").trim().slice(0, 300) || "Live meeting: what is working, what to make and launch next.";
    if (demo) {
      const { data: m, error } = await db.from("ai_meetings").insert({ company_id: companyId, topic: `[DEMO] ${topic}`, started_by: ud.user.id }).select("id").single();
      if (error || !m) return json({ error: error?.message ?? "Could not start." }, 500);
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil(runMeeting(m.id, companyId, topic, true));
      return json({ meeting_id: m.id });
    }
    const minutes = [30, 60, 90].includes(Number(b?.minutes)) ? Number(b.minutes) : 60;
    const { data: m, error } = await db.from("ai_meetings").insert({ company_id: companyId, topic, started_by: ud.user.id, mode: "live", duration_minutes: minutes, ends_at: new Date(Date.now() + minutes * 60_000).toISOString(), last_activity_at: nowIso }).select("id").single();
    if (error || !m) return json({ error: error?.message ?? "Could not start." }, 500);
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil(startLive(m.id, companyId, topic));
    return json({ meeting_id: m.id });
  }

  if (b?.action === "make_images") {
    if (!isOwner) return json({ error: "You do not have access to ask the creative agent to make images." }, 403);
    if (!OPENAI && !RUNWAY) return json({ error: "Image making is not switched on yet: it needs the OpenAI key (OPENAI_API_KEY)." }, 503);
    const r = await makeImages(String(b?.meeting_id ?? ""), companyId);
    return json(r.error ? { error: r.error } : { ok: true, started: r.started }, r.error ? 409 : 200);
  }

  if (b?.action === "approve_image" || b?.action === "reject_image") {
    if (!isOwner) return json({ error: "You do not have access to approve images." }, 403);
    const { data: im } = await db.from("ai_team_images").select("*").eq("id", String(b?.image_id ?? "")).maybeSingle();
    if (!im || im.company_id !== companyId) return json({ error: "Image not found." }, 404);
    if (b.action === "reject_image") { await db.from("ai_team_images").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", im.id); return json({ ok: true }); }
    const r = await approveImage(im, companyId, ud.user.id);
    return json(r.error ? { error: r.error } : { ok: true, creative_id: r.creative_id }, r.error ? 409 : 200);
  }

  if (b?.action === "propose_launches") {
    if (!isOwner) return json({ error: "You do not have access to prepare launches." }, 403);
    const r = await proposeLaunches(String(b?.meeting_id ?? ""), companyId, ud.user.id);
    return json(r, "error" in r ? 409 : 200);
  }
  if (b?.action === "approve_launch") {
    if (!isOwner) return json({ error: "You do not have access to approve a launch." }, 403);
    const ctx = { token, userId: ud.user.id, email: ud.user.email ?? null, companyId, role: p.role ?? "", mediaBuyerId: null, displayName: "" };
    const r = await approveLaunch(String(b?.launch_id ?? ""), ctx);
    return json(r, "error" in r ? 409 : 200);
  }
  if (b?.action === "cancel_launch") {
    if (!isOwner) return json({ error: "You do not have access to cancel a launch." }, 403);
    await db.from("ai_launches").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", String(b?.launch_id ?? "")).eq("company_id", companyId).eq("status", "proposed");
    return json({ ok: true });
  }

  // ---- AUTOPILOT ----
  if (b?.action === "ap_state") {
    if (!["owner", "admin"].includes(String(p.role ?? ""))) return json({ error: "Autopilot is for owners and admins." }, 403);
    const { data: runs } = await db.from("autopilot_runs").select("id, product_id, status, step, steps, research, page, launch_id, meeting_id, market_countries, billing_currency, market_currency, daily_budget, total_budget, launch_mode, note, log, watch, created_at, updated_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(8);
    const { data: prods } = await db.from("products").select("id, product_name, target_countries, ad_account_id, landing_page_url, product_image_url, is_active").eq("company_id", companyId).eq("is_active", true).order("created_at", { ascending: false });
    const { data: accts } = await db.from("ad_accounts").select("id, currency, nickname, name").eq("company_id", companyId);
    const { data: co } = await db.from("companies").select("country, currency").eq("id", companyId).maybeSingle();
    const launchIds = (runs ?? []).map((r) => r.launch_id).filter(Boolean);
    const { data: ls } = launchIds.length ? await db.from("ai_launches").select("id, status, ad_sets, copies, countries, start_at, run_days, daily_budget_naira, landing_url, note, creative_ids").in("id", launchIds) : { data: [] };
    const { data: imgs } = (runs ?? []).some((r) => r.meeting_id) ? await db.from("ai_team_images").select("id, meeting_id, image_url, status, brief").in("meeting_id", (runs ?? []).map((r) => r.meeting_id).filter(Boolean)) : { data: [] };
    return json({ runs: runs ?? [], products: prods ?? [], accounts: accts ?? [], company: co, launches: ls ?? [], images: imgs ?? [] });
  }
  if (b?.action === "ap_start" || b?.action === "ap_approve" || b?.action === "ap_cancel" || b?.action === "ap_retry" || b?.action === "ap_need") {
    if (!["owner", "admin"].includes(String(p.role ?? ""))) return json({ error: "Only an owner or admin can run Autopilot." }, 403);
    if (b.action === "ap_start") { if (!OPENAI) return json({ error: "The AI team needs the OpenAI key." }, 503); const r = await apStart(b, ud.user.id, companyId); return json(r, "error" in r ? 409 : 200); }
    if (b.action === "ap_cancel") { const r = await apCancel(String(b.run_id ?? ""), companyId); return json(r, "error" in r ? 409 : 200); }
    if (b.action === "ap_need") { const r = await apNeed(String(b.run_id ?? ""), companyId, ud.user.id, String(b.need_id ?? ""), String(b.decision ?? "")); return json(r, "error" in r ? 409 : 200); }
    if (b.action === "ap_retry") { const r = await apRetry(String(b.run_id ?? ""), companyId); return json(r, "error" in r ? 409 : 200); }
    const ctx = { token, userId: ud.user.id, email: ud.user.email ?? null, companyId, role: p.role ?? "", mediaBuyerId: null, displayName: "" };
    const r = await apApprove(String(b.run_id ?? ""), ctx); return json(r, "error" in r ? 409 : 200);
  }

  if (b?.action === "say") {
    const text = String(b?.text ?? "").trim().slice(0, 600);
    const { data: m } = await db.from("ai_meetings").select("id, company_id, status, mode").eq("id", String(b?.meeting_id ?? "")).maybeSingle();
    if (!m || m.company_id !== companyId) return json({ error: "Meeting not found." }, 404);
    if (m.status !== "running") return json({ error: "This meeting has ended." }, 409);
    if (!text) return json({ error: "Say something first." }, 400);
    await addMessage(m.id, companyId, "you", text, true);
    await db.from("ai_meetings").update({ last_activity_at: new Date().toISOString() }).eq("id", m.id);
    // deno-lint-ignore no-explicit-any
    if (m.mode === "live") (globalThis as any).EdgeRuntime?.waitUntil(liveRespond(m.id, companyId));
    return json({ ok: true });
  }

  if (b?.action === "end") {
    if (!canStart) return json({ error: "You do not have access to end a meeting." }, 403);
    const { data: m } = await db.from("ai_meetings").select("id, company_id, status, mode").eq("id", String(b?.meeting_id ?? "")).maybeSingle();
    if (!m || m.company_id !== companyId) return json({ error: "Meeting not found." }, 404);
    if (m.status !== "running") return json({ ok: true });
    if (m.mode !== "live") return json({ error: "This is an automatic meeting; it ends by itself." }, 409);
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil(finishLive(m.id, companyId));
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
