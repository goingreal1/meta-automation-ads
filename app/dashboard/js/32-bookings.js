// ── Bookings: appointments customers booked on your pages, by day, with the actions you need. ──
const BKS = { rows: [], filter: "upcoming", timer: null };
const bkFmtDay = (iso) => { const d = new Date(iso), t = new Date(); const k = (x) => x.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }); const dd = k(d), td = k(t), tm = k(new Date(Date.now() + 86400000));
  return dd === td ? "Today" : dd === tm ? "Tomorrow" : d.toLocaleDateString("en-NG", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long" }); };
const bkTime = (iso) => new Date(iso).toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false });
const BK_ST = { pending_payment: ["Awaiting payment", "bad"], confirmed: ["Confirmed", "br"], completed: ["Done", "ok"], cancelled: ["Cancelled", "n"], no_show: ["No-show", "n"] };
function bkCss() {
  if (document.getElementById("bkCss")) return;
  const st = document.createElement("style"); st.id = "bkCss";
  st.textContent = `.bk h2{margin:0;font-size:24px;font-weight:700}.bk .sub{color:var(--muted,#5b6b78);font-size:13px;margin:2px 0 14px}
  .bk-day{font-size:12px;font-weight:700;letter-spacing:.05em;color:var(--muted,#5b6b78);margin:18px 0 8px;text-transform:uppercase}
  .bk-card{display:flex;gap:14px;align-items:flex-start;background:var(--panel,#fff);border:1px solid var(--border,#e3e8ed);border-radius:16px;padding:14px;margin-bottom:8px}
  .bk-t{min-width:56px;font-weight:700;font-size:16px;font-variant-numeric:tabular-nums}.bk-mid{flex:1;min-width:0}.bk-mid b{display:block;font-size:14px}.bk-mid small{display:block;color:var(--muted,#5b6b78);font-size:12px;margin-top:2px;word-break:break-word}
  .bk-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.bk-acts button,.bk-acts a{border:1px solid var(--border,#d3dbe2);background:transparent;color:inherit;border-radius:10px;padding:7px 11px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;font-family:inherit}
  .bk-acts .go{background:#1262d6;border-color:#1262d6;color:#fff}.bk-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
  .bk-chip{border:1px solid var(--border,#d3dbe2);background:var(--panel,#fff);color:inherit;padding:7px 14px;border-radius:99px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}.bk-chip.on{background:#1262d6;color:#fff;border-color:transparent}
  .bk-empty{padding:34px;text-align:center;color:var(--muted,#5b6b78);font-size:14px}
  @media(max-width:700px){.bk h2{font-size:21px}.bk-card{flex-direction:column;gap:6px}}`;
  document.head.appendChild(st);
}
async function renderBookings(c) {
  bkCss();
  c.innerHTML = `<div class="rv-ui bk"><h2>Bookings</h2><div class="sub">Appointments customers booked on your pages. Times are Lagos time.</div><div class="bk-chips" id="bkF"></div><div id="bkL">${typeof bvSkel === "function" ? bvSkel("list") : "Loading…"}</div></div>`;
  await bkLoad();
  clearInterval(BKS.timer); BKS.timer = setInterval(() => { if (document.getElementById("bkL")) bkLoad(); else clearInterval(BKS.timer); }, 30000);
}
async function bkLoad() {
  const from = new Date(Date.now() - 30 * 86400000).toISOString();
  BKS.rows = (await sbQuery("bookings", `select=*&starts_at=gte.${from}&order=starts_at.asc&limit=500`).catch(() => [])) || [];
  bkDraw();
}
function bkDraw() {
  const f = document.getElementById("bkF"), l = document.getElementById("bkL"); if (!f || !l) return;
  const now = Date.now(), live = (r) => r.status === "confirmed" || r.status === "pending_payment";
  const up = BKS.rows.filter((r) => live(r) && new Date(r.ends_at).getTime() >= now - 3600000), past = BKS.rows.filter((r) => (r.status === "completed" || r.status === "no_show" || (live(r) && !up.includes(r)))), can = BKS.rows.filter((r) => r.status === "cancelled");
  const F = [["upcoming", `Upcoming (${up.length})`], ["past", `Past (${past.length})`], ["cancelled", `Cancelled (${can.length})`]];
  f.innerHTML = F.map(([k, t]) => `<button class="bk-chip${BKS.filter === k ? " on" : ""}" data-f="${k}">${t}</button>`).join("");
  f.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { BKS.filter = b.dataset.f; bkDraw(); }));
  const rows = BKS.filter === "upcoming" ? up : BKS.filter === "past" ? past.slice().reverse() : can.slice().reverse();
  if (!rows.length) { l.innerHTML = `<div class="bk-empty">${BKS.filter === "upcoming" ? "No upcoming bookings yet. When a customer books on your page, it shows here and you get a notification." : "Nothing here."}</div>`; return; }
  let day = "", html = "";
  rows.forEach((r) => {
    const d = bkFmtDay(r.starts_at); if (d !== day) { day = d; html += `<div class="bk-day">${escH(d)}</div>`; }
    const st = BK_ST[r.status] || [r.status, "n"], ph = String(r.customer_phone || "").replace(/\D/g, ""), wa = ph ? "https://wa.me/" + (ph.length === 11 && ph[0] === "0" ? "234" + ph.slice(1) : ph) : "";
    const acts = [wa ? `<a class="go" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : "", r.customer_phone ? `<a href="tel:${escH(r.customer_phone)}">Call</a>` : "",
      live(r) ? `<button data-s="completed" data-id="${r.id}">Mark done</button><button data-s="no_show" data-id="${r.id}">No-show</button><button data-s="cancelled" data-id="${r.id}">Cancel</button>` : r.status === "cancelled" ? `<button data-s="confirmed" data-id="${r.id}">Restore</button>` : ""].join("");
    html += `<div class="bk-card"><div class="bk-t">${bkTime(r.starts_at)}</div><div class="bk-mid"><b>${escH(r.service_name)} <span class="rv-pill ${st[1]}" style="margin-left:4px">${st[0]}</span></b>
      <small>${escH(r.customer_name || "Customer")} · ${escH(r.customer_phone || "")}${r.customer_email ? " · " + escH(r.customer_email) : ""}</small><small>${r.duration_min} min · ${fN(r.price_naira)}${r.notes ? " · “" + escH(r.notes) + "”" : ""}</small><div class="bk-acts">${acts}</div></div></div>`;
  });
  l.innerHTML = html;
  l.querySelectorAll("[data-s]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.s === "cancelled" && !confirm("Cancel this booking? The time becomes free again.")) return;
    b.disabled = true;
    const res = await fetch(`${SUPA_URL}/rest/v1/bookings?id=eq.${b.dataset.id}`, { method: "PATCH", headers: { apikey: ANON, Authorization: `Bearer ${sessionData?.access_token || ANON}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: b.dataset.s, hold_until: null, updated_at: new Date().toISOString() }) });
    if (!res.ok) { bvToast("Could not update: " + (await res.text()).slice(0, 80)); b.disabled = false; return; }
    bkLoad();
  }));
}
