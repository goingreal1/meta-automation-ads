// Revora dashboard, part 34: ADAPTIVE SCREENS. One question decides what the app shows: what does this business sell?
// Kinds: "orders" (products delivered), "bookings" (appointments), "housing" (rentals: tours and applications).
// The Orders tab takes the name and the content of what is sold; the separate Bookings and Housing tabs are gone (their screens live inside Orders);
// the Overview speaks only about what the business sells. Nothing is moved: the same data, the same screens, shown by kind.
const AD = { kinds: null, at: 0, seg: null };
const AD_NAME = { orders: "Orders", bookings: "Bookings", housing: "Rentals" };
const AD_ORDER = ["orders", "bookings", "housing"];

async function bvKinds(force) {
  if (!force && AD.kinds && Date.now() - AD.at < 60000) return AD.kinds;
  const rows = (await sbQuery("products", "select=product_type,is_active&is_active=eq.true&limit=500").catch(() => null)) || [];
  const k = new Set();
  rows.forEach((p) => k.add(p.product_type === "housing" ? "housing" : p.product_type === "booking" ? "bookings" : "orders"));
  if (!k.size) k.add("orders");
  AD.kinds = k; AD.at = Date.now();
  return k;
}
const bvKindList = (k) => AD_ORDER.filter((x) => k.has(x));
const bvOrdersName = (k) => (k.size === 1 ? AD_NAME[[...k][0]] : "Orders");

// Names the Orders tab after what is sold and hides the old Bookings / Housing tabs.
async function bvApplyKinds() {
  try {
    const k = await bvKinds(true), name = bvOrdersName(k);
    const lbl = document.querySelector('[data-tab="orders"] .tab-label'); if (lbl) lbl.textContent = name;
    document.querySelectorAll('.bn-item[data-go="orders"] span:nth-child(2)').forEach((s) => (s.textContent = name));
    ["bookings", "housing"].forEach((t) => document.querySelector(`[data-tab="${t}"]`)?.style.setProperty("display", "none"));
    if (typeof bvSyncBottomNav === "function") bvSyncBottomNav();
  } catch (e) { /* the app works without it */ }
}

// ───────── Orders tab ─────────
async function renderOrdersHub(c, want) {
  const kinds = await bvKinds();
  let list = bvKindList(kinds);
  if (want && !list.includes(want)) list = list.concat([want]);
  const draw = async (k, box) => (k === "bookings" ? renderBookings(box) : k === "housing" ? renderHousing(box) : renderOrders(box));
  if (list.length === 1) { AD.seg = list[0]; return draw(list[0], c); }
  const cur = want || (AD.seg && list.includes(AD.seg) ? AD.seg : list[0]);
  AD.seg = cur;
  c.innerHTML = `<div class="rv-ui"><div id="adSeg" style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px">${list.map((k) => `<button type="button" data-k="${k}" style="padding:8px 16px;border-radius:99px;font:600 13px inherit;cursor:pointer;border:1px solid var(--border,#e7e3da);background:${k === cur ? "var(--text,#14130f)" : "var(--panel,#fff)"};color:${k === cur ? "var(--bg,#fff)" : "var(--text,#14130f)"}">${AD_NAME[k]}</button>`).join("")}</div><div id="adBody"></div></div>`;
  c.querySelectorAll("#adSeg [data-k]").forEach((b) => (b.onclick = () => renderOrdersHub(c, b.dataset.k)));
  await draw(cur, document.getElementById("adBody"));
}

// ───────── Overview ─────────
const adMoney = (n) => "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");
const adTile = (label, value, note) => `<div style="background:var(--panel,#fff);border:1px solid var(--border,#e7e3da);border-radius:16px;padding:14px"><div style="font-size:13px;color:var(--muted,#6a665b)">${label}</div><div style="font-size:26px;font-weight:700;letter-spacing:-.02em;margin-top:4px">${value}</div>${note ? `<div style="font-size:12px;color:var(--muted,#6a665b);margin-top:2px">${note}</div>` : ""}</div>`;
const adGrid = (tiles) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 16px">${tiles.join("")}</div>`;
const adList = (title, rows, empty) => `<div style="margin:0 0 18px"><div style="font-size:12px;font-weight:700;letter-spacing:.05em;color:var(--muted,#6a665b);margin:0 0 8px">${title}</div>${rows.length ? `<div style="background:var(--panel,#fff);border:1px solid var(--border,#e7e3da);border-radius:16px;overflow:hidden">${rows.join("")}</div>` : `<div style="color:var(--muted,#6a665b);font-size:14px">${empty}</div>`}</div>`;
const adRow = (a, b) => `<div style="display:flex;gap:12px;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border,#f0ede6)"><div style="min-width:0"><div style="font-weight:600">${a}</div><div style="font-size:13px;color:var(--muted,#6a665b)">${b}</div></div></div>`;

async function adSpend(days) {
  try { const r = await fetchLiveDaily(watDate(-(days - 1)), watDate(0)); return r && r.ok ? liveSum(r.rows || []).spend || 0 : 0; } catch (e) { return 0; }
}
async function adBookingsHtml(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString(), now = new Date().toISOString(), day0 = watDate(0);
  const [recent, upcoming, spend] = await Promise.all([
    sbQuery("bookings", `select=status,price_naira,starts_at,created_at&created_at=gte.${since}&limit=2000`).catch(() => []),
    sbQuery("bookings", `select=customer_name,service_name,starts_at,status&starts_at=gte.${now}&status=in.(confirmed,pending_payment)&order=starts_at.asc&limit=40`).catch(() => []),
    adSpend(days)
  ]);
  const today = (upcoming || []).filter((b) => new Date(new Date(b.starts_at).getTime() + 3600000).toISOString().slice(0, 10) === day0);
  const done = (recent || []).filter((b) => b.status === "confirmed" || b.status === "completed");
  const noShow = (recent || []).filter((b) => b.status === "no_show").length, closed = noShow + (recent || []).filter((b) => b.status === "completed").length;
  const rev = done.reduce((t, b) => t + Number(b.price_naira || 0), 0);
  const fmt = (iso) => new Date(iso).toLocaleString("en-NG", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
  return adGrid([
    adTile("Bookings today", String(today.length), `${(upcoming || []).length} coming up`),
    adTile(`Bookings, last ${days} days`, String((recent || []).length), `${done.length} confirmed or done`),
    adTile("Revenue", adMoney(rev), `last ${days} days`),
    adTile("No-shows", closed ? Math.round(noShow / closed * 100) + "%" : "0%", `${noShow} of ${closed} finished`),
    ...(spend > 0 ? [adTile("Cost per booking", (recent || []).length ? adMoney(spend / (recent || []).length) : "–", `Ad spend ${adMoney(spend)}`)] : [])
  ]) + adList("NEXT UP", (upcoming || []).slice(0, 5).map((b) => adRow(escH(b.customer_name || "Customer"), `${escH(b.service_name || "Booking")} · ${fmt(b.starts_at)}`)), "No upcoming bookings yet.");
}
async function adHousingHtml(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString(), day = watDate(0);
  const [apps, tours, spend] = await Promise.all([
    sbQuery("applications", `select=review_status,fee_status,applicant_name,created_at&created_at=gte.${since}&order=created_at.desc&limit=2000`).catch(() => []),
    sbQuery("tours", `select=visitor_name,tour_date,tour_time,status,created_at&order=tour_date.asc&limit=500`).catch(() => []),
    adSpend(days)
  ]);
  const st = (a) => String(a.review_status || "").toLowerCase();
  const approved = (apps || []).filter((a) => st(a) === "approved").length, declined = (apps || []).filter((a) => /declin|reject/.test(st(a))).length, fresh = (apps || []).filter((a) => !["approved"].includes(st(a)) && !/declin|reject/.test(st(a))).length;
  const upcoming = (tours || []).filter((t) => String(t.tour_date || "") >= day && !/cancel/i.test(String(t.status || "")));
  const toursNew = (tours || []).filter((t) => new Date(t.created_at).getTime() >= Date.now() - days * 86400000).length;
  return adGrid([
    adTile("Applications", String((apps || []).length), `${fresh} new or in review`),
    adTile("Tours booked", String(toursNew), `${upcoming.length} coming up`),
    adTile("Approval rate", approved + declined ? Math.round(approved / (approved + declined) * 100) + "%" : "–", `${approved} approved, ${declined} declined`),
    ...(spend > 0 ? [adTile("Cost per application", (apps || []).length ? adMoney(spend / (apps || []).length) : "–", `Ad spend ${adMoney(spend)}`)] : [])
  ]) + adList("UPCOMING TOURS", upcoming.slice(0, 5).map((t) => adRow(escH(t.visitor_name || "Visitor"), `${escH(t.tour_date || "")} ${escH(String(t.tour_time || "").slice(0, 5))}`)), "No tours coming up.");
}
// The page for a business that does not sell delivered products, or the strip above the product overview for one that sells several kinds.
async function adKindsHtml(kinds, days) {
  const parts = [];
  if (kinds.has("bookings")) parts.push(`<h3 style="margin:0 0 10px;font-size:17px">Bookings</h3>` + (await adBookingsHtml(days)));
  if (kinds.has("housing")) parts.push(`<h3 style="margin:0 0 10px;font-size:17px">Rentals</h3>` + (await adHousingHtml(days)));
  return parts.join("");
}
const renderOverviewProducts = renderOverview;
async function renderOverviewAdaptive(el) {
  const kinds = await bvKinds();
  if (kinds.has("orders")) {
    await renderOverviewProducts(el);
    if (kinds.size > 1) { try { el.insertAdjacentHTML("afterbegin", `<div class="rv-ui" id="adStrip" style="margin-bottom:6px">${await adKindsHtml(kinds, OV.range || 7)}</div>`); } catch (e) {} }
    return;
  }
  const days = OV.range || 7;
  el.innerHTML = `<div class="rv-ui"><h2 style="margin:0 0 4px">Overview</h2><div class="sub" style="margin-bottom:14px">${kinds.has("bookings") && kinds.has("housing") ? "Bookings and rentals" : kinds.has("bookings") ? "Bookings" : "Rentals"}, last ${days} days.</div><div id="adBody">${typeof bvSkel === "function" ? bvSkel() : ""}</div></div>`;
  document.getElementById("adBody").innerHTML = await adKindsHtml(kinds, days);
}
renderOverview = renderOverviewAdaptive;
