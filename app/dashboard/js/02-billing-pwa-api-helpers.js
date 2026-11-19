// Revora dashboard, part 02 of 23: BILLING + 7-DAY TRIAL · PWA: install, service worker, push notifications · API HELPERS


// ── BILLING + 7-DAY TRIAL ────────────────────────────────────────────────────
// State comes from paystack-balance (action billing_status). Prices live on the server.
const BV_PLAN_COPY = {
  media_buyer: { name: "Media buyer", price: 5000, pts: ["Connect ChatGPT or Claude", "Build sales pages", "AI creative generator", "Launch ads with ChatGPT or Claude", "Orders and delivery tracking"] },
  business: { name: "Business", price: 25000, pts: ["Admin plus up to 5 media buyers", "Delivery agents and customer care", "Leaderboard, approvals, team roles", "Virtual accounts and auto payment confirmation"] },
};
let bvBillMonths = 1;
function bvMonthsPrice(plan, m) { return BV_PLAN_COPY[plan].price * (m === 12 ? 10 : m); }
function bvPlanCards(b) {
  const sug = b?.suggested_plan;
  const canPay = b?.can_manage !== false;
  const monthsRow = `<div class="bill-months">${[1, 3, 6, 12].map(m => `<button type="button" class="${m === bvBillMonths ? "on" : ""}" onclick="bvBillMonths=${m};bvRepaintPlans()">${m === 12 ? "12 months (2 free)" : m + (m === 1 ? " month" : " months")}</button>`).join("")}</div>`;
  const cards = Object.entries(BV_PLAN_COPY).map(([id, p]) => `
    <div class="bill-plan ${sug === id ? "sug" : ""}">
      ${sug === id ? '<span class="tag">Suggested for you</span>' : ""}
      <h4>${p.name}</h4>
      <div class="pr">${fN(bvMonthsPrice(id, bvBillMonths))}<small> / ${bvBillMonths === 12 ? "year" : bvBillMonths + " mo"}</small></div>
      <ul>${p.pts.map(x => `<li>${x}</li>`).join("")}</ul>
      ${canPay ? `<button type="button" class="btn btn-a" onclick="bvSubscribe('${id}',this)">Pay with Paystack</button>` : `<div style="font-size:12px;color:var(--muted)">Ask your account owner to pay.</div>`}
    </div>`).join("");
  const ent = `<div class="bill-plan"><h4>Enterprise</h4><div class="pr" style="font-size:18px">Custom</div><ul><li>Unlimited media buyers</li><li>Volume pricing and invoices</li><li>Guided onboarding</li></ul><a class="btn btn-g" href="mailto:hello@pipinstallsofi.com?subject=Revora%20Enterprise" style="text-align:center">Contact sales</a></div>`;
  return monthsRow + `<div class="bill-plans">${cards}${ent}</div>`;
}
function bvRepaintPlans() {
  const b = window.myBilling; if (!b) return;
  document.querySelectorAll(".bvPlansSlot").forEach(el => el.innerHTML = bvPlanCards(b));
}
async function bvSubscribe(plan, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Opening Paystack…"; }
  const r = await sbFn("paystack-balance", { action: "subscribe", plan, months: bvBillMonths, access_token: sessionData.access_token, return_url: location.origin + location.pathname + "?billing=done" });
  if (r?.authorization_url) { location.href = r.authorization_url; return; }
  alert(r?.error || "Could not start the payment. Try again.");
  if (btn) { btn.disabled = false; btn.textContent = "Pay with Paystack"; }
}
function bvPaintBilling() {
  const b = window.myBilling; if (!b) return;
  let pill = document.getElementById("bvBillPill");
  if (!pill) { pill = document.createElement("div"); pill.id = "bvBillPill"; document.body.appendChild(pill); }
  let lock = document.getElementById("bvLock");
  if (!lock) { lock = document.createElement("div"); lock.id = "bvLock"; document.body.appendChild(lock); }
  const show = b.state === "trialing" || (b.state === "active" && b.days_left <= 5);
  pill.classList.toggle("on", show && b.can_manage !== false);
  pill.classList.toggle("warn", b.days_left <= 2);
  if (show) pill.innerHTML = `<span>${b.state === "trialing" ? `Free trial: <b>${b.days_left} day${b.days_left === 1 ? "" : "s"}</b> left` : `Your plan renews in <b>${b.days_left} day${b.days_left === 1 ? "" : "s"}</b>`}</span><button type="button" onclick="bvOpenBilling()">${b.state === "trialing" ? "Choose a plan" : "Renew"}</button>`;
  const locked = b.state === "expired";
  lock.classList.toggle("on", locked);
  if (locked) lock.innerHTML = `<div class="lk">
    <h2>${b.plan === "trial" ? "Your free trial has ended" : "Your plan has expired"}</h2>
    <div style="color:var(--text2);font-size:13.5px">Nothing has been deleted. Your ads, orders, products and websites are safe and come back the moment you pick a plan.</div>
    <div class="bvPlansSlot">${bvPlanCards(b)}</div>
    <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;font-size:12px;color:var(--muted)">
      <span>Payments are processed by Paystack. Need an invoice or a bigger plan? <a href="mailto:hello@pipinstallsofi.com" style="color:var(--accent)">hello@pipinstallsofi.com</a></span>
      <a href="#" onclick="event.preventDefault();supabaseClient.auth.signOut().then(()=>location.href='login.html')" style="color:var(--muted)">Sign out</a>
    </div></div>`;
  document.body.style.overflow = locked ? "hidden" : "";
  if (document.getElementById("billingPanel")) bvRenderBillingPanel();
}
function bvOpenBilling() {
  bvSettingsSec = "billing";
  if (activeTab === "settings") { render(); return; }
  const t = document.querySelector('[data-tab="settings"]'); if (t) t.click();
}
async function bvLoadBilling() {
  try {
    const q = new URLSearchParams(location.search), ref = q.get("reference") || q.get("trxref");
    if (q.get("billing") === "done" && ref) {
      const v = await sbFn("paystack-balance", { action: "verify", reference: ref, access_token: sessionData.access_token });
      history.replaceState(null, "", location.pathname);
      window.bvBillToast = v?.ok ? { ok: true, text: "Payment received. Your plan is active." } : { ok: false, text: v?.error || "We could not confirm that payment yet. If you were charged, it will activate within a few minutes." };
    }
    const r = await sbFn("paystack-balance", { action: "billing_status", access_token: sessionData.access_token });
    if (r && !r.error) { window.myBilling = r; bvPaintBilling(); }
    if (window.bvBillToast) { bvOpenBilling(); }
  } catch (e) { console.warn("billing", e); }
}
function bvRenderBillingPanel() {
  const el = document.getElementById("billingPanel"); const b = window.myBilling;
  if (!el) return;
  if (!b) { el.innerHTML = '<div class="ph"><div class="ph-title">Billing</div></div><div style="color:var(--muted);font-size:12.5px">Loading…</div>'; return; }
  const fmt = d => d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "";
  const status = b.state === "comped" ? "Full access (no charge)" : b.state === "trialing" ? `Free trial, ${b.days_left} day${b.days_left === 1 ? "" : "s"} left (ends ${fmt(b.trial_ends_at)})` : b.state === "active" ? `${BV_PLAN_COPY[b.plan]?.name || b.plan} plan, paid until ${fmt(b.plan_expires_at)}` : "Expired";
  const toast = window.bvBillToast; delete window.bvBillToast;
  el.innerHTML = `<div class="ph"><div class="ph-title">Billing</div><div class="ph-count">${escH(b.company || "")}</div></div>
    ${toast ? `<div class="msg ${toast.ok ? "ok" : "err"}" style="display:block;margin-bottom:12px;">${toast.ok ? "✅" : "❌"} ${escH(toast.text)}</div>` : ""}
    <div style="font-size:13.5px;margin-bottom:4px"><b>${escH(status)}</b></div>
    ${b.state === "comped" ? '<div style="font-size:12px;color:var(--muted)">Your workspace is on the house.</div>' : `<div style="font-size:12px;color:var(--muted)">Pay for 1, 3, 6 or 12 months at a time. We remind you before it ends and never delete your data.</div><div class="bvPlansSlot">${bvPlanCards(b)}</div>`}`;
}

function bvBuildBottomNav() {
  const nav = document.getElementById("bottomNav");
  if (!nav) return;
  const iconOf = (tab) => document.querySelector(`[data-tab="${tab}"] .tab-ico`)?.innerHTML || "";
  nav.innerHTML = BN_ITEMS.map((it) => `<button type="button" class="bn-item" data-go="${it.tab}"><span class="bn-ico">${iconOf(it.tab)}</span><span>${it.label}</span><span class="bn-badge" id="bnBadge-${it.tab}"></span></button>`).join("")
    + `<button type="button" class="bn-item" data-go="__more"><span class="bn-ico">${BN_MORE_ICON}</span><span>Settings</span><span class="bn-dot" id="bnMoreDot"></span></button>`;
  nav.addEventListener("click", (e) => {
    const b = e.target.closest(".bn-item");
    if (!b) return;
    if (b.dataset.go === "__more") { bvGoMore(); return; }
    // Same path as tapping the sidebar item: sets the tab, closes the sheet, renders.
    document.querySelector(`[data-tab="${b.dataset.go}"]`)?.click();
  });
  bvSyncBottomNav();
  // The sidebar's active class is the single source of truth for "where am I".
  new MutationObserver(bvSyncBottomNav).observe(document.getElementById("tabsBar"), { attributes: true, subtree: true, attributeFilter: ["class", "style"], childList: true, characterData: true });
}

function bvSyncBottomNav() {
  const nav = document.getElementById("bottomNav");
  if (!nav) return;
  const inBar = new Set(BN_ITEMS.map((i) => i.tab));
  nav.querySelectorAll(".bn-item[data-go]").forEach((b) => {
    const tab = b.dataset.go;
    if (tab === "__more") { b.classList.toggle("active", !inBar.has(activeTab)); return; }
    const src = document.querySelector(`[data-tab="${tab}"]`);
    b.style.display = !src || src.style.display === "none" ? "none" : ""; // role-hidden tabs stay hidden
    b.classList.toggle("active", tab === activeTab);
  });
  const shown = (id) => { const el = document.getElementById(id); return el && el.style.display !== "none" ? Number(el.textContent) || 0 : 0; };
  // Orders: AI calls that flagged themselves for a human (same count as the sidebar badge).
  const flags = shown("callFlagBadge");
  const ob = document.getElementById("bnBadge-orders");
  if (ob) { ob.textContent = flags > 99 ? "99+" : String(flags); ob.classList.toggle("show", flags > 0); }
  // A dot on More when something inside it needs attention (pending approvals, support queue).
  document.getElementById("bnMoreDot")?.classList.toggle("show", shown("approvalBadge") + shown("supportFlagBadge") > 0);
}

// Unread chats badge (number of chats with unread messages), plus the app-icon badge.
function bvSetChatBadge(n) {
  const el = document.getElementById("bnBadge-conversations");
  if (el) { el.textContent = n > 99 ? "99+" : String(n); el.classList.toggle("show", n > 0); }
  try {
    if (BV_STANDALONE && "setAppBadge" in navigator) { n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge(); }
  } catch {}
}
async function loadChatUnread() {
  try {
    const rows = await sbQuery("conversations", "select=id&unread_count=gt.0&current_state=neq.MERGED&limit=500");
    bvSetChatBadge(rows?.length || 0);
  } catch {}
}

// ── PWA: install, service worker, push notifications ─────────────────────────
const BV_STANDALONE = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const BV_IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const BV_PUSH_SUPPORTED = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
let bvInstallPrompt = null; // Android/desktop Chrome's deferred "install app" prompt

// What each notification switch controls. Add a line here to add a switch.
const BV_PUSH_CATEGORIES = [
  { key: "messages", label: "New customer messages", sub: "A customer messages you on WhatsApp (text, photo or voice note)." },
  { key: "ads", label: "AI ad alerts", sub: "Your AI says an ad broke your kill rules, paused one for you, or a campaign just went live." },
  { key: "orders", label: "Orders", sub: "A new order lands, or one is delivered or cancelled. Any time of day." },
  { key: "reports", label: "End-of-day report", sub: "Orders, visitors, people who left without ordering and ad spend, every evening at 9pm." },
  { key: "leads", label: "New leads", sub: "Someone fills in a form on your page or a Meta lead form." },
  { key: "money", label: "Money", sub: "Your funding wallet is topped up." },
];

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW registration failed:", e)));
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "open") {
      try { const u = new URL(e.data.url); bvOpenTarget(u.hash === "#ai" ? "ai" : u.searchParams.get("open")); } catch {}
    } else if (e.data?.type === "push-resubscribe") {
      bvPushSync(true);
    }
  });
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); bvInstallPrompt = e; bvRenderAppBanner(); });
window.addEventListener("appinstalled", () => { bvInstallPrompt = null; bvRenderAppBanner(); });

// "?open=conv:<id>" or "?open=tab:<name>" -> pick the screen before the first render.
function bvApplyOpenParam() {
  const target = new URLSearchParams(window.location.search).get("open");
  if (!target) return;
  history.replaceState(null, "", window.location.pathname);
  bvSetTarget(target);
}
function bvSetTarget(target) {
  if (!target) return false;
  if (target === "ai") { window.bvPendingAi = true; return true; }
  if (target === "notifications") { window.bvPendingBell = true; return true; }
  if (target.startsWith("conv:")) { window.bvPendingConv = target.slice(5); activeTab = "conversations"; }
  else if (target.startsWith("tab:") && document.querySelector(`[data-tab="${target.slice(4)}"]`)) activeTab = target.slice(4);
  else return false;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === activeTab));
  return true;
}
// A notification was tapped while the app was already open.
function bvOpenTarget(target) {
  if (target === "ai") { toggleChat(true); chLoadInbox(); return; }
  if (target === "notifications") { if (window.rvnOpen) rvnOpen(); return; }
  if (bvSetTarget(target)) render();
}

function bvU8FromB64url(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function bvVapidKey() {
  const r = await fetch(`${SUPA_URL}/functions/v1/handle-whatsapp-reply?action=public_key`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const j = await r.json();
  if (!j.publicKey) throw new Error(j.error || "couldn't get the notification key");
  return j.publicKey;
}
async function bvSaveSubscription(sub) {
  const j = sub.toJSON();
  const { error } = await supabaseClient.rpc("register_push_subscription", {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent.slice(0, 200),
  });
  if (error) throw new Error(error.message);
}

// Turn notifications on for this device (must be called from a tap/click).
async function bvPushEnable() {
  if (!BV_PUSH_SUPPORTED) throw new Error("This browser doesn't support notifications.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked for this site in your phone/browser settings." : "Permission wasn't granted.");
  const reg = await navigator.serviceWorker.ready;
  const key = await bvVapidKey();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different server key can never receive our pushes.
  if (sub && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey || []))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== key) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bvU8FromB64url(key) });
  await bvSaveSubscription(sub);
}
async function bvPushDisable() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await supabaseClient.from("push_subscriptions").delete().eq("endpoint", endpoint);
}
// Quietly keep this device's registration fresh (new login, rotated endpoint).
async function bvPushSync(force) {
  try {
    if (!BV_PUSH_SUPPORTED || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await bvSaveSubscription(sub);
    else if (force) await bvPushEnable();
  } catch (e) { console.warn("push sync:", e.message); }
}
async function bvPushPrefs() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const { data } = await supabaseClient.from("push_subscriptions").select("prefs").eq("endpoint", sub.endpoint).maybeSingle();
  return { endpoint: sub.endpoint, prefs: data?.prefs || {} };
}
async function bvPushSetPref(key, on) {
  const cur = await bvPushPrefs();
  if (!cur) return;
  const prefs = { ...cur.prefs, [key]: on };
  const { error } = await supabaseClient.from("push_subscriptions").update({ prefs }).eq("endpoint", cur.endpoint);
  if (error) throw new Error(error.message);
}

function bvIosInstallSteps() {
  return `<ol class="np-steps">
    <li>Open this page in <b>Safari</b>.</li>
    <li>Tap the <b>Share</b> button (the square with an arrow) at the bottom of the screen.</li>
    <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
    <li>Open <b>Revora</b> from your home screen, go to <b>Settings</b> and tap <b>Turn on notifications</b>.</li>
  </ol>`;
}

// The Notifications card on the Settings tab.
async function bvRenderNotifPanel() {
  const el = document.getElementById("notifPanel");
  if (!el) return;
  const head = (status) => `<div class="ph"><div class="ph-title">Notifications</div>${status || ""}</div>`;
  const box = (inner) => { el.innerHTML = inner; };

  if (BV_IS_IOS && !BV_STANDALONE) {
    return box(`${head(`<span class="np-status warn">Install first</span>`)}
      <div style="font-size:12.5px;color:var(--text2);line-height:1.5;">On iPhone, notifications only work once Revora is added to your home screen:</div>${bvIosInstallSteps()}`);
  }
  if (!BV_PUSH_SUPPORTED) {
    return box(`${head(`<span class="np-status off">Not available</span>`)}<div style="font-size:12.5px;color:var(--text2);">This browser doesn't support notifications. Try Chrome, Edge or Safari (iPhone: iOS 16.4 or newer).</div>`);
  }
  if (Notification.permission === "denied") {
    return box(`${head(`<span class="np-status warn">Blocked</span>`)}<div style="font-size:12.5px;color:var(--text2);line-height:1.5;">Notifications are blocked for Revora. ${BV_IS_IOS ? "Open <b>Settings → Notifications → Revora</b> on your iPhone and allow them." : "Click the lock icon next to the address (or the app's settings on Android), set <b>Notifications</b> to <b>Allow</b>, then reload."}</div>`);
  }

  let cur = null;
  try { cur = Notification.permission === "granted" ? await bvPushPrefs() : null; } catch {}

  if (!cur) {
    box(`${head(`<span class="np-status off">Off</span>`)}
      <div style="font-size:12.5px;color:var(--text2);line-height:1.5;margin-bottom:12px;">Get an alert on this device the moment a customer messages you${BV_STANDALONE ? "" : " — even when the app is closed"}.</div>
      <button class="btn btn-g" id="npEnableBtn">Turn on notifications</button><div id="npMsg" style="margin-top:8px;"></div>`);
    document.getElementById("npEnableBtn").onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Turning on…";
      try { await bvPushEnable(); bvRenderAppBanner(); await bvRenderNotifPanel(); }
      catch (err) { btn.disabled = false; btn.textContent = "Turn on notifications"; document.getElementById("npMsg").innerHTML = `<div class="msg err" style="display:block;">${escH(err.message)}</div>`; }
    };
    return;
  }

  box(`${head(`<span class="np-status on">On</span>`)}
    ${BV_PUSH_CATEGORIES.map((c) => `<div class="np-row"><div><div class="np-lbl">${escH(c.label)}</div><div class="np-sub">${escH(c.sub)}</div></div>
      <label class="switch"><input type="checkbox" data-cat="${c.key}" ${cur.prefs[c.key] === false ? "" : "checked"}><span class="sw-track"></span></label></div>`).join("")}
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
      <button class="btn btn-g" id="npTestBtn">Send test notification</button>
      <button class="btn btn-a" id="npOffBtn">Turn off on this device</button>
    </div><div id="npMsg" style="margin-top:8px;"></div>`);
  el.querySelectorAll("input[data-cat]").forEach((i) => i.addEventListener("change", async () => {
    try { await bvPushSetPref(i.dataset.cat, i.checked); } catch (err) { i.checked = !i.checked; alert("Couldn't save: " + err.message); }
  }));
  document.getElementById("npTestBtn").onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    const msg = document.getElementById("npMsg");
    try {
      const res = await sbFn("handle-whatsapp-reply", { type: "test" });
      msg.innerHTML = res?.error ? `<div class="msg err" style="display:block;">${escH(res.error)}</div>` : `<div class="msg ok" style="display:block;">Sent — it should arrive in a few seconds.</div>`;
    } catch (err) { msg.innerHTML = `<div class="msg err" style="display:block;">${escH(err.message)}</div>`; }
    btn.disabled = false;
  };
  document.getElementById("npOffBtn").onclick = async () => { try { await bvPushDisable(); bvRenderAppBanner(); await bvRenderNotifPanel(); } catch (err) { alert(err.message); } };
}

// A dismissible strip under the header: "install the app" / "turn on notifications".
function bvRenderAppBanner() {
  const el = document.getElementById("appBanner");
  if (!el) return;
  const hide = () => { el.classList.remove("show"); el.innerHTML = ""; };
  const dismissedAt = Number(localStorage.getItem("bv_banner_dismissed") || 0);
  if (Date.now() - dismissedAt < 14 * 86400000) return hide();

  const show = (title, sub, btnLabel, onClick) => {
    el.innerHTML = `<div class="ab-ico">${icon("chat", 18)}</div><div class="ab-txt"><b>${title}</b><span>${sub}</span></div>
      <button class="btn btn-g" id="abBtn" style="white-space:nowrap;">${btnLabel}</button><button class="ab-x" id="abX" title="Dismiss">×</button>`;
    el.classList.add("show");
    document.getElementById("abBtn").onclick = onClick;
    document.getElementById("abX").onclick = () => { localStorage.setItem("bv_banner_dismissed", String(Date.now())); hide(); };
  };

  if (!BV_STANDALONE) {
    if (BV_IS_IOS) {
      return show("Install Revora on your iPhone", "Get instant alerts and a full-screen app.", "How",
        () => bvModal("Install on iPhone", `<div style="font-size:13px;color:var(--text2);">Add Revora to your home screen:</div>${bvIosInstallSteps()}`));
    }
    if (bvInstallPrompt) {
      return show("Install Revora", "Open it like an app and get instant alerts.", "Install", async () => {
        bvInstallPrompt.prompt();
        await bvInstallPrompt.userChoice.catch(() => {});
        bvInstallPrompt = null; bvRenderAppBanner();
      });
    }
    return hide();
  }
  // Installed: nudge to turn notifications on if this device isn't subscribed yet
  // (never asked, or permission was granted but the subscription is gone).
  if (BV_PUSH_SUPPORTED && Notification.permission !== "denied") {
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => {
      if (sub) return hide();
      show("Turn on notifications", "Know the moment a customer messages you.", "Turn on", async () => {
        try { await bvPushEnable(); hide(); if (activeTab === "settings") bvRenderNotifPanel(); }
        catch (err) { alert(err.message); }
      });
    }).catch(hide);
    return;
  }
  hide();
}

// Tiny generic modal using the same overlay styles as the rest of the app.
function bvModal(title, bodyHtml) {
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal" style="max-width:420px;"><button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
    <div style="font-weight:600;font-size:15px;margin-bottom:10px;">${escH(title)}</div>${bodyHtml}</div>`;
  document.body.appendChild(overlay);
}

// ── API HELPERS ───────────────────────────────────────────────────────────────
async function sbQuery(table, queryStr = "", opts = {}) {
  // Append ad account filter if applicable (ignore for system_settings, earnings etc. which are shared/global)
  let finalQuery = queryStr;
  // Products and creatives belong to the whole company, not to one ad account: they show under every ad account. (They are sent to Meta per account when a campaign launches.)
  const filteredTables = ["ad_sets", "daily_metrics"];

  if (!opts.allAccounts && filteredTables.includes(table) && activeAccountId) {
    finalQuery += finalQuery ? `&ad_account_id=eq.${activeAccountId}` : `ad_account_id=eq.${activeAccountId}`;
  }

  // Orders intentionally is NOT scoped to activeAccountId. It's your own CRM data (not Meta's),
  // fed by one shared order.html across every ad account/buyer -- switching the ad-account
  // selector should never make real orders appear to vanish. The Orders tab always shows the
  // total across the whole company; only the Meta-specific tabs (Campaigns, Ad Spend & ROAS)
  // stay scoped to whichever ad account is active.

  const res = await fetch(`${SUPA_URL}/rest/v1/${table}${finalQuery ? "?" + finalQuery : ""}`, {
    headers: {
      apikey: ANON, 
      Authorization: `Bearer ${sessionData?.access_token || ANON}`,
      "Content-Type": "application/json"
    },
  });
  if (!res.ok) throw new Error(await res.text());
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

// Exact row count via PostgREST's Prefer: count=exact + a 0-row Range, instead
// of fetching every row just to read .length -- avoids both the wasted
// payload and PostgREST's default row cap silently under-reporting big tables.
async function sbCount(table, queryStr = "") {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}${queryStr ? "?" + queryStr : ""}`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${sessionData?.access_token || ANON}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!res.ok) throw new Error(await res.text());
  const range = res.headers.get("content-range"); // e.g. "0-0/1278"
  const total = range ? parseInt(range.split("/")[1], 10) : 0;
  return Number.isFinite(total) ? total : 0;
}

// Calls a Postgres function via PostgREST's /rpc/ endpoint (for security-definer
// aggregates that need to bypass a per-row RLS restriction, e.g. the buyer
// leaderboard -- every buyer can see the ranking even though they can't see
// each other's raw orders).
async function sbRpc(fnName, args = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${sessionData?.access_token || ANON}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(await res.text());
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

async function sbFn(name, body = null, method = "POST") {
  try {
    // Inject activeAccountId into the payload so edge functions know which account to process if needed,
    // but don't clobber an ad_account_id the caller explicitly set (e.g. checking a non-active account's balance).
    if (body && typeof body === 'object' && !body.ad_account_id) {
      body.ad_account_id = activeAccountId;
    }
    
    const res = await fetch(`${SUPA_URL}/functions/v1/${name}`, {
      method,
      headers: { 
        Authorization: `Bearer ${sessionData?.access_token || ANON}`, 
        "Content-Type": "application/json" 
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json();
  } catch(e) { return { error: e.message }; }
}