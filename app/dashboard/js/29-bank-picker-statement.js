// ── 1) Searchable bank picker ──────────────────────────────────────────────────────────────────────────────────────────
// Every bank list in Revora is a plain <select> filled by bvLoadBanks. This keeps that select (so .value still works everywhere) but
// opens a search sheet instead of the endless native list: type "gt" and pick GTBank.
(function () {
  const st = document.createElement("style");
  st.textContent = `
  .bp-wrap{position:relative}.bp-wrap select{pointer-events:none}
  .bp-hit{position:absolute;inset:0;background:transparent;border:0;cursor:pointer;width:100%}
  .bp-ov{position:fixed;inset:0;background:rgba(10,20,30,.45);z-index:100000;display:flex;align-items:flex-end;justify-content:center}
  @media(min-width:700px){.bp-ov{align-items:center}}
  .bp-sheet{background:var(--panel,#fff);color:var(--text,#111);width:100%;max-width:520px;max-height:82vh;border-radius:22px 22px 0 0;display:flex;flex-direction:column;box-shadow:0 -10px 40px rgba(0,0,0,.25)}
  @media(min-width:700px){.bp-sheet{border-radius:22px}}
  .bp-top{padding:16px 16px 8px;display:flex;gap:10px;align-items:center}.bp-top b{flex:1;font-size:16px}.bp-x{border:0;background:var(--panel2,#eef2f4);width:32px;height:32px;border-radius:50%;font-size:15px;cursor:pointer;color:var(--text,#111)}
  .bp-q{margin:0 16px 8px;padding:12px 14px;border-radius:14px;border:1px solid var(--border,#d8e0e4);background:var(--panel2,#f4f7f8);font-size:16px;color:var(--text,#111);width:calc(100% - 32px);box-sizing:border-box;outline:none}
  .bp-q:focus{border-color:var(--accent,#1877f2)}
  .bp-list{overflow:auto;padding:0 8px 16px;-webkit-overflow-scrolling:touch}
  .bp-lbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#7a8a92);padding:10px 10px 4px}
  .bp-it{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:transparent;padding:13px 10px;border-radius:12px;font-size:15px;color:var(--text,#111);cursor:pointer}
  .bp-it:hover,.bp-it:active{background:var(--panel2,#eef2f4)}.bp-it.on{color:var(--accent,#1877f2);font-weight:700}
  .bp-em{padding:24px;text-align:center;color:var(--muted,#7a8a92);font-size:14px}`;
  document.head.appendChild(st);
  const POP = ["access", "gtbank", "guaranty", "first bank", "united bank", "uba", "zenith", "opay", "palmpay", "kuda", "moniepoint", "paga", "wema", "fidelity", "sterling", "stanbic", "fcmb", "first city", "union bank", "ecobank", "polaris", "keystone", "providus"];
  const ALIAS = { "guaranty trust": "gtbank gtb gt gtco", "united bank for africa": "uba", "first bank of nigeria": "firstbank fbn first", "first city monument": "fcmb", "fidelity": "fidelity", "wema": "alat", "opay": "opay", "kuda": "kuda", "stanbic": "stanbic ibtc" };
  const hay = (o) => { const n = o.textContent.toLowerCase(); return n + " " + Object.keys(ALIAS).filter((k) => n.includes(k)).map((k) => ALIAS[k]).join(" "); };
  function open(sel) {
    const opts = Array.from(sel.options).filter((o) => o.value);
    if (!opts.length) return;
    const ov = document.createElement("div"); ov.className = "bp-ov";
    ov.innerHTML = `<div class="bp-sheet"><div class="bp-top"><b>Choose bank</b><button type="button" class="bp-x" aria-label="Close">✕</button></div><input class="bp-q" type="search" placeholder="Search bank, e.g. GTBank, OPay, Paga" autocomplete="off" autocapitalize="off" spellcheck="false"><div class="bp-list"></div></div>`;
    document.body.appendChild(ov);
    const q = ov.querySelector(".bp-q"), list = ov.querySelector(".bp-list");
    const close = () => ov.remove();
    const pick = (code) => { sel.value = code; sel.dispatchEvent(new Event("change", { bubbles: true })); close(); };
    const item = (o) => `<button type="button" class="bp-it${o.value === sel.value ? " on" : ""}" data-c="${escH(o.value)}">${escH(o.textContent)}${o.value === sel.value ? " ✓" : ""}</button>`;
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      if (t) {
        const hit = opts.filter((o) => hay(o).includes(t)).sort((a, b) => (a.textContent.toLowerCase().startsWith(t) ? 0 : 1) - (b.textContent.toLowerCase().startsWith(t) ? 0 : 1));
        list.innerHTML = hit.length ? hit.map(item).join("") : `<div class="bp-em">No bank matches “${escH(q.value)}”.</div>`;
      } else {
        const pop = opts.filter((o) => POP.some((p) => o.textContent.toLowerCase().includes(p))).slice(0, 14);
        list.innerHTML = `<div class="bp-lbl">Popular</div>${pop.map(item).join("")}<div class="bp-lbl">All banks (A to Z)</div>${opts.map(item).join("")}`;
      }
    };
    draw(); q.addEventListener("input", draw);
    list.addEventListener("click", (e) => { const b = e.target.closest(".bp-it"); if (b) pick(b.dataset.c); });
    ov.querySelector(".bp-x").onclick = close; ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    setTimeout(() => q.focus(), 60);
  }
  function enhance(sel) {
    if (!sel || sel._bp) return; sel._bp = 1;
    const wrap = document.createElement("div"); wrap.className = "bp-wrap"; sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
    const hit = document.createElement("button"); hit.type = "button"; hit.className = "bp-hit"; hit.setAttribute("aria-label", "Choose bank");
    hit.onclick = (e) => { e.preventDefault(); e.stopPropagation(); open(sel); }; wrap.appendChild(hit);
  }
  const orig = window.bvLoadBanks;
  window.bvLoadBanks = async function (sel) { const r = await orig(sel); try { enhance(sel); } catch (e) {} return r; };
})();

// ── 2) Printable wallet statement (Save as PDF) ────────────────────────────────────────────────────────────────────────
// Opens a clean A4 document with the Revora logo and name; the browser's Print dialog saves it as a PDF.
(function () {
  const ESC = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const NGN = (n) => "₦" + Math.abs(Math.round(Number(n) * 100) / 100).toLocaleString("en-NG", { minimumFractionDigits: Number(n) % 1 ? 2 : 0 });
  const RANGES = [["30", "Last 30 days"], ["month", "This month"], ["last", "Last month"], ["90", "Last 90 days"], ["all", "Everything"]];
  function span(k) {
    const now = new Date(), som = new Date(now.getFullYear(), now.getMonth(), 1);
    if (k === "month") return [som, now];
    if (k === "last") return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(som.getTime() - 1)];
    if (k === "90") return [new Date(Date.now() - 90 * 864e5), now];
    if (k === "all") return [new Date(0), now];
    return [new Date(Date.now() - 30 * 864e5), now];
  }
  async function load(from) {
    let all = [], before = null;
    for (let i = 0; i < 12; i++) {
      const r = await sbFn("wallet-topup", { action: "activity", limit: 100, ...(before ? { before } : {}) }).catch(() => null);
      if (!r || !r.ok) break; all = all.concat(r.items);
      if (!r.more || !r.items.length) break; before = r.items[r.items.length - 1].at;
      if (new Date(before) < from) break;
    }
    return all.filter((x) => new Date(x.at) >= from);
  }
  function doc(items, from, to, bal, logo) {
    const p = window.myProfile || {}, who = p.display_name || sessionData?.user?.email || "Account holder";
    const co = document.getElementById("hdrBrand")?.textContent?.trim() || "";
    const role = ({ owner: "Owner", admin: "Admin", buyer: "Media buyer" })[p.role] || "";
    let inn = 0, out = 0, fees = 0;
    for (const x of items) { if (x.amount >= 0) inn += x.amount; else out += -x.amount; fees += Number(x.fee || 0); }
    const dfmt = (d) => d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
    const period = from.getTime() === 0 ? (items.length ? `${dfmt(new Date(items[items.length - 1].at))} – ${dfmt(to)}` : "All activity") : `${dfmt(from)} – ${dfmt(to)}`;
    const chip = (x) => x.status === "failed" ? `<span class="chip bad">Failed</span>` : x.kind === "refund" ? `<span class="chip ok">Refunded</span>` : `<span class="chip">Completed</span>`;
    const rows = items.map((x) => `<tr><td class="nw">${ESC(new Date(x.at).toLocaleString("en-NG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }))}</td>
      <td><b>${ESC(x.title)}</b>${x.sub ? `<div class="sub">${ESC(x.sub)}</div>` : ""}</td><td>${chip(x)}</td>
      <td class="num ${x.amount >= 0 ? "pos" : "neg"}">${x.amount >= 0 ? "+" : "−"}${NGN(x.amount)}${x.gross && x.gross !== x.amount ? `<div class="sub">sent ${NGN(x.gross)}</div>` : ""}</td>
      <td class="num">${x.fee > 0 ? NGN(x.fee) : "–"}</td><td class="ref">${ESC(String(x.ref || x.id).replace(/:refund$/, "").slice(-8).toUpperCase())}</td></tr>`).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Revora wallet statement</title>
<style>
@page{size:A4;margin:14mm 12mm}
*{box-sizing:border-box}body{margin:0;background:#eef2f5;color:#0e1b24;font:13px/1.45 -apple-system,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{position:sticky;top:0;background:#fff;border-bottom:1px solid #dde5ea;padding:10px 16px;display:flex;gap:10px;align-items:center;justify-content:space-between;z-index:5}
.bar button.back{background:#eaf1f6;color:#0e1b24}.bar .hint{flex:1;font-size:12px}.bar button{background:#1877f2;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-weight:700;font-size:14px;cursor:pointer}.bar span{color:#5a6c77;font-size:13px}
.page{max-width:900px;margin:18px auto;background:#fff;border-radius:16px;box-shadow:0 6px 30px rgba(10,30,50,.08);overflow:hidden}
.hd{background:linear-gradient(135deg,#0b5ed7 0%,#1877f2 55%,#4aa3ff 100%);color:#fff;padding:26px 30px;display:flex;align-items:center;gap:16px}
.hd img{width:54px;height:54px;border-radius:14px;background:#fff;padding:5px}.hd h1{margin:0;font-size:24px;letter-spacing:-.01em}.hd small{opacity:.85;display:block;font-size:12.5px;margin-top:2px}.hd .r{margin-left:auto;text-align:right;font-size:12px;opacity:.92}
.in{padding:24px 30px}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:14px 30px;margin-bottom:22px}.meta div small{display:block;color:#6b7c87;font-size:11px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;margin-bottom:2px}.meta b{font-size:14px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px}.t{border:1px solid #e2eaef;border-radius:14px;padding:12px 14px;background:#f7fafc}.t small{display:block;color:#6b7c87;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}.t b{font-size:18px;display:block;margin-top:3px}.t.p b{color:#0f8a4b}.t.n b{color:#c0392b}
table{width:100%;border-collapse:collapse;font-size:12.2px}thead{display:table-header-group}th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:#6b7c87;padding:9px 8px;border-bottom:2px solid #dbe5eb;font-weight:700}
td{padding:10px 8px;border-bottom:1px solid #edf2f5;vertical-align:top}tr{page-break-inside:avoid}tbody tr:nth-child(even){background:#fafcfd}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.pos{color:#0f8a4b;font-weight:700}.neg{color:#0e1b24;font-weight:700}.nw{white-space:nowrap;color:#42535e}.sub{color:#7b8a94;font-size:11px;margin-top:1px}.ref{font-family:ui-monospace,Menlo,Consolas,monospace;color:#6b7c87;font-size:11px}
.chip{display:inline-block;padding:2px 9px;border-radius:99px;background:#eaf1f6;color:#42535e;font-size:10.5px;font-weight:700}.chip.bad{background:#fde8e6;color:#c0392b}.chip.ok{background:#e1f5ea;color:#0f8a4b}
.empty{padding:40px;text-align:center;color:#7b8a94}
.ft{border-top:1px solid #e2eaef;padding:16px 30px 22px;color:#6b7c87;font-size:11.5px;display:flex;gap:14px;justify-content:space-between;align-items:flex-end}.ft b{color:#0e1b24}
@media print{body{background:#fff}.bar{display:none}.page{margin:0;border-radius:0;box-shadow:none;max-width:none}.in{padding:18px 0}.hd{border-radius:12px;margin-bottom:4px}.ft{padding:14px 0 0}}
@media(max-width:640px){.tiles{grid-template-columns:repeat(2,1fr)}.meta{grid-template-columns:1fr}.in{padding:18px 14px}.hd{padding:20px 16px}table{font-size:11px}}
</style></head><body>
<div class="bar"><button class="back" onclick="goBack()">‹ Back</button><span class="hint">Tap “Save as PDF”, then pick <b>Save as PDF</b> as the printer.</span><button onclick="window.print()">Save as PDF</button></div>
<div class="page"><div class="hd"><img src="${logo}" alt="Revora"><div><h1>Revora</h1><small>Wallet statement</small></div><div class="r">Generated<br><b>${ESC(new Date().toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }))}</b></div></div>
<div class="in"><div class="meta"><div><small>Account holder</small><b>${ESC(who)}</b></div><div><small>Business</small><b>${ESC(co || "—")}${role ? ` · ${ESC(role)}` : ""}</b></div><div><small>Period</small><b>${ESC(period)}</b></div><div><small>Wallet balance today</small><b>${bal == null ? "—" : NGN(bal)}</b></div></div>
<div class="tiles"><div class="t p"><small>Money in</small><b>${NGN(inn)}</b></div><div class="t n"><small>Money out</small><b>${NGN(out)}</b></div><div class="t"><small>Fees</small><b>${NGN(fees)}</b></div><div class="t"><small>Transactions</small><b>${items.length}</b></div></div>
${items.length ? `<table><thead><tr><th>Date</th><th>Description</th><th>Status</th><th class="num">Amount</th><th class="num">Fee</th><th>Ref</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No transactions in this period.</div>`}
</div><div class="ft"><div>A failed payment shows as a debit marked <b>Failed</b> followed by a <b>Refund</b> of the same amount, so it never changes your balance.<br>Ad spend that Revora bills against your wallet is not listed here.</div><div style="text-align:right"><b>Revora</b><br>revoracrm.online</div></div></div>
<script>function goBack(){try{window.close()}catch(e){}setTimeout(function(){location.href="${location.origin}/dashboard_new.html"},250)}window.addEventListener("load",function(){setTimeout(function(){if(!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent))window.print()},500)})<\/script></body></html>`;
  }
  async function make(kind) {
    const w = kind === "pdf" ? window.open("", "_blank") : null;
    if (kind === "pdf" && !w) { bvToast("Allow pop-ups for this site, then try again.", "err"); return; }
    if (w) w.document.write("<p style='font-family:sans-serif;padding:30px'>Preparing your statement…</p>");
    const k = document.querySelector("#stRange")?.value || "30", [from, to] = span(k);
    const items = await load(from);
    if (kind === "csv") {
      if (!items.length) { bvToast("Nothing to export in that period", "err"); return; }
      const rows = [["Date", "Description", "Details", "Status", "Amount", "Fee", "Balance effect"], ...items.map((x) => [new Date(x.at).toISOString(), x.title, x.sub || "", x.status === "failed" ? "Failed" : x.kind === "refund" ? "Refunded" : "Completed", x.amount, x.fee || 0, x.amount])];
      const csv = rows.map((l) => l.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "revora-wallet-statement.csv"; a.click(); bvCloseSheet("bvStmt"); return;
    }
    // Embed the logo inside the document, so it always prints, even from a blank popup.
    let logo = location.origin + "/images/brands/revora-logo-192.png";
    try { const bl = await (await fetch("/images/brands/revora-logo-192.png")).blob(); logo = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(bl); }); } catch (e) {}
    const bal = (typeof W2 !== "undefined" && W2.ov && W2.ov.me_wallet != null) ? Number(W2.ov.me_wallet) : null;
    w.document.open(); w.document.write(doc(items, from, to, bal, logo)); w.document.close(); bvCloseSheet("bvStmt");
  }
  window.w2Statement = function () {
    const ov = bvOpenSheet("bvStmt", `<button class="bv-modal-close" data-sheet-close>✕</button><h3 style="margin:0 0 4px">Wallet statement</h3>
      <div style="color:var(--text2);font-size:12.5px;margin-bottom:12px">A clean statement with the Revora name and logo. Save it as a PDF to print or share.</div>
      <div class="field"><label>Period</label><select id="stRange" class="cat-in">${RANGES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
      <div style="display:grid;gap:8px;margin-top:14px"><button type="button" class="btn btn-a" id="stPdf">Open printable statement (PDF)</button><button type="button" class="btn btn-g" id="stCsv">Download as spreadsheet (CSV)</button></div>`, 440);
    ov.querySelector("[data-sheet-close]").onclick = () => bvCloseSheet("bvStmt");
    ov.querySelector("#stPdf").onclick = () => make("pdf"); ov.querySelector("#stCsv").onclick = () => make("csv");
  };
})();
