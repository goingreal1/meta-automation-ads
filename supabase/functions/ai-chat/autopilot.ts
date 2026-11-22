// AUTOPILOT TOOLS for the dashboard assistant. They call the existing ai-team actions (ap_state, ap_start, ap_approve,
// ap_cancel, ap_retry) as the signed-in person (their own token), so ai-team's own owner/admin checks apply.
// Reading is free; start, approve, cancel and retry are never run by the model: bridge.ts puts a confirm card first.
import type { BridgeCtx, ToolDef } from "./bridge.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const AP_GROUP = "ai-team";

const SYMBOL: Record<string, string> = { NGN: "₦", KES: "KSh ", GHS: "GH₵", ZAR: "R", UGX: "USh ", TZS: "TSh ", USD: "$", GBP: "£", CAD: "CA$", AED: "AED " };
export const money = (n: number, cur: string) => `${SYMBOL[cur] ?? (cur || "NGN") + " "}${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

export const AUTOPILOT_DEFS: ToolDef[] = [
  {
    name: "autopilot_status", group: AP_GROUP, title: "Autopilot runs", annotations: { readOnlyHint: true }, write: false,
    description: "Shows the Autopilot runs (the AI team that researches a product, builds the page, makes the pictures, plans the campaign and watches it): each step, what the team said it is doing, and today's numbers. Use it for any question about autopilot progress. Optionally pass the product name.",
    inputSchema: { type: "object", properties: { product: { type: "string", description: "Product name, if the person named one." } } },
  },
  {
    name: "start_autopilot", group: AP_GROUP, title: "Start Autopilot", write: true, annotations: { readOnlyHint: false, destructiveHint: false },
    description: "Starts Autopilot for ONE product: the AI team researches it, builds the sales page, makes the pictures and prepares a campaign. It spends nothing by itself: the campaign only goes live after the person approves it later. Needs the product name, the daily testing budget and the total hard stop (the most it may ever spend), both in the ad account's own currency. Ask for any of the three the person did not say. The person must confirm on a card before it starts.",
    inputSchema: { type: "object", properties: { product: { type: "string" }, daily_budget: { type: "number", description: "Daily testing budget, in the ad account's currency." }, total_budget: { type: "number", description: "Hard stop: the most the whole test may spend, same currency. At least one day of budget." } }, required: ["product", "daily_budget", "total_budget"] },
  },
  {
    name: "approve_autopilot_launch", group: AP_GROUP, title: "Approve the Autopilot launch", write: true, annotations: { readOnlyHint: false, destructiveHint: false },
    description: "Approves the campaign an Autopilot run prepared, so it is scheduled and spends money. Only for a run that is waiting for approval (see autopilot_status). The person's tap on the confirm card is the approval.",
    inputSchema: { type: "object", properties: { product: { type: "string", description: "Product name. Optional when only one run is waiting." } } },
  },
  {
    name: "cancel_autopilot", group: AP_GROUP, title: "Cancel an Autopilot run", write: true, annotations: { readOnlyHint: false, destructiveHint: true },
    description: "Stops an Autopilot run. The person must confirm on a card.",
    inputSchema: { type: "object", properties: { product: { type: "string", description: "Product name. Optional when only one run is active." } } },
  },
  {
    name: "retry_autopilot", group: AP_GROUP, title: "Retry a stuck Autopilot run", write: true, annotations: { readOnlyHint: false, destructiveHint: false },
    description: "Runs the failed or stuck step of an Autopilot run again. The person must confirm on a card.",
    inputSchema: { type: "object", properties: { product: { type: "string", description: "Product name. Optional when only one run needs it." } } },
  },
];

async function aiTeam(ctx: BridgeCtx, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-team`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.token}` }, body: JSON.stringify(body) });
  const o = await r.json().catch(() => ({}));
  return o && typeof o === "object" ? o : { error: `ai-team answered ${r.status}` };
}
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ACTIVE = ["running", "waiting", "live"];

// Picks the run the person means: by product name, or the only one that fits the tool.
function pickRun(state: any, tool: string, name: string): { run?: any; product?: string; error?: string } {
  const prods = new Map<string, string>((state.products ?? []).map((p: any) => [p.id, p.product_name]));
  const want = tool === "approve_autopilot_launch" ? (r: any) => r.status === "waiting" && r.launch_id
    : tool === "retry_autopilot" ? (r: any) => ACTIVE.includes(r.status) || r.status === "failed"
    : (r: any) => ACTIVE.includes(r.status);
  let runs = (state.runs ?? []).filter(want);
  if (name) runs = runs.filter((r: any) => norm(prods.get(r.product_id)).includes(norm(name)) || norm(name).includes(norm(prods.get(r.product_id))));
  if (!runs.length) return { error: tool === "approve_autopilot_launch" ? "No Autopilot run is waiting for approval right now." : "I did not find a matching Autopilot run." };
  if (runs.length > 1) return { error: `More than one run fits: ${runs.map((r: any) => prods.get(r.product_id)).join(", ")}. Ask which product.` };
  return { run: runs[0], product: prods.get(runs[0].product_id) ?? "the product" };
}

// Turns the model's plain-words arguments into ids, and the lines the confirm card shows. Nothing runs here.
export async function prepAutopilot(d: ToolDef, args: Record<string, any>, ctx: BridgeCtx): Promise<{ error?: string; args?: Record<string, any>; lines?: { k: string; v: string }[]; warn?: string; risk?: string }> {
  const st = await aiTeam(ctx, { action: "ap_state" });
  if (st.error) return { error: String(st.error) };
  if (d.name === "start_autopilot") {
    const prods = (st.products ?? []) as any[];
    const m = prods.filter((p) => norm(p.product_name) === norm(args.product)).concat(prods.filter((p) => norm(p.product_name).includes(norm(args.product)))).filter((p, i, a) => a.indexOf(p) === i);
    if (!m.length) return { error: `I did not find an active product called "${args.product}". Your products: ${prods.slice(0, 8).map((p) => p.product_name).join(", ") || "none"}.` };
    if (m.length > 1) return { error: `More than one product fits: ${m.map((p) => p.product_name).join(", ")}. Ask which one.` };
    const p = m[0], acct = (st.accounts ?? []).find((a: any) => a.id === p.ad_account_id), cur = String(acct?.currency ?? st.company?.currency ?? "NGN");
    const daily = Math.round(Number(args.daily_budget) || 0), total = Math.round(Number(args.total_budget) || 0);
    if (daily < 500) return { error: "The daily testing budget is too low. Ask the person for it." };
    if (total < daily) return { error: "The hard stop must be at least one day of budget. Ask the person." };
    return {
      args: { product_id: p.id, daily_budget: daily, total_budget: total, product: p.product_name }, risk: "money",
      lines: [{ k: "Product", v: p.product_name }, { k: "Daily testing budget", v: money(daily, cur) }, { k: "Hard stop (most it can ever spend)", v: money(total, cur) }, { k: "Currency", v: cur }],
      warn: "Starting only lets the AI team prepare the page, pictures and campaign. Nothing is launched or spent until you approve the campaign later.",
    };
  }
  const pr = pickRun(st, d.name, String(args.product ?? ""));
  if (pr.error) return { error: pr.error };
  const run = pr.run;
  const lines: { k: string; v: string }[] = [{ k: "Product", v: pr.product! }, { k: "Run status", v: String(run.status) }];
  if (d.name === "approve_autopilot_launch") {
    const l = (st.launches ?? []).find((x: any) => x.id === run.launch_id), cur = String(run.billing_currency ?? "NGN");
    if (l) {
      lines.push({ k: "Ad sets", v: String((l.ad_sets ?? []).length || "") }, { k: "Daily budget", v: money(Number(run.daily_budget), cur) }, { k: "Hard stop", v: money(Number(run.total_budget), cur) });
      if (l.start_at) lines.push({ k: "Starts", v: new Date(l.start_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " (Nigeria time)" });
    }
    return { args: { run_id: run.id, product: pr.product }, lines: lines.filter((x) => x.v), risk: "money", warn: "Approving puts the page live and schedules the campaign. This is when real money starts to be spent." };
  }
  return { args: { run_id: run.id, product: pr.product }, lines, risk: d.name === "cancel_autopilot" ? "delete" : "edit", warn: d.name === "cancel_autopilot" ? "This stops the run. Nothing already live is deleted." : "Nothing changes until you tap Confirm." };
}

// The person tapped Confirm: do it (the server added nothing to model arguments; the ids come from prepAutopilot).
export async function runAutopilot(d: ToolDef, args: Record<string, any>, ctx: BridgeCtx): Promise<any> {
  if (d.name === "autopilot_status") {
    const st = await aiTeam(ctx, { action: "ap_state" });
    if (st.error) return { error: String(st.error) };
    return summarize(st, String(args.product ?? ""));
  }
  const map: Record<string, string> = { start_autopilot: "ap_start", approve_autopilot_launch: "ap_approve", cancel_autopilot: "ap_cancel", retry_autopilot: "ap_retry" };
  const body: Record<string, unknown> = { action: map[d.name] };
  if (d.name === "start_autopilot") Object.assign(body, { product_id: args.product_id, daily_budget: args.daily_budget, total_budget: args.total_budget, launch_mode: "ask" });
  else body.run_id = args.run_id;
  if (d.name !== "start_autopilot" && !/^[0-9a-f-]{36}$/i.test(String(args.run_id ?? ""))) return { error: "Missing run." };
  const r = await aiTeam(ctx, body);
  if (r.error) return { error: String(r.error) };
  return { ok: true, done: d.name, ...(r.run ? { run_id: r.run.id } : {}), note: d.name === "start_autopilot" ? "Autopilot started. The team is researching the product. Ask for the status to follow it." : undefined };
}

// A short, plain version of the runs for the model and the card.
function summarize(st: any, name: string) {
  const prods = new Map<string, string>((st.products ?? []).map((p: any) => [p.id, p.product_name]));
  let runs = (st.runs ?? []) as any[];
  if (name) runs = runs.filter((r) => norm(prods.get(r.product_id)).includes(norm(name)));
  return {
    runs: runs.slice(0, 4).map((r) => ({
      run_id: r.id, product: prods.get(r.product_id) ?? "Product", status: r.status, current_step: r.step, currency: r.billing_currency,
      daily_budget: r.daily_budget, total_budget: r.total_budget, note: r.note ?? null,
      steps: (Array.isArray(r.steps) ? r.steps : []).map((s: any) => ({ label: s.label, state: s.state, note: s.note ?? "" })),
      team_log: (Array.isArray(r.log) ? r.log : []).slice(-6).map((l: any) => ({ who: l.who, text: l.text })),
      today: r.watch?.today ?? null, waiting_for_approval: r.status === "waiting" && !!r.launch_id,
    })),
  };
}
export function autopilotCard(out: any) {
  if (!out?.runs) return null;
  return { type: "autopilot", runs: out.runs.map((r: any) => ({ ...r, money: r.currency ? { daily: money(r.daily_budget, r.currency), total: money(r.total_budget, r.currency) } : null })) };
}
