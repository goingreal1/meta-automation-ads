// Revora dashboard, part 13 of 23: TAB: ORDERS · TAB: AI CALL LOGS · TAB: SUPPORT QUEUE

// ── TAB: ORDERS ───────────────────────────────────────────────────────────────

// Which statuses a role may set on an order. "Delivered" is proof of payment or handover: it comes from a matched
// Paystack payment (the webhook) or from the delivery agent, never from a media buyer (the database enforces this too).
function bvOrderStatusSelect(o) {
  const role = window.myProfile?.role;
  const all = [["pending", "Pending"], ["valid", "Valid"], ["delivered", "Delivered"], ["returned", "Returned"], ["cancelled", "Cancelled"]];
  const allowed = role === "owner" || role === "admin" || role === "delivery_agent" ? all.map(x => x[0])
    : role === "customer_care" ? ["pending", "valid", "returned", "cancelled"]
    : ["pending", "valid", "cancelled"];
  const cur = o.order_status || "pending";
  const locked = cur === "delivered" ? !(role === "owner" || role === "admin") : false;
  const opts = all.filter(x => allowed.includes(x[0]) || x[0] === cur);
  return `<select data-oid="${o.id}" class="oSel" style="padding:3px 7px;font-size:11px;width:auto;" ${locked ? "disabled title=\"Delivered orders can only be changed by an admin\"" : ""}>
    ${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""} ${allowed.includes(v) ? "" : "disabled"}>${l}</option>`).join("")}
  </select>`;
}

async function renderOrders(el) {
  // Stats and pagination need exact full-table counts separate from the one
  // page of rows actually rendered -- sbCount reads Content-Range instead of
  // fetching every row, so paging doesn't skew "Total orders"/"Delivery rate"
  // and large tables don't get silently under-counted by PostgREST's row cap.
  const [tot, deliv, ret, pend, orders, flagged, siteRows] = await Promise.all([
    sbCount("orders"),
    sbCount("orders", "order_status=eq.delivered"),
    sbCount("orders", "order_status=eq.returned"),
    sbCount("orders", "order_status=eq.pending"),
    sbQuery("orders", `select=*,media_buyers(code,name),voice_calls(status,summary,needs_human,human_resolved_at,created_at),payments(status,amount_naira,paid_at)&order=ordered_at.desc&limit=${ORDERS_PAGE_SIZE}&offset=${ordersPage * ORDERS_PAGE_SIZE}`),
    sbQuery("voice_calls", "select=*,orders(customer_name,customer_phone,product_name)&needs_human=is.true&human_resolved_at=is.null&order=created_at.desc&limit=50").catch(() => []),
    sbQuery("sites", "select=id,name", { allAccounts: true }).catch(() => []),
  ]);
  window.bvOrdersCache = orders || [];
  const siteNameById = Object.fromEntries((siteRows || []).map(x => [x.id, x.name]));
  (orders || []).forEach(o => {
    // voice_calls comes back as an array (reverse FK) -- there's at most one
    // call per order in practice, but take the most recent if that ever changes.
    o.voice_call = (o.voice_calls || []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] || null;
    // payments.order_id is unique, so at most one row -- whether it's already
    // confirmed is exactly what a delivery agent needs before deciding to
    // collect cash on delivery, and what customer care needs to answer "did
    // my payment go through" without guessing from order_status alone.
    o.payment = (o.payments || [])[0] || null;
  });

  // Same definition as the Home screen: delivered out of the orders that have finished (delivered + returned).
  const rate  = (deliv + ret) ? (deliv / (deliv + ret) * 100).toFixed(1) : "0";
  const rC    = parseFloat(rate) >= 70 ? "a" : parseFloat(rate) >= 50 ? "w" : "d";
  const pageCount = Math.max(1, Math.ceil(tot / ORDERS_PAGE_SIZE));
  const pageStart = tot ? ordersPage * ORDERS_PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(tot, (ordersPage + 1) * ORDERS_PAGE_SIZE);

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Orders</div><div class="sh-actions"><button class="btn btn-g" id="ordersExportBtn" onclick="bvExportOrdersCsv(this)">⬇ Download CSV</button><button class="btn btn-g" onclick="render()">↺ Refresh</button></div></div>

    <div class="g4">
      <div class="kc"><div class="kc-lbl">Total orders</div><div class="kc-val">${tot}</div><div class="kc-sub">all time</div></div>
      <div class="kc"><div class="kc-lbl">Delivered</div><div class="kc-val a">${deliv}</div><div class="kc-sub">all time</div></div>
      <div class="kc"><div class="kc-lbl">Returned</div><div class="kc-val d">${ret}</div><div class="kc-sub">all time</div></div>
      <div class="kc"><div class="kc-lbl">Delivery rate</div><div class="kc-val ${rC}">${rate}%</div><div class="kc-sub">of delivered + returned · ${pend} still pending</div></div>
    </div>

    ${flagged?.length ? `
    <div class="panel">
      <div class="ph"><div class="ph-title">⚠️ AI calls needing a human</div><div class="ph-count">${flagged.length} open</div></div>
      <div class="tbl-wrap"><table>
        <tr><th>Customer</th><th>Phone</th><th>Product</th><th>Why</th><th>AI summary</th><th>When</th><th></th></tr>
        ${flagged.map(c => `<tr>
          <td class="s n">${escH(c.orders?.customer_name ?? "—")}</td>
          <td class="n"><a href="tel:${escH(c.to_number)}" style="color:var(--accent);text-decoration:none;">${escH(c.to_number)}</a></td>
          <td class="n">${escH(c.orders?.product_name ?? "—")}</td>
          <td>${(c.red_flags || []).map(f => `<span class="pill returned">${escH(f.replace(/_/g, " "))}</span>`).join(" ")}</td>
          <td class="n" style="max-width:260px;color:var(--muted);">${escH(c.summary ?? "")}</td>
          <td>${ago(c.created_at)}</td>
          <td><button class="btn btn-g callResolve" data-cid="${escH(c.id)}">Mark handled</button></td>
        </tr>`).join("")}
      </table></div>
    </div>` : ""}

    <div class="panel">
      <div class="ph"><div class="ph-title">All orders</div><div class="ph-count">${pend} pending</div></div>
      ${!tot ? `<div class="empty"><div class="empty-ico">📦</div>No orders yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Customer</th><th>Phone</th><th>Product</th><th>Value</th><th>Buyer</th><th>AI call</th><th>Payment</th><th>Status</th><th>Ordered</th><th>Update</th></tr>
        ${orders.map(o => `<tr class="bv-clickable-row" data-order-row="${o.id}">
          <td class="s n">${o.customer_id
            ? `<a href="javascript:void(0)" onclick="bvShowCustomerModal('${o.customer_id}')" style="color:var(--accent);text-decoration:none;">${escH(o.customer_name ?? "—")}</a>`
            : escH(o.customer_name ?? "—")}${o.form_data && typeof o.form_data === "object" ? `<div style="font-size:10.5px;color:var(--muted);font-weight:400;max-width:220px;">${Object.entries(o.form_data).map(([k, v]) => `${escH(k)}: ${escH(v)}`).join(" · ")}</div>` : ""}</td>
          <td class="n">${o.customer_phone
            ? `<a href="https://wa.me/${o.customer_phone.replace(/\D/g,"")}" target="_blank" style="color:var(--accent);text-decoration:none;display:flex;align-items:center;gap:4px;">${icon("phone",12)} ${o.customer_phone}</a>`
            : "—"}</td>
          <td class="n">${o.product_name ?? "—"}${o.site_id ? `<div style="font-size:10.5px;color:var(--muted);">🌐 ${escH(siteNameById[o.site_id] || "Website")}</div>` : ""}</td>
          <td>${fN(o.order_value_naira)}</td>
          <td class="n">${o.media_buyers ? `${escH(o.media_buyers.code)}` : `<span style="color:var(--muted);">—</span>`}</td>
          <td>${bvOrderCallCell(o)}</td>
          <td>${bvPaymentCell(o)}</td>
          <td><span class="pill ${o.order_status ?? "pending"}">${o.order_status ?? "pending"}</span>${o.possible_duplicate ? ` <span class="pill returned" title="Same customer, same address, within the last hour">⚠️ Possible dup</span>` : ""} <a href="javascript:void(0)" onclick="bvShowOrderHistoryModal('${o.id}')" title="Change history" style="color:var(--muted);text-decoration:none;">🕘</a></td>
          <td>${ago(o.ordered_at)}</td>
          <td>
            ${bvOrderStatusSelect(o)}
          </td>
        </tr>`).join("")}
      </table></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-size:11.5px;color:var(--muted);">
        <div>${tot ? `Showing ${pageStart}–${pageEnd} of ${tot}` : ""}</div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn btn-g" id="ordersPrevBtn" ${ordersPage === 0 ? "disabled" : ""}>← Prev</button>
          <div style="padding:6px 4px;">Page ${ordersPage + 1} of ${pageCount}</div>
          <button type="button" class="btn btn-g" id="ordersNextBtn" ${ordersPage >= pageCount - 1 ? "disabled" : ""}>Next →</button>
        </div>
      </div>`}
    </div>`;

  document.getElementById("ordersPrevBtn")?.addEventListener("click", () => {
    if (ordersPage > 0) { ordersPage--; renderOrders(el); }
  });
  document.getElementById("ordersNextBtn")?.addEventListener("click", () => {
    if (ordersPage < pageCount - 1) { ordersPage++; renderOrders(el); }
  });

  document.querySelectorAll(".oSel").forEach(sel => {
    sel.addEventListener("change", async e => {
      const id = e.target.dataset.oid;
      const ns = e.target.value;
      try {
        const body = { order_status: ns };
        if (ns === "delivered") body.delivered_at = new Date().toISOString();
        const { error } = await supabaseClient.from('orders').update(body).eq('id', id);
        if (error) throw error;
      } catch(err) { alert("Update failed: " + err.message); renderOrders(el); }
    });
  });

  document.querySelectorAll(".callNowBtn").forEach(btn => btn.addEventListener("click", async e => {
    const oid = e.target.dataset.oid;
    e.target.disabled = true;
    e.target.textContent = "Calling…";
    try {
      const r = await sbFn("place-order-call", { order_id: oid, force: true });
      if (r.error) throw new Error(r.error);
    } catch (err) {
      alert("Could not place call: " + err.message);
    } finally {
      renderOrders(el);
    }
  }));

  document.querySelectorAll(".callResolve").forEach(btn => btn.addEventListener("click", async e => {
    const { error } = await supabaseClient.from("voice_calls")
      .update({ human_resolved_at: new Date().toISOString() }).eq("id", e.target.dataset.cid);
    if (error) { alert("Update failed: " + error.message); return; }
    loadCallFlagCount();
    renderOrders(el);
  }));
}

// Small status cell for the AI confirmation call tied to an order -- lets a
// human see at a glance whether the call happened, went fine, or needs
// attention (medical question, cancel request, "let me talk to someone"),
// without leaving the Orders tab to check Media Buyers -> AI calls.
function bvOrderCallCell(o) {
  const c = o.voice_call;
  if (!c) {
    return `<button type="button" class="callNowBtn btn btn-g" data-oid="${o.id}" style="padding:3px 8px;font-size:10px;">📞 Call now</button>`;
  }
  if (c.needs_human && !c.human_resolved_at) {
    return `<span class="pill returned" title="${escH(c.summary || "")}">⚠️ Needs human</span>`;
  }
  const labels = { queued: "Queued", dialing: "Dialing…", initiated: "In call…", done: "✅ Confirmed", failed: "❌ Failed" };
  const cls = { done: "delivered", failed: "returned", queued: "pending", dialing: "pending", initiated: "active" }[c.status] || "pending";
  return `<span class="pill ${cls}" title="${escH(c.summary || "")}">${labels[c.status] || c.status}</span>${c.status === "failed" ? ` <button type="button" class="callNowBtn btn btn-g" data-oid="${o.id}" style="padding:2px 6px;font-size:9px;">retry</button>` : ""}`;
}

// Whether a customer already paid for this order online (via their buyer's
// DVA), or it's still cash-on-delivery -- the single most important thing a
// delivery agent needs to know before knocking on a door, and what customer
// care needs to answer "did my payment go through" without digging into the
// Wallet tab (which they don't have access to in the first place).
function bvPaymentCell(o) {
  const p = o.payment;
  if (!p) return `<span class="pill untested">💵 Collect on delivery</span>`;
  if (p.status === "confirmed") return `<span class="pill delivered" title="Paid ${ago(p.paid_at)}">✅ Paid online</span>`;
  if (p.status === "unmatched") return `<span class="pill returned" title="A deposit arrived but couldn't be matched to this order -- check with admin before collecting cash too.">⚠️ Unmatched deposit</span>`;
  return `<span class="pill pending">⏳ Payment pending</span>`;
}

// Plain-text equivalent of bvPaymentCell, for CSV export (no HTML/emoji pills).
function bvPaymentText(o) {
  const p = o.payment;
  if (!p) return "Collect on delivery";
  if (p.status === "confirmed") return "Paid online";
  if (p.status === "unmatched") return "Unmatched deposit";
  return "Payment pending";
}

function bvCsvEscape(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function bvDownloadCsv(filename, headers, rows) {
  const lines = [headers.map(bvCsvEscape).join(",")];
  for (const row of rows) lines.push(row.map(bvCsvEscape).join(","));
  // BOM so Excel (still the actual destination for "download a CSV" in
  // practice) opens UTF-8 correctly instead of mangling the naira sign.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Exports every order (not just the current page of ORDERS_PAGE_SIZE), so
// "how many orders did we do last month" doesn't need the SQL editor.
async function bvExportOrdersCsv(btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    const orders = await sbQuery("orders",
      "select=customer_name,customer_phone,product_name,order_value_naira,order_status,possible_duplicate,ordered_at,delivered_at,media_buyers(code),payments(status,paid_at)&order=ordered_at.desc&limit=20000");
    for (const o of orders || []) o.payment = (o.payments || [])[0] || null;
    const headers = ["Customer", "Phone", "Product", "Value (NGN)", "Buyer", "Payment", "Status", "Possible duplicate", "Ordered at", "Delivered at"];
    const rows = (orders || []).map(o => [
      o.customer_name ?? "",
      o.customer_phone ?? "",
      o.product_name ?? "",
      o.order_value_naira ?? "",
      o.media_buyers?.code ?? "",
      bvPaymentText(o),
      o.order_status ?? "",
      o.possible_duplicate ? "Yes" : "",
      o.ordered_at ?? "",
      o.delivered_at ?? "",
    ]);
    bvDownloadCsv(`orders-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  } catch (err) {
    bvToast(`Export failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// Same per-buyer rows the "Spend & ROAS by media buyer" table already
// rendered from -- no extra fetch, that table isn't paginated.
function bvExportRoasCsv() {
  const data = window._bvLastRoasExport;
  if (!data?.buyerList) { bvToast("Nothing to export yet."); return; }
  const headers = ["Buyer", "Code", "Spend (NGN)", "Conversations", "Cost per conversation (NGN)", "Orders", "Cost per order (NGN)", "Revenue (NGN)", "ROAS", "Delivered ROAS", "Real ROAS (confirmed payments)"];
  const rows = data.buyerList.sort((a, b) => b.spend - a.spend).map(r => [
    r.buyer?.name ?? "Unattributed",
    r.buyer?.code ?? "",
    r.spend,
    r.conversations ?? 0,
    r.conversations ? (r.spend / r.conversations).toFixed(0) : "",
    r.orders,
    r.orders ? (r.spend / r.orders).toFixed(0) : "",
    r.revenue,
    r.spend ? (r.revenue / r.spend).toFixed(2) : "",
    r.spend ? (r.delivered / r.spend).toFixed(2) : "",
    r.spend ? (r.confirmed / r.spend).toFixed(2) : "",
  ]);
  bvDownloadCsv(`roas-${data.fromDate}-to-${data.toDate}.csv`, headers, rows);
}

// ── TAB: AI CALL LOGS ─────────────────────────────────────────────────────────
let callLogsPage = 0;
const CALL_LOGS_PAGE_SIZE = 30;
let callLogsExpanded = new Set();
let callLogsFilter = "all"; // all | completed | failed | needs_human

const CALL_LOG_FILTERS = [
  { key: "all",         label: "All" },
  { key: "completed",   label: "Completed",        q: "status=in.(completed,done)" },
  { key: "failed",      label: "No answer / failed", q: "status=in.(no_answer,failed)" },
  { key: "needs_human", label: "Needs human",       q: "needs_human=is.true&human_resolved_at=is.null" },
];

async function renderCallLogs(el) {
  const [tot, completed, noAnswer, openFlags] = await Promise.all([
    sbCount("voice_calls"),
    sbCount("voice_calls", "status=in.(completed,done)"),
    sbCount("voice_calls", "status=in.(no_answer,failed)"),
    sbCount("voice_calls", "needs_human=is.true&human_resolved_at=is.null"),
  ]);
  const activeFilterQ = CALL_LOG_FILTERS.find(f => f.key === callLogsFilter)?.q;
  const filterClause = activeFilterQ ? `&${activeFilterQ}` : "";
  const shownTot = { all: tot, completed, failed: noAnswer, needs_human: openFlags }[callLogsFilter] ?? tot;
  const calls = await sbQuery("voice_calls", `select=*,orders(customer_name,customer_phone,product_name,order_status)&order=created_at.desc&limit=${CALL_LOGS_PAGE_SIZE}&offset=${callLogsPage * CALL_LOGS_PAGE_SIZE}${filterClause}`);

  const pageCount = Math.max(1, Math.ceil(shownTot / CALL_LOGS_PAGE_SIZE));
  const pageStart = shownTot ? callLogsPage * CALL_LOGS_PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(shownTot, (callLogsPage + 1) * CALL_LOGS_PAGE_SIZE);

  el.innerHTML = `
    <div class="sh"><div class="sh-title">AI Call Logs</div><div class="sh-actions"><button class="btn btn-g" onclick="render()">↺ Refresh</button></div></div>

    <div class="g4">
      <div class="kc clFilterCard" data-filter="all" style="cursor:pointer;${callLogsFilter==="all"?"border-color:var(--accent);":""}"><div class="kc-lbl">Total calls</div><div class="kc-val">${tot}</div></div>
      <div class="kc clFilterCard" data-filter="completed" style="cursor:pointer;${callLogsFilter==="completed"?"border-color:var(--accent);":""}"><div class="kc-lbl">Completed</div><div class="kc-val a">${completed}</div></div>
      <div class="kc clFilterCard" data-filter="failed" style="cursor:pointer;${callLogsFilter==="failed"?"border-color:var(--accent);":""}"><div class="kc-lbl">No answer / failed</div><div class="kc-val d">${noAnswer}</div></div>
      <div class="kc clFilterCard" data-filter="needs_human" style="cursor:pointer;${callLogsFilter==="needs_human"?"border-color:var(--accent);":""}"><div class="kc-lbl">Needs human</div><div class="kc-val ${openFlags ? "w" : ""}">${openFlags}</div></div>
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Call history</div><div class="ph-count">${callLogsFilter !== "all" ? `Filtered: ${CALL_LOG_FILTERS.find(f=>f.key===callLogsFilter).label} — ` : ""}Click a row to read the conversation</div></div>
      ${!calls?.length ? `<div class="empty"><div class="empty-ico">📞</div>No calls${callLogsFilter !== "all" ? " in this filter" : ""}.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th></th><th>Customer</th><th>Phone</th><th>Product</th><th>Status</th><th>Duration</th><th>When</th></tr>
        ${calls.map(c => {
          const isOpen = callLogsExpanded.has(c.id);
          const cls = { completed: "delivered", done: "delivered", no_answer: "cancelled", failed: "returned" }[c.status] || "pending";
          return `<tr class="clRow" data-cid="${c.id}" style="cursor:pointer;">
            <td>${isOpen ? "▾" : "▸"}</td>
            <td class="s n">${escH(c.orders?.customer_name ?? "—")}</td>
            <td class="n">${escH(c.to_number ?? "—")}</td>
            <td class="n">${escH(c.orders?.product_name ?? "—")}</td>
            <td><span class="pill ${cls}">${escH((c.status ?? "—").replace(/_/g, " "))}</span>${c.needs_human && !c.human_resolved_at ? ` <span class="pill returned">⚠️ needs human</span>` : ""}</td>
            <td class="n">${c.duration_secs ? `${c.duration_secs}s` : "—"}</td>
            <td>${ago(c.created_at)}</td>
          </tr>${isOpen ? `<tr class="clTranscript"><td></td><td colspan="6" style="padding:10px 12px;color:var(--text2);white-space:pre-wrap;line-height:1.6;background:var(--panel2);border-radius:8px;">${escH(c.summary || "No conversation summary recorded.")}${(c.red_flags || []).length ? `<div style="margin-top:8px;">${c.red_flags.map(f => `<span class="pill returned" style="margin-right:4px;">${escH(f.replace(/_/g," "))}</span>`).join("")}</div>` : ""}</td></tr>` : ""}`;
        }).join("")}
      </table></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-size:11.5px;color:var(--muted);">
        <div>${shownTot ? `Showing ${pageStart}–${pageEnd} of ${shownTot}` : ""}</div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn btn-g" id="clPrevBtn" ${callLogsPage === 0 ? "disabled" : ""}>← Prev</button>
          <div style="padding:6px 4px;">Page ${callLogsPage + 1} of ${pageCount}</div>
          <button type="button" class="btn btn-g" id="clNextBtn" ${callLogsPage >= pageCount - 1 ? "disabled" : ""}>Next →</button>
        </div>
      </div>`}
    </div>`;

  document.getElementById("clPrevBtn")?.addEventListener("click", () => { if (callLogsPage > 0) { callLogsPage--; renderCallLogs(el); } });
  document.getElementById("clNextBtn")?.addEventListener("click", () => { if (callLogsPage < pageCount - 1) { callLogsPage++; renderCallLogs(el); } });
  document.querySelectorAll(".clFilterCard").forEach(card => {
    card.addEventListener("click", () => {
      callLogsFilter = card.dataset.filter;
      callLogsPage = 0;
      callLogsExpanded.clear();
      renderCallLogs(el);
    });
  });
  document.querySelectorAll(".clRow").forEach(row => {
    row.addEventListener("click", () => {
      const id = row.dataset.cid;
      if (callLogsExpanded.has(id)) callLogsExpanded.delete(id); else callLogsExpanded.add(id);
      renderCallLogs(el);
    });
  });
}

// ── TAB: SUPPORT QUEUE ───────────────────────────────────────────────────────
// Company-wide queue of AI calls flagged needs_human (medical question, wants
// to cancel, asked for a person) -- unlike the Orders tab's per-order pill,
// this is the one place meant to show every open escalation across every
// buyer at once, for whoever's actually doing customer service that day.
// RLS (orders_company_scoped / voice_calls_company_scoped) already does the
// real access control: owner/admin/customer_care see the whole company,
// a buyer only ever sees their own -- this view just surfaces it as a queue.
async function renderSupportQueue(el) {
  const role = window.myProfile?.role;
  const myId = sessionData?.user?.id ?? null;
  const isSupportRole = role === "owner" || role === "admin" || role === "customer_care";

  const isCustomerCare = role === "customer_care";

  const [calls, myDeals] = await Promise.all([
    sbQuery(
      "voice_calls",
      "select=*,orders(customer_name,customer_phone,customer_address,customer_city,customer_state,product_name,order_value_naira,order_status),assignee:profiles!voice_calls_assigned_to_fkey(display_name)&needs_human=is.true&human_resolved_at=is.null&order=created_at.desc&limit=100"
    ).catch(() => []),
    // AI places the calls, but once one's assigned to a person, what that
    // customer actually pays is the basis for their commission -- so the
    // thing worth tallying isn't "resolved" (closing the ticket), it's
    // "closed" (the order it was tied to actually got paid for).
    isCustomerCare
      ? sbQuery("voice_calls", `select=id,human_resolved_at,orders(order_value_naira,order_status,payments(status,amount_naira,paid_at))&assigned_to=eq.${myId}&order_id=not.is.null&order=created_at.desc&limit=300`).catch(() => [])
      : Promise.resolve(null),
  ]);

  let myResolvedCount = null, myClosedCount = 0, myClosedRevenue = 0, myAwaitingCount = 0;
  if (myDeals) {
    myResolvedCount = myDeals.filter(c => c.human_resolved_at).length;
    for (const c of myDeals) {
      const payment = c.orders?.payments?.[0];
      if (payment?.status === "confirmed") { myClosedCount++; myClosedRevenue += Number(payment.amount_naira || 0); }
      else if (c.orders && c.orders.order_status !== "cancelled" && c.orders.order_status !== "returned") myAwaitingCount++;
    }
  }

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Support Queue</div><div class="sh-actions"><button class="btn btn-g" onclick="render()">↺ Refresh</button></div></div>

    ${!isSupportRole ? `<div class="panel"><div style="font-size:12px;color:var(--text2);line-height:1.6;">
      You're only seeing escalations tied to your own orders here -- the full company-wide queue is for owners, admins, and customer care. Ask your admin for a customer-care invite if that's what you need.
    </div></div>` : ""}

    ${myDeals ? `
    <div class="g4" style="margin-bottom:18px;">
      <div class="kc"><div class="kc-lbl">You've resolved</div><div class="kc-val a">${myResolvedCount}</div><div class="kc-sub">all time</div></div>
      <div class="kc"><div class="kc-lbl">Deals closed</div><div class="kc-val a">${myClosedCount}</div><div class="kc-sub">customer actually paid</div></div>
      <div class="kc"><div class="kc-lbl">Revenue closed</div><div class="kc-val a">${fN(myClosedRevenue)}</div><div class="kc-sub">what commission is based on</div></div>
      <div class="kc"><div class="kc-lbl">Awaiting payment</div><div class="kc-val w">${myAwaitingCount}</div><div class="kc-sub">assigned, not paid yet</div></div>
    </div>` : ""}

    <div class="panel">
      <div class="ph"><div class="ph-title">Open escalations</div><div class="ph-count">${calls?.length ?? 0} waiting on a human</div></div>
      ${!calls?.length ? `<div class="empty"><div class="empty-ico">✅</div>Nothing waiting -- every AI-flagged call has been handled.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Customer</th><th>Phone</th><th>Product</th><th>Order status</th><th>Why flagged</th><th>Flagged</th><th>Assigned</th><th></th></tr>
        ${calls.map(c => {
          const o = c.orders;
          const mine = c.assigned_to === myId;
          return `<tr>
            <td class="s n">${escH(o?.customer_name ?? "—")}</td>
            <td class="n"><a href="tel:${escH(o?.customer_phone ?? "")}" style="color:inherit;">${escH(o?.customer_phone ?? "—")}</a></td>
            <td class="n">${escH(o?.product_name ?? "—")}</td>
            <td>${o?.order_status ? `<span class="pill ${o.order_status}">${escH(o.order_status)}</span>` : "—"}</td>
            <td style="max-width:280px;font-size:12px;color:var(--text2);">${escH(c.summary || "No summary recorded.")}</td>
            <td class="n">${ago(c.created_at)}</td>
            <td class="n">${c.assigned_to
              ? `<span class="pill ${mine ? "active" : "pending"}">${mine ? "You" : escH(c.assignee?.display_name || "Claimed")}</span>`
              : `<button type="button" class="btn btn-g supportClaim" data-cid="${c.id}" style="padding:3px 10px;font-size:10px;">Claim</button>`}</td>
            <td><button type="button" class="btn btn-a supportResolve" data-cid="${c.id}" style="padding:3px 10px;font-size:10px;white-space:nowrap;">Resolve</button></td>
          </tr>`;
        }).join("")}
      </table></div>`}
    </div>`;

  document.querySelectorAll(".supportClaim").forEach(btn => btn.addEventListener("click", async e => {
    const { error } = await supabaseClient.from("voice_calls")
      .update({ assigned_to: myId }).eq("id", e.target.dataset.cid).is("assigned_to", null);
    if (error) { alert("Could not claim: " + error.message); return; }
    renderSupportQueue(el);
  }));

  document.querySelectorAll(".supportResolve").forEach(btn => btn.addEventListener("click", async e => {
    const { error } = await supabaseClient.from("voice_calls")
      .update({ human_resolved_at: new Date().toISOString() }).eq("id", e.target.dataset.cid);
    if (error) { alert("Update failed: " + error.message); return; }
    loadCallFlagCount();
    renderSupportQueue(el);
  }));
}