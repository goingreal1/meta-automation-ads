// Revora dashboard, part 47: CHATS STAY LIVE.
// The WhatsApp chats live in the database and arrive by realtime, so the Chats screen should never wait for them again.
//  - The realtime link opens as soon as the app is signed in (not when the Chats tab opens) and stays open on every screen.
//  - The list and the open conversations are kept in memory. Coming back to Chats, or opening a conversation again, shows them at once;
//    a quiet check afterwards only changes what really changed.
// Everything else (look, sending, order card, "+" menu) is the existing code; this file only decides when data is fetched.
(function () {
  if (window.__lvInstalled) return; window.__lvInstalled = true;
  const prevQ = window.sbQuery;
  if (typeof prevQ !== "function" || typeof window.renderConversations !== "function" || typeof window.bvSelectConversation !== "function") return;

  const LV = { ready: false, numKey: "", snap: null, used: new Set(), forceCold: false };
  const QC = {};          // answers kept by "table|query" for the small side lists (numbers, comments, Messenger, customer card)
  const MSG = {};         // conversation id -> its messages, oldest first
  const order = [];       // most recently used conversations (kept small)
  let on = 0;             // > 0 while a screen is opening: answers may come from memory
  const KEYED = new Set(["buyer_whatsapp_numbers", "page_comments", "channel_threads", "channel_messages", "orders", "bookings", "tours", "applications"]);
  const THREAD = /^conversation_id=eq\.([0-9a-f-]{36})&order=created_at\.asc&limit=500$/;
  const INBOUND = /^select=created_at&conversation_id=eq\.([0-9a-f-]{36})&direction=eq\.inbound&order=created_at\.desc&limit=1$/;
  const LIST_Q = "select=*,conversation_customers(name,state,city,address)&current_state=neq.MERGED&order=last_message_at.desc&limit=150";
  const sig = (rows) => (rows || []).map((r) => r.id + ":" + (r.status || "") + ":" + (r.content || "").length).join("|");

  function putMsg(id, rows) {
    MSG[id] = rows;
    const i = order.indexOf(id); if (i >= 0) order.splice(i, 1);
    order.unshift(id);
    while (order.length > 25) delete MSG[order.pop()];
  }

  // ---------- answers from memory while a screen opens; everything is also remembered when it comes from the database ----------
  function serve(table, q) {
    if (table === "conversations" && LV.snap && /current_state=neq\.MERGED/.test(q)) return LV.snap.convs;
    if (table === "conversation_last_message" && LV.snap) {
      const ids = (q.match(/conversation_id=in\.\(([^)]*)\)/) || [])[1];
      if (ids !== undefined) return ids.split(",").map((i) => LV.snap.last[i]).filter(Boolean);
    }
    if (table === "messages") {
      let m = q.match(THREAD); if (m && MSG[m[1]]) return MSG[m[1]].slice();
      m = q.match(INBOUND);
      if (m && MSG[m[1]]) { const r = MSG[m[1]].filter((x) => x.direction === "inbound"); return r.length ? [{ created_at: r[r.length - 1].created_at }] : []; }
      return null;
    }
    if (KEYED.has(table)) { const k = table + "|" + q; if (k in QC) { LV.used.add(k); return QC[k]; } }
    return null;
  }
  window.sbQuery = function (table, q) {
    q = q || "";
    if (on > 0) { const hit = serve(table, q); if (hit) return Promise.resolve(hit); }
    const p = prevQ.apply(this, arguments);
    if (!KEYED.has(table) && table !== "messages") return p;
    return p.then((rows) => {
      try { if (KEYED.has(table)) QC[table + "|" + q] = rows; else { const m = q.match(THREAD); if (m && rows) putMsg(m[1], rows); } } catch (e) { /* the screen still gets its answer */ }
      return rows;
    });
  };

  // ---------- realtime: keep the remembered messages current even while another screen is open ----------
  const prevMsg = window.bvOnRealtimeMessage;
  if (typeof prevMsg === "function") window.bvOnRealtimeMessage = function (m) {
    try {
      const c = MSG[m.conversation_id];
      if (c && !c.some((x) => x.id === m.id)) c.push(m);
      // Not looking at that chat (another screen is open): it must stay unread.
      if (m.conversation_id === bvSelectedConvId && !document.getElementById("convMsgs")) bvSelectedConvId = null;
    } catch (e) { /* ignore */ }
    return prevMsg.apply(this, arguments);
  };
  const prevStat = window.bvOnMessageStatus;
  if (typeof prevStat === "function") window.bvOnMessageStatus = function (m) {
    try { const c = MSG[m.conversation_id]; if (c) { const i = c.findIndex((x) => x.id === m.id); if (i >= 0) c[i] = { ...c[i], ...m }; } } catch (e) { /* ignore */ }
    return prevStat.apply(this, arguments);
  };
  const prevSub = window.bvSubscribeRealtime;
  if (typeof prevSub === "function") window.bvSubscribeRealtime = function () {
    if (typeof bvRealtimeChannel !== "undefined" && bvRealtimeChannel && /join/.test(String(bvRealtimeChannel.state))) return; // already live
    return prevSub.apply(this, arguments);
  };

  // ---------- the list ----------
  let refreshing = false;
  async function refreshList() {
    if (refreshing) return; refreshing = true;
    try {
      const convs = await prevQ("conversations", LIST_Q);
      const list = (convs || []).filter(bvMatchesNumberFilter);
      const ids = list.map((c) => c.id), chunks = [];
      for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
      const rows = await Promise.all(chunks.map((ch) => prevQ("conversation_last_message", `select=*&conversation_id=in.(${ch.join(",")})`).catch(() => [])));
      const last = {}; rows.flat().forEach((r) => { last[r.conversation_id] = r; });
      bvConversations = list; bvLastMsgs = last;
      bvFilterList();
      if (typeof bvSetChatBadge === "function") bvSetChatBadge(list.filter((c) => c.unread_count > 0).length);
    } catch (e) { /* the list on screen stays as it is */ } finally { refreshing = false; }
  }

  async function refreshKeys(keys, el) {
    let changed = false;
    for (const k of keys) {
      const i = k.indexOf("|"), table = k.slice(0, i), q = k.slice(i + 1);
      try { const rows = await prevQ(table, q); if (JSON.stringify(rows) !== JSON.stringify(QC[k])) { QC[k] = rows; if (table === "page_comments" || table.startsWith("channel_")) changed = true; } } catch (e) { /* keep the old answer */ }
    }
    return changed;
  }

  // Chats tab: from memory straight away, then a quiet check.
  const prevRC = window.renderConversations;
  window.renderConversations = async function (el) {
    const warm = LV.ready && !LV.forceCold && LV.numKey === bvSelectedNumberId;
    LV.forceCold = false;
    if (warm) { LV.snap = { convs: bvConversations.slice(), last: { ...bvLastMsgs } }; LV.used = new Set(); on++; }
    try { await prevRC.apply(this, arguments); } finally { if (warm) { on--; LV.snap = null; } }
    if (!warm) { LV.ready = true; LV.numKey = bvSelectedNumberId; return; }
    const keys = [...LV.used];
    refreshList();
    refreshKeys(keys, el).then((changed) => {
      const root = document.getElementById("convTabRoot");
      // Comments or Messenger changed while away: redraw once, only if nobody is typing or reading a chat.
      if (changed && root && !root.classList.contains("thread-open") && !(document.getElementById("convSearch") || {}).value) { LV.forceCold = true; window.renderConversations(el); }
    });
  };

  // One conversation: its messages from memory, then a quiet check for anything that was missed.
  const prevSel = window.bvSelectConversation;
  window.bvSelectConversation = async function (id) {
    const had = !!MSG[id];
    LV.used = new Set(); on++;
    let r;
    try { r = await prevSel.apply(this, arguments); } finally { on--; }
    if (had) revalidate(id);
    const keys = [...LV.used]; if (keys.length) refreshKeys(keys);
    return r;
  };
  async function revalidate(id) {
    const rows = await prevQ("messages", `conversation_id=eq.${id}&order=created_at.asc&limit=500`).catch(() => null);
    if (!rows) return;
    const old = MSG[id]; putMsg(id, rows);
    if (sig(old) === sig(rows) || bvSelectedConvId !== id) return;
    const el = document.getElementById("convMsgs"); if (!el) return;
    const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    el.innerHTML = rows.length ? bvThreadHtml(rows) : `<div class="empty">No messages yet.</div>`;
    el.dataset.lastDay = rows.length ? new Date(rows[rows.length - 1].created_at).toDateString() : "";
    if (stick) el.scrollTop = el.scrollHeight;
  }

  // ---------- start as soon as the app is signed in ----------
  const staff = () => ["owner", "admin", "buyer"].includes(window.myProfile && window.myProfile.role);
  async function prime() {
    if (LV.ready) return;
    try {
      const numbers = window.sbQuery("buyer_whatsapp_numbers", "select=id,nickname,display_phone_number,media_buyer_id,media_buyers(name)&status=eq.active&order=created_at.asc").catch(() => []);
      await refreshList(); await numbers;
      LV.ready = true; LV.numKey = bvSelectedNumberId;
      if (staff()) {
        window.sbQuery("page_comments", "select=*&is_page_reply=eq.false&status=eq.new&order=created_time.asc&limit=30").catch(() => null);
        if (typeof window.ixLoadExtra === "function") window.ixLoadExtra().catch(() => null);
      }
    } catch (e) { /* the Chats tab will load normally */ }
  }
  function live() { try { if (typeof bvSubscribeRealtime === "function") bvSubscribeRealtime(); } catch (e) { /* retried on the next check */ } }
  let tries = 0;
  const t = setInterval(() => {
    if (window.myProfile && typeof supabaseClient !== "undefined") { clearInterval(t); live(); setTimeout(prime, 1500); } else if (++tries > 120) clearInterval(t);
  }, 500);
  // Back to the app after a while (a phone sleeps and drops its connection): make sure the link is up and catch up quietly.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !window.myProfile) return;
    try { if (typeof bvRealtimeChannel !== "undefined" && bvRealtimeChannel && !/join/.test(String(bvRealtimeChannel.state))) { supabaseClient.removeChannel(bvRealtimeChannel); bvRealtimeChannel = null; } } catch (e) { /* ignore */ }
    live();
    if (LV.ready) { refreshList(); if (bvSelectedConvId && MSG[bvSelectedConvId]) revalidate(bvSelectedConvId); }
  });
  // Signing out forgets everything kept here.
  try { supabaseClient.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { LV.ready = false; Object.keys(QC).forEach((k) => delete QC[k]); Object.keys(MSG).forEach((k) => delete MSG[k]); order.length = 0; try { if (bvRealtimeChannel) { supabaseClient.removeChannel(bvRealtimeChannel); bvRealtimeChannel = null; } } catch (e) { /* ignore */ } } }); } catch (e) { /* no auth events here */ }
})();
