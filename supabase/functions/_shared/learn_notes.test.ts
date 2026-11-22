// Synthetic tests for the learning-note builders. Run: esbuild this --bundle --platform=node --outfile=/tmp/t.js && node /tmp/t.js
import assert from "node:assert/strict";
import { lessonNote, videoNote, pageNote, runNote, failureNote } from "./learn_notes.ts";
const money = (n: number, c: string) => `${c} ${Math.round(n).toLocaleString("en-US")}`;
const l = lessonNote({ scope: "company", feature: "hook_type", value: "question", direction: "positive", n: 12, winners: 7, lift: 1.84, confidence: "medium", claim: "Ads that open with a question sell more.", how_to: "Start with the pain as a question." });
assert.equal(l.kind, "lesson"); assert.match(l.body_md, /Do more of this: Start with the pain/); assert.match(l.body_md, /1.84 times/);
assert.equal(videoNote({ video_id: "v", analysis: {} }), null, "nothing to say, no note");
const v = videoNote({ video_id: "v1", length_s: 31, analysis: { why_it_may_work: "Shows the pain in 2 seconds.", structure: { hook: { from_s: 0, to_s: 3, what: "Man holds his back" } }, how_to_recreate: "Film a back pain moment." } })!;
assert.equal(v.kind, "finding"); assert.match(v.body_md, /hook \(0s to 3s\): Man holds his back/);
assert.equal(pageNote([]), null);
const r = runNote({ id: "r1", status: "done", daily_budget: 3000, total_budget: 9000, billing_currency: "NGN", market_countries: ["NG"], steps: [{ key: "page", label: "Sales page", state: "done" }, { key: "watch", label: "Watch", state: "failed", note: "Meta did not answer" }], watch: { stopped_at: "t", life: { spend: 8950, orders: 4, cost_per_order: 2237.5, conversion_pct: 1.9 }, needs: [{ status: "open" }] } }, "Hyper T", money);
assert.match(r.title, /Autopilot for Hyper T: stopped by the hard stop/); assert.match(r.body_md, /NGN 8,950 spent, 4 orders/); assert.match(r.body_md, /1 item still needs the owner/); assert.match(r.body_md, /stopped \(Meta did not answer\)/);
assert.equal(failureNote("2026-11-24", []), null);
assert.match(failureNote("2026-11-24", [{ what: "Launch of X", why: "Meta refused" }])!.body_md, /Launch of X: Meta refused/);
console.log("learn_notes: all checks passed");
