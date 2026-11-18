import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
const db = createClient(SUPABASE_URL, SERVICE);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors } });

type Speaker = "team_lead" | "creative" | "media_buyer" | "customer_service";
const AGENTS: Record<Speaker, { name: string; role: string; brief: string }> = {
  team_lead: { name: "Ada", role: "Team Lead", brief: "You lead the team. You read the numbers, decide what to push, how to position the product and how aggressive the creatives should be (bold hooks, urgency, strong offers, social proof). You push the others to commit to specific actions." },
  creative: { name: "Zara", role: "Creative Agent", brief: "You make the ad images (videos later). You propose concrete image concepts: the scene, the angle, the headline text on the image, and the primary text. You make the team lead's direction visual and punchy." },
  media_buyer: { name: "Tobi", role: "Media Buyer", brief: "You launch the campaigns at midnight from creatives that are already made. You say what to test, which products and how much budget, what you would kill early, and what worries you in the numbers." },
  customer_service: { name: "Ife", role: "Customer Service", brief: "You talk to the customers. You only report what the numbers show (cancellations, deliveries, stock). If there is no customer feedback in the data, say so plainly; never invent customer quotes." },
};
const RULES = `Rules for everyone:
- Speak like a real teammate in a meeting: 2 to 4 short sentences, plain words, no bullet lists, no headings, no emojis.
- Use ONLY the numbers in the briefing. If a number is missing, say it is missing. Never invent sales, quotes or results.
- Respect each product's own notes. Never claim a product cures, treats or reverses a disease or medical condition; "aggressive" means bold hooks, urgency and strong offers, not false claims.
- Everything is in Nigerian naira (₦). The team works for one business.`;

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

async function runMeeting(meetingId: string, companyId: string, topic: string, demo: boolean) {
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
        { role: "system", content: `You are ${a.name}, the ${a.role} of an AI marketing team for a Nigerian online business. ${a.brief}\n\n${RULES}\n\nMeeting topic: ${topic}\n\nBRIEFING (real data):\n${briefing}` },
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
        { role: "system", content: `You write the official decision of an AI marketing team meeting. Return ONLY JSON: {"summary": string (2-3 sentences), "angles": [string], "creative_briefs": [{"product": string, "angle": string, "image_concept": string, "headline_on_image": string, "primary_text": string}], "launch_plan": [{"product": string, "creative_brief_index": number, "daily_budget_naira": number, "kill_rule": string}], "risks": [string]}. Use only products from the briefing. Max 5 creative_briefs. Do not add claims the product notes forbid.\n\nBRIEFING:\n${briefing}` },
        { role: "user", content: `Meeting transcript:\n${transcript}` },
      ], async () => {}, true);
      try { decision = JSON.parse(raw); } catch { decision = { summary: raw.slice(0, 600) }; }
    }
    await db.from("ai_meetings").update({ status: "done", decision, ended_at: new Date().toISOString() }).eq("id", meetingId);
  } catch (e) {
    await db.from("ai_meetings").update({ status: "failed", error: String((e as Error)?.message ?? e).slice(0, 400), ended_at: new Date().toISOString() }).eq("id", meetingId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: ud } = await db.auth.getUser(token);
  if (!ud?.user) return json({ error: "Please log in." }, 401);
  const { data: p } = await db.from("profiles").select("company_id, role").eq("id", ud.user.id).maybeSingle();
  if (!p?.company_id) return json({ error: "No company on this account." }, 403);
  const isOwner = ["owner", "admin"].includes(String(p.role ?? ""));
  const b = await req.json().catch(() => ({}));
  const companyId = p.company_id as string;

  if (b?.action === "state") {
    const { data: team } = await db.from("ai_teams").select("*").eq("company_id", companyId).maybeSingle();
    const { data: meetings } = await db.from("ai_meetings").select("id, status, topic, trigger, started_at, ended_at, decision, error").eq("company_id", companyId).order("started_at", { ascending: false }).limit(15);
    return json({ team: team ?? { company_id: companyId, enabled: true, auto_launch: false, daily_budget_cap_naira: 0 }, meetings: meetings ?? [], ai_ready: !!OPENAI, can_manage: isOwner });
  }

  if (b?.action === "settings") {
    if (!isOwner) return json({ error: "Only the owner can change the team's settings." }, 403);
    const patch: Record<string, unknown> = { company_id: companyId, updated_at: new Date().toISOString() };
    if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
    if (typeof b.auto_launch === "boolean") patch.auto_launch = b.auto_launch;
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
