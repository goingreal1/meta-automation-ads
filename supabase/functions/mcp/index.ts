import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Revora MCP server (Model Context Protocol, streamable HTTP, stateless JSON): the ROUTER.
// Lets the Claude app and ChatGPT use Revora: the person signs in with their own Revora account (Supabase OAuth),
// and every tool runs as THEM, with the same role rules as the dashboard.
//
// This function only does what rarely changes: sign-in, the JSON-RPC protocol, the inline PIN form, receipts, the transfer-PIN
// endpoints, and the audit log and daily limits. The tools themselves live in three small functions it calls internally:
//   mcp-ads (ads, products, kill rules, playbook), mcp-money (funding and transfers), mcp-studio (pictures and sales pages).
// To change a tool, redeploy only the function that holds it. Each group answers { action: "list" } and { action: "call", tool, args, ctx }.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const VERSION = "1.0.0";
const DIRECT = `${SUPABASE_URL}/functions/v1/mcp`;
// Revora's own address (a Vercel rewrite to this function). It carries the Revora favicon and logo, so Claude and ChatGPT show our brand.
const SITE = "https://metaautomationads.vercel.app";
const BRANDED = `${SITE}/mcp`;
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, accept, x-client-info, apikey",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
const jres = (obj: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });
const unauthorized = (resource: string, msg = "Sign in to Revora to use this connector.") =>
  jres({ error: "unauthorized", error_description: msg }, 401, { "WWW-Authenticate": `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource"` });

const naira = (n: unknown) => "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");

type Ctx = { token: string; userId: string; email: string | null; companyId: string; role: string; mediaBuyerId: string | null; displayName: string };

// -- transfer PIN --
// Money moves only after the person types their own transfer PIN into a private Revora page (approve.html) or the inline form. The PIN is never part of any
// tool call, so the assistant cannot see it. Approvals are created by mcp-money and checked here.
const PIN_RE = /^\d{4,6}$/;
const WEAK_PINS = new Set(["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234", "4321", "123456", "654321", "000000", "111111", "121212", "112233"]);
const hexRand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256hex = async (t: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const safeEq = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
async function pinHash(userId: string, pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const mk = await crypto.subtle.importKey("raw", enc.encode(SERVICE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const peppered = new Uint8Array(await crypto.subtle.sign("HMAC", mk, enc.encode(`${userId}:${pin}`)));
  const base = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g) ?? [], (h) => parseInt(h, 16));
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, base, 256));
  return Array.from(bits).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function checkPin(userId: string, pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row } = await admin.from("transfer_pins").select("pin_hash, salt, failed_attempts, locked_until").eq("user_id", userId).maybeSingle();
  if (!row) return { ok: false, error: "No transfer PIN is set yet. Set one in Revora under Settings, Security." };
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) return { ok: false, error: "Too many wrong PINs. Try again in a few minutes." };
  if (safeEq(await pinHash(userId, pin, row.salt), row.pin_hash)) {
    if (row.failed_attempts || row.locked_until) await admin.from("transfer_pins").update({ failed_attempts: 0, locked_until: null }).eq("user_id", userId);
    return { ok: true };
  }
  const n = Number(row.failed_attempts || 0) + 1, lock = n >= 5;
  await admin.from("transfer_pins").update({ failed_attempts: lock ? 0 : n, locked_until: lock ? new Date(Date.now() + 15 * 60_000).toISOString() : null }).eq("user_id", userId);
  return { ok: false, error: lock ? "Too many wrong PINs. Locked for 15 minutes." : `Wrong PIN. ${5 - n} ${5 - n === 1 ? "try" : "tries"} left.` };
}
async function passwordOk(email: string | null, password: string): Promise<boolean> {
  if (!email || !password) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? SERVICE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).catch(() => null);
  return !!r?.ok;
}
const receiptNo = (n: unknown, at: unknown) => `RV-${new Date(String(at ?? Date.now())).getUTCFullYear()}-${String(n ?? 0).padStart(6, "0")}`;
async function receiptGet(req: Request, url: URL): Promise<Response> {
  const id = String(url.searchParams.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jres({ error: "not_found" }, 404);
  const { data: r } = await admin.from("transfer_receipts").select("id, receipt_no, kind, amount_naira, account_name, account_number, bank_name, status, failure_reason, approved_with, paystack_reference, created_at, updated_at").eq("id", id).maybeSingle();
  if (!r) return jres({ error: "not_found" }, 404);
  return jres({ id: r.id, receipt_no: receiptNo(r.receipt_no, r.created_at), kind: r.kind, amount: naira(r.amount_naira), amount_naira: Number(r.amount_naira), account_name: r.account_name, account_number: r.account_number, bank: r.bank_name, status: r.status, failure_reason: r.failure_reason, approved_with: r.approved_with, reference: r.paystack_reference, created_at: r.created_at, updated_at: r.updated_at });
}
async function widgetApprove(req: Request): Promise<Response> {
  if (req.method !== "POST") return jres({ error: "method_not_allowed" }, 405);
  let b: any = {}; try { b = await req.json(); } catch { /* empty body */ }
  const id = String(b?.approval_id ?? ""), secret = String(b?.secret ?? ""), pin = String(b?.pin ?? "");
  const bad = () => jres({ error: "This approval is not valid. Ask your assistant to start the transfer again." }, 403);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{32}$/.test(secret)) return bad();
  const { data: ap } = await admin.from("transfer_approvals").select("*").eq("id", id).maybeSingle();
  if (!ap || !ap.secret_hash || !safeEq(await sha256hex(secret), ap.secret_hash)) return bad();
  if (ap.used_at) return jres({ error: "This transfer was already sent or cancelled." }, 410);
  if (new Date(ap.expires_at).getTime() < Date.now()) return jres({ error: "This approval expired. Ask your assistant to start the transfer again." }, 410);
  const info = { amount: naira(ap.amount_naira), account_name: ap.account_name, account_number: ap.account_number, bank: ap.bank_name };
  if (!ap.approved_at) {
    if (!PIN_RE.test(pin)) return jres({ error: "Enter your 4 to 6 digit transfer PIN." }, 400);
    const r = await checkPin(ap.user_id, pin);
    if (!r.ok) return jres({ error: r.error }, 403);
    const { error } = await admin.from("transfer_approvals").update({ approved_at: new Date().toISOString() }).eq("id", id).is("approved_at", null).is("used_at", null);
    if (error) return jres({ error: "Could not record the approval." }, 500);
  }
  // The PIN is right: the form now sends this exact transfer itself (mcp-money takes the approval once). A failure leaves the approval open for a retry.
  const ex = await groupCall("mcp-money", { action: "execute", approval_id: id }).catch((e: Error) => ({ result: { error: e.message } }));
  if (!ex?.result?.widget) return jres({ approved: true, retry: true, error: ex?.result?.error ?? "Could not send the transfer. Try again in a moment." }, 502);
  await admin.from("transfer_approvals").update({ secret_hash: null }).eq("id", id);
  return jres({ ok: true, approved: true, sent: true, widget: ex.result.widget, ...info });
}
async function handlePin(path: string, req: Request, c: Ctx): Promise<Response> {
  if (req.method !== "POST") return jres({ error: "method_not_allowed" }, 405);
  let b: any = {}; try { b = await req.json(); } catch { /* empty body */ }
  const pin = String(b?.pin ?? "");
  if (path === "/pin/status") {
    const { data } = await admin.from("transfer_pins").select("updated_at, locked_until").eq("user_id", c.userId).maybeSingle();
    return jres({ has_pin: !!data, updated_at: data?.updated_at ?? null, locked: !!(data?.locked_until && new Date(data.locked_until).getTime() > Date.now()) });
  }
  if (path === "/pin/set") {
    if (!["owner", "admin", "buyer"].includes(c.role)) return jres({ error: "Only owners, admins and media buyers use a transfer PIN." }, 403);
    if (!PIN_RE.test(pin)) return jres({ error: "The PIN must be 4 to 6 digits." }, 400);
    if (WEAK_PINS.has(pin)) return jres({ error: "That PIN is too easy to guess. Pick another." }, 400);
    const { data: ex } = await admin.from("transfer_pins").select("user_id").eq("user_id", c.userId).maybeSingle();
    if (ex) {
      if (b?.current_pin) { const r = await checkPin(c.userId, String(b.current_pin)); if (!r.ok) return jres({ error: r.error }, 403); }
      else if (b?.password) { if (!(await passwordOk(c.email, String(b.password)))) return jres({ error: "That password is not right." }, 403); }
      else return jres({ error: "Enter your current PIN, or your account password if you forgot it." }, 400);
    }
    const salt = hexRand(16);
    const { error } = await admin.from("transfer_pins").upsert({ user_id: c.userId, pin_hash: await pinHash(c.userId, pin, salt), salt, failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() });
    return error ? jres({ error: "Could not save the PIN." }, 500) : jres({ ok: true });
  }
  if (path === "/pin/approval" || path === "/pin/approve") {
    const id = String(b?.approval_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return jres({ error: "That approval link is not valid." }, 400);
    const { data: ap } = await admin.from("transfer_approvals").select("*").eq("id", id).eq("user_id", c.userId).maybeSingle();
    if (!ap) return jres({ error: "That approval was not found for your login. Open the link while signed in as the person who asked for the transfer." }, 404);
    if (ap.used_at) return jres({ error: "This transfer was already sent or cancelled." }, 410);
    if (new Date(ap.expires_at).getTime() < Date.now()) return jres({ error: "This approval expired. Ask your assistant to start the transfer again." }, 410);
    const info = { kind: ap.kind, amount: naira(ap.amount_naira), account_name: ap.account_name, account_number: ap.account_number, bank: ap.bank_name, approved: !!ap.approved_at, expires_at: ap.expires_at };
    if (path === "/pin/approval") return jres({ ok: true, ...info });
    if (ap.approved_at) return jres({ ok: true, ...info, approved: true });
    if (!PIN_RE.test(pin)) return jres({ error: "Enter your 4 to 6 digit transfer PIN." }, 400);
    const r = await checkPin(c.userId, pin);
    if (!r.ok) return jres({ error: r.error }, 403);
    const { error } = await admin.from("transfer_approvals").update({ approved_at: new Date().toISOString() }).eq("id", id).is("approved_at", null).is("used_at", null);
    return error ? jres({ error: "Could not record the approval." }, 500) : jres({ ok: true, ...info, approved: true });
  }
  return jres({ error: "not_found" }, 404);
}

const PIN_WIDGET = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:light dark;--text:#14130f;--text2:#55524a;--muted:#8c887c;--border:#d9d5ca;--accent:#1877F2;--ok:#16a34a;--err:#dc2626}
@media (prefers-color-scheme:dark){:root{--text:#f2f0ea;--text2:#b9b5a8;--muted:#8c887c;--border:#3a3935}}
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--text);background:transparent;padding:12px}
.brand{font-weight:700;font-size:11px;letter-spacing:.05em;color:var(--accent);margin-bottom:8px}
.amt{font-size:28px;font-weight:700;letter-spacing:-.02em}
.row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--border)}
.row span:first-child{color:var(--muted)}.row b{text-align:right;word-break:break-word}
.pin{width:100%;margin-top:12px;font-size:22px;letter-spacing:.45em;text-align:center;padding:10px;border:1.5px solid var(--border);border-radius:10px;background:transparent;color:var(--text);font-family:inherit}
.pin:focus{outline:none;border-color:var(--accent)}
button{width:100%;margin-top:10px;padding:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer}
button:disabled{opacity:.55;cursor:default}
.msg{margin-top:10px;font-size:13px;border-radius:8px;padding:8px 10px}
.err{background:rgba(220,38,38,.12);color:var(--err)}
.ok{background:rgba(22,163,74,.12);color:var(--ok)}
.note{margin-top:10px;font-size:11.5px;color:var(--muted)}
a{color:var(--accent)}
.rc{border-radius:22px;padding:18px 18px 14px;color:#fff;background:linear-gradient(135deg,#1c1c1e 0%,#2b2b2e 55%,#1a1a1c 100%)}
.rc.ok{background:linear-gradient(135deg,#1f9d4a 0%,#34c759 100%)}
.rc.bad{background:linear-gradient(135deg,#7f1d1d 0%,#dc2626 100%)}
.rc .hd{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px}
.rc .lg{width:28px;height:28px;border-radius:8px;background:#1877F2;display:grid;place-items:center;font-weight:800;font-size:15px}
.rc .am{font-size:38px;font-weight:700;letter-spacing:-.02em;margin:16px 0 4px}
.rc .st{font-size:13px;color:rgba(255,255,255,.82)}
.rc .rw{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid rgba(255,255,255,.14);font-size:12.5px}
.rc .rw span{color:rgba(255,255,255,.62)}.rc .rw b{font-weight:600;text-align:right;word-break:break-word}
.rc .ft{margin-top:10px;font-size:11px;color:rgba(255,255,255,.55);display:flex;justify-content:space-between;gap:8px}
.rc a{color:#fff}
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var API = "__API__", STATUS = "__STATUS__", RETRY = false;
  var root = document.getElementById("root");
  var W = null, SECRET = "", LINK = "", busy = false, SENT = false;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); };

  // ---- host plumbing: ChatGPT (window.openai) and MCP Apps hosts (postMessage JSON-RPC, e.g. Claude) ----
  var nextId = 1, waiting = {};
  function rpc(method, params) { return new Promise(function (res) { var id = nextId++; waiting[id] = res; try { window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params }, "*"); } catch (e) { res(null); } }); }
  function note(method, params) { try { window.parent.postMessage({ jsonrpc: "2.0", method: method, params: params }, "*"); } catch (e) { /* no host */ } }
  function resize() { try { var h = Math.ceil(document.documentElement.getBoundingClientRect().height); note("ui/notifications/size-changed", { height: h }); if (window.openai && window.openai.notifyIntrinsicHeight) window.openai.notifyIntrinsicHeight(h); } catch (e) { /* ignore */ } }
  function take(structured, meta) {
    if (SENT) return; // once the transfer is sent, host re-renders must not bring the PIN form back
    var w = structured && structured.pin_widget;
    W = w || null;
    SECRET = (meta && meta.pin_secret) || "";
    draw();
  }
  function fromChatGPT() {
    var o = window.openai; if (!o) return;
    var out = o.toolOutput || null, id = out && out.pin_widget && out.pin_widget.approval_id, ws = o.widgetState;
    if (SENT) return;
    if (ws && ws.sent && (!id || ws.sent.approval_id === id)) { W = ws.sent; SENT = true; SECRET = ""; draw(); return; }
    take(out, o.toolResponseMetadata || null);
  }
  if (window.openai) { fromChatGPT(); window.addEventListener("openai:set_globals", fromChatGPT); }
  window.addEventListener("message", function (e) {
    var m = e.data; if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && waiting[m.id] && !m.method) { waiting[m.id](m.result || null); delete waiting[m.id]; return; }
    if (m.method === "ui/notifications/tool-result") { var p = m.params || {}; take(p.structuredContent || null, p._meta || null); }
  });
  if (!window.openai) { rpc("ui/initialize", { protocolVersion: "2025-11-21", appInfo: { name: "revora-transfer-approval", version: "1.0.0" }, appCapabilities: {} }).then(function () { note("ui/notifications/initialized", {}); }); }
  function tellChat(text) {
    try { if (window.openai && window.openai.sendFollowUpMessage) { window.openai.sendFollowUpMessage({ prompt: text }); return; } } catch (e) { /* ignore */ }
    rpc("ui/message", { role: "user", content: { type: "text", text: text } });
  }
  function openLink(url) { try { if (window.openai && window.openai.openExternal) { window.openai.openExternal({ href: url }); return; } } catch (e) { /* ignore */ } rpc("ui/open-link", { url: url }); }

  // ---- receipt card (after the money is sent) ----
  var pollN = 0, pollT = null;
  function receiptCard(w) {
    var st = w.status === "delivered" ? "ok" : w.status === "failed" ? "bad" : "";
    var label = w.status === "delivered" ? "Transfer sent successfully \u2713" : w.status === "failed" ? "Failed. The money goes back to your wallet" : "Processing\u2026";
    var when = w.created_at ? new Date(w.created_at).toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    return '<div class="rc ' + st + '"><div class="hd"><div class="lg">R</div>Revora Transfer</div>' +
      '<div class="am">' + esc(w.amount) + '</div><div class="st">' + label + '</div>' +
      '<div style="margin-top:12px">' +
      '<div class="rw"><span>To</span><b>' + esc(w.account_name || "") + '</b></div>' +
      (w.bank ? '<div class="rw"><span>Bank</span><b>' + esc(w.bank) + '</b></div>' : "") +
      (w.account_number ? '<div class="rw"><span>Account</span><b>' + esc(w.account_number) + '</b></div>' : "") +
      '<div class="rw"><span>Approved with</span><b>Transfer PIN</b></div>' +
      (when ? '<div class="rw"><span>Date</span><b>' + esc(when) + '</b></div>' : "") + '</div>' +
      '<div class="ft"><span>' + esc(w.receipt_no || "") + '</span>' + "" + '</div></div>';
  }
  function startPoll() {
    if (pollT || !W || !W.receipt_id || W.status === "delivered" || W.status === "failed") return;
    pollT = setInterval(function () {
      if (++pollN > 40 || !W || W.status === "delivered" || W.status === "failed") { clearInterval(pollT); pollT = null; return; }
      fetch(STATUS + "?id=" + encodeURIComponent(W.receipt_id)).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.status && j.status !== W.status) { W.status = j.status; draw(); }
      }).catch(function () { /* try again next tick */ });
    }, 6000);
  }

  // ---- view ----
  function details(w) {
    return '<div class="brand">REVORA</div><div class="amt">' + esc(w.amount) + '</div>' +
      '<div class="row"><span>To</span><b>' + esc(w.account_name || "") + '</b></div>' +
      (w.account_number ? '<div class="row"><span>Account</span><b>' + esc(w.account_number) + '</b></div>' : "") +
      (w.bank ? '<div class="row"><span>Bank</span><b>' + esc(w.bank) + '</b></div>' : "");
  }
  function draw() {
    if (!W) { root.innerHTML = ""; document.body.style.padding = "0"; resize(); return; }
    document.body.style.padding = "12px";
    if (W.state === "sent") { root.innerHTML = receiptCard(W); resize(); startPoll(); return; }
    if (W.state === "approved") { root.innerHTML = details(W) + '<div class="msg ok">✅ Approved with your PIN. Tell your assistant “done”.</div>'; resize(); return; }
    var canInline = !!SECRET;
    root.innerHTML = details(W) +
      (canInline
        ? '<form id="f" autocomplete="off"><input class="pin" id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Transfer PIN" aria-label="Transfer PIN"><button type="submit" id="go">Approve with PIN</button><div id="m"></div></form><div class="note">Your PIN goes straight to Revora. It is never shown to the AI.</div>'
        : '<div class="note">This form cannot take your PIN here. Ask your assistant to start the transfer again.</div>') +
      "";
    var f = document.getElementById("f");
    if (f) {
      var pin = document.getElementById("pin");
      pin.addEventListener("input", function () { pin.value = pin.value.replace(/\D/g, "").slice(0, 6); });
      f.addEventListener("submit", submit);
    }
    resize();
  }
  function submit(e) {
    e.preventDefault(); if (busy) return;
    var pin = document.getElementById("pin"), go = document.getElementById("go"), m = document.getElementById("m");
    if (!RETRY && pin.value.length < 4) { m.innerHTML = '<div class="msg err">Enter your 4 to 6 digit PIN.</div>'; resize(); return; }
    busy = true; go.disabled = true; go.textContent = "Checking…"; m.innerHTML = "";
    fetch(API + "/pin/widget-approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approval_id: W.approval_id, secret: SECRET, pin: pin.value }) })
      .then(function (r) { return r.json().catch(function () { return { error: "Something went wrong." }; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .catch(function () { return { ok: false, j: { error: "Could not reach Revora. Check your connection." } }; })
      .then(function (r) {
        busy = false; pin.value = "";
        if (r.ok && r.j.sent && r.j.widget) { W = r.j.widget; SECRET = ""; SENT = true; try { if (window.openai && window.openai.setWidgetState) window.openai.setWidgetState({ sent: W }); } catch (e) { /* ignore */ } draw(); tellChat("I approved it with my PIN and it was sent (receipt " + (W.receipt_no || "") + "). No need to send it again: just tell me in one short line."); return; }
        if (r.j.approved) RETRY = true;
        go.disabled = false; go.textContent = RETRY ? "Try sending again" : "Approve with PIN";
        m.innerHTML = '<div class="msg err">' + esc(r.j.error || "Could not approve.") + '</div>' ;
        resize();
      });
  }
  draw();
})();
</script>
</body>
</html>
`.replace("__API__", DIRECT).replace("__STATUS__", `${SUPABASE_URL}/functions/v1/receipt-status`);
const UI_OPENAI = "ui://widget/revora-pin-v2.html", UI_APPS = "ui://revora/pin.html";
const RES_META_OPENAI = { "openai/widgetCSP": { connect_domains: [SUPABASE_URL], resource_domains: [] }, "openai/widgetPrefersBorder": true, "openai/widgetDescription": "Approve a money transfer with your private transfer PIN." };
const RES_META_APPS = { ui: { csp: { connectDomains: [SUPABASE_URL] }, prefersBorder: true } };

const SETUP_NEEDED = `This Revora login has not finished setting up yet. Tell the person to open ${SITE}/setup-company.html and choose Personal or Company (it takes a minute), then come back and ask again.`;
const LIMITS = { write_per_day: 80, launch_per_day: 5 };
function clip(args: any) { try { const s = JSON.stringify(args ?? {}); return s.length > 1500 ? { truncated: s.slice(0, 1500) } : args; } catch { return {}; } }

// ── tool groups ──────────────────────────────────────────────────────────────────────────────
const GROUPS = ["mcp-ads", "mcp-money", "mcp-studio"];
type Def = { name: string; title: string; description: string; inputSchema: any; annotations: any; meta?: Record<string, unknown>; write?: boolean; heavy?: boolean; group: string };
const known = new Map<string, { at: number; defs: Def[] }>();
async function groupCall(group: string, payload: unknown): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${group}`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": SERVICE_KEY }, body: JSON.stringify(payload) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(`${group} answered ${r.status}`); }
}
// The list of tools, remembered for a minute. If one group is down, its last known tools are kept so the others keep working.
async function manifest(): Promise<Def[]> {
  await Promise.all(GROUPS.map(async (g) => {
    const have = known.get(g);
    if (have && Date.now() - have.at < 60_000) return;
    try { const j = await groupCall(g, { action: "list" }); if (Array.isArray(j?.tools) && j.tools.length) known.set(g, { at: Date.now(), defs: j.tools.map((t: any) => ({ ...t, group: g })) }); }
    catch (e) { console.error("mcp manifest", g, (e as Error).message); }
  }));
  return GROUPS.flatMap((g) => known.get(g)?.defs ?? []);
}

async function overLimit(t: Def, defs: Def[], c: Ctx): Promise<string | null> {
  if (!t.write) return null;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await admin.from("mcp_audit").select("tool, ok").eq("user_id", c.userId).gte("created_at", since).limit(500);
  const rows = (data ?? []).filter((r: any) => r.ok);
  const names = new Set(defs.filter((x) => x.write).map((x) => x.name));
  // The launches-per-day cap is for ad launches. Money tools have their own limits (per transfer, per day, wallet balance), and previews that send nothing must not use it up.
  if (t.heavy && t.group !== "mcp-money" && rows.filter((r: any) => r.tool === t.name).length >= LIMITS.launch_per_day) return `Daily limit reached: at most ${LIMITS.launch_per_day} launches a day through connected assistants. The dashboard has no such limit.`;
  if (rows.filter((r: any) => names.has(r.tool)).length >= LIMITS.write_per_day) return `Daily limit reached: at most ${LIMITS.write_per_day} changes a day through connected assistants.`;
  return null;
}

async function callTool(name: string, args: any, c: Ctx, client: string) {
  const defs = await manifest();
  const t = defs.find((d) => d.name === name);
  if (!t) return { isError: true, content: [{ type: "text", text: `Unknown tool ${name}.` }] };
  if (!c.companyId && name !== "get_playbook" && name !== "whoami") return { isError: true, content: [{ type: "text", text: SETUP_NEEDED }] };
  const lim = await overLimit(t, defs, c);
  if (lim) return { isError: true, content: [{ type: "text", text: lim }] };
  let out: any, ok = true;
  try { const r = await groupCall(t.group, { action: "call", tool: name, args: args && typeof args === "object" ? args : {}, ctx: c }); out = r?.out ?? { error: r?.error ?? "The tool did not answer." }; }
  catch (e) { out = { error: (e as Error).message }; }
  if (out?.error) ok = false;
  if (t.write) await admin.from("mcp_audit").insert({ company_id: c.companyId, user_id: c.userId, tool: name, args: clip(args), ok, client }).then(() => {}, () => {});

  const imgs: any[] = out?.__images ?? []; if (imgs.length) { out = { ...out }; delete out.__images; }
  const toolMeta = out && typeof out === "object" ? out.__meta : undefined; if (toolMeta) { out = { ...out }; delete out.__meta; }
  const text = typeof out === "string" ? out : JSON.stringify(out, null, 1);
  return { isError: !ok, content: [{ type: "text", text: text.length > 60000 ? text.slice(0, 60000) + "\n…(shortened)" : text }, ...imgs.map((m) => ({ type: "image", data: m.data, mimeType: m.mimeType }))], ...(ok && out && typeof out === "object" && !Array.isArray(out) ? { structuredContent: out } : {}), ...(toolMeta ? { _meta: toolMeta } : {}) };
}

const INSTRUCTIONS = "Revora runs Facebook and Instagram ads and orders for Nigerian online sellers. You act for the signed-in person with their own permissions. For anything about launching, reviewing or scaling ads, call get_playbook first and follow it. Never launch, spend or send money without the person's clear yes. Explain results in plain words, never as a dump of numbers.";

async function handleRpc(msg: any, c: Ctx, client: string): Promise<any | null> {
  const id = msg?.id;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (msg?.jsonrpc !== "2.0" || typeof msg?.method !== "string") return err(-32600, "Invalid request");
  if (id === undefined || id === null) return null; // notification
  switch (msg.method) {
    case "initialize": {
      const want = String(msg?.params?.protocolVersion ?? "");
      return reply({ protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0], capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } }, serverInfo: { name: "revora", title: "Revora", version: VERSION, websiteUrl: SITE, icons: [{ src: `${SITE}/icons/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] }, { src: `${SITE}/icons/icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }] }, instructions: INSTRUCTIONS });
    }
    case "ping": return reply({});
    case "tools/list": return reply({ tools: (await manifest()).map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, ...(t.meta ? { _meta: t.meta["openai/outputTemplate"] ? { ...t.meta, "openai/outputTemplate": UI_OPENAI } : t.meta } : {}) })) });
    case "tools/call": return reply(await callTool(String(msg?.params?.name ?? ""), msg?.params?.arguments, c, client));
    case "prompts/list": return reply({ prompts: [{ name: "run_my_ads", title: "Run my ads", description: "Review how the ads are doing and recommend what to do, like a senior media buyer." }, { name: "launch_ads", title: "Launch ads for a product", description: "Plan and launch a campaign for one product, step by step.", arguments: [{ name: "product", description: "Which product", required: true }] }] });
    case "prompts/get": {
      const n = msg?.params?.name;
      if (n === "run_my_ads") return reply({ messages: [{ role: "user", content: { type: "text", text: "Act as my Revora media buyer. Call get_playbook, then get_live_ads for my ad account, and tell me in plain words how my ads are doing: what to keep and scale, what to watch, and which bad ads to relaunch. Do not change anything until I say yes." } }] });
      if (n === "launch_ads") return reply({ messages: [{ role: "user", content: { type: "text", text: `Act as my Revora media buyer and launch ads for ${msg?.params?.arguments?.product ?? "my product"}. Call get_playbook first and follow it exactly. Ask me only what you cannot decide. Do not launch until I clearly approve the plan.` } }] });
      return err(-32602, "Unknown prompt");
    }
    case "resources/list": return reply({ resources: PIN_WIDGET ? [{ uri: UI_OPENAI, name: "Revora transfer approval", mimeType: "text/html+skybridge", _meta: RES_META_OPENAI }, { uri: UI_APPS, name: "Revora transfer approval", mimeType: "text/html;profile=mcp-app", _meta: RES_META_APPS }] : [] });
    case "resources/read": {
      const uri = String(msg?.params?.uri ?? "");
      if (PIN_WIDGET && uri === UI_OPENAI) return reply({ contents: [{ uri, mimeType: "text/html+skybridge", text: PIN_WIDGET, _meta: RES_META_OPENAI }] });
      if (PIN_WIDGET && uri === UI_APPS) return reply({ contents: [{ uri, mimeType: "text/html;profile=mcp-app", text: PIN_WIDGET, _meta: RES_META_APPS }] });
      return err(-32602, "Unknown resource");
    }
    default: return err(-32601, `Method not found: ${msg.method}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  let path = url.pathname.replace(/^.*?\/mcp(?=\/|$)/, "") || "/";
  // The Vercel rewrite adds /_site, which tells us the person came in through Revora's own address.
  const viaSite = path === "/_site" || path.startsWith("/_site/");
  if (viaSite) path = path.slice(6) || "/";
  const RESOURCE = viaSite ? BRANDED : DIRECT;

  if (path === "/.well-known/oauth-protected-resource" || path.startsWith("/.well-known/oauth-protected-resource/")) {
    return jres({ resource: RESOURCE, authorization_servers: [`${SUPABASE_URL}/auth/v1`], bearer_methods_supported: ["header"], resource_name: "Revora", scopes_supported: ["openid", "email", "profile"] });
  }
  if (path === "/health" || (req.method === "GET" && path === "/")) {
    if (url.searchParams.get("probe") === "image") { // free check: does the image model key work? (asks OpenAI for the model, makes no image)
      const k = Deno.env.get("OPENAI_API_KEY") ?? "", m = Deno.env.get("IMAGE_MODEL") ?? "gpt-image-1";
      const r = k ? await fetch(`https://api.openai.com/v1/models/${m}`, { headers: { Authorization: `Bearer ${k}` } }) : null;
      const j: any = r ? await r.json().catch(() => null) : null;
      return jres({ model: m, key_set: !!k, accessible: !!r?.ok, status: r?.status ?? null, error: r && !r.ok ? String(j?.error?.message ?? "").slice(0, 200) : null });
    }
    return jres({ ok: true, service: "revora-mcp", version: VERSION, tools: (await manifest()).length, resource: RESOURCE, widget_bytes: PIN_WIDGET.length });
  }

  if (path === "/pin/widget-approve") return widgetApprove(req);
  if (path === "/receipt/get" && req.method === "GET") return receiptGet(req, url);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return unauthorized(RESOURCE);
  const { data: ud, error: ue } = await admin.auth.getUser(token);
  if (ue || !ud?.user) return unauthorized(RESOURCE, "Your sign-in expired. Reconnect Revora.");
  const { data: p } = await admin.from("profiles").select("company_id, role, display_name, media_buyer_id").eq("id", ud.user.id).maybeSingle();
  // Anyone with a Revora login can connect. An account that has not finished onboarding connects fine; its tools explain what is left to do.
  const c: Ctx = { token, userId: ud.user.id, email: ud.user.email ?? null, companyId: p?.company_id ?? "", role: p?.role ?? "", mediaBuyerId: p?.media_buyer_id ?? null, displayName: p?.display_name || "" };

  if (path.startsWith("/pin/")) return handlePin(path, req, c);

  if (req.method === "GET") return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return jres({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return jres({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  const client = String(req.headers.get("user-agent") ?? "").slice(0, 80);
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(m, c, client)))).filter((x) => x !== null);
    return out.length ? jres(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handleRpc(body, c, client);
  return out === null ? new Response(null, { status: 202, headers: CORS }) : jres(out);
});
