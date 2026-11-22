// Turns what was learned into short plain-words notes (rows of learn_notes). Pure: no network, no database, so it can be tested alone.
export type Note = { kind: "lesson" | "finding" | "autopilot_run" | "failure"; title: string; body_md: string; source_refs: Record<string, unknown> };
const cut = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function lessonNote(l: { id?: string; scope: string; feature: string; value: string; direction: string; n: number; winners: number; lift: number; confidence: string; claim: string; how_to?: string | null }): Note {
  const up = l.direction === "positive";
  return {
    kind: "lesson", title: cut(`New lesson: ${l.feature} = ${l.value}`, 120),
    body_md: `${cut(l.claim, 400)}\n\n${up ? "Do more of this" : "Avoid this"}${l.how_to ? ": " + cut(l.how_to, 400) : "."}\n\nSeen on ${l.n} ads (${l.winners} were winners), ${Math.round(Number(l.lift) * 100) / 100} times the usual rate. Confidence: ${l.confidence}. ${l.scope === "global" ? "A general pattern seen across businesses." : "From this business's own ads."}`,
    source_refs: { lesson_id: l.id ?? null, scope: l.scope },
  };
}

export function videoNote(v: { video_id: string; ad_id?: string | null; length_s?: number | null; analysis?: Record<string, any> | null }): Note | null {
  const a = v.analysis ?? {}; if (!a.why_it_may_work && !a.structure) return null;
  const st = a.structure ?? {};
  const parts = ["hook", "problem", "proof", "product", "offer", "call_to_action"].filter((k) => st[k]?.what).map((k) => `- ${k.replace(/_/g, " ")} (${st[k].from_s ?? "?"}s to ${st[k].to_s ?? "?"}s): ${cut(st[k].what, 140)}`);
  return {
    kind: "finding", title: cut(`Winning video${v.length_s ? ` (${Math.round(Number(v.length_s))}s)` : ""}: ${a.style ? cut(a.style, 60) : "video " + v.video_id}`, 120),
    body_md: `${a.why_it_may_work ? cut(a.why_it_may_work, 500) + "\n\n" : ""}${parts.length ? "How it is built:\n" + parts.join("\n") + "\n\n" : ""}${a.how_to_recreate ? "To make a similar one: " + cut(a.how_to_recreate, 600) : ""}`.trim(),
    source_refs: { video_id: v.video_id, ad_id: v.ad_id ?? null },
  };
}

export function pageNote(pages: { url_norm: string; title?: string | null; meta_description?: string | null }[]): Note | null {
  if (!pages.length) return null;
  return { kind: "finding", title: `Sales pages read (${pages.length})`, body_md: pages.slice(0, 8).map((p) => `- ${cut(p.title || p.url_norm, 90)}${p.meta_description ? ": " + cut(p.meta_description, 140) : ""}`).join("\n"), source_refs: { urls: pages.slice(0, 8).map((p) => p.url_norm) } };
}

const STATE: Record<string, string> = { done: "done", now: "in progress", wait: "not started", needs_you: "waiting for the owner", failed: "stopped" };
export function runNote(r: { id: string; status: string; daily_budget: number; total_budget: number; billing_currency: string; market_countries?: string[]; steps?: { key: string; label: string; state: string; note?: string }[]; watch?: Record<string, any>; log?: { who: string; text: string }[] }, product: string, money: (n: number, c: string) => string): Note {
  const w = r.watch ?? {}, lf = w.life, cur = r.billing_currency;
  const outcome = r.status === "done" ? (w.stopped_at ? "stopped by the hard stop" : "finished") : r.status === "live" ? "live" : r.status === "waiting" ? "waiting for the owner's tap" : r.status === "cancelled" ? "cancelled by the owner" : r.status === "failed" ? "failed" : "running";
  const steps = (r.steps ?? []).map((s) => `- ${s.label}: ${STATE[s.state] ?? s.state}${s.state === "failed" || s.state === "needs_you" ? " (" + cut(s.note, 160) + ")" : ""}`).join("\n");
  const res = lf ? `\n\nResult so far: ${money(lf.spend, cur)} spent, ${lf.orders} order${lf.orders === 1 ? "" : "s"}${lf.cost_per_order != null ? `, ${money(lf.cost_per_order, cur)} an order` : ""}${lf.conversion_pct != null ? `, ${lf.conversion_pct}% of page visitors bought` : ""}.` : "";
  const open = (w.needs ?? []).filter((n: any) => n.status === "open").length;
  return {
    kind: "autopilot_run", title: cut(`Autopilot for ${product}: ${outcome}`, 120),
    body_md: `Budget ${money(r.daily_budget, cur)} a day, hard stop ${money(r.total_budget, cur)}${r.market_countries?.length ? ", market " + r.market_countries.join(", ") : ""}.\n\n${steps}${res}${open ? `\n\n${open} item${open === 1 ? " still needs" : "s still need"} the owner.` : ""}`,
    source_refs: { run_id: r.id, status: r.status },
  };
}

export function failureNote(day: string, items: { what: string; why: string; ref?: Record<string, unknown> }[]): Note | null {
  if (!items.length) return null;
  return { kind: "failure", title: `What failed on ${day} (${items.length})`, body_md: items.slice(0, 12).map((i) => `- ${cut(i.what, 120)}: ${cut(i.why, 220) || "no reason given"}`).join("\n"), source_refs: { items: items.slice(0, 12).map((i) => i.ref ?? {}) } };
}
