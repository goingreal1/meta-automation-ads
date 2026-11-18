// Revora dashboard, part 25 of 26: ORDERS (rebuilt). List on the left, the chosen order on the right (on a phone: cards, then one order per screen).
// Everything shown comes from the order row itself (and its payment, rider and AI call). A thing the system does not know is left out.

Object.assign(RV_IC, {
  phone: '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 01-12.2 7.5L3 20.5l1.6-5.4A8.4 8.4 0 1121 11.5z"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  dl: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
});

const ORD = { tab: "all", q: "", product: "", buyer: "", days: "", sel: null, rows: [], tot: 0, counts: {}, buyers: [], products: [], agents: {}, flagged: [], oldNew: 0, today: 0, busy: false, menu: false, mDetail: false };
const ORD_TABS = [["all", "All"], ["new", "New"], ["confirmed", "Confirmed"], ["out", "Out for delivery"], ["delivered", "Delivered"], ["returned", "Returned"], ["cancelled", "Cancelled"]];
const ORD_TAB_Q = {
  all: "",
  new: "order_status=eq.pending",
  confirmed: "order_status=eq.valid&and=(or(delivery_stage.is.null,delivery_stage.neq.on_the_way))",
  out: "order_status=eq.valid&delivery_stage=eq.on_the_way",
  delivered: "order_status=eq.delivered",
  returned: "order_status=eq.returned",
  cancelled: "order_status=eq.cancelled",
};

// What a person calls the state of an order.
function ordState(o) {
  const s = o.order_status || "pending";
  if (s === "pending") return { k: "new", l: "New", c: "warn" };
  if (s === "valid" && o.delivery_stage === "on_the_way") return { k: "out", l: "Out for delivery", c: "br" };
  if (s === "valid") return { k: "confirmed", l: "Confirmed", c: "br" };
  if (s === "delivered") return { k: "delivered", l: "Delivered", c: "ok" };
  if (s === "returned") return { k: "returned", l: "Returned", c: "bad" };
  if (s === "cancelled") return { k: "cancelled", l: "Cancelled", c: "n" };
  return { k: s, l: s, c: "n" };
}
const ordRef = (o) => "#" + String(o.id || "").replace(/-/g, "").slice(-5).toUpperCase();
function ordWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date(), t = d.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, now)) return "Today " + t;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(d, y)) return "Yesterday " + t;
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short" }) + ", " + t;
}
const ordDay = (iso) => { const d = new Date(iso), now = new Date(); if (d.toDateString() === now.toDateString()) return "today"; const s = Math.floor((now - d) / 86400000); return s <= 1 ? "yesterday" : s + "d ago"; };

// Money chip: paid online, deposit taken, or cash on delivery.
function ordPay(o) {
  const p = o.payment;
  if (p && p.status === "confirmed") return { k: "PAID", c: "ok", note: "Paid online" + (p.paid_at ? " " + ordDay(p.paid_at) : "") };
  if (o.deposit_amount_naira > 0 && /paid|success|confirmed/i.test(o.deposit_status || "")) return { k: "DEPOSIT", c: "br", note: `Deposit of ${fN(o.deposit_amount_naira)} received` };
  if (p && p.status === "unmatched") return { k: "CHECK", c: "bad", note: "A deposit arrived that could not be matched to this order. Check before collecting cash too." };
  return { k: "COD", c: "warn", note: `${fN(o.cod_amount_naira || o.order_value_naira)} to collect on delivery` };
}

function ordFilterQuery(skipTab) {
  const f = [];
  if (!skipTab && ORD_TAB_Q[ORD.tab]) f.push(ORD_TAB_Q[ORD.tab]);
  const q = ORD.q.replace(/[,()*%]/g, " ").trim();
  if (q) f.push(`or=(customer_name.ilike.*${encodeURIComponent(q)}*,customer_phone.ilike.*${encodeURIComponent(q)}*,product_name.ilike.*${encodeURIComponent(q)}*)`);
  if (ORD.product) f.push("product_name=eq." + encodeURIComponent(ORD.product));
  if (ORD.buyer) f.push("media_buyer_id=eq." + ORD.buyer);
  if (ORD.days) f.push("ordered_at=gte." + new Date(Date.now() - ORD.days * 86400000).toISOString());
  return f.join("&");
}

// ---- data ----
async function ordLoad(el, withCounts) {
  const root = el || document.getElementById("ordRoot")?.parentElement;
  ORD.busy = true; ordDraw();
  const f = ordFilterQuery(false), join = (a, b) => [a, b].filter(Boolean).join("&");
  const jobs = [
    sbQuery("orders", join("select=*,media_buyers(code,name),voice_calls(status,summary,needs_human,human_resolved_at,created_at),payments(status,amount_naira,paid_at)&order=ordered_at.desc&limit=" + ORDERS_PAGE_SIZE + "&offset=" + ordersPage * ORDERS_PAGE_SIZE, f)),
    sbCount("orders", f),
  ];
  if (withCounts) {
    const base = ordFilterQuery(true), day = new Date(); day.setHours(0, 0, 0, 0);
    jobs.push(Promise.all(ORD_TABS.map(([k]) => sbCount("orders", join(base, ORD_TAB_Q[k])))));
    jobs.push(sbCount("orders", "order_status=eq.pending&ordered_at=lt." + new Date(Date.now() - 86400000).toISOString()));
    jobs.push(sbCount("orders", "ordered_at=gte." + day.toISOString()));
    jobs.push(sbQuery("voice_calls", "select=*,orders(customer_name,customer_phone,product_name)&needs_human=is.true&human_resolved_at=is.null&order=created_at.desc&limit=50").catch(() => []));
    jobs.push(sbQuery("media_buyers", "select=id,code,name&order=name.asc").catch(() => []));
    jobs.push(sbQuery("products", "select=name&order=name.asc&limit=300", { allAccounts: true }).catch(() => []));
    jobs.push(sbQuery("delivery_agents", "select=id,name,phone").catch(() => []));
  }
  const r = await Promise.all(jobs).catch((e) => { ORD.busy = false; ORD.error = e.message; ordDraw(); return null; });
  if (!r) return;
  ORD.error = null;
  const rows = r[0] || [];
  rows.forEach((o) => { o.voice_call = (o.voice_calls || []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] || null; o.payment = (o.payments || [])[0] || null; });
  ORD.rows = rows; ORD.tot = r[1]; window.bvOrdersCache = rows;
  if (withCounts) {
    ORD.counts = Object.fromEntries(ORD_TABS.map(([k], i) => [k, r[2][i]]));
    ORD.oldNew = r[3]; ORD.today = r[4]; ORD.flagged = r[5] || []; ORD.buyers = r[6] || [];
    ORD.products = [...new Set((r[7] || []).map((x) => x.name).filter(Boolean))];
    ORD.agents = Object.fromEntries((r[8] || []).map((a) => [a.id, a]));
  }
  if (!ORD.rows.some((o) => o.id === ORD.sel)) ORD.sel = ORD.rows[0]?.id || null;
  ORD.busy = false; ordDraw();
}

async function renderOrders(el) {
  el.innerHTML = `<div class="rv-ui" id="ordRoot"></div>`;
  ORD.mDetail = false;
  el.onclick = ordClick;
  await ordLoad(el, true);
}

// ---- pieces ----
function ordRow(o) {
  const st = ordState(o), pay = ordPay(o), on = o.id === ORD.sel;
  const rider = o.delivery_agent_id ? ORD.agents[o.delivery_agent_id]?.name : "";
  const del = rider ? `<b>${escH(rider)}</b><span class="s2">Rider</span>` : o.shipbubble_courier ? `<b>${escH(o.shipbubble_courier)}</b><span class="s2">${escH(o.shipbubble_tracking_code || "Courier")}</span>` : o.customer_city ? `<b>${escH(o.customer_city)}</b><span class="s2">${escH(o.customer_state || "")}</span>` : `<span class="rv-mut3">—</span>`;
  return `<tr class="ox-tr${on ? " on" : ""}" data-oid="${o.id}"><td><b>${ordRef(o)}</b><span class="s2">${ordDay(o.ordered_at)}</span></td>
    <td><b>${escH(o.customer_name || "—")}</b><span class="s2">${escH(o.customer_phone || "")}</span></td>
    <td class="ox-prod">${escH(o.product_name || "—")}${o.quantity > 1 ? ` <span class="rv-mut3">× ${o.quantity}</span>` : ""}</td>
    <td class="num ox-amt"><b>${fN(o.order_value_naira)}</b> <span class="ox-chip ${pay.c}">${pay.k}</span></td>
    <td><span class="rv-pill ${st.c}">${st.l}</span>${o.possible_duplicate ? ` <span class="rv-pill bad n" title="Same customer, same address, within the last hour">Possible duplicate</span>` : ""}</td>
    <td class="ox-del">${del}</td></tr>`;
}
function ordCard(o) {
  const st = ordState(o), pay = ordPay(o), phone = (o.customer_phone || "").replace(/\D/g, "");
  return `<div class="ox-card" data-oid="${o.id}"><div class="r1"><b>${ordRef(o)}</b><span class="rv-pill ${st.c}">${st.l}</span><span class="rv-mut3" style="margin-left:auto">${ordDay(o.ordered_at)}</span></div>
    <div class="r2"><div style="min-width:0"><b>${escH(o.customer_name || "—")}</b><span class="s2">${escH(o.product_name || "")}</span></div>
      <div style="text-align:right"><b>${fN(o.order_value_naira)}</b> <span class="ox-chip ${pay.c}">${pay.k}</span></div></div>
    ${phone ? `<div class="r3"><a class="rv-btn s" href="tel:${escH(o.customer_phone)}">${rvIc("phone")}Call</a><a class="rv-btn s" href="https://wa.me/${phone}" target="_blank" rel="noopener">${rvIc("chat")}WhatsApp</a></div>` : ""}</div>`;
}

function ordTimeline(o) {
  const s = o.order_status, out = o.delivery_stage === "on_the_way", ev = [];
  ev.push({ l: "Order placed", t: o.ordered_at, d: true });
  if (o.care_assigned_at) ev.push({ l: "Passed to customer care", t: o.care_assigned_at, d: true });
  const confirmed = s !== "pending" && s !== "cancelled";
  if (s !== "cancelled") ev.push({ l: "Confirmed", t: null, d: confirmed });
  if (o.shipbubble_created_at) ev.push({ l: "Booked with " + (o.shipbubble_courier || "courier"), t: o.shipbubble_created_at, d: true });
  if (s === "returned") { ev.push({ l: "Out for delivery", t: null, d: true }); ev.push({ l: "Returned", t: o.updated_at, d: true, bad: true }); }
  else if (s === "cancelled") ev.push({ l: "Cancelled", t: o.updated_at, d: true, bad: true });
  else {
    ev.push({ l: "Out for delivery", t: null, d: out || s === "delivered" });
    ev.push({ l: "Delivered", t: o.delivered_at, d: s === "delivered" });
  }
  if (o.cod_collected_at) ev.push({ l: "Cash collected", t: o.cod_collected_at, d: true });
  if (o.cod_remitted_at) ev.push({ l: "Cash paid out", t: o.cod_remitted_at, d: true });
  const cur = ev.findIndex((e) => !e.d);
  return `<div class="ox-tm">${ev.map((e, i) => `<div class="ev${e.d ? " done" : ""}${i === cur ? " cur" : ""}${e.bad ? " bad" : ""}"><i></i><b>${escH(e.l)}</b>${e.t ? `<small>${ordWhen(e.t)}</small>` : ""}</div>`).join("")}</div>`;
}

function ordDetailHtml(o) {
  if (!o) return `<div class="rv-empty" style="padding:30px 20px">Pick an order on the left to see it here.</div>`;
  const st = ordState(o), pay = ordPay(o), phone = (o.customer_phone || "").replace(/\D/g, "");
  const { opts, locked, cur } = bvOrderStatusOptions(o);
  const place = [o.customer_address, o.customer_city, o.customer_state].filter(Boolean).map(escH).join(", ");
  const kv = (k, v) => v ? `<span class="k">${k}</span><span class="vv">${v}</span>` : "";
  const extra = o.form_data && typeof o.form_data === "object" ? Object.entries(o.form_data).filter(([, v]) => v).map(([k, v]) => kv(escH(k.replace(/_/g, " ")), escH(String(v)))).join("") : "";
  const rider = o.delivery_agent_id ? ORD.agents[o.delivery_agent_id] : null;
  const fee = Number(o.shipping_fee_naira) || 0;
  const delivery = [
    o.shipbubble_courier ? kv("Courier", escH(o.shipbubble_courier) + " via Shipbubble") : "",
    o.shipbubble_tracking_code ? kv("Tracking", o.shipbubble_tracking_url ? `<a class="rv-lnk" href="${escH(o.shipbubble_tracking_url)}" target="_blank" rel="noopener">${escH(o.shipbubble_tracking_code)}</a>` : escH(o.shipbubble_tracking_code)) : "",
    rider ? kv("Rider", escH(rider.name) + (rider.phone ? ` · <a class="rv-lnk" href="tel:${escH(rider.phone)}">${escH(rider.phone)}</a>` : "")) : "",
    o.shipbubble_status ? kv("Courier status", escH(String(o.shipbubble_status).replace(/_/g, " "))) : "",
  ].join("");
  const src = [
    o.media_buyers ? kv("Media buyer", escH(o.media_buyers.name || o.media_buyers.code)) : "",
    o.meta_ad_id ? kv("Ad ID", escH(o.meta_ad_id)) : "",
    o.attribution_source ? kv("Source", escH(String(o.attribution_source).replace(/_/g, " "))) : "",
    o.capi_sent || o.capi_paid_sent_at ? kv("Meta", `Purchase sent to Meta${o.capi_paid_sent_at ? " · " + ordWhen(o.capi_paid_sent_at) : ""}`) : "",
  ].join("");
  const flagged = o.voice_call && o.voice_call.needs_human && !o.voice_call.human_resolved_at;
  return `<div class="ox-sec"><div class="rv-back" onclick="ordBack()">${rvIc("chev")}Orders</div>
      <div class="ox-hd"><div><div class="rv-mut3">Order</div><div class="ox-no">${ordRef(o)}</div><div class="rv-mut3">Placed ${ordWhen(o.ordered_at)}</div></div><span class="rv-pill ${st.c}">${st.l}</span></div>
      ${o.possible_duplicate ? `<div class="rv-note warn" style="margin:12px 0 0">${rvIc("alert")}<span>Same customer and address ordered within the hour. Check this is not a double order.</span></div>` : ""}
      <div class="ox-act">${phone ? `<a class="rv-btn s p" href="tel:${escH(o.customer_phone)}">${rvIc("phone")}Call</a><a class="rv-btn s" href="https://wa.me/${phone}" target="_blank" rel="noopener">${rvIc("chat")}WhatsApp</a>` : ""}
        <details class="rv-menu"><summary class="rv-btn s" ${locked ? 'title="Delivered orders can only be changed by an admin" style="opacity:.55;pointer-events:none"' : ""}>Change status${rvIc("down")}</summary>
          <div class="rv-pop">${opts.map((x) => `<button type="button" data-st="${x.v}" ${x.ok && x.v !== cur ? "" : "disabled"}>${x.v === cur ? "✓ " : ""}${x.l === "Pending" ? "New" : x.l === "Valid" ? "Confirmed" : x.l}</button>`).join("")}</div></details>
        <button type="button" class="rv-btn s" data-hist="${o.id}">History</button></div></div>
    <div class="ox-sec"><h4>Customer</h4><div class="ox-kv">${kv("Name", o.customer_id ? `<a class="rv-lnk" href="javascript:void(0)" onclick="bvShowCustomerModal('${o.customer_id}')">${escH(o.customer_name || "—")}</a>` : escH(o.customer_name || "—"))}${kv("Phone", escH(o.customer_phone || ""))}${kv("Email", escH(o.customer_email || ""))}${kv("Address", place)}${extra}${kv("Note", escH(o.care_note || ""))}</div></div>
    <div class="ox-sec"><h4>Payment</h4>
      <div class="li"><span>${escH(o.product_name || "Order")}${o.quantity > 1 ? " × " + o.quantity : ""}</span><span>${fN(o.order_value_naira)}</span></div>
      ${fee ? `<div class="li"><span class="rv-mut">Delivery fee</span><span>${fN(fee)}</span></div>` : ""}
      <div class="li t"><span>Order value</span><span>${fN(o.order_value_naira)}</span></div>
      <div class="ox-payn"><span class="ox-chip ${pay.c}">${pay.k}</span><span class="rv-mut">${escH(pay.note)}</span></div></div>
    <div class="ox-sec"><h4>Delivery</h4>${delivery ? `<div class="ox-kv">${delivery}</div>` : ""}${ordTimeline(o)}</div>
    <div class="ox-sec"><h4>Confirmation call</h4><div class="ox-call">${bvOrderCallCell(o)}</div>${o.voice_call?.summary ? `<p class="rv-mut" style="margin:8px 0 0;font-size:13px">${escH(o.voice_call.summary)}</p>` : ""}${flagged ? `<div style="margin-top:8px"><button type="button" class="rv-btn s" data-resolve="${escH(ORD.flagged.find((c) => c.order_id === o.id)?.id || "")}" ${ORD.flagged.some((c) => c.order_id === o.id) ? "" : "hidden"}>Mark handled</button></div>` : ""}</div>
    ${src ? `<div class="ox-sec"><h4>Where it came from</h4><div class="ox-kv">${src}</div></div>` : ""}`;
}

function ordFlaggedHtml() {
  if (!ORD.flagged.length) return "";
  return `<div class="rv-card ox-flag"><div class="ox-flag-h"><b>${ORD.flagged.length} AI call${ORD.flagged.length === 1 ? "" : "s"} need a human</b><span class="rv-mut3">The AI could not settle these on the phone</span></div>
    ${ORD.flagged.slice(0, 5).map((c) => `<div class="ox-flag-r"><div style="min-width:0"><b>${escH(c.orders?.customer_name ?? "—")}</b> <span class="rv-mut3">${escH(c.orders?.product_name ?? "")}</span>
      <span class="s2">${(c.red_flags || []).map((x) => escH(String(x).replace(/_/g, " "))).join(" · ")}${c.summary ? " · " + escH(c.summary) : ""}</span></div>
      <a class="rv-btn s" href="tel:${escH(c.to_number)}">${rvIc("phone")}Call</a><button type="button" class="rv-btn s" data-resolve="${escH(c.id)}">Mark handled</button></div>`).join("")}
    ${ORD.flagged.length > 5 ? `<div class="rv-mut3" style="padding:8px 16px">and ${ORD.flagged.length - 5} more</div>` : ""}</div>`;
}

function ordDraw() {
  const root = document.getElementById("ordRoot"); if (!root) return;
  const t = ORD.tot, pages = Math.max(1, Math.ceil(t / ORDERS_PAGE_SIZE)), a = t ? ordersPage * ORDERS_PAGE_SIZE + 1 : 0, b = Math.min(t, (ordersPage + 1) * ORDERS_PAGE_SIZE);
  const sel = ORD.rows.find((o) => o.id === ORD.sel);
  const keepQ = document.getElementById("ordQ"), hadFocus = keepQ && document.activeElement === keepQ;
  const sub = ORD.counts.all != null ? `${ORD.counts.all.toLocaleString()} orders${ORD.today ? " · " + ORD.today + " today" : ""}` : "";
  const head = `<div class="rv-head"><div><h1>Orders</h1><p class="rv-hm">${sub}</p></div><div class="rv-sp" style="flex:1"></div>
    <button type="button" class="rv-btn rv-hm" id="ordersExportBtn" onclick="bvExportOrdersCsv(this)">Export</button>
    <button type="button" class="rv-btn" onclick="renderOrders(document.getElementById('mainContent'))" aria-label="Refresh">${rvIc("refresh")}</button></div>
    <div class="ox-segw"><div class="rv-seg">${ORD_TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${ORD.tab === k ? "on" : ""}">${l}<em>${ORD.counts[k] ?? ""}</em></button>`).join("")}</div></div>`;
  if (ORD.error) { root.innerHTML = head + `<div class="rv-note warn">${rvIc("alert")}<span>${escH(ORD.error)}</span></div>`; return; }
  const filters = `<div class="ox-tb"><label class="rv-fld" style="margin:0;flex:1;min-width:200px">${rvIc("search")}<input id="ordQ" type="search" placeholder="Search name, phone or product" value="${escH(ORD.q)}" autocomplete="off"></label>
    <select class="rv-sel ox-f" id="ordProd"><option value="">Product</option>${ORD.products.map((p) => `<option ${ORD.product === p ? "selected" : ""}>${escH(p)}</option>`).join("")}</select>
    <select class="rv-sel ox-f" id="ordBuyer"><option value="">Media buyer</option>${ORD.buyers.map((x) => `<option value="${x.id}" ${ORD.buyer === x.id ? "selected" : ""}>${escH(x.name || x.code)}</option>`).join("")}</select>
    <select class="rv-sel ox-f" id="ordDays">${[["", "All time"], ["1", "Last 24 hours"], ["7", "Last 7 days"], ["30", "Last 30 days"]].map(([v, l]) => `<option value="${v}" ${ORD.days === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
  const stale = ORD.oldNew ? `<div class="rv-note warn" style="margin:12px 16px 0">${rvIc("alert")}<span><b>${ORD.oldNew} new order${ORD.oldNew === 1 ? "" : "s"}</b> have waited more than 24 hours for a confirmation.</span><button type="button" class="rv-btn s" style="margin-left:auto" data-tab="new">Show them</button></div>` : "";
  const body = ORD.busy && !ORD.rows.length ? `<div class="rv-note" style="margin:16px"><span class="spin"></span><span>Loading orders…</span></div>`
    : !ORD.rows.length ? `<div class="rv-empty" style="padding:28px 20px">${ORD.counts.all ? "No orders match these filters." : "No orders yet. They show up here the moment a customer orders."}</div>`
    : `<div class="ox-tw"><table class="rv-tbl ox-t"><thead><tr><th>Order</th><th>Customer</th><th>Product</th><th class="num">Amount</th><th>Status</th><th>Delivery</th></tr></thead><tbody>${ORD.rows.map(ordRow).join("")}</tbody></table></div>
       <div class="ox-cards">${ORD.rows.map(ordCard).join("")}</div>
       <div class="ox-pg"><span class="rv-mut3">Showing ${a}–${b} of ${t}</span><span><button type="button" class="rv-btn s" data-pg="-1" ${ordersPage === 0 ? "disabled" : ""}>Prev</button> <span class="rv-mut3">Page ${ordersPage + 1} of ${pages}</span> <button type="button" class="rv-btn s" data-pg="1" ${ordersPage >= pages - 1 ? "disabled" : ""}>Next</button></span></div>`;
  root.innerHTML = head + ordFlaggedHtml() + `<div class="ox-split${ORD.mDetail ? " m-detail" : ""}${ORD.busy ? " busy" : ""}"><section class="rv-card ox-list">${filters}${stale}${body}</section><section class="rv-card ox-dt" id="ordDt">${ordDetailHtml(sel)}</section></div>
    ${sel ? `<div class="ordx-bar">${(sel.customer_phone || "").replace(/\D/g, "") ? `<a class="rv-btn p" href="tel:${escH(sel.customer_phone)}">${rvIc("phone")}Call</a><a class="rv-btn" href="https://wa.me/${sel.customer_phone.replace(/\D/g, "")}" target="_blank" rel="noopener">${rvIc("chat")}WhatsApp</a>` : ""}<button type="button" class="rv-btn" onclick="ordMore()">${rvIc("dots")}Status</button></div>` : ""}`;
  if (hadFocus) { const q = document.getElementById("ordQ"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  const q = document.getElementById("ordQ"); let tm;
  if (q) q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { ORD.q = q.value; ordersPage = 0; ordLoad(null, true); }, 350); };
  const pr = document.getElementById("ordProd"); if (pr) pr.onchange = () => { ORD.product = pr.value; ordersPage = 0; ordLoad(null, true); };
  const by = document.getElementById("ordBuyer"); if (by) by.onchange = () => { ORD.buyer = by.value; ordersPage = 0; ordLoad(null, true); };
  const dy = document.getElementById("ordDays"); if (dy) dy.onchange = () => { ORD.days = dy.value; ordersPage = 0; ordLoad(null, true); };
}

// ---- actions ----
function ordBack() { ORD.mDetail = false; ordDraw(); window.scrollTo(0, 0); }
function ordMore() { document.querySelector("#ordDt .rv-menu")?.setAttribute("open", ""); ORD.mDetail = true; ordDraw(); document.querySelector("#ordDt .rv-menu")?.setAttribute("open", ""); }
async function ordSetStatus(id, ns) {
  const o = ORD.rows.find((x) => x.id === id); if (!o) return;
  try {
    const body = { order_status: ns };
    if (ns === "delivered") body.delivered_at = new Date().toISOString();
    if (ns !== "valid" && o.delivery_stage === "on_the_way" && ns !== "delivered") body.delivery_stage = null;
    const { error } = await supabaseClient.from("orders").update(body).eq("id", id);
    if (error) throw error;
    bvToast("Order marked " + ordState({ ...o, ...body }).l.toLowerCase());
    await ordLoad(null, true);
  } catch (err) { bvToast("Update failed: " + err.message, "err"); }
}
async function ordClick(e) {
  const t = e.target;
  const tab = t.closest("[data-tab]"); if (tab && tab.closest("#ordRoot")) { ORD.tab = tab.dataset.tab; ordersPage = 0; ORD.mDetail = false; ordLoad(null, true); return; }
  const pg = t.closest("[data-pg]"); if (pg) { ordersPage = Math.max(0, ordersPage + Number(pg.dataset.pg)); ORD.mDetail = false; ordLoad(null, false); window.scrollTo(0, 0); return; }
  const st = t.closest(".ox-dt .rv-pop [data-st]"); if (st && !st.disabled) { ordSetStatus(ORD.sel, st.dataset.st); return; }
  const h = t.closest("[data-hist]"); if (h) { bvShowOrderHistoryModal(h.dataset.hist); return; }
  const rs = t.closest("[data-resolve]");
  if (rs && rs.dataset.resolve) {
    const { error } = await supabaseClient.from("voice_calls").update({ human_resolved_at: new Date().toISOString() }).eq("id", rs.dataset.resolve);
    if (error) { bvToast("Update failed: " + error.message, "err"); return; }
    loadCallFlagCount(); ordLoad(null, true); return;
  }
  const call = t.closest(".callNowBtn");
  if (call) {
    call.disabled = true; call.textContent = "Calling…";
    try { const r = await sbFn("place-order-call", { order_id: call.dataset.oid, force: true }); if (r.error) throw new Error(r.error); bvToast("Calling the customer…"); }
    catch (err) { bvToast("Could not place call: " + err.message, "err"); }
    ordLoad(null, false); return;
  }
  if (t.closest("a,button,select,input,summary,label,details")) return;
  const row = t.closest("[data-oid]");
  if (row && row.closest("#ordRoot")) { ORD.sel = row.dataset.oid; ORD.mDetail = true; ordDraw(); window.scrollTo(0, 0); }
}
