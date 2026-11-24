// ── Chats list + Conversation, redesigned (grey page, white cards, blue replies) plus the customer card and "For this customer" suggestions.
// The data, the sending and the realtime behaviour are the existing ones (35 / 36 / 37 / 38 / 44); this file restyles them and adds what the customer has with you.
(function () {
  if (window.__crInstalled) return; window.__crInstalled = true;
  const css = `
  /* ---- page + list ---- */
  [data-theme="light"] body:has(#convTabRoot){background:#f1f3f8}
  #convTabRoot #convListPanel{background:transparent!important;border:0!important;box-shadow:none!important}
  #convTabRoot > .ix-head{justify-content:flex-end;padding:2px 0 12px}
  #convTabRoot > .ix-head .ix-t{display:none}
  #convTabRoot > .ix-head .ix-ib{width:44px;height:44px;border-radius:50%;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.08),0 4px 14px rgba(15,30,70,.06);margin-left:10px}
  #convTabRoot > .ix-tabs{background:rgba(120,130,150,.16);border:0;border-radius:14px;padding:3px;gap:0;margin:0}
  #convTabRoot .ix-tab{flex:1;justify-content:center;height:42px;border:0;margin:0;border-radius:11px;font-size:13px;color:var(--muted)}
  #convTabRoot .ix-tab.on{background:var(--panel);color:var(--text);font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.12)}
  #convTabRoot .ix-tab em{border:0;background:var(--panel2)}
  #convTabRoot .ix-tab.on em{background:#1f6fff;color:#fff}
  #convTabRoot .ix-sec{background:none;border:0;padding:18px 4px 10px;font-size:16px;font-weight:700;letter-spacing:0;text-transform:none;color:var(--text)}
  #convTabRoot .ix-sec span{font-size:12px;font-weight:500;color:var(--muted)}
  #convTabRoot .ix-r{margin:0 0 10px;padding:14px;border:0;border-radius:22px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06)}
  #convTabRoot .ix-ini{border:0;background:var(--panel2);color:var(--text);font-weight:750}
  #convTabRoot .ix-ch{border-color:var(--panel)}
  #convTabRoot .ix-l1 b{font-size:15px;font-weight:700}
  #convTabRoot .ix-r .ix-l1 time.wt{height:22px;padding:0 9px;border-radius:11px;background:#fff2d9;color:#8a5600;font-size:11px;font-weight:750;display:inline-flex;align-items:center}
  [data-theme="dark"] #convTabRoot .ix-r .ix-l1 time.wt{background:#3a2d12;color:#f0b04a}
  #convTabRoot .ix-tg{border:0;border-radius:11px;background:var(--panel2);color:var(--text);font-weight:650;padding:3px 10px}
  #convTabRoot .ix-tg:not(:first-child){background:rgba(31,111,255,.12);color:#1f6fff}
  /* ---- the list fills the screen and scrolls with the page, like WhatsApp (it used to be a short box with its own scrollbar) ---- */
  @media (max-width:820px){
    #convTabRoot:not(.thread-open) .conv-list-items,#convTabRoot .conv-list-items{height:auto!important;max-height:none!important;overflow:visible!important}
    #convTabRoot:not(.thread-open) #convListPanel{overflow:visible!important}
  }
  /* ---- conversation ---- */
  #convTabRoot #convThread{background:var(--bg)}
  #convTabRoot .conv-thread-head.ch2{background:var(--panel);box-shadow:0 1px 0 var(--border);padding:8px 10px;min-height:64px}
  #convTabRoot .ch2-ini{border:0;background:var(--panel2);color:var(--text);font-weight:750;width:42px;height:42px}
  #convTabRoot .ch2-av{width:42px;height:42px}
  #convTabRoot .ch2-nm b{font-size:16px;font-weight:750}
  #convHandoffBadge button{height:36px;padding:0 12px!important;border:0!important;border-radius:18px!important;background:rgba(31,111,255,.12)!important;color:#1f6fff!important;font-weight:700;font-size:12px!important}
  .cu-card{margin:10px 12px 0;padding:12px 14px;border-radius:18px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06);flex:none}
  .cu-r{display:flex;align-items:center;gap:10px}
  .cu-t{flex:1;min-width:0}.cu-t b{display:block;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cu-t span{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cu-tag{flex:none;height:24px;padding:0 10px;border-radius:12px;font-size:11px;font-weight:750;display:inline-flex;align-items:center;background:rgba(217,130,0,.16);color:#8a5600;text-transform:capitalize}
  .cu-tag.ok{background:rgba(24,163,90,.16);color:#0f7a40}.cu-tag.bad{background:rgba(229,72,77,.14);color:#b3262c}
  [data-theme="dark"] .cu-tag{color:#f0b04a}[data-theme="dark"] .cu-tag.ok{color:#5ad08e}[data-theme="dark"] .cu-tag.bad{color:#ff8a8e}
  .cu-st{display:flex;gap:6px;margin-top:12px}.cu-st div{flex:1}.cu-st i{display:block;height:6px;border-radius:3px;background:var(--border)}.cu-st div.on i{background:#1f6fff}
  .cu-st span{display:block;font-size:11px;font-weight:650;color:var(--muted);margin-top:5px}.cu-st div.on span{color:var(--text)}
  .cu-open{border:0;background:none;color:#1f6fff;font:inherit;font-weight:700;font-size:12px;min-height:30px;padding:0;cursor:pointer}
  #convTabRoot .conv-msgs{background:var(--bg);padding:12px 14px 6px;gap:10px}
  #convTabRoot .bubble{max-width:82%;border:0;box-shadow:none;font-size:15px;line-height:1.45}
  #convTabRoot .bubble.in{border:0;background:var(--panel);color:var(--text);border-radius:6px 20px 20px 20px;box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06)}
  #convTabRoot .bubble.out{border:0;background:#1f6fff;color:#fff;border-radius:20px 6px 20px 20px}
  #convTabRoot .bubble.out .bubble-time{opacity:.8;color:inherit}
  #convTabRoot .ch2-win{margin:0 12px 8px;border:0;border-radius:16px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06);padding:10px 14px}
  #convTabRoot .ch2-win.warn{background:rgba(229,72,77,.12);color:var(--text)}
  #convTabRoot .ch2-win button{border:0;background:#1f6fff;color:#fff;height:38px;padding:0 14px;border-radius:12px;font-size:12px}
  #convTabRoot .ch2-qr{background:transparent;padding:0 12px 8px}
  #convTabRoot .ch2-qr button{border:0;height:34px;border-radius:17px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 4px 12px rgba(15,30,70,.05);font-weight:650}
  #convTabRoot .conv-compose{background:transparent;border:0;padding:0 12px calc(14px + env(safe-area-inset-bottom));gap:8px;align-items:center}
  #convTabRoot .conv-compose .compose-attach-wrap .compose-icon-btn{width:46px;height:46px;border-radius:50%;background:#1f6fff;color:#fff;border:0}
  #convTabRoot .conv-compose .compose-attach-wrap .compose-icon-btn svg{stroke:#fff}
  #convTabRoot .conv-compose #convReplyInput{min-height:46px;border:0;border-radius:23px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 4px 12px rgba(15,30,70,.05);padding:12px 16px}
  #convTabRoot .conv-compose .compose-mic-btn{width:46px;height:46px;border-radius:50%;border:0;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 4px 12px rgba(15,30,70,.05)}
  /* ---- the + sheet: "For this customer" ---- */
  .fc-box{margin-top:14px;padding:14px;border-radius:20px;background:rgba(31,111,255,.1)}
  .fc-box>small{display:block;font-size:12px;font-weight:750;letter-spacing:.04em;color:#1f6fff}
  .fc-box>p{margin:4px 0 0;font-size:13px;color:var(--muted)}
  .fc-go{display:flex;align-items:center;justify-content:center;width:100%;min-height:50px;margin-top:10px;border:0;border-radius:14px;background:#1f6fff;color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer}
  .fc-or{font-size:12px;color:var(--muted);margin:12px 2px 6px}
  .fc-sel{width:100%;height:50px;border:0;border-radius:14px;background:var(--panel);color:var(--text);font:inherit;font-size:15px;font-weight:650;padding:0 14px;appearance:auto}
  .fc-ch{display:flex;gap:8px;flex-wrap:wrap}.fc-ch button{height:36px;padding:0 14px;border:0;border-radius:18px;background:var(--panel);color:var(--text);font:inherit;font-size:13px;font-weight:650;cursor:pointer}
  .fc-ch button.on{background:#1f6fff;color:#fff}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const esc = (s) => (typeof bvEscape === "function" ? bvEscape(s) : String(s == null ? "" : s));
  const last9 = (d) => String(d || "").replace(/\D/g, "").slice(-9);
  const lagos = (iso) => { try { return new Date(iso).toLocaleString("en-NG", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" }); } catch (e) { return ""; } };
  const tourWhen = (t) => { try { return new Date(t.tour_date + "T12:00:00Z").toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) + " " + String(t.tour_time || "").slice(0, 5); } catch (e) { return ""; } };

  // ---------- what this customer has with you ----------
  const CTX = (window.rvChatCtx = { conv: null, d: null, ctx: null, prod: null });
  async function loadCtx(digits) {
    const l = last9(digits); if (l.length < 9) return { orders: [], bookings: [], tours: [], apps: [] };
    const q = (t, sel, col, order) => sbQuery(t, `select=${sel}&${col}=ilike.*${l}*&order=${order}.desc&limit=1`, { allAccounts: true }).catch(() => []);
    const [orders, bookings, tours, apps] = await Promise.all([
      q("orders", "id,order_status,payment_status,delivery_stage,order_value_naira,product_name,product_id,customer_city", "customer_phone", "ordered_at"),
      q("bookings", "id,service_name,starts_at,status,product_id", "customer_phone", "starts_at"),
      q("tours", "id,tour_date,tour_time,status,product_id,property_id,ref", "visitor_phone", "created_at"),
      q("applications", "id,review_status,fee_status,product_id,property_id,ref,properties(title,slug)", "applicant_phone", "created_at"),
    ]);
    return { orders: orders || [], bookings: bookings || [], tours: tours || [], apps: apps || [] };
  }
  function journey(c) {
    const a = c.apps[0], t = c.tours[0], b = c.bookings[0], o = c.orders[0];
    const steps = (labels, on) => labels.map((l, i) => ({ l, on: !!on[i] }));
    if (a) { const paid = String(a.fee_status || "") === "paid"; return { kind: "apply", pid: a.product_id, title: `Applied · ${(a.properties && a.properties.title) || "rental application"}`, tag: paid ? ["Fee paid", "ok"] : [String(a.review_status || "received").replace(/_/g, " "), ""], steps: steps(["Asked", "Tour", "Applied", "Paid"], [1, !!t, 1, paid]) }; }
    if (t) { const ok = ["confirmed", "completed"].includes(String(t.status)); return { kind: "tour", pid: t.product_id, prop: t.property_id, title: `Tour ${ok ? "booked" : "requested"} · ${tourWhen(t)}`, tag: [String(t.status || "requested").replace(/_/g, " "), ok ? "ok" : ""], steps: steps(["Asked", "Tour", "Applied", "Paid"], [1, 1, 0, 0]) }; }
    if (b) { const done = String(b.status) === "completed"; return { kind: "booking", pid: b.product_id, title: `Booking · ${b.service_name || "appointment"} · ${lagos(b.starts_at)}`, tag: [String(b.status || "").replace(/_/g, " "), ["confirmed", "completed"].includes(String(b.status)) ? "ok" : (["cancelled", "no_show"].includes(String(b.status)) ? "bad" : "")], steps: steps(["Asked", "Booked", "Done"], [1, 1, done]) }; }
    if (o) { const s = typeof ordState === "function" ? ordState(o) : { l: o.order_status || "Order" }; const conf = ["valid", "delivered"].includes(String(o.order_status)), del = String(o.order_status) === "delivered";
      return { kind: "order", pid: o.product_id, title: `Order · ${[o.product_name, o.order_value_naira ? "₦" + Number(o.order_value_naira).toLocaleString("en-NG") : ""].filter(Boolean).join(" · ")}`, tag: [s.l, del ? "ok" : (["cancelled", "failed", "returned"].includes(String(o.order_status)) ? "bad" : "")], steps: steps(["Asked", "Ordered", "Confirmed", "Delivered"], [1, 1, conf, del]), orderId: o.id }; }
    return { kind: "none", title: "No order or booking yet", tag: null, steps: steps(["Asked"], [1]) };
  }
  function card(j, conv) {
    const ad = conv && conv.source === "ad";
    const prod = CTX.prod && j.pid && CTX.prod.id === j.pid ? CTX.prod.product_name : "";
    const sub = [prod, ad ? "came from your ad" : ""].filter(Boolean).join(" · ") || (j.kind === "none" ? "Nothing recorded for this phone number" : "");
    return `<div class="cu-card"><div class="cu-r"><div class="cu-t"><b>${esc(j.title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>${j.tag ? `<span class="cu-tag ${j.tag[1]}">${esc(j.tag[0])}</span>` : ""}${j.orderId ? `<button type="button" class="cu-open" onclick="bvChatOpenOrder('${j.orderId}')">Open</button>` : ""}</div>
      <div class="cu-st">${j.steps.map((s) => `<div class="${s.on ? "on" : ""}"><i></i><span>${esc(s.l)}</span></div>`).join("")}</div></div>`;
  }
  async function decorate(id) {
    const th = document.getElementById("convThread"); if (!th || typeof bvSelectedConvId === "undefined" || bvSelectedConvId !== id) return;
    const conv = bvConversations.find((c) => c.id === id), head = th.querySelector(".conv-thread-head"); if (!conv || !head) return;
    const digits = String(conv.phone || "").replace(/\D/g, "");
    const ctx = await loadCtx(digits); if (bvSelectedConvId !== id || !document.getElementById("convThread")) return;
    const j = journey(ctx); CTX.conv = conv; CTX.d = digits; CTX.ctx = ctx; CTX.j = j;
    th.querySelectorAll(".ch2-ctx,.cu-card").forEach((x) => x.remove());
    head.insertAdjacentHTML("afterend", card(j, conv));
    try { const ps = typeof window.caProducts === "function" ? await window.caProducts() : []; CTX.prod = ps.find((p) => p.id === j.pid) || null; if (CTX.prod) { const c0 = th.querySelector(".cu-card .cu-t"); if (c0 && !c0.querySelector("span")) c0.insertAdjacentHTML("beforeend", `<span>${esc(CTX.prod.product_name)}${conv.source === "ad" ? " · came from your ad" : ""}</span>`); } } catch (e) {}
  }
  const prevSel = window.bvSelectConversation;
  if (typeof prevSel === "function") window.bvSelectConversation = async function (id) { const r = await prevSel.apply(this, arguments); try { await decorate(id); } catch (e) { console.warn("customer card", e); } return r; };

  // ---------- "For this customer" (used by the + sheet in 44) ----------
  const REMEMBER = "rv_chat_prod:";
  const remembered = (conv) => { try { return localStorage.getItem(REMEMBER + conv) || ""; } catch (e) { return ""; } };
  window.caRemember = (id) => { try { localStorage.setItem(REMEMBER + (CTX.conv && CTX.conv.id), id); } catch (e) {} if (window.caMenu) window.caMenu(); };
  async function siteBase(p) {
    try { const sites = await sbQuery("sites", `select=id,slug,status&product_id=eq.${p.id}&order=created_at.desc`, { allAccounts: true }).catch(() => []); const s = (sites || []).find((x) => x.status === "published") || (sites || [])[0]; if (!s) return null;
      const doms = await sbQuery("site_domains", "select=hostname,site_id,status").catch(() => []); const d = (doms || []).find((x) => x.site_id === s.id && x.status === "active");
      return d ? "https://" + d.hostname : window.RV_siteUrl(s.slug); } catch (e) { return null; }
  }
  window.rvChatSuggest = async function () {
    if (!CTX.conv || !CTX.j) return null;
    const ps = typeof window.caProducts === "function" ? await window.caProducts() : [], j = CTX.j;
    const byType = (t) => ps.filter((p) => (p.product_type || "physical") === t);
    let prod = ps.find((p) => p.id === j.pid) || ps.find((p) => p.id === remembered(CTX.conv.id)) || (ps.length === 1 ? ps[0] : null);
    const code = typeof window.caBuyerCode === "function" ? await window.caBuyerCode() : "";
    const links = {};
    const orderLink = (p) => (p.order_form_url && /^https:/i.test(p.order_form_url)) ? p.order_form_url : `${window.RV_APP_ORIGIN || location.origin}/order.html?product=${p.id}${code ? "&buyer=" + encodeURIComponent(code) : ""}`;
    const prop = (CTX.ctx.apps[0] && CTX.ctx.apps[0].properties) || null;
    const slugQ = prop && prop.slug ? `?property=${encodeURIComponent(prop.slug)}` : "";
    const mk = async (type, p) => {
      if (!p) return null;
      if (type === "order") return { label: "Order link", btn: "Order now", text: `Order ${p.product_name} here 👇`, url: typeof window.rvProductLink === "function" ? await window.rvProductLink(p) : orderLink(p) };
      const base = await siteBase(p) || (p.landing_page_url && /^https:/i.test(p.landing_page_url) ? p.landing_page_url : null); if (!base) return null;
      if (type === "tour") return { label: "Tour link", btn: "Book a tour", text: "You can book a tour here 👇", url: base.replace(/\/$/, "") + "/home" + slugQ };
      if (type === "apply") return { label: "Application link", btn: "Apply now", text: "You can apply here 👇", url: base.replace(/\/$/, "") + "/home" + (slugQ ? slugQ + "&" : "?") + "apply=1#application" };
      if (type === "booking") return { label: "Booking link", btn: "Book now", text: "You can book here 👇", url: base };
      return null;
    };
    const housing = prod && (prod.product_type === "housing") ? prod : byType("housing")[0], booking = prod && prod.product_type === "booking" ? prod : byType("booking")[0], physical = prod && (prod.product_type || "physical") === "physical" ? prod : byType("physical")[0];
    const opts = (await Promise.all([mk("tour", housing), mk("apply", housing), mk("order", physical), mk("booking", booking)])).filter(Boolean);
    let primary = null, note = "";
    const pick = (lbl) => opts.find((o) => o.label === lbl) || null;
    if (j.kind === "apply") note = "Application received. Nothing to send for this step.";
    else if (j.kind === "tour") { primary = pick("Application link"); note = `${j.title.replace("Tour ", "Tour ")}, so the next step is the application.`; }
    else if (j.kind === "booking") note = "Already booked. Nothing to send for this step.";
    else if (j.kind === "order") note = "They have an order. Send a link only if they want to order again.";
    else if (prod) { const t = prod.product_type || "physical"; primary = t === "housing" ? pick("Tour link") : t === "booking" ? pick("Booking link") : pick("Order link"); note = "No order, booking or tour yet."; }
    else note = "Which product are they asking about?";
    return { note, primary, opts, askProduct: !prod && j.kind === "none" && ps.length > 1 ? ps : null, name: (CTX.conv && (typeof bvName === "function" ? bvName(CTX.conv) : "")) || "this customer" };
  };
})();
