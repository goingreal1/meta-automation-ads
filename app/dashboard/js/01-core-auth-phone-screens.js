// Revora dashboard, part 01 of 23: CONFIG & SUPABASE · ICONS (inline SVG, replaces emoji) · AUTH & INITIALIZATION · BOTTOM TAB BAR (phones) · PHONE APP SCREENS: More hub + top app bar · Phone order screen: tap an order card to see it on one screen with big Call / WhatsApp / status buttons
// ── CONFIG & SUPABASE ─────────────────────────────────────────────────────────
const SUPA_URL = "https://oicqtpjjwmgsiluvkmpu.supabase.co";
const ANON     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY3F0cGpqd21nc2lsdXZrbXB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5NDQyOTUsImV4cCI6MjExMDUyMDI5NX0.2Psx3_IHVSTL0wY0G6Y8M7IjNCtQi2RDKM0GG4WtMto";
const supabaseClient = window.supabase.createClient(SUPA_URL, ANON);

// ── ICONS (inline SVG, replaces emoji) ──────────────────────────────────────
const ICON_PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  phone: '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z"/>',
  mic: '<path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  clip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>',
  form: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  link: '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>',
  upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
  msg: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/> y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
};
function icon(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ""}</svg>`;
}

let sessionData = null;
let activeAccountId = null; // Currently selected UUID from ad_accounts
let ordersPage = 0; // 0-indexed page for the Orders tab's "All orders" table
const ORDERS_PAGE_SIZE = 30;
let accountsList = [];

// Thresholds
const CTR_KILL   = 0.7;
const CTR_WATCH  = 1.2;
const CTR_WIN    = 1.5;
const CPA_WATCH  = 1500;
const CPA_KILL   = 2500;
const MIN_HRS    = 10;

// ── AUTH & INITIALIZATION ─────────────────────────────────────────────────────
async function init() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (error || !session) {
    window.location.href = "login.html"; // Not logged in
    return;
  }
  sessionData = session;

  // The emailed code is enforced by the database sign-in gate. Here, only the authenticator step is checked for people who set one up.
  try {
    const aal = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.data && aal.data.nextLevel === "aal2" && aal.data.currentLevel !== "aal2") { window.location.href = "/login"; return; }
  } catch (_) { /* never block on an error here */ }

  // Multi-tenancy (Phase 1): every signed-in user must belong to a company.
  // A brand-new signup lands here before ever visiting setup-company.html
  // (e.g. they bookmarked this page) -- send them there instead of showing
  // a dashboard with nothing in it because every RLS policy denies them.
  const { data: profile } = await supabaseClient.from("profiles").select("company_id, role, display_name, media_buyer_id, delivery_agent_id, whatsapp_number, email_reports, login_alerts, email_prefs").eq("id", session.user.id).maybeSingle();
  if (!profile?.company_id) {
    window.location.href = "setup-company.html";
    return;
  }
  window.myProfile = profile;
  // Riders and customer care have their own simple apps: no ad accounts, campaigns or settings in their way.
  if (profile.role === "delivery_agent") { window.location.replace("rider.html"); return; }
  if (profile.role === "customer_care") { window.location.replace("care.html"); return; }
  renderChatForRole(profile.role);
  if (window.rvnInit) rvnInit(); // notifications: bell, inbox, live alerts (rv/notifications.js)

  // The header used to hardcode one tenant's own company name ("Quality
  // Herb") for literally every company that ever signed up -- every other
  // business saw someone else's name in their own dashboard. Pull the
  // logged-in user's real company name instead; "Revora" (the platform
  // itself, not any one tenant) stays as the fallback if it's missing.
  const { data: companyRow } = await supabaseClient.from("companies").select("name").eq("id", profile.company_id).maybeSingle();
  const hdrBrand = document.getElementById("hdrBrand");
  if (hdrBrand && companyRow?.name) {
    hdrBrand.textContent = companyRow.name;
    document.title = `${companyRow.name} · Revora`;
  }

  // The header otherwise only ever showed the company name -- an invited
  // buyer/admin/customer_care had no visual confirmation anywhere that
  // they're signed in as themselves, not some shared company login.
  const roleLabel = ({ owner: "Owner", admin: "Admin", buyer: "Media Buyer", customer_care: "Customer Care", delivery_agent: "Delivery Agent" })[profile.role] || profile.role;
  const hdrUserHtml = `<div style="font-weight:600;color:var(--text);">${escH(profile.display_name || session.user.email || "")}</div><div>${escH(roleLabel)}</div>`;
  const hdrUser = document.getElementById("hdrUser");
  if (hdrUser) { hdrUser.innerHTML = hdrUserHtml; hdrUser.style.display = "block"; }
  const hdrUserMobile = document.getElementById("hdrUserMobile");
  if (hdrUserMobile) hdrUserMobile.innerHTML = hdrUserHtml;

  // Every tab used to render for every role -- fine for owner/admin/buyer,
  // but customer_care and delivery_agent got a sidebar full of links to
  // ad-spend/campaign/wallet tooling that's not their job and (for most of
  // it) RLS leaves empty anyway. Hide what's not theirs instead of leaving
  // them to discover that the hard way.
  const HIDDEN_TABS_BY_ROLE = {
    delivery_agent: ["calllogs", "support", "forms", "campaigns", "performance", "leaderboard", "vault", "wallet", "journeys", "bookings", "housing", "products", "catalog", "shop", "conversations", "websites", "website-leads", "approvals", "earnings"],
    customer_care: ["forms", "campaigns", "performance", "leaderboard", "vault", "wallet", "journeys", "bookings", "products", "catalog", "shop", "websites", "approvals", "earnings"],
  };
  if (!["owner", "admin"].includes(profile.role)) document.querySelector('[data-tab="caredesk"]')?.style.setProperty("display", "none");
  for (const tab of HIDDEN_TABS_BY_ROLE[profile.role] || []) {
    document.querySelector(`[data-tab="${tab}"]`)?.style.setProperty("display", "none");
  }
  // The business profile chosen at onboarding decides which parts of the app a person sees.
  window.myCompany = (await supabaseClient.from("companies")
    .select("id,name,account_type,business_types,sales_channels,fulfilment,description,team_size,buyers_count,monthly_ad_spend,copy_language,goals,team_roles,onboarding_completed_at")
    .limit(1).maybeSingle().then(r => r.data).catch(() => null)) || null;
  bvApplyCompanyProfile();
  bvHqProbe();
  bvBuildBottomNav();
  bvLoadBilling();
  bvTopUpReturn();

  // meta-oauth-callback redirects the browser back here (per DASHBOARD_URL)
  // with ?meta_oauth=connected|error&detail=... once a buyer finishes
  // connecting their Facebook Business Manager -- land on Settings with the
  // outcome instead of silently dropping it, then scrub the URL so a refresh
  // doesn't re-show the same message.
  const oauthResult = new URLSearchParams(window.location.search).get("meta_oauth");
  if (oauthResult) {
    const detail = new URLSearchParams(window.location.search).get("detail") || "";
    activeTab = "settings";
    window.oauthToast = { ok: oauthResult === "connected", detail };
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === "settings"));
    history.replaceState(null, "", window.location.pathname);
  }

  // Set up Logout listener (desktop button + its mobile-menu duplicate)
  const doLogout = async () => { await supabaseClient.auth.signOut(); window.location.href = "login.html"; };
  document.getElementById("logoutBtn").addEventListener("click", doLogout);
  document.getElementById("logoutBtnMobile").addEventListener("click", doLogout);

  // Load user's ad accounts
  await loadAccounts();
  loadApprovalCount();
  loadCallFlagCount();
  bvApplyOpenParam(); // ?open=conv:<id> / tab:<name> (from a notification or app shortcut)
  render();
  bvPushSync();
  bvRenderAppBanner();

  loadChatUnread();
  setInterval(loadChatUnread, 30000);
  setInterval(loadAccounts, 60000);
  setInterval(loadApprovalCount, 30000);
  setInterval(loadCallFlagCount, 30000);

  // sessionData was only ever captured once here at page load -- after the
  // token's normal ~1hr expiry, every request across the whole dashboard was
  // silently sending a dead Bearer token and failing, making every tab look
  // empty with no visible error. Refresh it periodically so a long-open tab
  // (this app has no "session expired" prompt) keeps working.
  setInterval(async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) sessionData = session;
  }, 5 * 60 * 1000);
}


// ── BOTTOM TAB BAR (phones) ──────────────────────────────────────────────────
// Reuses the sidebar's own tab buttons (icons, click handler, role hiding), so
// the bar can never drift from the real navigation. "More" opens the sidebar,
// which on phones is styled as a bottom sheet (see the CSS block).
const BN_ITEMS = [
  { tab: "overview", label: "Home" },
  { tab: "conversations", label: "Chats" },
  { tab: "orders", label: "Orders" },
  { tab: "campaigns", label: "Campaigns" },
];
const BN_MORE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';


// ── PHONE APP SCREENS: More hub + top app bar ───────────────────────────────
// Every section reachable from the sidebar gets its own screen, opened from a
// plain list on the More tab, with a back arrow in a top bar (like a native app).
const MORE_META = {
  calllogs: ["#34c759", "Calls your AI answered"], support: ["#ff9500", "Chats waiting for a human"],
  riders: ["#5856d6", "Shipbubble deliveries and tracking"], caredesk: ["#af52de", "Your customer care team"],
  forms: ["#007aff", "Your order form links"], performance: ["#ff2d55", "What you spent and earned"],
  assistant: ["#af52de", "Ask your AI anything"], leaderboard: ["#ffcc00", "Best media buyers"],
  wallet: ["#34c759", "Balance, add funds, send money"], catalog: ["#ff9500", "Products, photos and prices"],
  websites: ["#007aff", "Your sales pages"], "website-leads": ["#5ac8fa", "People who filled your forms"],
  approvals: ["#30b0c7", "Money requests to approve"], earnings: ["#34c759", "Your commissions"],
  settings: ["#8e8e93", "Business, team, billing, domains, alerts, security, help"], hq: ["#1c1c1e", "Platform admin"],
};
const MORE_CHEV = '<svg class="more-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
function bvGoMore() {
  document.getElementById("bvBuilderOverlay")?.remove();
  activeTab = "more";
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  render();
  window.scrollTo(0, 0);
}
function renderMore(c) {
  const inBar = new Set(BN_ITEMS.map(i => i.tab));
  const badgeOf = (tab) => { const id = { approvals: "approvalBadge", support: "supportFlagBadge", calllogs: "callFlagBadge" }[tab]; const el = id && document.getElementById(id); return el && el.style.display !== "none" ? Number(el.textContent) || 0 : 0; };
  let html = "", open = false, pendingLbl = "";
  const close = () => { if (open) html += "</div>"; open = false; };
  document.querySelectorAll("#tabsBar > *").forEach(el => {
    if (el.classList.contains("sidebar-group-lbl")) { close(); pendingLbl = el.textContent.trim(); return; }
    if (!el.classList.contains("tab-btn") || el.style.display === "none" || inBar.has(el.dataset.tab) || el.dataset.tab === "overview") return;
    if (pendingLbl) { close(); html += `<div class="more-lbl">${escH(pendingLbl)}</div><div class="more-list">`; open = true; pendingLbl = ""; }
    const tab = el.dataset.tab || ("link:" + el.dataset.link), m = MORE_META[tab] || (el.dataset.link ? ["#7c3aed", "Daily team meeting, images and launches"] : ["#8e8e93", ""]), n = badgeOf(tab);
    html += `<button type="button" class="more-row" data-more="${tab}"><span class="more-ic" style="background:${m[0]}">${el.querySelector(".tab-ico")?.innerHTML || ""}</span>
      <span class="more-tx"><b>${escH(tab === "settings" ? "Team, billing & more" : el.querySelector(".tab-label")?.textContent.trim() || tab)}</b>${m[1] ? `<small>${escH(m[1])}</small>` : ""}</span>${n ? `<span class="more-badge">${n > 99 ? "99+" : n}</span>` : ""}${MORE_CHEV}</button>`;
  });
  close();
  const p = window.myProfile || {}, name = p.display_name || sessionData?.user?.email || "You";
  const role = ({ owner: "Owner", admin: "Admin", buyer: "Media Buyer", customer_care: "Customer Care", delivery_agent: "Delivery Agent" })[p.role] || p.role || "";
  const co = document.getElementById("hdrBrand")?.textContent || "";
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const acct = accountsList.find(a => a.id === activeAccountId);
  const canAds = ["owner", "admin", "buyer"].includes(p.role);
  const needSetup = (accountsList || []).filter(a => !a.meta_pixel_id || !a.fb_page_id).length;
  const adsRow = (k, color, d, title, sub, n) => `<button type="button" class="more-row" data-more="adx:${k}"><span class="more-ic" style="background:${color}">${ic(d)}</span><span class="more-tx"><b>${title}</b><small>${sub}</small></span>${n ? `<span class="more-badge">${n}</span>` : ""}${MORE_CHEV}</button>`;
  const adsGroup = canAds ? `<div class="more-lbl">Ads setup</div><div class="more-list">
      ${adsRow("list", "#1877f2", '<path d="M3 11v2a1 1 0 001 1h1l5 4V6l-5 4H4a1 1 0 00-1 1z"/><path d="M15.5 8.5a4 4 0 010 7"/>', "Ad accounts", "Buy one, link your own, see what each still needs", needSetup)}
      ${adsRow("pages", "#34c759", '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>', "Facebook Pages", "Which Page each ad account runs ads as", 0)}
      ${adsRow("datasets", "#8e8e93", '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', "Datasets (pixels)", "So Meta can count orders from your ads", 0)}
    </div>` : "";
  c.innerHTML = `<div class="more-screen">
    <h1 class="more-h1">Settings</h1>
    <div class="more-me"><div class="more-av">${escH(String(name).trim().charAt(0).toUpperCase())}</div><div style="min-width:0"><b>${escH(name)}</b><span>${escH([role, co].filter(Boolean).join(" · "))}</span></div></div>
    ${adsGroup}
    ${html}
    <div class="more-lbl">App</div><div class="more-list">
      ${accountsList.length ? `<button type="button" class="more-row" data-more="__acct"><span class="more-ic" style="background:#1877f2">${ic('<path d="M3 11v2a1 1 0 001 1h1l5 4V6l-5 4H4a1 1 0 00-1 1z"/><path d="M15.5 8.5a4 4 0 010 7"/>')}</span><span class="more-tx"><b>Ad account</b><small>${escH(acct?.name || "Choose one")}</small></span>${MORE_CHEV}</button>` : ""}
      <button type="button" class="more-row" data-more="__theme"><span class="more-ic" style="background:#636366">${ic('<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>')}</span><span class="more-tx"><b>Appearance</b><small>${theme === "dark" ? "Dark" : "Light"} mode. Tap to switch</small></span></button>
      <button type="button" class="more-row danger" data-more="__logout"><span class="more-ic" style="background:#ff3b30">${ic('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>')}</span><span class="more-tx"><b>Log out</b></span></button>
    </div><div class="more-foot">Revora</div></div>`;
  c.querySelector(".more-screen").addEventListener("click", (e) => {
    const r = e.target.closest(".more-row"); if (!r) return;
    const k = r.dataset.more;
    if (k === "__theme") { setTheme(theme === "dark" ? "light" : "dark"); render(); return; }
    if (k === "__logout") { document.getElementById("logoutBtnMobile").click(); return; }
    if (k.startsWith("adx:")) { bvAdxOpen(k.slice(4)); return; }
    if (k.startsWith("link:")) { location.href = k.slice(5); return; }
    if (k === "__acct") { document.getElementById("hdrMenuBtn").click(); window.scrollTo(0, 0); return; }
    document.querySelector(`#tabsBar [data-tab="${k}"]`)?.click();
    window.scrollTo(0, 0);
  });
}
function bvUpdateAppBar() {
  const inBar = BN_ITEMS.some(i => i.tab === activeTab);
  const sub = mobileMq.matches && activeTab !== "more" && !inBar && activeTab !== "overview";
  document.body.classList.toggle("m-sub", sub);
  document.body.classList.toggle("m-more", mobileMq.matches && activeTab === "more");
  if (!sub) return;
  const prodOpen = activeTab === "catalog" && !!window.bvCat?.pid;
  document.body.classList.toggle("m-detail", prodOpen);
  const detail = activeTab === "settings" && bvSetOpen && !bvLimitedRole();
  const tabLbl = document.querySelector(`#tabsBar [data-tab="${activeTab}"] .tab-label`)?.textContent.trim() || "";
  const prodName = prodOpen ? (window.bvCatData?.prods?.find(x => x.id === window.bvCat.pid)?.product_name || "Product") : "";
  document.getElementById("mTitle").textContent = activeTab === "adx" ? BV_ADX_TITLES[bvAdx.screen] : prodOpen ? prodName : detail
    ? (document.querySelector(`#setNav .set-nav-btn[data-sec="${bvSettingsSec}"]`)?.lastChild?.textContent.trim() || "Settings") : tabLbl;
  document.getElementById("mBackLbl").textContent = prodOpen ? "Catalog" : detail ? "More settings" : activeTab === "adx" ? (bvAdx.stack.length ? BV_ADX_BACK[bvAdx.stack[bvAdx.stack.length - 1].screen] : "Settings") : "Settings";
}
document.getElementById("mBack").addEventListener("click", () => {
  if (activeTab === "adx") { bvAdxBack(); return; }
  if (activeTab === "catalog" && window.bvCat?.pid) { window.bvCat.pid = null; render(); window.scrollTo(0, 0); return; }
  if (activeTab === "settings" && bvSetOpen && !bvLimitedRole()) {
    bvSetOpen = false; const w = document.querySelector(".set-wrap[data-m]"); if (w) w.dataset.m = "list"; bvUpdateAppBar(); window.scrollTo(0, 0);
  } else bvGoMore();
});

// Phones: turn wide tables (4+ columns) into cards by labelling every cell with its column heading.
function bvCardifyTables() {
  if (!mobileMq.matches) return;
  document.querySelectorAll("#mainContent table:not(.m-card):not(.no-card)").forEach(t => {
    const heads = [...t.querySelectorAll("tr:first-child th, thead th")].map(h => h.textContent.trim());
    if (heads.length < 4) return;
    t.classList.add("m-card");
    t.querySelectorAll("tr").forEach(tr => [...tr.children].forEach((td, i) => { if (td.tagName === "TD" && td.dataset.label === undefined) td.dataset.label = heads[i] || ""; }));
  });
}
let bvCardQueued = false;
new MutationObserver(() => {
  if (bvCardQueued) return;
  bvCardQueued = true;
  requestAnimationFrame(() => { bvCardQueued = false; bvCardifyTables(); });
}).observe(document.getElementById("mainContent"), { childList: true, subtree: true });

// ── Phone order screen: tap an order card to see it on one screen with big Call / WhatsApp / status buttons ──
let bvOrderChanged = false;
function bvCloseOrderScreen() {
  document.getElementById("ordScreen")?.remove();
  document.body.style.overflow = "";
  if (bvOrderChanged) { bvOrderChanged = false; render(); }
}
function bvOpenOrderScreen(id) {
  const o = (window.bvOrdersCache || []).find(x => x.id === id);
  if (!o) return;
  let scr = document.getElementById("ordScreen");
  if (!scr) { scr = document.createElement("div"); scr.id = "ordScreen"; scr.className = "ord-screen"; document.body.appendChild(scr); document.body.style.overflow = "hidden"; }
  const phone = (o.customer_phone || "").replace(/\D/g, "");
  const opts = [...new DOMParser().parseFromString(bvOrderStatusSelect(o), "text/html").querySelectorAll("option")]
    .map(x => ({ v: x.value, l: x.textContent.trim(), ok: !x.disabled }));
  const locked = /disabled/.test(bvOrderStatusSelect(o).split(">")[0]);
  const cur = o.order_status || "pending";
  const row = (k, v) => v ? `<div class="ord-row"><span>${k}</span><span>${v}</span></div>` : "";
  const place = [o.customer_address, o.customer_city, o.customer_state].filter(Boolean).map(escH).join(", ");
  const extra = o.form_data && typeof o.form_data === "object" ? Object.entries(o.form_data).filter(([, v]) => v).map(([k, v]) => row(escH(k.replace(/_/g, " ")), escH(String(v)))).join("") : "";
  scr.innerHTML = `<div class="ord-bar"><button type="button" class="m-back" id="ordBack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg><span>Orders</span></button></div>
    <div class="ord-body">
      <div class="ord-hero"><h2>${escH(o.customer_name || "Customer")}</h2><span class="pill ${escH(cur)}">${escH(cur)}</span>${o.possible_duplicate ? ` <span class="pill returned">Possible duplicate</span>` : ""}
        <div class="ord-val">${fN(o.order_value_naira)}</div><div class="ord-sub">${escH(o.product_name || "")} · ordered ${ago(o.ordered_at)}</div></div>
      ${phone ? `<div class="ord-act"><a class="call" href="tel:${escH(o.customer_phone)}">${icon("phone", 18)} Call</a><a class="wa" href="https://wa.me/${phone}" target="_blank" rel="noopener">${icon("chat", 18)} WhatsApp</a></div>` : ""}
      <div class="ord-lbl">Status</div>
      <div class="ord-seg">${opts.map(x => `<button type="button" data-st="${escH(x.v)}" class="${x.v === cur ? "on" : ""}" ${x.ok && !locked ? "" : "disabled"}>${escH(x.l)}</button>`).join("")}</div>
      <div id="ordMsg"></div>
      <div class="ord-lbl">Details</div>
      <div class="ord-list">
        ${row("Phone", escH(o.customer_phone || ""))}${row("Delivery", place)}${row("Product", escH(o.product_name || ""))}${row("Value", fN(o.order_value_naira))}
        ${row("Buyer", escH(o.media_buyers?.name || o.media_buyers?.code || ""))}${row("Ordered", o.ordered_at ? new Date(o.ordered_at).toLocaleString() : "")}${extra}${row("Note", escH(o.care_note || ""))}
      </div>
      <div class="ord-lbl">Payment</div><div class="ord-list"><div class="ord-row"><span>Method</span><span>${bvPaymentCell(o)}</span></div></div>
      <div class="ord-lbl">AI confirmation call</div><div class="ord-list"><div class="ord-row"><span>Status</span><span>${bvOrderCallCell(o)}</span></div></div>
    </div>`;
  scr.querySelector("#ordBack").onclick = bvCloseOrderScreen;
  scr.querySelectorAll(".ord-seg button").forEach(b => b.onclick = async () => {
    const ns = b.dataset.st; if (ns === cur) return;
    scr.querySelectorAll(".ord-seg button").forEach(x => x.disabled = true);
    try {
      const body = { order_status: ns };
      if (ns === "delivered") body.delivered_at = new Date().toISOString();
      const { error } = await supabaseClient.from("orders").update(body).eq("id", o.id);
      if (error) throw error;
      o.order_status = ns; bvOrderChanged = true; bvToast("Order marked " + ns); bvOpenOrderScreen(id);
    } catch (err) { scr.querySelector("#ordMsg").innerHTML = `<div class="msg err" style="display:block;margin-top:10px;">Update failed: ${escH(err.message)}</div>`; bvOpenOrderScreen(id); }
  });
  scr.querySelectorAll(".callNowBtn").forEach(btn => btn.onclick = async () => {
    btn.disabled = true; btn.textContent = "Calling…";
    try { const r = await sbFn("place-order-call", { order_id: o.id, force: true }); if (r.error) throw new Error(r.error); bvOrderChanged = true; bvToast("Calling the customer…"); }
    catch (err) { btn.disabled = false; btn.textContent = "📞 Call now"; scr.querySelector("#ordMsg").innerHTML = `<div class="msg err" style="display:block;margin-top:10px;">Could not place call: ${escH(err.message)}</div>`; }
  });
}
document.addEventListener("click", (e) => {
  if (!mobileMq.matches) return;
  const tr = e.target.closest("tr[data-order-row]");
  if (!tr || e.target.closest("a,button,select,input,label")) return;
  bvOpenOrderScreen(tr.dataset.orderRow);
});

// ── PHONE CAMPAIGN CREATOR: one clear question per screen ───────────────────
// The same form (and the same launch code) runs underneath; on phones each group of fields is tagged
// with the screen it belongs to (data-ms) and only the current screen is shown.
const BV_MS = [
  ["dest", "Where should people go?", "Pick what happens when someone taps your ad."],
  ["name", "Name your campaign", "Only you see this. Pick the product it sells, if any."],
  ["who", "Who should see it?", "Where they live, their age and gender."],
  ["budget", "How much do you want to spend?", "A daily amount. You can change or pause it any time."],
  ["media", "Add your photo or video", "This is what people see in their feed."],
  ["copy", "Write your ad", "A few short lines. Say what you sell and why they should tap."],
  ["adv", "More options", "Optional. The defaults work well, so you can skip this."],
  ["review", "Check and launch", "Check everything, then tap Launch. Your ad goes live right away, or tick the draft option to keep it paused."],
];
const BV_MS_FROM_WZ = { goal: "dest", product: "name", audience: "who", creative: "media", budget: "budget", review: "review" };
const BV_MS_TAB = { dest: "campaign", name: "campaign", who: "adset", budget: "adset", media: "ad", copy: "ad", adv: "ad", review: "ad" };
// Which places each goal can send people (chat/lead-form ads cannot be Traffic or Awareness).
const BV_MS_DEST_BY_GOAL = {
  OUTCOME_SALES: ["whatsapp", "website", "messenger", "instagram"],
  OUTCOME_LEADS: ["form", "messenger", "instagram", "website"],
  OUTCOME_ENGAGEMENT: ["website", "messenger", "instagram"],
  OUTCOME_TRAFFIC: ["website"],
  OUTCOME_AWARENESS: ["website"],
};
const BV_MS_DEST_COPY = {
  whatsapp: ["chat", "WhatsApp chat", "Customers message you on WhatsApp. Best for orders in Nigeria."],
  website: ["globe", "Your website", "People tap through to a page you choose."],
  messenger: ["msg", "Messenger chat", "Customers message your Facebook Page."],
  instagram: ["camera", "Instagram message", "Customers send you an Instagram DM."],
  form: ["form", "Instant form", "People fill in a form without leaving Facebook or Instagram."],
};
function bvMsStep(delta) {
  const ov = document.getElementById("bvBuilderOverlay"); if (!ov) return;
  const i = BV_MS.findIndex(x => x[0] === (ov.dataset.mscur || "dest"));
  if (delta > 0) { const err = bvMsCheck(BV_MS[i][0]); if (err) { bvMsErr(err); return; } }
  bvMsErr("");
  const n = Math.max(0, Math.min(BV_MS.length - 1, i + delta));
  bvMsGo(BV_MS[n][0]);
}
function bvMsErr(t) {
  const m = document.getElementById("uploadMsg"); if (!m) return;
  m.innerHTML = t ? `<div class="msg err" style="display:block;">${escH(t)}</div>` : "";
}
function bvMsCheck(step) {
  const v = id => (document.getElementById(id)?.value || "").trim();
  const dest = document.querySelector('input[name="f_destination"]:checked')?.value;
  if (step === "dest") {
    if (dest === "whatsapp" && !v("f_whatsapp_number")) return "Enter the WhatsApp number customers should message.";
    if (dest === "website" && !v("f_landing_url")) return "Enter the website link people should land on.";
  }
  if (step === "name" && !v("f_campaign_name")) return "Give your campaign a name.";
  if (step === "media" && !document.getElementById("f_file")?.files?.[0] && !bvReuseAsset && !bvStagedCopies.length) return "Add a photo or video, or reuse one you already uploaded.";
  if (step === "copy" && !v("f_primary") && !bvStagedCopies.length) return "Write the main text of your ad.";
  return "";
}
function bvMsGo(id) {
  const ov = document.getElementById("bvBuilderOverlay"); if (!ov) return;
  const i = Math.max(0, BV_MS.findIndex(x => x[0] === id)), st = BV_MS[i];
  ov.dataset.mscur = st[0];
  bvSwitchBuilderTab(BV_MS_TAB[st[0]]);
  if (st[0] === "dest") bvMsDestCards();
  document.getElementById("msTitle").textContent = st[1];
  document.getElementById("msHint").textContent = st[2];
  document.getElementById("msStep").textContent = `Step ${i + 1} of ${BV_MS.length}`;
  document.getElementById("msBarFill").style.width = ((i + 1) / BV_MS.length * 100) + "%";
  const next = document.getElementById("bvTabNextBtn");
  if (next) next.textContent = st[0] === "adv" ? (bvMsAdvTouched() ? "Next" : "Skip") : st[0] === "copy" ? "Next" : "Next";
  document.getElementById("uploadForm")?.scrollTo(0, 0);
  bvMsErr("");
}
const bvMsAdvTouched = () => false;
// Show only the places this goal can send people, as big tap cards with a one-line explanation.
function bvMsDestCards() {
  const goal = document.getElementById("f_objective")?.value || "OUTCOME_SALES";
  const allowed = BV_MS_DEST_BY_GOAL[goal] || BV_MS_DEST_BY_GOAL.OUTCOME_SALES;
  const radios = [...document.querySelectorAll('input[name="f_destination"]')];
  radios.forEach(r => {
    const lab = r.closest("label"); if (!lab) return;
    lab.hidden = !allowed.includes(r.value);
    const c = BV_MS_DEST_COPY[r.value];
    if (c && !lab.dataset.msDone) { lab.dataset.msDone = "1"; lab.classList.add("ms-opt"); lab.innerHTML = ""; lab.appendChild(r); lab.insertAdjacentHTML("beforeend", `<span class="ms-opt-ic">${icon(c[0], 22)}</span><span class="ms-opt-tx"><b>${c[1]}</b><small>${c[2]}</small></span>`); }
  });
  const cur = radios.find(r => r.checked);
  const ov = document.getElementById("bvBuilderOverlay");
  // First visit: start on the best match for this goal; later visits keep the person's pick.
  if (!ov?.dataset.msInit || !cur || cur.closest("label").hidden) {
    if (ov) ov.dataset.msInit = "1";
    const first = allowed.map(v => radios.find(r => r.value === v)).find(r => r && !r.closest("label").hidden);
    if (first && first !== cur) first.click();
  }
  bvOnDestinationChange();
}

// ── PHONE AD SETUP: ad accounts, Pages and datasets, each on its own screen ─────────────────────
// Reached from Settings > Ads setup. List -> one ad account -> its dataset / Page screens. The same backend
// calls as the desktop Settings are used (events-manager, link-page, ad-account-pool, sync-partner-accounts).
const BV_ADX_TITLES = { list: "Ad accounts", acct: "Ad account", buy: "Buy account", link: "Link account", pages: "Pages", page: "Link a Page", datasets: "Datasets", dataset: "Dataset" };
const BV_ADX_BACK = { list: "Accounts", acct: "Account", buy: "Buy", link: "Link", pages: "Pages", page: "Page", datasets: "Datasets", dataset: "Dataset" };
let bvAdx = { screen: "list", id: null, stack: [] };
function bvAdxOpen(screen, id) {
  document.getElementById("bvBuilderOverlay")?.remove();
  bvAdx = { screen: screen || "list", id: id || null, stack: [] };
  activeTab = "adx";
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  render(); window.scrollTo(0, 0);
}
function bvAdxGo(screen, id) {
  bvAdx.stack.push({ screen: bvAdx.screen, id: bvAdx.id });
  bvAdx.screen = screen; bvAdx.id = id || null;
  render(); window.scrollTo(0, 0);
}
function bvAdxBack() {
  const prev = bvAdx.stack.pop();
  if (!prev) { bvGoMore(); return; }
  bvAdx.screen = prev.screen; bvAdx.id = prev.id;
  render(); window.scrollTo(0, 0);
}
// Plain-words version of what Meta said, with the raw text tucked underneath.
function bvAdxErr(raw, retryHint) {
  const t = String(raw || "Something went wrong.");
  const perm = /ads_management|advertiser role|permission|not allowed|OAuth|token/i.test(t);
  return `<div class="adx-err"><b>${perm ? "Meta didn't allow that" : "That didn't work"}</b>
    <p>${perm ? "Your Meta connection isn't allowed to do this on this ad account. Reconnect Meta with full access, or ask the person who owns the ad account to give you the Advertiser role." : escH(t)}</p>
    ${retryHint ? `<p>${escH(retryHint)}</p>` : ""}
    ${perm ? `<details><summary>What Meta said</summary><small>${escH(t)}</small></details><button type="button" class="adx-btn ghost" onclick="bvAdxGo('link')">Reconnect or link with Facebook</button>` : ""}</div>`;
}
const adxAcct = id => (accountsList || []).find(a => a.id === id);
const adxName = a => a?.nickname || a?.name || "Ad account";
function adxChip(ok, yes, no) { return `<span class="adx-chip ${ok ? "ok" : "todo"}">${ok ? "✓" : "!"} ${escH(ok ? yes : no)}</span>`; }
const ADX_CHEV = '<svg class="adx-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

async function renderAdx(c) {
  const sc = bvAdx.screen;
  if (!["owner", "admin", "buyer"].includes(window.myProfile?.role)) { c.innerHTML = `<div class="empty">Ad setup is for owners, admins and media buyers.</div>`; return; }
  c.innerHTML = `<div class="adx" id="adxRoot"></div>`;
  const root = c.querySelector("#adxRoot");
  if (["list", "pages", "datasets", "acct", "page", "dataset"].includes(sc) && !bvAdx.fresh) { try { await loadAccounts(); } catch {} bvAdx.fresh = true; }
  if (sc === "list") return adxList(root);
  if (sc === "acct") return adxAccount(root);
  if (sc === "buy") return adxBuy(root);
  if (sc === "link") return adxLink(root);
  if (sc === "pages") return adxPages(root);
  if (sc === "page") return adxPage(root);
  if (sc === "datasets") return adxDatasets(root);
  if (sc === "dataset") return adxDataset(root);
}
function adxCard(a, target) {
  const ok = a.status === "active";
  return `<button type="button" class="adx-card" onclick="bvAdxGo('${target}','${a.id}')">
    <div class="adx-card-top"><b>${escH(adxName(a))}</b><span class="pill ${ok ? "active" : "paused"}">${ok ? "Active" : escH(a.status || "—")}</span></div>
    <div class="adx-sub">${escH(a.meta_ad_account_id || "")} · Balance ${fN(a.balance_naira)}</div>
    <div class="adx-chips">${adxChip(!!a.meta_pixel_id, "Dataset: " + (a.pixel_name || "linked"), "Needs a dataset")}${adxChip(!!a.fb_page_id, "Page: " + (a.fb_page_name || "linked"), "Needs a Page")}</div>${ADX_CHEV}</button>`;
}
function adxList(root) {
  const all = accountsList || [];
  const bought = all.filter(a => a.billing_mode === "managed"), own = all.filter(a => a.billing_mode !== "managed");
  const need = all.filter(a => !a.meta_pixel_id || !a.fb_page_id).length;
  root.innerHTML = `
    <div class="adx-actions">
      <button type="button" class="adx-tile" onclick="bvAdxGo('buy')"><span class="adx-tile-ic" style="background:#34c759">＋</span><b>Buy an ad account</b><small>Ready to use. Paid from your wallet.</small></button>
      <button type="button" class="adx-tile" onclick="bvAdxGo('link')"><span class="adx-tile-ic" style="background:#1877f2">🔗</span><b>Link my own</b><small>Bring an ad account you already have.</small></button>
    </div>
    ${need ? `<div class="adx-note">${need} ad account${need === 1 ? "" : "s"} still need${need === 1 ? "s" : ""} a dataset or a Page before you can launch ads. Tap one to finish.</div>` : ""}
    <div class="adx-h">Bought from Revora <span>${bought.length}</span></div>
    ${bought.length ? bought.map(a => adxCard(a, "acct")).join("") : `<div class="adx-empty">You haven't bought an ad account yet.<button type="button" class="adx-btn" onclick="bvAdxGo('buy')">Buy an ad account</button></div>`}
    <div class="adx-h">Your own accounts <span>${own.length}</span></div>
    ${own.length ? own.map(a => adxCard(a, "acct")).join("") : `<div class="adx-empty">No linked accounts yet.<button type="button" class="adx-btn" onclick="bvAdxGo('link')">Link my own</button></div>`}`;
}
async function adxAccount(root) {
  const a = adxAcct(bvAdx.id); if (!a) { bvAdxBack(); return; }
  const isAdmin = bvIsAdminRole();
  const buyers = isAdmin ? await sbQuery("media_buyers", "select=id,name,active&order=code.asc").catch(() => []) : [];
  root.innerHTML = `
    <div class="adx-hero"><div class="adx-card-top"><h2>${escH(adxName(a))}</h2><span class="pill ${a.status === "active" ? "active" : "paused"}">${a.status === "active" ? "Active" : escH(a.status || "—")}</span></div>
      <div class="adx-sub">${escH(a.meta_ad_account_id || "")}</div>
      <div class="adx-kv"><div><b>${fN(a.balance_naira)}</b><span>Balance</span></div><div><b>${a.billing_mode === "managed" ? "Revora" : "Your own"}</b><span>Account type</span></div></div></div>
    <div class="adx-h">Finish setting up</div>
    <button type="button" class="adx-step" onclick="bvAdxGo('dataset','${a.id}')"><span class="adx-num ${a.meta_pixel_id ? "done" : ""}">${a.meta_pixel_id ? "✓" : "1"}</span>
      <span class="adx-step-tx"><b>Dataset (pixel)</b><small>${a.meta_pixel_id ? escH(a.pixel_name || a.meta_pixel_id) : "Needed so Meta can count your orders. Tap to create one."}</small></span>${ADX_CHEV}</button>
    <button type="button" class="adx-step" onclick="bvAdxGo('page','${a.id}')"><span class="adx-num ${a.fb_page_id ? "done" : ""}">${a.fb_page_id ? "✓" : "2"}</span>
      <span class="adx-step-tx"><b>Facebook Page</b><small>${a.fb_page_id ? escH(a.fb_page_name || a.fb_page_id) + (a.whatsapp_number ? " · " + escH(a.whatsapp_number) : "") : "Your ads run as this Page. Tap to link one."}</small></span>${ADX_CHEV}</button>
    ${isAdmin ? `<div class="adx-h">Who runs it</div><div class="adx-panel"><label class="adx-lbl">Media buyer</label>
      <select class="acctShare" data-id="${a.id}" onchange="bvShareAccount(this)"><option value="">Nobody (company)</option>${(buyers || []).filter(b => b.active !== false).map(b => `<option value="${b.id}" ${b.id === a.media_buyer_id ? "selected" : ""}>${escH(b.name)}</option>`).join("")}</select>
      <p class="adx-help">${a.billing_mode === "managed" ? "A Revora ad account is paid from the wallet of the buyer it is shared with." : "The media buyer who runs this account."}</p></div>` : ""}`;
}
async function adxBuy(root) {
  root.innerHTML = `<div class="empty"><div class="spin" style="width:18px;height:18px;border-width:2px;"></div></div>`;
  const av = await sbFn("ad-account-pool", { action: "availability" }).catch(() => ({ error: "Could not reach Revora. Try again." }));
  const fee = Number(av.fee || 0), wallet = Math.max(0, Math.round(av.wallet || 0)), short = wallet < fee;
  root.innerHTML = `
    <div class="adx-intro"><b>A ready Meta ad account</b><p>Revora gives you an ad account that is already approved to run ads. The price comes out of your wallet.</p></div>
    ${av.error ? bvAdxErr(av.error) : !av.available ? `<div class="adx-note">All Revora ad accounts are taken right now. Check back soon, or link one you already own.</div><button type="button" class="adx-btn" onclick="bvAdxGo('link')">Link my own instead</button>` : `
    <div class="adx-panel">
      <label class="adx-lbl" for="adxName">Name your ad account</label>
      <input id="adxName" placeholder="e.g. Quality Herb Main" autocomplete="off">
      <label class="adx-check"><input type="checkbox" id="adxPix" checked> Create its dataset (pixel) now</label>
      <div class="adx-price"><span>Price</span><b>${fN(fee)}</b></div>
      <div class="adx-price"><span>Your wallet</span><b class="${short ? "bad" : ""}">${fN(wallet)}</b></div>
      ${short ? `<div class="adx-note warn">Your wallet is short by ${fN(fee - wallet)}. Add funds in Wallet first.</div>` : ""}
      <div id="adxMsg"></div>
      <button type="button" class="adx-btn" id="adxGo" ${short ? "disabled" : ""}>Buy ad account · ${fN(fee)}</button>
    </div>`}`;
  root.querySelector("#adxGo")?.addEventListener("click", async e => {
    const btn = e.currentTarget, msg = root.querySelector("#adxMsg"), name = root.querySelector("#adxName").value.trim();
    if (name.length < 2) { msg.innerHTML = `<div class="adx-note warn">Give the ad account a name.</div>`; return; }
    btn.disabled = true; btn.textContent = "Setting it up…"; msg.innerHTML = "";
    const r = await sbFn("ad-account-pool", { action: "claim", name, create_pixel: root.querySelector("#adxPix").checked }).catch(err => ({ error: err.message }));
    if (r.error) { msg.innerHTML = bvAdxErr(r.error); btn.disabled = false; btn.textContent = `Buy ad account · ${fN(fee)}`; return; }
    bvToast("Ad account bought and ready"); if (r.pixel_note) bvToast(r.pixel_note);
    bvAdx.fresh = false; bvAdx.stack = []; bvAdx.screen = "list"; render();
  });
}
async function adxLink(root) {
  root.innerHTML = `<div class="empty"><div class="spin" style="width:18px;height:18px;border-width:2px;"></div></div>`;
  const isAdm = bvIsAdminRole();
  const [buyers, conns, bizRes] = await Promise.all([
    sbQuery("media_buyers", "select=id,name,code,meta_partner_business_id&order=code.asc").catch(() => []),
    sbQuery("meta_connections_public", "select=*&status=eq.active&order=connected_at.desc").catch(() => []),
    sbFn("sync-partner-accounts", { access_token: sessionData.access_token, mode: "get_business_id" }).catch(() => ({})),
  ]);
  const mineList = isAdm ? (buyers || []) : (buyers || []).filter(b => b.id === window.myProfile?.media_buyer_id);
  if (!mineList.length) { root.innerHTML = `<div class="adx-note">Add a media buyer first (More settings, then Business &amp; team), then come back to link an ad account.</div>`; return; }
  const sel = window.bvAdxBuyer && mineList.some(b => b.id === window.bvAdxBuyer) ? window.bvAdxBuyer : (mineList.find(b => b.id === window.myProfile?.media_buyer_id) || mineList[0]).id;
  window.bvAdxBuyer = sel;
  const buyer = mineList.find(b => b.id === sel), conn = (conns || []).find(x => x.media_buyer_id === sel), bizId = bizRes?.business_id || "";
  const have = new Set((accountsList || []).map(a => String(a.meta_ad_account_id || "").replace(/^act_/, "")));
  const avail = (conn?.discovered_ad_accounts || []).filter(a => !have.has(String(a.account_id)));
  root.innerHTML = `
    ${mineList.length > 1 ? `<div class="adx-panel"><label class="adx-lbl">Linking for</label><select id="adxBuyer">${mineList.map(b => `<option value="${b.id}" ${b.id === sel ? "selected" : ""}>${escH(b.name)} [${escH(b.code)}]</option>`).join("")}</select></div>` : ""}
    <div class="adx-intro"><b>Bring your ad account, Page and dataset together</b><p>Pick one way below. Either way you can share all three, so Revora can run ads, create your dataset and use your Page.</p></div>
    <div class="adx-opt"><div class="adx-opt-tag">Easiest</div><h3>Continue with Facebook</h3>
      <p>Log in with Facebook once and choose your ad account, Page and dataset. No ID to type.</p>
      <p class="adx-help">${conn ? `Connected as ${escH(conn.fb_user_name || "a Facebook user")}.` : "Not connected yet."}</p>
      <button type="button" class="adx-btn" onclick="bvFbStart('${sel}')">${conn ? "Reconnect Facebook" : "Continue with Facebook"}</button>
      ${avail.length ? `<div class="adx-h" style="margin-top:16px;">Found on your Facebook — tap to add</div>${avail.map(a => `<div class="adx-found"><div><b>${escH(a.name || a.account_id)}</b><small>${escH(a.account_id)}</small></div><button type="button" class="adx-btn small" onclick="bvAdxAddFound(this,'${conn.id}','${sel}','${escH(a.account_id)}','${escH(String(a.name || "").replace(/'/g, ""))}')">Add</button></div>`).join("")}` : ""}
    </div>
    <div class="adx-opt"><h3>Or share with a Business ID</h3><div id="bvBmHost"></div></div>
    ${(() => { const todo = (accountsList || []).filter(a => !a.meta_pixel_id || !a.fb_page_id); return todo.length ? `<div class="adx-h">Still to finish</div>${todo.map(a => `<button type="button" class="adx-step" onclick="bvAdxGo('acct','${a.id}')"><span class="adx-num">!</span><span class="adx-step-tx"><b>${escH(adxName(a))}</b><small>${[a.meta_pixel_id ? "" : "Needs a dataset", a.fb_page_id ? "" : "Needs a Page"].filter(Boolean).join(" · ")}</small></span>${ADX_CHEV}</button>`).join("")}` : ""; })()}
    <p class="adx-help" style="padding:0 4px;">To add an ad account by its ID instead, use the desktop version of Settings.</p>`;
  root.querySelector("#adxBuyer")?.addEventListener("change", e => { window.bvAdxBuyer = e.target.value; render(); });
  bvBmMount(root.querySelector("#bvBmHost"), { buyerId: sel });
}
async function bvAdxAddFound(btn, connId, buyerId, actId, name) {
  btn.disabled = true; btn.textContent = "Adding…";
  const { error } = await supabaseClient.from("ad_accounts").insert({
    user_id: sessionData.user.id, media_buyer_id: buyerId, name: name || actId, nickname: name || actId,
    meta_ad_account_id: actId, status: "active", meta_connection_id: connId, connected_via: "oauth",
  });
  if (error) { btn.disabled = false; btn.textContent = "Add"; bvToast("Could not add: " + error.message, "err"); return; }
  bvToast("Ad account added. Finish its setup below."); await loadAccounts(); bvAdx.fresh = false;
  const added = (accountsList || []).find(a => String(a.meta_ad_account_id || "").replace(/^act_/, "") === String(actId));
  bvAdx.stack = [{ screen: "list", id: null }]; bvAdx.screen = added ? "acct" : "list"; bvAdx.id = added?.id || null; render();
}
function adxPickList(root, intro, target, sub) {
  const all = accountsList || [];
  root.innerHTML = `<div class="adx-intro"><p>${intro}</p></div>` + (all.length ? all.map(a => `<button type="button" class="adx-step" onclick="bvAdxGo('${target}','${a.id}')"><span class="adx-num ${sub(a).ok ? "done" : ""}">${sub(a).ok ? "✓" : "!"}</span><span class="adx-step-tx"><b>${escH(adxName(a))}</b><small>${escH(sub(a).text)}</small></span>${ADX_CHEV}</button>`).join("")
    : `<div class="adx-empty">You have no ad accounts yet.<button type="button" class="adx-btn" onclick="bvAdxGo('buy')">Buy an ad account</button><button type="button" class="adx-btn ghost" onclick="bvAdxGo('link')">Link my own</button></div>`);
}
function adxPages(root) { adxPickList(root, "Your ads run as a Facebook Page. Each ad account needs one linked. Pick an ad account.", "page", a => a.fb_page_id ? { ok: true, text: a.fb_page_name || a.fb_page_id } : { ok: false, text: "No Page linked yet" }); }
function adxDatasets(root) { adxPickList(root, "A dataset (Meta calls it a pixel) lets Meta count the orders your ads bring. Pick an ad account.", "dataset", a => a.meta_pixel_id ? { ok: true, text: a.pixel_name || a.meta_pixel_id } : { ok: false, text: "No dataset yet" }); }
function adxPage(root) {
  const a = adxAcct(bvAdx.id); if (!a) { bvAdxBack(); return; }
  root.innerHTML = `
    <div class="adx-hero"><div class="adx-sub">Ad account</div><h2>${escH(adxName(a))}</h2>
      ${a.fb_page_id ? `<div class="adx-chips">${adxChip(true, "Linked: " + (a.fb_page_name || a.fb_page_id), "")}</div>${a.whatsapp_number ? `<div class="adx-sub">WhatsApp ${escH(a.whatsapp_number)}</div>` : ""}` : `<div class="adx-chips">${adxChip(false, "", "No Page linked yet")}</div>`}</div>
    <div class="adx-h">${a.fb_page_id ? "Change the Page" : "Link a Page"}</div>
    <ol class="adx-steps card">
      <li><b>Share the Page with Revora.</b> In Meta Business Settings, open Accounts, then Pages. Pick your Page and tap <i>Add partner</i>. Enter Revora's Business ID and turn on <i>Create ads</i>.
        <div class="adx-copy"><code id="adxBizId">loading…</code><button type="button" class="adx-btn small ghost" id="adxCopyBiz">Copy</button></div></li>
      <li><b>Paste the Page ID.</b> Find it on your Page under About, then Page transparency.
        <input id="adxPageId" inputmode="numeric" placeholder="e.g. 105123456789012" style="margin-top:8px;"></li>
    </ol>
    <div id="adxMsg"></div>
    <button type="button" class="adx-btn" id="adxGo">Check and link Page</button>`;
  sbFn("sync-partner-accounts", { access_token: sessionData.access_token, mode: "get_business_id" }).then(r => {
    const id = r?.business_id || "", el = root.querySelector("#adxBizId"); if (el) el.textContent = id || "ask Revora support";
    const cp = root.querySelector("#adxCopyBiz"); if (cp) cp.onclick = () => { if (id) { navigator.clipboard?.writeText(id); bvToast("Business ID copied"); } };
  }).catch(() => { const el = root.querySelector("#adxBizId"); if (el) el.textContent = "ask Revora support"; });
  root.querySelector("#adxGo").addEventListener("click", async e => {
    const b = e.currentTarget, m = root.querySelector("#adxMsg"), pid = root.querySelector("#adxPageId").value.trim();
    if (!pid) { m.innerHTML = `<div class="adx-note warn">Paste the Page ID first.</div>`; return; }
    b.disabled = true; b.textContent = "Checking…"; m.innerHTML = "";
    try {
      const r = await sbFn("link-page", { ad_account_id: a.id, page_id: pid });
      if (r.status === "linked") { bvToast(`Linked ${r.page_name || "Page"}`); await loadAccounts(); bvAdx.fresh = false; bvAdxBack(); return; }
      m.innerHTML = bvAdxErr(r.error || "Could not link that Page.", "Check that the Page was shared with Revora and the ID is right.");
    } catch (err) { m.innerHTML = bvAdxErr(err.message); }
    b.disabled = false; b.textContent = "Check and link Page";
  });
}
async function adxDataset(root) {
  const a = adxAcct(bvAdx.id); if (!a) { bvAdxBack(); return; }
  root.innerHTML = `<div class="adx-hero"><div class="adx-sub">Ad account</div><h2>${escH(adxName(a))}</h2>
      <div class="adx-chips">${a.meta_pixel_id ? adxChip(true, "Linked: " + (a.pixel_name || a.meta_pixel_id), "") : adxChip(false, "", "No dataset yet")}</div></div>
    <div class="adx-intro"><p>A dataset (Meta calls it a pixel) lets Meta count the orders your ads bring. Each ad account can have one.</p></div>
    <div class="adx-h">${a.meta_pixel_id ? "Create a new one" : "Create a dataset"}</div>
    <div class="adx-panel"><label class="adx-lbl" for="adxDsName">Name it</label>
      <input id="adxDsName" maxlength="60" value="${escH(adxName(a))} dataset" autocomplete="off">
      <div id="adxMsg"></div><button type="button" class="adx-btn" id="adxGo">Create dataset</button></div>
    <div class="adx-h">Or use one already on this ad account</div>
    <div id="adxExisting"><div class="empty"><div class="spin" style="width:16px;height:16px;border-width:2px;"></div></div></div>`;
  root.querySelector("#adxGo").addEventListener("click", async e => {
    const b = e.currentTarget, m = root.querySelector("#adxMsg"); b.disabled = true; b.textContent = "Creating…"; m.innerHTML = "";
    const r = await sbFn("events-manager", { action: "create_dataset", ad_account_id: a.id, name: root.querySelector("#adxDsName").value.trim() }).catch(err => ({ error: err.message }));
    if (r.error) { m.innerHTML = bvAdxErr(r.error, "You can also create the dataset in Meta's Events Manager, then pick it from the list below."); b.disabled = false; b.textContent = "Create dataset"; return; }
    bvToast(r.existing ? "Linked the dataset this ad account already had" : "Dataset created"); await loadAccounts(); bvAdx.fresh = false; bvAdxBack();
  });
  const box = root.querySelector("#adxExisting");
  const ov = await sbFn("events-manager", { action: "overview", ad_account_id: a.id }).catch(err => ({ error: err.message }));
  if (ov.error) { box.innerHTML = `<div class="adx-note">Couldn't read this ad account's datasets from Meta.</div>`; return; }
  const list = ov.pixels || [];
  box.innerHTML = list.length ? list.map(px => `<div class="adx-found"><div><b>${escH(px.name || px.id)}</b><small>${px.id === a.meta_pixel_id ? "Currently linked" : escH(px.id)}</small></div>${px.id === a.meta_pixel_id ? "" : `<button type="button" class="adx-btn small useDs" data-id="${escH(px.id)}">Use this</button>`}</div>`).join("")
    : `<div class="adx-note">No datasets found on this ad account yet.</div>`;
  box.querySelectorAll(".useDs").forEach(btn => btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "Linking…";
    const r = await sbFn("events-manager", { action: "use_dataset", ad_account_id: a.id, pixel_id: btn.dataset.id }).catch(err => ({ error: err.message }));
    if (r.error) { btn.disabled = false; btn.textContent = "Use this"; root.querySelector("#adxMsg").innerHTML = bvAdxErr(r.error); return; }
    bvToast("Dataset linked"); await loadAccounts(); bvAdx.fresh = false; bvAdxBack();
  }));
}

// Hide what this business will never use, so each seller sees their own app (not every module).
function bvApplyCompanyProfile() {
  const c = window.myCompany; if (!c) return;
  const hide = new Set();
  if (c.account_type === "personal") ["leaderboard", "approvals", "earnings", "riders", "support"].forEach(t => hide.add(t));
  // Nothing to deliver (digital goods, services, pick-up) -> no riders/delivery tab
  if (["digital", "none", "pickup"].includes(c.fulfilment)) hide.add("riders");
  const only = (c.business_types || []);
  if (only.length && only.every(t => ["courses_digital", "services", "real_estate"].includes(t))) hide.add("riders");
  hide.forEach(t => document.querySelector(`[data-tab="${t}"]`)?.style.setProperty("display", "none"));
  document.body.dataset.account = c.account_type || "company";
  try { if (typeof bvSyncBottomNav === "function") bvSyncBottomNav(); } catch {}
  try { if (typeof bvApplyKinds === "function") bvApplyKinds(); } catch {}
}