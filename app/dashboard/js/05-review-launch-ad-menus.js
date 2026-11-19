// Revora dashboard, part 05 of 23: REVIEW & LAUNCH · MULTIPLE AD COPIES PER LAUNCH · DUPLICATE THIS AD · KEBAB (⋯) ACTION MENUS

// ── REVIEW & LAUNCH ──────────────────────────────────────────────────────────
// A distinct step before anything is created: shows the real line-item count
// (ad sets x ad copies = total ads) and total daily spend, then asks for an
// explicit terminal action -- launch immediately, or schedule for later
// (reusing the existing f_scheduled field as the default time to offer).
function bvOpenReviewModal(copies) {
  const isWhatsapp = document.querySelector('input[name="f_destination"]:checked')?.value === "whatsapp";
  const selectedProduct = (window.bvVaultProductsCache || []).find(p => p.id === document.getElementById("f_product")?.value);
  const campaignLabel = document.getElementById("f_campaign_name")?.value.trim()
    || selectedProduct?.product_name
    || (isWhatsapp ? document.getElementById("f_whatsapp_number")?.value.trim() : document.getElementById("f_landing_url")?.value.trim())
    || "this campaign";
  const destRaw = document.querySelector('input[name="f_destination"]:checked')?.value || "whatsapp";
  const destLabel = { whatsapp: "Click-to-WhatsApp", website: "Website", messenger: "Click-to-Messenger", instagram: "Click-to-Instagram DM", form: "Instant form" }[destRaw] || "Website";
  const objectiveLabels = {
    OUTCOME_SALES: "Sales", OUTCOME_LEADS: "Leads", OUTCOME_TRAFFIC: "Traffic", OUTCOME_ENGAGEMENT: "Engagement", OUTCOME_AWARENESS: "Awareness",
  };
  const objective = isWhatsapp ? "OUTCOME_SALES" : (document.getElementById("f_objective")?.value || "OUTCOME_SALES");
  const totalBudget = bvAdSetRows.reduce((s, r) => s + (Number(r.budget_naira) || 0), 0);
  const totalAds = copies.length;
  const existingSchedule = document.getElementById("f_scheduled")?.value || "";

  const overlay = document.createElement("div");
  overlay.id = "bvReviewModalOverlay";
  overlay.className = "bv-overlay";
  overlay.innerHTML = `
    <div class="bv-modal" style="max-width:480px;">
      <button class="bv-modal-close" onclick="this.closest('.bv-overlay').remove()">✕</button>
      <div class="ph-title" style="margin-bottom:12px;">Review & launch</div>
      <div style="border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12.5px;line-height:1.7;">
        <div><b>${escH(campaignLabel)}</b> — ${destLabel} · ${objectiveLabels[objective] || objective}</div>
        <div>${bvAdSetRows.length} ad set${bvAdSetRows.length === 1 ? "" : "s"} · <b>${totalAds} ad${totalAds === 1 ? "" : "s"}</b> in total</div>
        <div>₦${totalBudget.toLocaleString()}/day total budget</div>
        ${bvAdSetRows.map(r => `<div style="color:var(--muted);">▦ <b style="color:var(--text2);">${escH(bvAdSetName(r))}</b>${(r.display_name || "").trim() ? "" : " <i>(auto name)</i>"} → ${copies.filter(c => c.adset_uid === r.uid).map(c => bvAdName(c) ? escH(bvAdName(c)) : "<i>unnamed ad</i>").join(", ") || "<i>no ads</i>"}</div>`).join("")}
        ${isWhatsapp ? (() => {
          const g = [...new Set(copies.map(c => (c.wa_greeting || "").trim()))], p = [...new Set(copies.map(c => (c.wa_prefill || "").trim()))];
          const show = (arr, dflt) => arr.length > 1 ? "<i>varies by ad</i>" : (arr[0] ? "“" + escH(arr[0]) + "”" : "<i>" + dflt + "</i>");
          return `<div style="color:var(--muted);">Chat opens with: ${show(g, "neutral default greeting")}</div><div style="color:var(--muted);">Pre-filled message: ${show(p, "neutral default message")}</div>`;
        })() : ""}
      </div>
      <div class="field" style="margin-top:14px;"><label>Schedule for (optional)</label>
        <input type="datetime-local" id="reviewScheduled" value="${existingSchedule}">
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">Launch Now ignores this. Leave blank and use Launch Now, or pick a time and use Schedule.</div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button type="button" class="btn btn-a" style="flex:1;" id="reviewLaunchNowBtn" onclick="bvConfirmLaunch(null)">🚀 Launch now</button>
        <button type="button" class="btn btn-g" style="flex:1;" id="reviewScheduleBtn" onclick="bvConfirmLaunchScheduled()">🗓 Schedule</button>
      </div>
      <div id="reviewMsg" style="margin-top:10px;"></div>
    </div>`;
  document.body.appendChild(overlay);
  window.bvPendingCopies = copies;
}

function bvConfirmLaunchScheduled() {
  const val = document.getElementById("reviewScheduled").value;
  if (!val) { document.getElementById("reviewMsg").innerHTML = `<div class="msg err">Pick a date/time to schedule, or use Launch Now.</div>`; return; }
  bvConfirmLaunch(new Date(val).toISOString());
}

async function bvConfirmLaunch(scheduledIso) {
  const nowBtn = document.getElementById("reviewLaunchNowBtn");
  const schedBtn = document.getElementById("reviewScheduleBtn");
  nowBtn.disabled = true; schedBtn.disabled = true;
  nowBtn.innerHTML = '<span class="spin"></span>';
  const reviewMsg = document.getElementById("reviewMsg");
  reviewMsg.innerHTML = "";
  try {
    await bvExecuteLaunch(window.bvPendingCopies, scheduledIso);
    document.getElementById("bvReviewModalOverlay")?.remove();
  } catch (err) {
    reviewMsg.innerHTML = `<div class="msg err">❌ ${err.message}</div>`;
    nowBtn.disabled = false; schedBtn.disabled = false;
    nowBtn.innerHTML = "🚀 Launch now";
  }
}

async function bvExecuteLaunch(copies, scheduledIso) {
  const btn = document.getElementById("uploadBtn");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Uploading…';

  try {
      // Linking a product is optional now -- the destination (WhatsApp number
      // or landing page URL) is set directly below, independent of any product.
      const productId = document.getElementById("f_product").value || null;
      const isWhatsapp = document.querySelector('input[name="f_destination"]:checked')?.value === "whatsapp";
      const whatsappNumber = document.getElementById("f_whatsapp_number").value.trim();
      const landingUrl = document.getElementById("f_landing_url").value.trim();
      const destVal = document.querySelector('input[name="f_destination"]:checked')?.value || "whatsapp";
      if (isWhatsapp && !whatsappNumber) throw new Error("Enter a WhatsApp number to launch to.");
      if (destVal === "website" && !landingUrl) throw new Error("Enter a landing page URL to launch to.");
      let leadFormId = null;
      if (destVal === "form") {
        const fr = await sbFn("page-tools", { action: "forms_create", ad_account_id: activeAccountId, name: (document.getElementById("f_campaign_name").value.trim() || "Revora Instant Form").slice(0, 80) + " form" });
        if (!fr?.ok || !fr.form_id) throw new Error("Could not set up the lead form: " + (fr?.error || "no answer from Meta"));
        leadFormId = String(fr.form_id);
      }

      // Multiple ad copies in one launch get grouped by a shared batch id so
      // ai-auto-launch-tests treats them as one campaign with N ads per ad set
      // instead of N separate campaigns.
      const launchBatchId = copies.length > 1 ? crypto.randomUUID() : null;
      const assetIds = [];
      const assetExtras = [];
      const uploadedByFile = new Map(); // the same file used in several ad sets is uploaded once, then reused
      for (const copy of copies) {
        const reuseSrc = copy.reuse_asset || (copy.file ? uploadedByFile.get(copy.file) : null);
        if (reuseSrc) {
          // Reusing an existing creative's media -- clone the storage
          // reference (no re-upload of bytes) with this copy's own ad text.
          const { data: cloned, error: cloneErr } = await supabaseClient.from('creative_assets').insert({
            file_name: reuseSrc.file_name,
            storage_path: reuseSrc.storage_path,
            public_url: reuseSrc.public_url,
            asset_type: reuseSrc.asset_type,
            meta_post_id: reuseSrc.meta_post_id ?? null,
            carousel_cards: reuseSrc.carousel_cards ?? null,
            feed_only: reuseSrc.feed_only === true,
            meta_video_id: reuseSrc.meta_video_id ?? null,
            meta_image_hash: reuseSrc.meta_image_hash ?? null,
            mechanism: copy.mechanism,
            format: copy.format,
            primary_text: copy.primary_text,
            headline: copy.headline,
            description: copy.description,
            cta_type: copy.cta_type,
            uploaded_by: "dashboard",
            ad_account_id: activeAccountId,
            test_status: "untested",
            uploaded_at: new Date().toISOString(),
          }).select('id').single();
          if (cloneErr) throw new Error(`"${reuseSrc.file_name}" (reused): ${cloneErr.message}`);
          if (cloned?.id) { assetIds.push(cloned.id); assetExtras.push(copy); }
          continue;
        }

        const fd = new FormData();
        fd.append("file", copy.file);
        fd.append("primary_text", copy.primary_text);
        fd.append("headline", copy.headline);
        fd.append("description", copy.description);
        fd.append("mechanism", copy.mechanism);
        fd.append("format", copy.format);
        fd.append("cta_type", copy.cta_type);
        fd.append("uploaded_by", "dashboard");
        fd.append("ad_account_id", activeAccountId);
        if (typeof productId !== "undefined" && productId) fd.append("product_id", productId); // creatives belong to a product

        const res = await bvCreFetch(fd);
        const r = await res.json();
        if (r.error) throw new Error(`"${copy.file.name}": ${r.error}`);
        if (r.asset?.id) { assetIds.push(r.asset.id); assetExtras.push(copy); if (copy.file) uploadedByFile.set(copy.file, r.asset); }
      }
      if (!assetIds.length) throw new Error("No ad copies uploaded successfully.");
      // Names typed in the builder -- the launch uses them exactly as written.
      // ...and so are the WhatsApp greeting / pre-filled message (WhatsApp ads only).
      for (let k = 0; k < assetIds.length; k++) {
        const c = assetExtras[k] || {};
        const upd = {};
        // which ad set this ad belongs to (position in the ad set list) -- the launch puts it only there
        const setIdx = bvAdSetIdx(c.adset_uid);
        if (setIdx >= 0) upd.ad_set_sort_order = setIdx;
        if ((c.ad_name || "").trim()) upd.ad_name = c.ad_name.trim();
        if (isWhatsapp) {
          if ((c.wa_greeting || "").trim()) upd.whatsapp_greeting = c.wa_greeting.trim();
          if ((c.wa_prefill || "").trim()) upd.whatsapp_prefill = c.wa_prefill.trim();
        }
        if (!Object.keys(upd).length) continue;
        const { error: nameErr } = await supabaseClient.from('creative_assets').update(upd).eq('id', assetIds[k]);
        if (nameErr) throw new Error(`Could not save the names/messages for an ad: ${nameErr.message}`);
      }

      const endDate = document.getElementById("f_end_date").value;
      const sharedFields = {
        ...(productId ? { product_id: productId } : {}),
        destination_type: destVal,
        whatsapp_number: isWhatsapp ? whatsappNumber : null,
        landing_page_url: destVal === "website" ? landingUrl : null,
        launch_paused: document.getElementById("f_launch_paused")?.checked === true,
        ...(leadFormId ? { lead_form_id: leadFormId } : {}),
        campaign_name: document.getElementById("f_campaign_name").value.trim() || null,
        campaign_objective: isWhatsapp ? "OUTCOME_SALES" : destVal === "form" ? "OUTCOME_LEADS" : (document.getElementById("f_objective").value || "OUTCOME_SALES"),
        budget_type: document.getElementById("f_budget_type").value,
        scheduled_for: scheduledIso || null,
        campaign_end_date: endDate ? new Date(endDate).toISOString() : null,
        ...(launchBatchId ? { launch_batch_id: launchBatchId } : {}),
      };
      await supabaseClient.from('creative_assets').update(sharedFields).in('id', assetIds);

      // The ad-set builder rows -- real fields (budget/age/gender/geography)
      // the user set directly, no abstract presets. Attached to the first
      // copy in the batch (ai-auto-launch-tests reads this via launch_batch_id
      // when there's more than one).
      const { error: adSetErr } = await supabaseClient.from('ad_set_configs').insert(
        bvAdSetRows.map((row, i) => ({
          creative_id: assetIds[0],
          label: row.label,
          budget_naira: Number(row.budget_naira) || 5000,
          age_min: Number(row.age_min) || 25,
          age_max: Number(row.age_max) || 65,
          gender: row.gender,
          geo_type: row.geo_type,
          states: row.geo_type === 'states' && bvStatesOf(row).length ? bvStatesOf(row) : null,
          cities: row.geo_type === 'states' && (row.cities || []).length ? row.cities.map(c => ({ key: c.key, name: c.name, region: c.region, radius: Number(row.city_radius) || 17 })) : null,
          interests: bvAudienceOf(row).interests.length ? bvAudienceOf(row).interests : null,
          behaviors: bvAudienceOf(row).behaviors.length ? bvAudienceOf(row).behaviors : null,
          audience_presets: (row.presets || []).length ? row.presets : null,
          sort_order: i,
          placement_preset: row.place_manual && (row.placements || []).length ? null : (row.placement_preset || null),
          placements: row.place_manual && (row.placements || []).length ? row.placements : null,
          device_platforms: row.device_platforms?.length ? row.device_platforms : null,
          bid_strategy: row.bid_strategy || null,
          bid_amount_naira: row.bid_strategy && row.bid_strategy !== 'LOWEST_COST_WITHOUT_CAP' && row.bid_amount_naira ? Number(row.bid_amount_naira) : null,
          billing_event: row.billing_event || null,
          optimization_goal: row.optimization_goal || null,
          advantage_audience: row.advantage_audience !== false && !bvAudienceCount(row),
          display_name: (row.display_name || "").trim() || null,
        }))
      );
      if (adSetErr) throw adSetErr;

      // This is the actual launch -- everything above only staged rows in the
      // database. Nothing exists on Meta, and nothing shows in the Campaigns
      // tab, until this call creates the real campaign/ad sets/ads.
      await bvWalletGate();
      const launchRes = await sbFn("ai-auto-launch-tests", { creative_ids: assetIds });
      if (launchRes.error) throw new Error(launchRes.error);

      const scheduleNote = scheduledIso ? ` Scheduled to start ${new Date(scheduledIso).toLocaleString()}.` : "";
      bvToast((launchRes.message || "Launched.") + scheduleNote);
      document.getElementById("bvBuilderOverlay")?.remove();
      bvDraftDelete(bvDraftId);
      bvStagedCopies = [];
      bvReuseAsset = null;
      setTimeout(render, 400);
  } finally {
    btn.disabled = false; btn.innerHTML = "Review & Launch →";
  }
}

// ── MULTIPLE AD COPIES PER LAUNCH ────────────────────────────────────────────
// Your real Lunessa Whatsapp ad set runs 3 different ad copies side by side,
// not one -- Meta rotates delivery across them and the winner naturally gets
// more spend. This stages each copy's file+text so one "Upload to Vault"
// launches all of them together, sharing one product/campaign/ad-set setup
// (ad_set_configs), each becoming its own real ad inside every ad set.
let bvStagedCopies = [];
// Set when the user picks "Reuse a creative" instead of uploading a new file --
// carries the source creative_assets row whose media (public_url/storage_path)
// gets cloned into the new row rather than re-uploaded.
let bvReuseAsset = null;

function bvStageAdCopy() {
  const file = document.getElementById("f_file").files[0];
  const primary_text = document.getElementById("f_primary").value.trim();
  if ((!file && !bvReuseAsset) || !primary_text) {
    alert("Add a file (or reuse an existing creative) and primary text for this copy before staging another.");
    return;
  }
  bvStagedCopies.push({
    file: file || null,
    reuse_asset: bvReuseAsset,
    adset_uid: bvAdTabUid,
    ad_name: bvNextName(document.getElementById("f_ad_name")?.value.trim() || "", bvUsedAdNames().slice(0, -1)),
    ...bvFormWa(),
    primary_text,
    headline: document.getElementById("f_headline").value.trim(),
    description: document.getElementById("f_desc").value.trim(),
    mechanism: document.getElementById("f_mechanism").value,
    format: document.getElementById("f_format").value,
    cta_type: document.getElementById("f_cta").value,
  });
  // Clear only the copy-specific fields -- product/campaign/ad-set config stay shared.
  document.getElementById("f_file").value = "";
  document.getElementById("f_ad_name").value = "";
  document.getElementById("f_primary").value = "";
  document.getElementById("f_headline").value = "";
  document.getElementById("f_desc").value = "";
  document.getElementById("dzPrev").innerHTML = "";
  bvReuseAsset = null;
  bvRenderStagedCopies();
}

function bvRemoveStagedCopy(i) {
  bvStagedCopies.splice(i, 1);
  bvRenderStagedCopies();
}

function bvQuickDuplicateStagedCopy(i) {
  const src = bvStagedCopies[i];
  bvStagedCopies.splice(i + 1, 0, { ...src, ad_name: bvNextName(src.ad_name, bvAdNamesIn(src.adset_uid)) });
  bvRenderStagedCopies();
}

// Updates a staged copy's text field in place without re-rendering the list
// (a full re-render would blow away the textarea/input the person is
// actively typing in and drop focus).
function bvUpdateStagedCopy(i, key, value) {
  bvStagedCopies[i][key] = value;
}

function bvRenderStagedCopies() {
  bvDraftSoon();
  const wrap = document.getElementById("stagedCopies");
  bvRenderAdTabs();
  bvRenderBuilderSummary();
  if (!wrap) return;
  const mine = bvStagedOf(bvAdTabUid);
  if (!mine.length) { wrap.innerHTML = ""; return; }
  const cur = bvAdSetByUid(bvAdTabUid);
  wrap.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">${mine.length} ad${mine.length === 1 ? "" : "s"} saved in <b>${escH(cur ? bvAdSetName(cur) : "this ad set")}</b> (plus whatever's filled in above) — each is its own real ad when you launch. Edit any of them here, or <a href="javascript:void(0)" onclick="bvOpenAdListModal()" style="color:var(--accent);font-weight:600;">view all ads</a> across every ad set.</div>` +
    mine.map(({ c, i }) => `
      <div style="border:1px dashed var(--border);border-radius:8px;padding:10px;margin-top:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;color:var(--muted);">${c.reuse_asset ? `↺ ${escH(c.reuse_asset.file_name)} (reused)` : escH(c.file?.name || "")}</span>
          <div style="position:relative;display:flex;align-items:center;gap:6px;">
            <button type="button" onclick="bvOpenAdEdit(${i})" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:11.5px;font-weight:600;padding:0 4px;">✎ Edit</button>
            <button type="button" onclick="bvToggleKebab('bvStagedMenu-${i}', event)" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0 4px;">⋯</button>
            <div id="bvStagedMenu-${i}" class="bv-kebab-dropdown" style="display:none;right:0;left:auto;">
              <button type="button" onclick="bvCloseKebabs(); bvQuickDuplicateStagedCopy(${i})">⧉ Quickly duplicate</button>
              <button type="button" class="danger" onclick="bvCloseKebabs(); bvRemoveStagedCopy(${i})">✕ Remove</button>
            </div>
          </div>
        </div>
        <input placeholder="Ad name (optional)" value="${escH(c.ad_name || "")}" maxlength="120" style="width:100%;font-size:12px;margin-bottom:6px;" oninput="bvUpdateStagedCopy(${i}, 'ad_name', this.value)">
        <textarea rows="2" placeholder="Primary text" style="width:100%;font-size:12px;" oninput="bvUpdateStagedCopy(${i}, 'primary_text', this.value)">${escH(c.primary_text || "")}</textarea>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <input placeholder="Headline" value="${escH(c.headline || "")}" style="flex:1;font-size:12px;" oninput="bvUpdateStagedCopy(${i}, 'headline', this.value)">
          <input placeholder="Description" value="${escH(c.description || "")}" style="flex:1;font-size:12px;" oninput="bvUpdateStagedCopy(${i}, 'description', this.value)">
        </div>
      </div>`).join("");
}

// ── DUPLICATE THIS AD ────────────────────────────────────────────────────────
// For a "1 campaign / 1 ad set / N ads" structure: clones the ad currently
// filled in (creative + primary text) into N total staged ads, each still
// individually editable in the staged list above (or launch them identical).
function bvOpenDuplicateAdModal() {
  const file = document.getElementById("f_file").files[0];
  const primary = document.getElementById("f_primary").value.trim();
  if ((!file && !bvReuseAsset) || !primary) {
    alert("Fill in this ad's creative and primary text first — duplicates are cloned from it.");
    return;
  }
  const overlay = document.createElement("div");
  overlay.id = "bvDupAdModalOverlay";
  overlay.className = "bv-overlay";
  overlay.innerHTML = `
    <div class="bv-modal" style="max-width:420px;">
      <button class="bv-modal-close" onclick="this.closest('.bv-overlay').remove()">✕</button>
      <div class="ph-title" style="margin-bottom:12px;">Duplicate this ad</div>
      <div class="field"><label>Number of total ads (including this one)</label>
        <input type="number" id="dupAdCount" min="1" max="20" value="5">
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px;">Each duplicate carries this ad's creative and primary text — edit any of them afterward in the staged list, or launch them as-is.</div>
      <button type="button" class="btn btn-a btn-full" style="margin-top:16px;" onclick="bvConfirmDuplicateAd()">Duplicate</button>
    </div>`;
  document.body.appendChild(overlay);
}

function bvConfirmDuplicateAd() {
  const count = Math.max(1, Math.min(20, Number(document.getElementById("dupAdCount").value) || 1));
  const file = document.getElementById("f_file").files[0];
  const base = {
    file: file || null,
    reuse_asset: bvReuseAsset,
    adset_uid: bvAdTabUid,
    ad_name: document.getElementById("f_ad_name").value.trim(),
    ...bvFormWa(),
    primary_text: document.getElementById("f_primary").value.trim(),
    headline: document.getElementById("f_headline").value.trim(),
    description: document.getElementById("f_desc").value.trim(),
    mechanism: document.getElementById("f_mechanism").value,
    format: document.getElementById("f_format").value,
    cta_type: document.getElementById("f_cta").value,
  };
  const usedNames = bvAdNamesIn(bvAdTabUid);
  for (let n = 0; n < count; n++) {
    const seed = base.ad_name ? (count > 1 ? `${base.ad_name} ${n + 1}` : base.ad_name) : "";
    const name = bvNextName(seed, usedNames);
    usedNames.push(name);
    bvStagedCopies.push({ ...base, ad_name: name });
  }
  // Clear the form -- all copies (including the one just filled in) now live
  // in the staged list below, each individually editable there.
  document.getElementById("f_file").value = "";
  document.getElementById("f_ad_name").value = "";
  document.getElementById("f_primary").value = "";
  document.getElementById("f_headline").value = "";
  document.getElementById("f_desc").value = "";
  document.getElementById("dzPrev").innerHTML = "";
  bvReuseAsset = null;
  document.getElementById("bvDupAdModalOverlay")?.remove();
  bvRenderStagedCopies();
  bvToast(`${count} ad${count === 1 ? "" : "s"} added below — see them all with "View all ads".`);
}

// Meta's "Quickly duplicate" — one instant copy, no dialog, the original
// form stays filled in exactly as it was (unlike "+ Add another ad copy",
// which clears the form for the next one).
function bvQuickDuplicateAd() {
  const file = document.getElementById("f_file").files[0];
  const primary = document.getElementById("f_primary").value.trim();
  if ((!file && !bvReuseAsset) || !primary) {
    alert("Fill in this ad's creative and primary text first — duplicates are cloned from it.");
    return;
  }
  bvStagedCopies.push({
    file: file || null,
    reuse_asset: bvReuseAsset,
    adset_uid: bvAdTabUid,
    ad_name: bvNextName(document.getElementById("f_ad_name").value.trim(), bvUsedAdNames()),
    ...bvFormWa(),
    primary_text: primary,
    headline: document.getElementById("f_headline").value.trim(),
    description: document.getElementById("f_desc").value.trim(),
    mechanism: document.getElementById("f_mechanism").value,
    format: document.getElementById("f_format").value,
    cta_type: document.getElementById("f_cta").value,
  });
  bvRenderStagedCopies();
}

// ── KEBAB (⋯) ACTION MENUS ───────────────────────────────────────────────────
// Small dropdowns mirroring Meta's own "⋯" menu on a campaign/ad-set/ad row
// (Duplicate / Quickly duplicate / Delete). Only one open at a time.
// Right-hand live summary panel, mirroring the "Campaign score" panel on
// Meta's own campaign-creation screen -- a running snapshot of what's about
// to launch, visible no matter which tab (Campaign/Ad set/Ad) is open.
function bvRenderBuilderSummary() {
  const el = document.getElementById("bvBuilderSummary");
  if (!el) return;
  const isWhatsapp = document.querySelector('input[name="f_destination"]:checked')?.value === "whatsapp";
  const objSelect = document.getElementById("f_objective");
  const objLabel = objSelect?.options[objSelect.selectedIndex]?.text?.split(" — ")[0] || "—";
  const campaignName = document.getElementById("f_campaign_name")?.value.trim() || "(untitled campaign)";
  const budgetType = document.getElementById("f_budget_type")?.value === "cbo" ? "CBO" : "ABO";
  const adSetCount = bvAdSetRows.length;
  const totalBudget = bvAdSetRows.reduce((s, r) => s + (Number(r.budget_naira) || 0), 0);
  const currentFile = document.getElementById("f_file")?.files?.[0];
  const currentPrimary = document.getElementById("f_primary")?.value.trim();
  const adCount = bvStagedCopies.length + ((currentFile || bvReuseAsset) && currentPrimary ? 1 : 0);
  const perSet = bvAdSetRows.map(r => ({ r, n: bvAdsCountFor(r.uid) }));
  const adCountEl = document.getElementById("bvAdCount");
  if (adCountEl) adCountEl.textContent = adCount;
  bvRenderAdTabs();
  const acc = (window.accountsList || accountsList || []).find(a => a.id === activeAccountId);

  const pvImg = document.querySelector("#dzPrev .dz-thumb")?.src || "";
  const pvPage = acc?.fb_page_name || acc?.nickname || acc?.name || "Your page";
  const pvText = document.getElementById("f_primary")?.value.trim() || "Your ad text appears here.";
  const pvHead = document.getElementById("f_headline")?.value.trim() || "";
  const ctaSel = document.getElementById("f_cta");
  const pvCta = isWhatsapp ? "Send message" : (ctaSel?.options[ctaSel.selectedIndex]?.text || "Shop Now");
  el.innerHTML = `
    <div class="bv-builder-summary-card wz-prev">
      <div class="bv-builder-summary-title">Preview</div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">How your ad looks in the feed</div>
      <div class="wz-phone"><div class="wz-pg"><span class="wz-av">${escH(pvPage.slice(0, 2).toUpperCase())}</span><b>${escH(pvPage)}</b><i>Sponsored</i></div>
        <div class="wz-pt">${escH(pvText.length > 140 ? pvText.slice(0, 140) + "…" : pvText)}</div>
        <div class="wz-img">${pvImg ? `<img src="${pvImg}" alt="">` : ""}</div>
        ${pvHead ? `<div class="wz-hd">${escH(pvHead)}</div>` : ""}
        <div class="wz-cta">${escH(pvCta)}</div></div>
    </div>
    <div class="bv-builder-summary-card">
      <div class="bv-builder-summary-title">Campaign score</div>
      <div style="font-size:11.5px;color:var(--muted);line-height:1.5;">
        ${acc?.fb_page_id ? "✓ Page connected" : "⚠ No Page connected"}<br>
        ${!isWhatsapp || acc?.meta_pixel_id ? "" : "⚠ No pixel connected<br>"}
        ${adSetCount ? "✓" : "⚠"} ${adSetCount} ad set${adSetCount === 1 ? "" : "s"} configured<br>
        ${adCount ? "✓" : "⚠"} ${adCount} ad${adCount === 1 ? "" : "s"} in total
        ${perSet.map(x => `<br>&nbsp;&nbsp;${x.n ? "✓" : "⚠"} ${escH(bvAdSetName(x.r))}: ${x.n ? x.n + " ad" + (x.n === 1 ? "" : "s") : "no ads yet"}`).join("")}
      </div>
    </div>
    <div class="bv-builder-summary-card">
      <div class="bv-builder-summary-title">${escH(campaignName)}</div>
      <dl>
        <dt>Objective</dt><dd>${escH(objLabel)}</dd>
        <dt>Destination</dt><dd>${{ whatsapp: "WhatsApp", website: "Website", messenger: "Messenger", instagram: "Instagram DM", form: "Instant form" }[document.querySelector('input[name="f_destination"]:checked')?.value] || "Website"}</dd>
        <dt>Budget type</dt><dd>${budgetType}</dd>
        <dt>Ad sets</dt><dd>${adSetCount}</dd>
        <dt>Ads</dt><dd>${adCount}</dd>
        <dt>Total daily budget</dt><dd>₦${totalBudget.toLocaleString()}</dd>
      </dl>
    </div>`;
}

function bvCloseKebabs() {
  document.querySelectorAll(".bv-kebab-dropdown").forEach(el => el.style.display = "none");
}
function bvToggleKebab(id, event) {
  event?.stopPropagation();
  const el = document.getElementById(id);
  const wasOpen = el.style.display === "block";
  bvCloseKebabs();
  el.style.display = wasOpen ? "none" : "block";
  if (!wasOpen) setTimeout(() => el.scrollIntoView({ block: "nearest" }), 0);
}
document.addEventListener("click", bvCloseKebabs);

// Fills the read-only Identity/Tracking fields in the Ad tab from the
// currently active ad account's row -- fb_page_name/whatsapp_number/
// pixel_name are cached there by Settings' "Verify" flow (one real call to
// Meta, done once), so opening the builder never has to call Meta live and
// can't fail with "couldn't reach Meta" here. If an account hasn't been
// verified yet, this just says so and points at Settings instead of
// retrying a live lookup.
function bvLoadBuilderIdentity() {
  bvRenderIdentitySection();
  bvRenderWhatsappPicker();
}

// The Page's own connected WhatsApp number (if any was cached on the ad
// account row by Settings' Verify flow) -- lets someone pick it with one
// click instead of retyping it, the same way Meta's own ad form offers a
// dropdown of numbers already linked to the Page/Business.
function bvRenderWhatsappPicker() {
  const el = document.getElementById("f_whatsappPicker");
  if (!el) return;
  const acc = (window.accountsList || accountsList || []).find(a => a.id === activeAccountId);
  if (acc?.whatsapp_number) {
    el.innerHTML = `<button type="button" class="btn btn-g" style="width:auto;padding:5px 10px;font-size:11.5px;" onclick="document.getElementById('f_whatsapp_number').value='${escH(acc.whatsapp_number)}'; bvRenderIdentitySection(); bvRenderBuilderSummary();">✓ Use ${escH(acc.whatsapp_number)} <span style="color:var(--muted);">— connected to ${escH(acc.fb_page_name || "this Page")}</span></button>`;
  } else {
    el.innerHTML = `<div style="font-size:11px;color:var(--muted);">No WhatsApp number saved for this ad account yet — type it in manually, or verify the connection in Settings → Pixel & Page Connections to save it for next time.</div>`;
  }
}

function bvRenderIdentitySection() {
  const acc = (window.accountsList || accountsList || []).find(a => a.id === activeAccountId);
  const idEl = document.getElementById("f_identityValue");
  const pxEl = document.getElementById("f_pixelValue");
  if (idEl) {
    if (!acc?.fb_page_id) {
      idEl.innerHTML = `<span style="color:var(--danger);">⚠ No Facebook Page connected to this ad account — set it in Settings → Pixel & Page Connections before launching.</span>`;
    } else {
      idEl.innerHTML = acc.fb_page_name
        ? `✓ ${escH(acc.fb_page_name)} <span style="color:var(--muted);">(${escH(acc.fb_page_id)})</span>`
        : `${escH(acc.fb_page_id)} <span style="color:var(--muted);">— not yet verified. <a href="javascript:void(0)" onclick="bvGoToTab('settings')" style="color:var(--accent);">Verify in Settings</a> to see its name and save its WhatsApp number.</span>`;
    }
  }
  if (pxEl) {
    if (!acc?.meta_pixel_id) {
      pxEl.innerHTML = `<span style="color:var(--muted);">No pixel connected — Sales-objective ads need one (Settings → Pixel & Page Connections).</span>`;
    } else {
      pxEl.innerHTML = acc.pixel_name
        ? `✓ ${escH(acc.pixel_name)} <span style="color:var(--muted);">(${escH(acc.meta_pixel_id)})</span>`
        : `${escH(acc.meta_pixel_id)} <span style="color:var(--muted);">— not yet verified.</span>`;
    }
  }

  const isWhatsapp = document.querySelector('input[name="f_destination"]:checked')?.value === "whatsapp";
  const waField = document.getElementById("f_identityWhatsappField");
  const waEl = document.getElementById("f_identityWhatsappValue");
  if (waField) waField.style.display = isWhatsapp ? "" : "none";
  if (waEl && isWhatsapp) {
    const num = document.getElementById("f_whatsapp_number")?.value.trim();
    if (num) {
      waEl.innerHTML = `✓ ${escH(num)}`;
    } else if (acc?.whatsapp_number) {
      waEl.innerHTML = `<button type="button" class="btn btn-g" style="width:auto;padding:5px 10px;font-size:11.5px;" onclick="document.getElementById('f_whatsapp_number').value='${escH(acc.whatsapp_number)}'; bvRenderIdentitySection(); bvRenderBuilderSummary();">✓ Use ${escH(acc.whatsapp_number)}</button>`;
    } else {
      waEl.innerHTML = `<span style="color:var(--muted);">Not set — enter it in the Destination section above.</span>`;
    }
  }
}