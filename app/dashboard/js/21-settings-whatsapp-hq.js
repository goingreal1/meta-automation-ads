// Revora dashboard, part 21 of 23: Settings → WhatsApp: numbers hosted on Revora's own WhatsApp Business account (no Facebook login needed) · REVORA HQ: platform-admin view across every company (hq-admin) · HQ → Social: post to Revora's own Facebook Page and Instagram (social-admin). Captions are always written by a person.


// ── CONNECT WITH FACEBOOK / WHATSAPP SIGN-UP ─────────────────────────────────
// The simple way in: log in with Facebook once and we can see the ad accounts, pages and
// WhatsApp numbers they chose to share (no Business ID to type). The Business ID share below
// stays as the fallback for people who would rather not log in.

// ── Settings → WhatsApp: numbers hosted on Revora's own WhatsApp Business account (no Facebook login needed) ──
// Link a Page by its ID: it must be shared with Revora's Business Manager and usable by the ad account.
function bvRenderPagesPanel() {
  const el = document.getElementById("pagesPanel"); if (!el) return;
  const list = accountsList || [];
  el.innerHTML = `
    <div class="ph"><div class="ph-title">Facebook Pages</div></div>
    <div style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">Your ads run as a Facebook Page. Share the Page with Revora in Meta Business Settings (Pages → Add partner, with permission to create ads), then paste its Page ID here and we link it to the ad account.</div>
    ${list.length ? `<div class="set-card">${list.map(a => `<div class="set-item"><span class="set-ic" style="background:#1877F2">📄</span><div class="set-tx"><b>${escH(a.nickname || a.name || "Ad account")}</b><span>${a.fb_page_id ? "✓ " + escH(a.fb_page_name || "Page") + " (" + escH(a.fb_page_id) + ")" : "No Page linked yet"}</span></div><button type="button" class="btn ${a.fb_page_id ? "btn-g" : "btn-a"}" style="width:auto;padding:7px 14px;" onclick="bvLinkPage('${a.id}')">${a.fb_page_id ? "Change" : "Link Page"}</button></div>`).join("")}</div>` : `<div style="font-size:12.5px;color:var(--muted);">Add an ad account first (Ad accounts tab).</div>`}`;
}

function bvLinkPage(accountId) {
  bvModal("Link your Facebook Page", `
    <div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:10px;">
      <b style="color:var(--text);">Step 1 — Share the Page with Revora</b><br>
      Meta Business Settings → Accounts → Pages → pick your Page → <b>Add partner</b>.<br>
      Enter Revora's Business ID: <b id="lpBiz" style="color:var(--text);user-select:all;">loading…</b> <a href="#" id="lpCopy">Copy</a><br>
      Turn on the permission to <b>create ads</b> (shown as Advertise / Create ads) and save.<br><br>
      <b style="color:var(--text);">Step 2 — Paste the Page ID</b><br>
      Find it on your Page → About → Page transparency.
    </div>
    <div class="field"><label>Page ID</label><input id="lpId" inputmode="numeric" placeholder="e.g. 105123456789012"></div>
    <div id="lpMsg" class="msg err" style="display:none;"></div>
    <button type="button" class="btn btn-a" id="lpGo">Check &amp; link</button>`);
  sbFn("sync-partner-accounts", { access_token: sessionData.access_token, mode: "get_business_id" }).then(r => {
    const id = r?.business_id || "";
    const el = document.getElementById("lpBiz"); if (el) el.textContent = id || "ask Revora support";
    const cp = document.getElementById("lpCopy");
    if (cp) cp.onclick = e => { e.preventDefault(); if (id) { navigator.clipboard?.writeText(id); bvToast("Business ID copied"); } };
  }).catch(() => { const el = document.getElementById("lpBiz"); if (el) el.textContent = "ask Revora support"; });
  document.getElementById("lpGo").onclick = async () => {
    const b = document.getElementById("lpGo"), m = document.getElementById("lpMsg");
    b.disabled = true; b.textContent = "Checking…"; m.style.display = "none";
    try {
      const r = await sbFn("link-page", { ad_account_id: accountId, page_id: document.getElementById("lpId").value });
      if (r.status === "linked") { bvCloseModal(); bvToast(`Linked ${r.page_name || "Page"}`); await loadAccounts(); if (activeTab === "settings") render(); return; }
      m.textContent = r.error || "Could not link that Page."; m.style.display = "block";
    } finally { b.disabled = false; b.textContent = "Check & link"; }
  };
}


// Change password: Supabase checks the current password first, then sets the new one.
function bvRenderPwPanel() {
  const el = document.getElementById("pwPanel"); if (!el) return;
  el.innerHTML = `<div class="ph"><div class="ph-title">Change password</div></div>
    <div style="display:grid;gap:8px;max-width:360px;">
      <input type="password" id="pwOld" class="cat-in" placeholder="Current password" autocomplete="current-password">
      <input type="password" id="pwNew" class="cat-in" placeholder="New password (8+ characters)" autocomplete="new-password">
      <input type="password" id="pwNew2" class="cat-in" placeholder="Repeat new password" autocomplete="new-password">
      <button class="btn btn-a" id="pwSave" type="button">Update password</button>
      <div style="font-size:12px;color:var(--text2);">Forgot it? Log out and use “Forgot password” on the login page.</div>
    </div>`;
  document.getElementById("pwSave").onclick = async () => {
    const o = document.getElementById("pwOld").value, n = document.getElementById("pwNew").value, n2 = document.getElementById("pwNew2").value;
    if (!o) return bvToast("Enter your current password.", "err");
    if (n.length < 8) return bvToast("The new password needs at least 8 characters.", "err");
    if (n !== n2) return bvToast("The two new passwords don't match.", "err");
    if (n === o) return bvToast("Choose a password different from the current one.", "err");
    const btn = document.getElementById("pwSave"); btn.disabled = true;
    try {
      const { data: u } = await supabaseClient.auth.getUser();
      const email = u?.user?.email; if (!email) throw new Error("Please log in again first.");
      const chk = await supabaseClient.auth.signInWithPassword({ email, password: o });
      if (chk.error) throw new Error("Your current password is not correct.");
      const up = await supabaseClient.auth.updateUser({ password: n });
      if (up.error) throw new Error(up.error.message);
      ["pwOld", "pwNew", "pwNew2"].forEach(id => document.getElementById(id).value = "");
      bvToast("Password updated.");
    } catch (e) { bvToast(e.message || "Couldn't update the password.", "err"); }
    btn.disabled = false;
  };
}

async function bvRenderHelpPanel() {
  const el = document.getElementById("helpPanel"); if (!el) return;
  const [cfg, inf] = await Promise.all([
    sbFn("support-ticket", { action: "config" }).catch(() => ({})),
    sbFn("support-chat", { action: "info" }).catch(() => ({})),
  ]);
  const wa = cfg?.whatsapp ? `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent("Hi Revora, I need help with my account.")}` : "";
  el.innerHTML = `
    <div class="ph"><div class="ph-title">Help &amp; support</div></div>
    <div style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">Stuck on a Page, ad account, wallet or WhatsApp number? Chat with the Revora team here any time. You can start a chat whenever you like and reply later.</div>
    <div class="set-card">
      <div class="set-item"><span class="set-ic" style="background:#007aff">🛟</span><div class="set-tx"><b>${inf?.staff ? "Customer support inbox" : "Support chat"}</b><span>${inf?.unread ? inf.unread + " new" : "Messages are saved, so you can come back to them"}</span></div><button type="button" class="btn btn-a" style="width:auto;padding:7px 14px;" onclick="bvSupportChat()">Open</button></div>
      ${wa ? `<div class="set-item"><span class="set-ic" style="background:#25D366">💬</span><div class="set-tx"><b>Chat with us on WhatsApp</b><span>Another way to reach the team</span></div><a class="btn btn-g" style="width:auto;padding:7px 14px;text-decoration:none;" href="${wa}" target="_blank" rel="noopener">Open WhatsApp</a></div>` : ""}
    </div>`;
}

// In-app support chat: saved threads between a customer company and the Revora team. Staff see an inbox of all customers.
let bvSupportTimer = null;
async function bvSupportChat(companyId, label) {
  clearInterval(bvSupportTimer);
  const inf = await sbFn("support-chat", { action: "info" }).catch(() => ({}));
  const staff = !!inf.staff;
  bvModal(staff && !companyId ? "Support inbox" : (label || "Support chat"), `<div id="spBody" style="min-height:260px;max-height:62vh;display:flex;flex-direction:column;"></div>`);
  const ov = document.getElementById("bvModalOverlay");
  const box = ov?.querySelector(".bv-modal"); if (box) box.style.maxWidth = "520px";
  const body = document.getElementById("spBody");
  const stop = () => { if (!document.getElementById("spBody")) clearInterval(bvSupportTimer); };
  if (staff && !companyId) {
    const load = async () => {
      const r = await sbFn("support-chat", { action: "threads" });
      if (!document.getElementById("spBody")) return stop();
      const t = r.threads || [];
      body.innerHTML = t.length ? `<div class="set-card" style="overflow:auto;">${t.map(x => `<div class="set-item" style="cursor:pointer;" onclick="bvSupportChat('${x.company_id}', '${escH(x.company_name).replace(/'/g, "")}')"><div class="set-tx"><b>${escH(x.company_name)}${x.unread_staff ? ` <span class="set-warn">${x.unread_staff} new</span>` : ""}</b><span>${escH(x.last_text || "")}</span></div><span style="font-size:10.5px;color:var(--muted);">${ago(x.last_message_at)}</span></div>`).join("")}</div>` : `<div class="empty">No support chats yet</div>`;
    };
    await load(); bvSupportTimer = setInterval(load, 8000); return;
  }
  body.innerHTML = `<div id="spMsgs" style="flex:1;overflow:auto;padding:4px 2px;min-height:200px;"></div>
    <div style="display:flex;gap:6px;margin-top:8px;"><input id="spIn" placeholder="Type a message…" style="flex:1;" maxlength="4000"><button type="button" class="btn btn-a" id="spSend" style="width:auto;padding:7px 14px;">Send</button></div>
    <div id="spErr" class="msg err" style="display:none;margin-top:6px;"></div>`;
  let lastKey = "";
  const load = async () => {
    const r = await sbFn("support-chat", { action: "messages", company_id: companyId });
    const box = document.getElementById("spMsgs"); if (!box) return stop();
    const m = r.messages || [], key = m.length + ":" + (m[m.length - 1]?.id || "");
    if (key === lastKey) return; lastKey = key;
    const mine = x => staff ? x.sender === "staff" : x.sender === "customer";
    box.innerHTML = m.length ? m.map(x => `<div style="display:flex;justify-content:${mine(x) ? "flex-end" : "flex-start"};margin:5px 0;"><div style="max-width:80%;padding:7px 11px;border-radius:12px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;background:${mine(x) ? "var(--accent)" : "var(--surface2, #eee)"};color:${mine(x) ? "#fff" : "inherit"};">${escH(x.body)}<div style="font-size:10px;opacity:.7;margin-top:2px;">${escH(x.sender_name || (x.sender === "staff" ? "Revora" : ""))} · ${ago(x.created_at)}</div></div></div>`).join("") : `<div class="empty">Say hello — ${staff ? "no messages yet" : "we reply as soon as we can"}</div>`;
    box.scrollTop = box.scrollHeight;
  };
  const send = async () => {
    const inp = document.getElementById("spIn"), er = document.getElementById("spErr");
    const text = inp.value.trim(); if (!text) return;
    er.style.display = "none"; inp.disabled = true;
    const r = await sbFn("support-chat", { action: "send", company_id: companyId, text });
    inp.disabled = false;
    if (r.error) { er.textContent = r.error; er.style.display = "block"; return; }
    inp.value = ""; inp.focus(); lastKey = ""; load();
  };
  document.getElementById("spSend").onclick = send;
  document.getElementById("spIn").onkeydown = e => { if (e.key === "Enter") send(); };
  await load(); bvSupportTimer = setInterval(load, 6000);
}

// ── REVORA HQ: platform-admin view across every company (hq-admin) ───────────
let bvHqSec = "overview";
async function bvHqProbe() {
  try {
    const r = await sbFn("hq-admin", { action: "overview" });
    if (r && !r.error) {
      const t = document.querySelector('[data-tab="hq"]');
      t?.style.removeProperty("display");
      if (t && location.hostname.startsWith("hq.") && activeTab !== "hq") t.click();
    }
  } catch {}
}
async function renderHq(el) {
  const secs = [["overview", "Overview"], ["companies", "Companies & people"], ["accounts", "Ad accounts"], ["pixels", "Pixels"], ["money", "Money"], ["fees", "Fees & revenue"], ["social", "Social"], ["support", "Support"]];
  el.innerHTML = `<div class="sh"><div class="sh-title">Revora HQ</div></div>
    <div class="set-wrap"><nav class="set-nav" id="hqNav">${secs.map(([id, l]) => `<button type="button" class="set-nav-btn ${id === bvHqSec ? "active" : ""}" data-s="${id}">${l}</button>`).join("")}</nav>
    <div class="set-body" style="display:block" id="hqBody"></div></div>`;
  el.querySelectorAll("#hqNav .set-nav-btn").forEach(b => b.onclick = () => { bvHqSec = b.dataset.s; renderHq(el); });
  const body = document.getElementById("hqBody");
  body.innerHTML = `<div class="empty"><div class="spin" style="width:18px;height:18px;border-width:2px;"></div></div>`;
  const kc = (l, v, sub) => `<div class="kc"><div class="kc-lbl">${l}</div><div class="kc-val">${v}</div>${sub ? `<div style="font-size:10.5px;color:var(--muted);">${sub}</div>` : ""}</div>`;
  const tbl = (head, rows) => `<div class="tbl-wrap"><table><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${c ?? ""}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" style="color:var(--muted);">Nothing yet</td></tr>`}</table></div>`;
  const d = t => t ? new Date(t).toLocaleDateString() : "";
  try {
    if (bvHqSec === "overview") {
      const r = await sbFn("hq-admin", { action: "overview" }); if (r.error) throw new Error(r.error);
      body.innerHTML = `<div class="g4">${kc("Companies", r.companies)}${kc("People", r.users, r.buyers + " media buyers")}${kc("Ad accounts sold", r.managed_accounts, r.own_accounts + " customer-owned")}${kc("In the pool", r.pool.free + " free", r.pool.sold + " sold · " + r.pool.retired + " retired")}</div>
        <div class="g4" style="margin-top:12px;">${kc("Your earnings (30 days)", fN(r.earnings_30d.profit), "Billed " + fN(r.earnings_30d.billed) + " · Meta " + fN(r.earnings_30d.raw))}${kc("Ad account fees", fN(r.account_fees))}${kc("Card top-ups, all time", fN(r.card_topups))}${kc("Ad spend billed, all time", fN(r.managed_spend_billed), r.pending_wallet_requests + " wallet requests waiting")}</div>`;
    } else if (bvHqSec === "companies") {
      const r = await sbFn("hq-admin", { action: "companies" }); if (r.error) throw new Error(r.error);
      body.innerHTML = tbl(["Company", "Type", "People", "Buyers", "Revora accts", "Own accts", "Joined", ""], r.companies.map(c => [`<b>${escH(c.name || "—")}</b>`, escH(c.type || ""), c.users, c.buyers, c.managed, c.own, d(c.created_at), `<button type="button" class="btn btn-g hqOpen" data-id="${c.id}" style="padding:2px 9px;font-size:10px;">Open</button>`]));
      body.querySelectorAll(".hqOpen").forEach(b => b.onclick = async () => {
        const c = await sbFn("hq-admin", { action: "company", company_id: b.dataset.id }); if (c.error) return bvToast(c.error, "err");
        bvModal(c.company?.name || "Company", `<div style="max-height:68vh;overflow:auto;font-size:12.5px;">
          <div class="set-lbl">People</div>${tbl(["Name", "Email", "Role", "Last seen"], c.people.map(p => [escH(p.display_name || ""), escH(p.email || ""), escH(p.role || ""), d(p.last_sign_in)]))}
          <div class="set-lbl" style="margin-top:10px;">Ad accounts</div>${tbl(["Account", "Type", "Held by", "Spend billed"], c.accounts.map(a => [escH(a.nickname || a.name || a.meta_ad_account_id), a.billing_mode === "managed" ? "Revora" : "Own", escH(a.buyer || "Company"), a.billed_spend == null ? "—" : fN(a.billed_spend)]))}
          <div class="set-lbl" style="margin-top:10px;">Wallets</div>${tbl(["Holder", "Balance"], [["Company wallet", fN(c.company_wallet)], ...c.buyer_wallets.map(w => [escH(w.name), fN(w.wallet)])])}</div>`);
        const m = document.querySelector("#bvModalOverlay .bv-modal"); if (m) m.style.maxWidth = "640px";
      });
    } else if (bvHqSec === "accounts") {
      const r = await sbFn("hq-admin", { action: "accounts" }); if (r.error) throw new Error(r.error);
      body.innerHTML = `<div class="set-lbl">Add an ad account to sell</div>
        <div class="set-card" style="padding:14px 16px;"><div style="font-size:12px;color:var(--text2);margin-bottom:8px;">Assign it to Revora's system user in Meta Business Manager first, then paste its number.</div>
          <form id="hqPoolForm" style="display:flex;gap:8px;flex-wrap:wrap;" novalidate><input id="hqPoolId" placeholder="Ad account number" inputmode="numeric" style="flex:1;min-width:150px;"><input id="hqPoolLabel" placeholder="Label (optional)" style="flex:1;min-width:120px;"><button type="submit" class="btn btn-a" style="width:auto;padding:8px 18px;" id="hqPoolBtn">Add to pool</button></form><div id="hqPoolMsg" style="margin-top:8px;"></div></div>
        <div class="set-lbl" style="margin-top:14px;">Pool</div>${tbl(["Meta account", "Name", "Status", "Assigned to", ""], r.pool.map(p => [escH(p.meta_ad_account_id), escH(p.meta_name || p.label || ""), escH(p.assigned_company_id ? "sold" : p.status), escH(p.company || ""), p.status === "available" && !p.assigned_company_id ? `<button type="button" class="btn btn-g hqRetire" data-id="${p.id}" style="padding:2px 9px;font-size:10px;">Retire</button>` : ""]))}
        <div class="set-lbl" style="margin-top:14px;">Sold Revora ad accounts</div>${tbl(["Account", "Company", "Held by", "Status", "Spend billed", "Sold"], r.sold.map(a => [escH(a.nickname || a.name || a.meta_ad_account_id), escH(a.company), escH(a.buyer || "Company"), escH(a.status || ""), fN(a.billed_spend), d(a.created_at)]))}`;
      body.querySelector("#hqPoolForm").onsubmit = async e => {
        e.preventDefault();
        const btn = body.querySelector("#hqPoolBtn"), msg = body.querySelector("#hqPoolMsg");
        btn.disabled = true; btn.textContent = "Adding…"; msg.innerHTML = "";
        const x = await sbFn("ad-account-pool", { action: "pool_add", meta_ad_account_id: body.querySelector("#hqPoolId").value, label: body.querySelector("#hqPoolLabel").value }).catch(err => ({ error: err.message }));
        if (x.error) { msg.innerHTML = `<div class="msg err" style="display:block;">❌ ${escH(x.error)}</div>`; btn.disabled = false; btn.textContent = "Add to pool"; return; }
        bvToast(`Added${x.name ? ": " + x.name : ""}`); renderHq(el);
      };
      body.querySelectorAll(".hqRetire").forEach(b2 => b2.onclick = async () => { await sbFn("ad-account-pool", { action: "pool_retire", id: b2.dataset.id }); renderHq(el); });
    } else if (bvHqSec === "pixels") {
      const r = await sbFn("hq-pixel", { action: "overview", days: 7 }); if (r.error) throw new Error(r.error);
      const key = ["PageView", "ViewContent", "InitiateCheckout", "Lead", "Purchase"];
      const ago3 = t => { if (!t) return "never"; const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
      body.innerHTML = `<div class="set-lbl">Create a pixel</div><div class="set-card" style="padding:14px 16px;"><form id="hqPxForm" style="display:flex;gap:8px;flex-wrap:wrap;" novalidate><input id="hqPxName" placeholder="Pixel name" style="flex:1;min-width:150px;"><input id="hqPxAcct" placeholder="Share with ad account number (optional)" inputmode="numeric" style="flex:1;min-width:160px;"><button type="submit" class="btn btn-a" style="width:auto;padding:8px 18px;" id="hqPxBtn">Create</button></form><div id="hqPxMsg" style="margin-top:8px;"></div></div>
        <div class="set-lbl" style="margin-top:14px;">Pixels in your Business, last 7 days</div>
        ${r.pixels.length ? r.pixels.map(p => `<div class="set-card" style="padding:12px 16px;margin-bottom:10px;"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>${escH(p.name || "Pixel")}</b><span style="font-size:11.5px;color:var(--muted);font-family:ui-monospace,monospace;">${escH(p.id)}</span></div>
          <div style="font-size:11.5px;color:var(--text2);margin:4px 0 8px;">Last event ${ago3(p.last_fired_time)}${p.unavailable ? " · unavailable" : ""}${p.error ? " · " + escH(p.error) : ""}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${key.map(k => `<div style="flex:1;min-width:84px;background:var(--panel2);border-radius:8px;padding:6px 8px;"><div style="font-size:9.5px;color:var(--muted);">${k}</div><div style="font-weight:700;">${(p.events[k] || 0).toLocaleString()}</div></div>`).join("")}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:6px;">Browser ${((p.methods.browser || p.methods.BROWSER || 0)).toLocaleString()} · Server ${((p.methods.server || p.methods.SERVER || 0)).toLocaleString()}</div></div>`).join("") : `<div class="empty">No pixels found</div>`}`;
      body.querySelector("#hqPxForm").onsubmit = async e => {
        e.preventDefault();
        const btn = body.querySelector("#hqPxBtn"), msg = body.querySelector("#hqPxMsg");
        btn.disabled = true; btn.textContent = "Creating…"; msg.innerHTML = "";
        const x = await sbFn("hq-pixel", { action: "create", name: body.querySelector("#hqPxName").value, ad_account_id: body.querySelector("#hqPxAcct").value }).catch(err => ({ error: err.message }));
        btn.disabled = false; btn.textContent = "Create";
        if (x.error) { msg.innerHTML = `<div class="msg err" style="display:block;">❌ ${escH(x.error)}</div>`; return; }
        bvToast(`${x.existed ? "Already existed" : "Created"}: ${x.pixel_id}${x.share && x.share.shared === false ? " (not shared: " + x.share.note + ")" : ""}`); renderHq(el);
      };
    } else if (bvHqSec === "money") {
      const r = await sbFn("hq-admin", { action: "money" }); if (r.error) throw new Error(r.error);
      body.innerHTML = `<div class="set-lbl">Buyer wallets</div>${tbl(["Company", "Buyer", "Wallet"], r.buyer_wallets.map(w => [escH(w.company), escH(w.buyer), fN(w.wallet)]))}
        <div class="set-lbl" style="margin-top:14px;">Wallet requests</div>${tbl(["When", "Company", "Buyer", "Amount", "Status"], r.requests.map(x => [d(x.requested_at), escH(x.company), escH(x.buyer || ""), fN(x.amount_naira), escH(x.status)]))}
        <div class="set-lbl" style="margin-top:14px;">Card top-ups</div>${tbl(["When", "Company", "Buyer", "Amount", "Status"], r.topups.map(x => [d(x.created_at), escH(x.company), escH(x.buyer || "Company"), fN(x.amount_naira), escH(x.status)]))}
        <div class="set-lbl" style="margin-top:14px;">Wallet movements</div>${tbl(["When", "Company", "Buyer", "Amount", "Reason"], r.adjustments.map(x => [d(x.created_at), escH(x.company), escH(x.buyer || "Company"), fN(x.amount_naira), escH(x.reason || "")]))}
        <div class="set-lbl" style="margin-top:14px;">Withdrawals</div>${tbl(["When", "Company", "Amount", "Status"], r.withdrawals.map(x => [d(x.created_at), escH(x.company), fN(x.amount_naira), escH(x.status)]))}`;
    } else if (bvHqSec === "fees") {
      const [fr, rv] = await Promise.all([sbFn("hq-admin", { action: "fees" }), sbFn("hq-admin", { action: "revenue" })]); if (fr.error) throw new Error(fr.error); if (rv.error) throw new Error(rv.error);
      const labels = { deposit: ["Deposit fee", "Taken from every deposit: card, bank transfer, admin credits and approved requests."], transfer: ["Transfer fee", "Taken when money is sent to Meta. It includes the bank's own charge."], wallet: ["Wallet to wallet fee", "Taken when one Revora user sends money to another."] };
      const byK = Object.fromEntries((fr.fees || []).map((f) => [f.kind, f]));
      const card = (k) => { const f = byK[k] || { enabled: true, pct: 0, flat_naira: 0, min_naira: 0, cap_naira: 0, payer: "sender" };
        return `<div class="set-card hqfee" data-k="${k}" style="padding:14px 16px;margin-bottom:10px;"><div style="display:flex;align-items:center;gap:10px;"><div style="flex:1"><b>${labels[k][0]}</b><div style="font-size:11.5px;color:var(--muted);">${labels[k][1]}</div></div>
          <label class="switch"><input type="checkbox" class="hf-on" ${f.enabled ? "checked" : ""}><span class="sw-track"></span></label></div>
          <div class="fg" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-top:10px;"><div class="field"><label>Percent (%)</label><input type="number" step="0.1" min="0" class="hf-pct" value="${Number(f.pct)}"></div><div class="field"><label>Plus flat (₦)</label><input type="number" min="0" class="hf-flat" value="${Number(f.flat_naira)}"></div>
          <div class="field"><label>Minimum (₦)</label><input type="number" min="0" class="hf-min" value="${Number(f.min_naira)}"></div><div class="field"><label>Cap (₦, 0 = none)</label><input type="number" min="0" class="hf-cap" value="${Number(f.cap_naira)}"></div></div>
          ${k === "wallet" ? `<div class="field" style="margin-top:8px;max-width:220px;"><label>Who pays</label><select class="hf-payer"><option value="sender" ${f.payer !== "receiver" ? "selected" : ""}>Sender</option><option value="receiver" ${f.payer === "receiver" ? "selected" : ""}>Receiver</option></select></div>` : ""}</div>`; };
      const mx = Math.max(1, ...(rv.days || []).map((x) => x.fees));
      const kinds = [["Deposit fees", "deposit"], ["Transfer fees", "transfer"], ["Wallet to wallet", "wallet"]];
      body.innerHTML = `<div class="g4">${kc("Fees today", fN(rv.today.total))}${kc("Fees this month", fN(rv.month.total), rv.month.count + " charges")}${kc("Last 30 days", fN(rv.last30.total))}${kc("Deposit · Transfer · Wallet", fN(rv.month.deposit) + " · " + fN(rv.month.transfer) + " · " + fN(rv.month.wallet), "this month")}</div>
        <div class="set-lbl" style="margin-top:14px;">Daily fees, last 30 days</div><div class="set-card" style="padding:14px 16px;"><div style="display:flex;align-items:flex-end;gap:3px;height:90px;">${(rv.days || []).map((x) => `<div title="${x.date}: ${fN(x.fees)}" style="flex:1;background:var(--accent);opacity:${x.fees ? 1 : .18};border-radius:3px 3px 0 0;height:${Math.max(3, x.fees / mx * 100)}%"></div>`).join("")}</div></div>
        <div class="set-lbl" style="margin-top:14px;">Fees set by Revora (apply to every company)</div>${["deposit", "transfer", "wallet"].map(card).join("")}
        <button type="button" class="btn btn-a" id="hqFeeSave" style="padding:6px 14px;">Save fees</button> <span id="hqFeeMsg"></span>
        <div class="set-lbl" style="margin-top:18px;">Top companies this month</div>${tbl(["Company", "Fees"], (rv.top_companies || []).map((x) => [escH(x.company), fN(x.fee)]))}
        <div class="set-lbl" style="margin-top:14px;">Recent fees</div>${tbl(["When", "Type", "Company", "Buyer", "Amount", "Fee"], (rv.recent || []).map((x) => [new Date(x.at).toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" }), escH(({ deposit: "Deposit", transfer: "Transfer to Meta", wallet: "Wallet to wallet" })[x.kind] || x.kind), escH(x.company), escH(x.buyer || ""), fN(x.amount), fN(x.fee)]))}`;
      body.querySelector("#hqFeeSave").onclick = async () => {
        const msg = body.querySelector("#hqFeeMsg"), g = (b, c) => b.querySelector(c);
        const fees = [...body.querySelectorAll(".hqfee")].map((b) => ({ kind: b.dataset.k, enabled: g(b, ".hf-on").checked, pct: g(b, ".hf-pct").value, flat_naira: g(b, ".hf-flat").value, min_naira: g(b, ".hf-min").value, cap_naira: g(b, ".hf-cap").value, payer: g(b, ".hf-payer") ? g(b, ".hf-payer").value : "sender" }));
        if (!confirm("Save these fees? They apply to every company straight away.")) return;
        const x = await sbFn("hq-admin", { action: "set_fees", fees }).catch((e) => ({ error: e.message }));
        msg.innerHTML = x.error ? `<span style="color:var(--danger);">❌ ${escH(x.error)}</span>` : `<span style="color:var(--accent);">✅ Saved</span>`;
      };
    } else if (bvHqSec === "social") {
      await bvHqSocial(body);
    } else {
      const r = await sbFn("support-chat", { action: "threads" }); if (r.error) throw new Error(r.error);
      const t = r.threads || [];
      body.innerHTML = t.length ? `<div class="set-card">${t.map(x => `<div class="set-item" style="cursor:pointer;" data-c="${x.company_id}" data-n="${escH(x.company_name)}"><div class="set-tx"><b>${escH(x.company_name)}${x.unread_staff ? ` <span class="set-warn">${x.unread_staff} new</span>` : ""}</b><span>${escH(x.last_text || "")}</span></div><span style="font-size:10.5px;color:var(--muted);">${ago(x.last_message_at)}</span></div>`).join("")}</div>` : `<div class="empty">No support chats yet</div>`;
      body.querySelectorAll(".set-item[data-c]").forEach(n => n.onclick = () => bvSupportChat(n.dataset.c, n.dataset.n));
    }
  } catch (e) { body.innerHTML = `<div class="msg err" style="display:block;">❌ ${escH(e.message)}</div>`; }
}

// ── HQ → Social: post to Revora's own Facebook Page and Instagram (social-admin). Captions are always written by a person. ──
const SO_WHEN = iso => iso ? new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "no time set";
async function bvHqSocial(body) {
  let files = []; // { file, url (preview) } in the order they will appear
  const stPill = s => `<span class="pill ${s === "posted" ? "active" : s === "failed" ? "paused" : s === "approved" ? "pending" : ""}">${escH(s === "approved" ? "scheduled" : s)}</span>`;
  async function load() {
    const r = await sbFn("social-admin", { action: "list", limit: 40 });
    const box = document.getElementById("soList"); if (!box) return;
    if (r.error) { box.innerHTML = `<div class="msg err" style="display:block;">❌ ${escH(r.error)}</div>`; return; }
    const posts = r.posts || [];
    box.innerHTML = posts.length ? posts.map(p => {
      const first = (p.media_urls || [])[0] || "", isVid = p.kind === "video";
      const thumb = isVid ? `<div style="width:56px;height:56px;border-radius:10px;background:var(--panel2);display:grid;place-items:center;font-size:22px;flex:none;">🎬</div>` : `<img src="${escH(first)}" alt="" loading="lazy" style="width:56px;height:56px;border-radius:10px;object-fit:cover;flex:none;">`;
      const links = [p.ig_link ? `<a href="${escH(p.ig_link)}" target="_blank" rel="noopener">Instagram</a>` : "", p.fb_link ? `<a href="${escH(p.fb_link)}" target="_blank" rel="noopener">Facebook</a>` : ""].filter(Boolean).join(" · ");
      const hook = escH(String(p.caption_ig || "").split("\n")[0].slice(0, 110));
      const canAct = p.status !== "posted";
      return `<div class="set-item" style="align-items:flex-start;gap:12px;flex-wrap:wrap;">${thumb}
        <div class="set-tx" style="min-width:180px;flex:1;"><b>${hook || "(no caption)"}</b>
          <span>${escH(p.kind === "carousel" ? (p.media_urls || []).length + " pictures" : p.kind === "video" ? "Reel" : "1 picture")} · ${p.status === "posted" ? "posted " + SO_WHEN(p.posted_at) : SO_WHEN(p.scheduled_for)} ${stPill(p.status)}</span>
          ${links ? `<span>${links}</span>` : ""}${p.error ? `<span style="color:var(--danger);">${escH(p.error)}</span>` : ""}</div>
        ${canAct ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${p.status === "draft" || p.status === "failed" || p.status === "skipped" ? `<button type="button" class="btn btn-g soAct" data-id="${p.id}" data-a="approve">Approve</button>` : ""}
          <button type="button" class="btn btn-a soAct" style="width:auto;padding:8px 14px;" data-id="${p.id}" data-a="now">Post now</button>
          ${p.status !== "skipped" ? `<button type="button" class="btn btn-g soAct" data-id="${p.id}" data-a="skip">Skip</button>` : ""}
          <button type="button" class="btn btn-g soAct" data-id="${p.id}" data-a="del">Delete</button></div>` : ""}
      </div>`;
    }).join("") : `<div style="color:var(--muted);padding:10px 2px;">No posts yet.</div>`;
    box.querySelectorAll(".soAct").forEach(b => b.onclick = async () => {
      const a = b.dataset.a, id = b.dataset.id;
      if (a === "del" && !confirm("Delete this post?")) return;
      if (a === "now" && !confirm("Post this to Instagram and Facebook right now?")) return;
      b.disabled = true; const old = b.textContent; b.textContent = a === "now" ? "Posting… (up to a minute)" : "…";
      const x = a === "approve" ? await sbFn("social-admin", { action: "set_status", id, status: "approved" })
        : a === "skip" ? await sbFn("social-admin", { action: "set_status", id, status: "skipped" })
        : a === "del" ? await sbFn("social-admin", { action: "delete", id })
        : await sbFn("social-admin", { action: "post_now", id });
      if (x.error) { bvToast(x.error, "err"); b.disabled = false; b.textContent = old; return; }
      if (a === "now") bvToast(x.post && x.post.status === "posted" ? "Posted to Instagram and Facebook" : (x.post && x.post.error) || "Sent. Check the list in a minute.", x.post && x.post.status === "posted" ? "ok" : "err");
      else bvToast(a === "approve" ? "Approved. It posts at its time." : a === "skip" ? "Skipped" : "Deleted");
      load();
    });
  }
  body.innerHTML = `<div class="set-lbl">New post · Instagram @revora.ads + Facebook Page “Revora”</div>
    <div class="set-card" style="padding:14px 16px;">
      <div class="field"><label>Pictures or one video (the first picture is the cover)</label>
        <input type="file" id="soFiles" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime">
        <div style="font-size:11.5px;color:var(--muted);margin-top:4px;">1 picture, 2 to 10 pictures (a swipeable carousel), or 1 video (posts as a Reel). The order below is the order people swipe.</div></div>
      <div id="soThumbs" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;"></div>
      <div class="field"><label>Instagram caption</label><textarea id="soIg" rows="6" maxlength="2200" placeholder="Hook line first. Then a few short lines. Hashtags at the end."></textarea><div id="soCnt" style="font-size:11px;color:var(--muted);text-align:right;">0 / 2200</div></div>
      <div class="field"><label>Facebook caption <span style="font-weight:500;color:var(--muted);">(optional: the Instagram caption is used if empty)</span></label><textarea id="soFb" rows="3"></textarea></div>
      <div class="field"><label>When</label>
        <select id="soMode"><option value="draft">Save as draft (I get a WhatsApp to approve it)</option><option value="schedule">Schedule it</option><option value="post_now">Post now</option></select>
        <input type="datetime-local" id="soWhen" style="display:none;margin-top:8px;"></div>
      <button type="button" class="btn btn-a" id="soGo" style="width:auto;padding:10px 22px;">Save draft</button><div id="soMsg" style="margin-top:8px;"></div>
    </div>
    <div class="set-lbl" style="margin-top:16px;">Posts</div><div class="set-card" id="soList"><div class="empty"><div class="spin" style="width:18px;height:18px;border-width:2px;"></div></div></div>`;
  const $ = id => document.getElementById(id);
  const drawThumbs = () => {
    $("soThumbs").innerHTML = files.map((f, i) => `<div style="position:relative;width:84px;">${f.file.type.startsWith("video") ? `<div style="width:84px;height:84px;border-radius:10px;background:var(--panel2);display:grid;place-items:center;font-size:26px;">🎬</div>` : `<img src="${f.url}" alt="" style="width:84px;height:84px;border-radius:10px;object-fit:cover;">`}
      <div style="font-size:11px;text-align:center;margin-top:3px;"><b>${i + 1}</b> <a data-m="${i}:-1" style="cursor:pointer;">◀</a> <a data-m="${i}:1" style="cursor:pointer;">▶</a> <a data-m="${i}:0" style="cursor:pointer;color:var(--danger);">✕</a></div></div>`).join("");
    $("soThumbs").querySelectorAll("[data-m]").forEach(a => a.onclick = () => {
      const [i, d] = a.dataset.m.split(":").map(Number);
      if (d === 0) files.splice(i, 1); else { const j = i + d; if (j >= 0 && j < files.length) [files[i], files[j]] = [files[j], files[i]]; }
      drawThumbs();
    });
  };
  $("soFiles").onchange = e => {
    const picked = [...e.target.files];
    for (const f of picked) {
      if (f.type.startsWith("video") && (files.length || picked.length > 1)) { bvToast("A video goes on its own", "err"); continue; }
      if (files.some(x => x.file.type.startsWith("video"))) { bvToast("Remove the video first to add pictures", "err"); continue; }
      if (f.size > (f.type.startsWith("video") ? 100 : 10) * 1024 * 1024) { bvToast(`${f.name} is too big (pictures 10 MB, video 100 MB)`, "err"); continue; }
      if (files.length < 10) files.push({ file: f, url: URL.createObjectURL(f) });
    }
    e.target.value = ""; drawThumbs();
  };
  $("soIg").oninput = () => { $("soCnt").textContent = `${$("soIg").value.length} / 2200`; };
  $("soMode").onchange = () => { const m = $("soMode").value; $("soWhen").style.display = m === "schedule" ? "block" : "none"; $("soGo").textContent = m === "draft" ? "Save draft" : m === "schedule" ? "Schedule post" : "Post now"; };
  $("soGo").onclick = async () => {
    const msg = $("soMsg"), mode = $("soMode").value, ig = $("soIg").value.trim();
    msg.innerHTML = "";
    if (!files.length) { msg.innerHTML = `<div class="msg err" style="display:block;">Add at least one picture or a video.</div>`; return; }
    if (!ig) { msg.innerHTML = `<div class="msg err" style="display:block;">Write the Instagram caption first.</div>`; return; }
    let when = null;
    if (mode === "schedule") { const t = new Date($("soWhen").value); if (isNaN(t.getTime()) || t.getTime() < Date.now() + 60000) { msg.innerHTML = `<div class="msg err" style="display:block;">Pick a time in the future.</div>`; return; } when = t.toISOString(); }
    if (mode === "post_now" && !confirm("Post this to Instagram and Facebook right now?")) return;
    const btn = $("soGo"); btn.disabled = true;
    try {
      const urls = [];
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `Uploading ${i + 1} of ${files.length}…`;
        const u = await sbFn("social-admin", { action: "upload_url", filename: files[i].file.name }); if (u.error) throw new Error(u.error);
        const up = await supabaseClient.storage.from("social-media").uploadToSignedUrl(u.path, u.token, files[i].file, { contentType: files[i].file.type });
        if (up.error) throw new Error(up.error.message);
        urls.push(u.public_url);
      }
      btn.textContent = mode === "post_now" ? "Posting… (up to a minute)" : "Saving…";
      const r = await sbFn("social-admin", { action: "create", media_urls: urls, caption_ig: ig, caption_fb: $("soFb").value.trim() || undefined, mode, scheduled_for: when, source: "hq" });
      if (r.error) throw new Error(r.error);
      bvToast(mode === "draft" ? "Draft saved. Check WhatsApp to approve." : mode === "schedule" ? "Scheduled" : (r.post && r.post.status === "posted" ? "Posted to Instagram and Facebook" : (r.post && r.post.error) || "Sent. Check the list in a minute."), mode === "post_now" && !(r.post && r.post.status === "posted") ? "err" : "ok");
      files = []; $("soIg").value = ""; $("soFb").value = ""; $("soCnt").textContent = "0 / 2200"; drawThumbs();
    } catch (e) { msg.innerHTML = `<div class="msg err" style="display:block;">❌ ${escH(e.message)}</div>`; }
    btn.disabled = false; btn.textContent = mode === "draft" ? "Save draft" : mode === "schedule" ? "Schedule post" : "Post now";
    load();
  };
  load();
}

async function bvRenderWaPanel() {
  const el = document.getElementById("waPanel"); if (!el) return;
  const isAdm = bvIsAdminRole(), myBuyer = window.myProfile?.media_buyer_id;
  if (!isAdm && !myBuyer) { el.remove(); return; }
  const [buyers, nums] = await Promise.all([
    sbQuery("media_buyers", "select=id,name,code&order=code.asc").catch(() => []),
    sbQuery("buyer_whatsapp_numbers", "select=id,nickname,display_phone_number,media_buyer_id,status&status=eq.active&order=created_at.asc").catch(() => []),
  ]);
  const mine = isAdm ? (buyers || []) : (buyers || []).filter(b => b.id === myBuyer);
  if (!mine.length) { el.innerHTML = `<div class="ph"><div class="ph-title">WhatsApp</div></div><div style="font-size:12.5px;color:var(--text2);">Add a media buyer first (Business &amp; team), then set up their WhatsApp here.</div>`; return; }
  const sel = window.bvWaBuyer && mine.some(b => b.id === window.bvWaBuyer) ? window.bvWaBuyer : mine[0].id;
  window.bvWaBuyer = sel;
  const list = (nums || []).filter(n => n.media_buyer_id === sel);
  el.innerHTML = `
    <div class="ph"><div class="ph-title">WhatsApp</div><div class="ph-count">${list.length} number${list.length === 1 ? "" : "s"}</div></div>
    <div style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">Your WhatsApp number receives customer chats in the <b>Chats</b> tab and is the number your click-to-WhatsApp ads send people to. We set it up for you — no Facebook login needed.</div>
    ${isAdm && mine.length > 1 ? `<div class="field" style="max-width:320px;"><label>Media buyer</label><select id="waBuyerSel">${mine.map(b => `<option value="${b.id}" ${b.id === sel ? "selected" : ""}>${escH(b.name)} [${escH(b.code)}]</option>`).join("")}</select></div>` : ""}
    <div class="set-card" style="margin:10px 0 14px;">
      ${list.length ? list.map(n => `<div class="set-item"><span class="set-ic" style="background:#25D366">💬</span><div class="set-tx"><b>${escH(n.display_phone_number || "Number")}</b><span>${escH(n.nickname || "Connected")} · messages go to Chats</span></div><button type="button" class="btn btn-g" style="width:auto;padding:7px 14px;" onclick="bvWaRemove('${n.id}')">Remove</button></div>`).join("") : `<div class="set-item"><span class="set-ic" style="background:#8e8e93">💬</span><div class="set-tx"><b>No WhatsApp number yet</b><span>Add the number you already use, or ask us for a new one</span></div></div>`}
      <div class="set-item"><span class="set-ic" style="background:#25D366">＋</span><div class="set-tx"><b>Use my own number</b><span>We link it to Revora with a text-message code. It must not be active on a normal WhatsApp app.</span></div><button type="button" class="btn btn-a" style="width:auto;padding:7px 14px;" onclick="bvWaAddOwn('${sel}')">Add number</button></div>
      <div class="set-item"><span class="set-ic" style="background:#af52de">🛒</span><div class="set-tx"><b>Get a number from Revora</b><span>We give you a ready WhatsApp number for your ads</span></div><button type="button" class="btn btn-g" style="width:auto;padding:7px 14px;" onclick="bvWaRequestNumber('${sel}')">Request</button></div>
    </div>
    <details style="font-size:11.5px;color:var(--muted);"><summary style="cursor:pointer;">Advanced: connect through my own Facebook</summary>
      <div class="set-card" style="margin-top:8px;">
        <div class="set-item"><span class="set-ic" style="background:#1877F2">f</span><div class="set-tx"><b>WhatsApp sign-up with Facebook</b><span>Only works for accounts Meta has approved</span></div><button type="button" class="btn btn-g" style="width:auto;padding:7px 14px;" onclick="bvWaSignup('${sel}')">Use Facebook</button></div>
      </div></details>`;
  document.getElementById("waBuyerSel")?.addEventListener("change", e => { window.bvWaBuyer = e.target.value; bvRenderWaPanel(); });
}
async function bvWaRemove(id) {
  if (!confirm("Remove this WhatsApp number from Revora? Chats already received stay.")) return;
  const r = await sbFn("whatsapp-platform", { action: "remove", media_buyer_id: window.bvWaBuyer, access_token: sessionData.access_token, id });
  if (r.error) return bvToast(r.error, "err");
  bvToast("Number removed"); bvRenderWaPanel();
}
function bvWaAddOwn(buyerId) {
  bvModal("Add your WhatsApp number", `
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.5;">We'll text a 6-digit code to the number. If it's currently on the WhatsApp or WhatsApp Business app, delete that account first (or use a fresh SIM).</div>
    <div class="field"><label>Business name customers will see</label><input id="waNm" placeholder="e.g. Ade Fashion"></div>
    <div style="display:flex;gap:8px;"><div class="field" style="width:90px;"><label>Country code</label><input id="waCc" value="234"></div><div class="field" style="flex:1;"><label>Phone number</label><input id="waPn" placeholder="8012345678" inputmode="tel"></div></div>
    <div id="waStep2" style="display:none;"><div class="field"><label>6-digit code</label><input id="waCode" inputmode="numeric" maxlength="6"></div>
      <div style="font-size:11.5px;margin-bottom:8px;"><a href="#" id="waResend">Resend by SMS</a> · <a href="#" id="waVoice">Call me instead</a></div></div>
    <div id="waErr" class="msg err" style="display:none;"></div>
    <button type="button" class="btn btn-a" id="waGo" style="margin-top:6px;">Send code</button>`);
  let pid = null;
  const $ = i => document.getElementById(i), err = m => { const e = $("waErr"); e.textContent = m || ""; e.style.display = m ? "block" : "none"; };
  const call = (action, extra) => sbFn("whatsapp-platform", { action, media_buyer_id: buyerId, access_token: sessionData.access_token, ...extra });
  const resend = async method => { err(); const r = await call("resend", { phone_number_id: pid, code_method: method }); r.error ? err(r.error) : bvToast(method === "VOICE" ? "Calling you now" : "Code sent"); };
  $("waResend").onclick = e => { e.preventDefault(); resend("SMS"); };
  $("waVoice").onclick = e => { e.preventDefault(); resend("VOICE"); };
  $("waGo").onclick = async () => {
    const b = $("waGo"); b.disabled = true; err();
    try {
      if (!pid) {
        const r = await call("add", { cc: $("waCc").value, phone_number: $("waPn").value, verified_name: $("waNm").value });
        if (r.phone_number_id) pid = r.phone_number_id;
        if (r.error) { err(r.error); return; }
        $("waStep2").style.display = "block"; b.textContent = "Verify & connect"; bvToast("Code sent");
      } else {
        const r = await call("verify", { phone_number_id: pid, code: $("waCode").value });
        if (r.error) { err(r.error); return; }
        bvCloseModal(); bvToast(`WhatsApp connected${r.number ? ": " + r.number : ""}`); bvRenderWaPanel();
      }
    } finally { b.disabled = false; }
  };
}
async function bvWaRequestNumber(buyerId) {
  const note = prompt("Anything we should know? (e.g. the city or business name for the number)", "") ;
  if (note === null) return;
  const r = await sbFn("whatsapp-platform", { action: "request_number", media_buyer_id: buyerId, access_token: sessionData.access_token, note });
  if (r.error) return bvToast(r.error, "err");
  bvToast("Request sent — we'll set up your number and message you");
}

async function bvRenderFbConnect() {
  const el = document.getElementById("fbConnectPanel"); if (!el) return;
  const isAdm = bvIsAdminRole(), myBuyer = window.myProfile?.media_buyer_id;
  if (!isAdm && !myBuyer) { el.remove(); return; }
  const [buyers, conns, nums] = await Promise.all([
    sbQuery("media_buyers", "select=id,name,code&order=code.asc").catch(() => []),
    sbQuery("meta_connections_public", "select=*&status=eq.active&order=connected_at.desc").catch(() => []),
    sbQuery("buyer_whatsapp_numbers", "select=id,nickname,display_phone_number,media_buyer_id,status&status=eq.active&order=created_at.asc").catch(() => []),
  ]);
  const mine = isAdm ? (buyers || []) : (buyers || []).filter(b => b.id === myBuyer);
  if (!mine.length) { el.innerHTML = `<div class="ph"><div class="ph-title">Connect with Facebook</div></div><div style="font-size:12.5px;color:var(--text2);">Add a media buyer first (Business &amp; team), then connect their Facebook here.</div>`; return; }
  const sel = window.bvFbBuyer && mine.some(b => b.id === window.bvFbBuyer) ? window.bvFbBuyer : mine[0].id;
  window.bvFbBuyer = sel;
  const conn = (conns || []).find(c => c.media_buyer_id === sel);
  const have = new Set((accountsList || []).map(a => String(a.meta_ad_account_id || "").replace(/^act_/, "")));
  const avail = (conn?.discovered_ad_accounts || []).filter(a => !have.has(String(a.account_id)));
  const myNums = (nums || []).filter(n => n.media_buyer_id === sel);
  const expires = conn?.token_expires_at ? new Date(conn.token_expires_at) : null;
  const soon = expires && (expires - Date.now()) / 86400000 < 7;
  el.innerHTML = `
    <div class="ph"><div class="ph-title">Connect with Facebook</div><div class="ph-count">Recommended</div></div>
    <div style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">Log in with Facebook once and choose which ad accounts, pages and WhatsApp numbers to share. No Business ID to type. You stay in control and can remove access any time in Facebook.</div>
    ${isAdm && mine.length > 1 ? `<div class="field" style="max-width:320px;"><label>Media buyer</label><select id="fbBuyerSel">${mine.map(b => `<option value="${b.id}" ${b.id === sel ? "selected" : ""}>${escH(b.name)} [${escH(b.code)}]</option>`).join("")}</select></div>` : ""}
    <div class="set-card" style="margin:10px 0 14px;">
      <div class="set-item"><span class="set-ic" style="background:#1877F2">f</span><div class="set-tx"><b>${conn ? `Connected as ${escH(conn.fb_user_name || "Facebook user")}` : "Not connected yet"}</b><span>${conn ? (soon ? "Login expires soon — reconnect" : expires ? "Valid until " + expires.toLocaleDateString() : "Connected") : "Ad accounts, pages and tracking"}</span></div>
        <button type="button" class="btn ${conn ? "btn-g" : "btn-a"}" style="width:auto;padding:7px 14px;" onclick="bvFbStart('${sel}')">${conn ? "Reconnect" : "Continue with Facebook"}</button></div>
    </div>
    ${avail.length ? `<div class="set-lbl">Ad accounts we found — add the ones you want</div><div class="set-card">${avail.map(a => `<div class="set-item"><span class="set-ic" style="background:#1877F2">📣</span><div class="set-tx"><b>${escH(a.name || a.account_id)}</b><span>${escH(a.business_name || "")} act_${escH(a.account_id)}</span></div><button type="button" class="btn btn-a" style="width:auto;padding:6px 14px;" onclick="bvFbAddAccount(this,'${conn.id}','${sel}','${escH(String(a.account_id))}','${escH(String(a.name || "").replace(/'/g, "’"))}')">Add</button></div>`).join("")}</div>` : (conn ? `<div style="font-size:12px;color:var(--muted);">All the ad accounts we found are already added.</div>` : "")}
    <div style="font-size:11.5px;color:var(--muted);margin-top:12px;">Prefer not to log in? Use the Business ID share further down instead — it still works.</div>`;
  document.getElementById("fbBuyerSel")?.addEventListener("change", e => { window.bvFbBuyer = e.target.value; bvRenderFbConnect(); });
}
function bvFbStart(buyerId) {
  location.href = `${SUPA_URL}/functions/v1/meta-oauth-start?media_buyer_id=${encodeURIComponent(buyerId)}&access_token=${encodeURIComponent(sessionData.access_token)}`;
}
async function bvFbAddAccount(btn, connId, buyerId, actId, name) {
  btn.disabled = true; btn.textContent = "Adding…";
  const { error } = await supabaseClient.from("ad_accounts").insert({
    user_id: sessionData.user.id, media_buyer_id: buyerId, name: name || actId, nickname: name || actId,
    meta_ad_account_id: actId, status: "active", meta_connection_id: connId, connected_via: "oauth",
  });
  if (error) { btn.disabled = false; btn.textContent = "Add"; bvToast("Could not add: " + error.message, "err"); return; }
  bvToast("Ad account added — verify its page and pixel below");
  await loadAccounts();
  if (activeTab === "settings") render();
}
// WhatsApp Embedded Signup: Facebook's own pop-up creates/connects the WhatsApp Business account and number.
function bvLoadFbSdk(appId) {
  if (window.FB) return Promise.resolve();
  return new Promise((res, rej) => {
    window.fbAsyncInit = () => { FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v21.0" }); res(); };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js"; s.async = true; s.onerror = () => rej(new Error("Could not load Facebook. Check your connection or ad blocker."));
    document.head.appendChild(s);
  });
}
async function bvWaSignup(buyerId) {
  try {
    const cfg = await sbFn("manage-whatsapp-numbers", { action: "es_config", media_buyer_id: buyerId, access_token: sessionData.access_token });
    if (cfg.error) throw new Error(cfg.error);
    await bvLoadFbSdk(cfg.app_id);
    let done = null;
    const onMsg = ev => {
      if (!/facebook\.com$/.test(new URL(ev.origin).hostname)) return;
      try {
        const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        if (d?.type === "WA_EMBEDDED_SIGNUP" && d.event === "FINISH") done = d.data;
      } catch {}
    };
    window.addEventListener("message", onMsg);
    FB.login(async resp => {
      const code = resp?.authResponse?.code;
      if (!code) { window.removeEventListener("message", onMsg); bvToast("WhatsApp sign-up was cancelled.", "err"); return; }
      for (let i = 0; i < 20 && !done; i++) await new Promise(r => setTimeout(r, 250)); // the pop-up reports the new account just after login
      window.removeEventListener("message", onMsg);
      if (!done?.waba_id || !done?.phone_number_id) { bvToast("Facebook didn't finish creating the number. Please try again.", "err"); return; }
      const r = await sbFn("manage-whatsapp-numbers", { action: "es_complete", access_token: sessionData.access_token, media_buyer_id: buyerId, code, waba_id: done.waba_id, phone_number_id: done.phone_number_id });
      if (r.error) { bvToast(r.error, "err"); return; }
      bvToast(`WhatsApp number connected${r.number ? ": " + r.number : ""}${r.webhook_subscribed ? "" : " (messages may not arrive yet — contact support)"}`);
      bvRenderFbConnect(); bvRenderWaPanel();
    }, { config_id: cfg.config_id, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "", sessionInfoVersion: "3" } });
  } catch (e) { bvToast(e.message || "Could not start WhatsApp sign-up.", "err"); }
}

// WhatsApp number add/verify wizard -- list the buyer's WhatsApp Business
// Accounts (via their already-connected Meta login), pick or add a number,
// request a verification code, then verify it. All through
// manage-whatsapp-numbers, which resolves the buyer's own Meta token
// server-side rather than trusting anything the client sends.
window.bvAddWhatsappModal = function(mediaBuyerId) {
  const overlay = document.createElement("div");
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);

  const st = { step: "wabas", wabas: [], wabaId: null, numbers: [], phoneNumberId: null };

  async function call(action, extra = {}) {
    return sbFn("manage-whatsapp-numbers", { action, media_buyer_id: mediaBuyerId, access_token: sessionData.access_token, ...extra });
  }

  function shell(title, body) {
    overlay.innerHTML = `<div class="bv-modal">
      <button class="bv-modal-close" onclick="this.closest('.bv-overlay').remove()">✕</button>
      <h3 style="margin:0 0 4px;">${title}</h3>
      ${body}
    </div>`;
  }

  async function renderWabas() {
    shell("Add WhatsApp number", `<div style="font-size:12px;color:var(--muted);">Loading your WhatsApp Business Accounts…</div>`);
    const r = await call("list_wabas");
    if (r.error) { shell("Add WhatsApp number", `<div class="msg err" style="display:block;">❌ ${escH(r.error)}</div>`); return; }
    st.wabas = r.wabas || [];
    if (!st.wabas.length) {
      shell("Add WhatsApp number", `<div style="font-size:12px;color:var(--text2);line-height:1.6;">No WhatsApp Business Account found under this buyer's connected Business Manager. Create one first in Meta Business Suite (Business Settings → Accounts → WhatsApp Accounts → Add), then try again.</div>`);
      return;
    }
    shell("Add WhatsApp number", `
      <div class="field"><label>WhatsApp Business Account</label>
        <select id="waWabaSel">${st.wabas.map(w => `<option value="${escH(w.id)}">${escH(w.name)} — ${escH(w.business_name)}</option>`).join("")}</select>
      </div>
      <button type="button" class="btn btn-a btn-full" id="waNextBtn" style="margin-top:10px;">Next</button>
    `);
    document.getElementById("waNextBtn").addEventListener("click", () => {
      st.wabaId = document.getElementById("waWabaSel").value;
      renderNumbers();
    });
  }

  async function renderNumbers() {
    shell("Add WhatsApp number", `<div style="font-size:12px;color:var(--muted);">Loading numbers…</div>`);
    const r = await call("list_numbers", { waba_id: st.wabaId });
    if (r.error) { shell("Add WhatsApp number", `<div class="msg err" style="display:block;">❌ ${escH(r.error)}</div>`); return; }
    st.numbers = r.numbers || [];
    shell("Add WhatsApp number", `
      ${st.numbers.length ? `
      <div style="font-size:11.5px;color:var(--text2);margin-bottom:8px;">Existing numbers on this account:</div>
      ${st.numbers.map(n => `
        <label style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer;">
          <input type="radio" name="waExisting" value="${escH(n.id)}">
          <div style="font-size:12.5px;">${escH(n.display_phone_number || n.id)} <span style="color:var(--muted);">${escH(n.verified_name || "")} · ${escH(n.code_verification_status || "")}</span></div>
        </label>`).join("")}
      <button type="button" class="btn btn-a btn-full" id="waUseExistingBtn" style="margin-top:10px;">Use selected number</button>
      <div style="text-align:center;color:var(--muted);font-size:11px;margin:12px 0;">— or add a new number —</div>` : ""}
      <div class="fg">
        <div class="field"><label>Country code</label><input id="waCc" placeholder="234" value="234"></div>
        <div class="field"><label>Phone number (no country code)</label><input id="waPhone" placeholder="8012345678"></div>
      </div>
      <button type="button" class="btn btn-g btn-full" id="waAddNewBtn" style="margin-top:8px;">Add new number</button>
      <div id="waMsg"></div>
    `);
    document.getElementById("waUseExistingBtn")?.addEventListener("click", () => {
      const picked = document.querySelector('input[name="waExisting"]:checked');
      if (!picked) return;
      st.phoneNumberId = picked.value;
      const chosen = st.numbers.find(n => n.id === picked.value);
      // Already verified/connected (the normal case for a number you're
      // already messaging customers from) -- no SMS code needed, just name
      // it and save. Only an unverified/expired number needs the code flow.
      if (chosen?.code_verification_status === "VERIFIED") renderSaveExisting(chosen);
      else renderVerify();
    });
    document.getElementById("waAddNewBtn").addEventListener("click", async () => {
      const btn = document.getElementById("waAddNewBtn");
      const msg = document.getElementById("waMsg");
      const cc = document.getElementById("waCc").value.trim();
      const phone = document.getElementById("waPhone").value.trim();
      if (!cc || !phone) { msg.innerHTML = `<div class="msg err" style="display:block;">Enter both the country code and number.</div>`; return; }
      btn.disabled = true; btn.textContent = "Adding…";
      const r = await call("add_number", { waba_id: st.wabaId, cc, phone_number: phone });
      if (r.error) { msg.innerHTML = `<div class="msg err" style="display:block;">❌ ${escH(r.error)}</div>`; btn.disabled = false; btn.textContent = "Add new number"; return; }
      st.phoneNumberId = r.phone_number_id;
      renderVerify();
    });
  }

  async function renderSaveExisting(num) {
    shell("Add WhatsApp number", `
      <div style="font-size:12px;color:var(--text2);margin-bottom:10px;">${escH(num.display_phone_number || num.id)} is already verified -- just give it a name so you can tell it apart from any other numbers.</div>
      <div class="field"><label>Nickname</label><input id="waNick" placeholder="e.g. Herbal Leads" value="${escH(num.verified_name || "")}"></div>
      <button type="button" class="btn btn-a btn-full" id="waSaveBtn" style="margin-top:8px;">Save</button>
      <div id="waMsg"></div>
    `);
    document.getElementById("waSaveBtn").addEventListener("click", async () => {
      const btn = document.getElementById("waSaveBtn");
      const msg = document.getElementById("waMsg");
      const nickname = document.getElementById("waNick").value.trim();
      btn.disabled = true; btn.textContent = "Saving…";
      const r = await call("save_number", { phone_number_id: st.phoneNumberId, waba_id: st.wabaId, nickname });
      if (r.error) { msg.innerHTML = `<div class="msg err" style="display:block;">❌ ${escH(r.error)}</div>`; btn.disabled = false; btn.textContent = "Save"; return; }
      overlay.remove();
      renderSettings(document.getElementById("mainContent"));
    });
  }

  async function renderVerify() {
    shell("Verify number", `<div style="font-size:12px;color:var(--muted);">Sending a verification code…</div>`);
    const sendRes = await call("request_code", { phone_number_id: st.phoneNumberId, code_method: "SMS" });
    if (sendRes.error) { shell("Verify number", `<div class="msg err" style="display:block;">❌ ${escH(sendRes.error)}</div>`); return; }
    shell("Verify number", `
      <div style="font-size:12px;color:var(--text2);margin-bottom:10px;">Code sent via SMS. Enter it below, plus a short name for this number so you can tell it apart from others.</div>
      <div class="field"><label>Verification code</label><input id="waCode" placeholder="123456"></div>
      <div class="field"><label>Nickname</label><input id="waNick" placeholder="e.g. Herbal Leads"></div>
      <button type="button" class="btn btn-a btn-full" id="waVerifyBtn" style="margin-top:8px;">Verify &amp; save</button>
      <div id="waMsg"></div>
    `);
    document.getElementById("waVerifyBtn").addEventListener("click", async () => {
      const btn = document.getElementById("waVerifyBtn");
      const msg = document.getElementById("waMsg");
      const code = document.getElementById("waCode").value.trim();
      const nickname = document.getElementById("waNick").value.trim();
      if (!code) { msg.innerHTML = `<div class="msg err" style="display:block;">Enter the code you received.</div>`; return; }
      btn.disabled = true; btn.textContent = "Verifying…";
      const r = await call("verify_code", { phone_number_id: st.phoneNumberId, waba_id: st.wabaId, code, nickname });
      if (r.error) { msg.innerHTML = `<div class="msg err" style="display:block;">❌ ${escH(r.error)}</div>`; btn.disabled = false; btn.textContent = "Verify & save"; return; }
      overlay.remove();
      renderSettings(document.getElementById("mainContent"));
    });
  }

  renderWabas();
};