// Revora dashboard, part 19 of 23

// renderWallet lives in 26-wallet.js (rebuilt screen).

// Event Manager, per ad account: datasets (pixels), event counts, browser vs server, create / pick a dataset, send a test event.
let bvEventsAcct = null, bvEventsDays = 7;
async function bvEventsPanel() {
  const box = document.getElementById("eventsPanel");
  if (!box) return;
  const accts = accountsList || [];
  if (!accts.length) { box.innerHTML = `<div class="ph"><div class="ph-title">Event Manager</div></div><div class="empty"><div class="empty-ico">📡</div>Add or get an ad account first. Its datasets show here.</div>`; return; }
  if (!bvEventsAcct || !accts.some(a => a.id === bvEventsAcct)) bvEventsAcct = (activeAccountId && accts.some(a => a.id === activeAccountId)) ? activeAccountId : accts[0].id;
  box.innerHTML = `<div class="ph"><div class="ph-title">Event Manager</div></div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Your datasets (pixels) and the events they receive, per ad account. Switch accounts to see another one.</div>
    <div class="fg"><div class="field"><label>Ad account</label><select id="evAcct">${accts.map(a => `<option value="${a.id}" ${a.id === bvEventsAcct ? "selected" : ""}>${escH(a.nickname || a.name)}${a.billing_mode === "managed" ? " · Revora" : ""}</option>`).join("")}</select></div>
    <div class="field"><label>Period</label><select id="evDays"><option value="1" ${bvEventsDays === 1 ? "selected" : ""}>Last 24 hours</option><option value="7" ${bvEventsDays === 7 ? "selected" : ""}>Last 7 days</option><option value="30" ${bvEventsDays === 30 ? "selected" : ""}>Last 30 days</option></select></div></div>
    <div id="evBody" style="margin-top:10px;"><div class="empty">Loading…</div></div>`;
  box.querySelector("#evAcct").addEventListener("change", e => { bvEventsAcct = e.target.value; bvEventsPanel(); });
  box.querySelector("#evDays").addEventListener("change", e => { bvEventsDays = Number(e.target.value); bvEventsPanel(); });
  const body = box.querySelector("#evBody");
  const r = await sbFn("events-manager", { action: "overview", ad_account_id: bvEventsAcct, days: bvEventsDays }).catch(err => ({ error: err.message }));
  if (r.error) { body.innerHTML = `<div class="msg err">❌ ${escH(r.error)}</div>`; return; }
  const ago2 = t => { if (!t) return "never"; const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
  const keyEv = ["PageView", "ViewContent", "InitiateCheckout", "Lead", "Purchase"];
  let html = "";
  if (r.note) html += `<div style="font-size:11px;color:var(--warn);margin-bottom:8px;">${escH(r.note)}</div>`;
  if (!r.pixels.length) html += `<div class="empty"><div class="empty-ico">📡</div>This ad account has no dataset yet.</div>${r.can_create ? `<button type="button" class="btn btn-a" id="evCreate" style="margin-top:8px;">Create a dataset</button>` : ""}`;
  for (const p of r.pixels) {
    const total = Object.values(p.events).reduce((t, n) => t + n, 0);
    const max = Math.max(1, ...p.daily.map(d => d.total));
    const srv = p.methods.server || p.methods.SERVER || 0, brw = p.methods.browser || p.methods.BROWSER || 0;
    const others = Object.keys(p.events).filter(k => !keyEv.includes(k));
    html += `<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
        <div><b>${escH(p.name || "Dataset")}</b> <span style="color:var(--muted);font-size:10.5px;font-family:'JetBrains Mono',monospace;">${escH(p.id)}</span>
          <div style="font-size:10.5px;color:var(--muted);">Last event ${ago2(p.last_fired_time)}${p.unavailable ? " · unavailable" : ""}</div></div>
        <div>${p.active ? `<span class="pill active">Used by this ad account</span>` : `<button type="button" class="btn btn-a evUse" data-id="${p.id}" style="padding:3px 10px;font-size:10px;">Use this dataset</button>`}</div></div>
      ${p.stats_error ? `<div style="font-size:10.5px;color:var(--danger);margin-top:6px;">${escH(p.stats_error)}</div>` : `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;">${keyEv.map(k => `<div style="flex:1;min-width:92px;background:var(--panel2);border-radius:8px;padding:6px 8px;"><div style="font-size:9.5px;color:var(--muted);">${k}</div><div style="font-size:15px;font-weight:700;">${(p.events[k] || 0).toLocaleString()}</div></div>`).join("")}</div>
      <div style="display:flex;align-items:flex-end;gap:2px;height:46px;margin-bottom:4px;">${p.daily.map(d => `<div title="${escH(d.date)}: ${d.total}" style="flex:1;background:var(--accent);opacity:.75;border-radius:2px 2px 0 0;height:${Math.max(3, Math.round(d.total / max * 46))}px;"></div>`).join("") || `<span style="font-size:10.5px;color:var(--muted);">No events in this period.</span>`}</div>
      <div style="font-size:10.5px;color:var(--muted);">${total.toLocaleString()} events · from browser ${brw.toLocaleString()} · from server (Conversions API) ${srv.toLocaleString()}${others.length ? " · other: " + others.slice(0, 5).map(k => escH(k) + " " + p.events[k]).join(", ") : ""}</div>`}
      <details style="margin-top:8px;"><summary style="font-size:11px;cursor:pointer;color:var(--accent);">Send a test event</summary>
        <div style="font-size:10.5px;color:var(--muted);margin:6px 0;">In Meta's Events Manager, open this dataset's <b>Test events</b> tab and copy the test code. Paste it here to send a server event and see it arrive there.</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;"><input class="evCode" data-id="${p.id}" placeholder="TEST12345" style="flex:1;min-width:120px;"><select class="evName" data-id="${p.id}">${["PageView", "ViewContent", "InitiateCheckout", "Lead", "Purchase"].map(n => `<option>${n}</option>`).join("")}</select><button type="button" class="btn btn-a evTest" data-id="${p.id}" style="padding:3px 10px;font-size:10px;">Send test</button></div>
        <div class="evTestMsg" data-id="${p.id}" style="margin-top:6px;"></div></details>
    </div>`;
  }
  html += `<div style="font-size:10.5px;color:var(--muted);">Server events (Conversions API): Revora sends a purchase event from your orders automatically for any ad account that has a dataset, so they appear above under "from server".</div>`;
  if (r.pixels.length) html += `<div id="evQuality" style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px;"><b>Customer details sent with events</b><div style="font-size:10.5px;color:var(--muted);">Loading…</div></div>
    <div id="evConv" style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px;"><b>Custom conversions</b><div style="font-size:10.5px;color:var(--muted);">Loading…</div></div>`;
  body.innerHTML = html;
  if (r.pixels.length) bvEventsExtras(body, r);
  body.querySelector("#evCreate")?.addEventListener("click", async e => {
    e.target.disabled = true; e.target.textContent = "Creating…";
    const c = await sbFn("events-manager", { action: "create_dataset", ad_account_id: bvEventsAcct }).catch(err => ({ error: err.message }));
    if (c.error) { alert(c.error); e.target.disabled = false; e.target.textContent = "Create a dataset"; return; }
    bvToast(c.existing ? "Dataset linked" : "Dataset created"); await loadAccounts(); bvEventsPanel();
  });
  body.querySelectorAll(".evUse").forEach(b2 => b2.addEventListener("click", async () => {
    b2.disabled = true;
    const c = await sbFn("events-manager", { action: "use_dataset", ad_account_id: bvEventsAcct, pixel_id: b2.dataset.id }).catch(err => ({ error: err.message }));
    if (c.error) { alert(c.error); b2.disabled = false; return; }
    bvToast("This ad account now uses that dataset"); await loadAccounts(); bvEventsPanel();
  }));
  body.querySelectorAll(".evTest").forEach(b2 => b2.addEventListener("click", async () => {
    const id = b2.dataset.id, msg = body.querySelector(`.evTestMsg[data-id="${id}"]`);
    const code = body.querySelector(`.evCode[data-id="${id}"]`).value.trim(), name = body.querySelector(`.evName[data-id="${id}"]`).value;
    b2.disabled = true; b2.textContent = "Sending…";
    const c = await sbFn("events-manager", { action: "test_event", ad_account_id: bvEventsAcct, pixel_id: id, test_code: code, event_name: name }).catch(err => ({ error: err.message }));
    msg.innerHTML = c.error ? `<div class="msg err">❌ ${escH(c.error)}</div>` : `<div class="msg ok">✅ Sent ${escH(c.event_name)}. Meta received ${c.events_received}. Check the Test events tab.</div>`;
    b2.disabled = false; b2.textContent = "Send test";
  }));
}

// Customer-detail quality and custom conversions for the chosen ad account.
async function bvEventsExtras(body, r) {
  const q = await sbFn("events-manager", { action: "quality", ad_account_id: bvEventsAcct, days: bvEventsDays }).catch(err => ({ error: err.message }));
  const qb = body.querySelector("#evQuality");
  if (qb) {
    const names = { em: "Email", ph: "Phone", fn: "First name", ln: "Last name", ct: "City", st: "State", zp: "Postcode", country: "Country", external_id: "Customer ID", fbp: "Browser ID (fbp)", fbc: "Click ID (fbc)", client_ip_address: "IP address", client_user_agent: "Device info" };
    if (q.error) qb.innerHTML = `<b>Customer details sent with events</b><div class="msg err">❌ ${escH(q.error)}</div>`;
    else {
      const rows = Object.entries(q.keys || {}).sort((a, b) => b[1] - a[1]);
      const good = ["em", "ph", "fbc", "fbp", "external_id"];
      const have = good.filter(k => (q.keys || {})[k] > 0).length;
      qb.innerHTML = `<b>Customer details sent with events</b>
        <div style="font-size:10.5px;color:var(--muted);margin:4px 0 8px;">The more details each event carries (email, phone, click ID), the better Meta can match it to a person, and the better your ads optimise. Meta's own 0 to 10 match score is only shown inside Meta, so this lists what is actually being sent.</div>
        ${q.unavailable ? `<div style="font-size:11px;color:var(--warn);">${escH(q.unavailable)}</div>` : rows.length ? rows.map(([k, n]) => { const pc = q.total ? Math.min(100, Math.round(n / q.total * 100)) : 0; return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:11px;"><div style="width:130px;">${escH(names[k] || k)}</div><div style="flex:1;background:var(--panel2);border-radius:4px;height:8px;"><div style="width:${pc}%;background:var(--accent);height:8px;border-radius:4px;"></div></div><div style="width:78px;text-align:right;color:var(--muted);">${n.toLocaleString()} (${pc}%)</div></div>`; }).join("") + `<div style="font-size:11px;margin-top:8px;">${have >= 4 ? "✅ Good coverage." : have >= 2 ? "⚠️ Fair. Sending email and phone with purchases will help." : "⚠️ Low. Few customer details are reaching Meta."}</div>` : `<div style="font-size:11px;color:var(--muted);">No customer details recorded in this period.</div>`}`;
    }
  }
  const cv = await sbFn("events-manager", { action: "conversions", ad_account_id: bvEventsAcct }).catch(err => ({ error: err.message }));
  const cb = body.querySelector("#evConv");
  if (!cb) return;
  const types = ["PURCHASE", "LEAD", "COMPLETE_REGISTRATION", "ADD_TO_CART", "INITIATED_CHECKOUT", "CONTENT_VIEW", "OTHER"];
  cb.innerHTML = `<b>Custom conversions</b>
    <div style="font-size:10.5px;color:var(--muted);margin:4px 0 8px;">Count a visit to a page as a result, for example any page whose address contains "thank-you".</div>
    ${cv.error ? `<div class="msg err">❌ ${escH(cv.error)}</div>` : (cv.items || []).length ? (cv.items || []).map(c => `<div style="border-bottom:1px solid var(--border);padding:5px 0;font-size:11.5px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><span><b>${escH(c.name)}</b> · ${escH(c.type || "")}</span><span style="color:var(--muted);">${escH((() => { try { return "page contains " + (JSON.parse(c.rule)?.url?.i_contains ?? JSON.parse(c.rule)?.and?.[0]?.url?.i_contains ?? ""); } catch { return ""; } })())}${c.last_fired_time ? " · last " + new Date(c.last_fired_time).toLocaleDateString() : ""}</span></div>`).join("") : `<div style="font-size:11px;color:var(--muted);">None yet.</div>`}
    <div class="fg" style="margin-top:8px;"><div class="field"><label>Name</label><input id="cvName" placeholder="Thank-you page visit"></div>
    <div class="field"><label>Page address contains</label><input id="cvContains" placeholder="thank-you"></div>
    <div class="field"><label>Counts as</label><select id="cvType">${types.map(t => `<option>${t}</option>`).join("")}</select></div>
    <div class="field"><label>Value each (₦, optional)</label><input id="cvValue" type="number" min="0"></div></div>
    <button type="button" class="btn btn-a" id="cvAdd" style="margin-top:6px;">Create custom conversion</button><div id="cvMsg" style="margin-top:6px;"></div>`;
  cb.querySelector("#cvAdd").addEventListener("click", async e => {
    const msg = cb.querySelector("#cvMsg"); e.target.disabled = true;
    const c = await sbFn("events-manager", { action: "conversion_create", ad_account_id: bvEventsAcct, name: cb.querySelector("#cvName").value, contains: cb.querySelector("#cvContains").value, type: cb.querySelector("#cvType").value, value: cb.querySelector("#cvValue").value }).catch(err => ({ error: err.message }));
    e.target.disabled = false;
    if (c.error) { msg.innerHTML = `<div class="msg err">❌ ${escH(c.error)}</div>`; return; }
    bvToast("Custom conversion created"); bvEventsPanel();
  });
}

function bvSetSec(id) { document.querySelector(`.set-nav-btn[data-sec="${id}"]`)?.click(); }
async function bvMakeDataset(btn, accountId) {
  btn.disabled = true; btn.textContent = "Creating…";
  const r = await sbFn("events-manager", { action: "create_dataset", ad_account_id: accountId }).catch(err => ({ error: err.message }));
  if (r.error) { alert(r.error); btn.disabled = false; btn.textContent = "Create dataset"; return; }
  bvToast(r.existing ? "Dataset linked" : "Dataset created"); await loadAccounts(); if (activeTab === "settings") render();
}

// "Buy a Meta ad account from Revora": the customer takes a ready ad account from Revora's pool, names it, and can create a dataset (pixel) at once.
// A platform admin also sees the pool and can add ad accounts to it.
async function bvRevoraAcctPanel() {
  const box = document.getElementById("revoraAcctPanel");
  if (!box) return;
  box.innerHTML = `<div class="ph"><div class="ph-title">Buy a Meta ad account from Revora</div></div><div class="empty">Loading…</div>`;
  const av = await sbFn("ad-account-pool", { action: "availability" }).catch(() => ({ error: "offline" }));
  const mine = (accountsList || []).filter(a => a.billing_mode === "managed");
  let html = `<div class="ph"><div class="ph-title">Buy a Meta ad account from Revora</div><div class="ph-count">${Number(av.fee || 0) ? "₦" + Number(av.fee).toLocaleString() + " each" : ""}</div></div>
    <div style="font-size:12.5px;color:var(--text2);margin-bottom:10px;">A ready Meta ad account, paid from your wallet.</div>`;
  if (mine.length) html += mine.map(a => `<div style="border-bottom:1px solid var(--border);padding:8px 0;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
      <div><b>${escH(a.nickname || a.name)}</b><div style="font-size:10.5px;color:var(--muted);">Dataset: ${escH(a.pixel_name || a.meta_pixel_id || "none yet")}</div></div>
      ${a.meta_pixel_id ? "" : `<button type="button" class="btn btn-a mkDatasetBtn" data-id="${a.id}" style="padding:3px 10px;font-size:10px;">Create dataset</button>`}</div>`).join("");
  if (av.error) html += `<div class="msg err" style="margin-top:8px;">❌ ${escH(av.error)}</div>`;
  else if (!av.available) html += `<div style="font-size:11.5px;color:var(--warn);margin-top:8px;">All Revora ad accounts are taken right now. Check back soon.</div>`;
  else html += `<form id="claimAcctForm" style="margin-top:10px;" novalidate>
      <div class="fg"><div class="field"><label>Name your ad account *</label><input id="claimName" placeholder="e.g. Quality Herb Main"></div></div>
      <label style="font-size:11.5px;display:flex;gap:6px;align-items:center;margin-top:6px;"><input type="checkbox" id="claimPixel" checked> Create a dataset (pixel) for it now</label>
      <div style="font-size:11.5px;margin-top:8px;">Price: <b>₦${Number(av.fee || 0).toLocaleString()}</b> from your wallet (balance ₦${Math.max(0, Math.round(av.wallet || 0)).toLocaleString()}).${(av.wallet || 0) < (av.fee || 0) ? ' <span style="color:var(--warn);"><a href="javascript:void(0)" onclick="bvGoToTab(&quot;wallet&quot;)" style="color:var(--accent);">Top up your wallet first</a>.</span>' : ""}</div>
      <button type="submit" class="btn btn-a btn-full" style="margin-top:10px;" id="claimBtn">Buy ad account · ₦${Number(av.fee || 0).toLocaleString()}</button><div id="claimMsg"></div></form>`;
  html += `<div id="poolAdmin"></div>`;
  box.innerHTML = html;
  box.querySelector("#claimAcctForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = box.querySelector("#claimBtn"), msg = box.querySelector("#claimMsg");
    const name = box.querySelector("#claimName").value.trim();
    if (name.length < 2) { msg.innerHTML = `<div class="msg err">❌ Give the ad account a name.</div>`; return; }
    btn.disabled = true; btn.textContent = "Setting it up…";
    const r = await sbFn("ad-account-pool", { action: "claim", name, create_pixel: box.querySelector("#claimPixel").checked }).catch(err => ({ error: err.message }));
    if (r.error) { msg.innerHTML = `<div class="msg err">❌ ${escH(r.error)}</div>`; btn.disabled = false; btn.textContent = "Buy ad account"; return; }
    bvToast("Ad account bought and ready"); if (r.pixel_note) alert(r.pixel_note);
    await loadAccounts(); renderSettings(document.getElementById("mainContent"));
  });
  box.querySelectorAll(".mkDatasetBtn").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "Creating…";
    const r = await sbFn("ad-account-pool", { action: "create_pixel", ad_account_id: b.dataset.id }).catch(err => ({ error: err.message }));
    if (r.error) { alert(r.error); b.disabled = false; b.textContent = "Create dataset"; return; }
    bvToast("Dataset created"); await loadAccounts(); renderSettings(document.getElementById("mainContent"));
  }));
  // Platform admin only: the pool.
  const pool = await sbFn("ad-account-pool", { action: "pool_list" }).catch(() => ({ error: "x" }));
  if (pool.error) return;
  const pa = box.querySelector("#poolAdmin");
  const rows = pool.accounts || [];
  pa.innerHTML = `<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px;"><div class="ph-title" style="margin-bottom:6px;">Ad account pool (platform admin)</div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">Ad accounts in Revora's Business Manager that customers can take. Assign each one to Revora's system user in Business Manager first, then add its number here. ${rows.filter(r => r.status === "available").length} free.</div>
    <div class="tbl-wrap"><table><tr><th>Ad account</th><th>Name on Meta</th><th>Status</th><th></th></tr>
    ${rows.map(r => `<tr><td class="n">${escH(r.meta_ad_account_id)}</td><td class="s">${escH(r.meta_name || r.label || "")}</td><td>${escH(r.status)}</td><td>${r.status === "available" ? `<button type="button" class="btn btn-g poolRetire" data-id="${r.id}" style="padding:2px 8px;font-size:10px;">Retire</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="s">Empty. Add your first one below.</td></tr>`}</table></div>
    <form id="poolAddForm" style="margin-top:8px;display:flex;gap:6px;" novalidate><input id="poolAddId" placeholder="Ad account number" style="flex:1;"><button type="submit" class="btn btn-a" style="padding:4px 10px;font-size:10px;">Add to pool</button></form><div id="poolMsg"></div></div>`;
  sbFn("ad-account-pool", { action: "pool_earnings", days: 30 }).then(e => {
    if (e.error) return;
    pa.insertAdjacentHTML("afterbegin", `<div style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px;"><b>Last 30 days:</b> customers were billed ${fN(e.billed)}, Meta charged ${fN(e.raw)}, your earnings <b>${fN(e.profit)}</b>.</div>`);
  }).catch(() => {});
  pa.querySelector("#poolAddForm").addEventListener("submit", async e => {
    e.preventDefault();
    const r = await sbFn("ad-account-pool", { action: "pool_add", meta_ad_account_id: pa.querySelector("#poolAddId").value }).catch(err => ({ error: err.message }));
    if (r.error) { pa.querySelector("#poolMsg").innerHTML = `<div class="msg err">❌ ${escH(r.error)}</div>`; return; }
    bvToast("Added to the pool"); bvRevoraAcctPanel();
  });
  pa.querySelectorAll(".poolRetire").forEach(b => b.addEventListener("click", async () => { await sbFn("ad-account-pool", { action: "pool_retire", id: b.dataset.id }); bvRevoraAcctPanel(); }));
}