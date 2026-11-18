// Revora dashboard, part 03 of 23: MULTI-ACCOUNT MANAGEMENT · FORMATTERS · THEME TOGGLE · MOBILE HEADER MENU (account switcher + profile + logout, tucked behind · SIDEBAR COLLAPSE (desktop: shrinks to an icon rail) / DRAWER (mobile: · TABS

// ── MULTI-ACCOUNT MANAGEMENT ──────────────────────────────────────────────────
// Which ad accounts the header switcher offers. Everyone sees only THEIR OWN accounts there: a buyer's own, or an
// admin's personal ones (an admin has none unless they also run ads). The company-wide list stays in accountsList for
// Settings and the admin screens, so an admin never lands inside a buyer's ad dashboard by default.
function bvIsAdminRole() { const r = window.myProfile?.role; return r === "owner" || r === "admin"; }
function bvMyAccounts() {
  const mine = window.myProfile?.media_buyer_id;
  return (accountsList || []).filter(a => mine && a.media_buyer_id === mine);
}
async function loadAccounts() {
  const dot = document.getElementById("liveDot");
  try {
    const data = await sbQuery("ad_accounts", "order=created_at.desc");
    accountsList = data || [];

    // The mobile header menu duplicates this selector (crowding the header
    // on a phone otherwise) -- keep both in sync from one source of truth.
    const sels = [document.getElementById("acctSelector"), document.getElementById("acctSelectorMobile")].filter(Boolean);
    const mineList = bvIsAdminRole() ? bvMyAccounts() : accountsList;
    // Nothing to switch between -> hide the switcher entirely (admins without personal ad accounts).
    const hideSwitch = bvIsAdminRole() && mineList.length === 0;
    sels.forEach(sel => { sel.style.display = hideSwitch ? "none" : ""; });
    document.querySelectorAll(".hdr-menu-lbl").forEach(l => { if (/ad account/i.test(l.textContent)) l.style.display = hideSwitch ? "none" : ""; });

    if (mineList.length === 0) {
      sels.forEach(sel => sel.innerHTML = `<option value="">No Ad Accounts</option>`);
      activeAccountId = null;
      dot.classList.toggle("off", accountsList.length === 0 && !bvIsAdminRole());
      return;
    }

    // Preserve selection or set default
    if (!activeAccountId || !mineList.find(a => a.id === activeAccountId)) {
      activeAccountId = mineList[0].id;
    }

    const optsHtml = mineList.map(a =>
      `<option value="${a.id}" ${a.id === activeAccountId ? "selected" : ""}>${a.name}</option>`
    ).join("");
    sels.forEach(sel => sel.innerHTML = optsHtml);

    dot.classList.remove("off");
  } catch(err) {
    console.error("Failed to load accounts:", err);
    dot.classList.add("off");
  }
}

function onAcctSelectorChange(e) {
  activeAccountId = e.target.value;
  // Keep the other (desktop/mobile) selector showing the same account.
  [document.getElementById("acctSelector"), document.getElementById("acctSelectorMobile")]
    .filter(sel => sel && sel !== e.target).forEach(sel => sel.value = activeAccountId);
  render(); // Re-render everything for the new account context
}
document.getElementById("acctSelector").addEventListener("change", onAcctSelectorChange);
document.getElementById("acctSelectorMobile").addEventListener("change", onAcctSelectorChange);

async function loadApprovalCount() {
  try {
    const rows = await sbQuery("pending_approvals", "status=eq.pending&select=id");
    const badge = document.getElementById("approvalBadge");
    if (rows?.length > 0) {
      badge.textContent = rows.length;
      badge.style.display = "inline";
    } else {
      badge.style.display = "none";
    }
  } catch {}
}

// AI voice calls that flagged themselves for a human (medical question, wants
// to cancel, asked for a person) -- surfaced on the Orders tab badge so it's
// visible from anywhere in the dashboard, not just when that tab is open.
async function loadCallFlagCount() {
  try {
    const rows = await sbQuery("voice_calls", "needs_human=is.true&human_resolved_at=is.null&select=id");
    for (const id of ["callFlagBadge", "supportFlagBadge"]) {
      const badge = document.getElementById(id);
      if (!badge) continue;
      if (rows?.length > 0) {
        badge.textContent = rows.length;
        badge.style.display = "inline";
      } else {
        badge.style.display = "none";
      }
    }
  } catch {}
}

// ── FORMATTERS ────────────────────────────────────────────────────────────────
const fN  = n => n == null ? "—" : "₦" + Number(n).toLocaleString("en-NG", {maximumFractionDigits:0});
const fP  = n => n == null ? "—" : Number(n).toFixed(1) + "%";
const fK  = n => n == null ? "—" : Number(n) >= 1000 ? (Number(n)/1000).toFixed(1)+"k" : String(n);

function ago(iso) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60)    return s + "s ago";
  if (s < 3600)  return Math.floor(s/60)  + "m ago";
  if (s < 86400) return Math.floor(s/3600) + "h ago";
  return Math.floor(s/86400) + "d ago";
}

function hrs(iso) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso)) / 3600000);
}

function ctrCls(v) {
  if (!v) return "ctr-neu";
  const n = parseFloat(v);
  if (n >= CTR_WIN)   return "ctr-hot";
  if (n >= CTR_KILL)  return "ctr-warm";
  return "ctr-cold";
}

function decision(ctr, spend, h) {
  if (!h || h < MIN_HRS) return `<span class="pill warmup">warming up (${h}h)</span>`;
  const c = parseFloat(ctr || 0);
  const s = parseFloat(spend || 0);
  if (c >= CTR_WIN)  return `<span class="pill scaling">✦ scale ↑</span>`;
  if (c >= CTR_WATCH) return `<span class="pill watch">👁 watch</span>`;
  if (s > 3000 || c < CTR_KILL) return `<span class="pill loser">✕ kill</span>`;
  return `<span class="pill watch">👁 watch</span>`;
}

// ── THEME TOGGLE ──────────────────────────────────────────────────────────────
// Light (matching the landing page) is now the default enterprise look; dark
// stays available as an opt-in for anyone who prefers it.
let theme = localStorage.getItem("qh_theme") || "light";
function setTheme(t) {
  theme = t;
  document.documentElement.setAttribute("data-theme", t);
  document.getElementById("themeBtn").innerHTML = icon(t === "dark" ? "sun" : "moon", 15);
  localStorage.setItem("qh_theme", t);
}
setTheme(theme);
document.getElementById("themeBtn").addEventListener("click", () => setTheme(theme === "dark" ? "light" : "dark"));
document.getElementById("themeBtnMobile").addEventListener("click", () => setTheme(theme === "dark" ? "light" : "dark"));

// ── MOBILE HEADER MENU (account switcher + profile + logout, tucked behind
// one avatar button below 760px instead of crowding the header row) ─────────
const hdrMenuPanel = document.getElementById("hdrMenuPanel");
document.getElementById("hdrMenuBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  hdrMenuPanel.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (hdrMenuPanel.classList.contains("open") && !hdrMenuPanel.contains(e.target)) hdrMenuPanel.classList.remove("open");
});

// ── SIDEBAR COLLAPSE (desktop: shrinks to an icon rail) / DRAWER (mobile:
// off-canvas panel, since a horizontal scroll-strip of 16 tabs under the
// header ate the whole screen and still cut off labels) ─────────────────────
const sidebarEl = document.getElementById("tabsBar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const mobileMq = window.matchMedia("(max-width: 760px)");
let sidebarCollapsed = localStorage.getItem("qh_sidebar_collapsed") === "1";
function applySidebarState() {
  sidebarEl.classList.toggle("collapsed", sidebarCollapsed);
}
applySidebarState();
function closeMobileDrawer() {
  sidebarEl.classList.remove("mobile-open");
  sidebarBackdrop.classList.remove("open");
}
document.getElementById("sidebarToggle").addEventListener("click", () => {
  if (mobileMq.matches) {
    sidebarEl.classList.toggle("mobile-open");
    sidebarBackdrop.classList.toggle("open", sidebarEl.classList.contains("mobile-open"));
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem("qh_sidebar_collapsed", sidebarCollapsed ? "1" : "0");
    applySidebarState();
  }
});
sidebarBackdrop.addEventListener("click", closeMobileDrawer);
document.getElementById("sidebarClose").addEventListener("click", closeMobileDrawer);

// ── TABS ──────────────────────────────────────────────────────────────────────
let activeTab = "overview";
// Jump to a tab programmatically (e.g. a "Verify in Settings" link inside the
// campaign builder) -- closes any open modal first since Settings needs to
// actually be visible.
function bvGoToTab(tab) {
  document.getElementById("bvBuilderOverlay")?.remove();
  activeTab = tab;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  render();
}
document.getElementById("tabsBar").addEventListener("click", e => {
  const t = e.target.closest(".tab-btn");
  if (!t) return;
  if (t.dataset.link) { location.href = t.dataset.link; return; }
  activeTab = t.dataset.tab;
  window.bvLegacyOk = false;
  if (activeTab === "catalog") window.bvCat.pid = null;
  // Clicking into Campaigns from elsewhere should always land on the list,
  // not wherever the drill-down was left -- only "bvBackToCampaignsList"/
  // the breadcrumb buttons inside the tab itself should preserve a detail view.
  if (activeTab === "campaigns") campaignsView = { level: "list", campaignId: null, adSetId: null };
  if (activeTab === "settings") bvSetOpen = false; // phones open Settings on its list of sections
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b === t));
  if (mobileMq.matches) closeMobileDrawer();
  render();
});

// ── RENDER ROUTER ─────────────────────────────────────────────────────────────
async function render() {
  document.getElementById("lastSync").textContent = "synced " + new Date().toLocaleTimeString();
  const c = document.getElementById("mainContent");
  if (activeTab === "assistant") { c.innerHTML = ""; bvAssistantPage(true); bvUpdateAppBar(); return; }
  bvAssistantPage(false);
  bvUpdateAppBar();
  if (activeTab === "more") { renderMore(c); return; }
  if (activeTab === "adx") { try { await renderAdx(c); } catch (e) { c.innerHTML = `<div class="msg err" style="display:block;">❌ ${escH(e.message)}</div>`; } return; }
  if (["products", "shop", "vault"].includes(activeTab) && !window.bvLegacyOk) {
    activeTab = "catalog";
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === "catalog"));
  }
  
  // An ad account is only needed for ad-spend/campaign-performance tabs --
  // everything else (orders, order forms, products, conversations, website
  // leads, delivery, AI calls) is a buyer's own CRM data, nothing to do with
  // whether they've connected a Meta ad account yet. Previously this blocked
  // literally every tab, meaning a buyer who hadn't connected Meta couldn't
  // even use the order form link that's supposed to work from day one.
  const NEEDS_AD_ACCOUNT = new Set(["campaigns", "performance", "vault"]);
  if (NEEDS_AD_ACCOUNT.has(activeTab) && !activeAccountId && (bvIsAdminRole() ? true : accountsList.length === 0)) {
    c.innerHTML = `
      <div class="empty">
        <div class="empty-ico">🔌</div>
        <div style="margin-bottom: 12px;">${bvIsAdminRole() ? "Ad dashboards are personal: each media buyer sees their own. Company-wide numbers are on Overview and Leaderboard. If you run ads yourself, link your own ad account in Settings." : "No Ad Accounts linked yet."}</div>
        <button class="btn btn-a" onclick="bvGoToTab('settings')">Go to Settings to Link Account</button>
      </div>`;
    return;
  }

  c.innerHTML = `<div class="empty"><div class="spin" style="width:18px;height:18px;border-width:2px;"></div></div>`;
  try {
    if      (activeTab === "overview")  await renderOverview(c);
    else if (activeTab === "wallet")    await renderWallet(c);
    else if (activeTab === "hq")        await renderHq(c);
    else if (activeTab === "catalog")   await renderCatalog(c);
    else if (activeTab === "vault")     await renderVault(c);
    else if (activeTab === "campaigns") await renderCampaigns(c);
    else if (activeTab === "performance") await renderPerformance(c);
    else if (activeTab === "leaderboard") await renderLeaderboard(c);
    else if (activeTab === "products")  { await renderProducts(c); c.insertAdjacentHTML("afterbegin", `<button type="button" class="btn btn-g" style="margin-bottom:12px" onclick="window.bvLegacyOk=false;bvGoToTab('catalog')">← Back to Catalog</button>`); }
    else if (activeTab === "shop")      await renderShop(c);
    else if (activeTab === "orders")    await renderOrders(c);
    else if (activeTab === "calllogs")  await renderCallLogs(c);
    else if (activeTab === "support")   await renderSupportQueue(c);
    else if (activeTab === "riders")    await renderRiders(c);
    else if (activeTab === "caredesk")  await renderCareDesk(c);
    else if (activeTab === "forms")     await renderForms(c);
    else if (activeTab === "conversations") await renderConversations(c);
    else if (activeTab === "websites") await renderWebsites(c);
    else if (activeTab === "website-leads") await renderWebsiteLeads(c);
    else if (activeTab === "approvals") await renderApprovals(c);
    else if (activeTab === "earnings")  await renderEarnings(c);
    else if (activeTab === "settings")  { await renderSettings(c); bvRenderNotifPanel(); bvRenderKillRules(); bvRenderAiAgents(); bvRenderDomains(); bvRenderFbConnect(); bvRenderPagesPanel(); bvRenderWaPanel(); bvRenderHelpPanel(); bvRenderBillingPanel(); bvRenderPwPanel(); }
  } catch(e) {
    c.innerHTML = `<div class="panel"><div class="msg err">❌ Error loading data: ${e.message}</div></div>`;
  }
}

// ── TAB: OVERVIEW ─────────────────────────────────────────────────────────────
// ── LIVE META NUMBERS (shared by Overview + Ad Spend & ROAS) ────────────────
// One call to the ads-manager "daily" action returns every ad set's numbers
// per day for every ad account this person can see -- real spend, WhatsApp
// conversations, reach, frequency -- straight from Meta, no saved copy.
const watDate = (offsetDays = 0) => new Date(Date.now() + 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
let liveDaily = { key: "", at: 0, data: null };

// sbFn() injects the selected ad account into every call; here we want every
// account unless one is asked for, so call the function directly.
async function amCall(body) {
  try {
    const res = await fetch(`${SUPA_URL}/functions/v1/ads-manager`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionData?.access_token || ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) { return { ok: false, error: e.message }; }
}

async function fetchLiveDaily(since, until, force = false) {
  const key = `${since}|${until}`;
  if (!force && liveDaily.key === key && liveDaily.data?.ok && Date.now() - liveDaily.at < 60000) return liveDaily.data;
  const r = await amCall({ action: "daily", since, until });
  const data = r && r.ok ? r : { ok: false, error: r?.error || "Could not load live numbers from Meta.", rows: [], accounts: [] };
  liveDaily = { key, at: Date.now(), data };
  return data;
}

// Sum rows (ad set x day) into per-day totals. Reach isn't additive, so only
// the numbers that are get summed.
function liveByDay(rows) {
  const days = new Map();
  for (const r of rows || []) {
    const d = days.get(r.date) ?? { date: r.date, spend: 0, conversations: 0, purchases: 0, clicks: 0, impressions: 0, lpv: 0, webSpend: 0 };
    d.spend += r.spend; d.conversations += r.conversations; d.purchases += r.purchases; d.clicks += r.clicks; d.impressions += r.impressions;
    d.lpv += r.landing_page_views || 0; if (r.kind === "purchase") d.webSpend += r.spend;
    days.set(r.date, d);
  }
  return days;
}
function liveSum(rows) {
  const t = { spend: 0, conversations: 0, purchases: 0, clicks: 0, impressions: 0, lpv: 0, webSpend: 0, webClicks: 0, webPurchases: 0 };
  for (const r of rows || []) {
    t.spend += r.spend; t.conversations += r.conversations; t.purchases += r.purchases; t.clicks += r.clicks; t.impressions += r.impressions;
    t.lpv += r.landing_page_views || 0;
    if (r.kind === "purchase") { t.webSpend += r.spend; t.webClicks += r.clicks; t.webPurchases += r.purchases; }
  }
  t.costPerLpv = t.lpv > 0 ? t.webSpend / t.lpv : null;
  t.lpvRate = t.webClicks > 0 ? Math.min(100, t.lpv / t.webClicks * 100) : null;
  t.costPerConv = t.conversations > 0 ? t.spend / t.conversations : null;
  t.linkCtr = t.impressions > 0 ? t.clicks / t.impressions * 100 : null;
  return t;
}
function liveNotice(live) {
  if (!live.ok) return `<div class="msg err" style="display:block;margin-bottom:14px;">❌ Couldn't load live numbers from Meta: ${escH(live.error)} <button type="button" class="btn btn-g" style="padding:3px 10px;font-size:11px;margin-left:8px;" onclick="liveDaily.at=0;render()">Retry</button></div>`;
  const bad = (live.accounts || []).filter(a => a.error);
  return bad.length ? `<div class="msg err" style="display:block;margin-bottom:14px;">⚠ Some ad accounts could not be read from Meta (${bad.map(a => escH(a.name || "account")).join(", ")}), so their numbers are missing below.</div>` : "";
}

// ── TAB: OVERVIEW ─────────────────────────────────────────────────────────────
// Prepaid balance left in every ad account, live from Meta.
function bvOverviewBalances(bals) {
  if (!bals) return "";
  if (!bals.ok) return `<div class="panel"><div class="ph"><div class="ph-title">Ad account balances</div></div><div class="msg err" style="display:block;">❌ ${escH(bals.error || "Could not read balances from Meta.")}</div></div>`;
  const accts = bals.accounts || [];
  if (!accts.length) return "";
  const total = accts.reduce((s, a) => s + (a.available || 0), 0);
  return `<div class="panel">
    <div class="ph"><div class="ph-title">Ad account balances</div><div class="ph-count">Prepaid money left · live from Meta${accts.filter(a => a.available != null).length > 1 ? ` · total ${fN2(total)}` : ""}</div></div>
    ${accts.map(a => {
      if (a.error) return `<div class="am-balrow"><div><div class="nm">${escH(a.name || "Ad account")}</div><div class="sub">${escH(a.error)}</div></div><span class="pill watch">unavailable</span></div>`;
      const low = a.available != null && a.low_threshold != null && a.available <= a.low_threshold;
      const issue = a.account_status && a.account_status !== 1 ? `<span class="pill rejected">${escH(AM_ACCT_STATUS[a.account_status] || "Account issue")}</span>` : "";
      return `<div class="am-balrow${low ? " low" : ""}">
        <div><div class="nm">${escH(a.name || "Ad account")} ${issue}</div><div class="sub">${a.available == null ? "Card-billed account (no prepaid balance)" : low ? "Low — top up soon" : "Available to spend"}</div></div>
        <div class="amt">${a.available != null ? fN2(a.available) : "—"}</div>
      </div>`;
    }).join("")}
  </div>`;
}

async function renderOverview(el) {
  if (bvIsAdminRole()) return renderAdminOverview(el);
  const since = watDate(-6), until = watDate(0);
  // Ad numbers are for the people who run ads; customer care / delivery just see orders.
  const canAds = ["owner", "admin", "buyer"].includes(window.myProfile?.role);
  const [tot, deliv, returned, orders7, wallet, live, bals] = await Promise.all([
    sbCount("orders"),
    sbCount("orders", "order_status=eq.delivered"),
    sbCount("orders", "order_status=eq.returned"),
    sbCount("orders", `ordered_at=gte.${since}T00:00:00%2B01:00`).catch(() => 0),
    fetchWalletBalances().catch(() => ({ walletBalances: {}, fundingWalletBalance: 0 })),
    canAds ? fetchLiveDaily(since, until) : Promise.resolve({ ok: true, rows: [], accounts: [] }),
    canAds ? amCall({ action: "balances" }) : Promise.resolve(null),
  ]);
  const isAdminOv = window.myProfile?.role === "owner" || window.myProfile?.role === "admin";
  const myIdOv = window.myProfile?.media_buyer_id || null;
  const myApprovedOv = myIdOv ? (wallet.walletBalances[myIdOv]?.approved ?? 0) : 0;
  const walletChipLabel = isAdminOv ? (wallet.fundingWalletBalance < 0 ? "⚠️ Funding wallet low" : "Funding wallet") : "Ready to send";
  const walletChipBalance = isAdminOv ? wallet.fundingWalletBalance : (myApprovedOv > 0 ? myApprovedOv : null);

  const rate = tot ? (deliv / tot * 100).toFixed(1) : "0";
  const rateClr = parseFloat(rate) >= 70 ? "a" : parseFloat(rate) >= 50 ? "w" : "d";

  const days = liveByDay(live.rows);
  const week = liveSum(live.rows);
  const today = days.get(until) ?? { spend: 0, conversations: 0 };
  const yesterday = days.get(watDate(-1)) ?? { spend: 0 };
  const todayCpc = today.conversations > 0 ? today.spend / today.conversations : null;
  const dayList = [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  const realCostPerOrder = orders7 > 0 && live.ok ? week.spend / orders7 : null;
  const chatToOrder = week.conversations > 0 ? Math.min(100, orders7 / week.conversations * 100) : null;
  const dash = "—";
  const hasPurchases = week.purchases > 0;
  const hasWeb = week.lpv > 0 || week.webSpend > 0;

  el.innerHTML = `
    <div class="sh">
      <div class="sh-title">Overview</div>
      <div class="sh-actions" id="qaActions"></div>
    </div>
    <div id="setupCheckSlot"></div>

    ${walletChipBalance !== null ? `
    <div class="wallet-chip" onclick="activeTab='wallet'; document.querySelector('[data-tab=wallet]').click();">
      💰 ${walletChipLabel}: ${fN(walletChipBalance)} <span style="opacity:.7;">→ Wallet</span>
    </div>` : ""}

    <div class="qa">
      ${canAds ? `<button class="btn btn-a" id="btnLive" onclick="liveDaily.at=0;render()" title="Reads today's numbers straight from Meta">↻ Refresh live data</button>` : ""}
      <button class="btn btn-b" id="btnPull"  onclick="triggerMetrics()" title="Saves Meta's numbers into the dashboard's reports (Leaderboard)">📊 Pull Meta Metrics</button>
      <button class="btn btn-b" id="btnStructSync" onclick="triggerStructureSync()" title="Pulls every campaign/ad set/ad from Meta into this dashboard, whether launched from here or directly in Ads Manager">☁️ Sync from Meta</button>
      <button class="btn btn-g" id="btnSync"  onclick="triggerSync()">🔄 Sync Audiences</button>
    </div>
    <div id="actionMsg"></div>
    ${liveNotice(live)}

    ${canAds ? `<div class="g4">
      <div class="kc">
        <div class="kc-lbl">Spent today</div>
        <div class="kc-val">${live.ok ? fN(today.spend) : dash}</div>
        <div class="kc-sub">${live.ok ? `yesterday ${fN(yesterday.spend)}` : ""}</div>
      </div>
      <div class="kc">
        <div class="kc-lbl">Conversations · 7 days</div>
        <div class="kc-val a">${live.ok ? week.conversations.toLocaleString("en-NG") : dash}</div>
        <div class="kc-sub">${live.ok ? `${today.conversations} today · WhatsApp chats started` : ""}</div>
      </div>
      <div class="kc">
        <div class="kc-lbl">Cost per conversation</div>
        <div class="kc-val">${live.ok ? fN(week.costPerConv) : dash}</div>
        <div class="kc-sub">${live.ok ? `7 days${todayCpc != null ? ` · today ${fN(todayCpc)}` : ""}` : ""}</div>
      </div>
      <div class="kc">
        <div class="kc-lbl">Spent · 7 days</div>
        <div class="kc-val">${live.ok ? fN(week.spend) : dash}</div>
        <div class="kc-sub">${live.ok ? `${fN(week.spend / 7)} a day on average` : ""}</div>
      </div>
    </div>` : ""}

    ${canAds && hasWeb ? `<div class="g4">
      <div class="kc"><div class="kc-lbl">Landing page views · 7 days</div><div class="kc-val a">${week.lpv.toLocaleString("en-NG")}</div><div class="kc-sub">website ads only</div></div>
      <div class="kc"><div class="kc-lbl">Cost / landing page view</div><div class="kc-val">${week.costPerLpv != null ? fN(week.costPerLpv) : dash}</div><div class="kc-sub">website ad spend ÷ page views</div></div>
      <div class="kc"><div class="kc-lbl">Clicks that loaded the page</div><div class="kc-val b">${week.lpvRate != null ? week.lpvRate.toFixed(0) + "%" : dash}</div><div class="kc-sub">page views ÷ link clicks</div></div>
      <div class="kc"><div class="kc-lbl">Purchases · 7 days (Meta)</div><div class="kc-val">${week.webPurchases.toLocaleString("en-NG")}</div><div class="kc-sub">${week.webPurchases > 0 && week.webSpend > 0 ? fN(week.webSpend / week.webPurchases) + " each" : "from the website pixel"}</div></div>
    </div>` : ""}

    <div class="g4">
      <div class="kc">
        <div class="kc-lbl">Orders · 7 days</div>
        <div class="kc-val">${orders7}</div>
        <div class="kc-sub">${tot} orders all time</div>
      </div>
      <div class="kc">
        <div class="kc-lbl">Real cost per order</div>
        <div class="kc-val">${fN(realCostPerOrder)}</div>
        <div class="kc-sub">${realCostPerOrder != null ? "7-day ad spend ÷ orders placed" : "no orders yet this week"}</div>
      </div>
      <div class="kc">
        <div class="kc-lbl">Chats that became orders</div>
        <div class="kc-val b">${chatToOrder != null ? chatToOrder.toFixed(0) + "%" : dash}</div>
        <div class="kc-sub">${chatToOrder != null ? "orders ÷ conversations, 7 days" : "needs conversations"}</div>
      </div>
      <div class="kc">
        <div class="kc-lbl">Delivery rate</div>
        <div class="kc-val ${rateClr}">${rate}%</div>
        <div class="kc-sub">${deliv} delivered · ${returned} returned</div>
      </div>
    </div>

    ${canAds ? bvOverviewBalances(bals) : ""}

    ${canAds ? `<div class="panel">
      <div class="ph">
        <div class="ph-title">Last 7-day performance</div>
        <div class="ph-count">Live from Meta · ${dayList.length} days with spend</div>
      </div>
      ${!live.ok ? "" : !dayList.length
        ? `<div class="empty"><div class="empty-ico">📈</div>No ad spend in the last 7 days.</div>`
        : `<div class="tbl-wrap"><table>
            <tr><th>Date</th><th>Spent</th><th>Conversations</th><th>Cost / conversation</th>${hasPurchases ? "<th>Purchases</th>" : ""}${hasWeb ? "<th>Landing page views</th><th>Cost / page view</th>" : ""}<th>Link clicks</th><th>Link CTR</th><th>Impressions</th></tr>
            ${dayList.map(m => `<tr>
                <td class="s">${m.date}</td>
                <td>${fN(m.spend)}</td>
                <td class="s">${m.conversations}</td>
                <td class="s">${m.conversations > 0 ? fN(m.spend / m.conversations) : dash}</td>
                ${hasPurchases ? `<td>${m.purchases}</td>` : ""}
                ${hasWeb ? `<td>${m.lpv ? m.lpv.toLocaleString("en-NG") : dash}</td><td>${m.lpv > 0 && m.webSpend > 0 ? fN(m.webSpend / m.lpv) : dash}</td>` : ""}
                <td>${m.clicks.toLocaleString("en-NG")}</td>
                <td>${m.impressions > 0 ? (m.clicks / m.impressions * 100).toFixed(2) + "%" : dash}</td>
                <td>${m.impressions.toLocaleString("en-NG")}</td>
              </tr>`).join("")}
            <tr style="font-weight:700;background:var(--panel2);"><td>Total</td><td>${fN(week.spend)}</td><td>${week.conversations}</td><td>${fN(week.costPerConv)}</td>${hasPurchases ? `<td>${week.purchases}</td>` : ""}${hasWeb ? `<td>${week.lpv.toLocaleString("en-NG")}</td><td>${week.costPerLpv != null ? fN(week.costPerLpv) : dash}</td>` : ""}<td>${week.clicks.toLocaleString("en-NG")}</td><td>${week.linkCtr != null ? week.linkCtr.toFixed(2) + "%" : dash}</td><td>${week.impressions.toLocaleString("en-NG")}</td></tr>
          </table></div>`}
    </div>` : ""}
    <div id="actionResult"></div>`;
}