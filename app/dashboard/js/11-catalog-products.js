// Revora dashboard, part 11 of 23: CATALOG: one place for products, their creatives, sales pages and results
const BV_COUNTRIES = [["NG", "Nigeria"], ["KE", "Kenya"], ["GH", "Ghana"], ["ZA", "South Africa"], ["UG", "Uganda"], ["TZ", "Tanzania"], ["CM", "Cameroon"], ["RW", "Rwanda"], ["ZM", "Zambia"], ["SN", "Senegal"], ["CI", "Côte d'Ivoire"], ["ET", "Ethiopia"], ["EG", "Egypt"], ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"]];

// ── TAB: PRODUCTS ─────────────────────────────────────────────────────────────

// ── CATALOG: one place for products, their creatives, sales pages and results ──────────────
window.bvCat = window.bvCat || { pid: null, tab: "details", q: "", f: "all" };
const BV_CAT_NICHE = {
  health: { types: ["health_wellness", "beauty_skincare", "baby_kids"], nafdac: true, extra: "How to use it, and safety notes" },
  food: { types: ["food_drinks", "agro_farm"], nafdac: true, extra: "Ingredients, allergens and shelf life" },
  fashion: { types: ["fashion_clothing", "shoes_bags"], extra: "Sizes, colours and fabric" },
  perfume: { types: ["perfume_fragrance"], extra: "Scent notes and bottle size" },
  gadgets: { types: ["gadgets_electronics"], extra: "Specs and warranty" },
  home: { types: ["home_living"], extra: "Size, material and setup" },
  service: { types: ["services", "courses_digital", "real_estate"], extra: "What is included" },
};
function bvCatNiche(p) {
  const t = window.myCompany?.business_types || [];
  for (const k in BV_CAT_NICHE) if (BV_CAT_NICHE[k].types.some(x => t.includes(x))) return BV_CAT_NICHE[k];
  return { nafdac: !!p?.nafdac_reg_no, extra: "Extra details" };
}
function bvCatStatus(p) {
  if (p.is_active === false) return ["Inactive", "cat-off"];
  if (!p.product_image_url) return ["Add a photo", "cat-warn"];
  if (!p.description) return ["Add a description", "cat-warn"];
  return ["Ready for ads", "cat-ok"];
}
async function renderCatalog(el) {
  const [prods, assets, sites] = await Promise.all([
    sbQuery("products", "order=created_at.desc"),
    sbQuery("creative_assets", "select=id,product_id,asset_type,public_url,file_name,display_name,test_status,uploaded_at,carousel_cards,meta_post_id&order=uploaded_at.desc&limit=600&or=(uploaded_by.is.null,uploaded_by.neq.ai_chat)").catch(() => []),
    sbQuery("sites", "select=id,name,slug,status,product_id").catch(() => []),
  ]);
  window.bvCatData = { prods: prods || [], assets: assets || [], sites: sites || [] };
  if (window.bvCat.pid && window.bvCatData.prods.some(p => p.id === window.bvCat.pid)) return bvCatProduct(el);
  window.bvCat.pid = null;
  bvCatList(el);
}
function bvCatList(el) {
  const st = window.bvCat, { prods, assets, sites } = window.bvCatData;
  const need = prods.filter(p => bvCatStatus(p)[1] === "cat-warn").length;
  el.innerHTML = `
    <div class="sh"><div class="sh-title">Catalog</div><div class="sh-actions"><button type="button" class="btn btn-a" onclick="bvCatAdd()">+ Add product</button></div></div>
    <div style="color:var(--text2);margin:-6px 0 16px;font-size:13.5px;">Everything you sell, with its photos, ads and sales page in one place.</div>
    <div class="cat-top">
      <button class="cat-chip ${st.f === "all" ? "on" : ""}" data-f="all">All ${prods.length}</button>
      <button class="cat-chip ${st.f === "active" ? "on" : ""}" data-f="active">Active</button>
      <button class="cat-chip ${st.f === "need" ? "on" : ""}" data-f="need">Needs details ${need}</button>
      <input class="cat-search" id="catQ" placeholder="Search products" value="${escH(st.q)}">
    </div><div class="cat-grid" id="catGrid"></div>`;
  const paint = () => {
    const q = st.q.trim().toLowerCase();
    const list = prods.filter(p => (!q || p.product_name.toLowerCase().includes(q)) && (st.f === "all" || (st.f === "active" && p.is_active !== false) || (st.f === "need" && bvCatStatus(p)[1] === "cat-warn")));
    document.getElementById("catGrid").innerHTML = list.map(p => {
      const [lbl, cls] = bvCatStatus(p), na = assets.filter(a => a.product_id === p.id).length, ns = sites.filter(x => x.product_id === p.id).length;
      return `<button type="button" class="cat-card" onclick="bvCatOpen('${p.id}')"><div class="cat-im">${p.product_image_url ? `<img src="${escH(p.product_image_url)}" alt="">` : "📦"}</div>
        <div class="cat-bd"><b>${escH(p.product_name)}</b><small>${p.currency && p.currency !== "NGN" ? escH(p.currency) + " " + p.default_order_value_naira : fN(p.default_order_value_naira)} · ${na} creative${na === 1 ? "" : "s"} · ${ns} page${ns === 1 ? "" : "s"}</small><span class="cat-tag ${cls}">${lbl}</span></div></button>`;
    }).join("") + `<button type="button" class="cat-card cat-add" onclick="bvCatAdd()"><div class="cat-im" style="background:transparent;font-size:34px">+</div><div class="cat-bd"><b>Add a product</b><small>A photo, a name and a price is enough to start</small></div></button>`;
  };
  paint();
  el.querySelectorAll(".cat-chip").forEach(b => b.onclick = () => { st.f = b.dataset.f; el.querySelectorAll(".cat-chip").forEach(x => x.classList.toggle("on", x === b)); paint(); });
  document.getElementById("catQ").oninput = e => { st.q = e.target.value; paint(); };
}
function bvCatOpen(id) { window.bvCat.pid = id; window.bvCat.tab = "details"; render(); }
function bvCatAdd() {
  bvCloseModal();
  const o = document.createElement("div"); o.id = "bvModalOverlay"; o.className = "bv-overlay"; o.onclick = e => { if (e.target === o) bvCloseModal(); };
  o.innerHTML = `<div class="bv-modal" style="max-width:420px;"><div class="ph"><div class="ph-title">Add a product</div><button type="button" class="btn btn-g" onclick="bvCloseModal()">✕</button></div>
    <div class="cat-lbl">Product name</div><input class="cat-in" id="ca_name" placeholder="e.g. Lunessa">
    <div class="cat-lbl">Price (₦)</div><input class="cat-in" id="ca_price" type="number" min="0" placeholder="12500">
    <div class="cat-lbl">What it is, in one line <span style="font-weight:500">(the AI reads this)</span></div><input class="cat-in" id="ca_desc" placeholder="e.g. Herbal drink for bloating and constipation">
    <div id="ca_msg" style="margin-top:10px"></div>
    <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end"><button type="button" class="btn btn-g" onclick="bvCloseModal()">Cancel</button><button type="button" class="btn btn-a" id="ca_go">Add product</button></div></div>`;
  document.body.appendChild(o);
  document.getElementById("ca_go").onclick = async () => {
    const name = document.getElementById("ca_name").value.trim(), price = Number(document.getElementById("ca_price").value);
    const msg = document.getElementById("ca_msg");
    if (!name) { msg.innerHTML = '<div class="msg err">Give it a name.</div>'; return; }
    if (!(price > 0)) { msg.innerHTML = '<div class="msg err">Enter the price.</div>'; return; }
    const b = document.getElementById("ca_go"); b.disabled = true; b.textContent = "Adding…";
    const { data, error } = await supabaseClient.from("products").insert({ product_name: name, default_order_value_naira: price, currency: "NGN", is_active: true, description: document.getElementById("ca_desc").value.trim() || null, destination_type: "whatsapp", ad_account_id: activeAccountId }).select("id").single();
    if (error) { msg.innerHTML = `<div class="msg err">${escH(error.message)}</div>`; b.disabled = false; b.textContent = "Add product"; return; }
    bvCloseModal(); bvCatOpen(data.id);
  };
}
function bvCatLegacy(id) { window.bvLegacyOk = true; activeTab = "products"; document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === "catalog")); render().then(() => { try { bvEditProduct(id); } catch (e) {} }); }
function bvCatAskAI(name) {
  activeTab = "assistant"; document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === "assistant")); render();
  setTimeout(() => askChat(`Launch ads for ${name}`), 500);
}
function bvCatCarousel(productId, id) { bvCarouselSheet(productId, id || null, () => renderCatalog(window.bvCatEl)); }
async function bvCatProduct(el) {
  window.bvCatEl = el;
  const st = window.bvCat, { prods, assets, sites } = window.bvCatData;
  const p = prods.find(x => x.id === st.pid); if (!p) return bvCatList(el);
  const mine = assets.filter(a => a.product_id === p.id), pages = sites.filter(x => x.product_id === p.id);
  const nz = bvCatNiche(p);
  bvUpdateAppBar();
  el.innerHTML = `
    <div class="sh"><div class="sh-title"><button type="button" class="btn btn-g" style="margin-right:10px;padding:5px 10px" onclick="bvCat.pid=null;render()">← Catalog</button>${escH(p.product_name)}</div>
      <div class="sh-actions"><button type="button" class="btn btn-g" onclick="bvCatAskAI('${escH(p.product_name).replace(/'/g, "\\'")}')">✨ Ask AI to launch ads</button><button type="button" class="btn btn-a" id="catSave">Save</button></div></div>
    <div class="cat-tabs">${[["details", "Details"], ["creatives", `Creatives · ${mine.length}`], ["page", `Sales page${pages.length ? " · " + pages.length : ""}`], ["results", "Results"]].map(([k, l]) => `<button type="button" data-t="${k}" class="${st.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="catBody"></div>`;
  el.querySelectorAll(".cat-tabs button").forEach(b => b.onclick = () => { st.tab = b.dataset.t; bvCatProduct(el); });
  const body = document.getElementById("catBody"), save = document.getElementById("catSave");
  save.style.display = st.tab === "details" ? "" : "none";
  if (st.tab === "details") {
    const checks = [[!!p.description, "Name, price and description"], [!!p.product_image_url, "A product photo"], [mine.length > 0, `${mine.length} creative${mine.length === 1 ? "" : "s"}`], [!!p.benefits, "Top benefits written"]];
    body.innerHTML = `<div class="cat-two"><div>
      <div class="cat-lbl" style="margin-top:0">Name</div><input class="cat-in" id="cd_name" value="${escH(p.product_name)}">
      <div class="cat-row2"><div><div class="cat-lbl">Price</div><input class="cat-in" id="cd_price" type="number" min="0" value="${p.default_order_value_naira ?? ""}"></div>
        <div><div class="cat-lbl">In stock <span style="font-weight:500">(blank = not tracked)</span></div><input class="cat-in" id="cd_stock" type="number" min="0" value="${p.stock_on_hand ?? ""}"></div></div>
      <div class="cat-lbl">What it is (the AI reads this, so be clear)</div><textarea class="cat-in" id="cd_desc">${escH(p.description || "")}</textarea>
      <div class="cat-lbl">Top benefits</div><textarea class="cat-in" id="cd_benefits" style="min-height:60px">${escH(p.benefits || "")}</textarea>
      <div class="cat-lbl">Where people order</div>
      <div class="cat-row2"><select class="cat-in" id="cd_dest"><option value="whatsapp" ${p.destination_type !== "website" ? "selected" : ""}>WhatsApp chat</option><option value="website" ${p.destination_type === "website" ? "selected" : ""}>Website order form</option></select>
        <input class="cat-in" id="cd_wa" placeholder="WhatsApp number, e.g. 2348012345678" value="${escH(p.whatsapp_number || "")}"></div>
      <input class="cat-in" id="cd_url" style="margin-top:8px" placeholder="Website link (for website orders)" value="${escH(p.landing_page_url || "")}">
      <div class="cat-lbl">Countries this product sells in <span style="font-weight:500">(the AI Team launches ads here. Leave all unticked and it asks you in the meeting)</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;margin-bottom:4px">${BV_COUNTRIES.map(([c, n]) => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="cd_cc" value="${c}" ${(p.target_countries || []).includes(c) ? "checked" : ""}> ${escH(n)}</label>`).join("")}</div>
      <details class="cat-more" ${p.safety_notes || p.nafdac_reg_no ? "open" : ""}><summary>More details <span>for ${escH((window.myCompany?.business_types || [])[0]?.replace(/_/g, " ") || "your product")}</span></summary>
        <div class="cat-lbl">${escH(nz.extra)}</div><textarea class="cat-in" id="cd_safety">${escH(p.safety_notes || "")}</textarea>
        ${nz.nafdac || p.nafdac_reg_no ? `<div class="cat-lbl">NAFDAC number</div><input class="cat-in" id="cd_nafdac" value="${escH(p.nafdac_reg_no || "")}">` : ""}
        <div style="margin-top:12px"><button type="button" class="btn btn-g" onclick="bvCatLegacy('${p.id}')">Packages, bank details and WhatsApp bot settings →</button></div>
      </details>
      <label style="display:flex;gap:8px;align-items:center;margin-top:14px;font-size:13px"><input type="checkbox" id="cd_active" ${p.is_active !== false ? "checked" : ""}> Active (shown in order forms and ads)</label>
      <div id="cd_msg" style="margin-top:10px"></div></div>
      <div><div class="cat-lbl" style="margin-top:0">Photo</div>
        <div class="cat-photo" id="cd_photo">${p.product_image_url ? `<img src="${escH(p.product_image_url)}" alt="">` : "Click to add a photo"}</div><input type="file" accept="image/*" id="cd_file" hidden>
        <div class="cat-panel" style="margin-top:14px"><h4>Ready for ads</h4><div class="sub">What the assistant knows about this product</div>
          <div class="cat-check">${checks.map(([ok, t]) => `<span class="${ok ? "y" : "n"}">${ok ? "✓" : "•"} ${escH(t)}</span>`).join("")}</div></div></div></div>`;
    const file = document.getElementById("cd_file");
    document.getElementById("cd_photo").onclick = () => file.click();
    file.onchange = async () => {
      if (!file.files[0]) return;
      const box = document.getElementById("cd_photo"); box.textContent = "Uploading…";
      const fd = new FormData(); fd.append("file", file.files[0]); fd.append("product_id", p.id);
      try {
        const r = await fetch(`${SUPA_URL}/functions/v1/upload-product-image`, { method: "POST", headers: { Authorization: `Bearer ${sessionData?.access_token || ANON}` }, body: fd }).then(x => x.json());
        if (r.error) throw new Error(r.error);
        p.product_image_url = r.product_image_url; box.innerHTML = `<img src="${escH(r.product_image_url)}" alt="">`;
      } catch (e) { box.textContent = "Could not upload: " + e.message; }
    };
    save.onclick = async () => {
      const g = id => document.getElementById(id)?.value ?? "";
      const name = g("cd_name").trim(), price = Number(g("cd_price"));
      const msg = document.getElementById("cd_msg");
      if (!name || !(price >= 0)) { msg.innerHTML = '<div class="msg err">Name and price are needed.</div>'; return; }
      const fields = { product_name: name, default_order_value_naira: price, stock_on_hand: g("cd_stock") === "" ? null : Number(g("cd_stock")), description: g("cd_desc").trim() || null, benefits: g("cd_benefits").trim() || null,
        destination_type: g("cd_dest"), whatsapp_number: g("cd_wa").replace(/[^\d]/g, "") || null, landing_page_url: g("cd_url").trim() || null, safety_notes: g("cd_safety").trim() || null,
        target_countries: (cc => cc.length ? cc : null)([...document.querySelectorAll(".cd_cc:checked")].map(x => x.value)), is_active: document.getElementById("cd_active").checked, ...(document.getElementById("cd_nafdac") ? { nafdac_reg_no: g("cd_nafdac").trim() || null } : {}) };
      save.disabled = true; save.textContent = "Saving…";
      const { error } = await supabaseClient.from("products").update(fields).eq("id", p.id);
      save.disabled = false; save.textContent = "Save";
      if (error) { msg.innerHTML = `<div class="msg err">${escH(error.message)}</div>`; return; }
      Object.assign(p, fields); bvToast("Saved."); bvCatProduct(el);
    };
  } else if (st.tab === "creatives") {
    const lib = await sbQuery("ad_library", `select=id,headline,primary_text,cost_per_result,source&product_id=eq.${p.id}&order=imported_at.desc&limit=8`, { allAccounts: true }).catch(() => []);
    body.innerHTML = `<div class="cat-two"><div class="cat-panel"><div class="ph" style="margin-bottom:6px"><div class="ph-title">Images and videos</div><button type="button" class="btn btn-g" onclick="bvCatCarousel('${p.id}')" style="margin-right:6px">🎠 Create carousel</button><button type="button" class="btn btn-g" id="cc_up">Upload</button><input type="file" id="cc_file" accept="image/*,video/*" multiple hidden></div>
        <div class="sub" style="color:var(--text2);font-size:12.5px;margin-bottom:10px">Used by your campaigns and by the assistant when it plans ads.</div><div id="cc_msg"></div>
        ${mine.length ? `<div class="cat-thumbs">${mine.slice(0, 40).map(a => `<div class="cat-th"><div class="i" ${a.asset_type === "carousel" || a.asset_type === "post" ? "" : `data-view="${escH(a.public_url)}" data-type="${a.asset_type === "video" ? "video" : "image"}"`} style="position:relative">${a.asset_type === "carousel" ? `<img src="${escH(((a.carousel_cards || [])[0] || {}).image_url || a.public_url)}" loading="lazy" alt=""><span class="cr-badge" style="position:absolute;left:6px;bottom:6px">🎠 ${(a.carousel_cards || []).length} cards</span>` : a.asset_type === "post" ? `<span class="cr-badge" style="position:absolute;left:6px;bottom:6px">Page post</span>` + (a.public_url && !/facebook\.com/.test(a.public_url) ? `<img src="${escH(a.public_url)}" loading="lazy" alt="">` : "") : a.asset_type === "video" ? `<video src="${escH(a.public_url)}#t=0.1" muted playsinline preload="metadata"></video><span class="bv-play">▶</span>` : `<img src="${escH(a.public_url)}" loading="lazy" alt="">`}</div><small>${escH(a.display_name || a.file_name || "")}</small><small style="display:flex;justify-content:space-between;align-items:center;">${escH(({ untested: "Not used yet", testing: "Testing", winner: "Winner", winning: "Winner" })[a.test_status] || a.test_status || "")}<span><button type="button" title="Edit name and ad text" style="font-size:13px;padding:0 4px;" onclick="${a.asset_type === "carousel" ? `bvCatCarousel('${p.id}','${a.id}')` : `bvCreativeEdit('${a.id}')`}">✎</button><button type="button" title="Delete this creative" style="color:var(--danger);font-size:13px;padding:0 2px;" onclick="bvCatDelCre('${a.id}')">🗑</button></span></small></div>`).join("")}</div>` : `<div style="color:var(--muted);padding:14px 0">No creatives yet. Upload a few and the assistant can launch them for you.</div>`}</div>
      <div><div class="cat-panel"><h4>Saved ad copy</h4><div class="sub">Copy you saved, and your past ads that worked</div>
        ${(lib || []).length ? lib.map(c => `<div class="cat-copy"><b>${escH(c.headline || "Ad copy")}</b>${c.cost_per_result ? ` <span style="color:var(--green,#1a9a4a);font-size:12px">${fN(c.cost_per_result)} per result</span>` : ""}<p>${escH(c.primary_text)}</p></div>`).join("") : `<div style="color:var(--muted);font-size:13px">Nothing saved yet. Ask the assistant to write copy and tap “Save to my library”.</div>`}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button type="button" class="btn btn-a" onclick="bvCatAskAI('${escH(p.product_name).replace(/'/g, "\\'")}')">✨ Launch ads with AI</button><button type="button" class="btn btn-g" onclick="bvOpenObjectiveGateModal()">New campaign (manual)</button></div></div></div>`;
    const fi = document.getElementById("cc_file");
    document.getElementById("cc_up").onclick = () => { if (!activeAccountId) { document.getElementById("cc_msg").innerHTML = '<div class="msg err">Pick an ad account at the top first.</div>'; return; } fi.click(); };
    fi.onchange = async () => {
      const m = document.getElementById("cc_msg");
      for (const f of [...fi.files]) {
        m.innerHTML = `<div class="msg">Uploading ${escH(f.name)}…</div>`;
        const fd = new FormData(); fd.append("file", f); fd.append("product_id", p.id); fd.append("uploaded_by", "dashboard"); fd.append("ad_account_id", activeAccountId);
        if (!fi._meta) { fi._meta = await bvCreativeUploadSheet([...fi.files], { primary_text: p.ad_primary_text, headline: p.ad_headline, description: p.ad_description, cta_type: p.ad_cta_type }); if (!fi._meta) { fi._meta = null; fi.value = ""; return; } }
        const mt = fi._meta; fd.append("primary_text", mt.primary_text); fd.append("headline", mt.headline); fd.append("description", mt.description); fd.append("cta_type", mt.cta_type); if (mt.name) fd.append("creative_name", fi.files.length > 1 ? `${mt.name} ${[...fi.files].indexOf(f) + 1}` : mt.name);
        const r = await bvCreFetch(fd).then(x => x.json()).catch(e => ({ error: e.message }));
        if (r.error) { m.innerHTML = `<div class="msg err">${escH(f.name)}: ${escH(r.error)}</div>`; return; }
      }
      renderCatalog(el);
    };
  } else if (st.tab === "page") {
    body.innerHTML = `<div class="cat-panel"><div class="ph" style="margin-bottom:6px"><div class="ph-title">Sales pages for ${escH(p.product_name)}</div><button type="button" class="btn btn-a" onclick="bvGoToTab('websites')">+ Create a sales page</button></div>
      ${pages.length ? pages.map(x => `<div class="cat-copy" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><b>${escH(x.name)}</b><p style="-webkit-line-clamp:1">${escH(x.status || "")}${x.slug ? " · /" + escH(x.slug) : ""}</p></div><button type="button" class="btn btn-g" onclick="bvWebEdit('${x.id}')">Edit</button> <button type="button" class="btn btn-g" onclick="location.href='/ide.html?site=${x.id}'" title="Open the file editor">IDE</button></div>`).join("") : `<div style="color:var(--muted);padding:10px 0">No sales page yet.</div>`}
      <div style="margin-top:14px"><button type="button" class="btn btn-g" onclick="bvOrderLinkModal('${p.id}','${escH(p.product_name).replace(/'/g, "\\'")}')">🔗 Get the order form link</button></div></div>`;
  } else {
    const orders = await sbQuery("orders", `select=order_status,order_value_naira,ordered_at&product_id=eq.${p.id}&order=ordered_at.desc&limit=1000`, { allAccounts: true }).catch(() => []);
    const since = Date.now() - 30 * 864e5, o30 = (orders || []).filter(o => new Date(o.ordered_at).getTime() >= since), del = o30.filter(o => o.order_status === "delivered");
    const val = del.reduce((s, o) => s + Number(o.order_value_naira || 0), 0);
    body.innerHTML = `<div class="cat-tiles"><div class="cat-tile"><span>Orders · 30 days</span><b>${o30.length}</b></div><div class="cat-tile"><span>Delivered</span><b>${del.length}</b></div><div class="cat-tile"><span>Delivery rate</span><b>${o30.length ? Math.round(del.length / o30.length * 100) + "%" : "—"}</b></div><div class="cat-tile"><span>Delivered value</span><b>${fN(val)}</b></div></div>
      <div style="color:var(--muted);font-size:12.5px;margin-top:12px">Ad spend and cost per result are on the Campaigns tab. Ask the assistant “how are my ${escH(p.product_name)} ads doing?” for a plain-words review.</div>`;
  }
}

async function renderProducts(el) {
  const [prods, creatives] = await Promise.all([
    sbQuery("products", "order=created_at.desc"),
    sbQuery("creative_assets", "select=id,product_id,asset_type,public_url,file_name,display_name,test_status&or=(uploaded_by.is.null,uploaded_by.neq.ai_chat)"),
  ]);
  const creativesByProduct = {};
  (creatives || []).forEach(c => {
    if (!c.product_id) return;
    (creativesByProduct[c.product_id] ??= []).push(c);
  });

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Products</div></div>

    <div class="panel">
      <div class="ph"><div class="ph-title" id="prodFormTitle">Add product</div><div class="sh-actions"><button type="button" class="btn btn-g" id="prodCancelEdit" style="display:none;" onclick="bvCancelProductEdit()">Cancel edit</button></div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:12px;">Name and price are all you need to start — this is what shows up as a package in the Order Forms builder. Everything else (description, safety notes, WhatsApp bot behavior) is optional and can be filled in any time.</div>
      <form id="prodForm">
        <input type="hidden" id="p_id">
        <div class="fg">
          <div class="field"><label>Product name *</label><input id="p_name" required placeholder="e.g. Quality Herb — Immune Booster"></div>
          <div class="field"><label>Default price * <span style="font-weight:400;color:var(--muted);">(follows your default offer package once you add packages)</span></label><input id="p_val" type="number" value="19000" min="0"></div>
        </div>
        <div class="fg" style="margin-top:11px;">
          <div class="field"><label>Stock on hand <span style="font-weight:400;color:var(--muted);">(leave blank if you're not tracking inventory for this product)</span></label><input id="p_stock" type="number" min="0" step="1" placeholder="untracked"></div>
          <div class="field"><label>Low-stock alert at</label><input id="p_stock_threshold" type="number" min="0" step="1" value="10"></div>
        </div>
        <div class="fg" style="margin-top:11px;">
          <div class="field"><label>Currency</label>
            <select id="p_currency">
              <option value="NGN">NGN — Naira</option>
              <option value="USD">USD — US Dollar</option>
              <option value="CNY">CNY — Yuan</option>
              <option value="INR">INR — Rupee</option>
              <option value="GBP">GBP — Pound</option>
              <option value="EUR">EUR — Euro</option>
            </select>
          </div>
          <div class="field">
            <label>Product photo <span style="font-weight:400;color:var(--muted);">(shown on the order form)</span></label>
            <div style="display:flex;align-items:center;gap:10px;margin-top:2px;">
              <div id="prodImgPreview" style="width:34px;height:34px;border-radius:6px;background:var(--panel2);border:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:9px;color:var(--muted);">—</div>
              <!-- webp intentionally excluded -- confirmed via a real send failure
                   (Meta error 131053 "Media upload error") that WhatsApp's Cloud
                   API rejects webp as a message image, so a webp product photo
                   would silently break every warmup message that uses it. -->
              <input type="file" id="p_image_file" accept="image/jpeg,image/png" style="display:none;" onchange="bvUploadProductImage(this)">
              <button type="button" class="btn btn-g" id="prodImgBtn" style="padding:5px 10px;font-size:11px;" onclick="document.getElementById('p_image_file').click()">Upload</button>
            </div>
            <div id="prodImgHint" style="font-size:10.5px;color:var(--muted);margin-top:4px;">Save the package first, then come back to upload its photo.</div>
          </div>
        </div>

        <details style="margin-top:14px;">
          <summary style="cursor:pointer;font-size:12px;color:var(--text2);font-weight:600;">More details (description, safety notes, WhatsApp bot) — optional</summary>
          <div style="margin-top:11px;">
            <div class="field"><label>Landing page URL <span style="font-weight:400;color:var(--muted);">(website-ad click destination + the link the WhatsApp bot sends on "Learn More")</span></label><input id="p_url" placeholder="https://…"></div>
            <div class="fg" style="margin-top:11px;">
              <div class="field"><label>Destination</label>
                <select id="p_destination">
                  <option value="website">Website landing page</option>
                  <option value="whatsapp">WhatsApp (click-to-chat)</option>
                </select>
              </div>
              <div class="field"><label>WhatsApp number <span style="font-weight:400;color:var(--muted);">(if WhatsApp destination)</span></label><input id="p_whatsapp" placeholder="234..."></div>
            </div>
            <div class="field" style="margin-top:11px;"><label>Description <span style="font-weight:400;color:var(--muted);">(what the AI tells customers this product is)</span></label>
              <textarea id="p_description" rows="2" placeholder="Plain, factual description..."></textarea>
            </div>
            <div class="field" style="margin-top:11px;"><label>Benefits / claims <span style="font-weight:400;color:var(--muted);">(only what you can actually substantiate)</span></label>
              <textarea id="p_benefits" rows="2" placeholder="Real, approved benefit claims..."></textarea>
            </div>
            <div class="fg" style="margin-top:11px;">
              <div class="field"><label>Safety notes</label><input id="p_safety" placeholder="e.g. For adult use only, consult a doctor if..."></div>
              <div class="field"><label>NAFDAC Reg. No.</label><input id="p_nafdac" placeholder="e.g. A7-104257L"></div>
            </div>
            <div class="field" style="margin-top:11px;"><label>Warm-up message override <span style="font-weight:400;color:var(--muted);">(the WhatsApp bot's one opener message for a new lead -- leave blank to use its built-in default)</span></label>
              <textarea id="p_warmup" rows="4" placeholder="Leave blank to use the built-in default..."></textarea>
            </div>
            <div class="field" style="margin-top:11px;"><label>Order form URL override <span style="font-weight:400;color:var(--muted);">(only if this package shouldn't use the standard Order Forms link)</span></label>
              <input id="p_order_form_url" placeholder="https://…">
            </div>
          </div>
        </details>
          <div style="margin-top:14px;padding:12px;border:1px solid var(--border);border-radius:12px;">
            <div style="font-weight:600;font-size:13px;">🏦 Bank transfer details <span style="font-weight:400;color:var(--muted);">- shown to the customer right after they submit the order form</span></div>
            <div class="fg" style="margin-top:10px;">
              <div class="field"><label>Bank</label><input id="p_bank_name" placeholder="e.g. GTBank, Opay, Kuda"></div>
              <div class="field"><label>Account number</label><input id="p_bank_acct" inputmode="numeric" placeholder="10-digit account number"></div>
            </div>
            <div class="field" style="margin-top:11px;"><label>Account name</label><input id="p_bank_name_on" placeholder="Name on the account"></div>
            <div class="field" style="margin-top:11px;"><label>Note to the customer <span style="font-weight:400;color:var(--muted);">(optional)</span></label><input id="p_pay_note" placeholder="e.g. Send your payment screenshot on WhatsApp after transferring"></div>
            <label style="display:flex;gap:8px;align-items:center;margin-top:11px;font-size:12.5px;"><input type="checkbox" id="p_is_service"> This is a service (hide the delivery address on the order form)</label>
          </div>


        <div class="field" style="margin-top:14px;">
          <label>Offer packages <span style="font-weight:400;color:var(--muted);">(bundles customers can pick, e.g. "1 piece" / "3-piece bundle". The <b>default</b> one is pre-selected and sets the product's price. You can add them now, before saving the product.)</span></label>
          <div id="tiersList"></div>
          <div id="tiersHint" style="display:none;"></div>
        </div>

        <div class="field" id="vaultField" style="margin-top:18px;">
          <label>🎨 Creative vault <span style="font-weight:400;color:var(--muted);">(AD creatives only: what you upload here is saved for THIS product and is the only thing used in its ads. The product photo above is never used in ads. Each creative has each with its own headline, primary text, description and button. The AI launches tests from these.)</span></label>
          <div id="vaultBox"><div style="font-size:11.5px;color:var(--muted);padding:12px;border:1px dashed var(--border);border-radius:10px;">Save the product first, then upload its creatives here.</div></div>
        </div>
        <button type="submit" class="btn btn-a btn-full" id="prodSubmitBtn" style="margin-top:14px;">+ Add product</button>
        <div id="prodMsg"></div>
      </form>
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Products</div><div class="ph-count">${prods?.length ?? 0}</div></div>
      <div id="publishMsg"></div>
      ${!prods?.length ? `<div class="empty"><div class="empty-ico">📦</div>No products yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Photo</th><th>Name</th><th>Stock</th><th>Creatives</th><th>Landing URL</th><th>Order form</th><th>Currency</th><th>Order value</th><th>Status</th><th>Auto-Post</th><th></th></tr>
        ${prods.map(p => {
          const pc = creativesByProduct[p.id] || [];
          const thumbs = pc.slice(0, 4).map(c => c.asset_type === "video"
            ? `<div title="${c.file_name}" style="width:28px;height:28px;border-radius:5px;background:var(--panel2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:12px;">🎬</div>`
            : `<img src="${c.public_url}" title="${c.file_name}" style="width:28px;height:28px;border-radius:5px;object-fit:cover;border:1px solid var(--border);">`
          ).join("");
          return `<tr>
          <td>${p.product_image_url
            ? `<img src="${p.product_image_url}" title="Product photo" style="width:32px;height:32px;border-radius:6px;object-fit:cover;border:1px solid var(--border);">`
            : `<div style="width:32px;height:32px;border-radius:6px;background:var(--panel2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--muted);">—</div>`}</td>
          <td class="s n">${p.product_name}</td>
          <td class="n">${p.stock_on_hand === null || p.stock_on_hand === undefined
            ? `<span style="color:var(--muted);">untracked</span>`
            : p.stock_on_hand <= 0
              ? `<span class="pill returned">⚠️ Out of stock</span>`
              : p.stock_on_hand <= (p.low_stock_threshold ?? 10)
                ? `<span class="pill returned" title="At or below the ${p.low_stock_threshold ?? 10}-unit alert threshold">⚠️ ${p.stock_on_hand} left</span>`
                : `${p.stock_on_hand}`}</td>
          <td><div style="display:flex;gap:4px;align-items:center;">${thumbs || '<span style="color:var(--muted);font-size:11px;">none yet</span>'}${pc.length > 4 ? `<span style="font-size:11px;color:var(--muted);">+${pc.length - 4}</span>` : ""}</div></td>
          <td class="n" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${p.landing_page_url ? `<a href="${p.landing_page_url}" target="_blank" style="color:var(--accent);text-decoration:none;">${p.landing_page_url}</a>` : `<span style="color:var(--muted);">${p.destination_type === "whatsapp" ? "WhatsApp: " + (p.whatsapp_number || "—") : "—"}</span>`}
          </td>
          <td><button type="button" class="btn btn-g" style="padding:4px 8px;font-size:10px;white-space:nowrap;" onclick="bvOrderLinkModal('${p.id}', '${p.product_name.replace(/'/g, "\\'")}')">🔗 Get link</button></td>
          <td>${p.currency || "NGN"}</td>
          <td>${p.currency === "NGN" || !p.currency ? fN(p.default_order_value_naira) : p.default_order_value_naira}</td>
          <td><span class="pill ${p.is_active ? "active" : "paused"}">${p.is_active ? "active" : "inactive"}</span></td>
          <td>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:var(--text2);">
              <input type="checkbox" class="autoPostToggle" data-pid="${p.id}" ${p.auto_post_enabled ? "checked" : ""}>
              ${p.auto_post_enabled ? "On" : "Off"}
            </label>
          </td>
          <td style="display:flex;gap:6px;">
            <button type="button" class="btn btn-g" style="padding:4px 8px;font-size:10px;" onclick="bvEditProduct('${p.id}')">Edit</button>
            <button type="button" class="btn btn-a" id="publishBtn-${p.id}" style="padding:4px 8px;font-size:10px;" ${pc.filter(c => c.test_status === "untested").length ? "" : "disabled"} onclick="bvPublishProduct('${p.id}', '${p.product_name.replace(/'/g, "\\'")}')">
              ↑ Publish${pc.filter(c => c.test_status === "untested").length ? ` (${pc.filter(c => c.test_status === "untested").length})` : ""}
            </button>
          </td>
        </tr>`;
        }).join("")}
      </table></div>`}
    </div>`;

  window.bvProductsCache = prods || [];
  try { window.bvDraftTiers = []; bvRenderDraftTiers(); } catch (e) { console.error(e); }

  document.getElementById("prodForm").addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("prodMsg");
    const editingId = document.getElementById("p_id").value;
    const fields = {
      product_name: document.getElementById("p_name").value,
      stock_on_hand: document.getElementById("p_stock").value === "" ? null : Number(document.getElementById("p_stock").value),
      low_stock_threshold: Number(document.getElementById("p_stock_threshold").value) || 10,
      landing_page_url: document.getElementById("p_url").value || null,
      default_order_value_naira: Number(document.getElementById("p_val").value) || 19000,
      currency: document.getElementById("p_currency").value,
      destination_type: document.getElementById("p_destination").value,
      whatsapp_number: document.getElementById("p_whatsapp").value || null,
      description: document.getElementById("p_description").value || null,
      benefits: document.getElementById("p_benefits").value || null,
      safety_notes: document.getElementById("p_safety").value || null,
      nafdac_reg_no: document.getElementById("p_nafdac").value || null,
      warmup_message: document.getElementById("p_warmup").value || null,
      order_form_url: document.getElementById("p_order_form_url").value || null,
      bank_name: document.getElementById("p_bank_name").value.trim() || null,
      bank_account_number: document.getElementById("p_bank_acct").value.replace(/\D/g, "") || null,
      bank_account_name: document.getElementById("p_bank_name_on").value.trim() || null,
      payment_note: document.getElementById("p_pay_note").value.trim() || null,
      is_service: document.getElementById("p_is_service").checked,
    };
    try {
      if (editingId) {
        const { error } = await supabaseClient.from('products').update(fields).eq('id', editingId);
        if (error) throw error;
        bvCancelProductEdit();
        await renderProducts(el);
        document.getElementById("prodMsg").innerHTML = `<div class="msg ok">✅ Product updated.</div>`;
      } else {
        const { data, error } = await supabaseClient.from('products').insert({ ...fields, ad_account_id: activeAccountId }).select('id').single();
        if (error) throw error;
        if (window.bvDraftTiers?.length) {
          const rows = window.bvDraftTiers.map((t, i) => ({ product_id: data.id, company_id: window.myProfile.company_id, label: t.label, quantity: t.quantity, price_naira: t.price_naira, badge: t.badge, features: t.features, is_default: !!t.is_default, sort_order: i }));
          const { error: te } = await supabaseClient.from("product_tiers").insert(rows);
          if (te) bvToast(`Product saved, but the offer packages didn't: ${te.message}`);
          window.bvDraftTiers = [];
        }
        await renderProducts(el);
        bvEditProduct(data.id);
        document.getElementById("prodMsg").innerHTML = `<div class="msg ok">✅ Product added — now upload its photo and its creatives below.</div>`;
      }
    } catch(err) {
      msg.innerHTML = `<div class="msg err">❌ ${err.message}</div>`;
    }
  });

  // Gate for ai-auto-launch-tests: a creative only auto-launches if the product
  // it's linked to has this on. Off by default, so nothing posts until you opt in.
  document.querySelectorAll(".autoPostToggle").forEach(cb => {
    cb.addEventListener("change", async e => {
      const pid = e.target.dataset.pid;
      const enabled = e.target.checked;
      e.target.disabled = true;
      try {
        const { error } = await supabaseClient.from('products').update({ auto_post_enabled: enabled }).eq('id', pid);
        if (error) throw error;
        e.target.nextSibling.textContent = enabled ? "On" : "Off";
      } catch (err) {
        alert("Failed to update auto-post: " + err.message);
        e.target.checked = !enabled;
      } finally {
        e.target.disabled = false;
      }
    });
  });
}

function bvEditProduct(id) {
  const p = (window.bvProductsCache || []).find((x) => x.id === id);
  if (!p) return;
  document.getElementById("p_id").value = p.id;
  document.getElementById("p_name").value = p.product_name || "";
  document.getElementById("p_stock").value = p.stock_on_hand ?? "";
  document.getElementById("p_stock_threshold").value = p.low_stock_threshold ?? 10;
  document.getElementById("p_currency").value = p.currency || "NGN";
  document.getElementById("p_val").value = p.default_order_value_naira || 19000;
  document.getElementById("p_url").value = p.landing_page_url || "";
  document.getElementById("p_destination").value = p.destination_type || "website";
  document.getElementById("p_whatsapp").value = p.whatsapp_number || "";
  document.getElementById("p_description").value = p.description || "";
  document.getElementById("p_benefits").value = p.benefits || "";
  document.getElementById("p_safety").value = p.safety_notes || "";
  document.getElementById("p_nafdac").value = p.nafdac_reg_no || "";
  document.getElementById("p_warmup").value = p.warmup_message || "";
  document.getElementById("p_order_form_url").value = p.order_form_url || "";
  document.getElementById("p_bank_name").value = p.bank_name || "";
  document.getElementById("p_bank_acct").value = p.bank_account_number || "";
  document.getElementById("p_bank_name_on").value = p.bank_account_name || "";
  document.getElementById("p_pay_note").value = p.payment_note || "";
  document.getElementById("p_is_service").checked = !!p.is_service;
  document.getElementById("prodFormTitle").textContent = `Editing: ${p.product_name}`;
  document.getElementById("prodSubmitBtn").textContent = "Save changes";
  document.getElementById("prodCancelEdit").style.display = "";
  document.getElementById("prodImgHint").textContent = p.product_image_url ? "Click to replace the photo." : "Click to upload the product photo. Customers see this on the order page and WhatsApp. It is NOT used in ads.";
  document.getElementById("prodImgPreview").innerHTML = p.product_image_url
    ? `<img src="${p.product_image_url}" style="width:100%;height:100%;object-fit:cover;">`
    : "No image";
  document.getElementById("prodForm").scrollIntoView({ behavior: "smooth", block: "start" });
  bvRenderTiersEditor(p.id);
  bvRenderProductVault(p.id);
}

async function bvUploadTierImage(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  if (file.size > 10 * 1024 * 1024) throw new Error("That image is over 10MB.");
  return window.rvUpload(supabaseClient, "site-media", file);
}

// the product's price follows its default package
async function bvSyncDefaultPrice(productId) {
  const { data } = await supabaseClient.from("product_tiers").select("price_naira").eq("product_id", productId).eq("is_default", true).maybeSingle();
  if (!data || !(Number(data.price_naira) > 0)) return;
  await supabaseClient.from("products").update({ default_order_value_naira: Number(data.price_naira) }).eq("id", productId);
  const el = document.getElementById("p_val"); if (el && document.getElementById("p_id").value === productId) el.value = data.price_naira;
}

// Packages for a product that isn't saved yet: kept here, written when the product is saved.
window.bvDraftTiers = [];
function bvRenderDraftTiers() {
  const list = document.getElementById("tiersList"); if (!list) return;
  const t = window.bvDraftTiers, inp = "font-size:12px;padding:8px 10px;";
  list.innerHTML = `
    ${t.length ? `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">${t.map((x, i) => `
      <div style="display:flex;align-items:center;gap:8px;background:var(--panel2);border:1px solid ${x.is_default ? "var(--accent)" : "var(--border)"};border-radius:8px;padding:7px 10px;font-size:12px;">
        <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;"><input type="radio" name="draftDef" data-i="${i}" ${x.is_default ? "checked" : ""}> Default</label>
        <div style="flex:1;"><b>${escH(x.label)}</b> — ${x.quantity} pc${x.quantity > 1 ? "s" : ""} — ${fN(x.price_naira)}${x.badge ? ` <span class="pill">${escH(x.badge)}</span>` : ""}</div>
        <button type="button" class="btn btn-g draftRm" data-i="${i}" style="padding:3px 8px;font-size:10px;color:var(--danger);">Remove</button>
      </div>`).join("")}</div>` : `<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">No offer packages yet. Add the first one below. You can add pictures and more details after saving the product.</div>`}
    <div class="fg"><div class="field"><label style="font-size:10.5px;">Label</label><input id="d_label" placeholder="e.g. 3-piece bundle" style="${inp}"></div>
    <div class="field"><label style="font-size:10.5px;">Pieces</label><input id="d_qty" type="number" min="1" value="1" style="${inp}"></div></div>
    <div class="fg" style="margin-top:7px;"><div class="field"><label style="font-size:10.5px;">Price</label><input id="d_price" type="number" min="0" style="${inp}"></div>
    <div class="field"><label style="font-size:10.5px;">Badge (optional)</label><input id="d_badge" placeholder="e.g. Best value" style="${inp}"></div></div>
    <div class="field" style="margin-top:7px;"><label style="font-size:10.5px;">What's included (one per line, optional)</label><textarea id="d_feat" rows="2" style="${inp}"></textarea></div>
    <button type="button" class="btn btn-g" id="draftAdd" style="margin-top:7px;padding:6px 12px;font-size:11px;">+ Add offer package</button>`;
  const sync = () => { const d = t.find(x => x.is_default); if (d) document.getElementById("p_val").value = d.price_naira; };
  list.querySelectorAll('input[name="draftDef"]').forEach(r => r.addEventListener("change", () => { t.forEach((x, i) => x.is_default = i === Number(r.dataset.i)); sync(); bvRenderDraftTiers(); }));
  list.querySelectorAll(".draftRm").forEach(b => b.addEventListener("click", () => { const was = t[Number(b.dataset.i)]; t.splice(Number(b.dataset.i), 1); if (was.is_default && t[0]) t[0].is_default = true; sync(); bvRenderDraftTiers(); }));
  document.getElementById("draftAdd").addEventListener("click", () => {
    const label = document.getElementById("d_label").value.trim(), price = Number(document.getElementById("d_price").value);
    if (!label || !price) { bvToast("Label and price are required."); return; }
    t.push({ label, quantity: Number(document.getElementById("d_qty").value) || 1, price_naira: price, badge: document.getElementById("d_badge").value.trim() || null, features: document.getElementById("d_feat").value.trim() || null, is_default: !t.length });
    sync(); bvRenderDraftTiers();
  });
}

async function bvRenderTiersEditor(productId) {
  document.getElementById("tiersHint").style.display = "none";
  const tiers = await sbQuery("product_tiers", `select=*&product_id=eq.${productId}&order=sort_order.asc`).catch(() => []);
  const list = document.getElementById("tiersList");
  const inp = "font-size:12px;padding:8px 10px;";
  list.innerHTML = `
    ${!tiers?.length ? `<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">No package options yet — the order form will show a plain quantity picker. Add your first package below. The one marked <b>Default</b> is pre-selected for customers, and sites built in the website builder fill their package cards from these.</div>` : `
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px;">
      ${tiers.map(t => `
        <div class="tierCard" data-tid="${t.id}" style="background:var(--panel2);border:1px solid ${t.is_default ? "var(--accent)" : "var(--border)"};border-radius:10px;padding:10px;">
          <div style="display:flex;gap:10px;align-items:flex-start;">
            <div style="width:74px;flex:none;">
              <div class="tierThumb" style="width:74px;height:74px;border-radius:8px;border:1px solid var(--border);background:var(--panel);display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:10px;color:var(--muted);text-align:center;">${t.image_url ? `<img src="${escH(t.image_url)}" style="width:100%;height:100%;object-fit:cover;">` : "No picture"}</div>
              <button type="button" class="btn btn-g tierImgBtn" style="width:100%;margin-top:5px;padding:3px 0;font-size:10px;">${t.image_url ? "Replace" : "Upload"}</button>
              ${t.image_url ? `<button type="button" class="btn btn-g tierImgRm" style="width:100%;margin-top:4px;padding:3px 0;font-size:10px;">Remove</button>` : ""}
              <input type="file" accept="image/*" class="tierImgFile" style="display:none;">
            </div>
            <div style="flex:1;min-width:0;">
              <div class="fg"><div class="field"><label style="font-size:10.5px;">Label</label><input class="tf" data-k="label" value="${escH(t.label || "")}" style="${inp}"></div>
              <div class="field"><label style="font-size:10.5px;">Pieces</label><input class="tf" data-k="quantity" type="number" min="1" value="${t.quantity || 1}" style="${inp}"></div></div>
              <div class="fg" style="margin-top:7px;"><div class="field"><label style="font-size:10.5px;">Price</label><input class="tf" data-k="price_naira" type="number" min="0" value="${t.price_naira ?? ""}" style="${inp}"></div>
              <div class="field"><label style="font-size:10.5px;">Badge (optional)</label><input class="tf" data-k="badge" value="${escH(t.badge || "")}" placeholder="e.g. Best value" style="${inp}"></div></div>
            </div>
          </div>
          <div class="field" style="margin-top:7px;"><label style="font-size:10.5px;">What's included (one per line, shown as ticks on the website)</label><textarea class="tf" data-k="features" rows="3" style="${inp}">${escH(t.features || "")}</textarea></div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;cursor:pointer;"><input type="radio" name="tierDefault" class="tierDef" ${t.is_default ? "checked" : ""}> <b>Default</b> <span style="color:var(--muted);">(pre-selected)</span></label>
            <span class="tierSaved" style="font-size:10.5px;color:var(--muted);"></span>
            <button type="button" class="btn btn-g tierDeleteBtn" style="padding:3px 8px;font-size:10px;color:var(--danger);">Remove package</button>
          </div>
        </div>`).join("")}
    </div>`}
    <div style="border-top:1px dashed var(--border);padding-top:10px;">
    <div style="font-size:11px;font-weight:700;margin-bottom:6px;">Add a package</div>
    <div class="fg">
      <div class="field"><label style="font-size:10.5px;">Label</label><input id="t_label" placeholder="e.g. 3-piece bundle" style="${inp}"></div>
      <div class="field"><label style="font-size:10.5px;">Pieces</label><input id="t_qty" type="number" min="1" value="1" style="${inp}"></div>
    </div>
    <div class="fg" style="margin-top:7px;">
      <div class="field"><label style="font-size:10.5px;">Price</label><input id="t_price" type="number" min="0" placeholder="e.g. 40000" style="${inp}"></div>
      <div class="field"><label style="font-size:10.5px;">Badge (optional)</label><input id="t_badge" placeholder="e.g. Best value" style="${inp}"></div>
    </div>
    <div class="field" style="margin-top:7px;"><label style="font-size:10.5px;">What's included (one per line, optional)</label><textarea id="t_features" rows="2" style="${inp}"></textarea></div>
    <button type="button" class="btn btn-g" id="tierAddBtn" style="margin-top:7px;padding:6px 12px;font-size:11px;">+ Add package option</button>
    <div style="font-size:10.5px;color:var(--muted);margin-top:6px;">After adding, you can upload a picture for it and choose the default.</div>
    </div>
  `;

  const flash = (card, txt) => { const el = card.querySelector(".tierSaved"); if (el) { el.textContent = txt; setTimeout(() => { if (el.textContent === txt) el.textContent = ""; }, 1800); } };

  list.querySelectorAll(".tierCard").forEach(card => {
    const tid = card.dataset.tid;
    let timer = 0;
    const save = async () => {
      const f = k => card.querySelector(`.tf[data-k="${k}"]`).value;
      const upd = { label: f("label").trim(), quantity: Number(f("quantity")) || 1, price_naira: Number(f("price_naira")) || 0, badge: f("badge").trim() || null, features: f("features").trim() || null };
      if (!upd.label) { flash(card, "Label is required"); return; }
      const { error } = await supabaseClient.from("product_tiers").update(upd).eq("id", tid);
      flash(card, error ? "Couldn't save" : "Saved ✓");
      if (!error && card.querySelector(".tierDef").checked) bvSyncDefaultPrice(productId);
    };
    card.querySelectorAll(".tf").forEach(el => el.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(save, 700); }));
    card.querySelector(".tierDef").addEventListener("change", async () => {
      await supabaseClient.from("product_tiers").update({ is_default: false }).eq("product_id", productId).eq("is_default", true);
      const { error } = await supabaseClient.from("product_tiers").update({ is_default: true }).eq("id", tid);
      if (error) { bvToast(`Couldn't set the default: ${error.message}`); }
      await bvSyncDefaultPrice(productId);
      bvRenderTiersEditor(productId);
    });
    const file = card.querySelector(".tierImgFile");
    card.querySelector(".tierImgBtn").addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      if (!file.files[0]) return;
      flash(card, "Uploading…");
      try {
        const url = await bvUploadTierImage(file.files[0]);
        const { error } = await supabaseClient.from("product_tiers").update({ image_url: url }).eq("id", tid);
        if (error) throw error;
        bvRenderTiersEditor(productId);
      } catch (err) { flash(card, "Upload failed"); bvToast(`Couldn't upload: ${err.message || err}`); }
    });
    const rm = card.querySelector(".tierImgRm");
    if (rm) rm.addEventListener("click", async () => { await supabaseClient.from("product_tiers").update({ image_url: null }).eq("id", tid); bvRenderTiersEditor(productId); });
    card.querySelector(".tierDeleteBtn").addEventListener("click", async () => {
      if (!confirm("Remove this package?")) return;
      const wasDef = card.querySelector(".tierDef").checked;
      await supabaseClient.from("product_tiers").delete().eq("id", tid);
      if (wasDef) { const first = tiers.find(x => x.id !== tid); if (first) { await supabaseClient.from("product_tiers").update({ is_default: true }).eq("id", first.id); await bvSyncDefaultPrice(productId); } }
      bvRenderTiersEditor(productId);
    });
  });

  document.getElementById("tierAddBtn").addEventListener("click", async () => {
    const label = document.getElementById("t_label").value.trim();
    const quantity = Number(document.getElementById("t_qty").value) || 1;
    const price_naira = Number(document.getElementById("t_price").value);
    const badge = document.getElementById("t_badge").value.trim() || null;
    const features = document.getElementById("t_features").value.trim() || null;
    if (!label || !price_naira) { bvToast("Label and price are required."); return; }
    const { error } = await supabaseClient.from("product_tiers").insert({
      product_id: productId, company_id: window.myProfile.company_id, label, quantity, price_naira, badge, features,
      is_default: !(tiers?.length), sort_order: (tiers?.length ?? 0),
    });
    if (error) { bvToast(`Couldn't add it: ${error.message}`); return; }
    if (!(tiers?.length)) await bvSyncDefaultPrice(productId);
    bvRenderTiersEditor(productId);
  });
}