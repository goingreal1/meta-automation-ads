// Revora dashboard, part 37: the CHAT screen (header, order card, quiet bubbles, reply-window bar, saved-reply chips).
// Wraps bvSelectConversation: the original builds the thread and the reply box, this restyles it and adds the context around it.
(function () {
  const orig = window.bvSelectConversation;
  if (typeof orig !== "function") return;
  const css = `
  #convTabRoot #convThread{background:var(--bg)}
  .conv-thread-head.ch2{position:sticky;top:0;z-index:6;padding:6px 8px 6px 4px;gap:4px;background:var(--panel);justify-content:flex-start;align-items:center;min-height:64px}
  .ch2 .conv-back-btn{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;border:0;background:none;color:var(--text);flex:none}
  .ch2-av{position:relative;width:40px;height:40px;flex:none;margin-right:6px}
  .ch2-ini{width:40px;height:40px;border-radius:50%;background:var(--panel2);border:1px solid var(--border);color:var(--text2);font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center}
  .ch2-nm{flex:1;min-width:0}.ch2-nm b{display:block;font-size:16px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ch2-nm span{display:block;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ch2 .ix-ib{flex:none}
  .ch2-ctx{margin:12px 16px 0;background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:12px 14px;display:flex;gap:12px;align-items:center;flex:none}
  .ch2-ico{width:40px;height:40px;border-radius:10px;background:rgba(36,71,214,.1);color:#2447d6;display:flex;align-items:center;justify-content:center;flex:none}
  .ch2-ico svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .ch2-tx{flex:1;min-width:0}.ch2-tx b{display:block;font-size:14.5px;font-weight:600;color:var(--text)}.ch2-tx span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ch2-open{height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;flex:none}
  #convTabRoot .conv-msgs{background:var(--bg);background-image:none;padding:8px 16px 6px;gap:6px}
  #convTabRoot .bubble{max-width:82%;box-shadow:none;font-size:15px;line-height:1.42;border-radius:16px}
  #convTabRoot .bubble.in{background:var(--panel);color:var(--text);border:1px solid var(--border);border-top-left-radius:5px}
  #convTabRoot .bubble.out{background:var(--text);color:var(--panel);border:1px solid var(--text);border-top-right-radius:5px}
  #convTabRoot .bubble.out .bubble-time{color:inherit;opacity:.7}
  #convTabRoot .bubble.in .bubble-time{color:var(--muted)}
  .ch2-win{display:flex;gap:8px;align-items:center;font-size:12.5px;line-height:1.35;color:var(--text2);padding:9px 16px;background:var(--panel);border-top:1px solid var(--border);flex:none}
  .ch2-win svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .ch2-win.warn{background:#fdeee3;color:#7a3208}
  .ch2-win button{margin-left:auto;flex:none;height:32px;padding:0 12px;border-radius:9px;border:1px solid #e8b98f;background:#fff;color:#7a3208;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
  .ch2-qr{display:flex;gap:8px;padding:10px 16px 2px;overflow-x:auto;background:var(--panel);scrollbar-width:none;flex:none}
  .ch2-qr::-webkit-scrollbar{display:none}
  .ch2-qr button{flex:none;height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const esc = (s) => (typeof bvEscape === "function" ? bvEscape(s) : String(s ?? ""));
  const SVG = {
    back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 016 0"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };
  const ini = (n) => (String(n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("") || "?").toUpperCase();
  const naira = (n) => "₦" + Number(n || 0).toLocaleString("en-NG");

  async function decorate(id) {
    const th = document.getElementById("convThread");
    if (!th || typeof bvSelectedConvId === "undefined" || bvSelectedConvId !== id) return;
    const conv = bvConversations.find((c) => c.id === id); if (!conv) return;
    const head = th.querySelector(".conv-thread-head"), compose = th.querySelector(".conv-compose");
    if (!head || !compose) return;
    const digits = String(conv.phone || "").replace(/\D/g, "");
    head.classList.add("ch2");
    head.innerHTML = `<button type="button" class="conv-back-btn" onclick="bvBackToList()" aria-label="Back to inbox">${SVG.back}</button>
      <div class="ch2-av"><div class="ch2-ini">${esc(ini(bvName(conv)))}</div><span class="ix-ch wa"><svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z"/></svg></span></div>
      <div class="ch2-nm"><b>${esc(bvName(conv))}</b><span>WhatsApp${digits ? " · +" + esc(digits) : ""}</span></div>
      <span id="convHandoffBadge">${conv.human_handling && typeof bvHandoffBadgeHtml === "function" ? bvHandoffBadgeHtml() : ""}</span>
      ${digits ? `<a class="ix-ib" href="tel:+${digits}" aria-label="Call">${SVG.call}</a>` : ""}`;

    const [ords, inb, chips] = await Promise.all([
      digits.length >= 9 ? sbQuery("orders", `select=id,order_status,payment_status,delivery_stage,order_value_naira,product_name,customer_city&customer_phone=ilike.*${digits.slice(-9)}*&order=ordered_at.desc&limit=1`).catch(() => []) : Promise.resolve([]),
      sbQuery("messages", `select=created_at&conversation_id=eq.${id}&direction=eq.inbound&order=created_at.desc&limit=1`).catch(() => []),
      typeof bvSavedForChips === "function" ? bvSavedForChips(4).catch(() => []) : Promise.resolve([])
    ]);
    if (bvSelectedConvId !== id || !document.getElementById("convThread")) return;

    th.querySelectorAll(".ch2-ctx,.ch2-win,.ch2-qr").forEach((x) => x.remove());
    const o = ords && ords[0];
    if (o) {
      const stt = typeof ordState === "function" ? ordState(o) : { l: o.order_status || "Order" };
      head.insertAdjacentHTML("afterend", `<div class="ch2-ctx"><div class="ch2-ico">${SVG.bag}</div><div class="ch2-tx"><b>Order · ${esc(stt.l)}</b><span>${esc([o.product_name, naira(o.order_value_naira), o.customer_city].filter(Boolean).join(" · "))}</span></div><button type="button" class="ch2-open" onclick="bvChatOpenOrder('${o.id}')">Open</button></div>`);
    }
    const at = inb && inb[0] && Date.parse(inb[0].created_at);
    const left = at ? 24 * 3600000 - (Date.now() - at) : 0;
    window.__ixWin = { id, open: !!(at && left > 0) };
    let win;
    if (at && left > 0) { const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000); win = `<div class="ch2-win">${SVG.clock}<span>You can reply freely for ${h ? h + " h " : ""}${m} min. After that, use a template.</span></div>`; }
    else win = `<div class="ch2-win warn">${SVG.clock}<span>${at ? "More than 24 hours since they wrote." : "They have not written yet."} Only an approved template can be sent.</span><button type="button" onclick="bvTemplateModal()">Templates</button></div>`;
    const qr = `<div class="ch2-qr">${(chips || []).map((r) => `<button type="button" onclick="bvUseSavedReply('${r.id}')">${esc(r.title)}</button>`).join("")}<button type="button" onclick="bvSavedReplies()">${chips && chips.length ? "More" : "Add saved replies"}</button></div>`;
    compose.insertAdjacentHTML("beforebegin", win + qr);
  }

  window.bvChatOpenOrder = function (oid) {
    if (typeof ORD !== "undefined") { ORD.sel = oid; ORD.mDetail = true; }
    document.querySelector('.tab-btn[data-tab="orders"]')?.click();
  };
  window.bvSelectConversation = async function (id) {
    await orig.apply(this, arguments);
    try { await decorate(id); } catch (e) { /* the plain thread still works */ }
    // Phones: the system back button / swipe goes back to the list instead of leaving the app.
    try { if (window.innerWidth <= 820 && !(history.state && history.state.ixChat)) history.pushState({ ixChat: id }, ""); } catch (_) { /* history is optional */ }
  };
  const origBack = window.bvBackToList;
  if (typeof origBack === "function") {
    window.bvBackToList = function () {
      origBack.apply(this, arguments);
      try { if (history.state && history.state.ixChat) history.back(); } catch (_) { /* nothing to pop */ }
    };
    window.addEventListener("popstate", () => {
      const r = document.getElementById("convTabRoot");
      if (r && r.classList.contains("thread-open")) origBack();
    });
  }
  // Typing into a chat whose 24-hour window has closed cannot be delivered: keep the text and offer templates instead of a failed send.
  const origSend = window.bvSendReply;
  if (typeof origSend === "function") {
    window.bvSendReply = async function () {
      const w = window.__ixWin, box = document.getElementById("convReplyInput");
      if (w && w.id === bvSelectedConvId && w.open === false && box && box.value.trim()) {
        if (typeof bvClosedWindowSheet === "function") bvClosedWindowSheet(box.value.trim());
        else if (typeof bvTemplateModal === "function") bvTemplateModal();
        return;
      }
      return origSend.apply(this, arguments);
    };
  }
})();
