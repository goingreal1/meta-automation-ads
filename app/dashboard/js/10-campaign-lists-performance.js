// Revora dashboard, part 10 of 23: LEVEL 1: every campaign (live, recent, past) · Flat tab: every ad set, across every campaign · Flat tab: every ad, across every ad set/campaign · LEVEL 2: one campaign's ad sets · LEVEL 3: one ad set's ads, with live creative pulled back from Meta · TAB: PERFORMANCE

// ── LEVEL 1: every campaign (live, recent, past) ────────────────────────────
async function renderCampaignsList(el) {
  const [campaigns, adSets, adSetAds] = await Promise.all([
    sbQuery("campaigns", "select=*,ad_accounts(nickname,name)&order=created_at.desc&limit=200"),
    sbQuery("ad_sets", "select=*,campaigns(campaign_name),daily_metrics(spend_naira,ctr,orders,impressions,reach,cost_per_order_naira,metric_date)&order=created_at.desc&limit=1000"),
    sbQuery("ad_set_ads", "select=id,ad_set_id&limit=2000"),
  ]);

  const adSetsByCampaign = new Map();
  for (const a of adSets || []) {
    const latest = (a.daily_metrics || []).sort((x, y) => (x.metric_date < y.metric_date ? 1 : -1))[0];
    a.spend_latest = Number(latest?.spend_naira || 0);
    a.ctr_latest = latest?.ctr ?? null;
    a.orders_latest = Number(latest?.orders || 0);
    a.impressions_latest = Number(latest?.impressions || 0);
    a.reach_latest = Number(latest?.reach || 0);
    a.cpa_latest = latest?.cost_per_order_naira ?? null;
    a.lifecycle = bvAdSetLifecycle(a);
    if (!adSetsByCampaign.has(a.campaign_id)) adSetsByCampaign.set(a.campaign_id, []);
    adSetsByCampaign.get(a.campaign_id).push(a);
  }
  const adCountByAdSet = new Map();
  for (const r of adSetAds || []) adCountByAdSet.set(r.ad_set_id, (adCountByAdSet.get(r.ad_set_id) || 0) + 1);

  const rows = (campaigns || []).map(c => {
    const mySets = adSetsByCampaign.get(c.id) || [];
    const adCount = mySets.reduce((s, a) => s + (adCountByAdSet.get(a.id) || 0), 0);
    const spend = mySets.reduce((s, a) => s + a.spend_latest, 0);
    const orders = mySets.reduce((s, a) => s + a.orders_latest, 0);
    const anyActive = mySets.some(a => a.lifecycle.key === "active");
    return { campaign: c, adSetCount: mySets.length, adCount, spend, orders, anyActive };
  });

  const filtered = rows.filter(r => {
    if (campaignsStatusFilter === "active") return r.campaign.effective_status === "ACTIVE";
    if (campaignsStatusFilter === "paused") return r.campaign.effective_status !== "ACTIVE";
    return true;
  });

  const counts = { campaigns: rows.length, adsets: adSets?.length ?? 0, ads: adSetAds?.length ?? 0 };

  if (campaignsFlatLevel === "adsets") return renderAdSetsFlat(el, counts, adSets || []);
  if (campaignsFlatLevel === "ads") return renderAdsFlat(el, counts);

  el.innerHTML = bvCampaignsHeader(counts) + `
    <div class="panel">
      <div class="ph"><div class="ph-title">All campaigns</div><div class="ph-count">${filtered.length} shown</div></div>
      ${!filtered.length
        ? `<div class="empty"><div class="empty-ico">🚀</div>No campaigns yet. Launch one from Creative Vault, or Sync from Meta if you already have live campaigns running there.</div>`
        : `<div class="tbl-wrap"><table>
          <tr><th>Campaign</th><th>Ad account</th><th>Delivery</th><th>Ad sets</th><th>Ads</th><th>Budget/day</th><th>Amount spent</th><th>Results</th><th>Cost per result</th><th>Created</th></tr>
          ${filtered.map(r => `<tr class="bv-clickable-row" onclick="bvOpenCampaign('${r.campaign.id}')">
            <td class="s n" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escH(r.campaign.campaign_name)}">${escH(r.campaign.campaign_name)}</td>
            <td class="n" style="color:var(--muted);">${escH(r.campaign.ad_accounts?.nickname || r.campaign.ad_accounts?.name || "—")}</td>
            <td>${(() => { const [l, c] = amStatusWord(r.campaign.effective_status); return `<span class="pill ${c}">${escH(l)}</span>`; })()}</td>
            <td>${r.adSetCount}</td>
            <td>${r.adCount}</td>
            <td>${fN(r.campaign.daily_budget_naira)}</td>
            <td>${fN(r.spend)}</td>
            <td>${r.orders}</td>
            <td>${r.orders ? fN(r.spend / r.orders) : "—"}</td>
            <td>${ago(r.campaign.created_at)}</td>
          </tr>`).join("")}
        </table></div>`}
    </div>`;

  bvCampaignsToolbarWire();
}

// ── Flat tab: every ad set, across every campaign ───────────────────────────
function renderAdSetsFlat(el, counts, adSets) {
  const filtered = adSets.filter(a => {
    if (campaignsStatusFilter === "active") return a.lifecycle.key === "active";
    if (campaignsStatusFilter === "paused") return a.lifecycle.key !== "active";
    return true;
  });

  el.innerHTML = bvCampaignsHeader(counts) + `
    <div class="panel">
      <div class="ph"><div class="ph-title">All ad sets</div><div class="ph-count">${filtered.length} shown</div></div>
      ${!filtered.length
        ? `<div class="empty"><div class="empty-ico">🎯</div>No ad sets yet.</div>`
        : `<div class="tbl-wrap"><table>
          <tr><th>Ad set</th><th>Campaign</th><th>Delivery</th><th>Budget/day</th><th>Amount spent</th><th>Impressions</th><th>Reach</th><th>Results</th><th>Cost per result</th></tr>
          ${filtered.map(a => `<tr class="bv-clickable-row" onclick="bvOpenAdSet('${a.id}','${a.campaign_id}')">
            <td class="s n" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escH(a.adset_name || "")}">${escH(a.adset_name || "—")}</td>
            <td class="n" style="color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(a.campaigns?.campaign_name || "—")}</td>
            <td><span class="pill ${a.lifecycle.key}">${a.lifecycle.label}</span></td>
            <td>${fN(a.budget_naira)}</td>
            <td>${fN(a.spend_latest)}</td>
            <td>${a.impressions_latest.toLocaleString()}</td>
            <td>${a.reach_latest.toLocaleString()}</td>
            <td>${a.orders_latest}</td>
            <td>${fN(a.cpa_latest)}</td>
          </tr>`).join("")}
        </table></div>`}
    </div>`;

  bvCampaignsToolbarWire();
}

// ── Flat tab: every ad, across every ad set/campaign ────────────────────────
async function renderAdsFlat(el, counts) {
  el.innerHTML = bvCampaignsHeader(counts) + `<div class="panel"><div class="empty"><div class="empty-ico">🎨</div>Loading ads…</div></div>`;
  bvCampaignsToolbarWire();

  const adSetAds = await sbQuery(
    "ad_set_ads",
    "select=*,ad_sets(adset_name,status,effective_status,meta_raw,campaign_id,campaigns(campaign_name)),creatives(creative_name,image_url,video_id,headline,cta_type,launch_batch_id,created_at),daily_metrics(spend_naira,ctr,orders,cost_per_order_naira,metric_date)&order=created_at.desc&limit=1000"
  );

  const rows = (adSetAds || []).map(r => {
    const latest = (r.daily_metrics || []).sort((x, y) => (x.metric_date < y.metric_date ? 1 : -1))[0];
    return {
      ...r,
      spend_latest: Number(latest?.spend_naira || 0),
      ctr_latest: latest?.ctr ?? null,
      orders_latest: Number(latest?.orders || 0),
      cpa_latest: latest?.cost_per_order_naira ?? null,
      lifecycle: bvAdSetLifecycle({ effective_status: r.effective_status || r.ad_sets?.effective_status, meta_raw: r.ad_sets?.meta_raw }),
    };
  });

  const filtered = rows.filter(r => {
    if (campaignsStatusFilter === "active") return r.lifecycle.key === "active";
    if (campaignsStatusFilter === "paused") return r.lifecycle.key !== "active";
    return true;
  });

  // Group duplicated ads (same ad set + shared launch_batch_id) under their
  // original, mirroring Meta's own "Copy 1/2/3 nested under the original"
  // list instead of a flat list where a duplicate looks unrelated to the ad
  // it came from. A row with no launch_batch_id (not a duplicate) is its own
  // group of one, rendered exactly as before.
  const groupsMap = new Map();
  for (const r of filtered) {
    const key = `${r.ad_set_id}:${r.creatives?.launch_batch_id || r.id}`;
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(r);
  }
  const groups = [...groupsMap.values()].map(g => {
    g.sort((a, b) => (a.creatives?.created_at || "").localeCompare(b.creatives?.created_at || ""));
    return g;
  });
  // Keep the same newest-first ordering the flat list had, by each group's
  // most-recently-created row.
  groups.sort((a, b) => (b[0].created_at || "").localeCompare(a[0].created_at || ""));

  const panel = el.querySelector(".panel");
  const adCell = (r, indent) => `
    <div style="display:flex;align-items:center;gap:8px;${indent ? "padding-left:22px;" : ""}">
      ${r.creatives?.image_url ? `<img src="${r.creatives.image_url}" style="width:28px;height:28px;object-fit:cover;border-radius:5px;flex-shrink:0;">` : `<div style="width:28px;height:28px;border-radius:5px;background:var(--panel2);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">${r.creatives?.video_id ? "🎬" : "🖼️"}</div>`}
      <a href="javascript:void(0)" onclick="event.stopPropagation(); bvShowLaunchedAdDetail('${r.creative_id}')" class="s n" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);text-decoration:none;" title="${escH(r.creatives?.headline || r.creatives?.creative_name || "")}">${escH(r.creatives?.headline || r.creatives?.creative_name || "—")}</a>
    </div>`;

  panel.innerHTML = `
    <div class="ph"><div class="ph-title">All ads</div><div class="ph-count">${filtered.length} shown</div></div>
    ${!filtered.length
      ? `<div class="empty"><div class="empty-ico">🎨</div>No ads yet.</div>`
      : `<div class="tbl-wrap"><table>
        <tr><th>Ad</th><th>Ad set</th><th>Campaign</th><th>Delivery</th><th>Amount spent</th><th>CTR</th><th>Results</th><th>Cost per result</th></tr>
        ${groups.map((g, gi) => {
          const r = g[0];
          const groupKey = `bvAdGroup-${gi}`;
          const rowHtml = (row, isParent) => `<tr class="bv-clickable-row" onclick="bvOpenAdSet('${row.ad_set_id}','${row.ad_sets?.campaign_id || ""}')">
            <td>
              <div style="display:flex;align-items:center;gap:6px;">
                ${isParent && g.length > 1 ? `<a href="javascript:void(0)" onclick="event.stopPropagation(); bvToggleAdGroup('${groupKey}')" id="${groupKey}-arrow" style="color:var(--muted);text-decoration:none;font-size:11px;width:12px;flex-shrink:0;">▸</a>` : (g.length > 1 ? `<span style="width:12px;flex-shrink:0;"></span>` : "")}
                ${adCell(row, false)}
              </div>
            </td>
            <td class="n" style="color:var(--muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(row.ad_sets?.adset_name || "—")}</td>
            <td class="n" style="color:var(--muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(row.ad_sets?.campaigns?.campaign_name || "—")}</td>
            <td><span class="pill ${row.lifecycle.key}">${row.lifecycle.label}</span></td>
            <td>${fN(row.spend_latest)}</td>
            <td class="${ctrCls(row.ctr_latest)}">${row.ctr_latest != null ? parseFloat(row.ctr_latest).toFixed(2) + "%" : "—"}</td>
            <td>${row.orders_latest}</td>
            <td>${fN(row.cpa_latest)}</td>
          </tr>`;
          const parentRow = rowHtml(r, true).replace(
            `${adCell(r, false)}`,
            `${adCell(r, false)}${g.length > 1 ? `<span style="font-size:10px;color:var(--muted);margin-left:4px;">(${g.length} ads)</span>` : ""}`
          );
          const childRows = g.slice(1).map((row, i) => `<tr class="${groupKey}-child bv-clickable-row" style="display:none;" onclick="bvOpenAdSet('${row.ad_set_id}','${row.ad_sets?.campaign_id || ""}')">
            <td>
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="width:12px;flex-shrink:0;"></span>
                ${adCell(row, true)}
                <span style="font-size:10px;color:var(--muted);">Copy ${i + 1}</span>
              </div>
            </td>
            <td class="n" style="color:var(--muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(row.ad_sets?.adset_name || "—")}</td>
            <td class="n" style="color:var(--muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(row.ad_sets?.campaigns?.campaign_name || "—")}</td>
            <td><span class="pill ${row.lifecycle.key}">${row.lifecycle.label}</span></td>
            <td>${fN(row.spend_latest)}</td>
            <td class="${ctrCls(row.ctr_latest)}">${row.ctr_latest != null ? parseFloat(row.ctr_latest).toFixed(2) + "%" : "—"}</td>
            <td>${row.orders_latest}</td>
            <td>${fN(row.cpa_latest)}</td>
          </tr>`).join("");
          return parentRow + childRows;
        }).join("")}
      </table></div>`}`;
}

function bvToggleAdGroup(groupKey) {
  const arrow = document.getElementById(`${groupKey}-arrow`);
  const children = document.querySelectorAll(`.${groupKey}-child`);
  const willShow = arrow.textContent.trim() === "▸";
  arrow.textContent = willShow ? "▾" : "▸";
  children.forEach(el => { el.style.display = willShow ? "" : "none"; });
}

// ── LEVEL 2: one campaign's ad sets ─────────────────────────────────────────
async function renderCampaignDetail(el, campaignId) {
  const [campaignRows, adSets, adSetAds] = await Promise.all([
    sbQuery("campaigns", `id=eq.${campaignId}&select=*,ad_accounts(nickname,name)`),
    sbQuery("ad_sets", `campaign_id=eq.${campaignId}&select=*,daily_metrics(spend_naira,ctr,cost_per_order_naira,orders,metric_date)&order=created_at.asc`),
    sbQuery("ad_set_ads", "select=id,ad_set_id"),
  ]);
  const campaign = campaignRows?.[0];
  if (!campaign) { el.innerHTML = `<div class="empty"><div class="empty-ico">🚀</div>Campaign not found.</div>`; return; }

  const adCountByAdSet = new Map();
  for (const r of adSetAds || []) adCountByAdSet.set(r.ad_set_id, (adCountByAdSet.get(r.ad_set_id) || 0) + 1);

  (adSets || []).forEach(a => {
    const latest = (a.daily_metrics || []).sort((x, y) => (x.metric_date < y.metric_date ? 1 : -1))[0];
    a.ctr_latest = latest?.ctr ?? null;
    a.cpa_latest = latest?.cost_per_order_naira ?? null;
    a.spend_latest = Number(latest?.spend_naira || 0);
    a.orders_latest = Number(latest?.orders || 0);
    a.lifecycle = bvAdSetLifecycle(a);
    a.adCount = adCountByAdSet.get(a.id) || 0;
  });

  const totalSpend = (adSets || []).reduce((s, a) => s + a.spend_latest, 0);
  const totalOrders = (adSets || []).reduce((s, a) => s + a.orders_latest, 0);
  const totalAds = (adSets || []).reduce((s, a) => s + a.adCount, 0);

  el.innerHTML = `
    <div class="sh">
      <div class="sh-title">
        <button type="button" class="btn btn-g" style="padding:3px 10px;font-size:11px;margin-right:8px;" onclick="bvBackToCampaignsList()">← Campaigns</button>
        ${escH(campaign.campaign_name)}
      </div>
      <div class="sh-actions"><button class="btn btn-b" id="btnPull3">📊 Pull & Refresh</button></div>
    </div>
    <div id="campMsg"></div>
    <div style="font-size:11.5px;color:var(--muted);margin:-8px 0 14px;">
      <span class="pill ${(campaign.status || "").toLowerCase()}">${escH(campaign.status || "—")}</span>
      &nbsp;${escH(campaign.ad_accounts?.nickname || campaign.ad_accounts?.name || "")}
      &nbsp;· objective: ${escH(campaign.objective_raw || campaign.objective || "—")}
      &nbsp;· created ${ago(campaign.created_at)}
    </div>

    <div class="g4">
      <div class="kc"><div class="kc-lbl">Ad sets</div><div class="kc-val">${adSets?.length ?? 0}</div></div>
      <div class="kc"><div class="kc-lbl">Ads</div><div class="kc-val">${totalAds}</div></div>
      <div class="kc"><div class="kc-lbl">Spend</div><div class="kc-val">${fN(totalSpend)}</div></div>
      <div class="kc"><div class="kc-lbl">Orders</div><div class="kc-val a">${totalOrders}</div></div>
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Ad sets</div><div class="ph-count" style="font-size:10px;color:var(--muted);">Kill: CTR &lt; ${CTR_KILL}% · Watch: ${CTR_KILL}–${CTR_WIN}% · Scale: ≥ ${CTR_WIN}% &amp; CPA ≤ ${fN(CPA_KILL)}</div></div>
      ${!adSets?.length
        ? `<div class="empty"><div class="empty-ico">🎯</div>No ad sets synced for this campaign yet.</div>`
        : `<div class="tbl-wrap"><table>
          <tr><th>Ad set</th><th>Ads</th><th>Budget/day</th><th>CTR</th><th>CPA</th><th>Spend</th><th>Age</th><th>Decision</th><th>Status</th></tr>
          ${adSets.map(a => {
            const h = hrs(a.created_at);
            const ctrV = a.ctr_latest != null ? parseFloat(a.ctr_latest).toFixed(2) : null;
            const cpaC = a.cpa_latest ? (a.cpa_latest <= CPA_WATCH ? "ctr-hot" : a.cpa_latest <= CPA_KILL ? "ctr-warm" : "ctr-cold") : "";
            return `<tr class="bv-clickable-row" onclick="bvOpenAdSet('${a.id}','${campaignId}')">
              <td class="s n" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escH(a.adset_name)}">${escH(a.adset_name)}</td>
              <td>${a.adCount}</td>
              <td>${fN(a.budget_naira)}</td>
              <td class="${ctrCls(ctrV)}">${ctrV ? ctrV + "%" : "—"}</td>
              <td class="${cpaC}">${fN(a.cpa_latest)}</td>
              <td>${fN(a.spend_latest)}</td>
              <td>${h}h</td>
              <td>${decision(ctrV, a.spend_latest, h)}</td>
              <td><span class="pill ${a.lifecycle.key}">${a.lifecycle.label}</span></td>
            </tr>`;
          }).join("")}
        </table></div>`}
    </div>`;

  document.getElementById("btnPull3")?.addEventListener("click", () => pullAndRefresh("btnPull3", "campMsg"));
}

// ── LEVEL 3: one ad set's ads, with live creative pulled back from Meta ────
// ad_set_ads (one row per ad) is the real source for any ad set launched
// after the multi-copy feature, or synced via sync-meta-structure; an ad set
// that only ever had ad_sets.creative_id (pre-multi-copy, legacy) falls back
// to that single creative so nothing old goes blank.
async function renderAdSetDetail(el, adSetId, campaignId) {
  const [adSetRows, adSetAds] = await Promise.all([
    sbQuery("ad_sets", `id=eq.${adSetId}&select=*,campaigns(campaign_name)`),
    sbQuery("ad_set_ads", `ad_set_id=eq.${adSetId}&select=*,creatives(creative_name,image_url,video_id,headline,primary_text,description,destination_link,cta_type,meta_ad_id,status),daily_metrics(spend_naira,ctr,orders,cost_per_order_naira,metric_date)`),
  ]);
  const adSet = adSetRows?.[0];
  if (!adSet) { el.innerHTML = `<div class="empty"><div class="empty-ico">🎯</div>Ad set not found.</div>`; return; }

  let ads = (adSetAds || []).map(r => {
    const latest = (r.daily_metrics || []).sort((x, y) => (x.metric_date < y.metric_date ? 1 : -1))[0];
    return { ...r.creatives, spend_latest: latest?.spend_naira ?? null, ctr_latest: latest?.ctr ?? null, orders_latest: latest?.orders ?? null, cpa_latest: latest?.cost_per_order_naira ?? null };
  }).filter(c => c.meta_ad_id || c.creative_name);
  if (!ads.length && adSet.creative_id) {
    const fallback = await sbQuery("creatives", `id=eq.${adSet.creative_id}&select=creative_name,image_url,video_id,headline,primary_text,description,destination_link,cta_type,meta_ad_id,status`);
    ads = fallback || [];
  }

  const genderLabel = (adSet.genders || []).join(", ") || "all";
  const geoLabel = adSet.states?.length ? adSet.states.join(", ") : (adSet.countries || ["NG"]).join(", ");

  el.innerHTML = `
    <div class="sh">
      <div class="sh-title">
        <button type="button" class="btn btn-g" style="padding:3px 10px;font-size:11px;margin-right:8px;" onclick="bvBackToCampaign()">← ${escH(adSet.campaigns?.campaign_name || "Campaign")}</button>
        ${escH(adSet.adset_name)}
      </div>
    </div>
    <div style="font-size:11.5px;color:var(--muted);margin:-8px 0 14px;">
      <span class="pill ${bvAdSetLifecycle(adSet).key}">${bvAdSetLifecycle(adSet).label}</span>
      &nbsp;${fN(adSet.budget_naira)}/day &nbsp;· ${adSet.age_min ?? "—"}–${adSet.age_max ?? "—"} &nbsp;· ${escH(genderLabel)} &nbsp;· ${escH(geoLabel)}
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Ads</div><div class="ph-count">${ads.length} ad${ads.length === 1 ? "" : "s"} in this ad set</div></div>
      ${!ads.length
        ? `<div class="empty"><div class="empty-ico">🎨</div>No ad recorded for this ad set yet -- try "Sync from Meta" on the Campaigns tab.</div>`
        : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
          ${ads.map(c => `
          <div style="border:1px solid var(--border);border-radius:10px;padding:12px;">
            <div style="display:flex;gap:10px;">
              ${c.image_url ? `<img src="${c.image_url}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;flex-shrink:0;">` : `<div style="width:64px;height:64px;border-radius:6px;background:var(--panel2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">${c.video_id ? "🎬" : "🖼️"}</div>`}
              <div style="min-width:0;">
                <div style="font-weight:600;font-size:12.5px;">${escH(c.headline || c.creative_name || "—")}</div>
                ${c.status ? `<span class="pill ${c.status}" style="margin-top:3px;">${escH(c.status)}</span>` : ""}
              </div>
            </div>
            <div style="font-size:11.5px;color:var(--muted);margin-top:8px;max-height:60px;overflow:hidden;">${escH((c.primary_text || "").slice(0, 200))}${(c.primary_text || "").length > 200 ? "…" : ""}</div>
            ${c.destination_link ? `<div style="font-size:10.5px;color:var(--accent);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🔗 ${escH(c.destination_link)}</div>` : ""}
            ${c.spend_latest != null ? `
            <div style="display:flex;gap:10px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:10.5px;">
              <div><div style="color:var(--muted);">Spend</div><div class="s">${fN(c.spend_latest)}</div></div>
              <div><div style="color:var(--muted);">CTR</div><div class="${ctrCls(c.ctr_latest)}">${c.ctr_latest != null ? parseFloat(c.ctr_latest).toFixed(2) + "%" : "—"}</div></div>
              <div><div style="color:var(--muted);">Orders</div><div class="s">${c.orders_latest ?? 0}</div></div>
              <div><div style="color:var(--muted);">CPA</div><div class="s">${c.cpa_latest != null ? fN(c.cpa_latest) : "—"}</div></div>
            </div>` : `<div style="font-size:10px;color:var(--muted);margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">No per-ad metrics yet -- "Pull & Refresh" on the Campaigns tab.</div>`}
            <div style="font-size:10px;color:var(--muted);margin-top:6px;display:flex;justify-content:space-between;">
              <span>${c.cta_type ? escH(c.cta_type.replace(/_/g, " ")) : ""}</span>
              <span>${c.meta_ad_id ? `Ad ${escH(c.meta_ad_id)}` : ""}</span>
            </div>
          </div>`).join("")}
        </div>`}
    </div>`;
}

// ── TAB: PERFORMANCE ─────────────────────────────────────────────────────────
// Spend and conversations per buyer come live from Meta (grouped by the media
// buyer each ad account belongs to); orders and revenue stay the real numbers
// from the orders/payments tables.
function bvMergeLiveSpend(roas, liveRows) {
  const live = new Map();
  for (const r of liveRows || []) {
    const k = r.media_buyer_id ?? "none";
    const a = live.get(k) ?? { spend: 0, conversations: 0 };
    a.spend += r.spend; a.conversations += r.conversations;
    live.set(k, a);
  }
  const list = roas.list.map(r => ({ ...r, spend: live.get(r.id)?.spend ?? 0, conversations: live.get(r.id)?.conversations ?? 0 }));
  for (const [k, a] of live) if (!list.some(r => r.id === k)) list.push({ id: k, buyer: undefined, orders: 0, revenue: 0, delivered: 0, confirmed: 0, spend: a.spend, conversations: a.conversations });
  const tot = list.reduce((t, r) => ({ spend: t.spend + r.spend, revenue: t.revenue + r.revenue, delivered: t.delivered + r.delivered, confirmed: t.confirmed + r.confirmed, orders: t.orders + r.orders, conversations: t.conversations + r.conversations, awaiting: t.awaiting + (r.awaiting || 0), awaitingOrders: t.awaitingOrders + (r.awaitingOrders || 0), fees: t.fees + (r.fees || 0), unassigned: t.unassigned + (r.unassigned || 0) }), { spend: 0, revenue: 0, delivered: 0, confirmed: 0, orders: 0, conversations: 0, awaiting: 0, awaitingOrders: 0, fees: 0, unassigned: 0 });
  return { list, tot };
}

async function renderPerformance(el, fromDate, toDate, force = false) {
  fromDate = fromDate || watDate(-29);
  toDate = toDate || watDate(0);

  const [live, roasRaw] = await Promise.all([
    fetchLiveDaily(fromDate, toDate, force),
    fetchBuyerRoas(fromDate, toDate),
  ]);
  const { list: buyerList, tot: buyerTot } = bvMergeLiveSpend(roasRaw, live.rows);
  const t = liveSum(live.rows);
  const dash = "—";
  const acct = accountsList.find(a => a.id === activeAccountId);
  const rows = (live.rows || []).filter(r => !activeAccountId || r.account_id === activeAccountId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.spend - a.spend)).slice(0, 500);
  const hasPurchases = rows.some(r => r.purchases > 0);
  const hasWeb = rows.some(r => r.kind === "purchase");

  window._bvLastRoasExport = { fromDate, toDate, buyerList };

  el.innerHTML = `
    <div class="sh">
      <div class="sh-title">Ad Spend &amp; ROAS</div>
      <div class="sh-actions">
        <input type="date" id="perfFrom" value="${fromDate}" style="width:auto;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px;">
        <input type="date" id="perfTo" value="${toDate}" style="width:auto;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px;">
        <button class="btn btn-g" id="perfApply">Apply</button>
        <button class="btn btn-a" id="perfLive" title="Reads the numbers straight from Meta again">↻ Refresh live data</button>
        <button class="btn btn-g" onclick="bvExportRoasCsv()">⬇ Download CSV</button>
      </div>
    </div>
    ${liveNotice(live)}

    <div class="g4">
      <div class="kc"><div class="kc-lbl">Spend</div><div class="kc-val">${live.ok ? fN(t.spend) : dash}</div><div class="kc-sub">live from Meta, all your ad accounts</div></div>
      <div class="kc"><div class="kc-lbl">Conversations</div><div class="kc-val a">${live.ok ? t.conversations.toLocaleString("en-NG") : dash}</div><div class="kc-sub">${live.ok && t.costPerConv != null ? fN(t.costPerConv) + " per conversation" : "WhatsApp chats started"}</div></div>
      <div class="kc"><div class="kc-lbl">Impressions</div><div class="kc-val">${live.ok ? t.impressions.toLocaleString("en-NG") : dash}</div><div class="kc-sub">${live.ok ? `${t.clicks.toLocaleString("en-NG")} link clicks${t.linkCtr != null ? ` · ${t.linkCtr.toFixed(2)}% CTR` : ""}` : ""}</div></div>
      <div class="kc"><div class="kc-lbl">Orders / cost per order</div><div class="kc-val">${buyerTot.orders}</div><div class="kc-sub">${buyerTot.orders && live.ok ? fN(t.spend / buyerTot.orders) + " per order" : "no orders yet"}</div></div>
    </div>

    <div class="g4">
      <div class="kc"><div class="kc-lbl">Order revenue</div><div class="kc-val">${fN(buyerTot.revenue)}</div><div class="kc-sub">excl. cancelled/returned</div></div>
      <div class="kc"><div class="kc-lbl">ROAS (orders)</div><div class="kc-val a">${roasFmt(buyerTot.revenue, buyerTot.spend)}</div></div>
      <div class="kc"><div class="kc-lbl">ROAS (delivered)</div><div class="kc-val w">${roasFmt(buyerTot.delivered, buyerTot.spend)}</div><div class="kc-sub">marked delivered -- not a payment confirmation</div></div>
      <div class="kc"><div class="kc-lbl">Real ROAS</div><div class="kc-val a">${roasFmt(buyerTot.confirmed, buyerTot.spend)}</div><div class="kc-sub">cash in hand: transfers + cash on delivery already paid out</div></div>
    </div>

    <div class="g4">
      <div class="kc"><div class="kc-lbl">Awaiting payout</div><div class="kc-val w">${fN(buyerTot.awaiting)}</div><div class="kc-sub">${buyerTot.awaitingOrders} delivered cash-on-delivery order${buyerTot.awaitingOrders === 1 ? "" : "s"} · Shipbubble has the cash</div></div>
      <div class="kc"><div class="kc-lbl">ROAS incl. awaiting payout</div><div class="kc-val a">${roasFmt(buyerTot.confirmed + buyerTot.awaiting, buyerTot.spend)}</div><div class="kc-sub">cash in hand + delivered cash on delivery</div></div>
      <div class="kc"><div class="kc-lbl">Net ROAS</div><div class="kc-val a">${roasFmt(buyerTot.confirmed + buyerTot.awaiting - buyerTot.fees, buyerTot.spend)}</div><div class="kc-sub">after ${fN(buyerTot.fees)} Shipbubble delivery + cash-on-delivery fees</div></div>
      <div class="kc"><div class="kc-lbl">Unassigned orders</div><div class="kc-val ${buyerTot.unassigned ? "w" : ""}">${buyerTot.unassigned}</div><div class="kc-sub">${buyerTot.unassigned ? "no media buyer could be found for these" : "every order belongs to the buyer who ran the ads"}</div></div>
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Spend &amp; ROAS by media buyer</div><div class="ph-count">Spend is each buyer's own ad accounts, live from Meta</div></div>
      ${!buyerList.some(r => r.spend || r.orders) ? `<div class="empty"><div class="empty-ico">📊</div>No spend or orders in this range yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Buyer</th><th>Spend</th><th>Conversations</th><th>Cost / conversation</th><th>Orders</th><th>Cost / order</th><th>Revenue</th><th>ROAS</th><th>Delivered ROAS</th><th>Real ROAS</th><th>Awaiting payout</th><th>ROAS incl. awaiting</th><th>Net ROAS</th></tr>
        ${buyerList.filter(r => r.spend || r.orders).sort((a, b) => b.spend - a.spend).map(r => `<tr>
          <td class="s">${r.buyer ? `${escH(r.buyer.name)} <span style="color:var(--muted)">[${escH(r.buyer.code)}]</span>` : `<span style="color:var(--muted)">Unattributed</span>`}</td>
          <td>${fN(r.spend)}</td>
          <td>${r.conversations}</td>
          <td>${r.conversations ? fN(r.spend / r.conversations) : dash}</td>
          <td>${r.orders}</td>
          <td>${r.orders ? fN(r.spend / r.orders) : dash}</td>
          <td>${fN(r.revenue)}</td>
          <td class="${roasCls(r.revenue, r.spend)}">${roasFmt(r.revenue, r.spend)}</td>
          <td class="${roasCls(r.delivered, r.spend)}">${roasFmt(r.delivered, r.spend)}</td>
          <td class="${roasCls(r.confirmed, r.spend)}" title="Confirmed payments only: transfers and cash on delivery that Shipbubble has already paid out.">${roasFmt(r.confirmed, r.spend)}</td>
          <td>${r.awaiting ? fN(r.awaiting) : dash}</td>
          <td class="${roasCls(r.confirmed + (r.awaiting || 0), r.spend)}">${roasFmt(r.confirmed + (r.awaiting || 0), r.spend)}</td>
          <td class="${roasCls(r.confirmed + (r.awaiting || 0) - (r.fees || 0), r.spend)}" title="After Shipbubble delivery and cash-on-delivery fees on delivered orders.">${roasFmt(r.confirmed + (r.awaiting || 0) - (r.fees || 0), r.spend)}</td>
        </tr>`).join("")}
      </table></div>`}
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Daily metrics${acct ? ` · ${escH(acct.nickname || acct.name || "")}` : ""}</div><div class="ph-count">${rows.length} rows · per ad set, per day</div></div>
      ${!live.ok ? "" : !rows.length
        ? `<div class="empty"><div class="empty-ico">📊</div>No ad spend in this date range for this ad account.</div>`
        : `<div class="tbl-wrap"><table>
          <tr><th>Date</th><th>Ad Set</th><th>Spend</th><th>Conversations</th><th>Cost / conversation</th>${hasPurchases ? "<th>Purchases</th>" : ""}${hasWeb ? "<th>Landing page views</th><th>Cost / page view</th>" : ""}<th>Impressions</th><th>Reach</th><th>Link clicks</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Frequency</th></tr>
          ${rows.map(r => `<tr>
            <td class="n">${r.date}</td>
            <td class="s n" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escH(r.adset_name || "")}">${escH(r.adset_name || "—")}</td>
            <td>${fN(r.spend)}</td>
            <td class="s">${r.conversations}</td>
            <td>${r.cost_per_conversation != null ? fN(r.cost_per_conversation) : dash}</td>
            ${hasPurchases ? `<td>${r.purchases}</td>` : ""}
            ${hasWeb ? `<td>${r.kind === "purchase" ? (r.landing_page_views || 0).toLocaleString("en-NG") : dash}</td><td>${r.kind === "purchase" && r.cost_per_landing_page_view != null ? fN(r.cost_per_landing_page_view) : dash}</td>` : ""}
            <td>${r.impressions.toLocaleString("en-NG")}</td>
            <td>${r.reach.toLocaleString("en-NG")}</td>
            <td>${r.clicks.toLocaleString("en-NG")}</td>
            <td class="${ctrCls(r.ctr)}">${r.impressions ? r.ctr.toFixed(2) + "%" : dash}</td>
            <td>${r.cpc ? fN(r.cpc) : dash}</td>
            <td>${r.cpm ? fN(r.cpm) : dash}</td>
            <td>${r.reach ? r.frequency.toFixed(2) + "×" : dash}</td>
          </tr>`).join("")}
        </table></div>`}
    </div>`;

  document.getElementById("perfApply").addEventListener("click", () => {
    renderPerformance(el, document.getElementById("perfFrom").value, document.getElementById("perfTo").value);
  });
  document.getElementById("perfLive").addEventListener("click", () => {
    renderPerformance(el, document.getElementById("perfFrom").value, document.getElementById("perfTo").value, true);
  });
}