// ── Catalog, clean: a product with its packages (saved the moment you add them), the creatives grid, one creative, and "Post to your Page".
// Restyles the existing Catalog product screen (11-catalog-products.js) by rearranging what it draws; the ids, saving and uploads stay the existing ones.
// The packages editor used to exist only in the old product form, which the new Catalog hides, so packages could only be added through the AI. It is here now.
(function () {
  if (window.__ccInstalled) return; window.__ccInstalled = true;
  const css = `
  .pr{max-width:640px;margin:0 auto}
  .pr-hd{display:flex;gap:12px;align-items:center;padding:14px;border-radius:24px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06)}
  .pr-hd .cat-photo{width:84px;height:84px;min-height:0;flex:none;border-radius:20px;overflow:hidden;font-size:12px;padding:0}
  .pr-hd .cat-photo img{width:100%;height:100%;object-fit:cover}
  .pr-nm{flex:1;min-width:0}.pr-nm small{display:block;font-size:12px;color:var(--muted);margin:0 0 4px}
  .pr-nm .cat-in{height:48px;border:0;border-radius:14px;background:var(--panel2);font-weight:650}
  .pr-sec{display:flex;align-items:baseline;justify-content:space-between;margin:22px 4px 10px}.pr-sec b{font-size:16px;font-weight:700}.pr-sec span{font-size:12px;color:var(--muted)}
  .pk{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;margin-bottom:10px;border:2px solid transparent;border-radius:20px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06);text-align:left;color:var(--text);font:inherit;cursor:pointer}
  .pk{padding:6px 10px 6px 6px;gap:4px}.pk .pk-r{width:44px;height:44px;border:0;background:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none;padding:0}
  .pk .pk-r i{width:22px;height:22px;border-radius:50%;border:2px solid var(--border);display:block;box-sizing:border-box}.pk.on .pk-r i{border:7px solid #1f6fff}
  .pk .pk-m{flex:1;min-width:0;display:flex;align-items:center;gap:12px;border:0;background:none;color:var(--text);font:inherit;text-align:left;padding:10px 4px;cursor:pointer}
  .pk .df{display:inline-flex;height:20px;padding:0 8px;border-radius:10px;background:rgba(24,163,90,.14);color:#127a43;font-size:11px;font-weight:750;align-items:center;margin-left:8px}
  .pk.on{border-color:#1f6fff}.pk .t{flex:1;min-width:0}.pk b{font-weight:700}.pk small{display:block;font-size:12px;color:var(--muted);margin-top:2px}
  .pk .bd{display:inline-flex;height:20px;padding:0 8px;border-radius:10px;background:rgba(31,111,255,.12);color:#1f6fff;font-size:11px;font-weight:750;align-items:center;margin-left:8px}
  .pk .pc{font-size:18px;font-weight:750}.pk svg{width:18px;height:18px;stroke:var(--muted);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .pk-add{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:56px;border:2px dashed var(--border);border-radius:20px;background:transparent;color:#1f6fff;font:inherit;font-weight:700;font-size:15px;cursor:pointer}
  .pk-hint{font-size:12px;color:var(--muted);margin:8px 4px 0}
  .pr-seg{display:flex;background:rgba(120,130,150,.16);border-radius:14px;padding:3px}
  .pr-seg button{flex:1;min-height:42px;border:0;border-radius:11px;background:transparent;color:var(--muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
  .pr-seg button.on{background:var(--panel);color:var(--text);font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.12)}
  .pr-dest{margin-top:10px}.pr-dest .cat-in{border:0;border-radius:14px;background:var(--panel);height:48px;box-shadow:0 1px 2px rgba(15,30,70,.06)}
  .pr-link{display:flex;align-items:center;gap:12px;margin-top:14px;padding:14px 16px;border-radius:20px;background:rgba(31,111,255,.1)}
  .pr-link i{width:40px;height:40px;border-radius:13px;background:#1f6fff;color:#fff;display:flex;align-items:center;justify-content:center;flex:none}
  .pr-link i svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .pr-link span{flex:1;min-width:0}.pr-link b{display:block;font-weight:700}.pr-link small{display:block;font-size:12px;color:var(--muted)}
  .pr-link button{height:38px;padding:0 14px;border:0;border-radius:12px;background:var(--panel);color:var(--text);font:inherit;font-weight:700;font-size:12px;cursor:pointer}
  .pr-more{margin-top:22px}.pr-more>summary{cursor:pointer;font-weight:700;font-size:15px;padding:12px 4px;min-height:44px}
  .pr-where{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px}
  .pr-where label{display:block;font-size:12px;color:var(--muted);margin:0 0 6px 2px}
  .pr-where select{width:100%;height:50px;border:0;border-radius:14px;background:var(--panel);color:var(--text);font:inherit;font-weight:650;padding:0 12px;box-shadow:0 1px 2px rgba(15,30,70,.06)}
  /* package sheet */
  .pks .fl{font-size:12px;color:var(--muted);margin:16px 0 6px}
  .pks input[type=text],.pks input[type=number]{width:100%;height:50px;border:0;border-radius:14px;background:var(--panel2);color:var(--text);padding:0 14px;font:inherit;font-weight:650;box-sizing:border-box}
  .pks .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .pks .st{height:50px;border-radius:14px;background:var(--panel2);display:flex;align-items:center;justify-content:space-between;padding:0 6px}
  .pks .st button{width:40px;height:40px;border:0;border-radius:12px;background:var(--panel);color:var(--text);font-size:20px;font-weight:700;cursor:pointer}
  .pks .sw{display:flex;align-items:center;gap:12px;margin-top:16px;font-weight:650;cursor:pointer}.pks .sw span{flex:1}
  .pks .tg{width:46px;height:28px;border-radius:14px;background:rgba(120,130,150,.3);position:relative;flex:none;transition:background .15s}.pks .tg i{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:11px;background:#fff;transition:left .15s}
  .pks .tg.on{background:#18a35a}.pks .tg.on i{left:21px}
  .pks .rm{display:block;width:100%;min-height:44px;margin-top:10px;border:0;background:none;color:#b3262c;font:inherit;font-weight:700;cursor:pointer}
  /* creatives */
  .cg-top{display:flex;align-items:center;gap:10px;margin-bottom:12px}.cg-top .pr-seg{flex:1}
  .cg-add{height:44px;padding:0 18px;border:0;border-radius:22px;background:#1f6fff;color:#fff;font:inherit;font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px;cursor:pointer;flex:none}
  .cg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .cg-c{border:0;padding:0;border-radius:22px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06);overflow:hidden;text-align:left;color:var(--text);font:inherit;cursor:pointer}
  .cg-m{position:relative;height:170px;background:#1c2330;display:flex;align-items:center;justify-content:center;color:#fff;overflow:hidden}
  .cg-m img,.cg-m video{width:100%;height:100%;object-fit:cover;display:block}
  .cg-pl{position:absolute;width:44px;height:44px;border-radius:22px;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
  .cg-tag{position:absolute;left:10px;bottom:10px;height:24px;padding:0 10px;border-radius:12px;background:rgba(255,255,255,.94);color:#0f1a30;font-size:11px;font-weight:750;display:inline-flex;align-items:center}
  .cg-tag.g{background:rgba(24,163,90,.95);color:#fff}
  .cg-n{padding:12px 14px 14px}.cg-n b{display:block;font-weight:650;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cg-n small{display:block;font-size:12px;color:var(--muted);margin-top:2px}
  .cg-empty{padding:40px 12px;text-align:center;color:var(--text2);font-size:15px;line-height:1.5}
  /* one creative */
  .cd-ov{position:fixed;inset:0;z-index:9990;background:var(--bg);overflow:auto;-webkit-overflow-scrolling:touch}
  .cd-in{max-width:640px;margin:0 auto;padding:12px 16px calc(32px + env(safe-area-inset-bottom))}
  .cd-top{display:flex;align-items:center;gap:8px;padding:4px 0 10px}
  .cd-back{width:44px;height:44px;border:0;border-radius:50%;background:var(--panel);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 2px rgba(15,30,70,.08),0 4px 14px rgba(15,30,70,.06);flex:none}
  .cd-back svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .cd-tag{display:inline-flex;height:24px;padding:0 11px;border-radius:12px;background:rgba(31,111,255,.14);color:#1f6fff;font-size:12px;font-weight:750;align-items:center}
  .cd-top h2{margin:2px 0 0;font-size:18px;font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cd-m{position:relative;min-height:240px;max-height:420px;border-radius:26px;overflow:hidden;background:#1c2330;display:flex;align-items:center;justify-content:center}
  .cd-m img,.cd-m video{width:100%;max-height:420px;object-fit:contain;display:block}
  .cd-two{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
  .cd-b{display:flex;align-items:center;justify-content:center;gap:8px;min-height:54px;border:0;border-radius:16px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06);color:var(--text);font:inherit;font-size:15px;font-weight:700;cursor:pointer}
  .cd-b.p{background:#1f6fff;color:#fff}.cd-b svg{width:18px;height:18px}.cd-b.p svg{stroke:#fff}
  .cd-card{margin-top:14px;padding:16px;border-radius:24px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06)}
  .cd-card small{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.04em}
  .cd-card .t{margin-top:8px;font-size:15px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
  .cd-card hr{border:0;border-top:1px solid var(--border);margin:14px 0}.cd-kv{display:flex;justify-content:space-between;gap:12px;margin-top:10px}.cd-kv span{color:var(--muted)}.cd-kv b{font-weight:650;text-align:right}
  .cd-sm{margin-top:12px;height:40px;padding:0 14px;border:0;border-radius:12px;background:var(--panel2);color:var(--text);font:inherit;font-weight:700;font-size:13px;cursor:pointer}
  .cd-row{display:flex;gap:10px;margin-top:12px}.cd-row .cd-b{flex:1;min-height:50px;font-size:14px}
  /* post to page */
  .pp .pg{display:flex;align-items:center;gap:12px;margin-top:14px;padding:12px 14px;border-radius:18px;background:var(--panel2)}
  .pp .pg i{width:40px;height:40px;border-radius:20px;background:#1877f2;color:#fff;display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:750}
  .pp .pg select{flex:1;min-width:0;border:0;background:transparent;color:var(--text);font:inherit;font-weight:700;font-size:15px}
  .pp .bx{display:flex;gap:12px;margin-top:12px}.pp .th{width:92px;height:92px;border-radius:18px;background:#1c2330;flex:none;overflow:hidden;display:flex;align-items:center;justify-content:center}.pp .th img,.pp .th video{width:100%;height:100%;object-fit:cover}
  .pp textarea{flex:1;min-height:92px;border:0;border-radius:18px;background:var(--panel2);color:var(--text);font:inherit;font-size:14px;line-height:1.45;padding:12px 14px;resize:none}
  .pp .go{width:100%;height:52px;margin-top:16px;border:0;border-radius:16px;background:#1f6fff;color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer}
  .pp .nt{text-align:center;font-size:12px;color:var(--muted);margin-top:10px}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const esc = (s) => escH(String(s == null ? "" : s));
  const CC = (window.CC = { tiers: {}, cur: "NGN" });
  // Amounts show in the product's own currency (₦ for naira, otherwise the code, e.g. KES 7,500).
  const money = (n) => { const c = CC.cur || "NGN", v = Number(n || 0); if (c === "NGN") return "₦" + v.toLocaleString("en-NG", { maximumFractionDigits: 0 }); try { return new Intl.NumberFormat("en-NG", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(v); } catch (e) { return c + " " + v.toLocaleString(); } };
  const CHEV = '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';

  // ---------- the link customers use for a product ----------
  // A product whose page is on the person's own domain uses that domain. Otherwise the order page on Revora's own domain (never the free Vercel address).
  window.RV_APP_ORIGIN = window.RV_APP_ORIGIN || "https://dash.revoracrm.online";
  window.rvProductLink = async function (p) {
    if (p.order_form_url && /^https:\/\//i.test(p.order_form_url)) return p.order_form_url;
    try {
      const sites = await sbQuery("sites", `select=id&product_id=eq.${p.id}`, { allAccounts: true }).catch(() => []);
      if (sites && sites.length) { const doms = await sbQuery("site_domains", "select=hostname,site_id,status").catch(() => []); const d = (doms || []).find((x) => x.status === "active" && sites.some((s) => s.id === x.site_id)); if (d) return "https://" + d.hostname; }
    } catch (e) {}
    let code = ""; try { code = typeof window.caBuyerCode === "function" ? await window.caBuyerCode() : ""; } catch (e) {}
    return `${window.RV_APP_ORIGIN}/order.html?product=${p.id}${code ? "&buyer=" + encodeURIComponent(code) : ""}`;
  };

  // ---------- generic bottom sheet (shares the chat sheet look) ----------
  const sheetClose = () => { const e = document.getElementById("ccSheet"); if (e) e.remove(); };
  const sheet = (html, cls) => { sheetClose(); const w = document.createElement("div"); w.id = "ccSheet"; w.innerHTML = `<div class="ca-scrim" onclick="ccSheetClose()"></div><div class="ca-sheet ${cls || ""}" role="dialog"><div class="ca-grab"></div>${html}</div>`; document.body.appendChild(w); return w; };
  window.ccSheetClose = sheetClose;

  // ---------- packages ----------
  async function loadTiers(pid) { return (await sbQuery("product_tiers", `select=*&product_id=eq.${pid}&order=sort_order.asc`).catch(() => [])) || []; }
  async function renderPk(p) {
    const box = document.getElementById("prPk"); if (!box) return;
    CC.cur = p.currency || "NGN";
    const t = await loadTiers(p.id); CC.tiers[p.id] = t;
    const dflt = t.find((x) => x.is_default) || t[0];
    const cur = Number(p.default_order_value_naira) || Number((document.getElementById("cd_price") || {}).value) || 0;
    box.innerHTML = (t.length ? t.map((x) => { const on = dflt && dflt.id === x.id; return `<div class="pk${on ? " on" : ""}"><button type="button" class="pk-r" aria-label="Make this the default price" onclick="ccDefault('${p.id}','${x.id}')"><i></i></button><button type="button" class="pk-m" onclick="ccPk('${p.id}','${x.id}')"><span class="t"><b>${esc(x.label)}</b>${on ? `<span class="df">Default price</span>` : ""}${x.badge ? `<span class="bd">${esc(x.badge)}</span>` : ""}<small>${x.quantity > 1 ? x.quantity + " pieces" : "1 piece"}</small></span><span class="pc">${money(x.price_naira)}</span>${CHEV}</button></div>`; }).join("")
      : (cur > 0 ? `<div class="pk on"><span class="pk-r" style="pointer-events:none"><i></i></span><span class="pk-m" style="cursor:default"><span class="t"><b>Your current price</b><span class="df">Default price</span><small>Becomes a package when you add another</small></span><span class="pc">${money(cur)}</span></span></div>` : ""))
      + `<button type="button" class="pk-add" onclick="ccPk('${p.id}')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add a package</button>`
      + `<div class="pk-hint">${t.length ? "The ticked one is the default price, shown first. " : "Customers see these on your order page. "}Saves the moment you add it.</div>`;
    const pw = document.getElementById("prPriceWrap"); if (pw) pw.style.display = t.length ? "none" : "";
    if (dflt) { const pi = document.getElementById("cd_price"); if (pi) pi.value = dflt.price_naira; p.default_order_value_naira = dflt.price_naira; }
  }
  window.ccPk = function (pid, tid) {
    const t = CC.tiers[pid] || [], cur = tid ? t.find((x) => x.id === tid) : null;
    const pr0 = (window.bvCatData && window.bvCatData.prods.find((x) => x.id === pid)) || {}, price0 = Number(pr0.default_order_value_naira) || Number((document.getElementById("cd_price") || {}).value) || 0, seedNeeded = !cur && !t.length && price0 > 0;
    let qty = cur ? Number(cur.quantity) || 1 : 1, best = !!(cur && cur.badge), first = cur ? !!cur.is_default : (!t.length && !seedNeeded);
    const w = sheet(`<h3 style="margin:0;font-size:19px;font-weight:750">${cur ? "Edit package" : "New package"}</h3>
      <div class="fl">Name</div><input type="text" id="pkName" value="${esc(cur ? cur.label : "")}" placeholder="e.g. 3 bottles">
      <div class="two"><div><div class="fl">Pieces</div><div class="st"><button type="button" id="pkMin" aria-label="Fewer">−</button><b id="pkQty">${qty}</b><button type="button" id="pkPlus" aria-label="More">+</button></div></div>
        <div><div class="fl">Price</div><input type="number" id="pkPrice" min="0" inputmode="numeric" value="${cur ? esc(cur.price_naira) : ""}" placeholder="65000"></div></div>
      <label class="sw" id="pkBest"><span>Show a "Best value" tag</span><i class="tg${best ? " on" : ""}"><i></i></i></label>
      <label class="sw" id="pkFirst"><span>Make this the default price</span><i class="tg${first ? " on" : ""}"><i></i></i></label>
      <div id="pkMsg" style="color:#b3262c;font-size:13px;margin-top:10px;min-height:16px"></div>
      <button type="button" class="ca-act p" id="pkSave">Save package</button>${cur ? `<button type="button" class="rm" id="pkDel">Remove this package</button>` : ""}`, "pks");
    const q = (s) => w.querySelector(s);
    q("#pkMin").onclick = () => { qty = Math.max(1, qty - 1); q("#pkQty").textContent = qty; };
    q("#pkPlus").onclick = () => { qty = Math.min(999, qty + 1); q("#pkQty").textContent = qty; };
    q("#pkBest").onclick = () => { best = !best; q("#pkBest .tg").classList.toggle("on", best); };
    q("#pkFirst").onclick = () => { first = !first; q("#pkFirst .tg").classList.toggle("on", first); };
    const done = async () => { sheetClose(); await bvSyncDefaultPrice(pid).catch(() => {}); const p = (window.bvCatData && window.bvCatData.prods.find((x) => x.id === pid)) || { id: pid }; await renderPk(p); await renderLink(p); };
    q("#pkSave").onclick = async () => {
      const label = q("#pkName").value.trim(), price = Number(q("#pkPrice").value), msg = q("#pkMsg");
      if (!label) { msg.textContent = "Give the package a name."; return; } if (!(price > 0)) { msg.textContent = "Enter the price."; return; }
      const b = q("#pkSave"); b.disabled = true; b.textContent = "Saving…";
      const row = { label, quantity: qty, price_naira: price, badge: best ? "Best value" : null };
      try {
        if (first) await supabaseClient.from("product_tiers").update({ is_default: false }).eq("product_id", pid).eq("is_default", true);
        // The price the product already had must not disappear: the first package added also keeps it as a package of its own.
        if (!cur && !t.length) {
          const pr = (window.bvCatData && window.bvCatData.prods.find((x) => x.id === pid)) || {}, now = Number(pr.default_order_value_naira) || Number((document.getElementById("cd_price") || {}).value) || 0;
          if (now > 0 && now !== price) { const sd = await supabaseClient.from("product_tiers").insert({ label: "1 piece", quantity: 1, price_naira: now, badge: null, product_id: pid, company_id: window.myProfile.company_id, is_default: !first, sort_order: 0 }); if (sd.error) throw sd.error; t.push({}); }
        }
        const r = cur ? await supabaseClient.from("product_tiers").update({ ...row, is_default: first || (cur.is_default && !first && t.length === 1) }).eq("id", cur.id)
          : await supabaseClient.from("product_tiers").insert({ ...row, product_id: pid, company_id: window.myProfile.company_id, is_default: first, sort_order: t.length });
        if (r.error) throw r.error;
        bvToast("Saved."); await done();
      } catch (e) { b.disabled = false; b.textContent = "Save package"; msg.textContent = "Could not save: " + (e.message || e); }
    };
    const del = q("#pkDel");
    if (del) del.onclick = async () => {
      if (!confirm("Remove this package?")) return;
      const was = cur.is_default; await supabaseClient.from("product_tiers").delete().eq("id", cur.id);
      if (was) { const next = t.find((x) => x.id !== cur.id); if (next) await supabaseClient.from("product_tiers").update({ is_default: true }).eq("id", next.id); }
      bvToast("Removed."); await done();
    };
  };

  window.ccDefault = async function (pid, tid) {
    await supabaseClient.from("product_tiers").update({ is_default: false }).eq("product_id", pid).eq("is_default", true);
    const r = await supabaseClient.from("product_tiers").update({ is_default: true }).eq("id", tid);
    if (r && r.error) { bvToast("Could not set it: " + r.error.message, "err"); return; }
    await bvSyncDefaultPrice(pid).catch(() => {}); const p = (window.bvCatData && window.bvCatData.prods.find((x) => x.id === pid)) || { id: pid }; await renderPk(p); bvToast("Default price set.");
  };

  async function renderLink(p) {
    const box = document.getElementById("prLink"); if (!box) return;
    const url = await window.rvProductLink(p);
    box.innerHTML = `<i><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></i><span><b>See my order page</b><small>Exactly what customers see</small></span><button type="button" id="prCopy">Copy link</button>`;
    box.onclick = (e) => { if (e.target.id === "prCopy") { try { navigator.clipboard.writeText(url); bvToast("Link copied."); } catch (x) { prompt("Copy this link", url); } } else window.open(url, "_blank", "noopener"); };
  }

  // ---------- product screen: Details ----------
  async function decDetails(p) {
    const body = document.getElementById("catBody"), two = body && body.querySelector(".cat-two"); if (!two || body.querySelector(".pr")) return;
    const $ = (id) => document.getElementById(id), photo = $("cd_photo"), nameIn = $("cd_name"), priceIn = $("cd_price"), dest = $("cd_dest"), wa = $("cd_wa"), url = $("cd_url");
    if (!photo || !nameIn || !priceIn || !dest) return;
    const pr = document.createElement("div"); pr.className = "pr";
    pr.innerHTML = `<div class="pr-hd"><div id="prPhoto"></div><div class="pr-nm"><small>Product name</small><div id="prName"></div><div id="prPriceWrap" style="margin-top:10px"><small>Price</small><div id="prPrice"></div></div></div></div>
      <div class="pr-sec"><b>Where you sell</b><span>Sets the money your prices use</span></div><div class="pr-where"><div><label for="prCountry">Country</label><select id="prCountry"></select></div><div><label for="prCur">Currency</label><select id="prCur"></select></div></div>
      <div class="pr-sec"><b>Packages and prices</b><span>What customers pick</span></div><div id="prPk"><div class="pk-hint">Loading…</div></div>
      <div class="pr-sec"><b>Customers order on</b></div><div class="pr-seg" id="prSeg"><button type="button" data-d="website">Website</button><button type="button" data-d="whatsapp">WhatsApp</button></div><div class="pr-dest" id="prDest"></div><div class="pr-link" id="prLink"></div>`;
    body.insertBefore(pr, two);
    pr.querySelector("#prPhoto").appendChild(photo); pr.querySelector("#prName").appendChild(nameIn); pr.querySelector("#prPrice").appendChild(priceIn);
    const row = dest.closest(".cat-row2"); const lbl = row && row.previousElementSibling; if (row) row.style.display = "none"; if (lbl && lbl.classList.contains("cat-lbl")) lbl.remove();
    [...two.querySelectorAll(".cat-lbl")].filter((l) => /^(Name|Photo)$/i.test(l.textContent.trim())).forEach((l) => l.remove());
    const holder = pr.querySelector("#prDest"), seg = pr.querySelector("#prSeg");
    const paintDest = () => {
      const d = dest.value === "website" ? "website" : "whatsapp";
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.d === d));
      holder.innerHTML = ""; const input = d === "website" ? url : wa; if (input) { input.style.marginTop = "0"; holder.appendChild(input); }
      [wa, url].forEach((x) => { if (x && x !== input) { x.style.display = "none"; two.appendChild(x); } }); if (input) input.style.display = "";
    };
    seg.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; dest.value = b.dataset.d; paintDest(); };
    paintDest();
    const det = document.createElement("details"); det.className = "pr-more"; det.innerHTML = "<summary>More details</summary>"; body.insertBefore(det, two); det.appendChild(two);
    // Country and currency: choosing a country fills in its currency (you can still change it). Saves straight away.
    const ctry = pr.querySelector("#prCountry"), cur = pr.querySelector("#prCur"), legacy = $("cd_cur");
    const guess = (p.target_countries && p.target_countries[0] && BV_CUR[p.target_countries[0]] === (p.currency || "NGN") ? p.target_countries[0] : "") || (Object.keys(BV_CUR).find((k) => BV_CUR[k] === (p.currency || "NGN")) || "NG");
    ctry.innerHTML = BV_COUNTRIES.map(([c, n]) => `<option value="${c}"${c === guess ? " selected" : ""}>${esc(n)}</option>`).join(""); cur.innerHTML = bvCurOpts(p.currency || "NGN");
    const saveWhere = async (code) => {
      p.currency = cur.value; if (legacy) legacy.value = cur.value;
      document.querySelectorAll(".cd_cc").forEach((b) => { if (b.value === code) b.checked = true; });
      const set = [...document.querySelectorAll(".cd_cc")].filter((b) => b.checked).map((b) => b.value);
      const r = await supabaseClient.from("products").update({ currency: cur.value, target_countries: set }).eq("id", p.id);
      if (r && r.error) { bvToast("Could not save: " + r.error.message, "err"); return; }
      p.target_countries = set; await renderPk(p); bvToast("Saved: " + (BV_COUNTRIES.find((x) => x[0] === code) || [0, code])[1] + ", " + cur.value + ".");
    };
    ctry.onchange = () => { cur.value = bvCurOf(ctry.value); saveWhere(ctry.value); };
    cur.onchange = () => saveWhere(ctry.value);
    await renderPk(p); await renderLink(p);
  }

  // ---------- product screen: Creatives ----------
  const ST = { untested: "New", testing: "Testing", winner: "Winner", winning: "Winner" };
  function cgCard(a) {
    const media = a.asset_type === "carousel" ? `<img src="${esc(((a.carousel_cards || [])[0] || {}).image_url || a.public_url)}" loading="lazy" alt="">` : a.asset_type === "post" ? (a.public_url && !/facebook\.com/.test(a.public_url) ? `<img src="${esc(a.public_url)}" loading="lazy" alt="">` : "") : a.asset_type === "video" ? `<video src="${esc(a.public_url)}#t=0.1" muted playsinline preload="metadata"></video><span class="cg-pl"><svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></span>` : `<img src="${esc(a.public_url)}" loading="lazy" alt="">`;
    const sub = a.asset_type === "carousel" ? `Carousel · ${(a.carousel_cards || []).length} cards` : a.asset_type === "video" ? "Video" : a.asset_type === "post" ? "Page post" : "Photo";
    const tag = ST[a.test_status] || "New";
    return `<button type="button" class="cg-c" onclick="ccOpen('${a.id}')"><div class="cg-m">${media}<span class="cg-tag${tag === "Winner" ? " g" : ""}">${esc(tag)}</span></div><div class="cg-n"><b>${esc(a.display_name || a.file_name || "Untitled")}</b><small>${sub}</small></div></button>`;
  }
  async function decCreatives(p) {
    const body = document.getElementById("catBody"); if (!body || body.querySelector(".cg-top")) return;
    const { assets } = window.bvCatData, mine = assets.filter((a) => a.product_id === p.id);
    let f = "all";
    const paint = () => { const list = mine.filter((a) => f === "all" || (f === "video" ? a.asset_type === "video" : ["image", "carousel", "post"].includes(a.asset_type))); const g = body.querySelector(".cg-wrap"); g.innerHTML = list.length ? `<div class="cg">${list.map(cgCard).join("")}</div>` : `<div class="cg-empty">Nothing here yet.<br>Tap Add to upload your first one.</div>`; };
    body.innerHTML = `<div class="pr"><div class="cg-top"><div class="pr-seg" id="cgSeg"><button type="button" data-f="all" class="on">All ${mine.length}</button><button type="button" data-f="image">Photos</button><button type="button" data-f="video">Videos</button></div>
      <button type="button" class="cg-add" id="cgAdd"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add</button></div><div id="cc_msg"></div><div class="cg-wrap"></div><input type="file" id="cc_file" accept="image/*,video/*" multiple hidden></div>`;
    paint();
    body.querySelector("#cgSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; f = b.dataset.f; body.querySelectorAll("#cgSeg button").forEach((x) => x.classList.toggle("on", x === b)); paint(); };
    const fi = body.querySelector("#cc_file");
    body.querySelector("#cgAdd").onclick = () => {
      if (!activeAccountId) { bvToast("Pick an ad account at the top first.", "err"); return; }
      sheet(`<h3 style="margin:0 0 6px;font-size:19px;font-weight:750">Add a creative</h3><button type="button" class="ca-row" id="adUp"><span class="ca-tx"><b>Photos or videos</b><small>From your phone</small></span><svg class="ca-chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button><button type="button" class="ca-row" id="adCar"><span class="ca-tx"><b>Carousel</b><small>2 to 10 swipeable pictures</small></span><svg class="ca-chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>`);
      document.getElementById("adUp").onclick = () => { sheetClose(); fi.click(); };
      document.getElementById("adCar").onclick = () => { sheetClose(); bvCatCarousel(p.id); };
    };
    fi.onchange = async () => {
      const m = body.querySelector("#cc_msg"); const files = [...fi.files]; if (!files.length) return;
      const meta = await bvCreativeUploadSheet(files, { primary_text: p.ad_primary_text, headline: p.ad_headline, description: p.ad_description, cta_type: p.ad_cta_type }); if (!meta) { fi.value = ""; return; }
      for (const file of files) {
        m.innerHTML = `<div class="msg">Uploading ${esc(file.name)}…</div>`;
        const fd = new FormData(); fd.append("file", file); fd.append("product_id", p.id); fd.append("uploaded_by", "dashboard"); fd.append("ad_account_id", activeAccountId);
        fd.append("primary_text", meta.primary_text); fd.append("headline", meta.headline); fd.append("description", meta.description); fd.append("cta_type", meta.cta_type);
        if (meta.name) fd.append("creative_name", files.length > 1 ? `${meta.name} ${files.indexOf(file) + 1}` : meta.name);
        const r = await bvCreFetch(fd).then((x) => x.json()).catch((e) => ({ error: e.message }));
        if (r.error) { m.innerHTML = `<div class="msg err">${esc(file.name)}: ${esc(r.error)}</div>`; return; }
      }
      renderCatalog(window.bvCatEl);
    };
  }

  // ---------- one creative ----------
  window.ccOpen = async function (id) {
    const a = (window.bvCatData.assets || []).find((x) => x.id === id); if (!a) return;
    const rows = await sbQuery("creative_assets", `select=id,primary_text,headline,description,cta_type&id=eq.${id}`).catch(() => []), t = (rows && rows[0]) || {};
    const media = a.asset_type === "video" ? `<video src="${esc(a.public_url)}" controls playsinline preload="metadata"></video>` : a.asset_type === "carousel" ? `<img src="${esc(((a.carousel_cards || [])[0] || {}).image_url || a.public_url)}" alt="">` : a.public_url && !/facebook\.com/.test(a.public_url) ? `<img src="${esc(a.public_url)}" alt="">` : "";
    const canPost = ["image", "video"].includes(a.asset_type) || (a.asset_type === "carousel" && (a.carousel_cards || []).filter((c) => c && c.image_url).length >= 2), pname = (window.bvCatData.prods.find((p) => p.id === a.product_id) || {}).product_name || "";
    const cta = String(t.cta_type || "").replace(/_/g, " ").toLowerCase(), ctaTxt = cta ? cta.charAt(0).toUpperCase() + cta.slice(1) : "";
    const ov = document.createElement("div"); ov.className = "cd-ov rv-ui"; ov.id = "ccDetail";
    ov.innerHTML = `<div class="cd-in"><div class="cd-top"><button type="button" class="cd-back" aria-label="Back" onclick="ccClose()"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button><div style="flex:1;min-width:0"><span class="cd-tag">Creative</span><h2>${esc(a.display_name || a.file_name || "Untitled")}</h2></div></div>
      <div class="cd-m">${media}</div>
      <div class="cd-two"><button type="button" class="cd-b p" onclick="ccClose();bvCatAskAI('${esc(pname).replace(/'/g, "\\'")}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h1l5 4V6L5 10H4a1 1 0 0 0-1 1zM15.5 8.5a4 4 0 0 1 0 7"/></svg>Use in an ad</button>
        ${canPost ? `<button type="button" class="cd-b" onclick="ccPost('${id}')"><svg viewBox="0 0 24 24" fill="#1877f2"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21z"/></svg>Post to Page</button>` : `<span></span>`}</div>
      ${t.primary_text || t.headline || ctaTxt ? `<div class="cd-card">${t.primary_text ? `<small>AD TEXT</small><div class="t">${esc(t.primary_text)}</div>` : ""}${t.headline ? `${t.primary_text ? "<hr>" : ""}<div class="cd-kv"><span>Headline</span><b>${esc(t.headline)}</b></div>` : ""}${ctaTxt ? `<div class="cd-kv"><span>Button</span><b>${esc(ctaTxt)}</b></div>` : ""}</div>` : ""}
      ${a.asset_type !== "carousel" && a.asset_type !== "post" ? `<button type="button" class="cd-sm" onclick="ccClose();bvCreativeEdit('${id}',()=>renderCatalog(window.bvCatEl))">Edit name and text</button>` : ""}
      <div class="cd-row"><button type="button" class="cd-b" style="color:#b3262c" onclick="ccDel('${id}')">Delete</button></div></div>`;
    document.body.appendChild(ov);
    try { history.pushState({ ccd: 1 }, "", location.href); } catch (e) {}
  };
  window.ccClose = function () { const o = document.getElementById("ccDetail"); if (o) o.remove(); };
  window.ccDel = async function (id) { if (!confirm("Delete this creative and its file?")) return; if (await bvDeleteCreative(id)) { ccClose(); renderCatalog(window.bvCatEl); } };
  window.addEventListener("popstate", () => { if (document.getElementById("ccDetail")) ccClose(); });

  // ---------- Post to your Page ----------
  window.ccPost = async function (id) {
    const w = sheet(`<h3 style="margin:0;font-size:19px;font-weight:750">Post to your Page</h3><div class="pg"><i>…</i><span style="flex:1">Checking your Page…</span></div>`, "pp");
    const pre = await sbFn("page-tools", { action: "post_preview", creative_id: id, ad_account_id: undefined }).catch(() => null);
    if (!pre || pre.error) { w.querySelector(".ca-sheet").innerHTML = `<div class="ca-grab"></div><h3 style="margin:0;font-size:19px;font-weight:750">Post to your Page</h3><div class="ca-empty">${esc((pre && pre.error) || "Could not check the Page for this creative.")}</div>`; return; }
    const pl = await sbFn("page-tools", { action: "my_pages", ad_account_id: undefined }).catch(() => null), pages = (pl && pl.pages) || [];
    const media = pre.kind === "video" ? `<video src="${esc(pre.url)}#t=0.1" muted playsinline></video>` : `<img src="${esc(pre.url)}" alt="">`;
    const sel = pages.length > 1 ? `<select id="ppPage">${pages.map((x) => `<option value="${esc(x.page_id)}" ${x.page_id === pre.page_id ? "selected" : ""}>${esc(x.name || x.page_id)}</option>`).join("")}</select>` : `<b style="flex:1;font-size:15px">${esc(pre.page_name || "Your Page")}</b>`;
    w.querySelector(".ca-sheet").innerHTML = `<div class="ca-grab"></div><h3 style="margin:0;font-size:19px;font-weight:750">Post to your Page</h3>
      <div class="pg"><i>${esc((pre.page_name || "P").charAt(0).toUpperCase())}</i>${sel}</div>
      <div class="bx"><div class="th">${media}</div><textarea id="ppCap" aria-label="Caption">${esc(pre.caption || "")}</textarea></div>
      <div id="ppRes" style="font-size:13px;margin-top:10px;min-height:16px"></div>
      <button type="button" class="go" id="ppGo">Post to ${esc(pre.page_name || "your Page")}</button><div class="nt">${pre.kind === "carousel" ? `All ${pre.count || ""} pictures go in one post, shown as a photo grid (a Page post cannot swipe like an ad carousel).` : "Shows on your Page straight away. It is a normal post, not an ad."}</div>`;
    const go = w.querySelector("#ppGo"), res = w.querySelector("#ppRes");
    go.onclick = async () => {
      const message = w.querySelector("#ppCap").value.trim(); if (!message) { res.style.color = "#b3262c"; res.textContent = "Write a caption first."; return; }
      go.disabled = true; go.textContent = "Posting…"; res.textContent = "";
      const pick = w.querySelector("#ppPage") && w.querySelector("#ppPage").value;
      const r = await sbFn("page-tools", { action: "post_creative", creative_id: id, confirmed: true, message, ...(pick ? { page_id: pick } : {}) }).catch((e) => ({ error: e.message }));
      if (r && r.ok) { res.style.color = "#127a43"; res.innerHTML = `Posted ✓ ${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener" style="color:#1f6fff;font-weight:700">Open the post</a>` : ""}`; go.style.display = "none"; }
      else { go.disabled = false; go.textContent = "Try again"; res.style.color = "#b3262c"; res.textContent = (r && r.error) || "Meta did not accept the post."; }
    };
  };

  // ---------- hook into the existing product screen ----------
  const orig = window.bvCatProduct;
  if (typeof orig === "function") window.bvCatProduct = async function (el) {
    const r = await orig.apply(this, arguments);
    try { const st = window.bvCat, p = window.bvCatData && window.bvCatData.prods.find((x) => x.id === st.pid); if (p) { if (st.tab === "details") await decDetails(p); else if (st.tab === "creatives") await decCreatives(p); } } catch (e) { console.warn("catalog screen", e); }
    return r;
  };
})();
