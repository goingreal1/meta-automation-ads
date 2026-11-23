// Revora dashboard, part 12 of 23: PRODUCT CREATIVE VAULT (inside the product editor) · TAB: SHOP


// ── PRODUCT CREATIVE VAULT (inside the product editor) ──────────────────────
const BV_CTAS = [["SHOP_NOW", "Shop Now"], ["ORDER_NOW", "Order Now"], ["LEARN_MORE", "Learn More"], ["SIGN_UP", "Sign Up"], ["GET_OFFER", "Get Offer"], ["CONTACT_US", "Contact Us"]];
async function bvRenderProductVault(productId) {
  const box = document.getElementById("vaultBox"); if (!box) return;
  const p = (window.bvProductsCache || []).find(x => x.id === productId) || {};
  const assets = await sbQuery("creative_assets", `select=id,file_name,display_name,public_url,asset_type,primary_text,headline,description,cta_type,test_status,carousel_cards,feed_only,meta_post_id&product_id=eq.${productId}&or=(uploaded_by.is.null,uploaded_by.neq.ai_chat)&order=uploaded_at.desc`).catch(() => []);
  const complete = assets.filter(a => (a.primary_text || "").trim() && (a.headline || "").trim()).length;
  const hasLink = !!(p.landing_page_url || (p.destination_type === "whatsapp" && p.whatsapp_number));
  const ready = assets.length >= 5 && complete >= 5 && hasLink;
  const chk = (ok, txt) => `<div style="display:flex;gap:8px;align-items:center;font-size:12px;${ok ? "" : "color:var(--muted);"}"><span style="width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;background:${ok ? "var(--accent)" : "var(--panel)"};color:${ok ? "#04281e" : "var(--muted)"};border:1px solid ${ok ? "var(--accent)" : "var(--border)"};">${ok ? "✓" : ""}</span>${txt}</div>`;
  const inp = "font-size:12px;padding:7px 9px;";
  box.innerHTML = `
    <div style="border:1px solid ${ready ? "var(--accent)" : "var(--border)"};border-radius:12px;padding:12px;background:var(--panel2);margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <b style="font-size:13px;">${ready ? "✅ Ready for AI auto-launch" : "AI auto-launch readiness"}</b>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;${ready ? "" : "opacity:.55;"}"><input type="checkbox" id="vaultAuto" ${p.auto_post_enabled ? "checked" : ""} ${ready ? "" : "disabled"}> Let the AI propose launches from this vault</label>
      </div>
      <div style="display:grid;gap:5px;margin-top:9px;">
        ${chk(assets.length >= 5, `At least 5 creatives <span style="color:var(--muted);">(${assets.length} uploaded)</span>`)}
        ${chk(complete >= 5, `Each with a headline and primary text <span style="color:var(--muted);">(${complete} complete)</span>`)}
        ${chk(hasLink, p.destination_type === "whatsapp" ? "WhatsApp number set" : "Website link set (Landing page URL under More details)")}
      </div>
      <div style="font-size:10.5px;color:var(--muted);margin-top:8px;line-height:1.5;">When it's ready and the switch is on, the AI messages you in the AI chat (and sends a notification) with the creatives it wants to launch. Nothing goes live until you tap <b>Launch them</b>. It does the same right after it pauses an ad that was costing too much, to replace it.</div>
    </div>
    <div class="dz" id="vaultDrop" style="padding:16px;cursor:pointer;" onclick="document.getElementById('vaultFiles').click()">
      <div class="dz-ico">⬆️</div><div class="dz-txt">Upload AD creatives for this product (images or videos)</div>
      <div class="dz-hint" id="vaultUpState">Then give each one its headline, primary text and description below.</div>
      <input type="file" id="vaultFiles" accept="video/*,image/*" multiple style="display:none;">
    </div>
    <button type="button" class="btn btn-g" id="vaultCarousel" style="margin-top:8px;width:100%;">🎠 Create carousel (2 to 10 swipeable pictures)</button>
    <div style="display:grid;gap:10px;margin-top:12px;">
      ${assets.map(a => a.asset_type === "carousel" ? `
        <div class="vaultCard" data-aid="${a.id}" data-kind="carousel" style="border:1px solid var(--accent);border-radius:10px;padding:10px;background:var(--panel2);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b style="font-size:13px;">${escH(a.display_name || a.file_name || "Carousel")}</b><span class="cr-badge">Carousel · ${(a.carousel_cards || []).length} cards${a.feed_only ? " · Feed only" : ""}</span></div>
          <div class="cr-strip" style="margin:8px 0;">${(a.carousel_cards || []).map(k => `<img src="${escH(k.image_url)}" alt="">`).join("")}</div>
          <div style="font-size:11.5px;color:var(--muted);">${escH((a.primary_text || "").slice(0, 140)) || "No text above the carousel yet."}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;"><button type="button" class="btn btn-g vCarEdit" style="padding:5px 12px;font-size:12px;">Edit cards</button><button type="button" class="btn btn-g vDel" style="padding:5px 12px;font-size:12px;color:var(--red,#d33);">Delete</button></div>
        </div>` : a.asset_type === "post" ? `
        <div class="vaultCard" data-aid="${a.id}" data-kind="post" style="border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel2);display:flex;gap:10px;align-items:center;">
          ${a.public_url && /^https/.test(a.public_url) && !/facebook\.com/.test(a.public_url) ? `<img src="${escH(a.public_url)}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;" alt="">` : ""}
          <div style="flex:1;min-width:0;font-size:12px;"><span class="cr-badge">Page post</span><div style="margin-top:4px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(a.primary_text || a.meta_post_id || "")}</div></div>
          <button type="button" class="btn btn-g vDel" style="padding:5px 12px;font-size:12px;">Delete</button>
        </div>` : `
        <div class="vaultCard" data-aid="${a.id}" style="border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel2);display:grid;grid-template-columns:96px 1fr;gap:10px;">
          <div>
            <div data-view="${escH(a.public_url)}" data-type="${a.asset_type === "video" ? "video" : "image"}" style="position:relative;cursor:zoom-in;width:96px;height:96px;border-radius:8px;overflow:hidden;background:#101214;border:1px solid var(--border);">${a.asset_type === "video" ? `<video src="${escH(a.public_url)}#t=0.1" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:contain;"></video><span class="bv-play">▶</span>` : `<img src="${escH(a.public_url)}" style="width:100%;height:100%;object-fit:contain;">`}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escH(a.file_name || "")}">${escH(a.display_name || a.file_name || "")}</div>
            <span class="pill ${(a.test_status || "untested").replace(/ /g, "_")}" style="margin-top:3px;">${(a.test_status || "untested").replace(/_/g, " ")}</span>
          </div>
          <div style="min-width:0;">
            <div class="field" style="margin-bottom:6px;"><label style="font-size:10.5px;">Name</label><input class="vf" data-k="display_name" value="${escH(a.display_name || "")}" placeholder="${escH(a.file_name || "Name this creative")}" style="${inp}"></div>
            <div class="fg"><div class="field"><label style="font-size:10.5px;">Headline</label><input class="vf" data-k="headline" value="${escH(a.headline || "")}" placeholder="Short bold hook" style="${inp}"></div>
            <div class="field"><label style="font-size:10.5px;">Button</label><select class="vf" data-k="cta_type" style="${inp}">${BV_CTAS.map(c => `<option value="${c[0]}" ${(a.cta_type || "SHOP_NOW") === c[0] ? "selected" : ""}>${c[1]}</option>`).join("")}</select></div></div>
            <div class="field" style="margin-top:6px;"><label style="font-size:10.5px;">Primary text (ad copy)</label><textarea class="vf" data-k="primary_text" rows="3" style="${inp}">${escH(a.primary_text || "")}</textarea></div>
            <div class="field" style="margin-top:6px;"><label style="font-size:10.5px;">Description</label><input class="vf" data-k="description" value="${escH(a.description || "")}" placeholder="Supporting line under the headline" style="${inp}"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;"><span class="vSaved" style="font-size:10.5px;color:var(--muted);"></span><button type="button" class="btn btn-g vPost" style="padding:3px 8px;font-size:10px;margin-right:6px;">Post to page</button><button type="button" class="btn btn-g vEdit" style="padding:3px 8px;font-size:10px;margin-right:6px;">Edit</button><button type="button" class="btn btn-g vDel" style="padding:3px 8px;font-size:10px;color:var(--danger);">Delete creative</button></div>
          </div>
        </div>`).join("") || `<div style="font-size:11.5px;color:var(--muted);">No creatives yet.</div>`}
    </div>`;

  const auto = document.getElementById("vaultAuto");
  if (auto) auto.addEventListener("change", async () => { await supabaseClient.from("products").update({ auto_post_enabled: auto.checked }).eq("id", productId); p.auto_post_enabled = auto.checked; bvToast(auto.checked ? "AI auto-launch is on for this product." : "AI auto-launch is off for this product."); });

  box.querySelectorAll(".vaultCard").forEach(card => {
    const aid = card.dataset.aid; let timer = 0;
    const flash = t => { const el = card.querySelector(".vSaved"); el.textContent = t; setTimeout(() => { if (el.textContent === t) el.textContent = ""; }, 1800); };
    const save = async () => {
      const upd = {}; card.querySelectorAll(".vf").forEach(el => upd[el.dataset.k] = el.value.trim() || (el.dataset.k === "cta_type" ? "SHOP_NOW" : null));
      const { error } = await supabaseClient.from("creative_assets").update(upd).eq("id", aid);
      if (!error && upd.display_name !== undefined) { /* name is shared by every copy of this file */ }
      flash(error ? "Couldn't save" : "Saved ✓");
      if (!error) { clearTimeout(box._rt); box._rt = setTimeout(() => bvRenderProductVault(productId), 1200); }
    };
    card.querySelectorAll(".vf").forEach(el => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => { clearTimeout(timer); timer = setTimeout(save, 700); }));
    if (card.dataset.kind) { card.querySelector(".vCarEdit")?.addEventListener("click", () => bvCarouselSheet(productId, aid)); card.querySelector(".vDel").addEventListener("click", async () => { if (await bvDeleteCreative(aid)) bvRenderProductVault(productId); }); return; }
    card.querySelector(".vEdit").addEventListener("click", () => bvCreativeEdit(aid, () => bvRenderProductVault(productId)));
    card.querySelector(".vPost")?.addEventListener("click", () => bvPostToPage(aid, card));
    card.querySelector(".vDel").addEventListener("click", async () => {
      if (!confirm("Delete this creative and its file?")) return;
      if (await bvDeleteCreative(aid)) bvRenderProductVault(productId);
    });
  });

  document.getElementById("vaultCarousel")?.addEventListener("click", () => bvCarouselSheet(productId));
  const fileInput = document.getElementById("vaultFiles"), state = document.getElementById("vaultUpState");
  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []); if (!files.length) return;
    const acct = p.ad_account_id || activeAccountId;
    const meta = await bvCreativeUploadSheet(files, { primary_text: p.ad_primary_text, headline: p.ad_headline, description: p.ad_description, cta_type: p.ad_cta_type });
    if (!meta) { fileInput.value = ""; return; }
    let done = 0, failed = 0;
    for (const f of files) {
      state.textContent = `Uploading ${done + 1} of ${files.length}…`;
      const fd = new FormData();
      fd.append("file", f); fd.append("product_id", productId); fd.append("ad_account_id", acct); fd.append("uploaded_by", "dashboard");
      fd.append("primary_text", meta.primary_text); fd.append("headline", meta.headline); fd.append("description", meta.description); fd.append("cta_type", meta.cta_type);
      if (meta.name) fd.append("creative_name", files.length > 1 ? `${meta.name} ${done + failed + 1}` : meta.name);
      try {
        const res = await bvCreFetch(fd);
        const r = await res.json(); if (r.error) throw new Error(r.error); done++;
      } catch (err) { failed++; bvToast(`"${f.name}": ${err.message || err}`); }
    }
    bvToast(`${done} creative${done === 1 ? "" : "s"} added${failed ? `, ${failed} failed` : ""}.`);
    bvRenderProductVault(productId);
  });
}

function bvCancelProductEdit() {
  const form = document.getElementById("prodForm");
  if (!form) return;
  form.reset();
  document.getElementById("p_id").value = "";
  document.getElementById("prodFormTitle").textContent = "Add product";
  document.getElementById("prodSubmitBtn").textContent = "+ Add product";
  document.getElementById("prodCancelEdit").style.display = "none";
  document.getElementById("prodImgHint").textContent = "Save the package first, then come back to upload its photo.";
  document.getElementById("prodImgPreview").innerHTML = "—";
  window.bvDraftTiers = []; bvRenderDraftTiers();
  const vb = document.getElementById("vaultBox"); if (vb) vb.innerHTML = '<div style="font-size:11.5px;color:var(--muted);padding:12px;border:1px dashed var(--border);border-radius:10px;">Save the product first, then upload its creatives here.</div>';
}

// Creates the real campaign/ad sets/ads on Meta for this product's pending
// creatives right now (PAUSED, honoring each creative's scheduled_for) --
// independent of the Auto-Post toggle, which only controls unattended batch
// runs. This is what actually makes something appear in Ads Manager; nothing
// does until this (or the nightly batch) runs.
async function bvPublishProduct(productId, productName) {
  const btn = document.getElementById(`publishBtn-${productId}`);
  const msg = document.getElementById("publishMsg");
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Publishing…';
  msg.innerHTML = "";
  try {
    await bvWalletGate();
    const res = await fetch(`${SUPA_URL}/functions/v1/ai-auto-launch-tests`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionData?.access_token || ANON}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ product_id: productId }),
    });
    const r = await res.json();
    if (r.error) throw new Error(r.error);
    if (r.message === "No pending creatives to launch") {
      msg.innerHTML = `<div class="msg err">No untested creatives for ${productName} to publish.</div>`;
    } else {
      msg.innerHTML = `<div class="msg ok">✅ ${productName}: ${r.creatives ?? "creative(s)"} published to Meta as PAUSED (${r.ad_sets ?? "?"} ad set(s) total). Check Meta Ads Manager, or reply APPROVE on WhatsApp to go live at the scheduled time.</div>`;
    }
    setTimeout(render, 1500);
  } catch (err) {
    msg.innerHTML = `<div class="msg err">❌ ${err.message}</div>`;
    btn.disabled = false;
    btn.innerHTML = "↑ Publish";
  }
}

async function bvUploadProductImage(inputEl) {
  const file = inputEl.files?.[0];
  const hint = document.getElementById("prodImgHint");
  const msg = document.getElementById("prodMsg");
  if (!file) return;
  const productId = document.getElementById("p_id").value;
  if (!productId) {
    msg.innerHTML = `<div class="msg err">❌ Save the product first (below), then come back up here to upload its photo.</div>`;
    inputEl.value = "";
    return;
  }
  const preview = document.getElementById("prodImgPreview");
  const btn = document.getElementById("prodImgBtn");
  btn.disabled = true;
  hint.textContent = "Uploading…";
  msg.innerHTML = "";
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("product_id", productId);
    const res = await fetch(`${SUPA_URL}/functions/v1/upload-product-image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionData?.access_token || ANON}` },
      body: fd,
    });
    const r = await res.json();
    if (r.error) throw new Error(r.error);
    preview.innerHTML = `<img src="${r.product_image_url}" style="width:100%;height:100%;object-fit:cover;">`;
    hint.textContent = "Click to replace the photo.";
    msg.innerHTML = `<div class="msg ok">✅ Photo uploaded.</div>`;
    const cached = (window.bvProductsCache || []).find(p => p.id === productId);
    if (cached) cached.product_image_url = r.product_image_url;
  } catch (err) {
    hint.textContent = "Click to upload the product photo. Customers see this on the order page and WhatsApp. It is NOT used in ads.";
    msg.innerHTML = `<div class="msg err">❌ ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    inputEl.value = "";
  }
}

// Generates the shareable order-form link for a product (order.html, hosted
// as a sibling of this dashboard file) -- what each media buyer puts on their
// own sales page instead of hand-building a checkout form. Picking a buyer
// tags every order that comes through the link with them automatically
// (server-side, via receive-order -> media_buyers), so ROAS attribution
// doesn't depend on the buyer remembering to rename ad sets correctly.
async function bvOrderLinkModal(productId, productName) {
  const overlay = document.createElement("div");
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const baseUrl = location.origin + location.pathname.replace(/[^/]*$/, "") + "order.html";

  let buyers = [];
  try { buyers = await sbQuery("media_buyers", "select=id,code,name&order=code.asc") || []; } catch {}

  overlay.innerHTML = `<div class="bv-modal">
    <button class="bv-modal-close" onclick="this.closest('.bv-overlay').remove()">✕</button>
    <h3 style="margin:0 0 4px;">${escH(productName)} — order form link</h3>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:14px;">Share this on the buyer's sales page (as the "Order Now" button link, or embedded in an iframe). It shows the product, collects the customer's delivery details, and creates a real order here -- no separate checkout page to build.</div>
    <div class="field"><label>Attribute orders to</label>
      <select id="olBuyer">
        <option value="">No buyer (unattributed)</option>
        ${buyers.map(b => `<option value="${escH(b.code)}">${escH(b.name)} [${escH(b.code)}]</option>`).join("")}
      </select>
    </div>
    <div class="field" style="margin-top:10px;"><label>Link</label><input id="olLink" readonly value="${baseUrl}?product=${productId}"></div>
    <button type="button" class="btn btn-a btn-full" style="margin-top:12px;" id="olCopyBtn">Copy link</button>
    <div style="font-size:10.5px;color:var(--muted);margin-top:10px;">Meta click IDs (fbclid, ad set) are attached automatically if the buyer forwards them in their own ad link -- add <code>&asid={{adset.id}}&crid={{ad.id}}</code> style params if their ad platform supports link macros.</div>
  </div>`;
  document.body.appendChild(overlay);

  const updateLink = () => {
    const buyer = document.getElementById("olBuyer").value;
    document.getElementById("olLink").value = `${baseUrl}?product=${productId}${buyer ? `&buyer=${encodeURIComponent(buyer)}` : ""}`;
  };
  document.getElementById("olBuyer").addEventListener("change", updateLink);
  document.getElementById("olCopyBtn").addEventListener("click", async () => {
    const btn = document.getElementById("olCopyBtn");
    try {
      await navigator.clipboard.writeText(document.getElementById("olLink").value);
      btn.textContent = "Copied!";
      setTimeout(() => { if (btn) btn.textContent = "Copy link"; }, 1500);
    } catch {
      document.getElementById("olLink").select();
      btn.textContent = "Select-all — Ctrl/Cmd+C to copy";
    }
  });
}

// ── TAB: SHOP ─────────────────────────────────────────────────────────────────
// A Shopify-style view of the same products the Products tab manages, focused
// on what a Meta ad needs: click a product to set its ad image, primary
// text/headline/CTA, and which page the ad should send people to. Product
// basics (price, stock, package tiers) stay edited in the Products tab --
// this never duplicates that form, just adds the ad-creative layer on top.
async function renderShop(el) {
  const prods = await sbQuery("products", "order=created_at.desc");
  window.bvShopProductsCache = prods || [];
  const readyCount = (prods || []).filter(p => p.ad_primary_text && p.ad_headline).length;

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Shop</div></div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:16px;">${prods?.length ?? 0} products &middot; ${readyCount} with ad copy ready. Click a product to set what its Meta ad says. Price, stock, and package options stay in the <a href="#" onclick="event.preventDefault(); activeTab='products'; document.querySelector('[data-tab=products]').click();" style="color:var(--accent);">Products</a> tab.</div>
    ${!prods?.length ? `<div class="empty"><div class="empty-ico">🛍️</div>No products yet — add one in the Products tab first.</div>` : `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;">
      ${prods.map(p => {
        const ready = !!(p.ad_primary_text && p.ad_headline);
        return `
        <div onclick="bvOpenShopPanel('${p.id}')" style="background:var(--panel);border:1.5px solid var(--border);border-radius:12px;overflow:hidden;cursor:pointer;transition:border-color .15s;">
          <div style="height:130px;background:var(--panel2);display:flex;align-items:center;justify-content:center;overflow:hidden;">
            ${p.product_image_url ? `<img src="${escH(p.product_image_url)}" style="width:100%;height:100%;object-fit:cover;">` : `<span style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.05em;text-transform:uppercase;">No photo</span>`}
          </div>
          <div style="padding:12px;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
              <div style="font-size:13px;font-weight:600;line-height:1.3;">${escH(p.product_name)}</div>
              <span class="pill ${p.is_active ? "active" : "paused"}" style="flex:none;">${p.is_active ? "active" : "inactive"}</span>
            </div>
            <div style="font-size:15px;font-weight:600;color:var(--accent);margin-top:4px;">${p.currency === "NGN" || !p.currency ? fN(p.default_order_value_naira) : (escH(p.currency) + " " + p.default_order_value_naira)}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:11px;font-weight:600;color:${ready ? "var(--accent)" : "#9a6a26"};">
              <span style="width:7px;height:7px;border-radius:50%;background:${ready ? "var(--accent)" : "#c98a3a"};"></span>
              ${ready ? "Ad ready" : "Needs ad copy"}
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>`}
  `;
}

function bvOpenShopPanel(productId) {
  const p = (window.bvShopProductsCache || []).find(x => x.id === productId);
  if (!p) return;
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  const linkTarget = p.ad_link_target || "product";
  const ctaType = p.ad_cta_type || "SHOP_NOW";
  const isWhatsapp = p.destination_type === "whatsapp";

  overlay.innerHTML = `
    <div class="bv-modal" style="max-width:580px;">
      <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:4px;">
        <div style="width:44px;height:44px;flex:none;border-radius:8px;background:var(--panel2);border:1px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--muted);">
          ${p.product_image_url ? `<img src="${escH(p.product_image_url)}" style="width:100%;height:100%;object-fit:cover;">` : "—"}
        </div>
        <div>
          <div class="ph-title" style="margin:0;">${escH(p.product_name)}</div>
          <div style="font-size:11.5px;color:var(--muted);">${p.currency === "NGN" || !p.currency ? fN(p.default_order_value_naira) : (escH(p.currency) + " " + p.default_order_value_naira)} &middot; <a href="#" onclick="event.preventDefault(); bvCloseModal(); activeTab='products'; document.querySelector('[data-tab=products]').click(); setTimeout(() => bvEditProduct('${p.id}'), 200);" style="color:var(--accent);">Edit product details</a></div>
        </div>
      </div>

      <div style="font-size:11px;color:var(--muted);background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-top:10px;">
        ${isWhatsapp
          ? (p.whatsapp_number ? `Ads click through to WhatsApp: <b style="color:var(--text2);">${escH(p.whatsapp_number)}</b>` : `⚠️ WhatsApp destination, but no number set — add one in <a href="#" onclick="event.preventDefault(); bvCloseModal(); activeTab='products'; document.querySelector('[data-tab=products]').click(); setTimeout(() => bvEditProduct('${p.id}'), 200);" style="color:var(--accent);">Products</a>.`)
          : (p.landing_page_url ? `Ads click through to: <b style="color:var(--text2);">${escH(p.landing_page_url)}</b>` : `⚠️ Website destination, but no landing page URL set — add one in <a href="#" onclick="event.preventDefault(); bvCloseModal(); activeTab='products'; document.querySelector('[data-tab=products]').click(); setTimeout(() => bvEditProduct('${p.id}'), 200);" style="color:var(--accent);">Products</a>.`)}
      </div>

      <div style="display:flex;align-items:center;gap:7px;margin:16px 0 10px;padding-top:12px;border-top:1px dashed var(--border);">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M3 11l18-7-7 18-3-7-8-4z"/></svg>
        <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);">Meta Ads creative</div>
      </div>

      <div class="field">
        <label>Ad image or video <span style="font-weight:400;color:var(--muted);">(falls back to the product photo above if left blank)</span></label>
        <div style="display:flex;align-items:center;gap:10px;margin-top:2px;">
          <div id="shopAdImgPreview" style="width:40px;height:40px;border-radius:7px;background:var(--panel2);border:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:9px;color:var(--muted);">
            ${p.ad_image_url ? `<img src="${escH(p.ad_image_url)}" style="width:100%;height:100%;object-fit:cover;">` : "—"}
          </div>
          <input type="file" id="shopAdImgFile" accept="image/jpeg,image/png" style="display:none;" onchange="bvUploadShopAdImage(this, '${p.id}')">
          <button type="button" class="btn btn-g" id="shopAdImgBtn" style="padding:5px 10px;font-size:11px;" onclick="document.getElementById('shopAdImgFile').click()">Upload</button>
        </div>
      </div>

      <div class="field" style="margin-top:12px;">
        <label style="display:flex;align-items:center;justify-content:space-between;">
          <span>Primary text</span>
          <button type="button" class="btn btn-g" id="shopDraftBtn" style="padding:3px 9px;font-size:10.5px;" onclick="bvDraftAdCopy('${p.id}')">✨ Draft with AI</button>
        </label>
        <textarea id="shopAdPrimary" rows="3" placeholder="The main caption people see above the image...">${escH(p.ad_primary_text || "")}</textarea>
      </div>

      <div class="fg" style="margin-top:12px;">
        <div class="field"><label>Headline</label><input id="shopAdHeadline" placeholder="Short bold line" value="${escH(p.ad_headline || "")}"></div>
        <div class="field"><label>CTA button</label>
          <select id="shopAdCta">
            <option value="SHOP_NOW" ${ctaType === "SHOP_NOW" ? "selected" : ""}>Shop Now</option>
            <option value="LEARN_MORE" ${ctaType === "LEARN_MORE" ? "selected" : ""}>Learn More</option>
            <option value="ORDER_NOW" ${ctaType === "ORDER_NOW" ? "selected" : ""}>Order Now</option>
          </select>
        </div>
      </div>

      <div class="field" style="margin-top:12px;">
        <label>Description <span style="font-weight:400;color:var(--muted);">(link ads only)</span></label>
        <input id="shopAdDescription" placeholder="Small secondary line under the headline" value="${escH(p.ad_description || "")}">
      </div>

      <div class="field" style="margin-top:14px;">
        <label>Where should this ad send people?</label>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px;">
          <div class="shopLinkOpt" data-val="product" onclick="bvSetShopLinkTarget('product')" style="display:flex;align-items:center;gap:10px;border:1.5px solid ${linkTarget === "product" ? "var(--accent)" : "var(--border)"};background:${linkTarget === "product" ? "var(--accentBg)" : "var(--panel)"};border-radius:9px;padding:10px 12px;cursor:pointer;">
            <div style="width:15px;height:15px;border-radius:50%;border:1.5px solid ${linkTarget === "product" ? "var(--accent)" : "var(--border)"};display:flex;align-items:center;justify-content:center;flex:none;"><span style="width:7px;height:7px;border-radius:50%;background:${linkTarget === "product" ? "var(--accent)" : "transparent"};"></span></div>
            <div><div style="font-size:12.5px;font-weight:600;">This product's page</div><div style="font-size:11px;color:var(--muted);">order.html for just this product</div></div>
          </div>
          <div class="shopLinkOpt" data-val="shop" onclick="bvSetShopLinkTarget('shop')" style="display:flex;align-items:center;gap:10px;border:1.5px solid ${linkTarget === "shop" ? "var(--accent)" : "var(--border)"};background:${linkTarget === "shop" ? "var(--accentBg)" : "var(--panel)"};border-radius:9px;padding:10px 12px;cursor:pointer;">
            <div style="width:15px;height:15px;border-radius:50%;border:1.5px solid ${linkTarget === "shop" ? "var(--accent)" : "var(--border)"};display:flex;align-items:center;justify-content:center;flex:none;"><span style="width:7px;height:7px;border-radius:50%;background:${linkTarget === "shop" ? "var(--accent)" : "transparent"};"></span></div>
            <div><div style="font-size:12.5px;font-weight:600;">The full shop</div><div style="font-size:11px;color:var(--muted);">Coming soon — sends them to browse the whole catalogue instead</div></div>
          </div>
        </div>
        <input type="hidden" id="shopAdLinkTarget" value="${linkTarget}">
      </div>

      ${isWhatsapp ? `
      <div class="field" style="margin-top:14px;background:var(--accentBg);border:1px solid var(--accentBdr);border-radius:9px;padding:11px 13px;">
        <label>WhatsApp opening message <span style="font-weight:400;color:var(--muted);">(this product is set to Click-to-WhatsApp in the Products tab)</span></label>
        <textarea id="shopAdWhatsapp" rows="2" placeholder="Hi! Interested in ${escH(p.product_name)}?">${escH(p.whatsapp_welcome_message || "")}</textarea>
        <div style="font-size:10.5px;color:var(--muted);margin-top:5px;">Leave blank to use the default "Hi! Interested in ${escH(p.product_name)}?" message. Their reply lands in your Conversations tab.</div>
      </div>` : ""}

      <button type="button" class="btn btn-a btn-full" style="margin-top:16px;" id="shopSaveBtn" onclick="bvSaveShopCreative('${p.id}')">Save</button>
      <div id="shopPanelMsg"></div>
    </div>`;
  document.body.appendChild(overlay);
}

function bvSetShopLinkTarget(val) {
  document.getElementById("shopAdLinkTarget").value = val;
  document.querySelectorAll(".shopLinkOpt").forEach(elOpt => {
    const active = elOpt.dataset.val === val;
    elOpt.style.borderColor = active ? "var(--accent)" : "var(--border)";
    elOpt.style.background = active ? "var(--accentBg)" : "var(--panel)";
    const dot = elOpt.querySelector("div > span");
    const ring = elOpt.querySelector("div");
    if (ring) ring.style.borderColor = active ? "var(--accent)" : "var(--border)";
    if (dot) dot.style.background = active ? "var(--accent)" : "transparent";
  });
}

async function bvDraftAdCopy(productId) {
  const btn = document.getElementById("shopDraftBtn");
  const msg = document.getElementById("shopPanelMsg");
  btn.disabled = true;
  btn.textContent = "Drafting…";
  try {
    const r = await sbFn("draft-ad-copy", { product_id: productId });
    if (r.error) throw new Error(r.error);
    document.getElementById("shopAdPrimary").value = r.primary_text || "";
    document.getElementById("shopAdHeadline").value = r.headline || "";
    document.getElementById("shopAdDescription").value = r.description || "";
    msg.innerHTML = `<div class="msg ok">✨ Drafted — review and edit before saving.</div>`;
  } catch (err) {
    msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Draft with AI";
  }
}

async function bvUploadShopAdImage(inputEl, productId) {
  const file = inputEl.files?.[0];
  if (!file) return;
  const preview = document.getElementById("shopAdImgPreview");
  const btn = document.getElementById("shopAdImgBtn");
  const msg = document.getElementById("shopPanelMsg");
  btn.disabled = true;
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("product_id", productId);
    fd.append("field", "ad_image_url");
    const res = await fetch(`${SUPA_URL}/functions/v1/upload-product-image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionData?.access_token || ANON}` },
      body: fd,
    });
    const r = await res.json();
    if (r.error) throw new Error(r.error);
    preview.innerHTML = `<img src="${r.ad_image_url}" style="width:100%;height:100%;object-fit:cover;">`;
    const cached = (window.bvShopProductsCache || []).find(p => p.id === productId);
    if (cached) cached.ad_image_url = r.ad_image_url;
  } catch (err) {
    msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    inputEl.value = "";
  }
}

async function bvSaveShopCreative(productId) {
  const btn = document.getElementById("shopSaveBtn");
  const msg = document.getElementById("shopPanelMsg");
  btn.disabled = true;
  btn.textContent = "Saving…";
  const fields = {
    ad_primary_text: document.getElementById("shopAdPrimary").value || null,
    ad_headline: document.getElementById("shopAdHeadline").value || null,
    ad_description: document.getElementById("shopAdDescription").value || null,
    ad_cta_type: document.getElementById("shopAdCta").value,
    ad_link_target: document.getElementById("shopAdLinkTarget").value,
  };
  const waField = document.getElementById("shopAdWhatsapp");
  if (waField) fields.whatsapp_welcome_message = waField.value || null;
  try {
    const { error } = await supabaseClient.from("products").update(fields).eq("id", productId);
    if (error) throw error;
    bvCloseModal();
    bvToast("Saved.");
    render();
  } catch (err) {
    msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`;
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

// ── Post a creative on the person's own Facebook Page (a normal post, not an ad). Always previewed and confirmed first. ──
async function bvPostToPage(aid, card) {
  const id = "bvPostSheet";
  const pre = await sbFn("page-tools", { action: "post_preview", creative_id: aid, ad_account_id: undefined });
  if (!pre || pre.error) return bvToast(pre?.error || "Couldn't check the Page for this creative.", "err");
  const pl = await sbFn("page-tools", { action: "my_pages", ad_account_id: undefined }).catch(() => null);
  const pages = (pl && pl.pages) || [];
  const typed = card?.querySelector('[data-k="primary_text"]')?.value?.trim();
  const media = pre.kind === "video" ? `<video src="${escH(pre.url)}#t=0.1" muted playsinline style="width:100%;max-height:240px;border-radius:10px;background:#000;object-fit:contain;"></video>` : `<img src="${escH(pre.url)}" alt="" style="width:100%;max-height:260px;border-radius:10px;object-fit:contain;background:var(--panel2);">`;
  const ov = bvOpenSheet(id, `<div style="font-weight:600;font-size:16px;margin-bottom:4px;">Post to your Page</div>
    <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px;">This publishes a normal post on the Page you pick, right now. It is not an ad. Everyone who follows the Page can see it.</div>
    <div class="field" style="margin-bottom:10px;"><label style="font-size:11px;">Page</label>${pages.length > 1 ? `<select id="bvPostPage" style="width:100%;">${pages.map(x => `<option value="${escH(x.page_id)}" ${x.page_id === pre.page_id ? "selected" : ""}>${escH(x.name || x.page_id)}${x.ad_account ? " · " + escH(x.ad_account) : ""}</option>`).join("")}</select>` : `<div style="font-weight:600;font-size:14px;">${escH(pre.page_name || "Your Page")}</div>`}</div>
    ${media}
    <div class="field" style="margin-top:10px;"><label style="font-size:11px;">Caption</label><textarea id="bvPostCap" rows="6" style="width:100%;">${escH(typed || pre.caption || "")}</textarea></div>
    <div id="bvPostRes" style="font-size:12.5px;margin-top:8px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button type="button" class="btn btn-g" data-sheet-close>Cancel</button><button type="button" class="btn btn-p" id="bvPostGo">Post now</button></div>`, 520);
  ov.querySelector("[data-sheet-close]").onclick = () => bvCloseSheet(id);
  const go = ov.querySelector("#bvPostGo"), res = ov.querySelector("#bvPostRes");
  go.onclick = async () => {
    const message = ov.querySelector("#bvPostCap").value.trim();
    if (!message) { res.style.color = "var(--danger,#d33)"; res.textContent = "Write a caption first."; return; }
    go.disabled = true; go.textContent = "Posting…"; res.textContent = "";
    const pick = ov.querySelector("#bvPostPage")?.value;
    const r = await sbFn("page-tools", { action: "post_creative", creative_id: aid, confirmed: true, message, ...(pick ? { page_id: pick } : {}) });
    if (r?.ok) { res.style.color = "var(--green,#1a9a4a)"; res.innerHTML = `Posted ✓ ${r.link ? `<a href="${escH(r.link)}" target="_blank" rel="noopener">Open the post</a>` : ""}`; go.style.display = "none"; ov.querySelector("[data-sheet-close]").textContent = "Close"; }
    else { go.disabled = false; go.textContent = "Try again"; res.style.color = "var(--danger,#d33)"; res.textContent = r?.error || "Meta did not accept the post."; }
  };
}
