// ── Chat "+" menu, built from the person's own real data (products, packages and prices, order form link, website pages).
// Replaces the old fixed Order form / Package info / Website link entries, which carried another business's wording and a retired sender.
// Nothing is sent from here: a pick puts a draft in the reply box for the person to read, edit and send.
(function () {
  if (window.__caInstalled) return; window.__caInstalled = true;
  const css = `
  .ca-scrim{position:fixed;inset:0;background:rgba(8,14,30,.45);z-index:9998}
  .ca-sheet{position:fixed;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;background:var(--panel);color:var(--text);border-radius:28px 28px 0 0;padding:10px 18px calc(22px + env(safe-area-inset-bottom));z-index:9999;max-width:560px;margin:0 auto}
  .ca-grab{width:40px;height:5px;border-radius:3px;background:var(--panel2);margin:0 auto 14px}
  .ca-sheet h3{margin:0;font-size:19px;font-weight:750}.ca-sheet p{margin:4px 0 0;font-size:13px;color:var(--muted)}
  .ca-row{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:10px 4px;border:0;border-bottom:1px solid var(--border);background:none;color:var(--text);text-align:left;font:inherit;cursor:pointer}
  .ca-row:last-child{border-bottom:0}
  .ca-th{width:48px;height:48px;border-radius:12px;object-fit:cover;background:var(--panel2);flex:none}
  .ca-tx{flex:1;min-width:0}.ca-tx b{display:block;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ca-tx small{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ca-chev{width:18px;height:18px;stroke:var(--muted);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
  .ca-act{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:50px;margin-top:10px;border:0;border-radius:14px;background:var(--panel2);color:var(--text);font:inherit;font-size:15px;font-weight:700;cursor:pointer}
  .ca-act.p{background:#1f6fff;color:#fff}
  .ca-pk{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);font-size:15px}.ca-pk:last-child{border-bottom:0}.ca-pk b{font-weight:750}
  .ca-empty{padding:28px 8px;text-align:center;color:var(--text2);font-size:15px;line-height:1.5}
  .ca-bar{display:flex;align-items:center;gap:10px;margin:0 12px 8px;padding:8px 8px 8px 12px;border-radius:14px;background:var(--panel2);border:1px solid var(--border)}
  .ca-bar .b{flex:1;min-width:0}.ca-bar .b b{display:inline-flex;align-items:center;min-height:30px;padding:0 14px;border-radius:9px;background:#e4e6eb;color:#1c1e21;font-size:13px;font-weight:700}
  .ca-bar .b small{display:block;font-size:11px;color:var(--muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ca-bar button{width:44px;height:44px;border:0;border-radius:50%;background:none;color:var(--muted);font-size:18px;cursor:pointer}
  .ca-back{border:0;background:none;color:#1f6fff;font:inherit;font-weight:700;font-size:15px;padding:0 0 10px;min-height:44px;cursor:pointer}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const esc = (s) => escH(String(s == null ? "" : s));
  const CH = '<svg class="ca-chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';
  const D = { products: null, tiers: {}, sites: null, code: undefined };

  const close = () => { const e = document.getElementById("caSheet"); if (e) e.remove(); };
  function shell(html) {
    let w = document.getElementById("caSheet");
    if (!w) { w = document.createElement("div"); w.id = "caSheet"; document.body.appendChild(w); }
    w.innerHTML = `<div class="ca-scrim" onclick="caClose()"></div><div class="ca-sheet" role="dialog"><div class="ca-grab"></div>${html}</div>`;
  }
  window.caClose = close;

  // The words go into the reply box, ready to edit and send. A link goes behind a tap-to-open button, not into the text.
  window._caCta = null;
  function drawBar() {
    const old = document.getElementById("caCtaBar"); if (old) old.remove();
    const c = window._caCta, comp = document.querySelector(".conv-compose"); if (!c || !comp) return;
    const bar = document.createElement("div"); bar.id = "caCtaBar"; bar.className = "ca-bar";
    bar.innerHTML = `<div class="b"><b>${esc(c.label)}</b><small>Opens ${esc(c.url.replace(/^https?:\/\//, ""))}</small></div><button type="button" aria-label="Remove the button" onclick="caCtaClear()">✕</button>`;
    comp.parentNode.insertBefore(bar, comp);
  }
  window.caCtaClear = function () { window._caCta = null; drawBar(); };
  function draft(text, cta) {
    close();
    const el = document.getElementById("convReplyInput"); if (!el) return;
    el.value = el.value ? el.value.replace(/\s+$/, "") + "\n\n" + text : text;
    if (cta) { window._caCta = { label: String(cta.label).slice(0, 20), url: cta.url, conv: typeof bvSelectedConvId !== "undefined" ? bvSelectedConvId : null }; drawBar(); }
    try { bvAutoGrow(el); bvSyncComposeBtns(); } catch (e) {}
    el.focus();
  }
  window.caDraft = draft;

  const money = (n) => "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 });
  async function loadProducts() {
    if (D.products) return D.products;
    const rows = await sbQuery("products", "select=id,product_name,product_type,product_image_url,landing_page_url,order_form_url,default_order_value_naira,is_active&is_active=eq.true&order=product_name.asc", { allAccounts: true }).catch(() => []);
    D.products = rows || [];
    if (D.products.length) {
      const t = await sbQuery("product_tiers", `select=product_id,label,quantity,price_naira,is_default,is_active,sort_order&product_id=in.(${D.products.map((p) => p.id).join(",")})&order=sort_order.asc`, { allAccounts: true }).catch(() => []);
      (t || []).filter((x) => x.is_active !== false).forEach((x) => { (D.tiers[x.product_id] = D.tiers[x.product_id] || []).push(x); });
    }
    return D.products;
  }
  const from = (p) => { const t = D.tiers[p.id] || []; const n = t.length ? Math.min(...t.map((x) => Number(x.price_naira) || Infinity)) : Number(p.default_order_value_naira) || 0; return n && isFinite(n) ? n : null; };
  async function buyerCode() {
    if (D.code !== undefined) return D.code;
    D.code = "";
    const id = window.myProfile && window.myProfile.media_buyer_id;
    if (window.myProfile && window.myProfile.role === "buyer" && id) { const r = await sbQuery("media_buyers", `select=code&id=eq.${id}`).catch(() => []); D.code = (r && r[0] && r[0].code) || ""; }
    return D.code;
  }

  window.caProducts = async function () { return loadProducts(); };
  window.caBuyerCode = buyerCode;

  // The + sheet: what fits this customer first, then everything else you can add.
  const ROWS = [
    ["file", "Photo, video or voice note", "From your phone", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12", "#e8f0ff", "#1f6fff"],
    ["catalog", "My products and prices", "Your own packages and photos", "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0", "#e3f6ec", "#127a43"],
    ["website", "My website link", "Your live pages", "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7", "#fff2d9", "#8a5600"],
    ["saved", "Saved replies", "Your own, only you see them", "M4 6h16M4 12h16M4 18h10", "#f0e8ff", "#6d3fd1"],
    ["template", "WhatsApp-approved template", "To write after the 24-hour window", "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z", "#fdecec", "#b3262c"],
  ];
  window.caMenu = async function () {
    shell(`<h3>Add to your reply</h3><p>Everything here comes from your own Revora account.</p><div id="caFor"></div><div style="margin-top:6px">${ROWS.map((r) => `<button type="button" class="ca-row" onclick="caPick('${r[0]}')"><span class="ca-th" style="display:flex;align-items:center;justify-content:center;background:${r[4]};color:${r[5]};border-radius:14px;width:44px;height:44px"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${r[3]}"/></svg></span><span class="ca-tx"><b>${r[1]}</b><small>${r[2]}</small></span>${CH}</button>`).join("")}</div>`);
    if (typeof window.rvChatSuggest !== "function") return;
    const box = document.getElementById("caFor"); if (box) box.innerHTML = `<div class="fc-box"><small>FOR THIS CUSTOMER</small><p>Checking what they have with you…</p></div>`;
    const sg = await window.rvChatSuggest().catch(() => null), el = document.getElementById("caFor"); if (!el || !sg) { if (el) el.innerHTML = ""; return; }
    window._caOpts = sg.opts;
    el.innerHTML = `<div class="fc-box"><small>FOR THIS CUSTOMER</small><p>${esc(sg.note)}</p>
      ${sg.primary ? `<button type="button" class="fc-go" onclick="caUse('${esc(sg.primary.label)}')">Send the ${esc(sg.primary.label.toLowerCase())}</button>` : ""}
      ${sg.askProduct ? `<div class="fc-or">Pick the product</div><select class="fc-sel" aria-label="Pick the product" onchange="if(this.value)caRemember(this.value)"><option value="">Choose a product…</option>${sg.askProduct.map((p) => `<option value="${esc(p.id)}">${esc(p.product_name)}</option>`).join("")}</select>` : ""}
      ${sg.opts.length ? `<div class="fc-or">${sg.primary ? "Or choose another" : "Choose what to send"}</div><div class="fc-ch">${sg.opts.map((o) => `<button type="button" class="${sg.primary && sg.primary.label === o.label ? "on" : ""}" onclick="caUse('${esc(o.label)}')">${esc(o.label)}</button>`).join("")}</div>` : ""}</div>`;
  };
  window.caUse = function (label) { const o = (window._caOpts || []).find((x) => x.label === label); if (o) draft(o.text, { label: o.btn, url: o.url }); };
  window.caPick = function (k) {
    if (k === "file") { close(); const f = document.getElementById("convFileInput"); if (f) f.click(); }
    else if (k === "catalog") window.caCatalog();
    else if (k === "website") window.caWebsite();
    else if (k === "saved") { close(); if (window.bvSavedReplies) window.bvSavedReplies(); }
    else if (k === "template") { close(); if (window.bvTemplateModal) window.bvTemplateModal(); }
  };
  // The round + opens this sheet instead of the old drop-down.
  window.bvToggleAttachMenu = function (e) { if (e && e.stopPropagation) e.stopPropagation(); window.caMenu(); };

  window.caCatalog = async function () {
    shell(`<h3>My products</h3><p>Pick one to use its real prices, order link or photo.</p><div class="ca-empty"><span class="spin"></span></div>`);
    const ps = await loadProducts();
    if (!ps.length) { shell(`<h3>My products</h3><div class="ca-empty">You have no products yet.<br>Add one in Catalog and it shows up here with its real prices.</div>`); return; }
    shell(`<h3>My products</h3><p>Pick one to use its real prices, order link or photo.</p><div style="margin-top:8px">${ps.map((p) => { const f = from(p); return `<button type="button" class="ca-row" onclick="caProduct('${p.id}')">${p.product_image_url ? `<img class="ca-th" src="${esc(p.product_image_url)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="ca-th"></span>'}<span class="ca-tx"><b>${esc(p.product_name)}</b><small>${f ? "From " + money(f) : "No price set yet"}</small></span>${CH}</button>`; }).join("")}</div>`);
  };

  window.caProduct = async function (id) {
    const p = (D.products || []).find((x) => x.id === id); if (!p) return;
    const tiers = D.tiers[id] || [], code = await buyerCode();
    const link = (p.order_form_url && /^https?:/i.test(p.order_form_url)) ? p.order_form_url : `${location.origin}/order.html?product=${p.id}${code ? "&buyer=" + encodeURIComponent(code) : ""}`;
    window._caCur = { p, tiers, link };
    shell(`<button type="button" class="ca-back" onclick="caCatalog()">‹ All products</button><h3>${esc(p.product_name)}</h3>
      ${tiers.length ? `<div style="margin-top:10px">${tiers.map((t) => `<div class="ca-pk"><span>${esc(t.label || (t.quantity ? t.quantity + " pcs" : "Package"))}</span><b>${money(t.price_naira)}</b></div>`).join("")}</div>` : `<p>${from(p) ? "Price: " + money(from(p)) : "No packages or price set for this product yet."}</p>`}
      <button type="button" class="ca-act p" onclick="caSend('prices')">Put the prices in my reply</button>
      <button type="button" class="ca-act" onclick="caSend('link')">Put the order link in my reply</button>
      ${p.product_image_url ? `<button type="button" class="ca-act" onclick="caSend('photo')">Choose the photo to send</button>` : ""}`);
  };

  window.caSend = async function (what) {
    const c = window._caCur; if (!c) return;
    if (what === "prices") {
      const lines = c.tiers.length ? c.tiers.map((t) => `• ${t.label || (t.quantity ? t.quantity + " pcs" : "Package")} — ${money(t.price_naira)}`) : (from(c.p) ? [`• ${money(from(c.p))}`] : []);
      draft(`${c.p.product_name}\n${lines.join("\n")}\n\nWhich one would you like?`);
    } else if (what === "link") draft(`Order ${c.p.product_name} here 👇`, { label: "Order now", url: c.link });
    else if (what === "photo") {
      close();
      try { const b = await (await fetch(c.p.product_image_url)).blob(); bvOpenMediaPreview(new File([b], (c.p.product_name || "product") + ".jpg", { type: b.type || "image/jpeg" })); }
      catch (e) { bvToast ? bvToast("Could not load that photo.", "err") : alert("Could not load that photo."); }
    }
  };

  // Website pages: the person's own sites (live ones first) and each product's own page.
  window.caWebsite = async function () {
    shell(`<h3>My website</h3><p>Pick a page to send its link.</p><div class="ca-empty"><span class="spin"></span></div>`);
    const [sites, doms, ps] = await Promise.all([
      D.sites ? Promise.resolve(D.sites) : sbQuery("sites", "select=id,name,slug,status,product_id&order=created_at.desc", { allAccounts: true }).catch(() => []),
      sbQuery("site_domains", "select=hostname,site_id,status").catch(() => []), loadProducts(),
    ]);
    D.sites = sites || [];
    const items = [];
    D.sites.forEach((s) => { const dom = (doms || []).find((d) => d.site_id === s.id && d.status === "active"); items.push({ name: s.name || s.slug, url: dom ? "https://" + dom.hostname : window.RV_siteUrl(s.slug), live: s.status === "published" }); });
    ps.forEach((p) => { if (p.landing_page_url && /^https?:/i.test(p.landing_page_url) && !items.some((i) => i.url === p.landing_page_url)) items.push({ name: p.product_name, url: p.landing_page_url, live: true }); });
    items.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0));
    window._caSites = items;
    if (!items.length) { shell(`<h3>My website</h3><div class="ca-empty">You have no website yet.<br>Build one in Websites and its link shows up here.</div>`); return; }
    shell(`<h3>My website</h3><p>Pick a page to send its link.</p><div style="margin-top:8px">${items.map((i, n) => `<button type="button" class="ca-row" onclick="caDraft('Here it is 👇',{label:'Open website',url:_caSites[${n}].url})"><span class="ca-tx"><b>${esc(i.name)}</b><small>${esc(i.url.replace(/^https?:\/\//, ""))}${i.live ? "" : " · draft, not live yet"}</small></span>${CH}</button>`).join("")}</div>`);
  };

  // Sending with a button: the same sender as a plain reply, plus the button. A closed 24-hour window still goes through the template sheet.
  const prevSend = window.bvSendReply;
  window.bvSendReply = async function () {
    const c = window._caCta, box = document.getElementById("convReplyInput");
    if (!c || (typeof bvSelectedConvId !== "undefined" && c.conv !== bvSelectedConvId)) { window._caCta = null; drawBar(); return prevSend.apply(this, arguments); }
    const text = (box && box.value || "").trim();
    if (!text) { try { bvToast("Write a short message to go with the button.", "err"); } catch (e) { alert("Write a short message to go with the button."); } return; }
    const w = window.__ixWin;
    if (w && w.id === bvSelectedConvId && w.open === false) { if (typeof bvClosedWindowSheet === "function") bvClosedWindowSheet(text); return; }
    const btn = document.getElementById("convSendBtn"); if (box) box.disabled = true; if (btn) btn.disabled = true;
    try {
      const res = await sbFn("send-whatsapp-message", { conversation_id: bvSelectedConvId, text, cta: { label: c.label, url: c.url } });
      if (res && res.error) { alert("Failed to send: " + res.error); return; }
      box.value = ""; try { bvAutoGrow(box); bvSyncComposeBtns(); } catch (e) {}
      window._caCta = null; drawBar();
      if (res && res.as_button === false) { try { bvToast("WhatsApp would not show the button, so the link went in the text.", "err"); } catch (e) {} }
      bvAfterAgentSend();
    } catch (e) { alert("Failed to send: " + e.message); }
    finally { if (box) { box.disabled = false; box.focus(); } if (btn) btn.disabled = false; }
  };
  const prevSel = window.bvSelectConversation;
  if (typeof prevSel === "function") window.bvSelectConversation = function () { window._caCta = null; return prevSel.apply(this, arguments); };

  // The menu itself
  const prevAction = window.bvAttachMenuAction;
  window.bvAttachMenuAction = function (kind) {
    const m = document.getElementById("composeAttachMenu"); if (m) m.classList.remove("open");
    if (kind === "catalog" || kind === "packages" || kind === "form") return window.caCatalog();
    if (kind === "website") return window.caWebsite();
    if (kind === "saved") return window.bvSavedReplies && window.bvSavedReplies();
    return prevAction.apply(this, arguments);
  };
})();
