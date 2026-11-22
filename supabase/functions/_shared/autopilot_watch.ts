// Pure rules for the autopilot's WATCH step. No network and no database here, so they can be tested alone with synthetic rows.
// Money is always in the ad account's own billing currency; nothing in this file converts a currency.

export type MetaRow = { id: string; name?: string; effective_status?: string; campaign_id?: string; spend?: number; purchases?: number; landing_page_views?: number; clicks?: number; impressions?: number };
export type Numbers = { spend: number; orders: number; lpv: number; clicks: number; impressions: number; cost_per_order: number | null; conversion_pct: number | null };
export type KillRow = { id?: string; level: "campaign" | "adset" | "ad"; meta_object_id: string; object_name?: string | null; action: "paused" | "resumed" | "scaled"; source: "manual" | "auto"; reason?: string | null; created_at: string };
export type Need = { id: string; kind: "hook"; title: string; body: string; status: "open" | "accepted" | "dismissed"; hook?: string; image_id?: string; at: string };
export type LogLine = { who: "Ada" | "Zara" | "Tobi" | "Ife"; text: string };

const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

// Sums the rows of this run's campaign(s). Campaign rows already include their ad sets; if Meta gave only ad sets, those are summed instead.
export function numbersOf(rows: MetaRow[]): Numbers {
  const spend = rows.reduce((a, r) => a + n(r.spend), 0), orders = rows.reduce((a, r) => a + n(r.purchases), 0);
  const lpv = rows.reduce((a, r) => a + n(r.landing_page_views), 0), clicks = rows.reduce((a, r) => a + n(r.clicks), 0), impressions = rows.reduce((a, r) => a + n(r.impressions), 0);
  return { spend: r2(spend), orders, lpv, clicks, impressions, cost_per_order: orders > 0 ? r2(spend / orders) : null, conversion_pct: lpv > 0 ? r2((orders / lpv) * 100) : null };
}

// Only what belongs to this run: its campaign ids, the ad sets under them, the ads under them.
export function runRows(list: { campaigns?: MetaRow[]; adsets?: (MetaRow & { campaign_id?: string })[]; ads?: (MetaRow & { campaign_id?: string })[] }, campaignIds: string[]) {
  const ids = new Set(campaignIds.map(String));
  return {
    campaigns: (list.campaigns ?? []).filter((c) => ids.has(String(c.id))),
    adsets: (list.adsets ?? []).filter((s) => ids.has(String(s.campaign_id))),
    ads: (list.ads ?? []).filter((a) => ids.has(String(a.campaign_id))),
  };
}
export const numbersForRun = (rr: ReturnType<typeof runRows>): Numbers => numbersOf(rr.campaigns.length ? rr.campaigns : rr.adsets);

// What the team did, in its own voice, from the auto-off log (ad_kill_log: the auto-off cron, the kill rules, and people's own taps).
export function teamLines(kills: KillRow[], fmt: (n: number) => string = (x) => String(Math.round(x))): LogLine[] {
  const what = (k: KillRow) => `${k.level === "adset" ? "ad set" : k.level} “${String(k.object_name ?? k.meta_object_id).slice(0, 60)}”`;
  const why = (k: KillRow) => String(k.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 170);
  void fmt;
  return kills.map((k) => {
    const by = k.source === "auto" ? "" : " (you did this yourself)";
    if (k.action === "paused") return { who: "Tobi" as const, text: `I paused ${what(k)}${by}.${why(k) ? " " + why(k) : ""}` };
    if (k.action === "resumed") return { who: "Tobi" as const, text: `${what(k)} was switched back on${by}.` };
    return { who: "Tobi" as const, text: `Budget of ${what(k)} was changed${by}. ${why(k)}`.trim() };
  });
}

// The morning-style line for today's numbers, in the team's voice. One short sentence, plain words.
export function todayLine(day: Numbers, cur: (n: number) => string): LogLine {
  if (day.spend <= 0) return { who: "Tobi", text: "Nothing spent yet today." };
  if (day.orders <= 0) return { who: "Tobi", text: `Today so far: ${cur(day.spend)} spent, no orders yet${day.lpv ? `, ${day.lpv} people reached the page` : ""}.` };
  return { who: "Ife", text: `Today so far: ${day.orders} order${day.orders === 1 ? "" : "s"} for ${cur(day.spend)}, which is ${cur(day.cost_per_order ?? 0)} an order.${day.conversion_pct != null ? ` ${day.conversion_pct}% of page visitors bought.` : ""}` };
}

// A new hook is proposed (never used without the owner's tap) when the run has spent at least half a day's budget without one order,
// and the research still has a hook the ads have not used. One open item at a time.
export function proposeHook(o: { hooks: string[]; used: string[]; lifeSpend: number; lifeOrders: number; dailyBudget: number; needs: Need[] }): string | null {
  if (o.needs.some((x) => x.status === "open")) return null;
  if (o.lifeOrders > 0 || o.lifeSpend < o.dailyBudget * 0.5) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set([...o.used, ...o.needs.map((x) => x.hook ?? "")].map(norm));
  return o.hooks.map((h) => String(h)).find((h) => h.trim() && !seen.has(norm(h))) ?? null;
}

// HARD STOP. The campaign has an end date (start + total/daily days) so that the total should never pass the stop, but Meta may spend up to
// 25% over a day's budget on one day. So every look also compares the run's whole-life spend with the stop amount.
// It stops a little BEFORE the amount (half an hour of normal spending) because the next look is up to ~10 minutes away.
// Returns what to do: "stop" (pause the live campaign(s) now), "warn" (80% reached, say so once) or "ok".
export function hardStopCheck(o: { lifeSpend: number; totalBudget: number; dailyBudget: number; warned?: boolean }): { act: "ok" | "warn" | "stop"; limit: number } {
  const total = Number(o.totalBudget) || 0;
  if (!(total > 0)) return { act: "ok", limit: 0 };
  const limit = Math.max(0, total - (Number(o.dailyBudget) || 0) / 24 / 2);
  if (o.lifeSpend >= limit) return { act: "stop", limit };
  if (!o.warned && o.lifeSpend >= total * 0.8) return { act: "warn", limit };
  return { act: "ok", limit };
}
// Which of the run's campaigns still need a pause: only the ones Meta shows as active (a paused one is left alone).
export const campaignsToPause = (rows: MetaRow[]) => rows.filter((c) => !c.effective_status || c.effective_status === "ACTIVE" || c.effective_status === "WITH_ISSUES" || c.effective_status === "SCHEDULED").map((c) => ({ id: String(c.id), name: String(c.name ?? c.id) }));
