// Revora dashboard, part 20 of 23: SETTINGS: sections + setup checklist

// ── TAB: SETTINGS ─────────────────────────────────────────────────────────────

// ── SETTINGS: sections + setup checklist ─────────────────────────────────────
let bvSettingsSec = "accounts";
let bvSetOpen = false; // phones: false = the list of sections, true = one section open
function bvLimitedRole() { const r = window.myProfile?.role; return r === "delivery_agent" || r === "customer_care"; }
const BV_SHOW_WHATSAPP = false; // switch on once the Revora WhatsApp account is verified
const BV_SET_ICONS = {
  accounts: '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>',
  pages: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M9 21V9"/>',
  domains: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  whatsapp: '<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.5A8 8 0 1121 12z"/>',
  aiapps: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15z"/>',
  business: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 21v-4h6v4"/>',
  billing: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>',
  automation: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  aiteam: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
  security: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
  help: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
  ext: '<path d="M7 17L17 7M8 7h9v9"/>'
};
const bvSetIcon = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${BV_SET_ICONS[id] || ""}</svg>`;
// Settings are grouped by what the person is trying to do: connect things, run the business, automate, manage the account.
function bvSettingsSections(isAdmin) {
  // Riders and customer care have no ad accounts, pixels or domains: they only manage their own alerts.
  const r = window.myProfile?.role;
  if (r === "delivery_agent" || r === "customer_care") return [{ id: "automation", group: "Automation", label: "Alerts & notifications" }];
  const phone = mobileMq.matches; // ad accounts and pages have their own screens on phones
  const pro = ["owner", "admin", "buyer"].includes(r);
  return [
    ...(phone ? [] : [{ id: "accounts", group: "Connections", label: "Ad accounts" }]),
    ...(!phone && pro ? [{ id: "pages", group: "Connections", label: "Pages & pixels" }] : []),
    { id: "domains", group: "Connections", label: "Domains" },
    ...(BV_SHOW_WHATSAPP && pro ? [{ id: "whatsapp", group: "Connections", label: "WhatsApp" }] : []),
    ...(pro ? [{ id: "aiapps", group: "Connections", label: "AI apps" }] : []),
    { id: "business", group: "Business & team", label: isAdmin ? "Company & team" : "Company" },
    ...(isAdmin ? [{ id: "billing", group: "Business & team", label: "Billing" }] : []),
    { id: "automation", group: "Automation", label: "Automation & alerts" },
    ...(pro ? [{ id: "aiteam", group: "Automation", label: "AI Team", link: "/ai-team.html" }] : []),
    ...(pro ? [{ id: "security", group: "Account", label: "Security" }] : []),
    { id: "help", group: "Account", label: "Help & support" },
  ];
}
function bvSettingsNavHtml(isAdmin) {
  let g = "";
  return bvSettingsSections(isAdmin).map(x => {
    const head = x.group !== g ? `<div class="set-grp">${escH(x.group)}</div>` : ""; g = x.group;
    return `${head}<button type="button" class="set-nav-btn ${x.id === bvSettingsSec ? "active" : ""}" data-sec="${x.id}" ${x.link ? `data-link="${x.link}"` : ""}><span>${bvSetIcon(x.id)}</span>${escH(x.label)}${x.link ? `<svg class="ext" viewBox="0 0 24 24" aria-hidden="true">${BV_SET_ICONS.ext}</svg>` : ""}</button>`;
  }).join("");
}
function bvSettingsWire() {
  const nav = document.getElementById("setNav"), body = document.getElementById("setBody");
  if (!nav || !body) return;
  nav.querySelectorAll(".set-nav-btn").forEach(btn => btn.onclick = () => {
    if (btn.dataset.link) { location.href = btn.dataset.link; return; }
    bvSettingsSec = btn.dataset.sec;
    body.dataset.active = bvSettingsSec;
    if (body.parentElement.dataset.m) { bvSetOpen = true; body.parentElement.dataset.m = "detail"; bvUpdateAppBar(); window.scrollTo(0, 0); }
    nav.querySelectorAll(".set-nav-btn").forEach(x => x.classList.toggle("active", x === btn));
  });
}
async function bvSetupState() {
  const role = window.myProfile?.role;
  if (!["owner", "admin", "buyer"].includes(role)) return { done: true, items: [] };
  const mine = accountsList;
  const [products, sites, camps, ai] = await Promise.all([
    sbCount("products", "is_active=eq.true").catch(() => 0),
    sbQuery("sites", "select=id,status&limit=50").catch(() => []),
    sbCount("campaigns", "").catch(() => 0),
    sbFn("ai-connections", { action: "list" }).then(r => (r?.apps || []).length).catch(() => 0),
  ]);
  const items = [
    { label: "Get an ad account", done: mine.length > 0, go: ["settings", "accounts"] },
    { label: "Set your pixel and Page", done: mine.some(a => a.meta_pixel_id && a.fb_page_id), go: ["settings", "pages"] },
    { label: "Connect your favourite AI app", done: ai > 0, go: ["settings", "aiapps"] },
    { label: "Build your sales page", done: (sites || []).some(x => x.status === "published") || (sites || []).length > 0, go: ["websites"] },
    { label: "Launch your first ad", done: camps > 0, go: ["campaigns"] },
  ];
  return { items, done: items.every(i => i.done), pct: Math.round(items.filter(i => i.done).length / items.length * 100) };
}
function bvSetupChecklistHtml(st) {
  const next = st.items.find(i => !i.done);
  return `<div class="setup-slim" onclick="bvSetupAll()"><div class="seg">${st.items.map(i => `<i class="${i.done ? "on" : ""}"></i>`).join("")}</div>
    <div class="nx">Next: <b>${escH(next.label)}</b></div>
    <button type="button" onclick="event.stopPropagation();bvSetupGo('${next.go[0]}','${next.go[1] || ""}')">Do it</button></div>`;
}
function bvSetupAll() {
  bvSetupState().then(st => bvModal("Get started", `<div class="setup-list" style="margin-top:4px;">${st.items.map(i => `<div class="setup-row ${i.done ? "done" : ""}" style="padding:8px 0;font-size:14px;">
    <span class="setup-tick">${i.done ? "✓" : ""}</span><span class="setup-lbl" style="flex:1;">${escH(i.label)}</span>
    ${i.done ? "" : `<button type="button" class="btn btn-g" style="padding:4px 12px;font-size:11px;" onclick="bvCloseModal();bvSetupGo('${i.go[0]}','${i.go[1] || ""}')">Do it</button>`}</div>`).join("")}</div>`));
}
function bvSetupGo(tab, sec) {
  if (mobileMq.matches && tab === "settings" && ["accounts", "pages", "events"].includes(sec)) { bvAdxOpen(sec === "accounts" ? "list" : sec === "pages" ? "pages" : "datasets"); return; }
  if (tab === "__profile") { location.href = "setup-company.html?profile=1"; return; } if (sec) { bvSettingsSec = sec; bvSetOpen = true; } bvGoToTab(tab); }
async function bvRenderSetupSlot() {
  const slot = document.getElementById("setupCheckSlot"); if (!slot) return;
  const st = await bvSetupState().catch(() => null);
  if (st && !st.done) slot.innerHTML = bvSetupChecklistHtml(st);
}

async function bvShareAccount(sel) {
  sel.disabled = true;
  const r = await sbFn("ad-account-pool", { action: "share", ad_account_id: sel.dataset.id, media_buyer_id: sel.value || null }).catch(err => ({ error: err.message }));
  sel.disabled = false;
  if (r.error) { bvToast(r.error, "err"); return; }
  bvToast(sel.value ? "Shared. Its spend now comes from that buyer's wallet." : "Unshared. It is paid from the company wallet.");
  await loadAccounts();
}

async function renderSettings(el) {
  if (bvLimitedRole()) bvSettingsSec = "automation";
  const isAdmin = window.myProfile?.role === "owner" || window.myProfile?.role === "admin";
  const [buyers, company, invites, teamMembers, partnerBizId] = await Promise.all([
    sbQuery("media_buyers", "select=*&order=code.asc").catch(() => []),
    sbQuery("companies", "select=id,name,slug&limit=1").then(r => r?.[0]).catch(() => null),
    isAdmin ? sbQuery("company_invites", "select=*&order=created_at.desc&limit=30").catch(() => []) : [],
    isAdmin ? sbQuery("profiles", "select=id,role,display_name,created_at,media_buyer_id&order=created_at.asc").catch(() => []) : [],
    sbFn("sync-partner-accounts", { access_token: sessionData.access_token, mode: "get_business_id" }).then(r => r.business_id).catch(() => null),
  ]);
  const oauthToast = window.oauthToast;
  delete window.oauthToast;
  // Who an ad account can be shared with. A Revora account shared with a team media buyer is paid from that buyer's wallet.
  const teamBuyerIds = new Set((teamMembers || []).filter(m => m.role === "buyer").map(m => m.media_buyer_id));
  const shareOpts = cur => `<option value="">Nobody (company)</option>` + (buyers || []).filter(b => b.active !== false).map(b => `<option value="${b.id}" ${b.id === cur ? "selected" : ""}>${escH(b.name)}${teamBuyerIds.has(b.id) ? "" : " (owner/admin)"}</option>`).join("");

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Settings</div></div>
    ${(window.myProfile?.role === "delivery_agent" || window.myProfile?.role === "customer_care") ? "<style>#fbConnectPanel,#killRulesPanel,#domainsPanel,#aiAgentPanel,[data-sec=accounts],[data-sec=business],[data-sec=domains],[data-sec=billing]{display:none!important}</style>" : ""}
    <div id="setupCheckSlot"></div>
    <div class="set-wrap" ${mobileMq.matches ? `data-m="${bvSetOpen || bvLimitedRole() ? "detail" : "list"}"` : ""}>
    <nav class="set-nav" id="setNav">${bvSettingsNavHtml(isAdmin)}</nav>
    <div class="set-body" id="setBody" data-active="${bvSettingsSec}">

    ${oauthToast ? `<div class="msg ${oauthToast.ok ? "ok" : "err"}" style="display:block;margin-bottom:14px;">${oauthToast.ok ? "✅" : "❌"} ${escH(oauthToast.detail)}</div>` : ""}

    ${accountsList.length ? `<div class="set-group" data-sec="accounts">
      <div class="set-lbl">Your ad accounts</div>
      ${accountsList.map(a => `<div class="set-card">
        <div class="set-acct-head">📣 ${escH(a.nickname || a.name || "Ad account")} <small>${escH(a.meta_ad_account_id || "")} · Balance ${fN(a.balance_naira)}</small><span class="pill ${a.status === "active" ? "active" : "paused"}">${a.status === "active" ? "Active" : escH(a.status || "—")}</span></div>
        <div class="set-item"><span class="set-ic" style="background:#ff9500">⏸️</span><div class="set-tx"><b>Switch off ads when the balance is low</b><span>Below ₦50, Revora switches off every running campaign, its ad sets and its ads. Once the balance is ₦1,000 or more, it switches back on only those. Older campaigns that were off stay off. Prepaid accounts only.</span></div><label class="switch"><input type="checkbox" ${a.auto_pause_low_balance ? "checked" : ""} onchange="bvToggleBalanceGuard('${a.id}', this.checked, this)"><span class="sw-track"></span></label></div>
        ${isAdmin ? `<div class="set-item"><span class="set-ic" style="background:#af52de">👥</span><div class="set-tx"><b>Shared with</b><span>${a.billing_mode === "managed" ? "A Revora account is paid from the wallet of the buyer it is shared with." : "The media buyer who runs this account."}</span></div><select class="acctShare" data-id="${a.id}" onchange="bvShareAccount(this)" style="max-width:170px;">${shareOpts(a.media_buyer_id)}</select></div>` : ""}
        <div class="set-item"><span class="set-ic" style="background:#8e8e93">📡</span><div class="set-tx"><b>Pixel / dataset</b><span>${a.meta_pixel_id ? escH(a.pixel_name || a.meta_pixel_id) : "No dataset yet. Create one so Meta can track your orders."}</span></div>${a.meta_pixel_id ? '<button type="button" class="btn btn-g" style="width:auto;padding:7px 14px;" onclick="bvSetSec(\'events\')">View events</button>' : `<button type="button" class="btn btn-a" style="width:auto;padding:7px 14px;" onclick="bvMakeDataset(this,'${a.id}')">Create dataset</button>`}</div>
        <div class="set-item"><span class="set-ic" style="background:#34c759">📄</span><div class="set-tx"><b>Facebook Page</b><span>${a.fb_page_id ? escH(a.fb_page_name || a.fb_page_id) + (a.whatsapp_number ? " · " + escH(a.whatsapp_number) : "") : "No Page linked yet. Ads run as a Facebook Page."}</span></div><button type="button" class="btn ${a.fb_page_id ? "btn-g" : "btn-a"}" style="width:auto;padding:7px 14px;" onclick="bvLinkPage('${a.id}')">${a.fb_page_id ? "Change" : "Link Page"}</button></div>
      </div>`).join("")}
    </div>` : ""}

    ${["owner", "admin", "buyer"].includes(window.myProfile?.role) ? '<div class="panel" data-sec="accounts" id="revoraAcctPanel"></div>' : ""}

    ${["owner", "admin", "buyer"].includes(window.myProfile?.role) ? '<div class="panel" data-sec="pages" id="pagesPanel"></div><div class="panel" data-sec="whatsapp" id="waPanel"></div>' : ""}

    <div class="panel" data-sec="help" id="helpPanel"></div>

    <div class="panel" data-sec="automation" id="notifPanel"></div>

    <div class="panel" data-sec="automation" id="emailPanel"></div>

    <div class="panel" data-sec="automation" id="securityPanel"></div>

    <div class="panel" data-sec="automation" id="killRulesPanel"></div>

    <div class="panel" data-sec="domains" id="domainsPanel"></div>
    ${["owner", "admin", "buyer"].includes(window.myProfile?.role) ? '<div class="panel" data-sec="pages" id="eventsPanel"></div>' : ""}

    ${isAdmin ? '<div class="panel" data-sec="billing" id="billingPanel"></div>' : ""}

    <div class="panel" data-sec="automation" id="aiAgentPanel"></div>

    <div class="panel" data-sec="automation">
      <div class="ph"><div class="ph-title">WhatsApp alerts</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Your number for time-sensitive alerts (low ad balance, payment confirmed, funding request updates, transfer results).</div>
      <div style="display:flex;gap:6px;">
        <input type="text" id="myWhatsappNumber" value="${escH(window.myProfile?.whatsapp_number || "")}" placeholder="e.g. 2348012345678" style="flex:1;">
        <button type="button" class="btn btn-g" id="saveWhatsappBtn" style="padding:4px 10px;font-size:10px;">Save</button>
      </div>
      <div id="whatsappMsg" style="margin-top:6px;"></div>
    </div>

    <div class="panel" data-sec="business">
      <div class="ph"><div class="ph-title">${escH(company?.name || "Your company")}</div><div class="ph-count">Your role: ${escH(window.myProfile?.role || "—")}</div></div>
      ${!isAdmin ? `<div style="font-size:11.5px;color:var(--muted);">Only an owner/admin can invite team members or manage ad account connections.</div>` : `
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:12px;">Invite a teammate -- they sign up with this link and land inside your company only, never anyone else's.</div>
      <form id="inviteForm">
        <div class="fg">
          <div class="field"><label>Role *</label>
            <select id="inv_role">
              <option value="buyer">Media buyer</option>
              <option value="customer_care">Customer care</option>
              <option value="admin">Admin</option>
              <option value="delivery_agent">Delivery agent</option>
            </select>
          </div>
          <div class="field"><label>Email *</label><input id="inv_email" type="email" required placeholder="teammate@example.com"></div>
        </div>
        <button type="submit" class="btn btn-a btn-full" style="margin-top:12px;">+ Send invite</button>
        <div id="inviteMsg"></div>
      </form>
      ${invites?.length ? `
      <div class="tbl-wrap" style="margin-top:16px;"><table>
        <tr><th>Role</th><th>For</th><th>Status</th><th>Link</th></tr>
        ${invites.map(i => {
          const used = !!i.used_at;
          const expired = !used && new Date(i.expires_at) < new Date();
          const link = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}setup-company.html?invite=${i.token}`;
          return `<tr>
            <td class="s">${escH(i.role)}</td>
            <td class="n">${escH(i.email || "—")}</td>
            <td><span class="pill ${used ? "delivered" : expired ? "cancelled" : "pending"}">${used ? "joined" : expired ? "expired" : "pending"}</span></td>
            <td>${used || expired ? "—" : `<button type="button" class="btn btn-g inviteCopyBtn" data-link="${escH(link)}" style="padding:3px 8px;font-size:10px;">Copy link</button>`}</td>
          </tr>`;
        }).join("")}
      </table></div>` : ""}
      ${teamMembers?.length ? `
      <div class="tbl-wrap" style="margin-top:16px;"><table>
        <tr><th>Team member</th><th>Role</th><th>Joined</th><th></th></tr>
        ${teamMembers.map(m => `<tr><td class="s">${escH(m.display_name || m.id.slice(0, 8))}</td><td>${escH(m.role)}</td><td>${ago(m.created_at)}</td><td>${m.id !== window.myProfile?.id && m.role !== "owner" && (m.role !== "admin" || window.myProfile?.role === "owner") ? `<button type="button" class="btn btn-g removeMemberBtn" data-id="${m.id}" data-name="${escH(m.display_name || "this person")}" data-role="${escH(m.role)}" style="padding:3px 8px;font-size:10px;">Remove</button>` : ""}</td></tr>`).join("")}
      </table></div>` : ""}`}
    </div>

    <!-- Transfer PIN: every owner, admin and buyer sets their own, so it sits outside the admin-only block -->
    ${["owner", "admin", "buyer"].includes(window.myProfile?.role) ? '<div class="panel" data-sec="security" id="pinPanel"></div>' : ""}

    ${["owner", "admin", "buyer"].includes(window.myProfile?.role) ? '<div class="panel" data-sec="security" id="pwPanel"></div>' : ""}
    ${["owner", "admin", "buyer"].includes(window.myProfile?.role) ? '<div class="panel" data-sec="aiapps" id="aiAppsPanel"></div>' : ""}

    ${isAdmin || !window.myProfile?.media_buyer_id ? "" : (() => {
      // Self-service for a buyer who isn't an admin -- they share their own
      // ad account with the platform's Business Manager directly from their
      // own Meta Business Settings, no login on this dashboard at all. They
      // just register which Business ID to watch for; RLS + the edge
      // function both confirm they can only ever touch their own row.
      const myId = window.myProfile.media_buyer_id;
      const myBuyer = (buyers || []).find(b => b.id === myId);
      return `
    <div class="panel" data-sec="accounts">
      <div id="bvBmHost"></div>
    </div>`;
    })()}

    ${!isAdmin ? "" : `
    <div class="panel" data-sec="business" id="transferNamesPanel"></div>
    <div class="panel" data-sec="business">
      <div class="ph"><div class="ph-title">Media buyers</div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:12px;">Their ROAS (Leaderboard, Ad Spend &amp; ROAS) is attributed by putting <code>[CODE]</code> in their ad set or campaign names.</div>
      <form id="buyerForm">
        <div class="fg">
          <div class="field"><label>Name *</label><input id="mb_name" required placeholder="e.g. Tunde Bakare"></div>
          <div class="field"><label>Code * (goes in ad set names as [CODE])</label><input id="mb_code" required pattern="[A-Za-z0-9_-]+" placeholder="TUNDE"></div>
        </div>
        <button type="submit" class="btn btn-a btn-full" style="margin-top:12px;">+ Add buyer</button>
        <div id="buyerMsg"></div>
      </form>
    </div>

    <div class="panel" data-sec="accounts">
      <div id="bvBmHost"></div>
    </div>`}

    ${(isAdmin || window.myProfile?.media_buyer_id) ? `
    <div class="panel" data-sec="accounts">
      <div class="ph"><div class="ph-title">Add an ad account by ID</div></div>
      <form id="acctForm">
        <div class="fg">
          <div class="field"><label>Account Name *</label><input id="a_name" required placeholder="e.g. Quality Herb - Main"></div>
          <div class="field"><label>Meta Ad Account ID *</label><input id="a_meta_id" required placeholder="act_123456789"></div>
          <div class="field"><label>Facebook Page ID *</label><input id="a_fb_id" required placeholder="1029384756"></div>
        </div>
        <button type="submit" class="btn btn-a btn-full" style="margin-top:14px;">+ Link Account</button>
        <div id="acctMsg"></div>
      </form>
    </div>

    <div class="panel" data-sec="accounts">
      <div class="ph"><div class="ph-title">Your ad accounts</div><div class="ph-count">${accountsList.length} account${accountsList.length === 1 ? "" : "s"} <button class="btn btn-g" style="padding:3px 6px;font-size:10px;margin-left:6px;" onclick="refreshBalances()" id="refreshBalBtn" title="Sync live balances from Meta">↻ Refresh balances</button></div></div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:12px;">
        The Facebook Page and Meta Pixel each ad account launches ads as/tracks Purchases through. Typing the wrong ID here fails silently until launch -- <b style="color:var(--text2);">Verify</b> asks Meta directly which pages/pixels this ad account can actually use, so you pick from confirmed options instead of guessing.
      </div>
      ${accountsList.length === 0 ? `<div class="empty"><div class="empty-ico">📡</div>No ad accounts linked yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Account</th>${isAdmin ? "<th>Buyer</th>" : ""}<th>Facebook Page</th><th>WhatsApp number</th><th>Pixel / Dataset</th><th>Balance</th><th></th></tr>
        ${accountsList.map(a => `<tr id="connRow-${a.id}">
          <td class="s n">${escH(a.nickname || a.name || "")}<div style="font-size:10.5px;color:var(--muted);font-weight:400;">${escH(a.meta_ad_account_id || "")} · <span class="pill ${a.status === "active" ? "active" : "paused"}">${escH(a.status || "")}</span></div></td>
          ${isAdmin ? `<td>${escH((buyers || []).find(b => b.id === a.media_buyer_id)?.name || "—")}</td>` : ""}
          <td id="pageCell-${a.id}">${a.fb_page_id
            ? (a.fb_page_name
                ? `✓ ${escH(a.fb_page_name)} <span style="color:var(--muted);font-size:10.5px;">(${escH(a.fb_page_id)})</span>`
                : `<span style="font-family:monospace;font-size:11.5px;">${escH(a.fb_page_id)}</span> <span style="color:var(--muted);font-size:10.5px;">(unverified)</span>`)
            : `<span style="color:var(--muted);font-size:11.5px;">not set</span>`}</td>
          <td id="waCell-${a.id}">${a.whatsapp_number ? `✓ ${escH(a.whatsapp_number)}` : `<span style="color:var(--muted);font-size:11.5px;">none saved</span>`}</td>
          <td id="pixelCell-${a.id}">${a.meta_pixel_id
            ? (a.pixel_name
                ? `✓ ${escH(a.pixel_name)} <span style="color:var(--muted);font-size:10.5px;">(${escH(a.meta_pixel_id)})</span>`
                : `<span style="font-family:monospace;font-size:11.5px;">${escH(a.meta_pixel_id)}</span> <span style="color:var(--muted);font-size:10.5px;">(unverified)</span>`)
            : `<span style="color:var(--muted);font-size:11.5px;">not set</span>`}</td>
          <td id="bal-${a.id}"><div style="font-size:12px;">${fN(a.balance_naira)}</div><div style="font-size:9px;color:var(--muted);">${a.balance_updated_at ? "synced " + ago(a.balance_updated_at) : "not synced"}</div></td>
          <td style="white-space:nowrap;"><button type="button" class="btn btn-g connVerifyBtn" data-aid="${a.id}" style="padding:4px 8px;font-size:10px;">🔄 Verify</button> <button class="btn btn-g" style="padding:4px 8px;font-size:10px;" onclick="deleteAccount('${a.id}')">Remove</button></td>
        </tr>`).join("")}
      </table></div>`}
    </div>` : ""}
    </div></div>`;
  bvSettingsWire();
  try { window.rvSettingsPolish && window.rvSettingsPolish(); } catch (e) {}
  bvUpdateAppBar();
  bvRenderSetupSlot();
  bvRenderTransferNames();
  bvRenderPinPanel();
  if (window.bvRenderAiApps) bvRenderAiApps();
document.querySelectorAll(".connVerifyBtn").forEach(btn => {
    btn.addEventListener("click", () => bvVerifyAdAccountConnection(btn.dataset.aid));
  });

window.refreshBalances = async function() {
  const btn = document.getElementById("refreshBalBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:10px;height:10px;border-width:1px;"></span>'; }
  try {
    for (const a of accountsList) {
      await sbFn("check-account-status", { ad_account_id: a.id });
    }
    await loadAccounts(); // reload the updated balance data from DB
    if (activeTab === "settings") renderSettings(document.getElementById("mainContent"));
  } catch (err) {
    alert("Error refreshing balances: " + err.message);
  }
}

// ── VERIFY PAGE/PIXEL ACTUALLY BELONG TO THIS AD ACCOUNT ────────────────────
// Typing a Page or Pixel ID that isn't really reachable from this ad account
// fails silently until an actual launch, with an opaque Meta error. This asks
// Meta directly (via verify-ad-account-connection, which calls the ad
// account's own /promote_pages and /adspixels) which pages/pixels it can
// really use, then swaps the cell's static text for a <select> of only those
// confirmed options -- so what's saved is guaranteed connected, not guessed.
// Keyed by ad_account id -- the last live verify-ad-account-connection
// response for that account, so bvSaveAdAccountConnection can pull the
// Page's real name/WhatsApp number and the pixel's real name to cache onto
// the row, without a second round trip to Meta.
window.bvVerifyResultCache = window.bvVerifyResultCache || {};

async function bvVerifyAdAccountConnection(accountId) {
  const btn = document.querySelector(`.connVerifyBtn[data-aid="${accountId}"]`);
  const pageCell = document.getElementById(`pageCell-${accountId}`);
  const pixelCell = document.getElementById(`pixelCell-${accountId}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:10px;height:10px;border-width:1px;"></span>'; }
  try {
    const r = await sbFn("verify-ad-account-connection", { ad_account_id: accountId });
    if (r.error) throw new Error(r.error);
    window.bvVerifyResultCache[accountId] = r;

    const pageOptsHtml = (val) => {
      let opts = r.pages.map(p => `<option value="${escH(p.id)}" ${val === p.id ? "selected" : ""}>${escH(p.name)} (${escH(p.id)})</option>`).join("");
      if (val && !r.pages.some(p => p.id === val)) {
        opts += `<option value="${escH(val)}" selected>⚠ ${escH(val)} (not found on this ad account)</option>`;
      }
      return `<option value="">— none —</option>` + opts;
    };
    const pixelOptsHtml = (val) => {
      let opts = r.pixels.map(p => `<option value="${escH(p.id)}" ${val === p.id ? "selected" : ""}>${escH(p.name)} (${escH(p.id)})</option>`).join("");
      if (val && !r.pixels.some(p => p.id === val)) {
        opts += `<option value="${escH(val)}" selected>⚠ ${escH(val)} (not found on this ad account)</option>`;
      }
      return `<option value="">— none —</option>` + opts;
    };

    pageCell.innerHTML = `<select id="pageSel-${accountId}" style="width:100%;font-size:11.5px;">${pageOptsHtml(r.current_fb_page_id)}</select>`;
    pixelCell.innerHTML = `<select id="pixelSel-${accountId}" style="width:100%;font-size:11.5px;">${pixelOptsHtml(r.current_pixel_id)}</select>`;

    if (btn) {
      btn.disabled = false;
      btn.className = "btn btn-a connVerifyBtn";
      btn.textContent = "💾 Save";
      btn.onclick = () => bvSaveAdAccountConnection(accountId);
    }
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = "🔄 Verify"; }
    alert("Couldn't verify this ad account's pages/pixels: " + err.message);
  }
}

async function bvSaveAdAccountConnection(accountId) {
  const btn = document.querySelector(`.connVerifyBtn[data-aid="${accountId}"]`);
  const pageVal = document.getElementById(`pageSel-${accountId}`)?.value || null;
  const pixelVal = document.getElementById(`pixelSel-${accountId}`)?.value || null;
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    // Cache the Page's real name + connected WhatsApp number (and the
    // pixel's name) from the last verify response, so the campaign builder
    // can read them straight off this row instead of calling Meta live
    // every time it opens.
    const cached = window.bvVerifyResultCache[accountId];
    const page = cached?.pages?.find(p => p.id === pageVal);
    const pixel = cached?.pixels?.find(p => p.id === pixelVal);
    const { error } = await supabaseClient.from("ad_accounts").update({
      fb_page_id: pageVal,
      meta_pixel_id: pixelVal,
      fb_page_name: page?.name || null,
      whatsapp_number: page?.whatsapp_number || null,
      pixel_name: pixel?.name || null,
      connection_verified_at: new Date().toISOString(),
    }).eq("id", accountId);
    if (error) throw error;
    await loadAccounts();
    renderSettings(document.getElementById("mainContent"));
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = "💾 Save"; }
    alert("Couldn't save: " + err.message);
  }
}

  document.getElementById("saveWhatsappBtn")?.addEventListener("click", async (e) => {
    const btn = e.target;
    const msg = document.getElementById("whatsappMsg");
    const number = document.getElementById("myWhatsappNumber").value.trim();
    btn.disabled = true; btn.textContent = "Saving…";
    const { error } = await supabaseClient.from("profiles").update({ whatsapp_number: number || null }).eq("id", sessionData.user.id);
    btn.disabled = false; btn.textContent = "Save";
    if (error) { msg.innerHTML = `<div class="msg err">❌ ${escH(error.message)}</div>`; return; }
    window.myProfile.whatsapp_number = number || null;
    msg.innerHTML = `<div class="msg ok">✅ Saved.</div>`;
  });

  // "Media buyers & Meta connections" and "Link New Meta Ad Account" are both
  // admin-only panels -- these forms simply aren't in the DOM for a buyer/
  // delivery_agent, so every handler below is guarded rather than assumed present.
  bvRevoraAcctPanel();
  bvEventsPanel();
  document.querySelectorAll(".removeMemberBtn").forEach(btn => btn.addEventListener("click", async () => {
    const warn = btn.dataset.role === "buyer" ? "They are signed out everywhere, lose access, their AI apps are disconnected, auto-approve is switched off and any waiting funding request from them is declined. Their orders, ROAS and receipts stay with your company." : "They are signed out everywhere and lose access to your company. Their past work stays.";
    if (!confirm(`Remove ${btn.dataset.name} from your company?\n\n${warn}\n\nYou can invite them again later.`)) return;
    btn.disabled = true; btn.textContent = "Removing…";
    try {
      const r = await sbFn("remove-team-member", { user_id: btn.dataset.id });
      if (r.error) throw new Error(r.error);
      bvToast(`${r.name || "They"} removed` + (r.pending_requests_declined ? `, ${r.pending_requests_declined} waiting request(s) declined` : ""));
      renderSettings ? renderSettings(el) : location.reload();
    } catch (err) { alert(err.message); btn.disabled = false; btn.textContent = "Remove"; }
  }));
  document.getElementById("inviteForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("inviteMsg");
    const role = document.getElementById("inv_role").value;
    const email = document.getElementById("inv_email").value.trim();
    if (!email) { msg.innerHTML = `<div class="msg err">❌ Email is required.</div>`; return; }
    const token = crypto.randomUUID().replace(/-/g, "");
    const { error } = await supabaseClient.from("company_invites").insert({ role, email, token });
    if (error) { msg.innerHTML = `<div class="msg err">❌ Could not create invite: ${error.message}</div>`; return; }
    const link = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}setup-company.html?invite=${token}`;
    msg.innerHTML = `<div class="msg ok">Sending email...</div>`;
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const sendRes = await sbFn("send-company-invite", { access_token: session.access_token, token, email });
      msg.innerHTML = `<div class="msg ok">✅ Invite emailed to ${escH(email)}. <button type="button" class="btn btn-g" style="padding:3px 8px;font-size:10px;" onclick="navigator.clipboard.writeText('${link}')">Copy link too</button></div>`;
    } catch (sendErr) {
      msg.innerHTML = `<div class="msg err">⚠️ Invite created but the email couldn't be sent (${escH(sendErr.message || "unknown error")}). <button type="button" class="btn btn-g" style="padding:3px 8px;font-size:10px;" onclick="navigator.clipboard.writeText('${link}')">Copy link instead</button></div>`;
    }
    renderSettings(el);
  });

  document.querySelectorAll(".inviteCopyBtn").forEach(btn => btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.link);
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy link"; }, 1500);
    } catch { btn.textContent = btn.dataset.link; }
  }));

  document.getElementById("buyerForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("buyerMsg");
    const name = document.getElementById("mb_name").value.trim();
    const code = document.getElementById("mb_code").value.trim().toUpperCase();
    const { error } = await supabaseClient.from("media_buyers").insert({ name, code });
    if (error) { msg.innerHTML = `<div class="msg err">❌ Could not add buyer: ${error.message}</div>`; return; }
    // Attribute the buyer's already-running ad sets and their orders.
    const { error: bfErr } = await supabaseClient.rpc("backfill_media_buyers");
    if (bfErr) console.error("backfill_media_buyers:", bfErr);
    renderSettings(el);
  });

  document.getElementById("acctForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("acctMsg");
    try {
      // A non-admin buyer's ad_accounts RLS policy requires every row they
      // can see to trace back to their own media_buyer_id -- a manual add
      // with that set works the same way partner-synced accounts do.
      const myBuyerId = !isAdmin ? (window.myProfile?.media_buyer_id ?? null) : null;
      const acctName = document.getElementById("a_name").value;
      // meta_ad_account_id has shown up stored both with and without the "act_"
      // prefix -- confirmed this exact mismatch has silently created duplicate
      // rows for the same real Meta account three separate times this session
      // (re-adding/refreshing an account you already have, just typed slightly
      // differently, looked like a fresh add). Always store it normalized, and
      // check for an existing match (either format) before inserting at all.
      const rawId = document.getElementById("a_meta_id").value.trim();
      // Meta's own Business Settings page shows ad account IDs as e.g.
      // "ID: 643541631210844" -- pasting that straight in (confirmed this
      // actually happened live) left the literal "ID: " text baked into
      // meta_ad_account_id, silently breaking every Graph API call built
      // from it (act_ID: 643541631210844 isn't a real endpoint). The id is
      // always purely numeric, so strip everything else instead of just
      // the "act_" prefix.
      const digitsOnly = rawId.replace(/^act_/, "").match(/\d+/)?.[0] || "";
      const normalizedId = digitsOnly || rawId.replace(/^act_/, "");
      const existing = accountsList.find(a => (a.meta_ad_account_id || "").trim().replace(/^act_/, "") === normalizedId);
      const fbPageId = document.getElementById("a_fb_id").value.trim();

      let accountId;
      if (existing) {
        const { error } = await supabaseClient.from('ad_accounts').update({
          name: acctName,
          nickname: acctName,
          fb_page_id: fbPageId,
          status: 'active',
        }).eq('id', existing.id);
        if (error) throw error;
        accountId = existing.id;
        msg.innerHTML = `<div class="msg ok">✅ This account was already linked (as "${existing.nickname}") -- updated it instead of adding a duplicate.</div>`;
      } else {
        const { data, error } = await supabaseClient.from('ad_accounts').insert({
          user_id: sessionData.user.id,
          media_buyer_id: myBuyerId,
          name: acctName,
          nickname: acctName,
          meta_ad_account_id: normalizedId,
          fb_page_id: fbPageId,
          status: 'active'
        }).select();
        if (error) throw error;
        accountId = data[0].id;
        msg.innerHTML = `<div class="msg ok">✅ Ad Account linked successfully.</div>`;
      }

      await loadAccounts(); // Refresh the dropdown
      if (!activeAccountId) activeAccountId = accountId; // Set as active if it was the first

      setTimeout(render, 800);
    } catch(err) {
      msg.innerHTML = `<div class="msg err">❌ ${err.message}</div>`;
    }
  });

  document.querySelectorAll(".waRemoveBtn").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Remove this WhatsApp number? Past conversations stay, but new messages on it won't show up anywhere.")) return;
    const r = await sbFn("manage-whatsapp-numbers", { action: "remove", media_buyer_id: btn.dataset.buyer, access_token: sessionData.access_token, id: btn.dataset.id });
    if (r.error) { alert("Could not remove: " + r.error); return; }
    renderSettings(el);
  }));

  bvBmMount(document.getElementById("bvBmHost"), {});
  // Self-service buyer: save their own Business ID, or check its status.
  document.getElementById("savePartnerBizBtn")?.addEventListener("click", (e) => {
    bvSavePartnerBizId(window.myProfile.media_buyer_id, document.getElementById("myPartnerBizId").value.trim(), e.target);
  });
  document.getElementById("checkPartnerStatusBtn")?.addEventListener("click", (e) => bvCheckMyPartnerStatus(e.target, true));

  // Admin: save a Business ID on behalf of a specific buyer in the table.
  document.querySelectorAll(".savePartnerBizBtn").forEach(btn => btn.addEventListener("click", () => {
    const input = document.querySelector(`.buyerBizIdInput[data-id="${btn.dataset.id}"]`);
    bvSavePartnerBizId(btn.dataset.id, input.value.trim(), btn);
  }));

  // Auto-check on page load instead of requiring a manual click every time
  // -- a buyer shouldn't have to remember to come back and press a button
  // after sharing on Meta's side. Silent (no toast) so loading Settings
  // doesn't feel noisy; the background cron (sync_all) also covers this
  // even when nobody opens the dashboard at all.
  if (!isAdmin && document.getElementById("checkPartnerStatusBtn") && !document.getElementById("checkPartnerStatusBtn").disabled) {
    bvCheckMyPartnerStatus(document.getElementById("checkPartnerStatusBtn"), false);
  }
  if (isAdmin && document.getElementById("syncPartnerBtn") && (buyers || []).some(b => b.meta_partner_business_id)) {
    bvSyncPartnerAccounts(false);
  }
}

/* ---------- Business Managers: link several by ID and see every ad account each one shared ---------- */
async function bvBmMount(host, opts) {
  if (!host) return;
  opts = opts || {};
  if (!document.getElementById("bvBmCss")) {
    const st = document.createElement("style"); st.id = "bvBmCss";
    st.textContent =
      ".bm-top{display:flex;align-items:center;gap:10px;margin-bottom:12px}.bm-top h4{margin:0;font-size:15px}.bm-top .sp{flex:1}.bm-count{font-size:11.5px;color:var(--muted);background:var(--panel2,#f2f4f7);border-radius:99px;padding:2px 9px}" +
      ".bm-how{border:1px solid var(--border,#e4e7ec);border-radius:10px;margin-bottom:10px;font-size:12.5px;color:var(--muted)}.bm-how summary{cursor:pointer;padding:9px 12px;font-weight:600;color:inherit;list-style:none}.bm-how summary::-webkit-details-marker{display:none}.bm-how summary:after{content:'+';float:right}.bm-how[open] summary:after{content:'–'}" +
      ".bm-how ol{margin:0;padding:0 12px 12px 30px;line-height:1.6}.bm-how code{background:var(--panel2,#f2f4f7);padding:1px 6px;border-radius:5px;color:inherit}.bm-how button{margin-left:6px}" +
      ".bm-form{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px 12px}.bm-form input,.bm-form select{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:8px;border:1px solid var(--border,#d0d5dd);background:var(--panel,#fff);color:inherit;font:inherit;min-width:0}.bm-form .full{grid-column:1/-1}" +
      ".bm-card{border:1px solid var(--border,#e4e7ec);border-radius:12px;margin-bottom:10px;overflow:hidden;background:var(--panel,transparent)}.bm-h{display:flex;gap:10px;align-items:center;padding:11px 12px}.bm-ico{width:34px;height:34px;border-radius:9px;background:#eaf2ff;color:#1877F2;display:grid;place-items:center;font-weight:700;font-size:13px;flex:none}" +
      ".bm-h .t{flex:1;min-width:0}.bm-h .t b{display:block;font-size:13.5px}.bm-h .t small{color:var(--muted);font-size:11.5px}.bm-link{background:none;border:0;color:var(--muted);font-size:12px;cursor:pointer;padding:4px 6px}.bm-link:hover{color:#c0261d}" +
      ".bm-acc{display:flex;gap:8px;align-items:center;padding:9px 12px;border-top:1px solid var(--border,#eef0f3)}.bm-acc .n{flex:1;min-width:0}.bm-acc .n b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bm-acc .n small{color:var(--muted);font-size:11.5px}" +
      ".bm-chip{font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--panel2,#f2f4f7);color:var(--muted);white-space:nowrap}.bm-chip.ok{background:#e8f7f0;color:#12805c}.bm-chip.warn{background:#fff3e6;color:#b54708}" +
      ".bm-empty{font-size:12.5px;color:var(--muted);padding:10px 12px;border-top:1px solid var(--border,#eef0f3)}.bm-msg{font-size:12.5px;margin:0 0 8px}.bm-msg.err{color:#c0261d}.bm-msg.ok{color:#12805c}" +
      "@media(max-width:560px){.bm-form{grid-template-columns:1fr}}";
    document.head.appendChild(st);
  }
  const isAdmin = ["owner", "admin"].includes(window.myProfile?.role);
  host.innerHTML = '<div class="bm-empty" style="border:0">Loading…</div>';
  let data;
  try { data = await sbFn("sync-partner-accounts", { access_token: sessionData.access_token, mode: "list" }); }
  catch (e) { host.innerHTML = `<div class="bm-msg err">Could not load: ${escH(e.message)}</div>`; return; }
  const buyers = isAdmin ? ((await sbQuery("media_buyers", "select=id,name,code&order=code.asc").catch(() => [])) || []) : [];
  const biz = data.platform_business_id || "", items = data.items || [];
  const ago = (d) => { if (!d) return "not checked yet"; const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
  const acc = (a) => `<div class="bm-acc"><div class="n"><b>${escH(a.name || "Ad account")}</b><small>${escH(a.account_id)}${a.assigned_to ? " · " + escH(a.assigned_to) : ""}</small></div><span class="bm-chip ${a.status === "Active" ? "ok" : "warn"}">${escH(a.status)}</span>${a.imported ? "" : '<span class="bm-chip warn">Not imported</span>'}</div>`;
  const cards = items.map(it => `<div class="bm-card"><div class="bm-h"><div class="bm-ico">BM</div><div class="t"><b>Business ${escH(it.business_id)}</b><small>${it.buyer ? escH(it.buyer) + " · " : ""}${it.accounts.length} ad account${it.accounts.length === 1 ? "" : "s"} · checked ${ago(it.last_synced_at)}</small></div><button type="button" class="bm-link bm-rm" data-id="${it.id}">Unlink</button></div>${it.accounts.length ? it.accounts.map(acc).join("") : '<div class="bm-empty">Nothing shared from this Business yet.</div>'}</div>`).join("");
  host.innerHTML = `
    <div class="bm-top"><h4>Business Managers</h4><span class="bm-count">${items.length}</span><div class="sp"></div>${items.length ? '<button type="button" class="btn btn-g bm-sync" style="padding:5px 10px;font-size:11.5px;">Check for new accounts</button>' : ""}</div>
    <div class="bm-msg"></div>
    ${cards}
    <details class="bm-how" ${items.length ? "" : "open"}>
      <summary>Link a Business Manager</summary>
      <ol>
        <li>In Meta Business Settings → Accounts → Ad accounts, tap <i>Add partner</i> and paste Revora's Business ID <code>${escH(biz || "unavailable")}</code>${biz ? '<button type="button" class="btn btn-g bm-cp" style="padding:2px 8px;font-size:11px;">Copy</button>' : ""} with <i>Manage ad account</i>.</li>
        <li>Enter your Business ID and one ad account you shared. Every other account from that Business comes in on its own.</li>
      </ol>
      <div class="bm-form">
        <input class="bm-biz" inputmode="numeric" placeholder="Your Business ID">
        <input class="bm-acct" inputmode="numeric" placeholder="One shared ad account ID">
        ${isAdmin && buyers.length ? `<select class="bm-buyer full">${buyers.map(b => `<option value="${b.id}" ${b.id === opts.buyerId ? "selected" : ""}>For ${escH(b.name)} [${escH(b.code)}]</option>`).join("")}</select>` : ""}
        <button type="button" class="btn btn-a bm-add full">Link Business</button>
      </div>
    </details>`;
  const msg = (t, cls) => { const m = host.querySelector(".bm-msg"); m.className = "bm-msg " + (cls || ""); m.textContent = t; };
  host.querySelector(".bm-cp")?.addEventListener("click", () => { navigator.clipboard?.writeText(biz); bvToast("Copied"); });
  host.querySelector(".bm-add").addEventListener("click", async (e) => {
    const b = e.currentTarget, v = host.querySelector(".bm-biz").value.trim(), p = host.querySelector(".bm-acct").value.trim();
    if (!v || !p) { msg("Enter your Business ID and one shared ad account ID.", "err"); return; }
    b.disabled = true; b.textContent = "Linking…"; msg("");
    try {
      const r = await sbFn("sync-partner-accounts", { access_token: sessionData.access_token, mode: "register", business_id: v, proof_account_id: p, media_buyer_id: host.querySelector(".bm-buyer")?.value || opts.buyerId || undefined });
      bvToast(`Linked. ${r.imported || 0} ad account${r.imported === 1 ? "" : "s"} imported.`);
      try { if (typeof loadAccounts === "function") await loadAccounts(); } catch {}
      await bvBmMount(host, opts);
    } catch (err) { msg(err.message, "err"); b.disabled = false; b.textContent = "Link Business"; }
  });
  host.querySelector(".bm-sync")?.addEventListener("click", async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "Checking…";
    try {
      const r = await sbFn("sync-partner-accounts", { access_token: sessionData.access_token, mode: "sync" });
      const n = (r.results || []).reduce((a, x) => a + (x.imported || 0), 0);
      bvToast(n ? `${n} new ad account${n === 1 ? "" : "s"} imported` : "Nothing new to import");
      try { if (n && typeof loadAccounts === "function") await loadAccounts(); } catch {}
      await bvBmMount(host, opts);
    } catch (err) { msg(err.message, "err"); b.disabled = false; b.textContent = "Check for new accounts"; }
  });
  host.querySelectorAll(".bm-rm").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Unlink this Business? Ad accounts already imported stay in Revora.")) return;
    try { await sbFn("sync-partner-accounts", { access_token: sessionData.access_token, mode: "remove", link_id: btn.dataset.id }); await bvBmMount(host, opts); } catch (err) { msg(err.message, "err"); }
  }));
}

async function bvCheckMyPartnerStatus(btn, announce) {
  const result = document.getElementById("partnerStatusResult");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Checking…';
  try {
    const r = await sbFn("sync-partner-accounts", { access_token: sessionData.access_token, mode: "sync" });
    const mine = r.results?.[0];
    if (!mine) {
      result.innerHTML = `<div style="color:var(--muted);font-size:11.5px;">Save your Business ID above first.</div>`;
    } else if (mine.status === "confirmed") {
      result.innerHTML = `<div class="msg ok">✅ Confirmed -- ${mine.imported} account(s) imported.</div>`;
      if (announce || mine.imported) bvToast(`${mine.imported} account(s) imported`);
    } else {
      result.innerHTML = `<div class="msg">⏳ Not confirmed yet -- make sure you've shared your ad account and the admin has approved the request in their Meta Business Settings.</div>`;
      if (announce) bvToast("Still pending approval", "err");
    }
  } catch (err) {
    if (announce) { result.innerHTML = `<div class="msg err">❌ ${err.message}</div>`; bvToast(err.message, "err"); }
  } finally {
    btn.disabled = false; btn.textContent = "Check status";
  }
}

window.deleteAccount = async function(id) {
  if(!confirm("Are you sure you want to remove this Ad Account? All associated metrics will remain but won't be updated.")) return;
  try {
    const { error } = await supabaseClient.from('ad_accounts').delete().eq('id', id);
    if(error) throw error;
    if(activeAccountId === id) activeAccountId = null; // Clear if we deleted the active one
    await loadAccounts();
    render();
  } catch(e) {
    alert("Error deleting account: " + e.message);
  }
}

// Checks every registered buyer in the company against the platform's one
// global Business ID, auto-imports anything confirmed, reports status per
// buyer. Never fetches or shows a raw "everyone who's shared with us" list
// -- that would leak one company's pending buyer requests to another
// company's admin, since the Business ID and token are shared platform-wide.
window.bvSyncPartnerAccounts = async function() {
  const btn = document.getElementById("syncPartnerBtn");
  const result = document.getElementById("partnerSyncResult");
  btn.disabled = true; btn.textContent = "Syncing…";
  result.innerHTML = `<div class="msg"><span class="spin" style="width:10px;height:10px;border-width:1px;"></span> Checking…</div>`;
  try {
    const r = await sbFn("sync-partner-accounts", { access_token: sessionData.access_token, mode: "sync" });
    if (!r.results?.length) {
      result.innerHTML = `<div style="color:var(--muted);font-size:11.5px;">No buyers have a Business ID registered yet.</div>`;
    } else {
      result.innerHTML = `<div class="tbl-wrap"><table>
        <tr><th>Buyer</th><th>Status</th></tr>
        ${r.results.map(x => `<tr>
          <td class="s n">${escH(x.media_buyer)}</td>
          <td>${x.status === "confirmed" ? `<span class="pill active">✅ confirmed -- ${x.imported} account(s) imported</span>` : `<span class="pill paused">⏳ waiting on your approval in Meta Business Settings</span>`}</td>
        </tr>`).join("")}
      </table></div>`;
    }
    await loadAccounts();
  } catch (err) {
    result.innerHTML = `<div class="msg err">❌ ${err.message}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = "↻ Sync all";
  }
};

// Saves which Meta Business ID to watch for a given buyer -- admin can do
// this for any buyer in their company; a non-admin buyer can only save
// their own (also enforced server-side).
async function bvSavePartnerBizId(mediaBuyerId, value, btn) {
  if (!value) { bvToast("Enter a Business ID first.", "err"); return; }
  const original = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Saving…';
  try {
    await sbFn("sync-partner-accounts", { access_token: sessionData.access_token, mode: "register", business_id: value, media_buyer_id: mediaBuyerId });
    bvToast("Business ID saved");
    renderSettings(document.getElementById("mainContent"));
  } catch (err) {
    bvToast("Could not save: " + err.message, "err");
    btn.disabled = false; btn.textContent = original;
  }
}
async function bvToggleBalanceGuard(id, on, el) {
  const r = await sbFn("ads-manager", { action: "set_balance_guard", ad_account_id: id, enabled: on === true });
  if (r?.error || r?.ok === false) { if (el) el.checked = !on; bvToast("Couldn't save: " + (r.error || "unknown"), "err"); return; }
  const a = (accountsList || []).find((x) => x.id === id); if (a) a.auto_pause_low_balance = on;
  bvToast(on ? "On: campaigns switch off when the balance is below ₦50 and back on at ₦1,000." : "Off: Revora will not switch your campaigns off for a low balance.");
}
