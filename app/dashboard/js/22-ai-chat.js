// Revora dashboard, part 22 of 23: AI CHAT

// ── AI CHAT ───────────────────────────────────────────────────────────────────
// Suggestion chips and the welcome line are tailored per role so the panel
// visibly "knows" who's asking -- an owner/admin sees cross-buyer questions,
// a buyer sees their own campaigns, customer_care sees calls needing them,
// a delivery agent sees their own deliveries. The ai-chat edge function
// itself grounds the actual answer in that same role-scoped data.
const CHAT_PRESETS = {
  owner: {
    name: "AI Assistant", status: "Whole company, grounded in live data",
    welcome: "Hey 👋 I can see every buyer's spend, orders, and ROAS, which ad sets and creatives are actually driving orders, and what's flagged across calls, approvals and deliveries. What do you want to know?",
    suggs: [
      ["Go through each ad set and its ads: messages, cost per message, reach, frequency, CTR and spend.", "Ad sets & ads breakdown"],
      ["Which ads break my kill thresholds?", "What should I kill?"],
      ["Which ad set is worth scaling?", "What should I scale?"],
      ["Which buyer has the best ROAS this week?", "Best buyer this week?"],
      ["Which ad sets and creatives are bringing the most orders?", "Top ad sets/creatives?"],
      ["What needs my attention right now?", "What needs attention?"],
      ["How is the AI call agent performing on new orders?", "AI call agent performance?"],
    ],
  },
  admin: {
    name: "AI Assistant", status: "Whole company, grounded in live data",
    welcome: "Hey 👋 I can see every buyer's spend, orders, and ROAS, which ad sets and creatives are actually driving orders, and what's flagged across calls, approvals and deliveries. What do you want to know?",
    suggs: [
      ["Go through each ad set and its ads: messages, cost per message, reach, frequency, CTR and spend.", "Ad sets & ads breakdown"],
      ["Which ads break my kill thresholds?", "What should I kill?"],
      ["Which ad set is worth scaling?", "What should I scale?"],
      ["Which buyer has the best ROAS this week?", "Best buyer this week?"],
      ["Which ad sets and creatives are bringing the most orders?", "Top ad sets/creatives?"],
      ["What needs my attention right now?", "What needs attention?"],
      ["How is the AI call agent performing on new orders?", "AI call agent performance?"],
    ],
  },
  buyer: {
    name: "AI Media Buyer", status: "Grounded in your live data",
    welcome: "Hey 👋 I'm trained on senior buyer patterns. I can analyze your CTR, CPA, delivery rate, creative performance, and scaling decisions — and tell you what the AI call agent has done on your new orders. What do you want to know?",
    suggs: [
      ["Go through each ad set and its ads: messages, cost per message, reach, frequency, CTR and spend.", "Ad sets & ads breakdown"],
      ["Which ads break my kill thresholds?", "What should I kill?"],
      ["Which ad set is worth scaling?", "What should I scale?"],
      ["Which of my creatives has the best CTR this week?", "Best CTR this week?"],
      ["Which ad set is bringing me the most orders?", "Top ad set for orders?"],
      ["Has the AI agent called my new orders yet?", "Called my new orders?"],
      ["What's my delivery rate this week?", "Delivery rate?"],
    ],
  },
  customer_care: {
    name: "AI Assistant", status: "Grounded in your live data",
    welcome: "Hey 👋 I can see which calls need a human, which orders look like duplicates, and which are stuck after follow-up attempts. What do you want to know?",
    suggs: [
      ["Which customers need my attention right now?", "Who needs attention?"],
      ["Any possible duplicate orders?", "Duplicate orders?"],
      ["Which orders are stuck after follow-up?", "Stuck orders?"],
      ["Summarize this week's call outcomes.", "Call outcomes this week?"],
    ],
  },
  delivery_agent: {
    name: "AI Assistant", status: "Grounded in your live data",
    welcome: "Hey 👋 I can see your assigned and offered deliveries. What do you want to know?",
    suggs: [
      ["What deliveries are waiting for me to accept?", "Waiting for acceptance?"],
      ["How many active deliveries do I have?", "Active deliveries?"],
      ["How many have I delivered this week?", "Delivered this week?"],
    ],
  },
};
function renderChatForRole(role) {
  const preset = CHAT_PRESETS[role] || CHAT_PRESETS.buyer;
  document.getElementById("chName").textContent = preset.name;
  document.getElementById("chStatus").textContent = preset.status;
  document.getElementById("chWelcomeMsg").textContent = preset.welcome;
  document.getElementById("chHello").textContent = chGreeting();
  const extra = ["owner", "admin", "buyer"].includes(role)
    ? [["Write 3 different Facebook ad copies for the product of mine that is most likely to sell. Use my product details and keep to Meta's ad rules.", "Write ad copy for my best product"], ["Suggest 3 new angles I should test next for my products and explain why.", "What should I test next?"]]
    : [];
  // Smart suggestions (rv/chat-smart.js): a slim row picked from what is happening now + a "More" sheet.
  // Falls back to the plain list if that file did not load.
  if (window.rvSmartSuggest) window.rvSmartSuggest(role, extra, preset.suggs);
  else document.getElementById("chSuggs").innerHTML = [...extra, ...preset.suggs]
    .map(([q, label]) => `<button class="ch-sugg" onclick="askChat('${q.replace(/'/g, "\\'")}')">${escH(label)}</button>`)
    .join("") + (["owner", "admin", "buyer"].includes(role) ? `<button class="ch-sugg" onclick="bvImportAds()">Teach the AI from my past ads</button>` : "");
}
// Keeps the ad copy in a chat message in the person's own library, so it can be reused on any ad account and by the launcher.
async function bvSaveCopy(btn) {
  const msg = btn.closest(".ch-msg"); if (!msg) return;
  btn.disabled = true; const old = btn.textContent; btn.textContent = "Saving…";
  const r = await sbFn("ai-chat", { action: "save_copy", raw_markdown: msg.dataset.raw || "" });
  btn.textContent = r?.saved ? `Saved ${r.saved} ad${r.saved > 1 ? "s" : ""}` : (r?.error || "Could not save");
  if (!r?.saved) { btn.disabled = false; setTimeout(() => { btn.textContent = old; }, 2500); }
}
// Pulls the copy and results of every ad in the active ad account into the AI's library.
async function bvImportAds() {
  if (chBusy) return;
  if (!activeAccountId) { appendMsg("Pick an ad account at the top first, then try again.", "bot"); return; }
  const share = ["owner", "admin"].includes(window.myProfile?.role) && confirm("Also let the AI use the winning ads from this account (copy and results only, never your name) to help other sellers in the same niche?\n\nOK = share, Cancel = keep private.");
  appendMsg("Teach the AI from my past ads", "user");
  const m = appendMsg("", "bot");
  m.innerHTML = '<span class="ch-typing"><i></i><i></i><i></i></span>';
  try {
    const r = await sbFn("ai-chat", { action: "import_library", ad_account_id: activeAccountId, share_to_niche: share });
    chSetBot(m, r?.error ? "I couldn't read the ads: " + r.error : `Done. I read ${r.scanned} ads and saved ${r.imported} with their copy (${r.with_results} have results). From now on I write in the style of what worked here and avoid what flopped.${r.shared ? " The winners are shared anonymously with your niche." : ""}`);
  } catch (e) { chSetBot(m, "I couldn't read the ads: " + (e.message || e)); }
}

let chatOpen = false;
let chUnread = 0;
function chToggleIcon() {
  document.getElementById("chatToggle").innerHTML = icon(chatOpen ? "x" : "chat", 20) + (chUnread > 0 && !chatOpen ? `<span class="ch-badge">${chUnread > 9 ? "9+" : chUnread}</span>` : "");
}
chToggleIcon();
function toggleChat(open) {
  // One chat, one look: every door (the floating button, the Overview bar, links) opens the full-page Assistant tab when this person has it.
  const want = typeof open === "boolean" ? open : !chatOpen;
  if (want && !chPageMode && !/[?&]classic=1/.test(location.search)) {
    const tab = document.querySelector('.tab-btn[data-tab="assistant"]');
    if (tab && getComputedStyle(tab).display !== "none") { tab.click(); return; }
  }
  chatOpen = typeof open === "boolean" ? open : !chatOpen;
  document.getElementById("chatPanel").classList.toggle("open", chatOpen);
  chToggleIcon();
  if (chatOpen) {
    chRefreshAcct();
    chLoadInbox();
    const m = document.getElementById("chMsgs"); m.scrollTop = m.scrollHeight;
    if (window.innerWidth > 760) document.getElementById("chInput").focus();
  }
}
document.getElementById("chatToggle").addEventListener("click", () => toggleChat());
(() => {
  const inp = document.getElementById("chInput");
  inp.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  inp.addEventListener("input", () => { inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 120) + "px"; });
})();

// Which ad account the person has switched in -- the AI works in this one.
function chActiveAcct() {
  const a = (typeof accountsList !== "undefined" ? accountsList : []).find(x => x.id === activeAccountId);
  return a ? { id: a.id, name: a.nickname || a.name || "ad account" } : null;
}
function chRefreshAcct() {
  const el = document.getElementById("chAcct");
  const a = chActiveAcct();
  const showable = ["owner", "admin", "buyer"].includes(window.myProfile?.role);
  el.classList.toggle("on", !!(a && showable));
  el.innerHTML = a ? `Working in <b>${escH(a.name)}</b> · switch account at the top of the dashboard` : "";
}

// Light formatting for the assistant's replies: **bold** only, everything else escaped.
function chMd(raw) {
  const blocks = [];
  let t = String(raw ?? "").replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (m, c) => { blocks.push(c.replace(/\n$/, "")); return `\u0000B${blocks.length - 1}\u0000`; });
  t = escH(t)
    .replace(/^#{1,3}\s+(.+)$/gm, "<h4>$1</h4>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
  const out = []; let list = null;
  for (const ln of t.split("\n")) {
    const ul = ln.match(/^\s*[-•*]\s+(.*)$/), ol = ln.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) { if (list) out.push(`</${list}>`); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${(ul || ol)[1]}</li>`);
    } else {
      if (list) { out.push(`</${list}>`); list = null; }
      out.push(ln === "" ? "<br>" : ln + "<br>");
    }
  }
  if (list) out.push(`</${list}>`);
  return out.join("").replace(/(<br>){3,}/g, "<br><br>").replace(/<br>(<\/?(?:ul|ol|h4)>)/g, "$1").replace(/(<\/(?:ul|ol|h4)>)<br>/g, "$1").replace(/(<br>)+$/, "")
    .replace(/\u0000B(\d+)\u0000/g, (m, i) => `<div class="ch-code"><button type="button" class="ch-copy" onclick="chCopyCode(this)">Copy</button><pre>${escH(blocks[+i])}</pre></div>`);
}
const chFmt = chMd;
function chCopyText(txt, btn) {
  const done = () => { if (!btn) return; const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = o, 1400); };
  try { navigator.clipboard.writeText(txt).then(done, done); } catch { done(); }
}
function chCopyCode(btn) { chCopyText(btn.parentNode.querySelector("pre").textContent, btn); }
function chCopyMsg(btn) { chCopyText(btn.closest(".ch-msg").dataset.raw || "", btn); }
function chDecorate(el, text) {
  el.dataset.raw = text;
  el.querySelector(".ch-acts")?.remove();
  const a = document.createElement("div");
  a.className = "ch-acts";
  a.innerHTML = '<button type="button" onclick="chCopyMsg(this)">Copy</button>' + (/primary text/i.test(text) && /```/.test(text) ? '<button type="button" onclick="bvSaveCopy(this)">Save to my library</button>' : "");
  el.appendChild(a);
}
function chSyncEmpty() {
  const msgs = document.getElementById("chMsgs");
  const has = !!msgs.querySelector(".ch-msg.user");
  document.getElementById("chatPanel").classList.toggle("empty", !has);
}
function chGreeting() {
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  const first = String(window.myProfile?.display_name || "").trim().split(/\s+/)[0];
  return `Good ${part}${first ? ", " + first : ""}`;
}
function chNew() {
  if (chBusy) return;
  chatHistory = [];
  const msgs = document.getElementById("chMsgs");
  [...msgs.children].forEach(n => { if (n.id !== "chHello" && n.id !== "chWelcomeMsg") n.remove(); });
  document.getElementById("chSuggs").style.display = "";
  chLastTs = 0;
  chSyncEmpty();
  document.getElementById("chInput").focus();
}

// Full-page "Assistant" tab: the same chat, laid out like a chat app instead of a pop-up.
let chPageMode = false;
function chPlacePage() {
  const sb = document.querySelector(".sidebar");
  const mob = window.innerWidth <= 760;
  document.getElementById("chatPanel").style.setProperty("--ch-left", mob || !sb ? "0px" : sb.getBoundingClientRect().right + "px");
}
function bvAssistantPage(on) {
  const p = document.getElementById("chatPanel");
  if (on === chPageMode) { if (on) chPlacePage(); return; }
  chPageMode = on;
  p.classList.toggle("page", on);
  document.body.classList.toggle("assist-on", on);
  if (on) {
    chPlacePage();
    chatOpen = true; p.classList.add("open");
    chRefreshAcct(); chLoadInbox(); chSyncEmpty();
    if (window.innerWidth > 760) setTimeout(() => document.getElementById("chInput").focus(), 60);
  } else {
    chatOpen = false; p.classList.remove("open"); chToggleIcon();
  }
}
window.addEventListener("resize", () => { if (chPageMode) chPlacePage(); });
setTimeout(() => { const sb = document.querySelector(".sidebar"); if (sb) new MutationObserver(() => setTimeout(() => chPageMode && chPlacePage(), 220)).observe(sb, { attributes: true, attributeFilter: ["class"] }); }, 0);
let chLastTs = 0;
function chStamp() {
  const now = Date.now();
  if (now - chLastTs > 10 * 60 * 1000) {
    const t = document.createElement("div");
    t.className = "ch-time";
    t.textContent = new Date(now).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
    document.getElementById("chMsgs").appendChild(t);
  }
  chLastTs = now;
}

function appendMsg(text, role) {
  const msgs = document.getElementById("chMsgs");
  chStamp();
  const prev = msgs.lastElementChild;
  if (prev && prev.classList.contains("ch-msg") && prev.classList.contains(role)) prev.classList.remove("tail");
  const d = document.createElement("div");
  d.className = "ch-msg " + role + " tail";
  if (role === "bot") { d.innerHTML = chFmt(text); if (text) chDecorate(d, text); } else d.textContent = text;
  msgs.appendChild(d);
  chSyncEmpty();
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}
function chSetBot(el, text) { el.classList.remove("typing"); el.innerHTML = chFmt(text); chDecorate(el, text); }

// The assistant can respond with "quick replies" -- e.g. after it looks up
// several ad accounts, one chip per account so picking one is a tap instead
// of typing the name back. Reuses the ch-sugg chip style.
function appendQuickReplies(replies) {
  if (!replies?.length) return;
  const msgs = document.getElementById("chMsgs");
  const wrap = document.createElement("div");
  wrap.className = "ch-suggs";
  wrap.style.cssText = "border-top:none;padding:4px 0 0;";
  wrap.innerHTML = replies.map(r => `<button class="ch-sugg" onclick="askChat('${r.replace(/'/g, "\\'")}')">${escH(r)}</button>`).join("");
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

// Rolling conversation memory (this page view only) so a short follow-up --
// "yes, 50000" after the assistant asks "how much?" -- still has context.
// The ai-chat function re-derives everything else (role, live data) fresh
// on every call; only the back-and-forth text travels with each request.
let chatHistory = [];

// The AI can VERIFY a bank account (resolve_bank_account) but can never move
// money itself -- when it does, the response carries a pending_payment that
// renders as this card. Nothing is sent until the person clicks Confirm AND
// re-enters their password; that's a deliberate second gate real money needs
// beyond the ordinary chat round-trip.
function appendPendingPaymentCard(payment) {
  if (!payment?.verified) return;
  const msgs = document.getElementById("chMsgs");
  const card = document.createElement("div");
  card.className = "ch-pay-card";
  card.innerHTML = `
    <div class="ch-pay-row"><span>To</span><strong>${escH(payment.account_name)}</strong></div>
    <div class="ch-pay-row"><span>Bank</span><strong>${escH(payment.bank_name)}</strong></div>
    <div class="ch-pay-row"><span>Account no.</span><strong>${escH(payment.account_number)}</strong></div>
    ${payment.note ? `<div class="ch-pay-row"><span>For</span><strong>${escH(payment.note)}</strong></div>` : ""}
    <div class="ch-pay-row ch-pay-amt"><span>Amount</span><strong>${escH(payment.amount)}</strong></div>
    <button class="btn btn-a btn-full" style="margin-top:4px;" onclick='bvShowChatPaymentConfirm(${JSON.stringify(payment).replace(/'/g, "&#39;")})'>Confirm &amp; Send</button>
  `;
  msgs.appendChild(card);
  msgs.scrollTop = msgs.scrollHeight;
}

// Second gate: re-enter the account password before the real Paystack
// transfer fires. Re-authenticating (not just checking a field is non-empty)
// proves it's really the signed-in person, the same way a banking app does.
function bvShowChatPaymentConfirm(payment) {
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `
    <div class="bv-modal">
      <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
      <div class="ph-title" style="margin-bottom:10px;">Confirm payment</div>
      <div class="bv-dl" style="margin-bottom:14px;">
        <dt>To</dt><dd>${escH(payment.account_name)}</dd>
        <dt>Bank</dt><dd>${escH(payment.bank_name)} · ${escH(payment.account_number)}</dd>
        <dt>Amount</dt><dd>${escH(payment.amount)}</dd>
      </div>
      <form id="chatPayForm" novalidate>
        <div class="field"><label>Enter your password to confirm *</label><input id="chatPayPassword" type="password" autocomplete="current-password" placeholder="Your account password"></div>
        <button type="submit" class="btn btn-a btn-full" id="chatPaySubmitBtn">Send ${escH(payment.amount)}</button>
        <div id="chatPayMsg"></div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById("chatPayForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = document.getElementById("chatPaySubmitBtn");
    const msg = document.getElementById("chatPayMsg");
    const password = document.getElementById("chatPayPassword").value;
    if (!password) { msg.innerHTML = `<div class="msg err">❌ Enter your password.</div>`; return; }
    btn.disabled = true; btn.textContent = "Verifying…";
    try {
      const pwChk = await fetch(SUPA_URL + "/functions/v1/send-internal-email", { method: "POST", headers: { Authorization: "Bearer " + sessionData.access_token, apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ type: "check_password", password }) }).then((x) => x.json()).catch(() => ({}));
      if (!pwChk.ok) throw new Error("Incorrect password.");
      btn.textContent = "Sending…";
      const r = payment.kind === "meta_transfer"
        ? await sbFn("paystack-transfer-to-meta", {
            access_token: sessionData.access_token,
            fund_request_id: payment.fund_request_id,
            account_number: payment.account_number,
            bank_code: payment.bank_code,
          })
        : await sbFn("paystack-admin-withdraw", {
            access_token: sessionData.access_token,
            amount_naira: payment.amount_naira,
            account_number: payment.account_number,
            bank_code: payment.bank_code,
          });
      if (r.error) throw new Error(r.error);
      if (r.verified === false) throw new Error(r.reason || "Could not verify this account.");
      bvCloseModal();
      bvToast(`Sent ${payment.amount} to ${r.account_name || payment.account_name}`);
      appendMsg(`✅ Sent ${payment.amount} to ${payment.account_name} (${payment.bank_name}).`, "bot");
    } catch (err) {
      msg.innerHTML = `<div class="msg err">❌ ${escH(err.message)}</div>`;
      btn.disabled = false; btn.textContent = `Send ${payment.amount}`;
    }
  });
}

// The AI never changes an ad itself -- it proposes, and the person taps Confirm here.
const CH_LEVEL = { campaign: "campaign", adset: "ad set", ad: "ad" };
async function chInboxResolve(id, status) {
  if (!id) return;
  try { await supabaseClient.from("ai_inbox").update({ status, resolved_at: new Date().toISOString(), read_at: new Date().toISOString() }).eq("id", id); } catch {}
}
function appendProposalCards(list) {
  const msgs = document.getElementById("chMsgs");
  for (const p of list || []) {
    const card = document.createElement("div");
    card.className = "ch-act-card";
    const nm = p.object_name ? `“${escH(p.object_name)}”` : `this ${CH_LEVEL[p.level]}`;
    let ico, title;
    if (p.kind === "budget") {
      const up = p.current_daily_budget && p.new_daily_budget > p.current_daily_budget;
      ico = up ? "📈" : "📉";
      title = `${up ? "Scale" : "Change"} ${CH_LEVEL[p.level]} ${nm} budget`;
    } else if (p.status === "PAUSED") { ico = "⏸"; title = `Pause ${CH_LEVEL[p.level]} ${nm}`; }
    else { ico = "▶️"; title = `Resume ${CH_LEVEL[p.level]} ${nm}`; }
    const sub = p.kind === "budget"
      ? `${p.current_daily_budget ? fN(p.current_daily_budget) + " → " : "New daily budget: "}<b>${fN(p.new_daily_budget)}</b> a day`
      : "";
    card.innerHTML = `
      <div class="ch-act-h"><div class="ch-act-ico">${ico}</div><div style="min-width:0;">
        <div class="ch-act-t">${title}</div>
        <div class="ch-act-s">${escH(p.account_name || "")}${sub ? " · " + sub : ""}${p.reason ? `<br>${escH(p.reason)}` : ""}</div></div></div>
      <div class="ch-act-btns"><button class="ch-act-no">Not now</button><button class="ch-act-ok">Confirm</button></div>
      <div class="ch-act-res"></div>`;
    const ok = card.querySelector(".ch-act-ok"), no = card.querySelector(".ch-act-no"), res = card.querySelector(".ch-act-res");
    no.onclick = () => { card.querySelector(".ch-act-btns").remove(); res.textContent = "Dismissed."; res.style.color = "var(--muted)"; chInboxResolve(p.inbox_id, "dismissed"); };
    ok.onclick = async () => {
      ok.disabled = no.disabled = true; ok.textContent = "Working…";
      const body = p.kind === "budget"
        ? { action: "set_budget", ad_account_id: p.ad_account_id, level: p.level, object_id: p.object_id, daily_budget: p.new_daily_budget, reason: "Via AI chat" + (p.reason ? ": " + p.reason : "") }
        : { action: "set_status", ad_account_id: p.ad_account_id, level: p.level, object_id: p.object_id, status: p.status, reason: "Via AI chat" + (p.reason ? ": " + p.reason : "") };
      const r = await amCall(body);
      if (r?.ok) {
        card.classList.add("done");
        card.querySelector(".ch-act-btns").remove();
        const what = p.kind === "budget" ? `Budget is now ${fN(r.daily_budget)} a day` : (r.status === "PAUSED" ? "Paused" : "Running again") + " (Meta confirms)";
        res.textContent = "✅ " + what; res.style.color = "#30d158";
        chInboxResolve(p.inbox_id, "done");
        chatHistory.push({ role: "user", content: `[I tapped Confirm: ${p.kind === "budget" ? "budget of " : ""}${CH_LEVEL[p.level]} ${p.object_name || p.object_id} — ${what}]` });
      } else {
        card.classList.add("fail");
        ok.disabled = no.disabled = false; ok.textContent = "Try again";
        res.textContent = "❌ " + (r?.error || "Meta did not accept that."); res.style.color = "#ff453a";
      }
    };
    msgs.appendChild(card);
  }
  msgs.scrollTop = msgs.scrollHeight;
}


// The AI proposes launching fresh vault creatives; nothing goes live until the person taps Confirm.
function appendLaunchCard(p) {
  const msgs = document.getElementById("chMsgs");
  const card = document.createElement("div");
  card.className = "ch-act-card";
  const thumbs = (p.previews || []).slice(0, 5).map(v => `
    <div style="width:64px;flex:none;" title="${escH(v.headline || "")}">
      <div style="width:64px;height:64px;border-radius:8px;overflow:hidden;background:var(--panel2);border:1px solid var(--border);">${v.type === "video" ? `<video src="${escH(v.url)}" muted style="width:100%;height:100%;object-fit:cover;"></video>` : `<img src="${escH(v.url)}" style="width:100%;height:100%;object-fit:cover;">`}</div>
      <div style="font-size:9.5px;color:var(--muted);margin-top:3px;line-height:1.25;max-height:24px;overflow:hidden;">${escH(v.headline || "")}</div>
    </div>`).join("");
  card.innerHTML = `
    <div class="ch-act-h"><div class="ch-act-ico">🎨</div><div style="min-width:0;">
      <div class="ch-act-t">Launch ${p.creative_ids.length} fresh creative${p.creative_ids.length === 1 ? "" : "s"} for ${escH(p.product_name || "this product")}</div>
      <div class="ch-act-s">${escH(p.account_name || "")}${p.reason ? `<br>${escH(p.reason)}` : ""}</div></div></div>
    <div style="display:flex;gap:8px;overflow-x:auto;padding:4px 2px 8px;">${thumbs}</div>
    <div class="ch-act-btns"><button class="ch-act-no">Not now</button><button class="ch-act-ok">Launch them</button></div>
    <div class="ch-act-res"></div>`;
  const ok = card.querySelector(".ch-act-ok"), no = card.querySelector(".ch-act-no"), res = card.querySelector(".ch-act-res");
  no.onclick = () => { card.querySelector(".ch-act-btns").remove(); res.textContent = "Dismissed."; res.style.color = "var(--muted)"; chInboxResolve(p.inbox_id, "dismissed"); };
  ok.onclick = async () => {
    ok.disabled = no.disabled = true; ok.textContent = "Launching…";
    try {
      await bvWalletGate();
      const r = await fetch(`${SUPA_URL}/functions/v1/ai-auto-launch-tests`, { method: "POST", headers: { Authorization: `Bearer ${sessionData?.access_token || ANON}`, "Content-Type": "application/json" }, body: JSON.stringify({ creative_ids: p.creative_ids }) }).then(x => x.json());
      if (r.error) throw new Error(r.error);
      card.classList.add("done"); card.querySelector(".ch-act-btns").remove();
      res.textContent = r.message === "No pending creatives to launch" ? "These were already launched." : "✅ Sent to Meta. I'll announce it here when it's live and keep watching it."; res.style.color = "#30d158";
      chInboxResolve(p.inbox_id, "done");
    } catch (err) {
      card.classList.add("fail"); ok.disabled = no.disabled = false; ok.textContent = "Try again";
      res.textContent = "❌ " + (err.message || "Couldn't launch."); res.style.color = "#ff453a";
    }
  };
  msgs.appendChild(card);
  msgs.scrollTop = msgs.scrollHeight;
}

// The AI speaks first: things its 5-minute watcher noticed show up here (and as a push).
const chInboxShown = new Set();
const CH_INBOX_ICON = { kill_suggestion: "⚠️", auto_killed: "⏸", campaign_live: "🚀", launch_suggestion: "🎨", info: "💬" };
async function chLoadInbox() {
  if (!sessionData?.user?.id) return;
  let rows = [];
  try { rows = await sbQuery("ai_inbox", "select=*&order=created_at.desc&limit=30"); } catch { return; }
  if (!Array.isArray(rows)) return;
  const fresh = rows.filter(r => !chInboxShown.has(r.id)).reverse();
  if (chatOpen) {
    const msgs = document.getElementById("chMsgs");
    for (const r of fresh) {
      chInboxShown.add(r.id);
      const t = document.createElement("div");
      t.className = "ch-time";
      t.textContent = new Date(r.created_at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      msgs.appendChild(t);
      chLastTs = Date.now(); // the stamp above already labels this one
      const showBody = r.body && !(r.kind === "kill_suggestion" && r.status === "open" && r.payload?.object_id);
      const b = appendMsg(`${CH_INBOX_ICON[r.kind] || "💬"} **${r.title}**${showBody ? "\n" + r.body : ""}`, "bot");
      b.style.maxWidth = "92%";
      if (r.kind === "kill_suggestion" && r.status === "open" && r.payload?.object_id) {
        appendProposalCards([{ ...r.payload, inbox_id: r.id }]);
      } else if (r.kind === "launch_suggestion" && r.status === "open" && r.payload?.creative_ids?.length) {
        appendLaunchCard({ ...r.payload, inbox_id: r.id });
      } else if (r.kind === "launch_suggestion" && r.status !== "open") {
        const n = document.createElement("div");
        n.className = "ch-time"; n.style.margin = "0 0 6px";
        n.textContent = r.status === "done" ? "✅ Launched" : r.status === "dismissed" ? "Dismissed" : "";
        msgs.appendChild(n);
      } else if (r.kind === "kill_suggestion" && r.status !== "open") {
        const n = document.createElement("div");
        n.className = "ch-time"; n.style.margin = "0 0 6px";
        n.textContent = r.status === "done" ? "✅ Paused" : r.status === "dismissed" ? "Dismissed" : "";
        msgs.appendChild(n);
      }
    }
    msgs.scrollTop = msgs.scrollHeight;
    const unread = rows.filter(r => !r.read_at).map(r => r.id);
    if (unread.length) { try { await supabaseClient.from("ai_inbox").update({ read_at: new Date().toISOString() }).in("id", unread); } catch {} }
    chUnread = 0;
  } else {
    chUnread = rows.filter(r => !r.read_at).length;
  }
  chToggleIcon();
}

let chBusy = false;