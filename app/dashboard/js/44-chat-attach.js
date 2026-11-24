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

  // The words go into the reply box, ready to edit and send.
  function draft(text) {
    close();
    const el = document.getElementById("convReplyInput"); if (!el) return;
    el.value = el.value ? el.value.replace(/\s+$/, "") + "\n\n" + text : text;
    try { bvAutoGrow(el); bvSyncComposeBtns(); } catch (e) {}
    el.focus();
  }
  window.caDraft = draft;

  const money = (n) => "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 });
  async function loadProducts() {
    if (D.products) return D.products;
    const rows = await sbQuery("products", "select=id,product_name,product_image_url,landing_page_url,order_form_url,default_order_value_naira,is_active&is_active=eq.true&order=product_name.asc", { allAccounts: true }).catch(() => []);
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
    } else if (what === "link") draft(`Order ${c.p.product_name} here 👇\n${c.link}`);
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
    shell(`<h3>My website</h3><p>Pick a page to send its link.</p><div style="margin-top:8px">${items.map((i, n) => `<button type="button" class="ca-row" onclick="caDraft('Here it is 👇\\n'+_caSites[${n}].url)"><span class="ca-tx"><b>${esc(i.name)}</b><small>${esc(i.url.replace(/^https?:\/\//, ""))}${i.live ? "" : " · draft, not live yet"}</small></span>${CH}</button>`).join("")}</div>`);
  };

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
