// Revora dashboard, part 36: SAVED REPLIES inside a chat.
// Private text snippets a person keeps for themselves (table saved_replies, row-level security: own rows only, never other buyers or companies).
// In a chat the "Saved replies" button opens a sheet; tapping one puts it in the reply box (with {first_name} filled in) for the person to read, edit and send.
(function () {
  const STARTERS = [
    ["Order follow-up", "Hello {first_name}, this is a quick follow-up on your order. Please confirm your delivery address and a time that suits you."],
    ["Confirm address", "Hello {first_name}, please confirm your full delivery address and the best phone number for our rider."],
    ["Delivery details", "Hello {first_name}, your order is on the way. The rider will call you before delivery, so please keep your phone close."],
    ["Thank you", "Thank you {first_name}! We are glad to serve you. Message us any time if you need anything."]
  ];
  const css = `
  .sr-list{padding:0}
  .sr-row{display:flex;gap:12px;align-items:flex-start;padding:14px 20px;border:0;border-top:1px solid var(--border);background:none;width:100%;text-align:left;font:inherit;color:var(--text);cursor:pointer}
  .sr-row:active{background:var(--panel2)}
  .sr-row .sr-t{flex:1;min-width:0}.sr-row b{display:block;font-size:15px;font-weight:600}
  .sr-row span.sr-b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13.5px;line-height:1.4;color:var(--text2);margin-top:3px}
  .sr-mini{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:13px;font-weight:600;cursor:pointer;flex:none}
  .sr-mini.d{color:#c2410c}
  .sr-add{margin:12px 20px 0;height:50px;width:calc(100% - 40px);border-radius:14px;border:1px dashed var(--borderStrong,#cfc9ba);background:none;color:#2447d6;font:inherit;font-size:15px;font-weight:700;cursor:pointer}
  .sr-empty{padding:8px 20px 4px;font-size:14px;line-height:1.5;color:var(--text2)}
  .sr-form{padding:4px 20px 0}
  .sr-form label{display:block;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text2);margin:14px 0 6px}
  .sr-form input,.sr-form textarea{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:12px;padding:12px 14px;background:var(--panel);color:var(--text);font:inherit;font-size:16px}
  .sr-form textarea{min-height:130px;line-height:1.45;resize:vertical}
  .sr-hint{font-size:12.5px;color:var(--muted);margin-top:6px;line-height:1.4}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const esc = (s) => (typeof escH === "function" ? escH(s) : String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
  let rows = [], manage = false, editing = null;

  async function load() {
    const { data } = await supabaseClient.from("saved_replies").select("id,title,body").order("sort", { ascending: true }).order("created_at", { ascending: true });
    rows = data || [];
  }
  const fill = (body) => {
    const conv = typeof bvConversations !== "undefined" ? bvConversations.find((c) => c.id === bvSelectedConvId) : null;
    const first = ((conv && typeof bvName === "function" ? bvName(conv) : "") || "").trim().split(/\s+/)[0] || "there";
    return String(body).replace(/\{first_name\}/gi, first);
  };
  const close = () => document.getElementById("srWrap")?.remove();

  function shell(inner) {
    let w = document.getElementById("srWrap");
    if (!w) { w = document.createElement("div"); w.id = "srWrap"; document.body.appendChild(w); }
    w.innerHTML = `<div class="ix-scrim"></div><div class="ix-sheet" role="dialog" aria-label="Saved replies"><div class="ix-grab"></div>${inner}</div>`;
    w.querySelector(".ix-scrim").onclick = close;
    return w;
  }

  function draw() {
    if (editing !== null) return drawForm();
    const body = rows.length
      ? rows.map((r) => `<div class="sr-row" data-id="${r.id}" ${manage ? "" : 'role="button" tabindex="0"'}><div class="sr-t"><b>${esc(r.title)}</b><span class="sr-b">${esc(r.body)}</span></div>${manage ? `<button type="button" class="sr-mini" data-e="${r.id}">Edit</button><button type="button" class="sr-mini d" data-d="${r.id}">Delete</button>` : ""}</div>`).join("")
      : `<div class="sr-empty">Nothing saved yet. Save the replies you send again and again, and they stay private to you. Start with one of these:</div>` + STARTERS.map((s, i) => `<button type="button" class="sr-row" data-s="${i}"><div class="sr-t"><b>${esc(s[0])}</b><span class="sr-b">${esc(s[1])}</span></div><span class="sr-mini">Add</span></button>`).join("");
    const w = shell(`<div class="ix-sh"><b>Saved replies</b><button type="button" id="srMode">${manage ? "Done" : "Manage"}</button></div>
      <div class="sr-list">${body}</div><button type="button" class="sr-add" id="srNew">+ New reply</button><button type="button" class="sr-add" id="srTpl" style="margin-top:8px;color:var(--text)">WhatsApp-approved templates (after 24 hours)</button>`);
    w.querySelector("#srMode").onclick = () => { manage = !manage; draw(); };
    w.querySelector("#srNew").onclick = () => { editing = { id: "", title: "", body: "" }; draw(); };
    w.querySelector("#srTpl").onclick = () => window.bvTemplateModal();
    w.querySelectorAll("[data-s]").forEach((b) => (b.onclick = async () => { const s = STARTERS[Number(b.dataset.s)]; await save({ title: s[0], body: s[1] }); await load(); draw(); }));
    if (manage) {
      w.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => { editing = rows.find((r) => r.id === b.dataset.e) || null; draw(); }));
      w.querySelectorAll("[data-d]").forEach((b) => (b.onclick = async () => { await supabaseClient.from("saved_replies").delete().eq("id", b.dataset.d); await load(); draw(); }));
    } else {
      w.querySelectorAll(".sr-row[data-id]").forEach((b) => (b.onclick = () => use(rows.find((r) => r.id === b.dataset.id))));
    }
  }
  function drawForm() {
    const e = editing;
    const w = shell(`<div class="ix-sh"><b>${e.id ? "Edit reply" : "New reply"}</b><button type="button" id="srCancel">Cancel</button></div>
      <div class="sr-form"><label for="srTitle">Name</label><input id="srTitle" maxlength="60" value="${esc(e.title)}" placeholder="For example: Order follow-up">
      <label for="srBody">Message</label><textarea id="srBody" maxlength="1500" placeholder="Write the message">${esc(e.body)}</textarea>
      <div class="sr-hint">Type {first_name} and it becomes the customer's first name when you use it. Only you can see this reply.</div></div>
      <div class="ix-foot"><button type="button" id="srSave" style="background:#2447d6;border-color:#2447d6;color:#fff">Save reply</button></div>`);
    w.querySelector("#srCancel").onclick = () => { editing = null; draw(); };
    w.querySelector("#srSave").onclick = async () => {
      const title = w.querySelector("#srTitle").value.trim(), body = w.querySelector("#srBody").value.trim();
      if (!title || !body) { if (typeof bvToast === "function") bvToast("Add a name and a message first."); return; }
      const ok = await save({ id: e.id, title, body });
      if (ok) { editing = null; await load(); draw(); }
    };
    w.querySelector("#srTitle").focus();
  }
  async function save(o) {
    const q = o.id
      ? supabaseClient.from("saved_replies").update({ title: o.title, body: o.body, updated_at: new Date().toISOString() }).eq("id", o.id)
      : supabaseClient.from("saved_replies").insert({ company_id: window.myProfile && window.myProfile.company_id, title: o.title, body: o.body });
    const { error } = await q;
    if (error) { if (typeof bvToast === "function") bvToast("Could not save that reply."); return false; }
    return true;
  }
  function use(r) {
    if (!r) return;
    const box = document.getElementById("convReplyInput");
    close();
    if (!box) return;
    const text = fill(r.body);
    box.value = box.value.trim() ? box.value.replace(/\s+$/, "") + "\n" + text : text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
  }
  // For the quick chips above the reply box: the person's first few saved replies, and a way to use one.
  window.bvSavedForChips = async function (n) { await load(); return rows.slice(0, n || 4); };
  window.bvUseSavedReply = function (id) { use(rows.find((r) => r.id === id)); };
  window.bvSavedReplies = async function () {
    manage = false; editing = null;
    shell(`<div class="ix-sh"><b>Saved replies</b></div><div class="sr-empty">Loading…</div>`);
    await load();
    draw();
  };

  // ======== WHATSAPP-APPROVED TEMPLATES (the only way to write after 24 hours of silence, or first) ========
  const css2 = `
  .wt-chip{font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:6px;white-space:nowrap;flex:none}
  .wt-chip.approved{background:#e3f4ea;color:#0f6b36}.wt-chip.pending{background:#fdeee3;color:#9a3a0b}.wt-chip.rejected{background:#fde8e6;color:#b42318}
  .wt-note{margin:4px 20px 8px;padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.45;background:var(--panel2);border:1px solid var(--border);color:var(--text2)}
  .wt-note.warn{background:#fdeee3;border-color:#f5cfae;color:#7a3208}
  .wt-pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
  .wt-confirm{margin:0 20px;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--panel2);font-size:14px;line-height:1.45}`;
  const st2 = document.createElement("style"); st2.textContent = css2; document.head.appendChild(st2);
  let tpls = [], tcat = "utility";
  const tcall = (o) => sbFn("send-whatsapp-template", o).catch(() => null);
  async function windowState() {
    if (typeof bvSelectedConvId === "undefined" || !bvSelectedConvId) return null;
    const r = await sbQuery("messages", `select=created_at&conversation_id=eq.${bvSelectedConvId}&direction=eq.inbound&order=created_at.desc&limit=1`).catch(() => []);
    const at = r && r[0] && Date.parse(r[0].created_at);
    if (!at) return { open: false, text: "This customer has not written to you yet, so only an approved template can start the chat." };
    const h = (Date.now() - at) / 3600000;
    return h < 24 ? { open: true, text: `The customer wrote ${h < 1 ? "less than an hour" : Math.round(h) + " h"} ago. You can reply freely, so a template is optional.` } : { open: false, text: "The customer last wrote more than 24 hours ago, so only an approved template can be sent." };
  }
  const chip = (t) => `<span class="wt-chip ${t.status === "approved" ? "approved" : t.status === "rejected" ? "rejected" : "pending"}">${t.status === "approved" ? "Approved" : t.status === "rejected" ? "Rejected" : "Waiting for Meta"}</span>`;

  async function tplDraw(win, mode, sel) {
    if (mode === "form") return tplForm();
    if (mode === "confirm") {
      const t = tpls.find((x) => x.id === sel);
      const conv = typeof bvConversations !== "undefined" ? bvConversations.find((c) => c.id === bvSelectedConvId) : null;
      const nm = conv && typeof bvName === "function" ? bvName(conv) : "this customer";
      const w = shell(`<div class="ix-sh"><b>Send template</b><button type="button" id="tpBack">Back</button></div>
        <div class="wt-confirm"><b>${esc(t.title)}</b><div style="margin-top:6px;color:var(--text2)">${esc(fill(t.body))}</div></div>
        <div class="wt-note" style="margin-top:12px">This sends the message to ${esc(nm)} now. Meta may charge a small fee for a template message.</div>
        <div class="ix-foot"><button type="button" id="tpSend" style="background:#2447d6;border-color:#2447d6;color:#fff">Send to ${esc(nm)}</button></div>`);
      w.querySelector("#tpBack").onclick = () => tplDraw(win, "list");
      w.querySelector("#tpSend").onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = "Sending…";
        const conv2 = typeof bvConversations !== "undefined" ? bvConversations.find((c) => c.id === bvSelectedConvId) : null;
        const r = await tcall({ action: "send", template_id: t.id, conversation_id: bvSelectedConvId, first_name: ((conv2 && bvName(conv2)) || "").trim().split(/\s+/)[0] });
        if (r && r.success) { close(); if (typeof bvToast === "function") bvToast("Template sent."); if (typeof bvAfterAgentSend === "function") bvAfterAgentSend(); }
        else { e.target.disabled = false; e.target.textContent = "Try again"; if (typeof bvToast === "function") bvToast((r && r.error) || "Could not send it.", "err"); }
      };
      return;
    }
    const rows = tpls.length ? tpls.map((t) => `<div class="sr-row" ${t.status === "approved" && win && win.send !== false ? `data-u="${t.id}" role="button" tabindex="0"` : ""}><div class="sr-t"><b>${esc(t.title)}</b><span class="sr-b">${esc(t.status === "rejected" && t.reject_reason ? "Meta said: " + t.reject_reason : t.body)}</span>${t.resend_status === "waiting" ? '<span class="sr-b" style="color:#9a3a0b;margin-top:4px">Will be sent to the customer automatically when Meta approves it.</span>' : t.resend_status === "sent" ? '<span class="sr-b" style="color:#0f6b36;margin-top:4px">Sent to the customer.</span>' : ""}</div>${chip(t)}</div>`).join("") : `<div class="sr-empty">No templates yet. Write one, Meta checks it (minutes to a few hours), and once it says Approved you can send it to any customer, even after 24 hours. They stay private to you.</div>`;
    const w = shell(`<div class="ix-sh"><b>WhatsApp templates</b><button type="button" id="tpSync">Refresh</button></div>
      ${win ? `<div class="wt-note ${win.open ? "" : "warn"}">${esc(win.text)}</div>` : ""}<div class="sr-list">${rows}</div><button type="button" class="sr-add" id="tpNew">+ New template</button>`);
    w.querySelector("#tpSync").onclick = () => openTemplates(win);
    w.querySelector("#tpNew").onclick = () => tplDraw(win, "form");
    w.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => tplDraw(win, "confirm", b.dataset.u)));
  }
  function tplForm() {
    const w = shell(`<div class="ix-sh"><b>New template</b><button type="button" id="tpCancel">Cancel</button></div>
      <div class="sr-form"><label for="tpTitle">Name</label><input id="tpTitle" maxlength="60" placeholder="For example: Delivery update">
      <label for="tpBody">Message</label><textarea id="tpBody" maxlength="1024" placeholder="Write the message"></textarea>
      <div class="sr-hint">Type {first_name} for the customer's first name, with words before and after it. Meta reads every template before approving it, so keep it clear and honest.</div>
      <label>Type</label><div class="wt-pills"><button type="button" class="ix-pill ${tcat === "utility" ? "on" : ""}" data-c="utility">Order updates</button><button type="button" class="ix-pill ${tcat === "marketing" ? "on" : ""}" data-c="marketing">Promotion</button></div>
      <div class="sr-hint">Order updates are for things like confirming an address or a delivery. Promotions cost more and need the customer's consent.</div></div>
      <div class="ix-foot"><button type="button" id="tpSave" style="background:#2447d6;border-color:#2447d6;color:#fff">Send to Meta for approval</button></div>`);
    w.querySelector("#tpCancel").onclick = () => openTemplates(null, true);
    w.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { tcat = b.dataset.c; w.querySelectorAll("[data-c]").forEach((x) => x.classList.toggle("on", x === b)); }));
    w.querySelector("#tpSave").onclick = async (e) => {
      const title = w.querySelector("#tpTitle").value.trim(), body = w.querySelector("#tpBody").value.trim();
      if (!title || !body) { if (typeof bvToast === "function") bvToast("Add a name and a message first."); return; }
      e.target.disabled = true; e.target.textContent = "Sending…";
      const r = await tcall({ action: "create", title, body, category: tcat });
      if (r && r.success) { if (typeof bvToast === "function") bvToast("Sent to Meta. It usually takes minutes to a few hours."); openTemplates(null, true); }
      else { e.target.disabled = false; e.target.textContent = "Send to Meta for approval"; if (typeof bvToast === "function") bvToast((r && r.error) || "Meta did not accept it.", "err"); }
    };
    w.querySelector("#tpTitle").focus();
  }
  async function openTemplates(win, keepWin) {
    shell(`<div class="ix-sh"><b>WhatsApp templates</b></div><div class="sr-empty">Checking with Meta…</div>`);
    const [r, ws] = await Promise.all([tcall({ action: "sync" }), win && keepWin ? Promise.resolve(win) : windowState()]);
    tpls = (r && r.templates) || [];
    tplDraw(ws, "list");
  }
  window.bvTemplateModal = () => openTemplates(null);

  // Pressing send after the customer's 24-hour window has closed: WhatsApp will only deliver an approved template, so offer to submit THIS message to Meta
  // and send it to the chat automatically the moment Meta approves it (the poll job in send-whatsapp-template does the sending and the notification).
  window.bvClosedWindowSheet = function (text) {
    const conv = typeof bvConversations !== "undefined" ? bvConversations.find((c) => c.id === bvSelectedConvId) : null;
    const nm = conv && typeof bvName === "function" ? bvName(conv) : "the customer";
    const w = shell(`<div class="ix-sh"><b>Cannot send yet</b><button type="button" id="cwX">Close</button></div>
      <div class="wt-note warn">${esc(nm)} last wrote more than 24 hours ago, so WhatsApp only delivers a Meta-approved template now.</div>
      <div class="wt-confirm" style="margin-top:10px"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text2)">Your message</div><div style="margin-top:6px;white-space:pre-wrap">${esc(text)}</div></div>
      <div class="sr-form"><label class="sr-chk" style="display:flex;gap:10px;align-items:center;text-transform:none;letter-spacing:0;font-size:14.5px;font-weight:500;color:var(--text)"><input type="checkbox" id="cwKeep" checked style="width:20px;height:20px;flex:none"> Also keep it in my saved replies</label></div>
      <div class="ix-foot" style="flex-direction:column"><button type="button" id="cwSend" style="flex:none;height:52px;background:#2447d6;border-color:#2447d6;color:#fff">Send to Meta for approval, then auto-send</button><button type="button" id="cwTpl" style="flex:none;height:52px">Use an approved template instead</button></div>
      <div class="sr-hint" style="padding:12px 20px 0">Meta usually approves in minutes to a few hours. When it does, we send this to ${esc(nm)} for you and notify you. Meta may charge a small fee for a template message.</div>`);
    w.querySelector("#cwX").onclick = close;
    w.querySelector("#cwTpl").onclick = () => openTemplates(null);
    w.querySelector("#cwSend").onclick = async (e) => {
      const b = e.target; b.disabled = true; b.textContent = "Sending to Meta…";
      const title = text.replace(/\s+/g, " ").slice(0, 40).trim() || "Message";
      const r = await tcall({ action: "create", title, body: text, category: "utility", resend_conversation_id: bvSelectedConvId });
      if (r && r.success) {
        if (w.querySelector("#cwKeep").checked) await save({ title, body: text });
        const box = document.getElementById("convReplyInput"); if (box) { box.value = ""; box.dispatchEvent(new Event("input", { bubbles: true })); }
        close();
        if (typeof bvToast === "function") bvToast("Sent to Meta. We will send it to " + nm + " and notify you when it is approved.");
      } else {
        b.disabled = false; b.textContent = "Send to Meta for approval, then auto-send";
        if (typeof bvToast === "function") bvToast((r && r.error) || "Meta did not accept it.", "err");
      }
    };
  };
})();
