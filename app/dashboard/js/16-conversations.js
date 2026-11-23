// Revora dashboard, part 16 of 23: TAB: CONVERSATIONS (WhatsApp leads, any buyer's number) · Message bubbles

// ── TAB: CONVERSATIONS (WhatsApp leads, any buyer's number) ────────────────────
let bvConversations = [];
let bvLastMsgs = {};      // conversation_id -> latest message (preview + ticks in the chat list)
let bvListFilter = "all"; // all | unread | handoff
let bvSelectedConvId = null;
let bvRealtimeChannel = null;
// Which of the signed-in buyer's own WhatsApp numbers is selected -- "" means
// all of them. A buyer can run more than one number, switched via a dropdown
// (see the numSel select in renderConversations); owner/admin see every
// buyer's numbers in that same dropdown.
let bvSelectedNumberId = "";
function bvMatchesNumberFilter(c) {
  return !bvSelectedNumberId || c.buyer_whatsapp_number_id === bvSelectedNumberId;
}

function bvEscape(s) {
  return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function bvName(c) {
  // whatsapp_name is the customer's real WhatsApp display name, sent by Meta
  // on every inbound message -- available immediately, before any order.
  // conversation_customers.name only exists after checkout (what they typed
  // into the order form), so it's a fallback, not the primary source.
  return c.whatsapp_name || c.conversation_customers?.name || c.phone || "Unknown";
}

// WhatsApp's Cloud API does not expose customer profile pictures at all (a
// deliberate privacy limitation, confirmed against Meta's docs) -- so this is
// a real, honest initials avatar, not a fake/placeholder photo standing in
// for one that doesn't exist.
function bvAvatar(c, size) {
  const name = bvName(c);
  // Array.from keeps emoji intact; trim() can leave an empty string for a
  // whitespace-only display name, so fall back to "#" rather than throwing.
  const first = name && name !== c.phone ? Array.from(String(name).trim())[0] : "";
  const initial = first ? bvEscape(first.toUpperCase()) : "#";
  const hue = Array.from(String(c.phone || name)).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0);
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:hsl(${hue},55%,42%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.42)}px;font-weight:600;flex-shrink:0;">${initial}</div>`;
}

async function renderConversations(el) {
  const [convs, numbers] = await Promise.all([
    // current_state=MERGED is a tombstone, not a real thread -- left behind
    // when a conversation that split into duplicates (see
    // handle-whatsapp-reply's logInboundMessage fix) gets folded back into
    // one canonical row; its messages have already been moved over.
    sbQuery("conversations", "select=*,conversation_customers(name,state,city,address)&current_state=neq.MERGED&order=last_message_at.desc&limit=150"),
    sbQuery("buyer_whatsapp_numbers", "select=id,nickname,display_phone_number,media_buyer_id,media_buyers(name)&status=eq.active&order=created_at.asc").catch(() => []),
  ]);
  if (numbers && !numbers.some(n => n.id === bvSelectedNumberId)) bvSelectedNumberId = "";
  bvConversations = (convs || []).filter(bvMatchesNumberFilter);
  bvSelectedConvId = null;
  bvLastMsgs = {};
  // Latest message per chat for previews/ticks. Chunked to keep URLs short; a
  // failure just leaves the previews blank rather than breaking the tab.
  const convIds = bvConversations.map((c) => c.id);
  const chunks = [];
  for (let i = 0; i < convIds.length; i += 50) chunks.push(convIds.slice(i, i + 50));
  const lastRows = await Promise.all(chunks.map((ch) =>
    sbQuery("conversation_last_message", `select=*&conversation_id=in.(${ch.join(",")})`).catch(() => [])));
  lastRows.flat().forEach((r) => { bvLastMsgs[r.conversation_id] = r; });

  const tot  = bvConversations.length;
  const nw   = bvConversations.filter(c => c.current_state === "NEW").length;
  const eng  = bvConversations.filter(c => c.current_state === "ENGAGED" || c.current_state === "IN_QA").length;
  const done = bvConversations.filter(c => c.current_state === "COMPLETED").length;

  const numLabel = n => n.nickname || n.display_phone_number || "Unnamed number";
  el.innerHTML = `
    <div id="convTabRoot">
      <div class="sh"><div class="sh-title">Conversations</div><div class="sh-actions">
        ${numbers?.length ? `<select id="convNumSel" style="width:auto;padding:5px 9px;font-size:12px;">
          <option value="">All numbers</option>
          ${numbers.map(n => `<option value="${n.id}" ${n.id === bvSelectedNumberId ? "selected" : ""}>${escH(numLabel(n))}${n.media_buyers ? ` — ${escH(n.media_buyers.name)}` : ""}</option>`).join("")}
        </select>` : ""}
        <button class="btn btn-g" onclick="bvSupportChat()">🛟 Support</button>
        <button class="btn btn-g" onclick="render()">↺ Refresh</button></div></div>
      ${!numbers?.length ? `<div class="panel"><div style="font-size:12px;color:var(--text2);line-height:1.6;">No WhatsApp number connected yet -- add one in Settings to start receiving leads here.</div></div>` : ""}
      <div class="g4">
        <div class="kc"><div class="kc-lbl">Total</div><div class="kc-val">${tot}</div></div>
        <div class="kc"><div class="kc-lbl">New</div><div class="kc-val b">${nw}</div></div>
        <div class="kc"><div class="kc-lbl">Engaged</div><div class="kc-val w">${eng}</div></div>
        <div class="kc"><div class="kc-lbl">Completed</div><div class="kc-val a">${done}</div></div>
      </div>
      <div class="conv-wrap">
        <div class="panel" style="padding:0;" id="convListPanel">
          <div class="conv-search"><input id="convSearch" placeholder="Search name or phone…" oninput="bvFilterList()"></div>
          <div class="conv-chips" id="convChips"></div>
          <div class="conv-list-items" id="convListItems"></div>
        </div>
        <div class="panel conv-thread" id="convThread">
          <div class="empty"><div class="empty-ico" style="display:flex;justify-content:center;">${icon("chat",28)}</div>Select a conversation to view messages</div>
        </div>
      </div>
    </div>`;

  document.getElementById("convNumSel")?.addEventListener("change", e => { bvSelectedNumberId = e.target.value; renderConversations(el); });

  bvRenderList(bvConversations);
  bvSubscribeRealtime();

  // Arrived from a notification (?open=conv:<id>): jump straight into that chat.
  if (window.bvPendingConv) {
    const id = window.bvPendingConv;
    window.bvPendingConv = null;
    if (bvConversations.some((c) => c.id === id)) bvSelectConversation(id);
  }
}

// Live updates so the tab never needs a manual reload: new inbound customer
// messages, new outbound bot/agent messages, a brand-new conversation starting,
// or a conversation's state/human_handling flipping all show up immediately.
// Requires messages/conversations to be in the supabase_realtime publication
// (added via `alter publication supabase_realtime add table ...`) and RLS to
// permit SELECT for the authenticated role, which it already does.
function bvSubscribeRealtime() {
  if (bvRealtimeChannel) {
    supabaseClient.removeChannel(bvRealtimeChannel);
    bvRealtimeChannel = null;
  }
  bvRealtimeChannel = supabaseClient
    .channel("conversations-tab")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => bvOnRealtimeMessage(payload.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => bvOnMessageStatus(payload.new))
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, (payload) => bvOnRealtimeConversation(payload.new))
    .subscribe();
}

// ── Message bubbles ───────────────────────────────────────────────────────────
function bvDayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  const days = (now - d) / 86400000;
  if (days < 6) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function bvDayDivider(iso) {
  return `<div class="day-divider"><span>${bvEscape(bvDayLabel(iso))}</span></div>`;
}

// One bubble, built on a single line (see the .bubble CSS note on whitespace).
// The time and ticks live INSIDE .bubble-text so they float to the end of the
// last line like WhatsApp instead of sitting in their own row.
function bvBubbleHtml(m) {
  const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `<div class="bubble ${m.direction === "outbound" ? "out" : "in"}" data-msg-id="${m.id}">${bvMediaThumb(m.metadata)}<div class="bubble-text">${bvFmtMsg(m)}${bvRenderChips(m.metadata)}<span class="bubble-time">${time}<span class="bubble-ticks">${bvTicks(m)}</span></span></div></div>`;
}

function bvThreadHtml(msgs) {
  let html = "", lastDay = "";
  for (const m of msgs) {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) { html += bvDayDivider(m.created_at); lastDay = day; }
    html += bvBubbleHtml(m);
  }
  return html;
}

// The reply box is a <textarea> so pasted/typed line breaks survive (a
// single-line <input> strips them, flattening a pasted message into one line).
function bvAutoGrow(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, parseInt(getComputedStyle(el).maxHeight) || 140) + "px";
}

// Enter sends and Shift+Enter adds a line on a computer; on a phone/tablet
// Enter is a new line and the send button sends -- like WhatsApp.
function bvReplyKey(e) {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  if (window.matchMedia("(pointer: coarse)").matches) return;
  e.preventDefault();
  bvSendReply();
}

// Mic when the box is empty, send once there's text -- same as WhatsApp.
function bvSyncComposeBtns() {
  const input = document.getElementById("convReplyInput");
  const mic = document.getElementById("convMicBtn");
  const send = document.getElementById("convSendBtn");
  if (!input || !mic || !send) return;
  const typing = input.value.trim().length > 0;
  mic.style.display = typing ? "none" : "";
  send.style.display = typing ? "" : "none";
}

function bvOnRealtimeMessage(m) {
  bvLastMsgs[m.conversation_id] = {
    conversation_id: m.conversation_id, message_id: m.id, direction: m.direction, message_type: m.message_type,
    media_type: m.metadata?.media_type || m.message_type, content: (m.content || "").slice(0, 200),
    status: m.status, created_at: m.created_at,
  };
  // Always bump/refresh the conversation list so a new inbound message (even on
  // an unselected or brand-new conversation) is reflected without a reload.
  const conv = bvConversations.find((c) => c.id === m.conversation_id);
  if (conv) {
    conv.last_message_at = m.created_at;
    bvConversations.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
    bvFilterList();
  }

  if (m.conversation_id !== bvSelectedConvId) return;
  // Already looking at this conversation -- a new message here (from either
  // side) is seen immediately, so it should never sit "unread" (the DB
  // trigger that bumps unread_count on every inbound insert doesn't know
  // whether anyone's actually looking at it).
  bvMarkConversationRead(m.conversation_id);
  const msgsEl = document.getElementById("convMsgs");
  if (!msgsEl) return;
  msgsEl.querySelector(".empty")?.remove();
  if (msgsEl.querySelector(`[data-msg-id="${m.id}"]`)) return; // already shown
  const day = new Date(m.created_at).toDateString();
  if (msgsEl.dataset.lastDay !== day) {
    msgsEl.insertAdjacentHTML("beforeend", bvDayDivider(m.created_at));
    msgsEl.dataset.lastDay = day;
  }
  msgsEl.insertAdjacentHTML("beforeend", bvBubbleHtml(m));
  // Follow new messages unless the user has scrolled up to read history
  // (their own sends always jump to the bottom).
  if (msgsEl.dataset.stick || m.direction === "outbound") {
    msgsEl.scrollTop = msgsEl.scrollHeight;
    msgsEl.dataset.stick = "1";
  }
}

// Delivery/read receipts arrive as UPDATEs on an existing message row --
// swap just that bubble's ticks in place rather than re-rendering the thread.
function bvOnMessageStatus(m) {
  // The list shows the ticks of each chat's latest message.
  const last = bvLastMsgs[m.conversation_id];
  if (last && last.message_id === m.id && last.status !== m.status) {
    last.status = m.status;
    bvFilterList();
  }
  if (m.conversation_id !== bvSelectedConvId) return;
  const slot = document.querySelector(`#convMsgs [data-msg-id="${m.id}"] .bubble-ticks`);
  if (slot) slot.innerHTML = bvTicks(m);
}

function bvOnRealtimeConversation(row) {
  const idx = bvConversations.findIndex((c) => c.id === row.id);
  if (idx >= 0) {
    if (bvMatchesNumberFilter(row)) {
      bvConversations[idx] = { ...bvConversations[idx], ...row };
    } else {
      // Switched to a different number than this view is filtered to (rare) --
      // drop it from this list.
      bvConversations.splice(idx, 1);
    }
  } else if (bvMatchesNumberFilter(row)) {
    bvConversations.unshift({ ...row, conversation_customers: null });
  } else {
    return; // belongs to a different number than this view is showing
  }
  bvConversations.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
  bvFilterList();
  bvSetChatBadge(bvConversations.filter((c) => c.unread_count > 0).length);

  if (row.id === bvSelectedConvId) {
    const badge = document.getElementById("convHandoffBadge");
    if (badge) badge.innerHTML = row.human_handling ? bvHandoffBadgeHtml() : "";
  }
}

// WhatsApp-style time for the list: clock time today, "Yesterday", weekday this
// week, otherwise the date.
function bvListTime(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  if ((now - d) / 86400000 < 6) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// One-line preview of the latest message, WhatsApp style (emoji for media).
function bvPreviewText(l) {
  if (!l) return "";
  const t = l.message_type, mt = l.media_type;
  const c = (l.content || "").replace(/[*~`]/g, "").replace(/\s+/g, " ").trim();
  if (t === "image" || mt === "image") return "📷 " + (c || "Photo");
  if (mt === "video") return "🎥 " + (c || "Video");
  if (t === "audio" || mt === "audio") return "🎤 Voice message";
  if (t === "document" || mt === "document") return "📄 " + (c || "Document");
  if (t === "sticker") return "Sticker";
  if (t === "template") return "📨 " + (c || "Template");
  if (t === "flow_reply") return "✅ Order submitted";
  if (t === "flow") return c === "order_flow" ? "📝 Order form" : c.startsWith("offer_") ? "🛒 Offer" : "📋 Message";
  if (t === "url_button") return "🔗 Link";
  if ((t === "button" || t === "list" || t === "interactive") && l.direction === "inbound") return "👆 " + c;
  return c;
}

function bvRenderChips() {
  const el = document.getElementById("convChips");
  if (!el) return;
  const unread = bvConversations.filter((c) => c.unread_count > 0).length;
  const handoff = bvConversations.filter((c) => c.human_handling).length;
  const chip = (key, label) => `<button class="conv-chip ${bvListFilter === key ? "on" : ""}" onclick="bvSetListFilter('${key}')">${label}</button>`;
  el.innerHTML = chip("all", "All") + chip("unread", `Unread${unread ? " " + unread : ""}`) + chip("handoff", `You're handling${handoff ? " " + handoff : ""}`);
}

function bvSetListFilter(key) {
  bvListFilter = key;
  bvFilterList();
}

function bvRenderList(list) {
  const wrap = document.getElementById("convListItems");
  if (!wrap) return;
  bvRenderChips();
  if (!list.length) { wrap.innerHTML = `<div class="empty" style="padding:24px;">${bvListFilter === "all" ? "No conversations yet." : "Nothing here."}</div>`; return; }
  wrap.innerHTML = list.map((c) => {
    const l = bvLastMsgs[c.id];
    const unread = c.unread_count > 0;
    const when = bvListTime(l?.created_at || c.last_message_at);
    const ticks = l && l.direction === "outbound" ? `<span class="bubble-ticks">${bvTicks(l)}</span>` : "";
    return `<div class="conv-row ${c.id === bvSelectedConvId ? "active" : ""}" onclick="bvSelectConversation('${c.id}')">`
      + bvAvatar(c, 48)
      + `<div class="cr-body">`
      + `<div class="cr-top"><span class="conv-name">${bvEscape(bvName(c))}</span><span class="conv-time ${unread ? "unread" : ""}">${bvEscape(when)}</span></div>`
      + `<div class="cr-bottom"><span class="cr-preview">${ticks}<span class="cr-text">${bvEscape(bvPreviewText(l))}</span></span>`
      + (c.current_state ? `<span class="cr-state">${bvEscape(c.current_state)}</span>` : "")
      + (unread ? `<span class="conv-unread-badge">${c.unread_count > 99 ? "99+" : c.unread_count}</span>` : "")
      + `</div></div></div>`;
  }).join("");
}

function bvFilterList() {
  const q = (document.getElementById("convSearch")?.value || "").toLowerCase();
  let list = bvConversations;
  if (bvListFilter === "unread") list = list.filter((c) => c.unread_count > 0);
  else if (bvListFilter === "handoff") list = list.filter((c) => c.human_handling);
  if (q) list = list.filter((c) => bvName(c).toLowerCase().includes(q) || (c.phone || "").includes(q));
  bvRenderList(list);
}

// message_type values written by the bot: text, audio, audio_transcript, button,
// list, flow, url_button, interactive, flow_reply -- see botController.ts logMessage
// calls. Outbound button/list content is the real body text sent; inbound
// button/list/interactive content is just the tapped option's id.
// Real WhatsApp delivery ticks -- status comes from Meta's own status webhook
// (sent/delivered/read/failed), tracked per-message via wa_message_id since
// the backend fix; only meaningful for messages we sent, never inbound ones.
function bvTicks(m) {
  if (m.direction !== "outbound") return "";
  if (m.status === "read") return `<span style="color:#53bdeb;margin-left:4px;" title="Read">✓✓</span>`;
  if (m.status === "delivered") return `<span style="color:var(--muted);margin-left:4px;" title="Delivered">✓✓</span>`;
  if (m.status === "sent") return `<span style="color:var(--muted);margin-left:4px;" title="Sent">✓</span>`;
  if (m.status === "failed") {
    const why = m.metadata?.error?.message || m.metadata?.error?.title;
    return `<span style="color:var(--danger);margin-left:4px;" title="${bvEscape(why ? "Failed: " + why : "Failed to send")}">⚠</span>`;
  }
  return "";
}

// WhatsApp-style inline formatting: *bold*, _italic_, ~strike~, `code`.
// Escapes first, so nothing from a customer's message can inject HTML.
function bvFmtText(raw) {
  let t = bvEscape(raw);
  const wrap = (ch, tag) => {
    const c = ch.replace(/[*_~]/g, "\\$&");
    t = t.replace(new RegExp(`(^|[\\s(])${c}([^\\s${c}](?:[^${c}\\n]*[^\\s${c}])?)${c}(?=$|[\\s.,!?:;)])`, "g"), `$1<${tag}>$2</${tag}>`);
  };
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  wrap("*", "b"); wrap("_", "i"); wrap("~", "s");
  return t;
}

function bvFmtMsg(m) {
  const t = m.message_type;
  const c = m.content || "";
  if (t === "text" || t === "audio_transcript") return bvFmtText(c);
  if (t === "agent_text") return `<div class="agent-tag">Agent</div>${bvFmtText(c)}`;
  if (t === "agent_media") return c ? `<div class="agent-tag">Agent</div>${bvFmtText(c)}` : `<div class="agent-tag">Agent</div>`;
  // Inbound customer media that the webhook has downloaded (metadata.url) is
  // rendered by bvMediaThumb above the text -- only the caption goes here.
  if (m.direction === "inbound" && m.metadata?.url && ["image", "video", "audio", "sticker"].includes(t)) return bvEscape(c);
  if (m.direction === "inbound" && m.metadata?.url && t === "document") {
    return `<a href="${bvEscape(m.metadata.url)}" target="_blank" style="color:var(--accent);">📄 ${bvEscape(m.metadata.filename || "Document")}</a>${c ? "<br>" + bvEscape(c) : ""}`;
  }
  if (t === "audio") return `<span style="color:var(--muted);font-style:italic;display:inline-flex;align-items:center;gap:5px;">${icon("mic",13)} Voice note</span>`;
  if (t === "image") return "📷 Sent: product photo";
  if (t === "template") return `📨 Sent template: ${bvEscape(c)}`;
  if (t === "button" || t === "list") {
    return m.direction === "outbound" ? bvEscape(c) : `👆 Tapped: <b>${bvEscape(c)}</b>`;
  }
  if (t === "interactive") return `👆 Tapped: <b>${bvEscape(c)}</b>`;
  if (t === "flow") {
    if (c === "warmup_solution") return "📸 Sent: warm-up message (photo + buttons)";
    if (c.startsWith("offer_")) return `🛒 Sent: ${bvEscape(c.replace("offer_", "").replace(/_/g, " "))} offer card`;
    if (c === "order_flow") return "📝 Sent: order form";
    return `📋 Sent: ${bvEscape(c)}`;
  }
  if (t === "url_button") return `🔗 Sent link: <a href="${bvEscape(c)}" target="_blank" style="color:var(--accent);">${bvEscape(c)}</a>`;
  if (t === "flow_reply") {
    try {
      const d = JSON.parse(c);
      return `✅ <b>Order submitted</b><br>${bvEscape(d.full_name || "")} · ${bvEscape(d.phone_number || "")}<br>${bvEscape(d.address || "")}, ${bvEscape(d.city || "")}, ${bvEscape(d.state || "")}<br>Package: ${bvEscape(d.package || "")}`;
    } catch { return bvEscape(c); }
  }
  return bvEscape(c);
}

// Shows the actual photo the customer was sent (product image, media reply) --
// separate from bvFmtMsg's text since it renders above the message content.
function bvMediaThumb(metadata) {
  const url = metadata?.image_url || metadata?.url;
  if (url && metadata?.media_type === "audio") {
    return `<audio class="bubble-audio" src="${bvEscape(url)}" controls preload="none"></audio>`;
  }
  if (!url) return "";
  const isVideo = metadata?.media_type === "video";
  if (isVideo) {
    return `<video class="bubble-media" src="${bvEscape(url)}" controls></video>`;
  }
  return `<img class="bubble-media" src="${bvEscape(url)}" alt="">`;
}

// Shows the buttons/flow-CTA/list rows the customer actually saw on this
// message -- visual only (these represent what WhatsApp showed them, not new
// actions the agent can trigger from here).
function bvRenderChips(metadata) {
  if (!metadata) return "";
  const chips = [];
  if (Array.isArray(metadata.buttons)) {
    metadata.buttons.forEach((b) => chips.push(bvEscape(b?.title || b)));
  }
  if (metadata.flow_cta) chips.push(bvEscape(metadata.flow_cta));
  if (Array.isArray(metadata.rows)) {
    metadata.rows.forEach((r) => chips.push(bvEscape(typeof r === "string" ? r : r?.title)));
  }
  if (metadata.button_text) chips.push(bvEscape(metadata.button_text));
  if (!chips.length) return "";
  return `<div class="msg-chips">${chips.map((c) => `<span class="msg-chip">${c}</span>`).join("")}</div>`;
}

// Single "+" button replaces 4 always-visible icons (attach/form/packages/
// website) that were crowding the compose bar on narrow screens -- opens a
// small menu instead, closed by picking an option or tapping outside it.
function bvToggleAttachMenu(e) {
  e.stopPropagation();
  document.getElementById("composeAttachMenu")?.classList.toggle("open");
}
document.addEventListener("click", (e) => {
  const menu = document.getElementById("composeAttachMenu");
  if (menu && menu.classList.contains("open") && !menu.contains(e.target) && !e.target.closest(".compose-attach-wrap")) {
    menu.classList.remove("open");
  }
});
function bvAttachMenuAction(kind) {
  document.getElementById("composeAttachMenu")?.classList.remove("open");
  if (kind === "file") document.getElementById("convFileInput")?.click();
  else if (kind === "template") bvTemplateModal();
  else bvComposeModal(kind);
}

// Sends an APPROVED WhatsApp template -- the only way to reach a customer
// once 24h have passed since their last message (WhatsApp's own rule, not
// ours). template_name must match an approved template exactly, or Meta
// rejects the send.
function bvTemplateModal() {
  if (!bvSelectedConvId) return;
  const conv = bvConversations.find((c) => c.id === bvSelectedConvId);
  const firstName = (bvName(conv) || "").split(" ")[0] || "there";
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal" style="max-width:440px;">
    <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
    <div style="font-weight:600;font-size:14px;margin-bottom:4px;">Send Template</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">Only works if it's been more than 24h since their last message AND the template below is already approved in Meta's WhatsApp Manager.</div>
    <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Template name (exact)</label>
    <input id="bvTplName" value="beoliv_followup_v1" style="width:100%;font-size:13px;padding:9px 10px;border-radius:8px;border:1px solid var(--border);background:var(--panel2);color:var(--text);margin-bottom:10px;">
    <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Customer's first name (fills the {{1}} in the template)</label>
    <input id="bvTplName1" value="${bvEscape(firstName)}" style="width:100%;font-size:13px;padding:9px 10px;border-radius:8px;border:1px solid var(--border);background:var(--panel2);color:var(--text);">
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
      <button class="btn btn-a" style="width:auto;padding:8px 16px;" onclick="bvCloseModal()">Cancel</button>
      <button class="btn btn-g" style="width:auto;padding:8px 16px;" id="bvTplSendBtn" onclick="bvSendTemplate()">Send</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  document.getElementById("bvTplName")?.focus();
}

async function bvSendTemplate() {
  const nameInput = document.getElementById("bvTplName");
  const param1Input = document.getElementById("bvTplName1");
  const btn = document.getElementById("bvTplSendBtn");
  const templateName = (nameInput?.value || "").trim();
  const param1 = (param1Input?.value || "").trim();
  if (!templateName || !bvSelectedConvId) return;

  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const res = await sbFn("send-whatsapp-template", {
      conversation_id: bvSelectedConvId,
      template_name: templateName,
      body_params: param1 ? [param1] : [],
    });
    if (res?.error) {
      alert("Failed to send: " + res.error);
      return;
    }
    bvCloseModal();
    bvAfterAgentSend();
  } catch (e) {
    alert("Failed to send: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Send"; }
  }
}

// Mobile-only: returns from the full-screen thread view to the conversation
// list (see .thread-open in the mobile CSS). The back button itself is
// CSS-hidden on desktop, where both panels already show side by side.
function bvBackToList() {
  bvSelectedConvId = null;
  document.getElementById("convTabRoot")?.classList.remove("thread-open");
  bvFilterList();
}

// Clears the unread badge both locally (instant) and in the DB (so it stays
// cleared on refresh/for other viewers) -- called when a conversation is
// opened, and again whenever a live message arrives for one already open.
function bvMarkConversationRead(id) {
  const conv = bvConversations.find((c) => c.id === id);
  if (conv && conv.unread_count > 0) {
    conv.unread_count = 0;
    bvFilterList();
  }
  supabaseClient.from("conversations").update({ unread_count: 0 }).eq("id", id).then(() => {});
}

async function bvSelectConversation(id) {
  if (typeof bvRec !== "undefined" && bvRec && bvRec.convId !== id) bvStopRecording(false);
  bvSelectedConvId = id;
  bvMarkConversationRead(id);
  bvFilterList();
  // On mobile the list and thread can't fit side by side -- this swaps to a
  // full-screen thread view (see the .thread-open mobile CSS) instead of a
  // second fixed-height panel stacked below an already-tall list, which is
  // what made the full conversation unreachable without a lot of scrolling.
  document.getElementById("convTabRoot")?.classList.add("thread-open");

  const conv = bvConversations.find(c => c.id === id);
  const thread = document.getElementById("convThread");
  thread.innerHTML = `<div class="empty"><div class="spin" style="width:16px;height:16px;border-width:2px;"></div></div>`;

  let msgs;
  try {
    msgs = await sbQuery("messages", `conversation_id=eq.${id}&order=created_at.asc&limit=500`);
  } catch (e) {
    thread.innerHTML = `<div class="msg err">❌ Couldn't load messages: ${bvEscape(e.message)}</div>`;
    return;
  }

  thread.innerHTML = `
    <div class="conv-thread-head">
      <div class="cth-left" style="display:flex;align-items:center;gap:10px;min-width:0;">
        <button class="conv-back-btn" onclick="bvBackToList()" title="Back to conversations">${icon("back",18)}</button>
        ${bvAvatar(conv, 38)}
        <div class="cth-who">
          <div class="cth-name" style="font-weight:600;font-size:13px;">${bvEscape(bvName(conv))}</div>
          <div class="cth-sub" style="font-size:11px;color:var(--muted);">${bvEscape(conv.phone)}<span class="cth-extra"> · ${bvEscape(conv.source || "")} · ${conv.current_state}</span></div>
        </div>
      </div>
      <div class="cth-actions" style="display:flex;align-items:center;gap:8px;">
        <span id="convHandoffBadge">${conv.human_handling ? bvHandoffBadgeHtml() : ""}</span>
      </div>
    </div>
    <div class="conv-msgs" id="convMsgs">${!msgs?.length ? `<div class="empty">No messages yet.</div>` : bvThreadHtml(msgs)}</div>
    <div class="conv-compose">
      <input type="file" id="convFileInput" accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/*" style="display:none;" onchange="bvPickMedia(this)">
      <div class="compose-attach-wrap">
        <button class="compose-icon-btn" onclick="bvToggleAttachMenu(event)" title="Attach">${icon("plus",18)}</button>
        <div id="composeAttachMenu" class="compose-attach-menu">
          <button onclick="bvAttachMenuAction('file')">${icon("clip",14)} Photo, video or voice note</button>
          <button onclick="bvAttachMenuAction('form')">${icon("form",14)} Order form</button>
          <button onclick="bvAttachMenuAction('packages')">${icon("list",14)} Package info</button>
          <button onclick="bvAttachMenuAction('website')">${icon("link",14)} Website link</button>
          <button onclick="bvAttachMenuAction('template')">${icon("chat",14)} WhatsApp-approved template (after 24h)</button>
        </div>
      </div>
      <textarea id="convReplyInput" rows="1" placeholder="Type a reply to ${bvEscape(bvName(conv))}…" oninput="bvAutoGrow(this);bvSyncComposeBtns()" onkeydown="bvReplyKey(event)" onpaste="bvPasteMedia(event)"></textarea>
      <div id="convRecording" class="conv-recording" style="display:none;">
        <span class="rec-dot"></span><span class="rec-time" id="convRecTime">0:00</span>
        <span class="rec-hint">Recording… tap ✓ to send</span>
        <button type="button" class="compose-icon-btn" onclick="bvStopRecording(false)" title="Cancel" style="margin-left:auto;">✕</button>
      </div>
      <button type="button" id="convSavedBtn" class="compose-mic-btn" onclick="bvSavedReplies()" title="Saved replies" aria-label="Saved replies">${icon("list",16)}</button>
      <button id="convMicBtn" class="compose-mic-btn" onclick="bvStartRecording()" title="Record voice note">${icon("mic",16)}</button>
      <button id="convSendBtn" onclick="bvSendReply()" title="Send">${icon("send",16)}</button>
    </div>`;

  const msgsEl = document.getElementById("convMsgs");
  if (msgsEl) {
    msgsEl.dataset.lastDay = msgs?.length ? new Date(msgs[msgs.length - 1].created_at).toDateString() : "";
    msgsEl.scrollTop = msgsEl.scrollHeight;
    // Photos/videos load after this point and push the newest message off
    // screen -- keep the view pinned to the bottom until the user scrolls up.
    msgsEl.dataset.stick = "1";
    msgsEl.addEventListener("scroll", () => {
      msgsEl.dataset.stick = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80 ? "1" : "";
    });
    const repin = () => { if (msgsEl.dataset.stick) msgsEl.scrollTop = msgsEl.scrollHeight; };
    msgsEl.addEventListener("load", repin, true);
    msgsEl.addEventListener("loadedmetadata", repin, true);
  }
  bvSyncComposeBtns();
  bvInitDropZone();
}

function bvHandoffBadgeHtml() {
  return `<button class="btn btn-g" style="font-size:11px;padding:5px 10px;" onclick="bvResumeAI()">${icon("chat",12)} Resume AI</button>`;
}

// Shared bookkeeping after any agent-initiated send (text/media/flow): bumps the
// conversation to the top of the list and shows "Resume AI" since the bot has
// now paused itself on this conversation (see botController.ts human_handling check).
function bvAfterAgentSend() {
  const conv = bvConversations.find((c) => c.id === bvSelectedConvId);
  if (conv) {
    conv.human_handling = true;
    conv.last_message_at = new Date().toISOString();
    bvConversations.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
    bvFilterList();
  }
  const badge = document.getElementById("convHandoffBadge");
  if (badge) badge.innerHTML = bvHandoffBadgeHtml();
}

async function bvResumeAI() {
  if (!bvSelectedConvId) return;
  try {
    const { error } = await supabaseClient
      .from("conversations")
      .update({ human_handling: false })
      .eq("id", bvSelectedConvId);
    if (error) { alert("Failed to resume AI: " + error.message); return; }
    const conv = bvConversations.find((c) => c.id === bvSelectedConvId);
    if (conv) conv.human_handling = false;
    const badge = document.getElementById("convHandoffBadge");
    if (badge) badge.innerHTML = "";
  } catch (e) {
    alert("Failed to resume AI: " + e.message);
  }
}

async function bvSendReply() {
  const input = document.getElementById("convReplyInput");
  const btn = document.getElementById("convSendBtn");
  const text = (input?.value || "").trim();
  if (!text || !bvSelectedConvId) return;

  input.disabled = true;
  btn.disabled = true;
  try {
    const res = await sbFn("send-whatsapp-message", { conversation_id: bvSelectedConvId, text });
    if (res?.error) {
      alert("Failed to send: " + res.error);
      return;
    }

    input.value = "";
    bvAutoGrow(input);
    bvSyncComposeBtns();
    // The new bubble arrives via the realtime subscription (bvOnRealtimeMessage)
    // once send-whatsapp-message's insert lands -- no need to append it here too.
    bvAfterAgentSend();
  } catch (e) {
    alert("Failed to send: " + e.message);
  } finally {
    input.disabled = false;
    btn.disabled = false;
    input.focus();
  }
}

// Opens a customer's chat in the Inbox from anywhere (orders, leads, bookings, delivery desk). Nothing opens WhatsApp in a new tab: messages are sent from here.
// It finds the customer's chat, or starts an empty one on the caller's own WhatsApp number (nothing is sent), then jumps to it.
// An optional draft is placed in the reply box for the person to read and send.
async function bvOpenChat(phone, name, draft) {
  if (!String(phone || "").replace(/\D/g, "")) { bvToast("This customer has no phone number."); return; }
  const r = await sbFn("send-whatsapp-message", { action: "start", phone, name }).catch(() => null);
  if (!r || !r.success) { bvToast((r && r.error) || "Could not open the chat."); return; }
  if (typeof bvCloseModal === "function") { try { bvCloseModal(); } catch (_) { /* no modal open */ } }
  window.bvPendingConv = r.conversation_id;
  if (typeof activeTab !== "undefined" && activeTab === "conversations") { if (typeof render === "function") render(); }
  else document.querySelector('.tab-btn[data-tab="conversations"]')?.click();
  if (draft) {
    let n = 0;
    const t = setInterval(() => {
      const box = document.getElementById("convReplyInput");
      if (box || ++n > 40) { clearInterval(t); if (box && !box.value) { box.value = draft; box.dispatchEvent(new Event("input", { bubbles: true })); } }
    }, 150);
  }
}
function bvOpenChatBtn(el) { bvOpenChat(el.dataset.chatPhone, el.dataset.chatName, el.dataset.chatDraft); return false; }
