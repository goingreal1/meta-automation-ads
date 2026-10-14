import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Keeps the next few days of posts ready in social_posts: picks pictures from social_assets and writes the captions.
//   Auth: the shared cron secret in x-cron-secret.
//   POST { action: "fill" }                                   -> top up drafts for the next `days_ahead` days
//   POST { action: "caption", media_urls: [...], note?: "" }  -> just write captions for given pictures (returns them, saves nothing)
// New posts are "draft" until a person approves them, unless social_settings.auto_approve is on.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const db = createClient(SUPABASE_URL, SERVICE);
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

const THEMES = [
  { key: "pain", brief: "the pain: sellers lose money on ads nobody is watching" },
  { key: "how", brief: "how it works: connect Revora to ChatGPT or Claude, say what you sell, check the plan, say go" },
  { key: "waste", brief: "stopping the ads that cost money and bring no orders, and backing the ones that sell" },
  { key: "real_orders", brief: "seeing real orders next to ad spend, not just clicks" },
  { key: "no_agency", brief: "running ads without an agency or a confusing Ads Manager" },
  { key: "faq", brief: "one common question answered simply (do I need my own ad account, does it spend without asking, how much does it cost)" },
  { key: "phone", brief: "running your ads from your phone, between orders" },
];

const SYSTEM = `You write social posts for Revora, a product that lets online sellers in Nigeria run Facebook and Instagram ads by chatting with ChatGPT or Claude: plan, launch, watch results, stop what wastes money, scale what works. There is a 7-day free trial, prices are in naira, and the team helps people set up.
Write like a real, friendly person who understands small sellers, not a brand and not an ad. Nigerian English, plain words, light Pidgin only now and then.
RULES: First line is a hook of at most 10 words (a pain, a surprise or a question). Short lines, blank line between them. 2 to 4 short paragraphs. One clear call to action at the end. At most 2 emojis. Never promise results or income, never invent numbers, testimonials, prices, discounts or customers, never say "AI-powered" or sound like a press release, no "game-changer", no "unlock", no "revolutionize". Do not start two posts the same way.
Instagram caption: end with "Link in bio." then up to 4 relevant hashtags. Facebook caption: same message, no hashtags, ending with the link https://outreachhq.xyz
Return JSON only: {"caption_ig": string, "caption_fb": string}`;

async function writeCaptions(theme: { key: string; brief: string }, kind: string, count: number, note: string, recent: string[]) {
  const user = `Theme: ${theme.brief}.\nFormat: ${kind === "carousel" ? `a carousel of ${count} swipeable pictures` : kind === "video" ? "a short video" : "one picture"}.\n${note ? "What the picture shows: " + note + "\n" : ""}Openings used recently (do NOT repeat or imitate these):\n${recent.length ? recent.map((r) => "- " + r).join("\n") : "- none yet"}`;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", temperature: 0.9, max_tokens: 700, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
  });
  const o = await r.json();
  if (!r.ok) throw new Error(o?.error?.message || "AI request failed");
  const j = JSON.parse(o?.choices?.[0]?.message?.content ?? "{}");
  if (!j.caption_ig || !j.caption_fb) throw new Error("The writer returned no caption");
  return { caption_ig: String(j.caption_ig).trim(), caption_fb: String(j.caption_fb).trim() };
}

// Lagos is UTC+1 all year. Returns the UTC time for "hour WAT on the WAT date `dayOffset` days from now", nudged by a random +/- jitter.
function slot(dayOffset: number, hourWat: number, jitterMin: number): { when: Date; watDate: string } {
  const nowWat = new Date(Date.now() + 3600_000);
  const d = new Date(Date.UTC(nowWat.getUTCFullYear(), nowWat.getUTCMonth(), nowWat.getUTCDate() + dayOffset, hourWat - 1, 0, 0));
  const jitter = Math.round((Math.random() * 2 - 1) * jitterMin);
  const when = new Date(d.getTime() + jitter * 60_000);
  const watDate = new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);
  return { when, watDate };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const given = req.headers.get("x-cron-secret") || body?.cron_secret || "";
  const { data: sec } = await db.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
  if (!given || (given !== sec?.value && given !== CRON_SECRET)) return json({ error: "Unauthorized" }, 401);
  if (!OPENAI_API_KEY) return json({ error: "AI copy is not switched on (OPENAI_API_KEY)." }, 400);

  const { data: s } = await db.from("social_settings").select("*").eq("id", 1).maybeSingle();
  if (!s) return json({ error: "No social settings" }, 500);
  const action = body?.action ?? "fill";

  const { data: recentRows } = await db.from("social_posts").select("caption_ig").not("caption_ig", "is", null).order("created_at", { ascending: false }).limit(8);
  const recent = (recentRows ?? []).map((r: any) => String(r.caption_ig).split("\n")[0].slice(0, 80));

  if (action === "caption") {
    const urls: string[] = Array.isArray(body?.media_urls) ? body.media_urls : [];
    if (!urls.length) return json({ error: "media_urls is required" }, 400);
    const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
    return json(await writeCaptions(theme, urls.length > 1 ? "carousel" : "image", urls.length, String(body?.note ?? ""), recent));
  }

  if (s.paused) return json({ skipped: "paused" });
  const created: any[] = [];
  const { data: upcoming } = await db.from("social_posts").select("scheduled_for").in("status", ["draft", "approved", "posted"]).gte("scheduled_for", new Date(Date.now() - 12 * 3600_000).toISOString());
  const taken = new Set((upcoming ?? []).map((p: any) => new Date(new Date(p.scheduled_for).getTime() + 3600_000).toISOString().slice(0, 10)));

  for (let offset = 1; offset <= (s.days_ahead ?? 3); offset++) {
    const { when, watDate } = slot(offset, s.post_hour_wat, s.jitter_minutes);
    if (taken.has(watDate)) continue;
    const dayNo = Math.floor(when.getTime() / 86_400_000);
    const wantCarousel = dayNo % 3 === 1;
    const { data: assets } = await db.from("social_assets").select("*").eq("active", true).eq("kind", "image")
      .order("times_used", { ascending: true }).order("last_used_at", { ascending: true, nullsFirst: true }).limit(wantCarousel ? 5 : 1);
    if (!assets?.length) return json({ created: created.length, note: "The picture bank is empty. Add pictures to social_assets.", posts: created });
    const kind = wantCarousel && assets.length >= 3 ? "carousel" : "image";
    const pics = kind === "carousel" ? assets : assets.slice(0, 1);
    const theme = THEMES[dayNo % THEMES.length];
    const note = pics.map((a: any) => a.note).filter(Boolean).join("; ");
    const caps = await writeCaptions(theme, kind, pics.length, note, [...recent, ...created.map((c) => c.hook)]);
    const { data: row, error } = await db.from("social_posts").insert({
      kind, media_urls: pics.map((a: any) => a.url), caption_ig: caps.caption_ig, caption_fb: caps.caption_fb,
      status: s.auto_approve ? "approved" : "draft", scheduled_for: when.toISOString(), theme: theme.key, source: "writer",
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    for (const a of pics) await db.from("social_assets").update({ times_used: (a.times_used ?? 0) + 1 }).eq("id", a.id);
    created.push({ id: row.id, kind, when: when.toISOString(), theme: theme.key, hook: caps.caption_ig.split("\n")[0] });
  }
  return json({ created: created.length, posts: created });
});
