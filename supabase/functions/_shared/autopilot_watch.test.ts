// Synthetic-data tests for the autopilot watch rules. Nothing here touches Meta, the database or any money.
// Run: esbuild supabase/functions/_shared/autopilot_watch.test.ts --bundle --platform=node --outfile=/tmp/t.js && node /tmp/t.js   (or: deno test)
import assert from "node:assert/strict";
import { numbersOf, runRows, numbersForRun, teamLines, todayLine, proposeHook, type Need } from "./autopilot_watch.ts";

const list = {
  campaigns: [{ id: "c1", spend: 4500, purchases: 3, landing_page_views: 120, clicks: 200, impressions: 9000 }, { id: "other", spend: 99999, purchases: 50 }],
  adsets: [{ id: "s1", campaign_id: "c1", spend: 4500 }, { id: "s9", campaign_id: "other", spend: 99999 }],
  ads: [{ id: "a1", campaign_id: "c1" }, { id: "a9", campaign_id: "other" }],
};
const rr = runRows(list, ["c1"]);
assert.deepEqual(rr.campaigns.map((c) => c.id), ["c1"], "only this run's campaign");
assert.deepEqual(rr.adsets.map((c) => c.id), ["s1"]);
assert.deepEqual(rr.ads.map((c) => c.id), ["a1"]);
const n = numbersForRun(rr);
assert.equal(n.spend, 4500); assert.equal(n.orders, 3); assert.equal(n.cost_per_order, 1500); assert.equal(n.conversion_pct, 2.5);
// no orders: no cost per order, no divide by zero
const z = numbersOf([{ id: "x", spend: 1000, purchases: 0, landing_page_views: 0 }]);
assert.equal(z.cost_per_order, null); assert.equal(z.conversion_pct, null);
// falls back to ad sets when Meta gave no campaign row
assert.equal(numbersForRun(runRows({ adsets: [{ id: "s1", campaign_id: "c1", spend: 700, purchases: 1 }] }, ["c1"])).spend, 700);

// the team's voice for the auto-off log
const lines = teamLines([
  { level: "ad", meta_object_id: "a1", object_name: "Hook 1", action: "paused", source: "auto", reason: "Spent 1,500 with no sale.", created_at: "t" },
  { level: "adset", meta_object_id: "s1", object_name: "Broad", action: "paused", source: "manual", reason: null, created_at: "t" },
  { level: "adset", meta_object_id: "s1", object_name: "Broad", action: "scaled", source: "auto", reason: "Budget 3,000 → 4,000", created_at: "t" },
]);
assert.equal(lines.length, 3); assert.ok(lines.every((l) => l.who === "Tobi"));
assert.match(lines[0].text, /paused ad “Hook 1”\. Spent 1,500 with no sale\./);
assert.match(lines[1].text, /you did this yourself/);
assert.match(lines[2].text, /Budget of ad set “Broad” was changed/);

// today in words
const cur = (x: number) => "₦" + Math.round(x).toLocaleString("en-US");
assert.match(todayLine(numbersOf([]), cur).text, /Nothing spent/);
assert.match(todayLine(z, cur).text, /no orders yet/);
assert.match(todayLine(n, cur).text, /3 orders for ₦4,500.*₦1,500 an order.*2.5%/);

// a new hook is proposed only when half a day's budget bought nothing, never twice at once, never one already used
const base = { hooks: ["Stop the pain tonight", "Why your back hurts", "Third hook"], used: ["STOP THE PAIN TONIGHT"], lifeSpend: 1600, lifeOrders: 0, dailyBudget: 3000, needs: [] as Need[] };
assert.equal(proposeHook(base), "Why your back hurts", "skips the hook already used (case and punctuation ignored)");
assert.equal(proposeHook({ ...base, lifeSpend: 1400 }), null, "not enough spent yet");
assert.equal(proposeHook({ ...base, lifeOrders: 1 }), null, "it has sold, leave it");
const open: Need = { id: "n", kind: "hook", title: "", body: "", status: "open", hook: "Why your back hurts", at: "" };
assert.equal(proposeHook({ ...base, needs: [open] }), null, "one open item at a time");
assert.equal(proposeHook({ ...base, needs: [{ ...open, status: "dismissed" }] }), "Third hook", "a dismissed hook is not offered again");
assert.equal(proposeHook({ ...base, hooks: ["Stop the pain tonight"] }), null, "no unused hook left");
console.log("autopilot_watch: all checks passed");

// ---- hard stop (synthetic rows, nothing real) ----
import { hardStopCheck, campaignsToPause } from "./autopilot_watch.ts";
// run: 3,000 a day, hard stop 9,000 (3 days). Limit is 9,000 minus half an hour of normal spend (62.5) = 8,937.5
assert.deepEqual(hardStopCheck({ lifeSpend: 2000, totalBudget: 9000, dailyBudget: 3000 }), { act: "ok", limit: 8937.5 });
assert.equal(hardStopCheck({ lifeSpend: 7300, totalBudget: 9000, dailyBudget: 3000 }).act, "warn", "80% reached: say so once");
assert.equal(hardStopCheck({ lifeSpend: 7300, totalBudget: 9000, dailyBudget: 3000, warned: true }).act, "ok", "already warned");
assert.equal(hardStopCheck({ lifeSpend: 8940, totalBudget: 9000, dailyBudget: 3000 }).act, "stop", "just under the stop: stop");
// Meta overspends day 1 by 25% and day 2 by 25%: 3,750 + 3,750 + 1,600 so far = 9,100 before the third day ended -> stop
assert.equal(hardStopCheck({ lifeSpend: 3750 + 3750 + 1600, totalBudget: 9000, dailyBudget: 3000 }).act, "stop");
assert.equal(hardStopCheck({ lifeSpend: 99999, totalBudget: 0, dailyBudget: 3000 }).act, "ok", "no stop set: do nothing");
// only active campaigns are paused; already-paused ones are left alone
assert.deepEqual(campaignsToPause([{ id: "c1", name: "A", effective_status: "ACTIVE" }, { id: "c2", effective_status: "PAUSED" }, { id: "c3", effective_status: "CAMPAIGN_PAUSED" }]), [{ id: "c1", name: "A" }]);
console.log("hard stop: all checks passed");
