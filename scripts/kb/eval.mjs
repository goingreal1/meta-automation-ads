#!/usr/bin/env node
// Knowledge-base evaluation (retrieval quality).
//   node scripts/kb/eval.mjs --emit-sql out.sql
//        writes SQL that asks kb_search every question in eval-questions.json from inside Postgres
//        (net.http_post with the cron secret read from app_secrets there; the secret never leaves the database).
//   node scripts/kb/eval.mjs --score responses.json titles.json
//        responses.json = rows of {n, content} from net._http_response joined to the request numbers
//        titles.json    = rows of {title, source} from kb_documents (maps a result title back to its document source)
//        prints top-1 / top-3 / top-5 hit rates and every miss.
// A question is a hit at k when one of the first k results belongs to a document whose source contains an expected string.
import { readFileSync, writeFileSync } from "node:fs";
const qs = JSON.parse(readFileSync(new URL("./eval-questions.json", import.meta.url), "utf8"));
const emit = process.argv.indexOf("--emit-sql");
const score = process.argv.indexOf("--score");
if (emit > 0) {
  const url = "https://oicqtpjjwmgsiluvkmpu.supabase.co/functions/v1/ads-manager";
  const rows = qs.map((q, n) => `(${n}, $q$${q.q}$q$, ${q.company ? `'${q.company}'` : "null"})`).join(",\n");
  writeFileSync(process.argv[emit + 1], `with req(n, q, company) as (values ${rows})
select n, net.http_post(url := '${url}', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='ads_cron_secret')), body := jsonb_build_object('action','kb_search','query',q,'k',5,'ctx',jsonb_build_object('companyId',company,'role','owner')), timeout_milliseconds := 60000) as request_id from req order by n;\n`);
  console.log("wrote", process.argv[emit + 1]);
} else if (score > 0) {
  const resp = JSON.parse(readFileSync(process.argv[score + 1], "utf8"));
  const titles = new Map(JSON.parse(readFileSync(process.argv[score + 2], "utf8")).map((r) => [r.title, r.source]));
  const hit = { 1: 0, 3: 0, 5: 0 }; const misses = [];
  for (const r of resp) {
    const q = qs[r.n]; const body = typeof r.content === "string" ? JSON.parse(r.content) : r.content;
    const srcs = (body.results || []).map((x) => titles.get(x.doc_title) || "?" + x.doc_title);
    const rank = srcs.findIndex((s) => q.expect.some((e) => s.includes(e)));
    for (const k of [1, 3, 5]) if (rank >= 0 && rank < k) hit[k]++;
    if (rank < 0 || rank >= 3) misses.push({ q: q.q, expect: q.expect, rank: rank < 0 ? "none" : rank + 1, got: srcs.slice(0, 5) });
  }
  const n = resp.length;
  console.log(`questions ${n}: top-1 ${hit[1]}/${n} (${Math.round(100 * hit[1] / n)}%), top-3 ${hit[3]}/${n} (${Math.round(100 * hit[3] / n)}%), top-5 ${hit[5]}/${n} (${Math.round(100 * hit[5] / n)}%)`);
  for (const m of misses) console.log("MISS(top-3):", JSON.stringify(m));
}
