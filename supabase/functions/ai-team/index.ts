import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { withR2, R2_ON } from "../_shared/r2storage.ts";

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
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors } });

type Speaker = "team_lead" | "creative" | "media_buyer" | "customer_service";
const AGENTS: Record<Speaker, { name: string; role: string; brief: string }> = {
  team_lead: { name: "Ada", role: "Team Lead", brief: "You lead the team. You read the numbers, decide what to push, how to position the product and how aggressive the creatives should be (bold hooks, urgency, strong offers, social proof). You push the others to commit to specific actions." },
  creative: { name: "Zara", role: "Creative Agent", brief: "You make the ad images (videos later). You propose concrete image concepts: the scene, the angle, the headline text on the image, and the primary text. You make the team lead's direction visual and punchy." },
  media_buyer: { name: "Tobi", role: "Media Buyer", brief: "You launch the campaigns at midnight from creatives that are already made. You say what to test, which products and how much budget, what you would kill early, and what worries you in the numbers." },
  customer_service: { name: "Ife", role: "Customer Service", brief: "You talk to the customers. You only report what the numbers show (cancellations, deliveries, stock). If there is no customer feedback in the data, say so plainly; never invent customer quotes." },
};
const rules = (verified: boolean) => `Rules for everyone:
- Speak like a real teammate in a meeting: 2 to 4 short sentences, plain words, no bullet lists, no headings, no emojis.
- Use ONLY the numbers in the briefing. If a number is missing, say it is missing. Never invent sales, quotes or results.
- Everything is in Nigerian naira (₦). The team works for one business.
- CLAIMS: ${verified
    ? "This business has been verified by Revora. For each product you may use the claims listed in that product's approved_claims, in those words. Do not state any product claim that is not listed there, and never promise a cure or guaranteed result. If approved_claims is empty for a product, treat it as having no claims."
    : "This business is not verified yet, so make no product claims beyond the plain product description (what it is, the price, the offer, delivery and payment options). Never say a product cures, treats or fixes a condition. Bold hooks, urgency and strong offers are fine."}
- Respect each product's own safety notes.`;

async function openaiStream(messages: { role: string; content: string }[], onText: (t: string) => Promise<void>, json_mode = false): Promise<string> {
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
async function openaiImage(prompt: string): Promise<{ bytes?: Uint8Array; error?: string }> {
  const tryModel = async (model: string, extra: Record<string, unknown>) => {
    const r = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${OPENAI}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, prompt: prompt.slice(0, model === "dall-e-3" ? 3900 : 3000), n: 1, size: "1024x1024", ...extra }) });
    const o = await r.json().catch(() => ({}));
    const b64 = o?.data?.[0]?.b64_json;
    if (r.ok && b64) { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return { bytes }; }
    return { error: `${model}: ${o?.error?.message ?? r.status}` };
  };
  const a = await tryModel("gpt-image-1", { quality: "medium" });
  if (a.bytes) return a;
  const b = await tryModel("dall-e-3", { response_format: "b64_json" });
  return b.bytes ? b : { error: `${a.error} | ${b.error}`.slice(0, 280) };
}
async function generateImage(id: string, companyId: string) {
  const fail = (e: string) => db.from("ai_team_images").update({ status: "failed", error: e.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", id);
  try {
    const { data: im } = await db.from("ai_team_images").select("prompt").eq("id", id).single();
    let bytes: Uint8Array | undefined;
    if (OPENAI) {
      const r = await openaiImage(String(im?.prompt ?? ""));
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
  const { data: prods } = await db.from("products").select("id, product_name, destination_type, landing_page_url, ad_account_id, is_active").eq("company_id", companyId).eq("is_active", true);
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
    const { data } = await db.from("ai_launches").insert({
      ...base, status: "proposed", product_id: prod.id, ad_account_id: acct.id, account_name: acct.nickname || acct.name, media_buyer_id: acct.media_buyer_id, buyer_name: buyer?.name ?? null,
      // deno-lint-ignore no-explicit-any
      creative_ids: mine.map((i: any) => i.creative_id), destination: prod.destination_type ?? "website", landing_url: url, copies,
    }).select("*").single();
    committed += budget; out.push(data);
  }
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
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/mcp-ads`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": SERVICE }, body: JSON.stringify({ action: "call", tool, args, ctx }) });
    const o = await r.json().catch(() => ({})); return o?.out ?? o;
  };
  const fail = async (why: string) => { await db.from("ai_launches").update({ status: "failed", note: why.slice(0, 400), updated_at: new Date().toISOString() }).eq("id", l.id); return { error: why }; };
  const copies = (l.copies as { primary_text: string; headline?: string }[]) ?? [];
  const planned = await call("plan_campaign", {
    ad_account_id: l.ad_account_id, product_name: l.product_name, destination: l.destination ?? "website", objective: "sales", budget_type: "abo",
    ...(l.landing_url ? { landing_url: l.landing_url } : {}), campaign_name: `AI Team · ${l.product_name} · ${new Date(start.getTime() + 3600_000).toISOString().slice(0, 10)}`,
    asset_ids: l.creative_ids, copies, ads: (l.creative_ids as string[]).map((id, i) => ({ asset_id: id, copy_index: Math.min(i, copies.length - 1) })),
    adsets: [{ label: "AI Team", budget_naira: Number(l.daily_budget_naira) }], person_confirmed: true, start_time: lagosIso(start),
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
  for (const [bi, br0] of briefs.entries()) {
    const br = { ...br0, _i: bi };
    const prompt = `${String(br.image_concept ?? br.angle ?? "").slice(0, 700)}. Professional square social media advertising photo for ${String(br.product ?? "the product").slice(0, 80)}, product clearly visible, clean composition, high quality, no text, no logos, no watermarks.`;
    const { data: r } = await db.from("ai_team_images").insert({ company_id: companyId, meeting_id: m.id, brief: br, prompt }).select("id").single();
    if (r) rows.push(r.id);
  }
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(Promise.all(rows.map((id) => generateImage(id, companyId))));
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

async function runMeeting(meetingId: string, companyId: string, topic: string, demo: boolean, daily = false, auto = false) {
  try {
    const { data: brief } = await db.rpc("rv_team_briefing", { p_company: companyId });
    const briefing = JSON.stringify(brief ?? {}).slice(0, 9000);
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
      const text = demo ? await demoSpeak(sp, n, push) : await openaiStream([
        { role: "system", content: `You are ${a.name}, the ${a.role} of an AI marketing team for a Nigerian online business. ${a.brief}\n\n${rules(!!(brief as { claims_verified?: boolean } | null)?.claims_verified)}\n\nMeeting topic: ${topic}\n\nBRIEFING (real data):\n${briefing}` },
        { role: "user", content: `Meeting so far:\n${transcript || "(nothing yet, you open the meeting)"}\n\nNow it is your turn, ${a.name}. ${sp === "team_lead" && !transcript ? "Open the meeting: say what the numbers show and what today's focus should be." : sp === "team_lead" && (count.team_lead ?? 0) > 1 ? "Close the meeting: state the decisions clearly (which products, which angles, how aggressive, what to launch tonight)." : "Respond to what was said and add your part."}` },
      ], push);
      await db.from("ai_meeting_messages").update({ content: text.trim(), done: true, updated_at: new Date().toISOString() }).eq("id", row.id);
    }
    // The written decision the creative agent and media buyer will work from.
    let decision: unknown = { summary: "Demo meeting: no real decision was made.", demo: true };
    if (!demo) {
      const { data: msgs } = await db.from("ai_meeting_messages").select("speaker, content").eq("meeting_id", meetingId).order("seq");
      const transcript = (msgs ?? []).map((m) => `${AGENTS[m.speaker as Speaker]?.name ?? "BOSS"}: ${m.content}`).join("\n");
      const raw = await openaiStream([
        { role: "system", content: `You write the official decision of an AI marketing team meeting. Return ONLY JSON: {"summary": string (2-3 sentences), "angles": [string], "creative_briefs": [{"product": string, "angle": string, "image_concept": string, "headline_on_image": string, "primary_text": string}], "launch_plan": [{"product": string, "creative_brief_index": number, "daily_budget_naira": number, "kill_rule": string}], "risks": [string]}. Use only products from the briefing. Max 5 creative_briefs. Only use product claims the briefing allows (approved_claims when claims_verified is true, otherwise none).\n\nBRIEFING:\n${briefing}` },
        { role: "user", content: `Meeting transcript:\n${transcript}` },
      ], async () => {}, true);
      try { decision = JSON.parse(raw); } catch { decision = { summary: raw.slice(0, 600) }; }
    }
    await db.from("ai_meetings").update({ status: "done", decision, ended_at: new Date().toISOString() }).eq("id", meetingId);
    if (daily && !auto) await notify(companyId, "ai_team_ready", meetingId, "AI Team: today's meeting is ready", "The team made today's plan. Open the AI Team page to make the images and approve the launches.");
  } catch (e) {
    await db.from("ai_meetings").update({ status: "failed", error: String((e as Error)?.message ?? e).slice(0, 400), ended_at: new Date().toISOString() }).eq("id", meetingId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    const { data: sec } = await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
    if (!sec?.value || sec.value !== cron) return json({ error: "Not allowed." }, 401);
    return json({ ok: true, log: await tick() });
  }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: ud } = await db.auth.getUser(token);
  if (!ud?.user) return json({ error: "Please log in." }, 401);
  const { data: p } = await db.from("profiles").select("company_id, role").eq("id", ud.user.id).maybeSingle();
  if (!p?.company_id) return json({ error: "No company on this account." }, 403);
  const isOwner = ["owner", "admin"].includes(String(p.role ?? ""));
  const b = await req.json().catch(() => ({}));
  const companyId = p.company_id as string;

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
    const { data: meetings } = await db.from("ai_meetings").select("id, status, topic, trigger, started_at, ended_at, decision, error").eq("company_id", companyId).order("started_at", { ascending: false }).limit(15);
    const { data: images } = await db.from("ai_team_images").select("id, meeting_id, brief, status, image_url, error, created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(40);
    const { data: launches } = await db.from("ai_launches").select("id, meeting_id, product_name, account_name, buyer_name, daily_budget_naira, status, note, start_at, kill_rule, created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(40);
    return json({ launches: launches ?? [], team: team ?? { company_id: companyId, enabled: true, auto_launch: false, daily_budget_cap_naira: 0 }, meetings: meetings ?? [], images: images ?? [], ai_ready: !!OPENAI, images_ready: !!(OPENAI || RUNWAY), voice_ready: !!OPENAI, claims_verified: !!team?.claims_verified_at, can_manage: isOwner });
  }

  if (b?.action === "settings") {
    if (!isOwner) return json({ error: "Only the owner can change the team's settings." }, 403);
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
    if (!isOwner) return json({ error: "Only the owner or an admin can call a meeting." }, 403);
    const demo = b?.demo === true;
    if (!demo && !OPENAI) return json({ error: "The AI team is not switched on yet: it needs the OpenAI key (OPENAI_API_KEY)." }, 503);
    const { data: running } = await db.from("ai_meetings").select("id").eq("company_id", companyId).eq("status", "running").gt("started_at", new Date(Date.now() - 6 * 60_000).toISOString()).limit(1).maybeSingle();
    if (running) return json({ error: "A meeting is already running.", meeting_id: running.id }, 409);
    const topic = String(b?.topic ?? "").trim().slice(0, 300) || "Daily strategy: what is selling, how to position it, what to make and launch next.";
    const { data: m, error } = await db.from("ai_meetings").insert({ company_id: companyId, topic: demo ? `[DEMO] ${topic}` : topic, started_by: ud.user.id }).select("id").single();
    if (error || !m) return json({ error: error?.message ?? "Could not start." }, 500);
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil(runMeeting(m.id, companyId, topic, demo));
    return json({ meeting_id: m.id });
  }

  if (b?.action === "make_images") {
    if (!isOwner) return json({ error: "Only the owner or an admin can ask the creative agent to make images." }, 403);
    if (!OPENAI && !RUNWAY) return json({ error: "Image making is not switched on yet: it needs the OpenAI key (OPENAI_API_KEY)." }, 503);
    const r = await makeImages(String(b?.meeting_id ?? ""), companyId);
    return json(r.error ? { error: r.error } : { ok: true, started: r.started }, r.error ? 409 : 200);
  }

  if (b?.action === "approve_image" || b?.action === "reject_image") {
    if (!isOwner) return json({ error: "Only the owner or an admin can approve images." }, 403);
    const { data: im } = await db.from("ai_team_images").select("*").eq("id", String(b?.image_id ?? "")).maybeSingle();
    if (!im || im.company_id !== companyId) return json({ error: "Image not found." }, 404);
    if (b.action === "reject_image") { await db.from("ai_team_images").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", im.id); return json({ ok: true }); }
    const r = await approveImage(im, companyId, ud.user.id);
    return json(r.error ? { error: r.error } : { ok: true, creative_id: r.creative_id }, r.error ? 409 : 200);
  }

  if (b?.action === "propose_launches") {
    if (!isOwner) return json({ error: "Only the owner or an admin can prepare launches." }, 403);
    const r = await proposeLaunches(String(b?.meeting_id ?? ""), companyId, ud.user.id);
    return json(r, "error" in r ? 409 : 200);
  }
  if (b?.action === "approve_launch") {
    if (!isOwner) return json({ error: "Only the owner or an admin can approve a launch." }, 403);
    const ctx = { token, userId: ud.user.id, email: ud.user.email ?? null, companyId, role: p.role ?? "", mediaBuyerId: null, displayName: "" };
    const r = await approveLaunch(String(b?.launch_id ?? ""), ctx);
    return json(r, "error" in r ? 409 : 200);
  }
  if (b?.action === "cancel_launch") {
    if (!isOwner) return json({ error: "Only the owner or an admin can cancel a launch." }, 403);
    await db.from("ai_launches").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", String(b?.launch_id ?? "")).eq("company_id", companyId).eq("status", "proposed");
    return json({ ok: true });
  }

  if (b?.action === "say") {
    const text = String(b?.text ?? "").trim().slice(0, 600);
    const { data: m } = await db.from("ai_meetings").select("id, company_id, status").eq("id", String(b?.meeting_id ?? "")).maybeSingle();
    if (!m || m.company_id !== companyId) return json({ error: "Meeting not found." }, 404);
    if (m.status !== "running") return json({ error: "This meeting has ended." }, 409);
    if (!text) return json({ error: "Say something first." }, 400);
    await addMessage(m.id, companyId, "you", text, true);
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
