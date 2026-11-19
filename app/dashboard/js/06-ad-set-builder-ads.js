// Revora dashboard, part 06 of 23: REUSE EXISTING CREATIVE (instead of re-uploading) · AD SET BUILDER · NAMES + "VIEW ALL" FOR AD SETS AND ADS · ad sets · ad copies · ADS BELONG TO AD SETS

// ── REUSE EXISTING CREATIVE (instead of re-uploading) ───────────────────────
// Ad-level creative picker: choose a creative already uploaded for the
// selected product instead of re-uploading the same video/image, with the
// product's link/destination already auto-filled as before.
async function bvOpenReuseCreativeModal() {
  // Creatives from the product's vault, with their copy: picking one fills the headline, primary text,
  // description and button below, so setting up an ad is just choose-and-go.
  const productId = document.getElementById("f_product")?.value;
  const overlay = document.createElement("div");
  overlay.id = "bvReuseModalOverlay";
  overlay.className = "bv-overlay";
  overlay.innerHTML = `<div class="bv-modal" style="max-width:640px;"><button class="bv-modal-close" onclick="this.closest('.bv-overlay').remove()">✕</button><div class="ph-title" style="margin-bottom:4px;">Choose from your creative vault</div><div style="font-size:11.5px;color:var(--muted);margin-bottom:12px;">Pick one and its headline, primary text, description and button fill in automatically.</div><div id="bvReuseList" style="font-size:12px;color:var(--muted);">Loading…</div></div>`;
  document.body.appendChild(overlay);
  let assets = [];
  try {
    assets = await sbQuery("creative_assets", `select=*${productId ? `&product_id=eq.${productId}` : ""}&order=uploaded_at.desc&limit=200`);
  } catch (e) { assets = (window.bvVaultAssetsCache || []).filter(a => !productId || a.product_id === productId); }
  assets = (assets || []).filter(a => a.public_url);
  window.bvVaultAssetsCache = [...assets, ...(window.bvVaultAssetsCache || []).filter(a => !assets.some(x => x.id === a.id))];
  const list = document.getElementById("bvReuseList"); if (!list) return;
  list.innerHTML = !assets.length
    ? `<div style="padding:14px;border:1px dashed var(--border);border-radius:10px;">${productId ? "This product has no creatives yet. Open Products → Edit and upload some to its Creative vault." : "Pick a product first, or upload your first creative."}</div>`
    : `<div style="display:grid;gap:8px;max-height:60vh;overflow:auto;">${assets.map(a => `
        <div class="bv-clickable-row" onclick="bvPickReuseAsset('${a.id}')" style="display:flex;align-items:flex-start;gap:10px;border:1px solid var(--border);border-radius:10px;padding:9px;cursor:pointer;">
          ${a.asset_type === "video" ? `<video src="${escH(a.public_url)}" muted style="width:64px;height:64px;object-fit:cover;border-radius:6px;flex-shrink:0;"></video>` : `<img src="${escH(a.public_url)}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;flex-shrink:0;">`}
          <div style="flex:1;min-width:0;">
            <div style="font-size:12.5px;font-weight:700;color:var(--text);">${escH(a.headline || "(no headline yet)")}</div>
            <div style="font-size:11.5px;color:var(--text2);margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escH(a.primary_text || "(no primary text yet)")}</div>
            <div style="font-size:10.5px;color:var(--muted);margin-top:3px;">${a.asset_type === "carousel" ? `<span class="cr-badge">Carousel · ${(a.carousel_cards || []).length} cards</span> ` : a.asset_type === "post" ? `<span class="cr-badge">Page post</span> ` : ""}${escH(a.file_name || "")} · ${(a.test_status ?? "untested").replace(/_/g, " ")}</div>
          </div>
        </div>`).join("")}</div>`;
}

function bvPickReuseAsset(assetId) {
  const asset = (window.bvVaultAssetsCache || []).find(a => a.id === assetId);
  if (!asset) return;
  bvReuseAsset = asset;
  document.getElementById("f_file").value = "";
  const prev = document.getElementById("dzPrev");
  prev.innerHTML = `↺ Reusing: ${asset.file_name} <button type="button" onclick="event.stopPropagation(); bvClearReuseAsset();" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:11px;margin-left:6px;">✕ clear</button>`;
  // fill the ad copy from the creative's own copy
  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== "") el.value = v; };
  set("f_primary", asset.primary_text); set("f_headline", asset.headline); set("f_desc", asset.description); set("f_cta", asset.cta_type);
  set("f_mechanism", asset.mechanism); set("f_format", asset.format);
  try { bvRenderBuilderSummary(); } catch (e) {}
  document.getElementById("bvReuseModalOverlay")?.remove();
}

function bvClearReuseAsset() {
  bvReuseAsset = null;
  document.getElementById("dzPrev").innerHTML = "";
}

// ── AD SET BUILDER ───────────────────────────────────────────────────────────
// Direct, real fields per ad set (budget/age/gender/geography) -- no abstract
// named presets. "Duplicate this ad set" clones the last row's current values
// into a new one, so the visible row count always matches exactly how many ad
// sets will actually launch.
let bvAdSetRows = [];

// ── NAMES + "VIEW ALL" FOR AD SETS AND ADS ───────────────────────────────────
// Every ad set and every ad can be named; a typed name is sent to Meta exactly
// as written. Left blank, the launch falls back to the old automatic name.
const bvAdSetName = row => (row.display_name || "").trim() || row.label;

// "Lagos" -> "Lagos 2" -> "Lagos 3" ... first name not already in use.
function bvNextName(base, used) {
  base = (base || "").trim();
  if (!base) return "";
  const taken = new Set(used.map(n => String(n || "").trim().toLowerCase()).filter(Boolean));
  if (!taken.has(base.toLowerCase())) return base;
  const stem = base.replace(/\s+\d+$/, "");
  if (!taken.has(stem.toLowerCase())) return stem;
  for (let n = 2; n < 1000; n++) {
    const c = `${stem} ${n}`;
    if (!taken.has(c.toLowerCase())) return c;
  }
  return base;
}

function bvCloseSheet(id) { document.getElementById(id)?.remove(); }
function bvOpenSheet(id, innerHtml, maxWidth = 720) {
  bvCloseSheet(id);
  const ov = document.createElement("div");
  ov.id = id;
  ov.className = "bv-overlay bv-sheet-ov";
  ov.onclick = e => { if (e.target === ov) ov.querySelector("[data-sheet-close]")?.click(); };
  ov.innerHTML = `<div class="bv-modal bv-sheet" style="max-width:${maxWidth}px;">${innerHtml}</div>`;
  document.body.appendChild(ov);
  return ov;
}

// ── ad sets ──
function bvSetAdSetName(i, value) {
  bvAdSetRows[i].display_name = value;
  const shown = bvAdSetName(bvAdSetRows[i]);
  document.querySelectorAll(`[data-astitle="${i}"]`).forEach(el => { el.textContent = shown; });
  bvRefreshAdSetList();
}

function bvAdSetSummary(r) {
  const gender = { all: "All genders", male: "Men", female: "Women" }[r.gender] || "All genders";
  const where = bvPlacesLabel(r);
  const aud = bvAudienceCount(r) ? ` · ${bvAudienceLabel(r)}` : "";
  return `₦${Number(r.budget_naira || 0).toLocaleString()}/day · ${gender} ${r.age_min}–${r.age_max} · ${where}${aud}${r.advantage_audience === false || bvAudienceCount(r) ? "" : " · Advantage+"}`;
}

function bvOpenAdSetListModal() {
  bvOpenSheet("bvAdSetListOverlay", `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('bvAdSetListOverlay')">✕</button>
    <div id="bvAdSetListBody"></div>`);
  bvRefreshAdSetList();
}

function bvRefreshAdSetList() {
  const body = document.getElementById("bvAdSetListBody");
  if (!body) return;
  const total = bvAdSetRows.reduce((s, r) => s + (Number(r.budget_naira) || 0), 0);
  body.innerHTML = `
    <div class="ph-title" style="margin-bottom:4px;">All ad sets (${bvAdSetRows.length})</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">Tap one to edit everything about it. ₦${total.toLocaleString()}/day across all of them.</div>
    ${bvAdSetRows.map((r, i) => {
      const custom = (r.display_name || "").trim();
      return `<div class="bv-listrow" onclick="bvOpenAdSetEdit(${i})">
        <div class="bv-listnum">${i + 1}</div>
        <div class="bv-listmain">
          <div class="bv-listname">${escH(bvAdSetName(r))} <span class="pill ${i === 0 ? "active" : "scale"}">${i === 0 ? "original" : "copy"}</span>${custom ? "" : ` <span class="pill off" title="No name typed — Meta gets an automatic name">auto name</span>`}</div>
          <div class="bv-listsub">${escH(bvAdSetSummary(r))}</div>
        </div>
        <div class="bv-listbtns" onclick="event.stopPropagation()">
          <button type="button" class="btn btn-g" onclick="bvOpenAdSetEdit(${i})">Edit</button>
          <button type="button" class="btn btn-g" onclick="bvQuickDupAdSet(${i})" title="Add a copy of this ad set">⧉</button>
          ${i > 0 ? `<button type="button" class="btn btn-g" style="color:var(--danger);" onclick="bvRemoveAdSetRow(${i})" title="Remove">✕</button>` : ""}
        </div>
      </div>`;
    }).join("")}
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:16px;flex-wrap:wrap;">
      <button type="button" class="btn btn-g" onclick="bvOpenDuplicateAdSetModal()">⧉ Duplicate ad set…</button>
      <button type="button" class="btn btn-a" onclick="bvCloseSheet('bvAdSetListOverlay')">Done</button>
    </div>`;
}

function bvQuickDupAdSet(i) {
  bvCommitFormCopy();
  const src = bvAdSetRows[i];
  const used = bvAdSetRows.map(r => r.display_name || "");
  const fresh = {
    ...src,
    device_platforms: [...(src.device_platforms || [])],
    display_name: bvNextName(src.display_name, used),
    label: `Ad Set ${bvAdSetRows.length + 1}`,
    uid: bvUid(),
  };
  bvAdSetRows.push(fresh);
  bvCloneAdsToAdSet(src.uid, fresh.uid);
  bvRenderAdSetRows();
  bvRenderStagedCopies();
  bvToast("Ad set copied with its ads — rename it if you like.");
}

let bvAdSetEditIdx = null;
function bvOpenAdSetEdit(i) {
  bvAdSetEditIdx = i;
  bvOpenSheet("bvAdSetEditOverlay", `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseAdSetEdit()">✕</button>
    <div id="bvAdSetEditBody"></div>`, 760);
  bvRefreshAdSetEdit();
}
function bvCloseAdSetEdit() {
  bvAdSetEditIdx = null;
  bvCloseSheet("bvAdSetEditOverlay");
  bvRefreshAdSetList();
}
function bvRefreshAdSetEdit() {
  const body = document.getElementById("bvAdSetEditBody");
  if (!body || bvAdSetEditIdx == null) return;
  const row = bvAdSetRows[bvAdSetEditIdx];
  if (!row) { bvCloseAdSetEdit(); return; }
  const ov = document.getElementById("bvAdSetEditOverlay");
  const top = ov ? ov.scrollTop : 0;
  const isWhatsapp = document.querySelector('input[name="f_destination"]:checked')?.value === "whatsapp";
  body.innerHTML = bvAdSetCardHtml(row, bvAdSetEditIdx, isWhatsapp, true) +
    `<div style="display:flex;justify-content:flex-end;margin-top:6px;"><button type="button" class="btn btn-a" onclick="bvCloseAdSetEdit()">Done</button></div>`;
  if (ov) ov.scrollTop = top;
}

// ── ad copies ──
const bvAdName = c => (c.ad_name || "").trim();
const bvIsWhatsappDest = () => document.querySelector('input[name="f_destination"]:checked')?.value === "whatsapp";
const bvFormWa = () => ({ wa_greeting: document.getElementById("f_wa_greeting")?.value.trim() || "", wa_prefill: document.getElementById("f_wa_prefill")?.value.trim() || "" });

// The copy currently typed into the form (not staged yet), or null.
function bvAdCurrentCopy() {
  const file = document.getElementById("f_file")?.files?.[0];
  const primary = document.getElementById("f_primary")?.value.trim();
  if (!(file || bvReuseAsset) || !primary) return null;
  return {
    file: file || null,
    reuse_asset: bvReuseAsset,
    adset_uid: bvAdTabUid,
    ad_name: document.getElementById("f_ad_name")?.value.trim() || "",
    ...bvFormWa(),
    primary_text: primary,
    headline: document.getElementById("f_headline").value.trim(),
    description: document.getElementById("f_desc").value.trim(),
    mechanism: document.getElementById("f_mechanism").value,
    format: document.getElementById("f_format").value,
    cta_type: document.getElementById("f_cta").value,
  };
}
const bvUsedAdNames = () => [...bvAdNamesIn(bvAdTabUid), document.getElementById("f_ad_name")?.value || ""];

// ── ADS BELONG TO AD SETS ────────────────────────────────────────────────────
// 1 campaign -> N ad sets -> each ad set has its OWN ads (like Meta). An ad has
// exactly one ad set (adset_uid). The Ad step shows one tab per ad set; ads
// you add there belong to that ad set. Duplicating an ad set duplicates its ads.
let bvAdTabUid = null;
const bvUid = () => "as_" + Math.random().toString(36).slice(2, 10);
const bvAdSetByUid = uid => bvAdSetRows.find(r => r.uid === uid);
const bvAdSetIdx = uid => bvAdSetRows.findIndex(r => r.uid === uid);
const bvStagedOf = uid => bvStagedCopies.map((c, i) => ({ c, i })).filter(x => x.c.adset_uid === uid);
const bvAdNamesIn = uid => bvStagedCopies.filter(c => c.adset_uid === uid).map(c => c.ad_name || "");
function bvEnsureAdTab() { if (!bvAdSetByUid(bvAdTabUid)) bvAdTabUid = bvAdSetRows[0]?.uid ?? null; }
// ads in an ad set = saved ones + the one being typed in the form (if that ad set's tab is open)
function bvAdsCountFor(uid) { return bvStagedOf(uid).length + (uid === bvAdTabUid && bvAdCurrentCopy() ? 1 : 0); }

function bvRenderAdTabs() {
  const wrap = document.getElementById("bvAdSetTabs");
  if (!wrap) return;
  bvEnsureAdTab();
  wrap.innerHTML = bvAdSetRows.map(r => {
    const n = bvAdsCountFor(r.uid);
    return `<button type="button" class="bv-adtab${r.uid === bvAdTabUid ? " active" : ""}${n ? "" : " empty"}" onclick="bvSelectAdTab('${r.uid}')"><span class="bv-adtab-n">${n}</span><span class="bv-adtab-t">${escH(bvAdSetName(r))}</span></button>`;
  }).join("");
  const cur = bvAdSetByUid(bvAdTabUid);
  const hint = document.getElementById("bvAdTabHint");
  if (hint && cur) {
    const saved = bvStagedOf(cur.uid).length;
    hint.innerHTML = `Ads for <b>${escH(bvAdSetName(cur))}</b>${bvAdSetRows.length > 1 ? " — only this ad set. Other ad sets have their own ads (use the tabs above)." : "."}
      ${saved ? `${saved} saved below.` : ""}
      ${bvAdSetRows.length > 1 ? `<a href="javascript:void(0)" onclick="bvOpenCopyAdsModal()">⧉ Copy these ads to other ad sets</a>` : ""}`;
  }
  const sum = document.getElementById("bvAdFormTitle");
  if (sum && cur) sum.textContent = `✏️ Ad copy — for ${bvAdSetName(cur)}`;
}

// Saves the ad typed in the form (if complete) into the ad set whose tab is open, then clears the form.
function bvCommitFormCopy() {
  const cur = bvAdCurrentCopy();
  if (!cur) return false;
  cur.ad_name = bvNextName(cur.ad_name, bvAdNamesIn(cur.adset_uid));
  bvStagedCopies.push(cur);
  document.getElementById("f_file").value = "";
  document.getElementById("f_ad_name").value = "";
  document.getElementById("f_primary").value = "";
  document.getElementById("f_headline").value = "";
  document.getElementById("f_desc").value = "";
  document.getElementById("dzPrev").innerHTML = "";
  bvReuseAsset = null;
  return true;
}

function bvSelectAdTab(uid) {
  if (uid === bvAdTabUid) return;
  const old = bvAdSetByUid(bvAdTabUid);
  if (bvCommitFormCopy() && old) bvToast(`Ad saved to ${bvAdSetName(old)}.`);
  bvAdTabUid = uid;
  bvRenderStagedCopies();
  document.getElementById("uploadForm")?.scrollTo(0, 0);
}

function bvCloneAdsToAdSet(srcUid, dstUid) {
  const used = bvAdNamesIn(dstUid);
  for (const { c } of bvStagedOf(srcUid)) {
    const name = bvNextName(c.ad_name, used);
    used.push(name);
    bvStagedCopies.push({ ...c, adset_uid: dstUid, ad_name: name });
  }
}

function bvOpenCopyAdsModal() {
  bvCommitFormCopy();
  bvRenderStagedCopies();
  const src = bvAdSetByUid(bvAdTabUid);
  const n = bvStagedOf(bvAdTabUid).length;
  const others = bvAdSetRows.filter(r => r.uid !== bvAdTabUid);
  if (!src || !others.length) return;
  bvOpenSheet("bvCopyAdsOverlay", `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('bvCopyAdsOverlay')">✕</button>
    <div class="ph-title" style="margin-bottom:4px;">Copy ads to other ad sets</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">${n} ad${n === 1 ? "" : "s"} from <b>${escH(bvAdSetName(src))}</b> will be copied into the ad sets you tick. You can edit each copy afterwards (for example a different creative for women).</div>
    ${n ? others.map(r => `<label class="bv-listrow" style="cursor:pointer;"><input type="checkbox" class="bv-copyads-cb" value="${r.uid}" checked style="width:18px;height:18px;accent-color:var(--accent);"><div class="bv-listmain"><div class="bv-listname">${escH(bvAdSetName(r))}</div><div class="bv-listsub">${bvStagedOf(r.uid).length} ad${bvStagedOf(r.uid).length === 1 ? "" : "s"} already</div></div></label>`).join("") : `<div class="empty" style="padding:20px;">This ad set has no saved ads yet — add one first.</div>`}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button type="button" class="btn btn-g" onclick="bvCloseSheet('bvCopyAdsOverlay')">Cancel</button>
      ${n ? `<button type="button" class="btn btn-a" onclick="bvConfirmCopyAds()">Copy</button>` : ""}
    </div>`, 520);
}
function bvConfirmCopyAds() {
  const src = bvAdTabUid;
  const dsts = [...document.querySelectorAll("#bvCopyAdsOverlay .bv-copyads-cb:checked")].map(cb => cb.value);
  dsts.forEach(d => bvCloneAdsToAdSet(src, d));
  bvCloseSheet("bvCopyAdsOverlay");
  bvRenderStagedCopies();
  bvToast(dsts.length ? `Copied to ${dsts.length} ad set${dsts.length === 1 ? "" : "s"}.` : "Nothing ticked.");
}

function bvOpenAdListModal() {
  bvOpenSheet("bvAdListOverlay", `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('bvAdListOverlay')">✕</button>
    <div id="bvAdListBody"></div>`);
  bvRefreshAdList();
}

function bvRefreshAdList() {
  const body = document.getElementById("bvAdListBody");
  if (!body) return;
  const cur = bvAdCurrentCopy();
  const total = bvStagedCopies.length + (cur ? 1 : 0);
  const fileLabel = c => c.reuse_asset ? `↺ ${c.reuse_asset.file_name} (reused)` : (c.file?.name || "");
  const row = (c, n, it) => {
    const named = bvAdName(c);
    const act = it.form ? "bvAdGoToForm()" : `bvOpenAdEdit(${it.i})`;
    return `<div class="bv-listrow" onclick="${act}">
      <div class="bv-listnum">${n}</div>
      <div class="bv-listmain">
        <div class="bv-listname">${named ? escH(named) : `<span style="color:var(--muted);font-weight:500;">Unnamed ad</span>`}${it.form ? ` <span class="pill pending">in the form</span>` : ""}${named ? "" : ` <span class="pill off" title="No name typed — Meta gets an automatic name">auto name</span>`}</div>
        <div class="bv-listsub">${escH(fileLabel(c))}</div>
        <div class="bv-listsub" style="color:var(--text2);">${escH((c.primary_text || "").slice(0, 110))}${(c.primary_text || "").length > 110 ? "…" : ""}</div>
      </div>
      <div class="bv-listbtns" onclick="event.stopPropagation()">
        <button type="button" class="btn btn-g" onclick="${act}">${it.form ? "Go to form" : "Edit"}</button>
        ${it.form ? "" : `<button type="button" class="btn btn-g" onclick="bvQuickDuplicateStagedCopy(${it.i});bvRefreshAdList()" title="Add a copy of this ad">⧉</button>
        <button type="button" class="btn btn-g" style="color:var(--danger);" onclick="bvRemoveStagedCopy(${it.i});bvRefreshAdList()" title="Remove">✕</button>`}
      </div>
    </div>`;
  };
  body.innerHTML = `
    <div class="ph-title" style="margin-bottom:4px;">All ads (${total})</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">Every ad belongs to one ad set. ${total} ad${total === 1 ? "" : "s"} across ${bvAdSetRows.length} ad set${bvAdSetRows.length === 1 ? "" : "s"}. Tap an ad to edit it.</div>
    ${bvAdSetRows.map(r => {
      const items = [...(cur && r.uid === bvAdTabUid ? [{ c: cur, form: true }] : []), ...bvStagedOf(r.uid).map(x => ({ c: x.c, i: x.i }))];
      return `<div class="bv-listgroup">
        <div class="bv-listgroup-h"><span>▦ ${escH(bvAdSetName(r))}</span><span class="${items.length ? "" : "bv-warn"}">${items.length ? items.length + " ad" + (items.length === 1 ? "" : "s") : "no ads yet"}</span></div>
        ${items.length ? items.map((it, n) => row(it.c, n + 1, it)).join("") : `<div class="bv-listrow" style="cursor:default;"><div class="bv-listmain"><div class="bv-listsub">This ad set has no ad yet.</div></div><div class="bv-listbtns"><button type="button" class="btn btn-a" onclick="bvCloseSheet('bvAdListOverlay');bvSelectAdTab('${r.uid}')">Add an ad</button></div></div>`}
      </div>`;
    }).join("")}
    <div style="display:flex;justify-content:flex-end;margin-top:16px;"><button type="button" class="btn btn-a" onclick="bvCloseSheet('bvAdListOverlay')">Done</button></div>`;
}

function bvAdGoToForm() {
  bvCloseSheet("bvAdListOverlay");
  document.getElementById("f_primary")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function bvOpenAdEdit(i) {
  const c = bvStagedCopies[i];
  if (!c) return;
  const optsOf = (id, val) => {
    const html = document.getElementById(id)?.innerHTML || "";
    return html.replace(new RegExp(`(value="${val}")`), "$1 selected");
  };
  bvOpenSheet("bvAdEditOverlay", `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseAdEdit()">✕</button>
    <div class="ph-title" style="margin-bottom:14px;">Edit ad ${i + 1}</div>
    <div class="field"><label>Ad set <span style="font-weight:400;color:var(--muted);">(the ad set this ad runs in)</span></label>
      <select onchange="bvUpdateStagedCopy(${i}, 'adset_uid', this.value)">${bvAdSetRows.map(r => `<option value="${r.uid}" ${r.uid === c.adset_uid ? "selected" : ""}>${escH(bvAdSetName(r))}</option>`).join("")}</select></div>
    <div class="field" style="margin-top:12px;"><label>Ad name <span style="font-weight:400;color:var(--muted);">(shown on Meta exactly as you type it)</span></label>
      <input value="${escH(c.ad_name || "")}" maxlength="120" placeholder="Type your own name, or leave blank for an automatic one" oninput="bvUpdateStagedCopy(${i}, 'ad_name', this.value)"></div>
    <div class="field" style="margin-top:12px;"><label>Creative</label>
      <div id="bvAdEditFile" style="font-size:12.5px;color:var(--text2);">${escH(c.reuse_asset ? `↺ ${c.reuse_asset.file_name} (reused)` : (c.file?.name || "—"))}</div>
      <input type="file" accept="video/*,image/*" style="margin-top:6px;" onchange="bvReplaceStagedFile(${i}, this)">
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">Pick a file only if you want to replace this ad's image or video.</div></div>
    <div class="field" style="margin-top:12px;"><label>Primary text</label>
      <textarea rows="5" oninput="bvUpdateStagedCopy(${i}, 'primary_text', this.value)">${escH(c.primary_text || "")}</textarea></div>
    ${bvIsWhatsappDest() ? `
    <div class="bv-wa-box" style="margin-top:12px;">
      <div class="field"><label>WhatsApp greeting <span style="font-weight:400;color:var(--muted);">(max 300)</span></label>
        <textarea rows="2" maxlength="300" oninput="bvUpdateStagedCopy(${i}, 'wa_greeting', this.value)">${escH(c.wa_greeting || "")}</textarea></div>
      <div class="field" style="margin-top:12px;"><label>Pre-filled message <span style="font-weight:400;color:var(--muted);">(max 500)</span></label>
        <textarea rows="2" maxlength="500" oninput="bvUpdateStagedCopy(${i}, 'wa_prefill', this.value)">${escH(c.wa_prefill || "")}</textarea></div>
    </div>` : ""}
    <div class="fg" style="margin-top:12px;">
      <div class="field"><label>Headline</label><input value="${escH(c.headline || "")}" oninput="bvUpdateStagedCopy(${i}, 'headline', this.value)"></div>
      <div class="field"><label>Description</label><input value="${escH(c.description || "")}" oninput="bvUpdateStagedCopy(${i}, 'description', this.value)"></div>
      <div class="field"><label>CTA</label><select onchange="bvUpdateStagedCopy(${i}, 'cta_type', this.value)">${optsOf("f_cta", c.cta_type)}</select></div>
      <div class="field"><label>Mechanism</label><select onchange="bvUpdateStagedCopy(${i}, 'mechanism', this.value)">${optsOf("f_mechanism", c.mechanism)}</select></div>
      <div class="field"><label>Format</label><select onchange="bvUpdateStagedCopy(${i}, 'format', this.value)">${optsOf("f_format", c.format)}</select></div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:16px;"><button type="button" class="btn btn-a" onclick="bvCloseAdEdit()">Done</button></div>`, 760);
}
function bvCloseAdEdit() {
  bvCloseSheet("bvAdEditOverlay");
  bvRenderStagedCopies();
  bvRefreshAdList();
}
function bvReplaceStagedFile(i, input) {
  const f = input.files?.[0];
  if (!f) return;
  bvStagedCopies[i].file = f;
  bvStagedCopies[i].reuse_asset = null;
  const el = document.getElementById("bvAdEditFile");
  if (el) el.textContent = f.name;
}

// Two ad sets (or two ads) typed with the same name would be confusing in Ads
// Manager -- ask for different names instead of launching.
function bvFindDuplicateNames(copies) {
  const dupIn = names => {
    const seen = new Set();
    for (const n of names.map(x => String(x || "").trim()).filter(Boolean)) {
      const k = n.toLowerCase();
      if (seen.has(k)) return n;
      seen.add(k);
    }
    return null;
  };
  const a = dupIn(bvAdSetRows.map(r => r.display_name));
  if (a) return `Two ad sets are both named "${escH(a)}". Give each ad set its own name (Ad set step → View all).`;
  // ads only need distinct names inside the same ad set
  for (const r of bvAdSetRows) {
    const b = dupIn(copies.filter(c => c.adset_uid === r.uid).map(c => c.ad_name));
    if (b) return `Two ads in "${escH(bvAdSetName(r))}" are both named "${escH(b)}". Give each ad its own name (Ad step → View all ads).`;
  }
  return null;
}


function bvResetAdSetBuilder() {
  bvAdSetRows = [{
    label: "Ad Set 1", budget_naira: 5000, age_min: 25, age_max: 65, gender: "all", geo_type: "nationwide", states: [], cities: [], city_radius: 17, presets: [], interests: [], placements: [], place_manual: false,
    placement_preset: "", device_platforms: [], bid_strategy: "LOWEST_COST_WITHOUT_CAP", bid_amount_naira: "",
    billing_event: "IMPRESSIONS", optimization_goal: "OFFSITE_CONVERSIONS", advantage_audience: true, display_name: "", uid: bvUid(),
  }];
  bvRenderAdSetRows();
}

function bvUpdateAdSetRow(i, key, value) {
  bvAdSetRows[i][key] = value;
  bvRenderAdSetRows();
}

function bvToggleAdSetDevice(i, device, checked) {
  const row = bvAdSetRows[i];
  const set = new Set(row.device_platforms || []);
  if (checked) set.add(device); else set.delete(device);
  row.device_platforms = [...set];
  bvRenderAdSetRows();
}

function bvToggleAdSetAdvantage(i, checked) {
  bvAdSetRows[i].advantage_audience = checked;
  bvRenderAdSetRows();
}