// ── Housing: tour requests, rental applications and the homes catalog (add / edit homes, photos, prices, tour times). ──
// Everything here reads and writes the company's own rows through the normal logged-in session (RLS: company_id = current_company_id()).
// The public rental site shows whatever is saved here, so owners never have to write code to add or change a home.
const HS = { tab: "tours", products: [], pid: null, tours: [], apps: [], props: [], tf: "upcoming", af: "review" };
const HS_STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming","District of Columbia"];
const HS_TYPES = ["Apartment", "Studio", "House", "Townhome", "Condo", "Duplex", "Room"];
const HS_TOUR_ST = { requested: ["New", "bad"], confirmed: ["Confirmed", "br"], completed: ["Toured", "ok"], no_show: ["No-show", "n"], cancelled: ["Cancelled", "n"] };
const HS_FEE_ST = { unpaid: ["Fee unpaid", "bad"], paid: ["Fee paid", "ok"], waived: ["No fee", "n"], refunded: ["Refunded", "n"] };
const HS_REV_ST = { submitted: ["New", "bad"], under_review: ["In review", "br"], approved: ["Approved", "ok"], declined: ["Declined", "n"] };
const hsSlug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const hsMoney = (n, cur) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD", maximumFractionDigits: 0 }).format(Number(n) || 0); } catch (e) { return "$" + (Number(n) || 0); } };
const hsClock = (t) => { const h = Number(String(t).slice(0, 2)); return (h % 12 || 12) + ":" + String(t).slice(3, 5) + (h < 12 ? " AM" : " PM"); };
const hsLocalDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
function hsDayLabel(ymd) {
  const today = new Date(), tm = new Date(Date.now() + 86400000);
  if (ymd === hsLocalDay(today)) return "Today";
  if (ymd === hsLocalDay(tm)) return "Tomorrow";
  return new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function hsCss() {
  if (document.getElementById("hsCss")) return;
  const st = document.createElement("style"); st.id = "hsCss";
  st.textContent = `.hs h2{margin:0;font-size:24px;font-weight:700}.hs .sub{color:var(--muted,#5b6b78);font-size:13px;margin:2px 0 14px}
  .hs-top{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:6px}
  .hs-chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 6px}
  .hs-chip{border:1px solid var(--border,#d3dbe2);background:var(--panel,#fff);color:inherit;padding:7px 14px;border-radius:99px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}.hs-chip.on{background:#1262d6;color:#fff;border-color:#1262d6}
  .hs-day{font-size:12px;font-weight:700;letter-spacing:.05em;color:var(--muted,#5b6b78);margin:18px 0 8px;text-transform:uppercase}
  .hs-card{display:flex;gap:14px;align-items:flex-start;background:var(--panel,#fff);border:1px solid var(--border,#e3e8ed);border-radius:16px;padding:14px;margin-bottom:8px}
  .hs-t{min-width:74px;font-weight:700;font-size:15px;font-variant-numeric:tabular-nums}.hs-mid{flex:1;min-width:0}.hs-mid b{display:block;font-size:14px}.hs-mid small{display:block;color:var(--muted,#5b6b78);font-size:12px;margin-top:2px;word-break:break-word}
  .hs-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.hs-acts button,.hs-acts a{border:1px solid var(--border,#d3dbe2);background:transparent;color:inherit;border-radius:10px;padding:7px 11px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;font-family:inherit}
  .hs-acts .go{background:#1262d6;border-color:#1262d6;color:#fff}.hs-empty{padding:34px;text-align:center;color:var(--muted,#5b6b78);font-size:14px}
  .hs-thumb{width:84px;height:64px;border-radius:10px;background:#e9edf1 center/cover no-repeat;flex:none}
  .hs-box{background:var(--panel,#fff);border:1px solid var(--border,#e3e8ed);border-radius:16px;padding:14px;margin:6px 0 14px}.hs-box h3{margin:0 0 8px;font-size:14px}
  .hs-f{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.hs-f label{display:block;font-size:12px;font-weight:600;color:var(--muted,#5b6b78);margin-bottom:3px}
  .hs-f input,.hs-f select,.hs-f textarea,.hs-box input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--border,#d3dbe2);border-radius:10px;font:inherit;font-size:14px;background:var(--panel,#fff);color:inherit}
  .hs-f .full{grid-column:1/-1}.hs-days{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;margin:6px 0}.hs-days input{width:auto}
  .hs-ph{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.hs-ph div{position:relative;width:86px;height:66px;border-radius:10px;background:#e9edf1 center/cover no-repeat;border:2px solid transparent}
  .hs-ph div.cover{border-color:#1262d6}.hs-ph button{position:absolute;top:2px;right:2px;border:0;background:rgba(0,0,0,.65);color:#fff;border-radius:99px;width:20px;height:20px;cursor:pointer;font-size:11px;line-height:1}
  .hs-ph span{position:absolute;left:3px;bottom:3px;background:#1262d6;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:6px}.hs-ph .mk{position:absolute;right:2px;bottom:2px;top:auto;width:auto;border-radius:6px;padding:1px 5px;font-size:9px}
  @media(max-width:700px){.hs h2{font-size:21px}.hs-card{flex-direction:column;gap:6px}.hs-f{grid-template-columns:1fr}}`;
  document.head.appendChild(st);
}
const hsPill = (m, k) => { const s = (m[k] || [k, "n"]); return `<span class="rv-pill ${s[1]}" style="margin-left:4px">${escH(s[0])}</span>`; };
const hsTel = (p) => { const d = String(p || "").replace(/[^\d+]/g, ""); return d ? `<a class="go" href="tel:${escH(d)}">Call</a><a href="sms:${escH(d)}">Text</a>` : ""; };
const hsProj = () => HS.products.find((p) => p.id === HS.pid) || HS.products[0] || null;

async function renderHousing(c) {
  hsCss();
  const { data: prods, error } = await supabaseClient.from("products").select("id, product_name, currency, housing_settings, payment_note, payment_link_url, bank_name, bank_account_number, bank_account_name").eq("product_type", "housing").order("created_at", { ascending: true });
  if (error) { c.innerHTML = `<div class="rv-ui hs"><div class="hs-empty">Could not load housing: ${escH(error.message)}</div></div>`; return; }
  HS.products = prods || [];
  if (!HS.products.length) { c.innerHTML = `<div class="rv-ui hs"><h2>Housing</h2><div class="hs-empty">No housing project yet. Ask Revora in chat to create one ("create a housing project"), then your homes, tours and applications show here.</div></div>`; return; }
  if (!HS.pid || !HS.products.some((p) => p.id === HS.pid)) HS.pid = HS.products[0].id;
  c.innerHTML = `<div class="rv-ui hs"><div class="hs-top"><div><h2>Housing</h2><div class="sub">Tour requests, rental applications and your homes. Anything you save here shows on your rental site.</div></div>
    ${HS.products.length > 1 ? `<select id="hsProj" class="cat-in" style="max-width:260px">${HS.products.map((p) => `<option value="${p.id}" ${p.id === HS.pid ? "selected" : ""}>${escH(p.product_name)}</option>`).join("")}</select>` : ""}</div>
    <div class="hs-chips" id="hsTabs"></div><div id="hsBody">${typeof bvSkel === "function" ? bvSkel("list") : ""}</div></div>`;
  const sel = document.getElementById("hsProj"); if (sel) sel.onchange = () => { HS.pid = sel.value; renderHousing(c); };
  await hsOpen(HS.tab);
}
async function hsOpen(tab) {
  HS.tab = tab;
  const t = document.getElementById("hsTabs"); if (!t) return;
  t.innerHTML = [["tours", "Tours"], ["apps", "Applications"], ["homes", "Homes"], ["settings", "Settings"]].map(([k, n]) => `<button class="hs-chip${HS.tab === k ? " on" : ""}" data-t="${k}">${n}</button>`).join("");
  t.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => hsOpen(b.dataset.t)));
  const body = document.getElementById("hsBody"); if (body) body.innerHTML = typeof bvSkel === "function" ? bvSkel("list") : "";
  if (tab === "tours") await hsTours(); else if (tab === "apps") await hsApps(); else if (tab === "settings") hsSettings(); else await hsHomes();
}

// ───────── Settings: what visitors can do, and how applicants pay ─────────
function hsSettings() {
  const body = document.getElementById("hsBody"), pr = hsProj(); if (!body || !pr) return;
  const s = pr.housing_settings || {}, flow = ["both", "tour", "apply"].includes(s.flow) ? s.flow : "both";
  const v = (x) => escH(x ?? "");
  const opt = (k, title, desc) => `<label style="display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border:1px solid var(--border,#d3dbe2);border-radius:12px;margin-bottom:8px;cursor:pointer"><input type="radio" name="hs_flow" value="${k}" ${flow === k ? "checked" : ""} style="width:auto;margin-top:3px"><span><b style="display:block;font-size:14px">${title}</b><small style="color:var(--muted,#5b6b78)">${desc}</small></span></label>`;
  body.innerHTML = `<div class="hs-box"><h3>What can visitors do on your site?</h3>
    ${opt("both", "Book a tour, then apply (recommended)", "Both buttons show. Tours bring in the leads; the paid application filters the serious ones.")}
    ${opt("tour", "Book a tour only", "Only the tour form shows. Best for collecting as many leads as possible. Applications are hidden.")}
    ${opt("apply", "Apply only", "Only the application form shows. Visitors pay the application fee without a tour first.")}</div>
    <div class="hs-box"><h3>Homepage banner photo</h3><div class="sub" style="margin:0 0 8px">The big photo behind the headline on your homepage. Use a bright, wide photo of a nice home (landscape, at least 1600 px wide). Use a photo you own or have rights to.</div>
    <div id="hs_hero_prev" style="height:120px;border-radius:12px;background:#e9edf1 center/cover no-repeat;margin-bottom:8px;display:grid;place-items:center;color:#8896a3;font-size:13px"></div>
    <div class="hs-acts"><input id="hs_hero_file" type="file" accept="image/*" style="width:auto"><button id="hs_hero_rm" type="button">Remove photo</button></div></div>
    <div class="hs-box"><h3>Contact number</h3><div class="sub" style="margin:0 0 8px">Shown to visitors after they book or apply (Call button).</div>
    <div class="hs-f"><div class="full"><input id="hs_phone" type="tel" value="${v(s.contact_phone)}" placeholder="(803) 555-0123"></div></div></div>
    <div class="hs-box"><h3>How applicants pay the application fee</h3><div class="sub" style="margin:0 0 8px">Shown right after someone applies. Fill in whatever you accept. Card details are never collected on your site.</div>
    <div class="hs-f"><div class="full"><label>Payment instructions</label><textarea id="hs_note" rows="3" placeholder="Send $20 by Zelle to (803) 555-0123 and put your reference in the note. Then text us your receipt.">${v(pr.payment_note)}</textarea></div>
    <div class="full"><label>Payment link (optional: Cash App, PayPal, Stripe link…)</label><input id="hs_link" value="${v(pr.payment_link_url)}" placeholder="https://"></div>
    <div><label>Bank name (optional)</label><input id="hs_bank" value="${v(pr.bank_name)}"></div><div><label>Account name (optional)</label><input id="hs_bname" value="${v(pr.bank_account_name)}"></div>
    <div class="full"><label>Account number (optional)</label><input id="hs_bnum" value="${v(pr.bank_account_number)}"></div></div></div>
    <div class="hs-acts"><button class="go" id="hs_save">Save settings</button></div>`;
  let hero = s.hero_image || "";
  const drawHero = () => { const el = document.getElementById("hs_hero_prev"); if (!el) return; el.style.backgroundImage = hero ? `url('${hero.replace(/'/g, "%27")}')` : ""; el.textContent = hero ? "" : "No banner photo yet"; };
  drawHero();
  document.getElementById("hs_hero_rm").onclick = () => { hero = ""; drawHero(); };
  document.getElementById("hs_hero_file").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 20 * 1024 * 1024) return bvToast("That photo is over 20 MB.");
    const el = document.getElementById("hs_hero_prev"); el.textContent = "Uploading…";
    try { hero = await window.rvUpload(supabaseClient, "site-media", f); } catch (err) { bvToast("Upload failed: " + (err.message || err)); }
    e.target.value = ""; drawHero();
  };
  document.getElementById("hs_save").onclick = async (e) => {
    const g = (id) => document.getElementById(id).value.trim() || null;
    const link = g("hs_link"); if (link && !/^https:\/\//i.test(link)) return bvToast("The payment link must start with https://");
    const f = document.querySelector('input[name="hs_flow"]:checked')?.value || "both";
    const hsSet = { ...(pr.housing_settings || {}), flow: f, contact_phone: g("hs_phone"), hero_image: hero || null };
    const cols = { payment_note: g("hs_note"), payment_link_url: link, bank_name: g("hs_bank"), bank_account_name: g("hs_bname"), bank_account_number: g("hs_bnum") };
    e.target.disabled = true;
    const { error } = await supabaseClient.from("products").update({ ...cols, housing_settings: hsSet }).eq("id", pr.id);
    e.target.disabled = false;
    if (error) return bvToast("Could not save: " + error.message.slice(0, 80));
    pr.housing_settings = hsSet; Object.assign(pr, cols); bvToast("Saved. Your site follows this setting within a minute.");
  };
}

// ───────── Tours ─────────
async function hsTours() {
  const { data, error } = await supabaseClient.from("tours").select("*, properties(title, city, state, address)").eq("product_id", HS.pid).order("tour_date", { ascending: true }).order("tour_time", { ascending: true }).limit(500);
  if (error) { document.getElementById("hsBody").innerHTML = `<div class="hs-empty">Could not load tours: ${escH(error.message)}</div>`; return; }
  HS.tours = data || []; hsDrawTours();
}
function hsDrawTours() {
  const body = document.getElementById("hsBody"); if (!body) return;
  const today = hsLocalDay(new Date()), live = (r) => r.status === "requested" || r.status === "confirmed";
  const up = HS.tours.filter((r) => live(r) && r.tour_date >= today), past = HS.tours.filter((r) => r.status === "completed" || r.status === "no_show" || (live(r) && r.tour_date < today)), can = HS.tours.filter((r) => r.status === "cancelled");
  const F = [["upcoming", `Upcoming (${up.length})`], ["past", `Past (${past.length})`], ["cancelled", `Cancelled (${can.length})`]];
  const rows = HS.tf === "upcoming" ? up : HS.tf === "past" ? past.slice().reverse() : can.slice().reverse();
  let html = `<div class="hs-chips">${F.map(([k, t]) => `<button class="hs-chip${HS.tf === k ? " on" : ""}" data-f="${k}">${t}</button>`).join("")}</div>`;
  if (!rows.length) html += `<div class="hs-empty">${HS.tf === "upcoming" ? "No upcoming tours yet. When someone books a tour on your site it shows here and you get a notification." : "Nothing here."}</div>`;
  let day = "";
  for (const r of rows) {
    if (r.tour_date !== day) { day = r.tour_date; html += `<div class="hs-day">${escH(hsDayLabel(day))}</div>`; }
    const p = r.properties || {};
    html += `<div class="hs-card"><div class="hs-t">${hsClock(r.tour_time)}</div><div class="hs-mid"><b>${escH(r.visitor_name)}${hsPill(HS_TOUR_ST, r.status)}${r.possible_duplicate ? ' <span class="rv-pill n">repeat</span>' : ""}</b>
      <small>${escH(p.title || "Home")}${p.city ? " · " + escH(p.city) : ""}${p.address ? " · " + escH(p.address) : ""}</small>
      <small>${escH(r.visitor_phone || "")}${r.visitor_email ? " · " + escH(r.visitor_email) : ""} · ${escH(r.ref)}</small>${r.notes ? `<small>“${escH(r.notes)}”</small>` : ""}
      <div class="hs-acts">${hsTel(r.visitor_phone)}${r.status === "requested" ? `<button data-s="confirmed" data-id="${r.id}">Confirm</button>` : ""}
      ${live(r) ? `<button data-s="completed" data-id="${r.id}">Toured</button><button data-s="no_show" data-id="${r.id}">No-show</button><button data-s="cancelled" data-id="${r.id}">Cancel</button>` : r.status === "cancelled" ? `<button data-s="requested" data-id="${r.id}">Reopen</button>` : ""}</div></div></div>`;
  }
  body.innerHTML = html;
  body.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { HS.tf = b.dataset.f; hsDrawTours(); }));
  body.querySelectorAll("[data-s]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.s === "cancelled" && !confirm("Cancel this tour? The time becomes free again.")) return;
    b.disabled = true;
    const { error } = await supabaseClient.from("tours").update({ status: b.dataset.s, updated_at: new Date().toISOString() }).eq("id", b.dataset.id);
    if (error) { bvToast("Could not update: " + error.message.slice(0, 80)); b.disabled = false; return; }
    hsTours();
  }));
}

// ───────── Applications ─────────
async function hsApps() {
  const { data, error } = await supabaseClient.from("applications").select("*, properties(title, city, state)").eq("product_id", HS.pid).order("created_at", { ascending: false }).limit(300);
  if (error) { document.getElementById("hsBody").innerHTML = `<div class="hs-empty">Could not load applications: ${escH(error.message)}</div>`; return; }
  HS.apps = data || []; hsDrawApps();
}
function hsDrawApps() {
  const body = document.getElementById("hsBody"); if (!body) return;
  const rev = HS.apps.filter((a) => a.review_status === "submitted" || a.review_status === "under_review"), done = HS.apps.filter((a) => a.review_status === "approved" || a.review_status === "declined");
  const F = [["review", `To review (${rev.length})`], ["done", `Decided (${done.length})`], ["all", `All (${HS.apps.length})`]];
  const rows = HS.af === "review" ? rev : HS.af === "done" ? done : HS.apps;
  let html = `<div class="hs-chips">${F.map(([k, t]) => `<button class="hs-chip${HS.af === k ? " on" : ""}" data-f="${k}">${t}</button>`).join("")}</div>`;
  if (!rows.length) html += `<div class="hs-empty">${HS.af === "review" ? "Nothing waiting for review." : "Nothing here."}</div>`;
  for (const a of rows) {
    const p = a.properties || {};
    html += `<div class="hs-card"><div class="hs-mid"><b>${escH(a.applicant_name)}${hsPill(HS_REV_ST, a.review_status)}${hsPill(HS_FEE_ST, a.fee_status)}${a.possible_duplicate ? ' <span class="rv-pill n">possible duplicate</span>' : ""}</b>
      <small>${escH(p.title || "Home")}${p.city ? " · " + escH(p.city) : ""} · ${escH(a.ref)} · ${new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small>
      <small>${escH(a.applicant_phone || "")}${a.applicant_email ? " · " + escH(a.applicant_email) : ""}${a.desired_move_in ? " · move-in " + escH(a.desired_move_in) : ""}${a.occupants ? " · " + a.occupants + " people" : ""}</small>
      <small>Fee ${hsMoney(a.fee_amount, a.currency)}${a.payment_note ? " · " + escH(a.payment_note) : ""}</small>
      <div class="hs-acts">${hsTel(a.applicant_phone)}${a.fee_status === "unpaid" ? `<button class="go" data-fee="paid" data-id="${a.id}">Mark fee paid</button>` : ""}
      ${a.review_status !== "under_review" ? `<button data-rv="under_review" data-id="${a.id}">In review</button>` : ""}${a.review_status !== "approved" ? `<button data-rv="approved" data-id="${a.id}">Approve</button>` : ""}${a.review_status !== "declined" ? `<button data-rv="declined" data-id="${a.id}">Decline</button>` : ""}</div></div></div>`;
  }
  body.innerHTML = html;
  body.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { HS.af = b.dataset.f; hsDrawApps(); }));
  const upd = async (b, patch) => { b.disabled = true; const { error } = await supabaseClient.from("applications").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", b.dataset.id); if (error) { bvToast("Could not update: " + error.message.slice(0, 80)); b.disabled = false; return; } hsApps(); };
  body.querySelectorAll("[data-fee]").forEach((b) => (b.onclick = () => upd(b, { fee_status: "paid", paid_at: new Date().toISOString() })));
  body.querySelectorAll("[data-rv]").forEach((b) => (b.onclick = () => { if (b.dataset.rv === "declined" && !confirm("Decline this application?")) return; upd(b, { review_status: b.dataset.rv }); }));
}

// ───────── Homes (catalog) ─────────
async function hsHomes() {
  const { data, error } = await supabaseClient.from("properties").select("*").eq("product_id", HS.pid).order("state").order("sort_order").order("created_at", { ascending: true }).limit(500);
  if (error) { document.getElementById("hsBody").innerHTML = `<div class="hs-empty">Could not load homes: ${escH(error.message)}</div>`; return; }
  HS.props = data || []; hsDrawHomes();
}
function hsTourCfg() { const t = (hsProj()?.housing_settings || {}).tour || {}; return { slots: Array.isArray(t.slots) && t.slots.length ? t.slots : ["10:00", "12:00", "14:00", "16:00"], days: Array.isArray(t.days) && t.days.length ? t.days.map(Number) : [0, 1, 2, 3, 4, 5, 6], advance_days: t.advance_days || 14, capacity: t.capacity || 2 }; }
function hsDrawHomes() {
  const body = document.getElementById("hsBody"); if (!body) return;
  const cfg = hsTourCfg(), DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const ST = { available: ["Available", "ok"], pending: ["Pending", "br"], rented: ["Rented", "n"], hidden: ["Hidden", "n"] };
  let html = `<div class="hs-box"><h3>Tour times (fixed slots)</h3><div class="sub" style="margin:0 0 8px">Visitors pick one of these times on your site. Times are the property's local time.</div>
    <div class="hs-days">${DN.map((n, i) => `<label><input type="checkbox" class="hs-day" value="${i}" ${cfg.days.includes(i) ? "checked" : ""}> ${n}</label>`).join("")}</div>
    <div class="hs-f"><div class="full"><label>Times (24-hour, separated by commas)</label><input id="hsSlots" value="${escH(cfg.slots.join(", "))}" placeholder="10:00, 12:00, 14:00, 16:00"></div>
    <div><label>Tours allowed per time slot</label><input id="hsCap" type="number" min="1" max="50" value="${cfg.capacity}"></div><div><label>Bookable up to (days ahead)</label><input id="hsAdv" type="number" min="1" max="60" value="${cfg.advance_days}"></div></div>
    <div class="hs-acts"><button class="go" id="hsSaveTour">Save tour times</button></div></div>
    <div class="hs-top"><div class="hs-day" style="margin:0">Your homes (${HS.props.length})</div><button class="hs-chip on" id="hsAdd">+ Add a home</button></div>`;
  if (!HS.props.length) html += `<div class="hs-empty">No homes yet. Tap “Add a home”.</div>`;
  for (const p of HS.props) {
    const img = (Array.isArray(p.images) && p.images[0]) || "";
    html += `<div class="hs-card"><div class="hs-thumb" style="${img ? `background-image:url('${escH(img)}')` : ""}"></div><div class="hs-mid"><b>${escH(p.title)}${hsPill(ST, p.availability)}</b>
      <small>${hsMoney(p.monthly_rent, p.currency)}/mo · ${p.bedrooms === 0 || p.bedrooms === "0" ? "Studio" : (p.bedrooms ?? "?") + " bd"} · ${p.bathrooms ?? "?"} ba${p.sqft ? " · " + p.sqft + " sqft" : ""}</small>
      <small>${escH([p.address, p.city, p.state, p.postal_code].filter(Boolean).join(", ") || "No address yet")} · ${(p.images || []).length} photos</small>
      <div class="hs-acts"><button class="go" data-edit="${p.id}">Edit</button>${p.availability === "hidden" ? `<button data-av="available" data-id="${p.id}">Show on site</button>` : `<button data-av="hidden" data-id="${p.id}">Hide</button>`}${p.availability === "available" ? `<button data-av="rented" data-id="${p.id}">Mark rented</button>` : ""}<button data-del="${p.id}">Delete</button></div></div></div>`;
  }
  body.innerHTML = html;
  document.getElementById("hsAdd").onclick = () => hsEditHome(null);
  body.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => hsEditHome(HS.props.find((x) => x.id === b.dataset.edit))));
  body.querySelectorAll("[data-av]").forEach((b) => (b.onclick = async () => { b.disabled = true; const { error } = await supabaseClient.from("properties").update({ availability: b.dataset.av, updated_at: new Date().toISOString() }).eq("id", b.dataset.id); if (error) { bvToast(error.message.slice(0, 80)); b.disabled = false; return; } hsHomes(); }));
  body.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    const p = HS.props.find((x) => x.id === b.dataset.del); if (!confirm(`Delete “${p.title}” for good? (If it has applications or tours, hide it instead.)`)) return;
    const { error } = await supabaseClient.from("properties").delete().eq("id", p.id);
    if (error) { bvToast(/foreign key|violates/i.test(error.message) ? "This home has applications or tours, so it can't be deleted. Use Hide instead." : error.message.slice(0, 90)); return; }
    hsHomes();
  }));
  document.getElementById("hsSaveTour").onclick = async (e) => {
    const days = [...document.querySelectorAll(".hs-day:checked")].map((x) => Number(x.value));
    const slots = document.getElementById("hsSlots").value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).map((s) => (/^\d:\d{2}$/.test(s) ? "0" + s : s));
    if (!days.length) return bvToast("Pick at least one day.");
    if (!slots.length || slots.some((s) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(s))) return bvToast("Times must look like 10:00, 14:30 (24-hour).");
    const pr = hsProj(), tour = { slots: [...new Set(slots)].sort(), days, capacity: Math.min(50, Math.max(1, Number(document.getElementById("hsCap").value) || 2)), advance_days: Math.min(60, Math.max(1, Number(document.getElementById("hsAdv").value) || 14)) };
    e.target.disabled = true;
    const hsSet = { ...(pr.housing_settings || {}), tour };
    const { error } = await supabaseClient.from("products").update({ housing_settings: hsSet }).eq("id", pr.id);
    e.target.disabled = false;
    if (error) return bvToast("Could not save: " + error.message.slice(0, 80));
    pr.housing_settings = hsSet; bvToast("Tour times saved.");
  };
}
function hsEditHome(p) {
  const isNew = !p, d = p || { availability: "available", currency: hsProj()?.currency || "USD", application_fee: 20, lease_term: "12 months", property_type: "Apartment", images: [], amenities: [] };
  let imgs = Array.isArray(d.images) ? d.images.slice() : [];
  const stOpts = (HS_STATES.includes(d.state) || !d.state ? HS_STATES : [d.state, ...HS_STATES]).map((s) => `<option ${s === d.state ? "selected" : ""}>${escH(s)}</option>`).join("");
  const v = (x) => escH(x ?? "");
  bvModal(isNew ? "Add a home" : "Edit home", `<div class="hs hs-f" id="hsForm" style="font-size:14px">
    <div class="full"><label>Title *</label><input id="h_title" value="${v(d.title)}" placeholder="3 Bedroom Home, Columbia College Dr"></div>
    <div class="full"><label>Street address</label><input id="h_addr" value="${v(d.address)}" placeholder="716 Columbia College Dr"></div>
    <div><label>City *</label><input id="h_city" value="${v(d.city)}"></div><div><label>State *</label><select id="h_state"><option value="">Choose…</option>${stOpts}</select></div>
    <div><label>ZIP</label><input id="h_zip" value="${v(d.postal_code)}" inputmode="numeric"></div><div><label>Type</label><select id="h_type">${HS_TYPES.map((t) => `<option ${t === d.property_type ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    <div><label>Rent per month ($) *</label><input id="h_rent" type="number" min="0" value="${v(d.monthly_rent)}"></div><div><label>Deposit ($)</label><input id="h_dep" type="number" min="0" value="${v(d.deposit)}"></div>
    <div><label>Bedrooms (0 = studio)</label><input id="h_bed" type="number" min="0" step="0.5" value="${v(d.bedrooms)}"></div><div><label>Bathrooms</label><input id="h_bath" type="number" min="0" step="0.5" value="${v(d.bathrooms)}"></div>
    <div><label>Square feet</label><input id="h_sqft" type="number" min="0" value="${v(d.sqft)}"></div><div><label>Lease length</label><input id="h_lease" value="${v(d.lease_term)}"></div>
    <div><label>Application fee ($, 0 = none)</label><input id="h_fee" type="number" min="0" value="${v(d.application_fee)}"></div>
    <div><label>Status</label><select id="h_av">${[["available", "Available"], ["pending", "Pending"], ["rented", "Rented"], ["hidden", "Hidden (not on site)"]].map(([k, n]) => `<option value="${k}" ${k === d.availability ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div><label>Pets</label><input id="h_pets" value="${v(d.pet_policy)}" placeholder="Dogs and cats allowed"></div><div><label>Parking</label><input id="h_park" value="${v(d.parking)}" placeholder="Garage"></div>
    <div class="full"><label>Features (separate with commas)</label><input id="h_amen" value="${v((d.amenities || []).join(", "))}" placeholder="Air conditioning, Laundry, Fireplace"></div>
    <div class="full"><label>Description</label><textarea id="h_desc" rows="4">${v(d.description)}</textarea></div>
    <div class="full"><label>Application fee notice (shown to applicants)</label><textarea id="h_disc" rows="2">${v(d.fee_disclosure)}</textarea></div>
    <div class="full"><label>Photos (the first one is the cover)</label><input id="h_files" type="file" accept="image/*" multiple><div class="hs-ph" id="h_ph"></div></div>
    <div class="full hs-acts"><button class="go" id="h_save">${isNew ? "Add home" : "Save changes"}</button><button id="h_cancel">Cancel</button></div></div>`);
  const m = document.querySelector("#bvModalOverlay .bv-modal"); if (m) { m.style.maxWidth = "680px"; m.style.maxHeight = "92vh"; m.style.overflowY = "auto"; }
  const g = (id) => document.getElementById(id).value.trim();
  const drawPh = () => {
    const box = document.getElementById("h_ph"); if (!box) return;
    box.innerHTML = imgs.map((u, i) => `<div class="${i === 0 ? "cover" : ""}" style="background-image:url('${escH(u)}')">${i === 0 ? "<span>COVER</span>" : `<button class="mk" data-cover="${i}">Cover</button>`}<button data-rm="${i}" aria-label="Remove photo">✕</button></div>`).join("") || `<small style="color:#888">No photos yet.</small>`;
    box.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { imgs.splice(Number(b.dataset.rm), 1); drawPh(); }));
    box.querySelectorAll("[data-cover]").forEach((b) => (b.onclick = () => { const [x] = imgs.splice(Number(b.dataset.cover), 1); imgs.unshift(x); drawPh(); }));
  };
  drawPh();
  document.getElementById("h_cancel").onclick = () => bvCloseModal();
  document.getElementById("h_files").onchange = async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    const box = document.getElementById("h_ph"); let n = 0;
    for (const f of files) {
      if (imgs.length >= 30) { bvToast("Up to 30 photos per home."); break; }
      if (f.size > 20 * 1024 * 1024) { bvToast(f.name + " is over 20 MB."); continue; }
      box.insertAdjacentHTML("beforeend", `<small id="h_up" style="color:#888;align-self:center">Uploading ${++n}/${files.length}…</small>`);
      try { imgs.push(await window.rvUpload(supabaseClient, "site-media", f)); } catch (err) { bvToast("Upload failed: " + (err.message || err)); }
      drawPh();
    }
    e.target.value = "";
  };
  document.getElementById("h_save").onclick = async (e) => {
    const title = g("h_title"), city = g("h_city"), state = document.getElementById("h_state").value, rent = g("h_rent");
    if (!title) return bvToast("Please add a title.");
    if (!city || !state) return bvToast("Please add the city and the state.");
    if (rent === "" || Number(rent) < 0) return bvToast("Please add the monthly rent.");
    const n = (id) => (g(id) === "" ? null : Number(g(id)));
    const row = { title, address: g("h_addr") || null, city, state, postal_code: g("h_zip") || null, property_type: document.getElementById("h_type").value, monthly_rent: Number(rent), deposit: n("h_dep"),
      bedrooms: n("h_bed"), bathrooms: n("h_bath"), sqft: n("h_sqft") == null ? null : Math.round(n("h_sqft")), lease_term: g("h_lease") || null, application_fee: n("h_fee") ?? 0, availability: document.getElementById("h_av").value,
      pet_policy: g("h_pets") || null, parking: g("h_park") || null, amenities: g("h_amen").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40), description: g("h_desc") || null, fee_disclosure: g("h_disc") || null,
      images: imgs.filter((u) => /^https:\/\//i.test(u)).slice(0, 30), updated_at: new Date().toISOString() };
    e.target.disabled = true; e.target.textContent = "Saving…";
    let error;
    if (isNew) {
      const base = hsSlug(title + " " + city) || "home";
      for (let i = 0; i < 6; i++) {
        const slug = i ? base + "-" + (i + 1) : base;
        ({ error } = await supabaseClient.from("properties").insert({ ...row, slug, product_id: HS.pid, company_id: (await hsCompany()), currency: hsProj()?.currency || "USD", sort_order: HS.props.length }));
        if (!error || !/duplicate|unique/i.test(error.message)) break;
      }
    } else ({ error } = await supabaseClient.from("properties").update(row).eq("id", p.id));
    if (error) { e.target.disabled = false; e.target.textContent = isNew ? "Add home" : "Save changes"; return bvToast("Could not save: " + error.message.slice(0, 90)); }
    bvCloseModal(); bvToast(isNew ? "Home added. It shows on your site now." : "Saved. Your site is updated."); hsHomes();
  };
}
let _hsCo = null;
async function hsCompany() {
  if (_hsCo) return _hsCo;
  const { data } = await supabaseClient.from("products").select("company_id").eq("id", HS.pid).maybeSingle();
  return (_hsCo = data?.company_id || null);
}
