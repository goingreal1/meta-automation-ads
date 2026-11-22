#!/usr/bin/env node
// Sends the repo's own documents to the knowledge base (ads-manager action kb_ingest).
// Usage:  ADS_CRON_SECRET=... node scripts/kb-ingest.mjs [--dry] [--builtin]
//   ADS_CRON_SECRET  the value of app_secrets.ads_cron_secret (never commit or print it)
//   SUPABASE_URL     optional, defaults to the Revora project
//   --dry            only list what would be sent
//   --builtin        also ask the function to refresh the MCP tools, playbook and learned knowledge
// Unchanged documents are skipped by hash on the server, so running this again is cheap. Deleted files are pruned.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.SUPABASE_URL || "https://oicqtpjjwmgsiluvkmpu.supabase.co").replace(/\/$/, "");
const SECRET = process.env.ADS_CRON_SECRET || "";
const DRY = process.argv.includes("--dry");
const SKIP = new Set(["opus-encoder-worker.LICENSE.md"]);
const SITE_PAGES = ["pricing.html", "academy.html", "developers.html", "integrations.html", "security.html", "about.html", "refund.html"];

const ls = (dir) => { try { return readdirSync(join(ROOT, dir)).filter((f) => statSync(join(ROOT, dir, f)).isFile()).map((f) => (dir ? dir + "/" : "") + f); } catch { return []; } };
const files = [
  ...ls("").filter((f) => f.endsWith(".md") && !SKIP.has(f)).map((f) => ({ path: f, kind: "doc" })),
  ...ls("docs").filter((f) => f.endsWith(".md")).map((f) => ({ path: f, kind: "doc" })),
  { path: "help.html", kind: "help" },
  ...ls("blog").filter((f) => f.endsWith(".html")).map((f) => ({ path: f, kind: "blog" })),
  ...SITE_PAGES.map((f) => ({ path: f, kind: "site" })),
];

function titleOf(path, text, html) {
  if (html) { const m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); if (m) return m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
  else { const m = text.match(/^#\s+(.+)$/m); if (m) return m[1].trim(); }
  return path;
}
// Secrets must never leave this machine inside a document (the server redacts too).
const redact = (t) => t.replace(/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[redacted-token]").replace(/\b(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{20,}\b/g, "[redacted-key]").replace(/\bEAA[A-Za-z0-9]{30,}\b/g, "[redacted-token]").replace(/\b[0-9a-f]{40,}\b/gi, "[redacted-hex]");
const docs = files.map(({ path, kind }) => {
  const text = redact(readFileSync(join(ROOT, path), "utf8"));
  const html = path.endsWith(".html");
  return { scope: "global", source: "repo/" + path, kind, title: titleOf(path, text, html), url: html ? "/" + path : "https://github.com/goingreal1/meta-automation-ads/blob/main/" + path, format: html ? "html" : "text", text };
});

if (DRY) { for (const d of docs) console.log(d.kind.padEnd(5), String(d.text.length).padStart(7), d.source, "|", d.title); process.exit(0); }
// --emit-sql <dir>: write one .sql file per batch that calls kb_ingest from inside Postgres (net.http_post, secret read from app_secrets there).
const emitIdx = process.argv.indexOf("--emit-sql");
if (emitIdx > 0) {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const dir = process.argv[emitIdx + 1]; mkdirSync(dir, { recursive: true });
  const keepAll = docs.map((d) => d.source);
  for (let i = 0, n = 0; i < docs.length; i += 6, n++) {
    const last = i + 6 >= docs.length;
    const body = JSON.stringify({ action: "kb_ingest", documents: docs.slice(i, i + 6), prune: last ? [{ scope: "global", source_prefix: "repo/", keep: keepAll }] : [] });
    if (body.includes("$kb$")) throw new Error("document contains the SQL quote tag");
    writeFileSync(join(dir, String(n).padStart(3, "0") + ".sql"), "select net.http_post(url := '" + BASE + "/functions/v1/ads-manager', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='ads_cron_secret')), body := $kb$" + body + "$kb$::jsonb, timeout_milliseconds := 140000) as request_id;\n");
  }
  console.log("wrote", Math.ceil(docs.length / 6), "files to", dir); process.exit(0);
}
if (!SECRET) { console.error("Set ADS_CRON_SECRET (not printed anywhere)."); process.exit(1); }

async function call(body) {
  const r = await fetch(BASE + "/functions/v1/ads-manager", { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": SECRET }, body: JSON.stringify({ action: "kb_ingest", ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error("kb_ingest HTTP " + r.status + " " + JSON.stringify(j).slice(0, 300));
  return j;
}
const tot = { added: 0, updated: 0, unchanged: 0, chunks: 0, deleted: 0, errors: [] };
const keep = docs.map((d) => d.source);
for (let i = 0; i < docs.length; i += 6) {
  const last = i + 6 >= docs.length;
  const j = await call({ documents: docs.slice(i, i + 6), prune: last ? [{ scope: "global", source_prefix: "repo/", keep }] : [] });
  for (const k of ["added", "updated", "unchanged", "chunks", "deleted"]) tot[k] += j[k] || 0;
  tot.errors.push(...(j.errors || []));
  if (j.capped || j.timed_out) { tot.errors.push("stopped early: " + (j.capped ? "spend cap" : "time budget") + ", run again"); break; }
}
if (process.argv.includes("--builtin")) {
  const j = await call({ builtin: ["mcp", "learned"] });
  console.log("builtin:", JSON.stringify({ added: j.added, updated: j.updated, unchanged: j.unchanged, chunks: j.chunks, deleted: j.deleted, capped: j.capped, timed_out: j.timed_out, builtin: j.builtin, errors: j.errors }));
}
console.log("repo documents:", JSON.stringify(tot));
