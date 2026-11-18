// Revora dashboard, part 04 of 23: ADMIN OVERVIEW: the whole company at a glance (no ad-account context; each buyer's ads are their own) · QUICK ACTION HANDLERS · TAB: CREATIVE VAULT · CAMPAIGN BUILDER (big modal, Meta Ads Manager-style tabs) · CAMPAIGN DRAFTS


// ── ADMIN OVERVIEW: the whole company at a glance (no ad-account context; each buyer's ads are their own) ──
async function renderAdminOverview(el) {
  const since = watDate(-6), prev = watDate(-13);
  const [orders, buyers, wallet, setup] = await Promise.all([
    sbQuery("orders", `select=order_status,order_value_naira,media_buyer_id,ordered_at&ordered_at=gte.${prev}T00:00:00%2B01:00&limit=5000`).catch(() => []),
    sbQuery("media_buyers", "select=id,code,name&order=code.asc").catch(() => []),
    fetchWalletBalances().catch(() => ({ walletBalances: {}, fundingWalletBalance: 0 })),
    bvSetupState().catch(() => null),
  ]);
  const cut = new Date(since + "T00:00:00+01:00").getTime();
  const cur = [], old = [];
  (orders || []).forEach(o => (new Date(o.ordered_at).getTime() >= cut ? cur : old).push(o));
  const sum = a => a.reduce((t, o) => t + Number(o.order_value_naira || 0), 0);
  const cnt = (a, st) => a.filter(o => o.order_status === st).length;
  const done = a => a.filter(o => ["delivered", "returned", "cancelled", "failed"].includes(o.order_status)).length;
  const rateOf = a => { const d = done(a); return d ? cnt(a, "delivered") / d * 100 : null; };
  const delta = (c, p) => p ? `${c >= p ? "▲" : "▼"} ${Math.abs((c - p) / p * 100).toFixed(0)}% vs previous 7 days` : "no earlier data";
  const rate = rateOf(cur);
  const byBuyer = new Map();
  cur.forEach(o => { const k = o.media_buyer_id || "none"; const r = byBuyer.get(k) || { n: 0, rev: 0, del: 0, ret: 0 }; r.n++; r.rev += Number(o.order_value_naira || 0); if (o.order_status === "delivered") r.del++; if (o.order_status === "returned") r.ret++; byBuyer.set(k, r); });
  const nameOf = id => { const b = (buyers || []).find(x => x.id === id); return b ? (b.name || b.code) : "Unassigned"; };
  const rows = [...byBuyer.entries()].sort((a, b) => b[1].n - a[1].n);
  const fund = wallet.fundingWalletBalance;
  el.innerHTML = `
    <div class="sh"><div class="sh-title">Company overview</div><div class="sh-actions" id="qaActions"></div></div>
    ${fund != null ? `<div class="wallet-chip" onclick="bvGoToTab('wallet')">💰 ${fund < 0 ? "⚠️ Funding wallet low" : "Funding wallet"}: ${fN(fund)} <span style="opacity:.7;">→ Wallet</span></div>` : ""}
    ${setup && !setup.done ? bvSetupChecklistHtml(setup) : ""}
    <div class="g4">
      <div class="kc"><div class="kc-lbl">Orders · 7 days</div><div class="kc-val">${cur.length}</div><div class="kc-sub">${delta(cur.length, old.length)}</div></div>
      <div class="kc"><div class="kc-lbl">Order value · 7 days</div><div class="kc-val a">${fN(sum(cur))}</div><div class="kc-sub">${delta(sum(cur), sum(old))}</div></div>
      <div class="kc"><div class="kc-lbl">Delivery rate · 7 days</div><div class="kc-val ${rate == null ? "" : rate >= 70 ? "a" : rate >= 50 ? "w" : "d"}">${rate == null ? "—" : rate.toFixed(0) + "%"}</div><div class="kc-sub">${cnt(cur, "delivered")} delivered · ${cnt(cur, "returned")} returned</div></div>
      <div class="kc"><div class="kc-lbl">Waiting to be handled</div><div class="kc-val ${cnt(cur, "pending") ? "w" : ""}">${cnt(cur, "pending")}</div><div class="kc-sub">pending orders this week</div></div>
    </div>
    <div class="panel">
      <div class="ph"><div class="ph-title">Media buyers · last 7 days</div><div class="ph-count">${(buyers || []).length} buyers</div></div>
      ${!rows.length ? `<div class="empty"><div class="empty-ico">📦</div>No orders in the last 7 days.</div>` : `<div class="tbl-wrap"><table>
        <tr><th>Buyer</th><th>Orders</th><th>Order value</th><th>Delivered</th><th>Returned</th></tr>
        ${rows.map(([id, r]) => `<tr><td class="s n">${escH(id === "none" ? "Unassigned" : nameOf(id))}</td><td>${r.n}</td><td>${fN(r.rev)}</td><td>${r.del}</td><td>${r.ret}</td></tr>`).join("")}
      </table></div>`}
      <div style="font-size:11.5px;color:var(--muted);margin-top:10px;">Ad spend and campaigns are personal to each buyer. See ROAS per buyer on <a href="javascript:void(0)" onclick="bvGoToTab('leaderboard')" style="color:var(--accent);">Leaderboard</a>.</div>
    </div>`;
}

// ── QUICK ACTION HANDLERS ─────────────────────────────────────────────────────
async function triggerMetrics() {
  const btn = document.getElementById("btnPull");
  const res = document.getElementById("actionResult");
  if (!btn) return;
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Pulling…';
  try {
    const r = await sbFn("pull-meta-metrics", { ad_account_id: activeAccountId });
    if (res) res.innerHTML = r.error
      ? `<div class="msg err">❌ ${r.error}</div>`
      : `<div class="msg ok">✅ Metrics updated. ${r.processed ?? ""} ad sets processed.</div>`;
    if (!r.error) setTimeout(render, 1200);
  } catch(e) {
    if (res) res.innerHTML = `<div class="msg err">❌ ${e.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "📊 Pull Meta Metrics"; }
  }
}

// Pulls every real campaign/ad set/ad directly from Meta and writes them into
// this dashboard's tables -- the only thing that makes campaigns launched
// straight in Ads Manager (not through this dashboard) show up here at all.
// There was no button calling this anywhere before; it only ever ran when
// triggered directly against the API.
async function triggerStructureSync() {
  const btn = document.getElementById("btnStructSync");
  const res = document.getElementById("actionResult");
  if (!btn) return;
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Syncing…';
  try {
    const r = await sbFn("sync-meta-structure", {});
    if (res) res.innerHTML = r.error
      ? `<div class="msg err">❌ Sync failed: ${r.error}</div>`
      : `<div class="msg ok">✅ Synced from Meta: ${r.summary?.campaigns ?? 0} campaigns, ${r.summary?.ad_sets ?? 0} ad sets, ${r.summary?.ads ?? 0} ads.${r.summary?.errors?.length ? ` (${r.summary.errors.length} account error(s), check console)` : ""}</div>`;
    if (r.summary?.errors?.length) console.warn("sync-meta-structure errors:", r.summary.errors);
    setTimeout(render, 1200);
  } catch(e) {
    if (res) res.innerHTML = `<div class="msg err">❌ ${e.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "☁️ Sync from Meta"; }
  }
}

async function triggerSync() {
  const btn = document.getElementById("btnSync");
  const res = document.getElementById("actionResult");
  if (!btn) return;
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Syncing…';
  try {
    const r = await sbFn("sync-meta-audiences", { ad_account_id: activeAccountId });
    if (res) res.innerHTML = r.error
      ? `<div class="msg err">❌ Sync failed: ${r.error}</div>`
      : `<div class="msg ok">✅ Audiences synced to Meta successfully.</div>`;
  } catch(e) {
    if (res) res.innerHTML = `<div class="msg err">❌ ${e.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "🔄 Sync Audiences"; }
  }
}

// Destination (WhatsApp vs Website) is now a direct, explicit choice in the
// builder -- it no longer requires or inherits from a linked product. Toggles
// which field (WhatsApp number / landing URL) is shown and asked for, and
// whether the CTA select applies (Meta forces its own "Send Message" CTA on
// WhatsApp ads, so that field is irrelevant there).
function bvOnDestinationChange() {
  const destVal = document.querySelector('input[name="f_destination"]:checked')?.value || "whatsapp";
  const isWhatsapp = destVal === "whatsapp";
  const isMsgDest = destVal !== "website"; // chat or form: no website link, Meta supplies the button
  document.getElementById("f_whatsappNumberField").style.display = isWhatsapp ? "" : "none";
  document.getElementById("f_landingUrlField").style.display = isMsgDest ? "none" : "";
  const ctaSelect = document.getElementById("f_cta");
  const ctaNote = document.getElementById("f_ctaNote");
  if (ctaSelect) ctaSelect.disabled = isMsgDest;
  const waBox = document.getElementById("f_waMsgBox");
  if (waBox) waBox.style.display = isWhatsapp ? "" : "none";
  const idWa = document.getElementById("f_identityWhatsappField");
  if (idWa) idWa.style.display = isWhatsapp ? "" : "none";
  if (ctaNote) ctaNote.innerHTML = isMsgDest ? `Ignored for chat ads — Meta uses its own message button automatically.` : "";
  bvRenderAdSetRows();
  bvRenderBuilderSummary();
  bvRenderWhatsappPicker();
}

// Linking a product is now optional (for Shop checkout + Purchase-pixel
// tracking only) -- picking one prefills the destination fields above from
// its own settings, but never clobbers something already typed in, and the
// destination radio itself always stays the source of truth for launching.
function bvOnProductChange() {
  const productId = document.getElementById("f_product")?.value;
  const el = document.getElementById("f_productDestination");
  const p = (window.bvVaultProductsCache || []).find(x => x.id === productId);
  if (!p) { if (el) el.textContent = ""; return; }

  if (p.destination_type === "whatsapp") {
    document.querySelector('input[name="f_destination"][value="whatsapp"]').checked = true;
    const numField = document.getElementById("f_whatsapp_number");
    if (!numField.value.trim() && p.whatsapp_number) numField.value = p.whatsapp_number;
    if (el) el.innerHTML = `Prefilled from this product's WhatsApp number — still editable above.`;
  } else {
    document.querySelector('input[name="f_destination"][value="website"]').checked = true;
    const urlField = document.getElementById("f_landing_url");
    if (!urlField.value.trim() && p.landing_page_url) urlField.value = p.landing_page_url;
    if (el) el.innerHTML = `Prefilled from this product's landing page — still editable above.`;
  }
  bvOnDestinationChange();
  bvPrefillFromShopDefaults(p);
}

// The Shop tab's ad defaults (primary text/headline/description/CTA set
// there, per product) seed a brand-new upload here instead of starting
// blank -- only fields the person hasn't already typed something into,
// so picking a different product never clobbers copy they're mid-writing.
function bvPrefillFromShopDefaults(p) {
  const primaryEl = document.getElementById("f_primary");
  const headlineEl = document.getElementById("f_headline");
  const descEl = document.getElementById("f_desc");
  const ctaEl = document.getElementById("f_cta");
  if (!primaryEl) return;
  if (!primaryEl.value && p.ad_primary_text) primaryEl.value = p.ad_primary_text;
  if (headlineEl && !headlineEl.value && p.ad_headline) headlineEl.value = p.ad_headline;
  if (descEl && !descEl.value && p.ad_description) descEl.value = p.ad_description;
  if (ctaEl && !ctaEl.disabled && p.ad_cta_type) ctaEl.value = p.ad_cta_type;
}

// ── TAB: CREATIVE VAULT ───────────────────────────────────────────────────────
async function renderVault(el) {
  const [assets, products] = await Promise.all([
    sbQuery("creative_assets", "select=*,products(product_name)&order=uploaded_at.desc&limit=100"),
    sbQuery("products", "is_active=eq.true&select=id,product_name,destination_type,landing_page_url,whatsapp_number,ad_primary_text,ad_headline,ad_description,ad_cta_type"),
  ]);

  const pOpts  = (products||[]).map(p => `<option value="${p.id}">${p.product_name}</option>`).join("");
  const all    = assets?.length ?? 0;
  const untest = (assets||[]).filter(a => ["untested","pending_test"].includes(a.test_status ?? a.status)).length;
  const test   = (assets||[]).filter(a => ["testing","active"].includes(a.test_status ?? a.status)).length;
  const wins   = (assets||[]).filter(a => ["winner","winning"].includes(a.test_status ?? a.status)).length;

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Creative Vault</div></div>

    <div class="g4" style="margin-bottom:18px;">
      <div class="kc"><div class="kc-lbl">Total</div><div class="kc-val">${all}</div><div class="kc-sub">in vault</div></div>
      <div class="kc"><div class="kc-lbl">Untested</div><div class="kc-val">${untest}</div><div class="kc-sub">ready to queue</div></div>
      <div class="kc"><div class="kc-lbl">Testing</div><div class="kc-val w">${test}</div><div class="kc-sub">live now</div></div>
      <div class="kc"><div class="kc-lbl">Winners</div><div class="kc-val a">${wins}</div><div class="kc-sub">proven</div></div>
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Launch a campaign</div></div>
      <div style="font-size:12px;color:var(--muted);margin:-4px 0 14px;line-height:1.5;">
        Build a Campaign → Ad Set → Ad in one guided flow, Meta Ads Manager-style — pick what you're promoting, set targeting and budget, add the creative, then review and launch.
      </div>
      <button type="button" class="btn btn-a" style="width:auto;padding:10px 22px;" onclick="bvOpenObjectiveGateModal()">+ New Campaign</button>
      <button type="button" class="btn btn-g" style="width:auto;padding:10px 18px;margin-left:8px;" onclick="bvOpenDraftsModal()">📝 Drafts</button>
    </div>

    <div class="panel">
      <div class="ph">
        <div class="ph-title">All creatives</div>
        <div class="ph-count">${all} total</div>
      </div>
      ${!all ? `<div class="empty"><div class="empty-ico">🎨</div>No creatives uploaded yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>File</th><th>Product</th><th>Mechanism</th><th>Format</th><th>Status</th><th>Uploaded</th></tr>
        ${assets.map(a => `<tr class="bv-clickable-row" onclick="bvShowCreativeDetail('${a.id}')">
          <td class="s n" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.file_name ?? a.asset_name ?? "—"}</td>
          <td class="n">${a.products?.product_name ?? "—"}</td>
          <td>${(a.mechanism ?? "—").replace(/_/g," ")}</td>
          <td>${(a.format ?? "—").replace(/_/g," ")}</td>
          <td><span class="pill ${(a.test_status ?? a.status ?? "untested").replace(/ /g,"_")}">${(a.test_status ?? a.status ?? "untested").replace(/_/g," ")}</span></td>
          <td>${ago(a.uploaded_at)}</td>
        </tr>`).join("")}
      </table></div>`}
    </div>`;

  window.bvVaultProductsCache = products || [];
  window.bvVaultAssetsCache = assets || [];
  window.bvVaultProductOpts = pOpts;
}

// ── CAMPAIGN BUILDER (big modal, Meta Ads Manager-style tabs) ───────────────
// Replaces the old single long scrolling form: a real modal with Campaign /
// Ad Set / Ad tabs, each its own scrollable pane, product picker pinned at
// the top since it drives both targeting (destination/objective lock) and
// the ad's own link/CTA. Same ids/state/logic as before (bvAdSetRows,
// bvStagedCopies, bvReuseAsset, bvExecuteLaunch etc.) -- this only changes
// the layout those hook into.
// Objective-first gate (mirrors Meta's own "Create new campaign" picker) --
// shown before the builder itself. Picking a non-Sales objective also
// defaults the destination radio to Website, since WhatsApp always forces
// Sales/Conversations (a real Meta requirement) and would otherwise silently
// override whatever was just picked here.
const OBJECTIVE_GATE_OPTIONS = [
  { value: "OUTCOME_AWARENESS", icon: "📣", label: "Awareness", desc: "Reach as many people as possible" },
  { value: "OUTCOME_TRAFFIC", icon: "👆", label: "Traffic", desc: "Drive clicks to your link" },
  { value: "OUTCOME_ENGAGEMENT", icon: "💬", label: "Engagement", desc: "Likes, comments, shares on the post" },
  { value: "OUTCOME_LEADS", icon: "🎯", label: "Leads", desc: "People who sign up or message you" },
  { value: "OUTCOME_SALES", icon: "🛒", label: "Sales", desc: "Drive purchases — also what WhatsApp ads always use" },
];

function bvOpenObjectiveGateModal() {
  const overlay = document.createElement("div");
  overlay.id = "bvObjectiveGateOverlay";
  overlay.className = "bv-overlay";
  overlay.innerHTML = `
    <div class="bv-modal" style="max-width:480px;">
      <button class="bv-modal-close" onclick="this.closest('.bv-overlay').remove()">✕</button>
      <div class="ph-title" style="margin-bottom:4px;">Create new campaign</div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:16px;">Choose a campaign objective — the business goal you want Meta to optimize delivery for.</div>
      <div>
        ${OBJECTIVE_GATE_OPTIONS.map(o => `
          <label class="bv-objective-opt${o.disabled ? " disabled" : ""}">
            <input type="radio" name="gateObjective" value="${o.value}" ${o.disabled ? "disabled" : ""} onchange="document.getElementById('gateContinueBtn').disabled = false;">
            <span class="bv-objective-ico">${o.icon}</span>
            <span>
              <div style="font-weight:600;font-size:13px;">${o.label}</div>
              <div style="font-size:11px;color:var(--muted);">${o.desc}</div>
            </span>
          </label>`).join("")}
      </div>
      <div style="display:flex;gap:10px;margin-top:18px;">
        <button type="button" class="btn btn-g" style="flex:1;" onclick="this.closest('.bv-overlay').remove()">Cancel</button>
        <button type="button" class="btn btn-a" style="flex:1;" id="gateContinueBtn" disabled onclick="bvConfirmObjectiveGate()">Continue</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function bvConfirmObjectiveGate() {
  const val = document.querySelector('input[name="gateObjective"]:checked')?.value;
  document.getElementById("bvObjectiveGateOverlay")?.remove();
  bvOpenCampaignBuilder(val);
}

// ── CAMPAIGN DRAFTS ──────────────────────────────────────────────────────────
// The builder saves itself a moment after every change (settings, ad sets, ads, even the
// attached image/video) so a half-built campaign can be continued later, from any device.
let bvDraftId = null, bvDraftTimer = null, bvDraftBusy = false, bvDraftRestoring = false, bvDraftDirty = false;
const BV_DRAFT_FIELDS = ["f_whatsapp_number", "f_landing_url", "f_product", "f_campaign_name", "f_objective", "f_budget_type", "f_scheduled", "f_end_date", "f_ad_name", "f_wa_greeting", "f_wa_prefill", "f_primary", "f_headline", "f_desc", "f_mechanism", "f_format", "f_cta"];
const bvDraftStatus = t => { const el = document.getElementById("bvDraftStatus"); if (el) el.textContent = t; };

function bvDraftStart() {
  if (!bvDraftRestoring) bvDraftId = null;
  const ov = document.getElementById("bvBuilderOverlay");
  ov?.addEventListener("input", bvDraftSoon);
  ov?.addEventListener("change", bvDraftSoon);
}
function bvDraftSoon() {
  if (bvDraftRestoring || !document.getElementById("bvBuilderOverlay")) return;
  bvDraftDirty = true;
  clearTimeout(bvDraftTimer);
  bvDraftTimer = setTimeout(bvDraftSave, 1500);
}

async function bvDraftUpload(file) {
  if (!file) return null;
  if (file.__draftPath) return { path: file.__draftPath, name: file.name, type: file.type };
  if (file.__draftFail) return null;
  const uid = sessionData?.user?.id;
  const path = `${uid}/${bvDraftId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
  const { error } = await supabaseClient.storage.from("draft-media").upload(path, file, { contentType: file.type || undefined });
  if (error) { file.__draftFail = true; return null; }
  file.__draftPath = path;
  return { path, name: file.name, type: file.type };
}

async function bvDraftSave() {
  if (bvDraftBusy) { bvDraftSoon(); return; }
  const g = id => document.getElementById(id);
  if (!g("bvBuilderOverlay") || !bvDraftDirty) return;
  const formFile = g("f_file")?.files?.[0] || null;
  const hasContent = g("f_campaign_name")?.value.trim() || bvStagedCopies.length || g("f_primary")?.value.trim() || formFile;
  if (!hasContent) return;
  bvDraftBusy = true; bvDraftDirty = false;
  bvDraftStatus("Saving draft…");
  try {
    if (!bvDraftId) {
      const { data, error } = await supabaseClient.from("campaign_drafts").insert({ ad_account_id: activeAccountId || null, name: g("f_campaign_name")?.value.trim() || null, state: {} }).select("id").single();
      if (error) throw error;
      bvDraftId = data.id;
    }
    const fields = {};
    for (const id of BV_DRAFT_FIELDS) if (g(id)) fields[id] = g(id).value;
    fields.destination = document.querySelector('input[name="f_destination"]:checked')?.value || "whatsapp";
    let lost = 0;
    const copies = [];
    for (const c of bvStagedCopies) {
      const { file, ...rest } = c;
      const ref = file ? await bvDraftUpload(file) : null;
      if (file && !ref) lost++;
      copies.push({ ...rest, file_ref: ref });
    }
    const formRef = formFile ? await bvDraftUpload(formFile) : null;
    if (formFile && !formRef) lost++;
    const state = {
      v: 1, step: g("bvBuilderOverlay")?.getAttribute("data-step") || "campaign", fields,
      adsets: bvAdSetRows, copies, adTabUid: bvAdTabUid, formFile: formRef, formReuse: bvReuseAsset, lost,
    };
    const { error } = await supabaseClient.from("campaign_drafts").update({ name: fields.f_campaign_name?.trim() || null, state, ad_account_id: activeAccountId || null, updated_at: new Date().toISOString() }).eq("id", bvDraftId);
    if (error) throw error;
    bvDraftStatus(lost ? `Draft saved · ${lost} file${lost === 1 ? " is" : "s are"} too big to keep — re-attach later` : "Draft saved ✓");
  } catch (e) {
    bvDraftStatus("Couldn't save draft");
  }
  bvDraftBusy = false;
  if (bvDraftDirty) bvDraftSoon();
}

async function bvDraftDelete(id) {
  if (!id) return;
  try {
    const { data } = await supabaseClient.from("campaign_drafts").select("state").eq("id", id).maybeSingle();
    const paths = [...(data?.state?.copies || []).map(c => c.file_ref?.path), data?.state?.formFile?.path].filter(Boolean);
    if (paths.length) await supabaseClient.storage.from("draft-media").remove(paths);
    await supabaseClient.from("campaign_drafts").delete().eq("id", id);
  } catch {}
}

async function bvOpenDraftsModal() {
  document.getElementById("bvObjectiveGateOverlay")?.remove();
  bvOpenSheet("bvDraftsOverlay", `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('bvDraftsOverlay')">✕</button>
    <div class="ph-title" style="margin-bottom:4px;">Saved drafts</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Campaigns you started but didn't launch. They save themselves as you build.</div>
    <div id="bvDraftsBody"><div class="empty" style="padding:20px;">Loading…</div></div>`, 560);
  let rows = [];
  try { rows = await sbQuery("campaign_drafts", "select=id,name,ad_account_id,updated_at,state&order=updated_at.desc&limit=30"); } catch {}
  const body = document.getElementById("bvDraftsBody");
  if (!body) return;
  // Plans planned by an AI assistant (Revora AI, ChatGPT or Claude through the connector) wait here until you approve them.
  let aiPlans = [];
  try { aiPlans = await sbQuery("ai_plans", "select=id,created_at&status=eq.draft&order=created_at.desc&limit=5"); } catch {}
  const aiHost = document.createElement("div");
  if (Array.isArray(aiPlans) && aiPlans.length) {
    aiHost.innerHTML = `<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:4px 0 8px;">From your AI assistant (waiting for your approval)</div>`;
    for (const pl of aiPlans) {
      const r = await sbFn("ai-chat", { action: "update_plan", plan_id: pl.id, edits: {} }).catch(() => null);
      if (r?.card) { const w = document.createElement("div"); w.style.marginBottom = "12px"; w.appendChild(ccPlan(r.card)); aiHost.appendChild(w); }
    }
  }
  if (!Array.isArray(rows) || !rows.length) { body.innerHTML = aiHost.children.length ? "" : `<div class="empty" style="padding:20px;">No drafts yet. Start a campaign and it saves itself here.</div>`; if (aiHost.children.length) body.appendChild(aiHost); return; }
  body.innerHTML = rows.map(d => {
    const st = d.state || {}, n = (st.copies || []).length + (st.formFile ? 1 : 0), sets = (st.adsets || []).length || 1;
    const acct = accountsList.find(a => a.id === d.ad_account_id);
    return `<div class="bv-listrow">
      <div class="bv-listmain"><div class="bv-listname">${escH(d.name || "Untitled campaign")}</div>
        <div class="bv-listsub">${sets} ad set${sets === 1 ? "" : "s"} · ${n} ad${n === 1 ? "" : "s"}${acct ? ` · ${escH(acct.nickname || acct.name || "")}` : ""} · ${ago(d.updated_at)}</div></div>
      <button type="button" class="btn btn-a" style="width:auto;padding:6px 14px;font-size:12px;" onclick="bvResumeDraft('${d.id}')">Continue</button>
      <button type="button" class="btn btn-g" style="width:auto;padding:6px 10px;font-size:12px;margin-left:6px;" onclick="bvDeleteDraftRow('${d.id}', this)" aria-label="Delete draft">🗑</button>
    </div>`;
  }).join("");
  if (aiHost.children.length) {
    aiHost.insertAdjacentHTML("beforeend", `<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:14px 0 8px;">Drafts you started yourself</div>`);
    body.prepend(aiHost);
  }
}
async function bvDeleteDraftRow(id, btn) {
  if (!confirm("Delete this draft? This can't be undone.")) return;
  await bvDraftDelete(id);
  btn.closest(".bv-listrow")?.remove();
  if (!document.querySelector("#bvDraftsBody .bv-listrow")) bvOpenDraftsModal();
}

async function bvResumeDraft(id) {
  let d;
  try { [d] = await sbQuery("campaign_drafts", `id=eq.${id}&select=*`); } catch {}
  if (!d?.state) { bvToast("Couldn't open that draft."); return; }
  const st = d.state;
  if (d.ad_account_id && d.ad_account_id !== activeAccountId && accountsList.some(a => a.id === d.ad_account_id)) {
    activeAccountId = d.ad_account_id;
    ["acctSelector", "acctSelectorMobile"].forEach(sid => { const el = document.getElementById(sid); if (el) el.value = activeAccountId; });
  }
  bvCloseSheet("bvDraftsOverlay");
  bvDraftRestoring = true;
  bvDraftId = id;
  try {
    bvOpenCampaignBuilder(st.fields?.destination === "website" ? "OUTCOME_TRAFFIC" : "OUTCOME_SALES");
    const g = x => document.getElementById(x);
    const dest = document.querySelector(`input[name="f_destination"][value="${st.fields?.destination || "whatsapp"}"]`);
    if (dest) { dest.checked = true; bvOnDestinationChange(); }
    for (const [k, v] of Object.entries(st.fields || {})) if (g(k) && k !== "destination") g(k).value = v;
    if (st.fields?.f_product) bvOnProductChange();
    if (st.adsets?.length) bvAdSetRows = st.adsets;
    bvStagedCopies = [];
    bvToast("Loading your saved draft…");
    const fetchFile = async ref => {
      if (!ref?.path) return null;
      const { data } = await supabaseClient.storage.from("draft-media").download(ref.path);
      if (!data) return null;
      const f = new File([data], ref.name, { type: ref.type || data.type });
      f.__draftPath = ref.path;
      return f;
    };
    for (const c of st.copies || []) { const { file_ref, ...rest } = c; bvStagedCopies.push({ ...rest, file: await fetchFile(file_ref) }); }
    bvAdTabUid = st.adTabUid;
    bvReuseAsset = st.formReuse || null;
    const ff = await fetchFile(st.formFile);
    if (ff) setFile(ff);
    bvRenderAdSetRows();
    bvEnsureAdTab();
    bvRenderStagedCopies();
    bvRenderBuilderSummary();
    bvSwitchBuilderTab(st.step || "campaign");
    if (st.lost) bvToast(`${st.lost} file${st.lost === 1 ? "" : "s"} couldn't be kept in the draft — please attach again.`);
  } finally {
    bvDraftRestoring = false;
    bvDraftStatus("Draft loaded");
  }
}

async function bvCloseBuilder() {
  clearTimeout(bvDraftTimer);
  try { await bvDraftSave(); } catch {}
  document.getElementById("bvBuilderOverlay")?.remove();
}

function bvOpenCampaignBuilder(presetObjective) {
  const products = window.bvVaultProductsCache || [];
  const pOpts = window.bvVaultProductOpts || "";
  const overlay = document.createElement("div");
  overlay.id = "bvBuilderOverlay";
  overlay.className = "bv-overlay bv-overlay-xl";
  overlay.innerHTML = `
    <div class="bv-modal bv-modal-xl">
      <button class="bv-modal-close" onclick="bvCloseBuilder()">✕</button>
      <form id="uploadForm" style="display:flex;flex-direction:column;height:100%;min-height:0;">
        <div class="ms-top" id="msTop"><div class="ms-bar"><i id="msBarFill"></i></div><div class="ms-step" id="msStep"></div><h2 id="msTitle"></h2><p id="msHint"></p></div>

        <div class="bv-builder-head">
          <div class="ph-title" style="margin-bottom:4px;">New campaign</div>
          <div class="wz-sub">Set it up in a few steps. Check everything, then tap Launch to go live, or save it as a paused draft.</div>
          <div class="wz-steps" id="bvWzSteps">${BV_WZ.map((w, i) => `<button type="button" class="wz-step" data-wz="${w[0]}" onclick="bvWzGo('${w[0]}')"><span class="wz-n">${i + 1}</span>${w[1]}</button>`).join("")}</div>
          <div class="field" data-wzs="goal" data-ms="dest"><label>Where do you want customers to go? *</label>
            <div style="display:flex;gap:18px;margin-top:4px;flex-wrap:wrap;">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:400;cursor:pointer;">
                <input type="radio" name="f_destination" value="whatsapp" ${!presetObjective || presetObjective === "OUTCOME_SALES" ? "checked" : ""} onchange="bvOnDestinationChange()"> WhatsApp — opens a chat
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:400;cursor:pointer;">
                <input type="radio" name="f_destination" value="website" ${presetObjective && presetObjective !== "OUTCOME_SALES" ? "checked" : ""} onchange="bvOnDestinationChange()"> Website — clicks through to a link
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:400;cursor:pointer;">
                <input type="radio" name="f_destination" value="messenger" onchange="bvOnDestinationChange()"> Messenger — opens a chat
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:400;cursor:pointer;">
                <input type="radio" name="f_destination" value="instagram" onchange="bvOnDestinationChange()"> Instagram — opens a DM
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:400;cursor:pointer;">
                <input type="radio" name="f_destination" value="form" onchange="bvOnDestinationChange()"> Instant form — people fill a form on Facebook/Instagram
              </label>
            </div>
          </div>
          <div class="fg" style="margin-top:10px;" data-wzs="goal" data-ms="dest">
            <div class="field" id="f_whatsappNumberField"><label>WhatsApp number *</label><input id="f_whatsapp_number" placeholder="e.g. 2348012345678" oninput="bvRenderIdentitySection(); bvRenderBuilderSummary();">
              <div id="f_whatsappPicker" style="margin-top:6px;"></div>
            </div>
            <div class="field" id="f_landingUrlField" style="display:none;"><label>Landing page URL *</label><input id="f_landing_url" placeholder="https://…"></div>
          </div>
          <div class="field" data-wzs="product" data-ms="name" style="margin-top:10px;"><label>Link to a product <span style="font-weight:400;color:var(--muted);">(optional — for Shop checkout + Purchase pixel tracking)</span></label>
            <select id="f_product" onchange="bvOnProductChange()">
              <option value="">— none (standalone campaign) —</option>
              ${pOpts}
            </select>
            <div id="f_productDestination" style="font-size:11px;color:var(--muted);margin-top:4px;"></div>
          </div>
        </div>

        <div class="bv-builder-shell">
          <div class="bv-builder-sidebar">
            <div class="bv-tree-item active" id="bvTabBtn-campaign" onclick="bvSwitchBuilderTab('campaign')">📁 Campaign</div>
            <div class="bv-tree-item child" id="bvTabBtn-adset" onclick="bvSwitchBuilderTab('adset')">▦ Ad set</div>
            <div class="bv-tree-item child" id="bvTabBtn-ad" onclick="bvSwitchBuilderTab('ad')">🖼 Ad</div>
          </div>

          <div class="bv-builder-body">

          <div class="bv-builder-section active" id="bvSection-campaign">
            <div class="bv-section-card" data-wzs="goal" data-ms="name">
              <div class="bv-section-card-title"><span class="bv-ico">🎯</span> Campaign details</div>
              <div class="field"><label>Campaign name <span style="font-weight:400;color:var(--muted);">(shown in Meta Ads Manager)</span></label>
                <input id="f_campaign_name" placeholder="e.g. Yorvix SB — Sept 16 Launch" oninput="bvRenderBuilderSummary()">
              </div>
              <div class="field" style="margin-top:14px;"><label>Campaign objective <span style="font-weight:400;color:var(--muted);">(determines what Meta optimizes delivery for)</span></label>
                <select id="f_objective" onchange="bvRenderAdSetRows()">
                  <option value="OUTCOME_SALES" ${presetObjective === "OUTCOME_SALES" ? "selected" : ""}>Sales — drive purchases (needs a connected pixel)</option>
                  <option value="OUTCOME_TRAFFIC" ${presetObjective === "OUTCOME_TRAFFIC" ? "selected" : ""}>Traffic — drive clicks to your link</option>
                  <option value="OUTCOME_ENGAGEMENT" ${presetObjective === "OUTCOME_ENGAGEMENT" ? "selected" : ""}>Engagement — likes, comments, shares on the post</option>
                  <option value="OUTCOME_AWARENESS" ${presetObjective === "OUTCOME_AWARENESS" ? "selected" : ""}>Awareness — reach as many people as possible</option>
                  <option value="OUTCOME_LEADS" ${presetObjective === "OUTCOME_LEADS" ? "selected" : ""}>Leads — people who sign up or enquire (website needs a pixel; also works for Messenger and Instagram)</option>
                </select>
                <div id="f_objectiveNote" style="font-size:11px;color:var(--muted);margin-top:4px;"></div>
              </div>
            </div>

            <div class="bv-section-card" data-wzs="budget" data-ms="adv">
              <div class="bv-section-card-title"><span class="bv-ico">💰</span> Budget & schedule</div>
              <div class="field" style="margin-bottom:12px;"><label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;"><input type="checkbox" id="f_launch_paused" style="width:auto;"> Create it paused (draft)</label>
                <div style="font-size:11px;color:var(--muted);margin-top:4px;">Everything is created on Meta but left paused, so you can show it or switch it on later. Nothing spends.</div></div>
              <div class="field"><label>Budget type</label>
                <select id="f_budget_type" onchange="bvRenderBuilderSummary()">
                  <option value="abo">ABO — budget set per ad set</option>
                  <option value="cbo">CBO — one total budget, Meta splits it</option>
                </select>
              </div>
              <div class="fg" style="margin-top:14px;">
                <div class="field"><label>Launch date/time (optional)</label>
                  <input id="f_scheduled" type="datetime-local">
                  <div style="font-size:11px;color:var(--muted);margin-top:4px;">Leave blank to launch in tonight's normal batch.</div>
                </div>
                <div class="field"><label>Campaign end date (optional)</label>
                  <input id="f_end_date" type="datetime-local">
                  <div style="font-size:11px;color:var(--muted);margin-top:4px;">Leave blank to run until you kill/pause it manually.</div>
                </div>
              </div>
            </div>
          </div>

          <div class="bv-builder-section" id="bvSection-adset">
            <div style="font-size:11.5px;color:var(--muted);margin:0 0 14px;">Each ad set below is its own glass card — budget, audience, placements and bidding all together.</div>
            <div id="adSetRows" data-ms="who budget adv"></div>
          </div>

          <div class="bv-builder-section" id="bvSection-ad">
            <div style="font-size:11.5px;color:var(--muted);margin:0 0 14px;line-height:1.5;">
              This is <b style="color:var(--text2);">ad content for Meta</b> — the video/image people see in the Facebook/Instagram feed. It's not the product's own photo; upload that on the <b style="color:var(--text2);">Products</b> tab instead.
            </div>

            <div class="bv-section-card" data-ms="media">
              <div class="bv-section-card-title"><span class="bv-ico">👤</span> Identity</div>
              <div class="field"><label>Facebook Page <span style="font-weight:400;color:var(--muted);">(this ad posts as)</span></label>
                <div id="f_identityValue" style="font-size:12.5px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;color:var(--text2);"></div>
                <div style="font-size:11px;color:var(--muted);margin-top:4px;">Instagram uses the same connected Page's profile automatically.</div>
              </div>
              <div class="field" id="f_identityWhatsappField" style="margin-top:14px;"><label>WhatsApp number</label>
                <div id="f_identityWhatsappValue" style="font-size:12.5px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;color:var(--text2);"></div>
              </div>
            </div>

            <div id="bvAdSetTabs" class="bv-adtabs" data-ms="media copy"></div>
            <div id="bvAdTabHint" class="bv-adhint"></div>

            <div class="bv-section-card ms-split" data-ms="media copy adv">
              <div class="bv-section-card-title"><span class="bv-ico">🎬</span> Ad creative</div>
              <div class="dz" data-ms="media" id="dropZone" onclick="document.getElementById('f_file').click()">
                <div class="dz-ico">🎬</div>
                <div class="dz-txt">Drag & drop your ad video or image here</div>
                <div class="dz-hint">MP4, MOV, JPG, PNG — max 100MB</div>
                <div class="dz-prev" id="dzPrev"></div>
                <input type="file" id="f_file" accept="video/*,image/*" style="display:none" onchange="handleFilePick(this)">
                <div style="margin-top:8px;font-size:11px;"><button type="button" class="btn btn-a" style="width:auto;padding:8px 16px;font-size:12px;" onclick="event.stopPropagation(); bvOpenReuseCreativeModal()">📁 Choose from creative vault ▾</button></div>
              </div>
              <div id="dzFit" data-ms="media"></div>
              <button type="button" data-ms="media" class="btn btn-g" style="width:auto;padding:6px 12px;font-size:12px;margin-top:10px;" onclick="bvOpenAdPreview()">👁 Preview on phone &amp; laptop</button>
              <div class="fg" data-ms="copy adv" style="margin-top:14px;">
                <div class="field" data-ms="adv"><label>Mechanism</label>
                  <select id="f_mechanism">
                    <option value="root_cause">Root cause</option>
                    <option value="why_others_failed">Why others failed</option>
                    <option value="lifestyle_factors">Lifestyle factors</option>
                    <option value="major_symptoms">Major symptoms</option>
                    <option value="why_product_works">Why product works</option>
                  </select>
                </div>
                <div class="field" data-ms="adv"><label>Format</label>
                  <select id="f_format">
                    <option value="customer_review">Customer review</option>
                    <option value="before_after">Before / After</option>
                    <option value="street_interview">Street interview</option>
                    <option value="case_study">Case study</option>
                    <option value="ugly_text">Ugly text ad</option>
                  </select>
                </div>
                <div class="field" data-ms="copy"><label>Button</label>
                  <select id="f_cta">
                    <option value="SHOP_NOW">Shop Now</option>
                    <option value="LEARN_MORE">Learn More</option>
                    <option value="ORDER_NOW">Order Now</option>
                  </select>
                  <div id="f_ctaNote" style="font-size:11px;color:var(--muted);margin-top:4px;"></div>
                </div>
              </div>
            </div>

            <div class="bv-section-card ms-split ms-copycard" data-ms="copy adv">
              <div class="bv-section-card-title" id="bvAdFormTitle"><span class="bv-ico">✏️</span> Ad copy</div>
              <div class="field" data-ms="adv" style="margin-bottom:14px;"><label>Ad name <span style="font-weight:400;color:var(--muted);">(optional — shown on Meta exactly as you type it)</span></label>
                <input id="f_ad_name" maxlength="120" placeholder="e.g. Mama Ngozi testimonial video"></div>
              <div id="f_waMsgBox" data-ms="copy" class="bv-wa-box" style="order:3;">
                <div class="field"><label>WhatsApp greeting <span style="font-weight:400;color:var(--muted);">(what the customer sees when the chat opens · max 300)</span></label>
                  <textarea id="f_wa_greeting" rows="2" maxlength="300" placeholder="Short & punchy, e.g. Welcome 👋 Want real orders from your ads? Tap send and I'll show you how."></textarea></div>
                <div class="field" style="margin-top:12px;"><label>Pre-filled message <span style="font-weight:400;color:var(--muted);">(already typed in the customer's message box · max 500)</span></label>
                  <textarea id="f_wa_prefill" rows="2" maxlength="500" placeholder="e.g. Hi, I'm interested in getting more orders 🔥"></textarea></div>
                <div style="font-size:11px;color:var(--muted);margin-top:6px;">Meta uses exactly what you type here. Left blank, a neutral line is used ("Hi, I saw your ad and I'd like to know more.") — never the campaign name.</div>
              </div>
              <div class="field" data-ms="copy" style="margin-top:14px;order:1;"><label>Primary text (ad copy) *</label>
                <textarea id="f_primary" rows="3" placeholder="The copy that appears above your ad… (optional if ad copies are already staged below)" oninput="bvRenderBuilderSummary()"></textarea>
              </div>
              <div class="fg" data-ms="copy" style="margin-top:14px;order:2;">
                <div class="field"><label>Headline</label><input id="f_headline" placeholder="Short bold hook" oninput="bvRenderBuilderSummary()"></div>
                <div class="field"><label>Description</label><input id="f_desc" placeholder="Supporting line under headline"></div>
              </div>
              <div data-ms="copy adv" style="margin-top:14px;position:relative;display:inline-block;">
                <button type="button" class="btn btn-g" style="width:auto;padding:6px 12px;font-size:12px;" onclick="bvToggleKebab('bvAdActionsMenu', event)">⋯ Actions for this ad</button>
                <button type="button" class="btn btn-g" style="width:auto;padding:6px 12px;font-size:12px;margin-left:8px;" onclick="bvOpenAdListModal()">☰ View all ads (<span id="bvAdCount">0</span>)</button>
                <div id="bvAdActionsMenu" class="bv-kebab-dropdown" style="display:none;">
                  <button type="button" onclick="bvCloseKebabs(); bvStageAdCopy()">+ Add another ad copy</button>
                  <button type="button" onclick="bvCloseKebabs(); bvOpenDuplicateAdModal()">⧉ Duplicate…</button>
                  <button type="button" onclick="bvCloseKebabs(); bvQuickDuplicateAd()">⧉ Quickly duplicate</button>
                </div>
              </div>
              <div id="stagedCopies" data-ms="copy adv" style="margin-top:8px;"></div>
            </div>

            <div class="bv-section-card" data-ms="adv">
              <div class="bv-section-card-title"><span class="bv-ico">🎯</span> Tracking</div>
              <div class="field"><label>Pixel <span style="font-weight:400;color:var(--muted);">(conversion events for this ad account)</span></label>
                <div id="f_pixelValue" style="font-size:12.5px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;color:var(--text2);"></div>
              </div>
            </div>
          </div>

          </div>

          <div class="bv-builder-summary" id="bvBuilderSummary"></div>
        </div>

        <div class="bv-builder-foot">
          <div style="display:flex;gap:8px;align-items:center;">
            <button type="button" class="btn btn-g" style="width:auto;padding:8px 16px;font-size:12.5px;" id="bvTabBackBtn" onclick="bvBuilderTabStep(-1)">← Back</button>
            <button type="button" class="btn btn-g" style="width:auto;padding:8px 16px;font-size:12.5px;" id="bvTabNextBtn" onclick="bvBuilderTabStep(1)">Next →</button>
            <span id="bvDraftStatus" style="font-size:11.5px;color:var(--muted);margin-left:4px;"></span>
          </div>
          <button type="submit" class="btn btn-a" style="width:auto;padding:8px 20px;" id="uploadBtn">Review & Launch →</button>
        </div>
        <div id="uploadMsg" style="padding:0 24px 14px;"></div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  bvOnDestinationChange();
  bvResetAdSetBuilder();
  bvStagedCopies = [];
  bvAdTabUid = null;
  bvEnsureAdTab();
  bvRenderStagedCopies();
  bvReuseAsset = null;
  bvLoadBuilderIdentity();
  bvRenderBuilderSummary();
  bvWzGo("goal");
  bvDraftStart();

  // Drag-and-drop
  const dz = document.getElementById("dropZone");
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", e => {
    e.preventDefault(); dz.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  });

  document.getElementById("uploadForm").addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("uploadMsg");

    // The copy currently filled into the form (if any) is the last copy in
    // the batch, alongside anything staged via "+ Add another ad copy".
    const currentFile = document.getElementById("f_file").files[0];
    const currentPrimary = document.getElementById("f_primary").value.trim();
    const copies = [...bvStagedCopies];
    if ((currentFile || bvReuseAsset) && currentPrimary) {
      copies.push({
        file: currentFile || null,
        reuse_asset: bvReuseAsset,
        adset_uid: bvAdTabUid,
        ad_name: document.getElementById("f_ad_name").value.trim(),
        ...bvFormWa(),
        primary_text: currentPrimary,
        headline: document.getElementById("f_headline").value.trim(),
        description: document.getElementById("f_desc").value.trim(),
        mechanism: document.getElementById("f_mechanism").value,
        format: document.getElementById("f_format").value,
        cta_type: document.getElementById("f_cta").value,
      });
    }
    if (!copies.length) {
      msg.innerHTML = `<div class="msg err">Please select or drop a file first (or reuse an existing creative).</div>`;
      // On a phone the message sits at the end of a long scrolling page -- bring it into view.
      if (window.matchMedia("(max-width: 760px)").matches) msg.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // every ad set needs its own ad(s) -- this is what a missing "Ad" step looks like in the Review
    const noAds = bvAdSetRows.filter(r => !copies.some(c => c.adset_uid === r.uid));
    if (noAds.length) {
      msg.innerHTML = `<div class="msg err">${noAds.map(r => `<b>${escH(bvAdSetName(r))}</b>`).join(", ")} ${noAds.length === 1 ? "has" : "have"} no ad yet. Open ${noAds.length === 1 ? "its" : "their"} tab above and add an ad, or use "Copy these ads to other ad sets".</div>`;
      bvSelectAdTab(noAds[0].uid);
      return;
    }
    const dupNames = bvFindDuplicateNames(copies);
    if (dupNames) {
      msg.innerHTML = `<div class="msg err">${dupNames}</div>`;
      if (window.matchMedia("(max-width: 760px)").matches) msg.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    msg.innerHTML = "";
    bvOpenReviewModal(copies);
  });
}

const BV_BUILDER_TABS = ["campaign", "adset", "ad"];
// The 6-step wizard the builder shows. Each step maps to one of the original three
// sections (which still hold every field and all the launch logic).
const BV_WZ = [["goal", "Goal", "campaign"], ["product", "Product", "campaign"], ["audience", "Audience", "adset"], ["creative", "Creative", "ad"], ["budget", "Budget", "campaign"], ["review", "Review", "ad"]];
function bvWzPaint() {
  const ov = document.getElementById("bvBuilderOverlay"); if (!ov) return;
  const cur = ov.dataset.wz || "goal", i = BV_WZ.findIndex(w => w[0] === cur);
  ov.querySelectorAll(".wz-step").forEach((b, n) => { b.classList.toggle("on", n === i); b.classList.toggle("done", n < i); const num = b.querySelector(".wz-n"); if (num) num.textContent = n < i ? "✓" : String(n + 1); });
  const back = document.getElementById("bvTabBackBtn"), next = document.getElementById("bvTabNextBtn");
  if (back) back.style.visibility = i === 0 ? "hidden" : "visible";
  if (next) next.style.visibility = i === BV_WZ.length - 1 ? "hidden" : "visible";
}
function bvWzGo(id) {
  const ov = document.getElementById("bvBuilderOverlay"); if (!ov) return;
  if (mobileMq.matches) return bvMsGo(BV_MS_FROM_WZ[id] || "dest");
  ov.dataset.wz = id;
  bvSwitchBuilderTab(BV_WZ.find(w => w[0] === id)[2]);
}

function bvSwitchBuilderTab(tab) {
  BV_BUILDER_TABS.forEach(t => {
    document.getElementById(`bvSection-${t}`)?.classList.toggle("active", t === tab);
    document.getElementById(`bvTabBtn-${t}`)?.classList.toggle("active", t === tab);
  });
  const i = BV_BUILDER_TABS.indexOf(tab);
  // Phone layout keys off these: which step is showing, and which are finished.
  document.getElementById("bvBuilderOverlay")?.setAttribute("data-step", tab);
  BV_BUILDER_TABS.forEach((t, n) => document.getElementById(`bvTabBtn-${t}`)?.classList.toggle("done", n < i));
  document.getElementById("uploadForm")?.scrollTo(0, 0);
  const backBtn = document.getElementById("bvTabBackBtn");
  const nextBtn = document.getElementById("bvTabNextBtn");
  if (backBtn) backBtn.style.visibility = i === 0 ? "hidden" : "visible";
  if (nextBtn) nextBtn.style.visibility = i === BV_BUILDER_TABS.length - 1 ? "hidden" : "visible";
  document.querySelector(".bv-builder-body")?.scrollTo(0, 0);
  if (tab === "ad") bvRenderStagedCopies();
  const ov = document.getElementById("bvBuilderOverlay");
  if (ov) {
    const w = BV_WZ.find(x => x[0] === ov.dataset.wz);
    if (!w || w[2] !== tab) ov.dataset.wz = BV_WZ.find(x => x[2] === tab)[0];
  }
  bvWzPaint();
  bvRenderBuilderSummary();
}

function bvBuilderTabStep(delta) {
  if (mobileMq.matches) return bvMsStep(delta);
  const cur = document.getElementById("bvBuilderOverlay")?.dataset.wz || "goal";
  const i = Math.max(0, Math.min(BV_WZ.length - 1, BV_WZ.findIndex(w => w[0] === cur) + delta));
  bvWzGo(BV_WZ[i][0]);
}