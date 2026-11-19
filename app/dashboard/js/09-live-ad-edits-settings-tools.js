// Revora dashboard, part 09 of 23: change the WhatsApp greeting + pre-filled message of live ads · KILL RULES (Settings) · AI SALES AGENT (per WhatsApp number) · TRANSFER PIN (Settings → Security) · CUSTOM DOMAINS (Settings)

// ── change the WhatsApp greeting + pre-filled message of live ads ──
function amOpenMsgEdit(adId) {
  const ad = amAdById(adId); if (!ad) return;
  const wa = am.data.ads.filter(a => a.wa_prefill != null);
  const sameSet = wa.filter(a => a.adset_id === ad.adset_id);
  const sameCamp = wa.filter(a => a.campaign_id === ad.campaign_id);
  const sameMsg = wa.filter(a => a.wa_prefill === ad.wa_prefill && a.wa_greeting === ad.wa_greeting);
  const opt = (v, label, n) => n > 1 || v === "one" ? `<option value="${v}">${label}${v === "one" ? "" : ` (${n})`}</option>` : "";
  bvOpenSheet("amMsgOverlay", `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('amMsgOverlay')">✕</button>
    <div class="ph-title" style="margin-bottom:4px;">WhatsApp message</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">${escH(ad.name)}</div>
    <div class="field"><label>Greeting <span style="font-weight:400;color:var(--muted);">(what the customer sees when the chat opens · max 300)</span></label>
      <textarea id="amMsgGreeting" rows="3" maxlength="300">${escH(ad.wa_greeting || "")}</textarea></div>
    <div class="field" style="margin-top:12px;"><label>Pre-filled message <span style="font-weight:400;color:var(--muted);">(already typed in the customer's message box · max 1000)</span></label>
      <textarea id="amMsgPrefill" rows="3" maxlength="1000">${escH(ad.wa_prefill || "")}</textarea></div>
    <div class="field" style="margin-top:12px;"><label>Apply to</label>
      <select id="amMsgScope">
        ${opt("one", "Only this ad", 1)}${opt("set", "All WhatsApp ads in this ad set", sameSet.length)}${opt("camp", "All WhatsApp ads in this campaign", sameCamp.length)}${opt("same", "All ads with the same message as this one", sameMsg.length)}
      </select></div>
    <div style="font-size:11.5px;color:var(--warn);background:var(--warnBg);border:1px solid var(--warnBdr);border-radius:8px;padding:9px 11px;margin-top:12px;">
      Meta can't edit a running ad's message in place, so each ad gets a new copy of itself with the new message. Meta may re-check the ad for a few minutes; its history and numbers stay on the same ad.</div>
    <div id="amMsgResult" style="margin-top:10px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button type="button" class="btn btn-g" onclick="bvCloseSheet('amMsgOverlay')">Cancel</button>
      <button type="button" class="btn btn-a" id="amMsgSave" onclick="amSaveMsg('${adId}')">Save on Meta</button>
    </div>`, 560);
}

async function amSaveMsg(adId) {
  const ad = amAdById(adId); if (!ad) return;
  const greeting = document.getElementById("amMsgGreeting").value.trim();
  const prefill = document.getElementById("amMsgPrefill").value.trim();
  const out = document.getElementById("amMsgResult");
  if (!greeting || !prefill) { out.innerHTML = `<div class="msg err" style="display:block;">Type both the greeting and the pre-filled message.</div>`; return; }
  const scope = document.getElementById("amMsgScope").value;
  const wa = am.data.ads.filter(a => a.wa_prefill != null);
  const targets = scope === "set" ? wa.filter(a => a.adset_id === ad.adset_id)
    : scope === "camp" ? wa.filter(a => a.campaign_id === ad.campaign_id)
    : scope === "same" ? wa.filter(a => a.wa_prefill === ad.wa_prefill && a.wa_greeting === ad.wa_greeting)
    : [ad];
  if (targets.length > 20) { out.innerHTML = `<div class="msg err" style="display:block;">That is ${targets.length} ads — change at most 20 at a time.</div>`; return; }
  const btn = document.getElementById("amMsgSave");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Saving…';
  out.innerHTML = "";
  const r = await amCall({ action: "set_ad_message", ad_account_id: activeAccountId, ad_ids: targets.map(t => t.id), greeting, prefill });
  btn.disabled = false; btn.textContent = "Save on Meta";
  if (!r || r.results == null) { out.innerHTML = `<div class="msg err" style="display:block;">❌ ${escH(r?.error || "Could not reach Meta.")}</div>`; return; }
  for (const x of r.results) {
    const row = amAdById(x.id);
    if (x.ok && row) { row.wa_greeting = x.wa_greeting; row.wa_prefill = x.wa_prefill; row.effective_status = x.effective_status; }
  }
  const failed = r.results.filter(x => !x.ok);
  amDraw();
  if (!failed.length) {
    bvCloseSheet("amMsgOverlay");
    bvToast(`Message updated on Meta for ${r.results.length} ad${r.results.length === 1 ? "" : "s"}.`);
    amQuietRefresh();
  } else {
    out.innerHTML = `<div class="msg err" style="display:block;">❌ ${failed.length} of ${r.results.length} ads could not be changed:<br>${failed.map(f => escH((amAdById(f.id)?.name || f.id) + " — " + f.error)).join("<br>")}</div>`;
  }
}

function amSetLevel(l) { am.level = l; amDraw(); }
// Phones: tapping anywhere on a campaign / ad set card opens it (switches, links and checkboxes keep their own job).
function amTapRow(e, level, id) {
  if (!mobileMq.matches || e.target.closest("input,label,a,button,select")) return;
  amDrill(level, id);
}
// Phone back button: ads -> the campaign's ad sets -> all campaigns.
function amBack() {
  if (am.level === "ads" && am.sel.adsets.size) { am.sel.adsets.clear(); am.level = "adsets"; }
  else { am.sel = { campaigns: new Set(), adsets: new Set() }; am.level = "campaigns"; }
  amDraw(); window.scrollTo({ top: 0 });
}
function amSetFilter(f) { am.filter = f; am.at = 0; amFetch(); }
function amSetRange(r) { if (!r) return; am.range = r; am.at = 0; amFetch(); }
function amToggleSel(level, id, on) {
  on ? am.sel[level].add(id) : am.sel[level].delete(id);
  if (level === "campaigns") amPruneSelection();
  amDraw();
}
function amSelectAll(level, on) {
  const rows = amRows(level);
  rows.forEach(r => on ? am.sel[level].add(r.id) : am.sel[level].delete(r.id));
  if (level === "campaigns") amPruneSelection();
  amDraw();
}
function amClearSel(level) {
  am.sel[level].clear();
  if (level === "campaigns") am.sel.adsets.clear();
  amDraw();
}
function amDrill(level, id) {
  if (level === "campaigns") { am.sel = { campaigns: new Set([id]), adsets: new Set() }; am.level = "adsets"; }
  else if (level === "adsets") {
    const s = am.data.adsets.find(x => x.id === id);
    am.sel = { campaigns: new Set(s ? [s.campaign_id] : []), adsets: new Set([id]) }; am.level = "ads";
  }
  amDraw();
  window.scrollTo({ top: 0 });
}

function amFind(level, id) {
  const d = am.data;
  return (level === "campaign" ? d.campaigns : level === "adset" ? d.adsets : d.ads).find(r => r.id === id);
}

// The switch flips visually first; pausing a whole campaign/ad set asks first
// because it stops everything inside it.
function amSwitch(level, id, input) {
  const turnOn = input.checked;
  const r = amFind(level, id); if (!r) return;
  if (turnOn || level === "ad") return amSetStatus(level, id, turnOn ? "ACTIVE" : "PAUSED");
  const live = level === "campaign"
    ? am.data.adsets.filter(s => s.campaign_id === id && s.status === "ACTIVE").length
    : am.data.ads.filter(a => a.adset_id === id && a.status === "ACTIVE").length;
  const what = level === "campaign" ? "campaign" : "ad set";
  const inner = level === "campaign" ? "ad sets" : "ads";
  bvModal(`Pause this ${what}?`, `
    <div style="font-size:13px;color:var(--text2);margin-bottom:14px;"><b>${escH(r.name)}</b><br>${live} live ${inner} inside will stop delivering. You can turn it back on any time.</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-g" onclick="bvCloseModal();amDraw()">Cancel</button>
      <button class="btn btn-a" style="background:var(--danger);border-color:var(--danger);" onclick="bvCloseModal();amSetStatus('${level}','${id}','PAUSED')">Pause on Meta</button>
    </div>`);
}

async function amSetStatus(level, id, status, reason) {
  const r = amFind(level, id); if (!r) return;
  am.busy.add(id); amDraw();
  const res = await sbFn("ads-manager", { action: "set_status", level, object_id: id, status, reason });
  am.busy.delete(id);
  if (res && res.ok) {
    r.status = res.status; r.effective_status = res.effective_status;
    const also = (res.cascaded || []).map((c) => (c.level === "adset" ? "ad set " : "campaign ") + c.name);
    bvToast(`${status === "PAUSED" ? "Paused" : "Turned on"} on Meta: ${r.name}` + (also.length ? `. Also switched off ${also.join(" and ")}, because nothing live was left in ${also.length > 1 ? "them" : "it"}.` : ""));
    amDraw();
    amQuietRefresh();
  } else {
    bvToast(res?.error || "Meta did not accept that change.", "err");
    amDraw();
  }
}

// After a switch, parents/children change delivery too (a paused campaign
// pauses everything inside it) -- pull Meta's truth without a spinner.
async function amQuietRefresh() {
  const my = ++am.req;
  const key = amKey();
  const r = await sbFn("ads-manager", { action: "list", range: am.range, status: am.filter });
  if (my !== am.req || !r || r.ok === false || r.error) return;
  am.data = r; am.key = key; am.at = Date.now();
  amPruneSelection();
  amDraw();
}

// ── KILL RULES (Settings) ───────────────────────────────────────────────────
const KR_KINDS = [
  { kind: "messaging", icon: "💬", title: "WhatsApp message ads", unit: "conversation", defaults: { max: 100, spend: 150, hours: 6 } },
  { kind: "purchase", icon: "🛒", title: "Website purchase ads", unit: "purchase", lpv: false, defaults: { max: 2500, spend: 3000, hours: 48, lpv: 0 } },
];

function krSummary(unit, max, spend, hours, auto, lpv) {
  return `An ad is flagged once it has spent at least ${fN(spend)} and run for ${hours}+ hours, and it either got no ${unit}s or costs more than ${fN(max)} per ${unit}${Number(lpv) > 0 ? `, or each landing page view costs more than ${fN(lpv)} (or it got none)` : ""}. ${auto ? "It is then paused automatically within 15 minutes." : "You get a warning in Campaigns and pause it yourself."}`;
}


// ── AI SALES AGENT (per WhatsApp number) ─────────────────────────────────────
// Each connected number gets its own business profile, so the AI only ever talks about THAT business.
const AI_MODE_LABEL = { off: "Off", first: "First reply only", full: "Replies to everything" };
const AI_FIELDS = ["business_name", "agent_name", "business_type", "offer", "proof", "how_to_buy", "faqs", "rules", "opener"];
let bvAiDefaultPrompt = "";
const AI_TEMPLATES = {
  media_buying: {
    label: "Media buying / Meta ads service",
    business_type: "done-for-you Meta (Facebook & Instagram) ads service",
    offer: "We run Meta (Facebook & Instagram) ads for businesses so real customers message them on WhatsApp and buy. Done-for-you: targeting, creative direction, campaign set-up, daily monitoring and optimisation.\nPrice: ₦ per week (edit me).\nTarget: 500+ valid orders (a target, not a guarantee).\nNo website needed.",
    how_to_buy: "When the customer is ready: tell them the team is sending payment details and next steps now (mark hot_lead). To start we need: what they sell, product price, their WhatsApp number, state/city.",
    faqs: "Do I need a website? No — customers can message you on WhatsApp.",
    rules: "Only talk about our Meta ads service. If asked about ad spend, contract length, refunds or anything not written above: say you'll confirm with the team (needs_human). Never promise income or exact orders.",
    opener: "Hey {name} 👋 Welcome! We run Meta ads that bring real WhatsApp orders to your business.\n\nWhat do you sell? 🛒",
  },
  food: {
    label: "Food / restaurant / small chops",
    business_type: "food vendor",
    offer: "We sell: (list your menu with prices, e.g. Jollof rice + chicken — ₦3,500).\nDelivery areas & fee: (edit me).\nOpening hours: (edit me).\nOrders are confirmed once payment is made / on delivery (edit me).",
    how_to_buy: "1) Customer picks items & quantity. 2) Ask for delivery address + phone. 3) Share payment details / say pay on delivery (edit me). Mark hot_lead when they confirm an order.",
    faqs: "How long is delivery? (edit me)\nDo you do bulk/party orders? Yes — the team will confirm price (needs_human).",
    rules: "Only talk about our food and orders. Never invent menu items, prices or delivery times. Anything not written above: say you'll confirm with the team (needs_human).",
    opener: "Hey {name} 👋 Welcome! Hungry? 😋\n\nTell me what you'd like and I'll sort your order fast.",
  },
};

let bvAiNumbers = [], bvAiAgents = {};
async function bvRenderAiAgents() {
  const el = document.getElementById("aiAgentPanel"); if (!el) return;
  if (!["owner", "admin", "buyer"].includes(window.myProfile?.role)) { el.remove(); return; }
  const [nums, agents] = await Promise.all([
    sbQuery("buyer_whatsapp_numbers", "select=id,nickname,display_phone_number,media_buyer_id,media_buyers(name)&status=eq.active&order=created_at.asc").catch(() => []),
    sbQuery("ai_sales_agents", "select=*").catch(() => []),
  ]);
  bvAiNumbers = nums || []; bvAiAgents = {};
  (agents || []).forEach(a => { bvAiAgents[a.buyer_whatsapp_number_id] = a; });
  el.innerHTML = `
    <div class="ph"><div class="ph-title">🤖 AI sales agent</div></div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px;">Replies to your customers on WhatsApp within seconds, like a sharp salesperson, and closes deals. Each WhatsApp number has its own profile, so the AI only ever talks about <b>that</b> business. You get pinged for hot leads, and it steps back as soon as you reply yourself.</div>
    ${bvAiNumbers.length ? bvAiNumbers.map(n => {
      const a = bvAiAgents[n.id], mode = a?.mode || "off";
      return `<div class="ai-num"><div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:13.5px;">${escH(n.nickname || n.display_phone_number)}</div><div style="font-size:11.5px;color:var(--muted);">${escH(n.display_phone_number || "")}${n.media_buyers?.name ? " · " + escH(n.media_buyers.name) : ""}</div></div>
        <span class="ai-pill${mode !== "off" ? " on" : ""}">${AI_MODE_LABEL[mode]}</span>
        <button type="button" class="btn btn-g" style="width:auto;padding:6px 12px;font-size:12px;" onclick="bvOpenAiAgent('${n.id}')">${a ? "Edit" : "Set up"}</button></div>`;
    }).join("") : `<div class="empty" style="padding:14px;">Connect a WhatsApp number first.</div>`}`;
}

function bvAiForm(n, a) {
  const v = k => escH(a?.[k] ?? "");
  const mode = a?.mode || "off";
  const modeOpt = (m, title, sub) => `<label class="ai-mode${mode === m ? " on" : ""}"><input type="radio" name="ai_mode" value="${m}" ${mode === m ? "checked" : ""} onchange="document.querySelectorAll('.ai-mode').forEach(x=>x.classList.toggle('on',x.querySelector('input').checked))"><div><div style="font-weight:600;font-size:13px;">${title}</div><div style="font-size:11.5px;color:var(--muted);">${sub}</div></div></label>`;
  const ta = (k, label, ph, hint) => `<div class="field" style="margin-top:12px;"><label>${label}${hint ? ` <span style="font-weight:400;color:var(--muted);">${hint}</span>` : ""}</label><textarea class="ai-ta" id="ai_${k}" placeholder="${escH(ph)}">${v(k)}</textarea></div>`;
  return `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('bvAiOverlay')">✕</button>
    <div class="ph-title" style="margin-bottom:2px;">🤖 AI sales agent</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">${escH(n.nickname || "")} ${escH(n.display_phone_number || "")}</div>
    <div class="ai-modes">
      ${modeOpt("off", "Off", "The AI stays quiet. Nothing is sent.")}
      ${modeOpt("first", "First reply only", "Answers the very first message instantly, then leaves the chat to you.")}
      ${modeOpt("full", "Replies to everything", "Chats, handles doubts and closes. Steps back when you reply or when it needs you.")}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
      <span style="font-size:11.5px;color:var(--muted);">Start from a template:</span>
      ${Object.entries(AI_TEMPLATES).map(([k, t]) => `<button type="button" class="btn btn-g" style="width:auto;padding:4px 10px;font-size:11.5px;" onclick="bvAiApplyTemplate('${k}')">${escH(t.label)}</button>`).join("")}
    </div>
    <div class="fg">
      <div class="field"><label>Business name</label><input id="ai_business_name" value="${v("business_name")}" placeholder="e.g. Mella Foods"></div>
      <div class="field"><label>Name customers see</label><input id="ai_agent_name" value="${v("agent_name")}" placeholder="e.g. Sofi"></div>
    </div>
    <div class="field" style="margin-top:12px;"><label>What kind of business is it?</label><input id="ai_business_type" value="${v("business_type")}" placeholder="e.g. food vendor, Meta ads service, wig seller"></div>
    ${ta("opener", "Example of a great first reply", "Hey 👋 Welcome! We run Meta ads that bring real WhatsApp orders. What do you sell? 🛒", "— the AI matches this energy but writes every reply fresh")}
    ${ta("offer", "What you sell + prices", "List what you offer, prices, what's included, delivery or timelines…", "— the AI only states facts written here")}
    ${ta("proof", "Proof it can quote", "Results, number of customers served, testimonials you are happy to share…", "— leave empty if none; the AI won't invent any")}
    ${ta("how_to_buy", "How a customer buys / pays", "Steps to order, bank account details, what you need from them…")}
    ${ta("faqs", "Common questions & answers", "Q: … A: …")}
    ${ta("rules", "Your own rules", "e.g. Never discuss other services. Don't give discounts. Hand over if they ask for bulk.")}
    <details style="margin-top:14px;" id="aiPromptBox">
      <summary style="cursor:pointer;font-weight:600;font-size:13px;">⚙️ AI instructions (system prompt)</summary>
      <div style="font-size:11.5px;color:var(--muted);margin:6px 0;">How the AI thinks, sells and behaves. Not hard-coded: edit it freely. Your business details above are inserted where you see <code>{{business_info}}</code>, <code>{{how_to_buy}}</code>, <code>{{proof}}</code>, <code>{{faqs}}</code>, <code>{{owner_rules}}</code>, <code>{{products}}</code>, <code>{{agent_name}}</code>, <code>{{business_name}}</code>, <code>{{business_type}}</code>, <code>{{first_reply_example}}</code>, <code>{{customer_name}}</code>, <code>{{chat_source}}</code>, <code>{{time_lagos}}</code>, <code>{{conversation_state}}</code>.</div>
      <textarea class="ai-ta" id="ai_system_prompt" style="min-height:260px;font-family:ui-monospace,Menlo,monospace;font-size:12px;" placeholder="Loading…"></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
        <button type="button" class="btn btn-g" style="width:auto;padding:5px 12px;font-size:12px;" onclick="bvAiResetPrompt()">↺ Use the recommended prompt</button>
        <span style="font-size:11.5px;color:var(--muted);" id="aiPromptHint"></span>
      </div>
    </details>
    <div style="margin-top:16px;font-weight:600;font-size:13px;">Try it before you switch it on</div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px;">Type as if you were a customer. Nothing is sent to WhatsApp.</div>
    <div class="ai-chat" id="aiTestChat"></div>
    <div style="display:flex;gap:6px;margin-top:6px;">
      <input id="aiTestInput" style="flex:1;" placeholder="Hi, I'm interested…" onkeydown="if(event.key==='Enter'){event.preventDefault();bvAiTestSend();}">
      <button type="button" class="btn btn-g" id="aiTestBtn" style="width:auto;padding:6px 14px;" onclick="bvAiTestSend()">Send</button>
      <button type="button" class="btn btn-g" style="width:auto;padding:6px 10px;" onclick="bvAiTestReset()" title="Start over">↺</button>
    </div>
    <div id="aiAgentMsg" style="margin-top:10px;"></div>
    <button type="button" class="btn btn-a btn-full" style="margin-top:10px;" onclick="bvAiSave('${n.id}')">Save</button>`;
}

let bvAiTestHistory = [];
function bvOpenAiAgent(numberId) {
  const n = bvAiNumbers.find(x => x.id === numberId); if (!n) return;
  window._bvAiNumber = n;
  bvAiTestHistory = [];
  bvOpenSheet("bvAiOverlay", bvAiForm(n, bvAiAgents[numberId]), 640);
  bvAiTestReset();
  bvAiLoadPrompt(bvAiAgents[numberId]);
}
async function bvAiLoadPrompt(agent) {
  const box = document.getElementById("ai_system_prompt"); if (!box) return;
  try {
    if (!bvAiDefaultPrompt) bvAiDefaultPrompt = (await sbQuery("ai_settings", "select=value&key=eq.sales_system_prompt"))?.[0]?.value || "";
  } catch (e) { /* editor stays usable */ }
  box.value = agent?.system_prompt?.trim() ? agent.system_prompt : bvAiDefaultPrompt;
  box.placeholder = "";
  const hint = document.getElementById("aiPromptHint");
  if (hint) hint.textContent = agent?.system_prompt?.trim() ? "Custom prompt for this number." : "Using the recommended prompt.";
}
function bvAiResetPrompt() {
  if (!confirm("Replace the instructions with the recommended prompt?")) return;
  const box = document.getElementById("ai_system_prompt"); if (box) box.value = bvAiDefaultPrompt;
}
function bvAiApplyTemplate(k) {
  const t = AI_TEMPLATES[k]; if (!t) return;
  const filled = AI_FIELDS.filter(f => document.getElementById("ai_" + f)?.value.trim());
  if (filled.length > 2 && !confirm("Replace what you've typed with this template?")) return;
  ["business_type", "offer", "how_to_buy", "faqs", "rules", "opener"].forEach(f => { const el = document.getElementById("ai_" + f); if (el && t[f] != null) el.value = t[f]; });
}
function bvAiCollect() {
  const o = {};
  AI_FIELDS.forEach(f => { o[f] = document.getElementById("ai_" + f)?.value.trim() || null; });
  o.mode = document.querySelector('input[name="ai_mode"]:checked')?.value || "off";
  const sp = document.getElementById("ai_system_prompt")?.value.trim() || "";
  o.system_prompt = sp && sp !== (bvAiDefaultPrompt || "").trim() ? sp : null; // null = follow the recommended prompt
  return o;
}
function bvAiTestReset() {
  bvAiTestHistory = [];
  const box = document.getElementById("aiTestChat");
  if (box) box.innerHTML = `<div class="ai-note">Say hi as a customer 👇</div>`;
}
async function bvAiTestSend() {
  const input = document.getElementById("aiTestInput"), box = document.getElementById("aiTestChat"), btn = document.getElementById("aiTestBtn");
  const text = input.value.trim(); if (!text || btn.disabled) return;
  input.value = ""; btn.disabled = true;
  if (!bvAiTestHistory.length) box.innerHTML = "";
  bvAiTestHistory.push({ role: "user", content: text });
  box.insertAdjacentHTML("beforeend", `<div class="ai-b me">${escH(text)}</div><div class="ai-b bot" id="aiTyping">…</div>`);
  box.scrollTop = box.scrollHeight;
  try {
    const r = await sbFn("ai-sales-reply", { test: true, agent: bvAiCollect(), history: bvAiTestHistory, contact_name: "Chuka" });
    document.getElementById("aiTyping")?.remove();
    if (r.error) throw new Error(r.error);
    (r.messages || []).forEach(m => { bvAiTestHistory.push({ role: "assistant", content: m }); box.insertAdjacentHTML("beforeend", `<div class="ai-b bot">${escH(m)}</div>`); });
    if (r.cta) box.insertAdjacentHTML("beforeend", `<div class="ai-b bot" style="padding:0;overflow:hidden;"><div style="padding:8px 14px;text-align:center;color:#1a7a5a;font-weight:600;font-size:13px;border-top:1px solid var(--border);">🔗 ${escH(r.cta.label)}</div></div>`);
    const note = r.notify === "hot_lead" ? "🔥 You'd get a hot-lead alert" : r.notify === "needs_human" ? "🙋 It would hand this chat to you" : r.stop ? "⛔ It would stop replying (not a buyer)" : "";
    if (note) box.insertAdjacentHTML("beforeend", `<div class="ai-note">${note}${r.reason ? " — " + escH(r.reason) : ""}</div>`);
    if (!(r.messages || []).length) box.insertAdjacentHTML("beforeend", `<div class="ai-note">(no reply needed)</div>`);
  } catch (e) {
    document.getElementById("aiTyping")?.remove();
    box.insertAdjacentHTML("beforeend", `<div class="ai-note" style="color:var(--red,#c0392b);">${escH(e.message)}</div>`);
  }
  box.scrollTop = box.scrollHeight; btn.disabled = false; input.focus();
}
async function bvAiSave(numberId) {
  const msg = document.getElementById("aiAgentMsg");
  const n = bvAiNumbers.find(x => x.id === numberId); if (!n) return;
  const o = bvAiCollect();
  if (o.mode !== "off" && !o.offer) { msg.innerHTML = `<div class="msg err" style="display:block;">Add what you sell and your prices first, otherwise the AI has nothing true to say.</div>`; return; }
  try {
    const companyId = window.myProfile?.company_id || bvAiAgents[numberId]?.company_id;
    const row = { ...o, company_id: companyId, buyer_whatsapp_number_id: numberId, updated_at: new Date().toISOString(), updated_by: sessionData?.user?.id };
    const { error } = await supabaseClient.from("ai_sales_agents").upsert(row, { onConflict: "buyer_whatsapp_number_id" });
    if (error) throw error;
    bvCloseSheet("bvAiOverlay");
    bvToast(o.mode === "off" ? "Saved. AI is off for this number." : "Saved. AI is ON for " + (n.nickname || "this number") + ".");
    bvRenderAiAgents();
  } catch (e) {
    msg.innerHTML = `<div class="msg err" style="display:block;">${escH(e.message || String(e))}</div>`;
  }
}


// Approved Meta payment account names: with at least one, a top-up transfer is only sent to an account whose
// bank-resolved name matches one of them exactly (see paystack-transfer-to-meta).
async function bvRenderTransferNames() {
  const el = document.getElementById("transferNamesPanel"); if (!el) return;
  const rows = await sbQuery("transfer_allowed_names", "select=id,account_name,created_at&order=created_at.asc").catch(() => []);
  el.innerHTML = `
    <div class="ph"><div class="ph-title">Approved Meta payment accounts</div><div class="ph-count">${rows.length ? rows.length + " approved" : "not set"}</div></div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Money for ad top-ups is only sent to an account whose bank-verified name is on this list, exactly as the bank shows it (for example <b>FACEBOOK NIGERIA LIMITED</b>). ${rows.length ? "" : "Until you add one, any account clearly named Facebook or Meta Platforms is accepted."} If a transfer is refused, the message shows the name the bank returned. Add it here only if you are sure it is Meta's billing account.</div>
    ${rows.length ? `<div class="tbl-wrap"><table><tr><th>Account name</th><th></th></tr>${rows.map(r => `<tr><td class="s n">${escH(r.account_name)}</td><td><button class="btn btn-g tn-del" data-id="${r.id}" style="padding:3px 9px;font-size:10px;">Remove</button></td></tr>`).join("")}</table></div>` : ""}
    <form id="tnForm" style="display:flex;gap:6px;margin-top:10px;"><input id="tnName" required placeholder="Exact account name, e.g. FACEBOOK NIGERIA LIMITED" style="flex:1;"><button class="btn btn-a" type="submit" style="width:auto;">Add</button></form>`;
  el.querySelectorAll(".tn-del").forEach(b => b.onclick = async () => {
    if (!confirm("Remove this approved account name?")) return;
    const { error } = await supabaseClient.from("transfer_allowed_names").delete().eq("id", b.dataset.id);
    if (error) return bvToast(error.message, "err");
    bvRenderTransferNames();
  });
  document.getElementById("tnForm").onsubmit = async ev => {
    ev.preventDefault();
    const name = document.getElementById("tnName").value.trim();
    if (name.length < 3) return;
    const { error } = await supabaseClient.from("transfer_allowed_names").insert({ account_name: name });
    if (error) return bvToast(/duplicate|unique/i.test(error.message) ? "That name is already on the list." : error.message, "err");
    bvToast("Added"); bvRenderTransferNames();
  };
}

// ── TRANSFER PIN (Settings → Security) ────────────────────────────────────────
// The PIN that approves money sent through ChatGPT / Claude. It is checked by the server (hashed, locks after 5 wrong tries) and is only
// ever typed here or on approve.html, never into an AI chat.
async function bvPinApi(path, body) {
  const r = await fetch(`${SUPA_URL}/functions/v1/mcp${path}`, { method: "POST", headers: { Authorization: `Bearer ${sessionData?.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({ error: "Something went wrong." }));
  return { ok: r.ok, j };
}
async function bvRenderPinPanel() {
  const el = document.getElementById("pinPanel"); if (!el) return;
  const st = await bvPinApi("/pin/status");
  const has = !!st.j?.has_pin;
  el.innerHTML = `
    <div class="ph"><div class="ph-title">Transfer PIN</div><div class="ph-count">${has ? "set" : "not set"}</div></div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Money sent through ChatGPT or Claude needs this PIN. You type it on a private Revora page, never in the chat, so the AI cannot see it. Use 4 to 6 digits.</div>
    <form id="pinForm" autocomplete="off" style="max-width:320px;">
      ${has ? `<div class="field"><label>Current PIN</label><input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" id="pinCur" placeholder="Current PIN"></div>
      <div style="font-size:11px;color:var(--muted);margin:-4px 0 8px;"><a href="#" id="pinForgot">Forgot your PIN? Use your account password instead</a></div>
      <div class="field" id="pinPwWrap" style="display:none;"><label>Account password</label><input type="password" autocomplete="current-password" id="pinPw" placeholder="Your Revora password"></div>` : ""}
      <div class="field"><label>${has ? "New PIN" : "Choose a PIN"}</label><input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" id="pinNew" placeholder="4 to 6 digits" required></div>
      <div class="field"><label>Repeat the PIN</label><input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" id="pinNew2" placeholder="Same PIN again" required></div>
      <button type="submit" class="btn btn-a" id="pinSave">${has ? "Change PIN" : "Set PIN"}</button>
      <div id="pinMsg" style="margin-top:8px;"></div>
    </form>`;
  el.querySelectorAll('input[inputmode="numeric"]').forEach(i => i.addEventListener("input", () => { i.value = i.value.replace(/\D/g, "").slice(0, 6); }));
  const forgot = document.getElementById("pinForgot");
  if (forgot) forgot.onclick = e => { e.preventDefault(); const w = document.getElementById("pinPwWrap"), c = document.getElementById("pinCur"); const on = w.style.display === "none"; w.style.display = on ? "" : "none"; c.disabled = on; if (on) c.value = ""; };
  document.getElementById("pinForm").onsubmit = async ev => {
    ev.preventDefault();
    const msg = document.getElementById("pinMsg"), btn = document.getElementById("pinSave");
    const n1 = document.getElementById("pinNew").value, n2 = document.getElementById("pinNew2").value;
    const err = t => { msg.innerHTML = `<div class="msg err" style="display:block;">${escH(t)}</div>`; };
    if (!/^\d{4,6}$/.test(n1)) return err("The PIN must be 4 to 6 digits.");
    if (n1 !== n2) return err("The two PINs do not match.");
    const body = { pin: n1 };
    if (has) {
      const pw = document.getElementById("pinPw"), cur = document.getElementById("pinCur");
      if (pw && pw.offsetParent !== null && pw.value) body.password = pw.value; else body.current_pin = cur.value;
    }
    btn.disabled = true; msg.innerHTML = "";
    const r = await bvPinApi("/pin/set", body);
    btn.disabled = false;
    ["pinNew", "pinNew2", "pinCur", "pinPw"].forEach(id => { const x = document.getElementById(id); if (x) x.value = ""; });
    if (!r.ok) return err(r.j?.error || "Could not save the PIN.");
    bvToast(has ? "PIN changed" : "PIN set"); bvRenderPinPanel();
  };
}

// ── CUSTOM DOMAINS (Settings) ─────────────────────────────────────────────────
// A domain belongs to the company; an owner/admin connects it and can assign it to a media buyer, who then
// chooses which of their sites it shows. Other sites of the company stay reachable at <domain>/s/<site-slug>.
async function bvRenderDomains() {
  const el = document.getElementById("domainsPanel"); if (!el) return;
  const role = window.myProfile?.role, isAdm = role === "owner" || role === "admin";
  if (!["owner", "admin", "buyer", "customer_care"].includes(role)) { el.remove(); return; }
  const canAdd = isAdm || (role === "buyer" && !!window.myProfile?.media_buyer_id);
  const [rows, sites, buyers] = await Promise.all([
    sbQuery("site_domains", "select=*&order=created_at.desc").catch(() => []),
    sbQuery("sites", "select=id,name,slug,media_buyer_id&order=name.asc").catch(() => []),
    isAdm ? sbQuery("media_buyers", "select=id,code,name&order=code.asc").catch(() => []) : [],
  ]);
  const buyerName = id => { const b = (buyers || []).find(x => x.id === id); return b ? (b.name || b.code) : ""; };
  const badge = st => st === "active" ? `<span class="badge-ok" style="color:var(--green,#16a34a);font-weight:700;">● Live</span>` : st === "error" ? `<span style="color:var(--red,#dc2626);font-weight:700;">● Problem</span>` : `<span style="color:var(--amber,#d97706);font-weight:700;">● Waiting for DNS</span>`;
  const siteOpts = sel => `<option value="">— none —</option>` + (sites || []).map(x => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${escH(x.name)}</option>`).join("");
  const buyerOpts = sel => `<option value="">Whole company</option>` + (buyers || []).map(x => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${escH(x.name || x.code)}</option>`).join("");
  el.innerHTML = `
    <div class="ph"><div class="ph-title">Domains</div><div class="ph-count">${(rows || []).length}</div></div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:12px;">Show your websites on your own domain (like <b>shop.mybrand.com</b>). One domain can serve several sites: connect each name separately (<b>shop.</b>mybrand.com, <b>offers.</b>mybrand.com), or open any site of yours at <b>mybrand.com/s/site-name</b>.</div>
    ${(rows || []).length ? `<div class="tbl-wrap"><table>
      <tr><th>Domain</th><th>Status</th><th>Shows site</th>${isAdm ? "<th>Assigned to</th>" : ""}<th></th></tr>
      ${rows.map(d => `<tr data-dom="${d.id}">
        <td><b>${escH(d.hostname)}</b>${d.last_error ? `<div style="font-size:10.5px;color:var(--muted);">${escH(d.last_error)}</div>` : ""}</td>
        <td>${badge(d.status)}</td>
        <td><select class="dom-site" style="max-width:170px;">${siteOpts(d.site_id)}</select></td>
        ${isAdm ? `<td><select class="dom-buyer" style="max-width:150px;">${buyerOpts(d.media_buyer_id)}</select></td>` : ""}
        <td style="white-space:nowrap;"><button class="btn btn-g dom-check" style="padding:3px 9px;font-size:10px;">Check</button>
          ${isAdm || (canAdd && d.media_buyer_id === window.myProfile?.media_buyer_id) ? `<button class="btn btn-g dom-del" style="padding:3px 9px;font-size:10px;">Remove</button>` : ""}</td>
      </tr>
      ${d.status !== "active" ? `<tr><td colspan="${isAdm ? 5 : 4}" style="background:var(--bg2,rgba(0,0,0,.03));font-size:11.5px;">
        <b>At your domain provider, add:</b>
        ${(d.dns || []).map(r => `<div style="font-family:monospace;margin-top:3px;">${escH(r.type)} &nbsp; ${escH(r.name)} &nbsp; → &nbsp; ${escH(r.value)}</div>`).join("")}
        <div style="color:var(--muted);margin-top:4px;">It can take a few minutes (sometimes a few hours) to go live. Press <b>Check</b> afterwards.</div></td></tr>` : ""}`).join("")}
    </table></div>` : `<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">No domains yet.</div>`}
    ${canAdd ? `
    <form id="domAddForm" style="margin-top:14px;">
      <div class="fg">
        <div class="field"><label>Domain *</label><input id="domHost" required placeholder="shop.mybrand.com"></div>
        ${isAdm ? `<div class="field"><label>Assign to media buyer</label><select id="domBuyer">${buyerOpts("")}</select></div>` : ""}
        <div class="field"><label>Shows site</label><select id="domSite">${siteOpts("")}</select></div>
      </div>
      <button type="submit" class="btn btn-a btn-full" style="margin-top:10px;">+ Connect domain</button>
      <div id="domMsg"></div>
    </form>
    <div style="font-size:11.5px;color:var(--muted);margin-top:12px;">Don't own a domain yet? Buy one, then connect it above:
      <a href="https://www.namecheap.com/domains/" target="_blank" rel="noopener">Namecheap</a> ·
      <a href="https://porkbun.com/" target="_blank" rel="noopener">Porkbun</a> ·
      <a href="https://vercel.com/domains" target="_blank" rel="noopener">Vercel Domains</a> ·
      <a href="https://www.godaddy.com/domains" target="_blank" rel="noopener">GoDaddy</a></div>` : ""}`;
  const call = async (body, btn) => {
    if (btn) { btn.disabled = true; }
    const r = await sbFn("manage-domain", body);
    if (btn) btn.disabled = false;
    if (r.error) { bvToast(r.error, "err"); return null; }
    return r;
  };
  el.querySelectorAll("tr[data-dom]").forEach(tr => {
    const id = tr.dataset.dom;
    tr.querySelector(".dom-site").onchange = async e => { if (await call({ action: "assign", id, site_id: e.target.value || null })) bvToast("Saved"); };
    const bsel = tr.querySelector(".dom-buyer");
    if (bsel) bsel.onchange = async e => { if (await call({ action: "assign", id, media_buyer_id: e.target.value || null })) bvToast("Saved"); };
    tr.querySelector(".dom-check").onclick = async e => { if (await call({ action: "check", id }, e.target)) bvRenderDomains(); };
    const del = tr.querySelector(".dom-del");
    if (del) del.onclick = async e => { if (confirm("Remove this domain? Pages on it will stop loading.") && await call({ action: "remove", id }, e.target)) bvRenderDomains(); };
  });
  const f = document.getElementById("domAddForm");
  if (f) f.onsubmit = async ev => {
    ev.preventDefault();
    const btn = f.querySelector("button[type=submit]");
    const r = await call({ action: "add", hostname: document.getElementById("domHost").value, media_buyer_id: document.getElementById("domBuyer")?.value || null, site_id: document.getElementById("domSite").value || null }, btn);
    if (r) { bvToast("Domain added — now add the DNS record shown below"); bvRenderDomains(); }
  };
}

async function bvRenderKillRules() {
  const el = document.getElementById("killRulesPanel"); if (!el) return;
  if (!["owner", "admin", "buyer"].includes(window.myProfile?.role)) { el.remove(); return; }
  const uid = sessionData?.user?.id;
  const [rows, logs, capRows] = await Promise.all([
    sbQuery("kill_rules", `select=*&profile_id=eq.${uid}`).catch(() => []),
    sbQuery("ad_kill_log", "select=*&order=created_at.desc&limit=8").catch(() => []),
    sbQuery("spend_caps", `select=*&profile_id=eq.${uid}`).catch(() => []),
  ]);
  const capBy = Object.fromEntries((capRows || []).map((r) => [r.level, r]));
  const byKind = Object.fromEntries((rows || []).map(r => [r.kind, r]));
  el.innerHTML = `
    <div class="ph"><div class="ph-title">Ad kill rules</div></div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:14px;">Set when an ad should be killed, separately for WhatsApp-message ads and website-purchase ads. These rules are yours; other team members set their own.</div>
    ${(() => {
      const r = byKind.purchase || {}, on = !!r.lpv_enabled, auto = !!r.lpv_auto_kill;
      const limit = Number(r.max_cost_per_lpv) > 0 ? Number(r.max_cost_per_lpv) : "", spend = Number(r.lpv_min_spend ?? r.min_spend ?? 0) || 1000;
      return `<div class="kr-block" id="kr_lpv" style="border:1px solid var(--accent);border-radius:14px;padding:14px;margin-bottom:14px;">
        <div class="kr-title">🌐 Landing page view cost limit</div>
        <div style="font-size:11.5px;color:var(--muted);margin:2px 0 10px;">For website ads. Kill an ad that has no purchases when each landing page view costs more than your limit, or when it spent money and nobody reached the page. An ad that got a purchase is never killed by this. It works on its own and does not need the purchase rule below.</div>
        <div class="kr-switches">
          <label class="kr-sw"><span class="switch"><input type="checkbox" class="lpv-on" ${on ? "checked" : ""}><span class="sw-track"></span></span> Use this limit</label>
          <label class="kr-sw"><span class="switch"><input type="checkbox" class="lpv-auto" ${auto ? "checked" : ""}><span class="sw-track"></span></span> Pause automatically</label>
        </div>
        <div class="fg" style="grid-template-columns:repeat(2,minmax(0,1fr));">
          <div class="field"><label>Max cost per landing page view (₦)</label><input type="number" min="1" class="lpv-max" value="${limit}" placeholder="e.g. 150"></div>
          <div class="field"><label>Judge an ad after it spent (₦)</label><input type="number" min="0" class="lpv-spend" value="${spend}"></div>
        </div>
        <div class="lpv-sum" style="font-size:11.5px;color:var(--muted);margin:8px 0 10px;"></div>
        <button type="button" class="btn btn-a" style="padding:6px 14px;" onclick="bvSaveLpvRule()">Save landing page view limit</button>
        <span class="kr-msg" id="krMsg_lpv"></span>
      </div>`;
    })()}
    ${KR_KINDS.map(k => {
      const r = byKind[k.kind];
      const v = r || { enabled: false, auto_kill: false, max_cost_per_result: k.defaults.max, min_spend: k.defaults.spend, min_hours: k.defaults.hours };
      return `
      <div class="kr-block" id="kr_${k.kind}">
        <div class="kr-title">${k.icon} ${k.title}</div>
        <div class="kr-switches">
          <label class="kr-sw"><span class="switch"><input type="checkbox" class="kr-enabled" ${v.enabled ? "checked" : ""}><span class="sw-track"></span></span> Use this rule${r ? "" : " <span class=\"kr-note\">(not set up yet)</span>"}</label>
          <label class="kr-sw"><span class="switch"><input type="checkbox" class="kr-auto" ${v.auto_kill ? "checked" : ""}><span class="sw-track"></span></span> Pause automatically</label>
        </div>
        ${k.kind === "purchase" ? `<div class="kr-switches" style="margin-top:6px;"><label class="kr-sw"><span class="switch"><input type="checkbox" class="kr-skip" ${v.skip_if_purchase ? "checked" : ""}><span class="sw-track"></span></span> Never pause an ad that has a purchase <span class="kr-note">(only ads with no purchases are judged)</span></label></div>` : ""}
        <div class="fg" style="grid-template-columns:repeat(3,minmax(0,1fr));">
          <div class="field"><label>Max cost per ${k.unit} (₦)</label><input type="number" min="1" class="kr-max" value="${Number(v.max_cost_per_result)}"></div>
          <div class="field"><label>Judge after it spent (₦)</label><input type="number" min="0" class="kr-spend" value="${Number(v.min_spend)}"></div>
          <div class="field"><label>Judge after running (hours)</label><input type="number" min="0" class="kr-hours" value="${Number(v.min_hours)}"></div>
        </div>
        ${k.lpv ? `<div class="fg" style="grid-template-columns:minmax(0,1fr);margin-top:10px;"><div class="field"><label>Max cost per landing page view (₦) <span style="color:var(--muted);font-weight:400">· leave empty or 0 to switch this off</span></label><input type="number" min="0" class="kr-lpv" value="${Number(v.max_cost_per_lpv || 0) || ""}" placeholder="e.g. 150"></div></div>` : ""}
        <div class="kr-sum" style="font-size:11.5px;color:var(--muted);margin:8px 0 10px;">${krSummary(k.unit, v.max_cost_per_result, v.min_spend, v.min_hours, v.auto_kill, k.lpv ? v.max_cost_per_lpv : 0)}</div>
        <button type="button" class="btn btn-a" style="padding:6px 14px;" onclick="bvSaveKillRule('${k.kind}')">Save ${k.kind === "messaging" ? "message" : "purchase"} rule</button>
        <span class="kr-msg" id="krMsg_${k.kind}"></span>
      </div>`;
    }).join("")}
    <div class="kr-block" id="kr_caps">
      <div class="kr-title">Spend limits</div>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">A campaign is switched off once <b>all its ad sets and ads together</b> have spent its limit <b>and have no purchases</b> (or no WhatsApp conversations, for message ads). A campaign that has sold keeps running: your ad kill rules above judge its cost. An ad set works the same way. Checked every 5 minutes, so a campaign can go a little over before it stops.</div>
      ${[["campaign", "Campaign limit (₦)", "Switch a campaign off after it has spent"], ["adset", "Ad set limit (₦)", "Switch an ad set off after it has spent"]].map(([lvl, lbl]) => { const c = capBy[lvl]; return `
      <div class="kr-switches"><label class="kr-sw"><span class="switch"><input type="checkbox" class="cap-on" data-l="${lvl}" ${c?.enabled ? "checked" : ""}><span class="sw-track"></span></span> ${lbl.replace(" (₦)", "")}</label></div>
      <div class="fg" style="grid-template-columns:minmax(0,1fr);margin-bottom:8px;"><div class="field"><label>${["campaign", "adset"].includes(lvl) ? "Switch off at this spend if it has no purchases (₦)" : ""}</label><input type="number" min="1" class="cap-max" data-l="${lvl}" value="${c ? Number(c.max_spend_naira) : ""}" placeholder="e.g. 10000"></div></div>`; }).join("")}
      <div style="font-size:11.5px;color:var(--muted);margin:4px 0 10px;">Also on by default: when the last live ad in an ad set is turned off, the ad set is switched off too, and when the last live ad set in a campaign is off, the campaign is too. An ad set with other live ads keeps running.</div>
      <button type="button" class="btn btn-a" style="padding:6px 14px;" onclick="bvSaveSpendCaps()">Save spend limits</button> <span class="kr-msg" id="krMsg_caps"></span>
    </div>
    ${logs?.length ? `
      <div class="ph" style="margin-top:18px;"><div class="ph-title" style="font-size:14px;">Recent pauses &amp; restarts</div></div>
      <div class="kr-log">${logs.map(l => `
        <div class="kr-log-r"><span class="pill ${l.source === "auto" ? "scale" : "watch"}">${l.source === "auto" ? "Auto" : "By you"}</span>
          <span class="kr-log-t"><b>${escH(l.object_name || l.meta_object_id)}</b> · ${l.level === "adset" ? "ad set" : l.level} ${l.action}${l.reason ? ` — ${escH(l.reason)}` : ""}</span>
          <span class="kr-log-d">${ago(l.created_at)}</span></div>`).join("")}</div>` : ""}`;
  const lpvBox = document.getElementById("kr_lpv");
  if (lpvBox) {
    const upd = () => {
      const g = (c) => lpvBox.querySelector(c), mx = Number(g(".lpv-max").value || 0), sp = Number(g(".lpv-spend").value || 0);
      g(".lpv-sum").textContent = !g(".lpv-on").checked ? "Off. Ads are not judged on landing page views." : mx > 0 ? `Once an ad has spent ${fN(sp)}, it is ${g(".lpv-auto").checked ? "paused for you" : "flagged for you to pause"} if it has no purchases and a landing page view costs more than ${fN(mx)}, or it got no views at all. Ads with a purchase are left alone.` : "Enter the most you will pay for one landing page view.";
    };
    lpvBox.querySelectorAll("input").forEach((i) => i.addEventListener("input", upd)); upd();
  }
  for (const k of KR_KINDS) {
    const box = document.getElementById(`kr_${k.kind}`);
    box?.querySelectorAll("input").forEach(i => i.addEventListener("input", () => {
      const g = c => box.querySelector(c);
      g(".kr-sum").textContent = krSummary(k.unit, g(".kr-max").value || 0, g(".kr-spend").value || 0, g(".kr-hours").value || 0, g(".kr-auto").checked, k.lpv && g(".kr-lpv") ? g(".kr-lpv").value || 0 : 0);
    }));
  }
}

async function bvSaveSpendCaps() {
  const msg = document.getElementById("krMsg_caps"), rows = [];
  for (const lvl of ["campaign", "adset"]) {
    const on = document.querySelector(`.cap-on[data-l="${lvl}"]`).checked, v = Number(document.querySelector(`.cap-max[data-l="${lvl}"]`).value);
    if (on && !(v > 0)) { msg.innerHTML = `<span style="color:var(--danger);">Enter an amount above 0 for the ${lvl === "adset" ? "ad set" : "campaign"} limit, or switch it off.</span>`; return; }
    if (v > 0) rows.push({ profile_id: sessionData.user.id, company_id: window.myProfile.company_id, level: lvl, enabled: on, max_spend_naira: v, updated_at: new Date().toISOString() });
  }
  if (rows.some((r) => r.enabled) && !confirm("Turn on spend limits? Campaigns and ad sets that reach their limit will be switched off on Meta for you, without asking.")) return;
  const { error } = rows.length ? await supabaseClient.from("spend_caps").upsert(rows, { onConflict: "profile_id,level" }) : { error: null };
  msg.innerHTML = error ? `<span style="color:var(--danger);">❌ ${escH(error.message)}</span>` : `<span style="color:var(--accent);">✅ Saved</span>`;
  if (!error) setTimeout(() => { if (msg) msg.innerHTML = ""; }, 2500);
}

async function bvSaveLpvRule() {
  const box = document.getElementById("kr_lpv"); if (!box) return;
  const msg = document.getElementById("krMsg_lpv"), g = (c) => box.querySelector(c);
  const on = g(".lpv-on").checked, auto = g(".lpv-auto").checked, mx = Number(g(".lpv-max").value || 0), sp = Number(g(".lpv-spend").value || 0);
  if (on && !(mx > 0)) { msg.innerHTML = `<span style="color:var(--danger);">Enter the most you will pay per landing page view, or switch it off.</span>`; return; }
  if (!(sp >= 0)) { msg.innerHTML = `<span style="color:var(--danger);">Enter a valid amount to judge after.</span>`; return; }
  if (on && auto && !confirm("Turn on automatic pausing? Ads over this limit will be paused on Meta for you, without asking.")) return;
  const uid = sessionData.user.id, patch = { max_cost_per_lpv: mx > 0 ? mx : null, lpv_enabled: on, lpv_auto_kill: auto, lpv_min_spend: sp, updated_at: new Date().toISOString() };
  const cur = (await sbQuery("kill_rules", `select=id&profile_id=eq.${uid}&kind=eq.purchase`).catch(() => []))?.[0];
  const { error } = cur ? await supabaseClient.from("kill_rules").update(patch).eq("id", cur.id)
    : await supabaseClient.from("kill_rules").insert({ profile_id: uid, company_id: window.myProfile.company_id, kind: "purchase", enabled: false, auto_kill: false, max_cost_per_result: 2500, min_spend: 3000, min_hours: 48, ...patch });
  msg.innerHTML = error ? `<span style="color:var(--danger);">❌ ${escH(error.message)}</span>` : `<span style="color:var(--accent);">✅ Saved</span>`;
  if (!error) { am.at = 0; setTimeout(() => { if (msg) msg.innerHTML = ""; }, 2500); }
}

async function bvSaveKillRule(kind) {
  const box = document.getElementById(`kr_${kind}`); if (!box) return;
  const msg = document.getElementById(`krMsg_${kind}`);
  const g = c => box.querySelector(c);
  const max = Number(g(".kr-max").value), spend = Number(g(".kr-spend").value), hours = Number(g(".kr-hours").value);
  if (!(max > 0) || !(spend >= 0) || !(hours >= 0)) { msg.innerHTML = `<span style="color:var(--danger);">Enter valid numbers (max cost must be above 0).</span>`; return; }
  const lpvEl = g(".kr-lpv"), lpv = lpvEl ? Number(lpvEl.value || 0) : null;
  if (lpv != null && !(lpv >= 0)) { msg.innerHTML = `<span style="color:var(--danger);">The landing page view limit must be a number.</span>`; return; }
  const auto = g(".kr-auto").checked, enabled = g(".kr-enabled").checked;
  if (auto && enabled && !confirm("Turn on automatic pausing? Ads that break this rule will be paused on Meta for you, without asking.")) return;
  const { error } = await supabaseClient.from("kill_rules").upsert({
    profile_id: sessionData.user.id, company_id: window.myProfile.company_id, kind,
    enabled, auto_kill: auto, max_cost_per_result: max, min_spend: spend, min_hours: hours, ...(lpv != null ? { max_cost_per_lpv: lpv > 0 ? lpv : null } : {}), ...(g(".kr-skip") ? { skip_if_purchase: g(".kr-skip").checked } : {}), updated_at: new Date().toISOString(),
  }, { onConflict: "profile_id,kind" });
  msg.innerHTML = error ? `<span style="color:var(--danger);">❌ ${escH(error.message)}</span>` : `<span style="color:var(--accent);">✅ Saved</span>`;
  if (!error) { am.at = 0; setTimeout(() => { if (msg) msg.innerHTML = ""; }, 2500); }
}

async function renderCampaigns(el) {
  // The live Ads Manager view replaces the old DB-backed drill-down; the older
  // renderers below are kept for reference but no longer routed to.
  return renderAdsManager(el);
}
async function renderCampaignsLegacy(el) {
  if (campaignsView.level === "campaign") return renderCampaignDetail(el, campaignsView.campaignId);
  if (campaignsView.level === "adset") return renderAdSetDetail(el, campaignsView.adSetId, campaignsView.campaignId);
  return renderCampaignsList(el);
}

async function bvTriggerStructureSyncInline(btnId, msgId) {
  const btn = document.getElementById(btnId);
  const msg = document.getElementById(msgId);
  if (!btn) return;
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Syncing…';
  try {
    const r = await sbFn("sync-meta-structure", {});
    if (msg) msg.innerHTML = r.error
      ? `<div class="msg err">❌ ${r.error}</div>`
      : `<div class="msg ok">✅ Synced: ${r.summary?.campaigns ?? 0} campaigns, ${r.summary?.ad_sets ?? 0} ad sets, ${r.summary?.ads ?? 0} ads.${r.summary?.errors?.length ? ` (${r.summary.errors.length} error(s), check console)` : ""}</div>`;
    if (r.summary?.errors?.length) console.warn("sync-meta-structure errors:", r.summary.errors);
    setTimeout(render, 1200);
  } catch (e) {
    if (msg) msg.innerHTML = `<div class="msg err">❌ ${e.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "☁️ Sync from Meta"; }
  }
}

async function pullAndRefresh(btnId = "btnPull2", msgId = "campMsg") {
  const btn = document.getElementById(btnId);
  const msg = document.getElementById(msgId);
  if (!btn) return;
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Pulling…';
  try {
    const r = await sbFn("pull-meta-metrics", { ad_account_id: activeAccountId });
    if (msg) msg.innerHTML = r.error
      ? `<div class="msg err">❌ ${r.error}</div>`
      : `<div class="msg ok">✅ Metrics updated. ${r.processed ?? ""} ad sets processed.</div>`;
    if (!r.error) setTimeout(render, 1200);
  } catch(e) {
    if (msg) msg.innerHTML = `<div class="msg err">❌ ${e.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "📊 Pull & Refresh"; }
  }
}

let campaignsStatusFilter = "all"; // all | active | paused
// Meta Ads Manager's own list view is three flat tabs -- Campaigns / Ad sets /
// Ads -- each showing every row at that level across every campaign, not a
// forced drill-down. Row clicks still drill into the detail view (useful,
// kept), but you no longer have to click into a campaign just to see its ad
// sets or ads.
let campaignsFlatLevel = "campaigns"; // campaigns | adsets | ads

function bvSwitchCampaignsFlatLevel(level) {
  campaignsFlatLevel = level;
  render();
}

// Shared header: title, the three flat-level tabs, and the toolbar
// (status filter + Sync/Pull + the same "+ New Campaign" entry point as
// Creative Vault). counts is {campaigns, adsets, ads} for the tab badges.
function bvCampaignsHeader(counts) {
  const tabs = [
    { key: "campaigns", label: "Campaigns", count: counts.campaigns },
    { key: "adsets", label: "Ad sets", count: counts.adsets },
    { key: "ads", label: "Ads", count: counts.ads },
  ];
  return `
    <div class="sh">
      <div class="sh-title">Campaigns</div>
      <div class="sh-actions">
        <button class="btn btn-a" style="width:auto;padding:6px 14px;" onclick="bvOpenObjectiveGateModal()">+ Create</button>
        <button class="btn btn-g" style="width:auto;padding:6px 14px;margin-left:6px;" onclick="bvOpenDraftsModal()">📝 Drafts</button>
        <select id="campStatusFilter" style="width:auto;padding:5px 9px;font-size:12px;">
          <option value="all" ${campaignsStatusFilter === "all" ? "selected" : ""}>All</option>
          <option value="active" ${campaignsStatusFilter === "active" ? "selected" : ""}>Active</option>
          <option value="paused" ${campaignsStatusFilter === "paused" ? "selected" : ""}>Paused / ended</option>
        </select>
        <button class="btn btn-g" id="btnStructSync2">☁️ Sync from Meta</button>
        <button class="btn btn-b" id="btnPull2">📊 Pull & Refresh</button>
      </div>
    </div>
    <div id="campMsg"></div>
    <div class="bv-builder-tabs" style="margin-bottom:14px;padding:0;">
      ${tabs.map(t => `<button type="button" class="bv-tab-btn ${campaignsFlatLevel === t.key ? "active" : ""}" onclick="bvSwitchCampaignsFlatLevel('${t.key}')">${t.label} <span style="color:var(--muted);font-weight:500;">${t.count}</span></button>`).join("")}
    </div>`;
}

function bvCampaignsToolbarWire() {
  document.getElementById("campStatusFilter")?.addEventListener("change", e => { campaignsStatusFilter = e.target.value; render(); });
  document.getElementById("btnStructSync2")?.addEventListener("click", () => bvTriggerStructureSyncInline("btnStructSync2", "campMsg"));
  document.getElementById("btnPull2")?.addEventListener("click", () => pullAndRefresh("btnPull2", "campMsg"));
}