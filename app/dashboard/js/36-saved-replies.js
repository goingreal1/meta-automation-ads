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
      <div class="sr-list">${body}</div><button type="button" class="sr-add" id="srNew">+ New reply</button>`);
    w.querySelector("#srMode").onclick = () => { manage = !manage; draw(); };
    w.querySelector("#srNew").onclick = () => { editing = { id: "", title: "", body: "" }; draw(); };
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
  window.bvSavedReplies = async function () {
    manage = false; editing = null;
    shell(`<div class="ix-sh"><b>Saved replies</b></div><div class="sr-empty">Loading…</div>`);
    await load();
    draw();
  };
})();
