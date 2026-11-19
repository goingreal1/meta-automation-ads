// ── Carousel builder (Product Vault → "Create carousel") ─────────────────────────────────────────────────────────────
// A carousel is ONE creative with 2-10 picture cards. You choose the pictures, put them in swipe order, give every card its
// own headline + description, and save. Backend: ads-manager add_carousel / update_carousel.
(function () {
  const CSS = `
  .cr-list{display:grid;gap:8px;margin:10px 0}
  .cr-card{display:flex;gap:8px;align-items:flex-start;background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:8px}
  .cr-card.cr-over{outline:2px dashed var(--accent)}
  .cr-n{width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;flex:none;margin-top:2px}
  .cr-img{width:64px;height:64px;border-radius:10px;object-fit:cover;flex:none;background:var(--panel)}
  .cr-f{flex:1;min-width:0;display:grid;gap:5px}.cr-f input{font-size:12.5px;padding:6px 9px}
  .cr-ctl{display:flex;flex-direction:column;gap:3px;flex:none}
  .cr-ctl button{width:28px;height:26px;border-radius:8px;border:1px solid var(--border);background:var(--panel);color:var(--text);cursor:pointer;font-size:13px;line-height:1}
  .cr-ctl button:disabled{opacity:.35;cursor:default}
  .cr-grip{cursor:grab;color:var(--muted);font-size:16px;letter-spacing:-2px;align-self:center;user-select:none}
  .cr-tray{display:flex;gap:6px;overflow-x:auto;padding:4px 0}.cr-tray img{width:54px;height:54px;border-radius:9px;object-fit:cover;flex:none;cursor:pointer;border:2px solid transparent}.cr-tray img:hover{border-color:var(--accent)}
  .cr-add{border:1.5px dashed var(--accent);color:var(--accent);border-radius:14px;padding:11px;text-align:center;font-weight:600;font-size:13px;cursor:pointer}
  .cr-prev{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px 0}.cr-prev>div{flex:none;width:150px;scroll-snap-align:start;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--panel2);font-size:12px}
  .cr-prev img{width:100%;height:130px;object-fit:cover;display:block}.cr-prev b{display:block;padding:6px 8px 0}.cr-prev small{display:block;padding:0 8px 8px;color:var(--muted)}
  .cr-badge{display:inline-block;background:var(--accent);color:#fff;border-radius:99px;padding:1px 9px;font-size:11px;font-weight:700}
  .cr-strip{display:flex;gap:4px}.cr-strip img{width:34px;height:34px;border-radius:7px;object-fit:cover}`;
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);

  window.bvCarouselSheet = async function (productId, editId, after) {
    const p = (window.bvProductsCache || []).find(x => x.id === productId) || {};
    const acct = p.ad_account_id || (typeof activeAccountId !== "undefined" ? activeAccountId : null);
    let lib = [];
    try { lib = await sbQuery("creative_assets", `select=id,public_url,display_name,file_name&product_id=eq.${productId}&asset_type=eq.image&order=uploaded_at.desc&limit=60`); } catch (e) {}
    const S = { name: "", primary_text: p.ad_primary_text || "", feed_only: true, cards: [] };
    if (editId) {
      const r = (await sbQuery("creative_assets", `select=id,file_name,primary_text,carousel_cards,feed_only,ad_account_id&id=eq.${editId}`).catch(() => []))?.[0];
      if (!r) return bvToast("Couldn't load that carousel.", "err");
      S.name = r.file_name || ""; S.primary_text = r.primary_text || ""; S.feed_only = r.feed_only === true; S.cards = (r.carousel_cards || []).map(k => ({ ...k }));
    }
    const id = "bvCarousel";
    const draw = () => {
      const old = document.getElementById(id); const keepScroll = old?.querySelector(".bv-modal")?.scrollTop || 0;
      const ov = bvOpenSheet(id, `
        <button class="bv-modal-close" data-sheet-close>✕</button>
        <h3 style="margin:0 0 4px">${editId ? "Edit carousel" : "Create carousel"}</h3>
        <div style="color:var(--text2);font-size:12.5px;margin-bottom:10px">2 to 10 pictures. They swipe in the order below, card 1 first. Drag ⋮⋮ or use ↑ ↓ to reorder.</div>
        <div class="field"><label>Name</label><input class="cat-in" id="crN" value="${escH(S.name)}" placeholder="e.g. Hair story, 3 steps"></div>
        <div class="field" style="margin-top:8px"><label>Text above the carousel (one text for the whole ad)</label><textarea class="cat-in" id="crP" rows="2" placeholder="The hook that makes people swipe">${escH(S.primary_text)}</textarea></div>
        <div class="cr-list" id="crList">${S.cards.map((k, i) => `
          <div class="cr-card" draggable="true" data-i="${i}">
            <div class="cr-grip" title="Drag to reorder">⋮⋮</div><div class="cr-n">${i + 1}</div>
            <img class="cr-img" src="${escH(k.image_url)}" alt="">
            <div class="cr-f"><input class="cat-in" data-k="headline" data-i="${i}" value="${escH(k.headline || "")}" maxlength="80" placeholder="Card headline">
              <input class="cat-in" data-k="description" data-i="${i}" value="${escH(k.description || "")}" maxlength="150" placeholder="Card description (optional)"></div>
            <div class="cr-ctl"><button type="button" data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" data-dn="${i}" ${i === S.cards.length - 1 ? "disabled" : ""}>↓</button><button type="button" data-rm="${i}" title="Remove">✕</button></div>
          </div>`).join("") || `<div style="color:var(--muted);font-size:12.5px;padding:8px 0">No cards yet. Add pictures below.</div>`}</div>
        ${S.cards.length < 10 ? `<div class="cr-add" id="crUp">+ Upload pictures</div><input type="file" id="crFiles" accept="image/jpeg,image/png" multiple style="display:none">` : ""}
        ${lib.length && S.cards.length < 10 ? `<div style="font-size:11.5px;color:var(--muted);margin:8px 0 2px">Or tap one of this product's pictures to add it:</div><div class="cr-tray">${lib.map(a => `<img src="${escH(a.public_url)}" data-lib="${escH(a.public_url)}" alt="">`).join("")}</div>` : ""}
        ${S.cards.length >= 2 ? `<div style="font-size:12px;font-weight:600;margin-top:12px">Preview (swipe)</div><div class="cr-prev">${S.cards.map(k => `<div><img src="${escH(k.image_url)}" alt=""><b>${escH(k.headline || "Headline")}</b><small>${escH(k.description || "")}</small></div>`).join("")}</div>` : ""}
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:12.5px"><input type="checkbox" id="crFeed" ${S.feed_only ? "checked" : ""} style="margin-top:2px"><span><b>Feed only</b><br><span style="color:var(--muted)">Run only in Facebook and Instagram Feed. Meta often crops or refuses carousels in Reels and Stories.</span></span></label>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button type="button" class="btn btn-g" id="crX">Cancel</button><button type="button" class="btn btn-a" id="crOk">${editId ? "Save changes" : "Save carousel"}</button></div>`, 640);
      if (keepScroll) ov.querySelector(".bv-modal").scrollTop = keepScroll;
      const sync = () => { S.name = ov.querySelector("#crN").value; S.primary_text = ov.querySelector("#crP").value; S.feed_only = ov.querySelector("#crFeed").checked; };
      const close = () => bvCloseSheet(id);
      ov.querySelector("[data-sheet-close]").onclick = close; ov.querySelector("#crX").onclick = close;
      ov.querySelectorAll(".cr-f input").forEach(el => el.addEventListener("input", () => { S.cards[+el.dataset.i][el.dataset.k] = el.value; }));
      const move = (a, b) => { sync(); if (b < 0 || b >= S.cards.length || a === b) return; const [x] = S.cards.splice(a, 1); S.cards.splice(b, 0, x); draw(); };
      ov.querySelectorAll("[data-up]").forEach(b => b.onclick = () => move(+b.dataset.up, +b.dataset.up - 1));
      ov.querySelectorAll("[data-dn]").forEach(b => b.onclick = () => move(+b.dataset.dn, +b.dataset.dn + 1));
      ov.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { sync(); S.cards.splice(+b.dataset.rm, 1); draw(); });
      let dragFrom = -1;
      ov.querySelectorAll(".cr-card").forEach(c => {
        c.addEventListener("dragstart", e => { dragFrom = +c.dataset.i; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(dragFrom)); } catch (x) {} });
        c.addEventListener("dragover", e => { e.preventDefault(); c.classList.add("cr-over"); });
        c.addEventListener("dragleave", () => c.classList.remove("cr-over"));
        c.addEventListener("drop", e => { e.preventDefault(); move(dragFrom, +c.dataset.i); });
      });
      ov.querySelectorAll("[data-lib]").forEach(im => im.onclick = () => { sync(); if (S.cards.length < 10) { S.cards.push({ image_url: im.dataset.lib, headline: "", description: "" }); draw(); } });
      const up = ov.querySelector("#crUp"), fi = ov.querySelector("#crFiles");
      if (up) up.onclick = () => fi.click();
      if (fi) fi.onchange = async () => {
        sync(); const files = Array.from(fi.files || []).slice(0, 10 - S.cards.length); if (!files.length) return;
        for (let n = 0; n < files.length; n++) {
          up.textContent = `Uploading ${n + 1} of ${files.length}…`;
          const fd = new FormData(); fd.append("file", files[n]); fd.append("product_id", productId); fd.append("ad_account_id", acct); fd.append("uploaded_by", "dashboard");
          const r = await bvCreUpload(fd);
          if (r?.error || !r?.asset?.public_url) { bvToast(`"${files[n].name}": ${r?.error || "upload failed"}`, "err"); continue; }
          S.cards.push({ image_url: r.asset.public_url, headline: "", description: "" });
        }
        draw();
      };
      ov.querySelector("#crOk").onclick = async () => {
        sync();
        if (S.cards.length < 2) return bvToast("Add at least 2 pictures.", "err");
        const btn = ov.querySelector("#crOk"); btn.disabled = true; btn.textContent = "Saving…";
        const body = { ad_account_id: acct, name: S.name.trim() || `Carousel (${S.cards.length} cards)`, primary_text: S.primary_text.trim(), feed_only: S.feed_only, cards: S.cards.map(k => ({ image_url: k.image_url, headline: (k.headline || "").trim(), description: (k.description || "").trim(), link: k.link || undefined })) };
        const r = editId ? await sbFn("ads-manager", { action: "update_carousel", creative_id: editId, ...body }) : await sbFn("ads-manager", { action: "add_carousel", product_id: productId, ...body });
        if (r?.error || r?.ok === false) { btn.disabled = false; btn.textContent = editId ? "Save changes" : "Save carousel"; return bvToast("Couldn't save: " + (r.error || "unknown"), "err"); }
        bvToast("Carousel saved."); close(); if (after) after(); else bvRenderProductVault(productId);
      };
    };
    draw();
  };
})();
