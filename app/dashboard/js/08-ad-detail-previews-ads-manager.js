// Revora dashboard, part 08 of 23: LAUNCHED AD DETAIL/EDIT MODAL · CREATIVE DETAIL MODAL · PREVIEW: how it looks in each Meta placement (Meta's own preview) · FIT THE WHOLE IMAGE · TAB: CAMPAIGNS · ADS MANAGER (live from Meta)

// ── LAUNCHED AD DETAIL/EDIT MODAL ────────────────────────────────────────────
// Click any ad (or any "Copy N" under it) in the Campaigns > Ads list to view
// and edit its copy. Editing here updates only our own `creatives` record --
// it does NOT push the change to the already-live Meta ad (ad creative text
// is fixed once an ad is created; Meta has no "edit the text" endpoint for a
// running ad). Said plainly in the modal so this never reads as more capable
// than it is -- to actually change what's live, duplicate this ad with new
// copy in the builder and pause the old one.
function bvCloseLaunchedAdModal() {
  document.getElementById("bvLaunchedAdOverlay")?.remove();
}

async function bvShowLaunchedAdDetail(creativeId) {
  const overlay = document.createElement("div");
  overlay.id = "bvLaunchedAdOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseLaunchedAdModal(); };
  overlay.innerHTML = `<div class="bv-modal"><div style="text-align:center;padding:30px;color:var(--muted);font-size:12px;">Loading…</div></div>`;
  document.body.appendChild(overlay);

  let rows;
  try {
    rows = await sbQuery("creatives", `id=eq.${creativeId}&select=*`);
  } catch (err) {
    document.querySelector("#bvLaunchedAdOverlay .bv-modal").innerHTML = `
      <button class="bv-modal-close" onclick="bvCloseLaunchedAdModal()">✕</button>
      <div class="msg err">❌ Failed to load: ${err.message}</div>`;
    return;
  }
  const a = rows?.[0];
  if (!a) {
    document.querySelector("#bvLaunchedAdOverlay .bv-modal").innerHTML = `<div class="msg err">Ad not found.</div>`;
    return;
  }

  document.querySelector("#bvLaunchedAdOverlay .bv-modal").innerHTML = `
    <button class="bv-modal-close" onclick="bvCloseLaunchedAdModal()">✕</button>
    <div class="ph-title" style="margin-bottom:2px;">${escH(a.creative_name || "Ad")}</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">Meta ad creative ${a.meta_ad_id ? `<span style="font-family:'JetBrains Mono',monospace;">${escH(a.meta_ad_id)}</span>` : "—"} · <span class="pill ${(a.status||"").toLowerCase()}">${escH(a.status || "—")}</span></div>

    <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:16px;">
      ${a.video_id
        ? `<div style="width:90px;height:90px;border-radius:8px;border:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:24px;background:var(--panel2);">🎬</div>`
        : a.image_url ? `<img src="${a.image_url}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex-shrink:0;">` : ""}
      <div style="font-size:11px;color:var(--muted);line-height:1.5;">
        ⚠ Editing below updates <b style="color:var(--text2);">our records only</b> — it does <b style="color:var(--text2);">not</b> change the ad already live on Meta (ad creative text can't be edited after launch). To change what's actually showing, duplicate this ad with new copy in the builder and pause this one.
      </div>
    </div>

    <div class="field"><label>Primary text</label><textarea id="ladPrimary" rows="3">${escH(a.primary_text || "")}</textarea></div>
    <div class="fg" style="margin-top:10px;">
      <div class="field"><label>Headline</label><input id="ladHeadline" value="${escH(a.headline || "")}"></div>
      <div class="field"><label>Description</label><input id="ladDesc" value="${escH(a.description || "")}"></div>
    </div>
    <div class="field" style="margin-top:10px;"><label>CTA</label>
      <select id="ladCta">
        <option value="SHOP_NOW" ${a.cta_type === "SHOP_NOW" ? "selected" : ""}>Shop Now</option>
        <option value="LEARN_MORE" ${a.cta_type === "LEARN_MORE" ? "selected" : ""}>Learn More</option>
        <option value="ORDER_NOW" ${a.cta_type === "ORDER_NOW" ? "selected" : ""}>Order Now</option>
        <option value="WHATSAPP_MESSAGE" ${a.cta_type === "WHATSAPP_MESSAGE" ? "selected" : ""}>Send Message (WhatsApp)</option>
      </select>
    </div>
    <div id="ladMsg" style="margin-top:10px;"></div>
    <button type="button" class="btn btn-a btn-full" style="margin-top:14px;" onclick="bvSaveLaunchedAdDetail('${creativeId}')">💾 Save (our records only)</button>
  `;
}

async function bvSaveLaunchedAdDetail(creativeId) {
  const msg = document.getElementById("ladMsg");
  const btn = document.querySelector("#bvLaunchedAdOverlay .btn-a");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const { error } = await supabaseClient.from("creatives").update({
      primary_text: document.getElementById("ladPrimary").value.trim(),
      headline: document.getElementById("ladHeadline").value.trim(),
      description: document.getElementById("ladDesc").value.trim(),
      cta_type: document.getElementById("ladCta").value,
    }).eq("id", creativeId);
    if (error) throw error;
    msg.innerHTML = `<div class="msg ok">✅ Saved.</div>`;
    btn.disabled = false; btn.textContent = "💾 Save (our records only)";
  } catch (err) {
    msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`;
    btn.disabled = false; btn.textContent = "💾 Save (our records only)";
  }
}

// ── CREATIVE DETAIL MODAL ────────────────────────────────────────────────────
// Click any row in "All creatives" for a quick-open detail view (not a new
// tab): full ad copy, campaign name/budget type/schedule, and every ad set
// configured for it. If it's already been launched, also pulls the real
// Meta ad set status/IDs via the pending_approvals record that links this
// creative to its campaign/ad sets.
function bvCloseModal() {
  document.getElementById("bvModalOverlay")?.remove();
}

async function bvShowCreativeDetail(creativeId) {
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal"><div style="text-align:center;padding:30px;color:var(--muted);font-size:12px;">Loading…</div></div>`;
  document.body.appendChild(overlay);

  let creatives, configs, approvals;
  try {
    [creatives, configs, approvals] = await Promise.all([
      sbQuery("creative_assets", `id=eq.${creativeId}&select=*,products(product_name,destination_type,whatsapp_number,landing_page_url)`),
      sbQuery("ad_set_configs", `creative_id=eq.${creativeId}&select=*&order=sort_order.asc`),
      sbQuery("pending_approvals", `creative_asset_id=eq.${creativeId}&select=*&order=requested_at.desc&limit=1`),
    ]);
  } catch (err) {
    document.querySelector("#bvModalOverlay .bv-modal").innerHTML = `
      <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
      <div class="msg err">❌ Failed to load: ${err.message}</div>`;
    return;
  }
  const a = creatives?.[0];
  if (!a) {
    document.querySelector("#bvModalOverlay .bv-modal").innerHTML = `<div class="msg err">Creative not found.</div>`;
    return;
  }

  let launchedAdSets = null;
  let campaignRow = null;
  const approval = approvals?.[0];
  if (approval?.proposed_action?.ad_set_ids?.length) {
    const ids = approval.proposed_action.ad_set_ids.join(",");
    const [adSets, campaigns] = await Promise.all([
      sbQuery("ad_sets", `meta_adset_id=in.(${ids})&select=*`),
      approval.proposed_action.meta_campaign_id
        ? sbQuery("campaigns", `meta_campaign_id=eq.${approval.proposed_action.meta_campaign_id}&select=*`)
        : Promise.resolve([]),
    ]);
    launchedAdSets = adSets;
    campaignRow = campaigns?.[0];
  }

  const destNote = a.products?.destination_type === "whatsapp"
    ? `WhatsApp (${a.products?.whatsapp_number || "—"})`
    : `Website (${a.products?.landing_page_url || "—"})`;

  const configCount = (configs || []).length;
  const configCountLabel = configCount
    ? `${configCount} ad set${configCount === 1 ? "" : "s"} will launch${configCount > 1 ? ` — 1 original + ${configCount - 1} duplicate${configCount - 1 === 1 ? "" : "s"}` : " (original only, no duplicates)"}`
    : "No ad sets configured yet — this creative can't publish until you add at least one.";

  const configRows = (configs || []).map((c, i) => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-top:${i === 0 ? 0 : 6}px;">
      <strong style="font-size:12px;">${c.label}${i === 0 ? " (original)" : " (duplicate)"}</strong>
      <dl class="bv-dl" style="margin-top:6px;">
        <dt>Budget</dt><dd>₦${Number(c.budget_naira).toLocaleString()}/day</dd>
        <dt>Age</dt><dd>${c.age_min}–${c.age_max}</dd>
        <dt>Gender</dt><dd>${c.gender}</dd>
        <dt>Geography</dt><dd>${c.geo_type === "states" ? [...(c.states || []), ...(c.cities || []).map(x => `${x.name} (+${x.radius || 17} km)`)].join(", ") || "Nationwide (NG)" : "Nationwide (NG)"}</dd>
        ${(c.interests || []).length || (c.behaviors || []).length ? `<dt>Audience</dt><dd>${[...(c.audience_presets || []).map(k => BV_PRESETS[k]?.label || k), ...(c.interests || []).filter(x => !(c.audience_presets || []).some(k => BV_PRESETS[k]?.interests.some(y => y.id === x.id))).map(x => x.name)].join(", ")}</dd>` : ""}
      </dl>
    </div>`).join("") || `<div class="msg err" style="margin-top:6px;">No ad sets configured — Publish will have nothing to launch.</div>`;

  const launchedRows = launchedAdSets?.length ? `
    <div class="ph-title" style="margin-top:16px;margin-bottom:8px;">Live on Meta</div>
    ${campaignRow ? `<div style="font-size:12px;margin-bottom:8px;"><b>Campaign:</b> ${campaignRow.campaign_name} <span class="pill ${campaignRow.status}">${campaignRow.status}</span></div>` : ""}
    ${launchedAdSets.map((s, i) => `
      <div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-top:${i === 0 ? 0 : 6}px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:12px;">${s.adset_name}</strong>
          <span class="pill ${s.status}">${s.status}</span>
        </div>
        <dl class="bv-dl" style="margin-top:6px;">
          <dt>Meta ad set ID</dt><dd style="font-family:'JetBrains Mono',monospace;">${s.meta_adset_id}</dd>
          <dt>Budget</dt><dd>${s.budget_naira ? "₦" + Number(s.budget_naira).toLocaleString() + "/day" : "shared (CBO)"}</dd>
        </dl>
      </div>`).join("")}` : "";

  document.querySelector("#bvModalOverlay .bv-modal").innerHTML = `
    <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
    <div class="ph-title" style="margin-bottom:2px;">${a.file_name}</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${a.products?.product_name ?? "—"} · uploaded ${ago(a.uploaded_at)}</div>

    <dl class="bv-dl">
      <dt>Status</dt><dd><span class="pill ${(a.test_status ?? "untested").replace(/ /g,"_")}">${(a.test_status ?? "untested").replace(/_/g," ")}</span></dd>
      <dt>Campaign name</dt><dd>${a.campaign_name || "(auto-generated at launch)"}</dd>
      <dt>Budget type</dt><dd>${(a.budget_type || "abo").toUpperCase()}</dd>
      <dt>Destination</dt><dd>${destNote}</dd>
      <dt>Mechanism</dt><dd>${(a.mechanism ?? "—").replace(/_/g," ")}</dd>
      <dt>Format</dt><dd>${(a.format ?? "—").replace(/_/g," ")}</dd>
      <dt>Scheduled for</dt><dd>${a.scheduled_for ? new Date(a.scheduled_for).toLocaleString() : "next batch run"}</dd>
      <dt>Campaign end</dt><dd>${a.campaign_end_date ? new Date(a.campaign_end_date).toLocaleString() : "runs until paused/killed"}</dd>
    </dl>

    <div class="ph-title" style="margin-top:16px;margin-bottom:6px;">Ad <span style="font-weight:400;color:var(--muted);font-size:11px;">(shared by every ad set below — Meta creates one ad creative, reused under each)</span></div>
    <div style="display:flex;gap:12px;align-items:flex-start;">
      ${a.asset_type === "video"
        ? `<video src="${a.public_url}" controls style="width:110px;border-radius:8px;border:1px solid var(--border);flex-shrink:0;"></video>`
        : `<img src="${a.public_url}" style="width:110px;height:110px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex-shrink:0;">`}
      <dl class="bv-dl" style="flex:1;">
        <dt>Headline</dt><dd>${a.headline || "—"}</dd>
        <dt>Description</dt><dd>${a.description || "—"}</dd>
        <dt>Primary text</dt><dd>${a.primary_text || "—"}</dd>
        <dt>CTA</dt><dd>${a.products?.destination_type === "whatsapp" ? "Send Message (WhatsApp, automatic)" : (a.cta_type ?? "—")}</dd>
      </dl>
    </div>

    <div class="ph-title" style="margin-top:16px;margin-bottom:2px;">Ad sets</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">${configCountLabel}</div>
    ${configRows}

    ${launchedRows}
  `;
}

// ── PREVIEW: how it looks in each Meta placement (Meta's own preview) ──────────
const BV_PREVIEW_LABELS = { MOBILE_FEED_STANDARD: "📱 Mobile feed", DESKTOP_FEED_STANDARD: "💻 Desktop feed", INSTAGRAM_STANDARD: "Instagram feed", INSTAGRAM_REELS: "Reels", INSTAGRAM_STORY: "Stories" };
function bvShowPreviewSheet(title, previews, note, ctx) {
  window._bvPrevCtx = ctx || null;
  const ok = previews.filter(p => p.src);
  const want = window.matchMedia("(max-width: 760px)").matches ? "MOBILE_FEED_STANDARD" : "DESKTOP_FEED_STANDARD";
  const first = ok.find(p => p.format === want) || ok[0];
  bvOpenSheet("bvPreviewOverlay", `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('bvPreviewOverlay')">✕</button>
    <div class="ph-title" style="margin-bottom:2px;">Preview</div>
    <div style="font-size:12px;color:var(--muted);">${escH(title || "")}</div>
    <div class="bv-prevtabs">${previews.map(p => `<button type="button" class="bv-prevtab${first && p.format === first.format ? " on" : ""}" data-f="${p.format}" ${p.src ? "" : "disabled style=\"opacity:.45\""} onclick="bvPreviewTab('${p.format}')">${BV_PREVIEW_LABELS[p.format] || p.format}</button>`).join("")}</div>
    <div class="bv-prevframe" id="bvPrevFrame"></div>
    <div class="bv-prevtools" id="bvPrevTools"></div>
    <div style="font-size:11.5px;color:var(--muted);margin-top:8px;">This is Meta's own preview of the ad in that spot — what people will really see.${note ? " " + note : ""}</div>`, 560);
  window._bvPreviews = previews;
  if (first) bvPreviewTab(first.format);
  else document.getElementById("bvPrevFrame").innerHTML = `<div class="msg err" style="display:block;">${escH(previews[0]?.error || "Meta could not make a preview.")}</div>`;
}
function bvPreviewTab(f) {
  document.querySelectorAll("#bvPreviewOverlay .bv-prevtab").forEach(b => b.classList.toggle("on", b.dataset.f === f));
  const p = (window._bvPreviews || []).find(x => x.format === f);
  const box = document.getElementById("bvPrevFrame"); if (!box) return;
  if (!p?.src) { box.innerHTML = `<div class="msg err" style="display:block;">${escH(p?.error || "No preview.")}</div>`; return; }
  window._bvPrevFmt = f;
  const avail = Math.max(240, (box.clientWidth || 340) - 4), sc = Math.min(1, avail / p.width);
  box.innerHTML = `<div class="bv-prevwrap" style="width:${Math.round(p.width * sc)}px;height:${Math.round(p.height * sc)}px;">
    <div class="bv-prevload"><span class="spin"></span> Loading Meta's preview…</div>
    <iframe src="${escH(p.src)}" width="${p.width}" height="${p.height}" scrolling="no" frameborder="0" referrerpolicy="no-referrer" onload="this.previousElementSibling.style.display='none'" style="transform:scale(${sc});transform-origin:0 0;border:0;background:#fff;position:relative;"></iframe></div>`;
  const tools = document.getElementById("bvPrevTools");
  if (tools) tools.innerHTML = `<span>Image missing or blank?</span>
    <a href="#" onclick="bvPreviewTab('${f}');return false;">↻ Reload</a>
    <a href="${escH(p.src)}" target="_blank" rel="noopener">Open Meta's preview in a new tab</a>
    ${window._bvPrevCtx?.image ? `<a href="#" onclick="bvQuickPreview('${f}');return false;">Quick preview</a>` : ""}`;
}
// Our own drawing of the ad in a placement (used when Meta's preview iframe will not paint on a phone browser)
function bvQuickPreview(f) {
  const c = window._bvPrevCtx || {}, box = document.getElementById("bvPrevFrame"); if (!box || !c.image) return;
  const img = escH(c.image), cta = escH(c.cta || "Chat on WhatsApp"), msg = escH((c.message || "").slice(0, 120));
  const tall = f === "INSTAGRAM_REELS" || f === "INSTAGRAM_STORY";
  box.innerHTML = tall
    ? `<div class="bv-qp-tall"><div class="bv-qp-bg" style="background-image:url('${img}')"></div><img src="${img}" alt=""><div class="bv-qp-top">${f === "INSTAGRAM_REELS" ? "Reels" : "Sponsored"}</div><div class="bv-qp-cta">${cta}</div></div>`
    : `<div class="bv-qp-feed"><div class="bv-qp-hd">Sponsored</div><img src="${img}" alt=""><div class="bv-qp-cb"><b>${cta}</b> ›</div><div class="bv-qp-tx">${msg}</div></div>`;
  const tools = document.getElementById("bvPrevTools");
  if (tools) tools.innerHTML = `<span>This is our own drawing, not Meta's.</span><a href="#" onclick="bvPreviewTab('${f}');return false;">Show Meta's preview again</a>`;
}

async function bvUploadFitted(file) {
  return window.rvUpload(supabaseClient, "ad-fit", file);
}

async function bvOpenAdPreview() {
  if (!activeAccountId) { bvToast("Pick an ad account first."); return; }
  const g = id => document.getElementById(id);
  const formFile = g("f_file")?.files?.[0];
  const staged = bvStagedOf(bvAdTabUid)[0]?.c;
  const file = formFile || staged?.file;
  if (!file) { bvToast("Add your image first, then preview it."); return; }
  if (!file.type.startsWith("image/")) { bvToast("Video previews appear after launch: Campaigns → Ads → 👁 Preview."); return; }
  const src = formFile ? { message: g("f_primary")?.value, headline: g("f_headline")?.value, description: g("f_desc")?.value } : { message: staged.primary_text, headline: staged.headline, description: staged.description };
  bvOpenSheet("bvPreviewOverlay", `<button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('bvPreviewOverlay')">✕</button><div class="ph-title">Preview</div><div class="empty" style="padding:30px;"><span class="spin"></span> Asking Meta to draw your ad…</div>`, 560);
  try {
    const url = file.__previewUrl || await bvUploadFitted(file);
    file.__previewUrl = url;
    const r = await amCall({ action: "ad_preview", ad_account_id: activeAccountId, spec: {
      image_url: url, ...src, destination: document.querySelector('input[name="f_destination"]:checked')?.value || "whatsapp",
      link: g("f_landing_url")?.value || "", cta: g("f_cta")?.value || "SHOP_NOW" } });
    if (!r?.ok) throw new Error(r?.error || "Meta could not draw a preview.");
    bvShowPreviewSheet(g("f_campaign_name")?.value || "", r.previews, bvFitState && file.name === bvFitState.fitted.name ? "Your image was fitted so Meta shows all of it." : "", { image: url, message: src.message, cta: (document.querySelector('input[name="f_destination"]:checked')?.value || "whatsapp") === "whatsapp" ? "Chat on WhatsApp" : "Learn more" });
  } catch (e) {
    bvCloseSheet("bvPreviewOverlay");
    bvToast("Preview failed: " + e.message);
  }
}

async function amPreviewAd(adId) {
  const ad = amAdById(adId);
  bvOpenSheet("bvPreviewOverlay", `<button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('bvPreviewOverlay')">✕</button><div class="ph-title">Preview</div><div class="empty" style="padding:30px;"><span class="spin"></span> Asking Meta to draw this ad…</div>`, 560);
  const r = await amCall({ action: "ad_preview", ad_account_id: activeAccountId, ad_id: adId });
  if (!r?.ok) { bvCloseSheet("bvPreviewOverlay"); bvToast("Preview failed: " + (r?.error || "Meta could not draw it.")); return; }
  bvShowPreviewSheet(ad?.name || "", r.previews, "", ad?.picture_url ? { image: ad.picture_url, message: ad.primary_text || "", cta: "Chat on WhatsApp" } : null);
}

// Fix an already-live ad whose image Meta is cropping: re-fit the whole picture and point the ad at it.
async function amFitImage(adId) {
  const ad = amAdById(adId); if (!ad) return;
  if (!ad.picture_url) { bvToast("This ad isn't a single-image ad, so there is nothing to fit."); return; }
  bvToast("Checking the image…");
  let fitted = null;
  try {
    const blob = await (await fetch(ad.picture_url)).blob();
    fitted = await bvFitImage(new File([blob], "ad-image.jpg", { type: blob.type || "image/jpeg" }));
  } catch { bvToast("Couldn't read this ad's image."); return; }
  if (!fitted) { bvToast("This image already fits Meta's Feed — nothing to fix. Use 👁 Preview to see each placement."); return; }
  const same = am.data.ads.filter(a => a.picture_url === ad.picture_url);
  const scope = same.length > 1 ? (confirm(`${same.length} ads use this same image. Fix all ${same.length}? (Cancel = only this one)`) ? same : [ad]) : [ad];
  try {
    const url = await bvUploadFitted(fitted);
    const r = await amCall({ action: "set_ad_image", ad_account_id: activeAccountId, ad_ids: scope.map(a => a.id), image_url: url });
    if (!r?.results) throw new Error(r?.error || "Meta did not accept it.");
    for (const x of r.results) { const row = amAdById(x.id); if (x.ok && row) { row.picture_url = x.picture_url; row.thumbnail_url = x.picture_url || row.thumbnail_url; } }
    const bad = r.results.filter(x => !x.ok);
    bvToast(bad.length ? `Fixed ${r.results.length - bad.length}, ${bad.length} failed: ${bad[0].error}` : `Fixed on Meta (${r.results.length} ad${r.results.length === 1 ? "" : "s"}). Meta may re-check the ad for a few minutes.`);
    amDraw(); amQuietRefresh();
  } catch (e) { bvToast("Couldn't fix it: " + e.message); }
}

function handleFilePick(input) { if (input.files?.[0]) setFile(input.files[0]); bvRenderBuilderSummary(); }
// ── FIT THE WHOLE IMAGE ──────────────────────────────────────────────────────
// Feed shows images between 4:5 (tall) and 1.91:1 (wide) in full; anything taller or wider is cut by Meta.
// A tall flyer (2:3) would lose its top and bottom, so the picture is placed whole on a 4:5 canvas with a soft
// blurred copy of itself filling the sides. Images already inside the range are left exactly as they are.
let bvFitState = null;
async function bvFitImage(file) {
  if (!file?.type?.startsWith("image/")) return null;
  const bmp = await createImageBitmap(file);
  const r = bmp.width / bmp.height;
  if (r >= 0.8 && r <= 1.91) { bmp.close?.(); return null; }
  const [W, H] = r < 0.8 ? [1080, 1350] : [1200, 628];
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  // soft background: a tiny copy scaled up is a blur that works in every browser
  const t = document.createElement("canvas"); t.width = 24; t.height = Math.max(2, Math.round(24 * H / W));
  const tg = t.getContext("2d"); tg.imageSmoothingQuality = "high";
  const cover = Math.max(t.width / bmp.width, t.height / bmp.height);
  tg.drawImage(bmp, (t.width - bmp.width * cover) / 2, (t.height - bmp.height * cover) / 2, bmp.width * cover, bmp.height * cover);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(t, 0, 0, W, H);
  g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(0, 0, W, H);
  const k = Math.min(W / bmp.width, H / bmp.height), w = bmp.width * k, h = bmp.height * k;
  g.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
  const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.94));
  const out = new File([blob], file.name.replace(/\.[^.]+$/, "") + "-fit.jpg", { type: "image/jpeg" });
  bvFitState = { orig: file, fitted: out, from: `${bmp.width}×${bmp.height}`, to: `${W}×${H}` };
  bmp.close?.();
  return out;
}
function bvShowFitNote() {
  const el = document.getElementById("dzFit"); if (!el) return;
  const cur = document.getElementById("f_file")?.files?.[0];
  const st = bvFitState;
  if (!st || !cur) { el.innerHTML = ""; return; }
  if (cur.name === st.fitted.name) el.innerHTML = `<div class="bv-fitnote">✓ Your image is ${st.from}, taller or wider than Meta shows in Feed, so it was fitted onto a ${st.to === "1080×1350" ? "4:5" : "1.91:1"} canvas — Meta will show <b>all</b> of it, not a cropped piece. <a onclick="bvUseOriginalImage()">Use my original instead</a></div>`;
  else if (cur.name === st.orig.name) el.innerHTML = `<div class="bv-fitnote warn">⚠ Using your original (${st.from}). Meta will crop it in Feed. <a onclick="bvUseFittedImage()">Fit the whole image</a></div>`;
  else el.innerHTML = "";
}
function bvUseOriginalImage() { if (bvFitState) setFile(bvFitState.orig, { original: true }); }
function bvUseFittedImage() { if (bvFitState) setFile(bvFitState.fitted, { original: true }); }

async function setFile(file, opts = {}) {
  if (!opts.original && file.type?.startsWith("image/")) {
    let fitted = null;
    try { fitted = await bvFitImage(file); } catch {}
    if (fitted) file = fitted; else bvFitState = null;
  }
  setFileRaw(file);
  bvShowFitNote();
}
function setFileRaw(file) {
  const dz   = document.getElementById("dropZone");
  const prev = document.getElementById("dzPrev");
  const inp  = document.getElementById("f_file");
  try { const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; } catch {}
  dz.style.borderColor = "var(--accent)";
  dz.style.background  = "var(--accentBg)";
  if (file.type.startsWith("image/")) {
    const r = new FileReader();
    r.onload = e => { prev.innerHTML = `✓ ${file.name}<br><img src="${e.target.result}" class="dz-thumb">`; bvRenderBuilderSummary(); };
    r.readAsDataURL(file);
  } else {
    prev.innerHTML = `✓ ${file.name} · ${(file.size/1024/1024).toFixed(1)} MB`;
  }
}

// ── TAB: CAMPAIGNS ────────────────────────────────────────────────────────────
// Meta's real scheduling model: an ad set can be status ACTIVE on Meta's side
// while not delivering anything yet, if meta_raw.start_time is still in the
// future -- that IS "scheduled", distinct from genuinely live or off. The
// sync (sync-meta-structure) only started capturing start_time recently, so
// older synced rows may not have it -- those just fall back to raw status.
function bvAdSetLifecycle(a) {
  // Meta's own delivery status (effective_status, copied by meta-status-refresh). A row Meta has not answered for is never shown as Active.
  const eff = a.effective_status || a.ad_sets?.effective_status;
  const startTime = a.meta_raw?.start_time ? new Date(a.meta_raw.start_time) : null;
  if (eff === "ACTIVE" && startTime && startTime.getTime() > Date.now()) {
    return { key: "scheduled", label: `Scheduled — ${startTime.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}` };
  }
  const [label, cls] = amStatusWord(eff);
  return { key: cls === "active" ? "active" : cls, label };
}

// Meta Ads Manager-style drill-down: Campaigns list -> one Campaign's Ad
// Sets -> one Ad Set's Ads (with live creative). campaignsView tracks where
// we are; renderCampaigns (the tab entry point) just dispatches on it, so
// the sidebar's "Campaigns" click always lands back at the list.
let campaignsView = { level: "list", campaignId: null, adSetId: null };

function bvOpenCampaign(campaignId) {
  campaignsView = { level: "campaign", campaignId, adSetId: null };
  render();
}
function bvOpenAdSet(adSetId, campaignId) {
  campaignsView = { level: "adset", campaignId, adSetId };
  render();
}
function bvBackToCampaignsList() {
  campaignsView = { level: "list", campaignId: null, adSetId: null };
  render();
}
function bvBackToCampaign() {
  campaignsView = { level: "campaign", campaignId: campaignsView.campaignId, adSetId: null };
  render();
}

// ── ADS MANAGER (live from Meta) ────────────────────────────────────────────
// Campaigns / Ad sets / Ads exactly as Meta's Ads Manager shows them: real
// status, WhatsApp conversations + cost per conversation, tick a campaign or
// ad set to see only what is inside it, and a switch on every row that
// pauses/resumes on Meta itself (via the ads-manager edge function).
const AM_RANGES = [["today", "Today"], ["yesterday", "Yesterday"], ["last3", "Last 3 days"], ["last7", "Last 7 days"], ["last30", "Last 30 days"], ["lifetime", "Lifetime"]];
const AM_STALE_MS = 90 * 1000;
const amAdById = id => am.data?.ads?.find(a => a.id === id);
const AM_SINGULAR = { campaigns: "campaign", adsets: "adset", ads: "ad" };
let am = {
  data: null, key: "", loading: false, error: null, at: 0, req: 0,
  level: "campaigns", range: "today", filter: "live",
  sel: { campaigns: new Set(), adsets: new Set() }, busy: new Set(),
  bal: null, balKey: "",
};
const amKey = () => `${activeAccountId}|${am.range}|${am.filter}`;
const amEl = () => document.getElementById("amRoot");

async function renderAdsManager(el) {
  el.innerHTML = `<div id="amRoot"></div>`;
  if (am.key !== amKey() || Date.now() - am.at > AM_STALE_MS) {
    if (am.key !== amKey()) { am.data = null; am.sel = { campaigns: new Set(), adsets: new Set() }; }
    amFetch();
  } else {
    amDraw();
  }
}

const fN2 = n => n == null ? "—" : "₦" + Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const AM_ACCT_STATUS = { 2: "Account disabled", 3: "Payment issue (unsettled)", 7: "Under risk review", 8: "Settling payment", 9: "Grace period", 100: "Closing", 101: "Account closed" };

// Prepaid money left in the selected ad account, read live from Meta.
async function amBalanceFetch() {
  const id = activeAccountId; if (!id) return;
  const r = await amCall({ action: "balances", ad_account_id: id });
  if (id !== activeAccountId) return;
  am.bal = r && r.ok ? (r.accounts[0] || { error: "No balance returned." }) : { error: r?.error || "Could not read the balance from Meta." };
  am.balKey = id;
  amDraw();
}

function amBalanceHtml() {
  const b = am.balKey === activeAccountId ? am.bal : null;
  if (!b) return `<div class="am-bal"><span class="am-bal-l">💰 Checking prepaid balance…</span></div>`;
  if (b.error) return `<div class="am-bal low"><span class="am-bal-l">💰 Balance unavailable</span><span class="am-bal-s">${escH(b.error)}</span></div>`;
  const status = b.account_status && b.account_status !== 1 ? `<span class="pill rejected">${escH(AM_ACCT_STATUS[b.account_status] || "Account issue")}</span>` : "";
  if (b.available == null) {
    return `<div class="am-bal"><span class="am-bal-l">💰 ${escH(b.name || "Ad account")}</span><span class="am-bal-s">No prepaid balance — this account is billed to a card.${b.owed ? ` Spend not yet billed: ${fN2(b.owed)}.` : ""}</span>${status}</div>`;
  }
  const low = b.low_threshold != null && b.available <= b.low_threshold;
  const days = { last3: 3, last7: 7, last30: 30 }[am.range];
  const spend = am.data?.campaigns?.reduce((s, c) => s + c.spend, 0) || 0;
  const perDay = days && spend > 0 ? spend / days : 0;
  const runway = perDay > 0 ? `At your ${days}-day average (${fN(perDay)}/day) this lasts about ${Math.max(0, b.available / perDay).toFixed(1)} days.` : "";
  return `<div class="am-bal${low ? " low" : ""}">
    <div class="am-bal-main"><span class="am-bal-l">💰 ${escH(b.name || "Ad account")} · prepaid balance left</span><b>${fN2(b.available)}</b></div>
    <div class="am-bal-s">${low ? `<b>Low — top up soon.</b> ` : ""}${runway}${status}</div>
  </div>`;
}

// Saved copy on this device: opens the screen instantly, then the live numbers replace it.
function amLocalGet(key) { try { const t = localStorage.getItem("rv_am:" + key); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function amLocalSet(key, data) {
  const put = () => localStorage.setItem("rv_am:" + key, JSON.stringify(data));
  try { put(); } catch (e) { try { Object.keys(localStorage).filter((k) => k.startsWith("rv_am:")).forEach((k) => localStorage.removeItem(k)); put(); } catch (x) {} }
}
// Shows what we already have (this device, then the database copy) and refreshes live from Meta in the background.
async function amFetch() {
  amBalanceFetch();
  const my = ++am.req;
  am.loading = true; am.error = null; am.warn = null;
  const key = amKey(), range = am.range, status = am.filter;
  if (!am.data || am.key !== key) {
    const saved = amLocalGet(key);
    am.data = saved || null; am.key = saved ? key : am.key; am.fromSaved = !!saved; if (saved) am.at = new Date(saved.fetched_at || Date.now()).getTime();
  }
  amDraw();
  if (!am.data) {
    sbFn("ads-manager", { action: "list_cached", range, status }).then((r) => {
      if (my !== am.req || am.data || !r || !r.ok || r.none) return;
      am.data = r; am.key = key; am.fromSaved = true; am.at = new Date(r.snapshot_at || Date.now()).getTime(); amDraw();
    }).catch(() => {});
  }
  const r = await sbFn("ads-manager", { action: "list", range, status });
  if (my !== am.req) return; // a newer request (range/account switch) owns the screen
  am.loading = false;
  if (!r || r.ok === false || r.error) {
    if (am.data) am.warn = r?.error || "Could not reach Meta."; else am.error = r?.error || "Could not load from Meta.";
  } else {
    am.data = r; am.key = key; am.fromSaved = !!r.stale; am.at = r.stale ? new Date(r.snapshot_at || Date.now()).getTime() : Date.now();
    am.warn = r.stale ? r.stale_reason : null;
    if (!r.stale) amLocalSet(key, r);
    amPruneSelection();
  }
  amDraw();
}

function amPruneSelection() {
  const d = am.data; if (!d) return;
  const campIds = new Set(d.campaigns.map(c => c.id));
  for (const id of [...am.sel.campaigns]) if (!campIds.has(id)) am.sel.campaigns.delete(id);
  const setOk = new Set(d.adsets.filter(a => !am.sel.campaigns.size || am.sel.campaigns.has(a.campaign_id)).map(a => a.id));
  for (const id of [...am.sel.adsets]) if (!setOk.has(id)) am.sel.adsets.delete(id);
}

// Delivery pill: Meta's own words for each status, never a guess. A campaign or ad set that Meta marks ACTIVE is only shown as "Active"
// while at least one ad inside it is really delivering; otherwise the pill shows what the ads inside are doing (In review, Preparing, ...).
const AM_STATUS = {
  ACTIVE: ["Active", "active"], PAUSED: ["Paused", "paused"], CAMPAIGN_PAUSED: ["Campaign paused", "paused"], ADSET_PAUSED: ["Ad set paused", "paused"],
  PENDING_REVIEW: ["In review", "pending"], IN_PROCESS: ["Preparing", "pending"], PREAPPROVED: ["Preparing", "pending"],
  DISAPPROVED: ["Rejected", "rejected"], WITH_ISSUES: ["Has issues", "watch"], PENDING_BILLING_INFO: ["Billing issue", "watch"],
  ARCHIVED: ["Archived", "off"], DELETED: ["Deleted", "off"],
};
const AM_WORST = ["DISAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO", "PENDING_REVIEW", "IN_PROCESS", "PREAPPROVED"]; // what to show when nothing inside delivers
function amStatusWord(e) {
  if (AM_STATUS[e]) return AM_STATUS[e];
  if (!e) return ["Checking with Meta…", "pending"];
  const w = String(e).replace(/_/g, " ").toLowerCase(); return [w.charAt(0).toUpperCase() + w.slice(1), "watch"]; // an unknown Meta word is shown as Meta wrote it
}
function amKids(r) {
  const d = am.data; if (!d || !d.ads || r.adset_id) return null; // an ad has nothing inside it
  return r.campaign_id ? d.ads.filter(a => a.adset_id === r.id) : d.ads.filter(a => a.campaign_id === r.id);
}
// Meta marks a campaign, ad set or ad ACTIVE even before its start time. Ads Manager shows that as "Scheduled", so this does too.
function amScheduled(r) {
  const d = am.data; if (!d) return null;
  const now = Date.now(), future = (x) => x && x.start_time && new Date(x.start_time).getTime() > now;
  if (r.adset_id) { const set = (d.adsets || []).find(x => x.id === r.adset_id); return future(set) ? new Date(set.start_time) : null; }
  if ("start_time" in r) return future(r) ? new Date(r.start_time) : null;
  const sets = (d.adsets || []).filter(x => x.campaign_id === r.id);
  if (sets.length && sets.every(future)) return new Date(Math.min(...sets.map(x => new Date(x.start_time).getTime())));
  return null;
}
function amDelivery(r) {
  const e = r.effective_status || r.status;
  let [label, cls] = amStatusWord(e), note = "";
  if (e === "ACTIVE") {
    const sd = amScheduled(r);
    if (sd) return `<span class="pill pending">Scheduled</span><span class="am-sub" style="display:block">Starts ${escH(sd.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }))}</span>`;
  }
  const kids = e === "ACTIVE" ? amKids(r) : null;
  if (kids && kids.length) {
    const live = kids.filter(k => k.effective_status === "ACTIVE").length;
    if (live === 0) {
      const have = kids.map(k => k.effective_status);
      const worst = AM_WORST.find(w => have.includes(w));
      if (worst) { [label, cls] = amStatusWord(worst); note = `${kids.filter(k => k.effective_status === worst).length} of ${kids.length} ads`; }
      else { [label, cls] = ["No ads running", "paused"]; }
    } else if (live < kids.length) note = `${live} of ${kids.length} ads delivering`;
  }
  return `<span class="pill ${cls}">${escH(label)}</span>${note ? `<span class="am-sub" style="display:block">${escH(note)}</span>` : ""}`;
}

function amRows(level) {
  const d = am.data; if (!d) return [];
  let rows;
  if (level === "campaigns") rows = d.campaigns;
  else if (level === "adsets") {
    rows = d.adsets;
    if (am.sel.campaigns.size) rows = rows.filter(a => am.sel.campaigns.has(a.campaign_id));
  } else {
    rows = d.ads;
    if (am.sel.adsets.size) rows = rows.filter(a => am.sel.adsets.has(a.adset_id));
    else if (am.sel.campaigns.size) rows = rows.filter(a => am.sel.campaigns.has(a.campaign_id));
  }
  rows = rows.filter(r => !["DELETED", "ARCHIVED"].includes(r.effective_status));
  if (am.q) rows = rows.filter(r => String(r.name || "").toLowerCase().includes(am.q.toLowerCase()));
  return [...rows].sort((a, b) => (b.status === "ACTIVE") - (a.status === "ACTIVE") || b.spend - a.spend);
}


async function amBulk(status) {
  const ids = [...am.sel.campaigns];
  for (const id of ids) {
    const r = amFind("campaign", id);
    if (r && (r.status === "ACTIVE") !== (status === "ACTIVE")) await amSetStatus("campaign", id, status, "bulk");
  }
}

const amCostLabel = kind => kind === "messaging" ? "Cost / conversation" : kind === "purchase" ? "Cost / purchase" : "Cost / result";
// Column titles follow what the rows on screen are: all message ads -> "Conversations".


function amTotals(rows) {
  const sum = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const msg = rows.filter(r => r.kind === "messaging");
  const pur = rows.filter(r => r.kind === "purchase");
  const pick = msg.length ? msg : pur;
  const results = pick.reduce((s, r) => s + (r.results || 0), 0);
  const spend = pick.reduce((s, r) => s + r.spend, 0);
  const lpv = pur.reduce((s, r) => s + (Number(r.landing_page_views) || 0), 0);
  const webSpend = pur.reduce((s, r) => s + r.spend, 0);
  const webClicks = pur.reduce((s, r) => s + (Number(r.clicks) || 0), 0);
  const webPurchases = pur.reduce((s, r) => s + (Number(r.purchases) || 0), 0);
  return {
    spend: sum("spend"), imp: sum("impressions"), clk: sum("clicks"), results, label: msg.length ? "Conversations" : pur.length ? "Purchases" : "",
    cpr: results > 0 ? spend / results : null,
    hasWeb: pur.length > 0, lpv, webSpend, webClicks, webPurchases,
    cpl: lpv > 0 ? webSpend / lpv : null,
    lpvRate: webClicks > 0 ? Math.min(100, lpv / webClicks * 100) : null,
  };
}

