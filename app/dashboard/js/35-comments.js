// Revora dashboard, part 35: COMMENTS inside Conversations.
// A "Chats | Comments" switch on the Conversations tab. Comments on your Pages and on your ads' posts are synced every 10 minutes
// (page_comments); here you read them, pick a Page, and answer in public. A reply always needs your tap on "Reply publicly".
(function () {
  if (typeof renderConversations !== "function") return;
  const orig = renderConversations;
  const CM = { pages: null, page: "", filter: "open", rows: [], open: null, timer: 0 };

  const css = `
  .cm2-seg{display:flex;background:var(--panel2,#e4e6eb);border-radius:12px;padding:3px;margin:0 0 12px;max-width:340px}
  .cm2-seg button{flex:1;min-height:40px;border:0;border-radius:10px;background:none;font:inherit;font-size:14px;font-weight:600;color:var(--text2,#5f6368);cursor:pointer}
  .cm2-seg button.on{background:var(--panel,#fff);color:var(--text,#1c1e21);box-shadow:0 1px 3px rgba(0,0,0,.1)}
  .cm2-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 10px}
  .cm2-bar select{min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:14px}
  .cm2-chip{min-height:36px;padding:0 13px;border-radius:99px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
  .cm2-chip.on{background:var(--accent,#1877f2);border-color:var(--accent,#1877f2);color:#fff}
  .cm2-chip.soon{color:var(--muted);border-style:dashed;cursor:default}
  .cm2-list{background:var(--panel);border:1px solid var(--border);border-radius:14px;overflow:hidden}
  .cm2-row{display:flex;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;min-height:56px}
  .cm2-row:last-child{border-bottom:0}.cm2-row:hover{background:var(--hover,rgba(0,0,0,.03))}
  .cm2-av{width:44px;height:44px;border-radius:99px;background:rgba(24,119,242,.14);color:#1877f2;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}
  .cm2-top{display:flex;justify-content:space-between;gap:8px}.cm2-top b{font-size:15px}.cm2-top span{font-size:12px;color:var(--muted);flex:none}
  .cm2-tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;margin:3px 6px 0 0;background:rgba(24,119,242,.12);color:#1877f2}
  .cm2-tag.g{background:var(--panel2);color:var(--text2)}.cm2-tag.ok{background:rgba(26,154,74,.14);color:#1a9a4a}.cm2-tag.h{background:rgba(217,48,37,.12);color:#d93025}
  .cm2-msg{font-size:14px;margin-top:3px;line-height:1.35;overflow-wrap:anywhere}.cm2-sub{font-size:12px;color:var(--muted);margin-top:3px}
  .cm2-dot{width:9px;height:9px;border-radius:99px;background:#1877f2;flex:none;margin-top:7px}
  .cm2-th{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px;max-width:760px}
  .cm2-bub{background:var(--panel2);border-radius:4px 16px 16px 16px;padding:10px 13px;font-size:15px;line-height:1.4;max-width:88%;margin:10px 0;overflow-wrap:anywhere}
  .cm2-me{background:#1877f2;color:#fff;border-radius:16px 4px 16px 16px;padding:10px 13px;font-size:15px;line-height:1.4;max-width:88%;margin:10px 0 10px auto;overflow-wrap:anywhere}
  .cm2-th textarea{width:100%;min-height:84px;border:1px solid var(--border);border-radius:12px;padding:10px 12px;background:var(--panel);color:var(--text);font:inherit;font-size:15px;box-sizing:border-box}
  .cm2-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .cm2-btn{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:14px;font-weight:700;cursor:pointer}
  .cm2-btn.p{background:#1877f2;border-color:#1877f2;color:#fff}.cm2-btn:disabled{opacity:.55;cursor:default}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? "now" : m < 60 ? m + " min" : m < 1440 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " d"; };
  const ini = (n) => (String(n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("") || "?").toUpperCase();
  const pageName = (id) => ((CM.pages || []).find((p) => p.page_id === id) || {}).name || "Page";

  async function load() {
    if (!CM.pages) { const r = await sbFn("page-tools", { action: "my_pages", ad_account_id: undefined }).catch(() => null); CM.pages = (r && r.pages) || []; }
    const f = CM.filter === "open" ? "&status=eq.new" : CM.filter === "replied" ? "&status=eq.replied" : CM.filter === "hidden" ? "&status=eq.hidden" : "";
    const pg = CM.page ? `&page_id=eq.${CM.page}` : "";
    CM.rows = (await sbQuery("page_comments", `select=*&is_page_reply=eq.false${f}${pg}&order=created_time.desc&limit=120`).catch(() => [])) || [];
  }

  async function countNew() {
    const rows = await sbQuery("page_comments", "select=id&is_page_reply=eq.false&status=eq.new&read_at=is.null&limit=200").catch(() => []);
    return (rows || []).length;
  }

  function listHtml() {
    const chip = (k, t) => `<button type="button" class="cm2-chip ${CM.filter === k ? "on" : ""}" data-f="${k}">${t}</button>`;
    const pages = CM.pages || [];
    const bar = `<div class="cm2-bar">
      <select id="cm2Page" aria-label="Page"><option value="">All pages</option>${pages.map((p) => `<option value="${escH(p.page_id)}" ${p.page_id === CM.page ? "selected" : ""}>${escH(p.name || p.page_id)}</option>`).join("")}</select>
      ${chip("open", "Needs a reply")}${chip("replied", "Replied")}${chip("hidden", "Hidden")}${chip("all", "All")}
      <button type="button" class="cm2-chip soon" title="Coming later">Messenger · Soon</button><button type="button" class="cm2-chip soon" title="Coming later">Instagram · Soon</button>
      <button type="button" class="cm2-chip" id="cm2Refresh">Refresh</button></div>`;
    const rows = CM.rows.map((c) => {
      const unread = c.status === "new" && !c.read_at;
      const tag = c.status === "replied" ? '<span class="cm2-tag ok">Replied</span>' : c.status === "hidden" ? '<span class="cm2-tag h">Hidden</span>' : c.status === "ignored" ? '<span class="cm2-tag g">Old</span>' : "";
      return `<div class="cm2-row" data-id="${c.id}"><div class="cm2-av">${escH(ini(c.from_name))}</div><div style="flex:1;min-width:0"><div class="cm2-top"><b>${escH(c.from_name || "Someone")}</b><span>${ago(c.created_time)}</span></div>
        <div><span class="cm2-tag">Facebook comment</span><span class="cm2-tag g">${escH(pageName(c.page_id))}</span>${tag}</div>
        <div class="cm2-msg">${escH(c.message || "(a picture, sticker or emoji)")}</div>${c.ad_name ? `<div class="cm2-sub">On ad: ${escH(c.ad_name)}</div>` : ""}</div>${unread ? '<div class="cm2-dot" aria-label="New"></div>' : ""}</div>`;
    }).join("");
    return bar + `<div class="cm2-list">${rows || `<div style="padding:24px;color:var(--text2);font-size:14px;">${CM.filter === "open" ? "Nothing needs a reply. New comments appear here within about 10 minutes." : "No comments here."}</div>`}</div>`;
  }

  async function paint(box) {
    await load();
    box.innerHTML = listHtml();
    box.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { CM.filter = b.dataset.f; paint(box); }));
    box.querySelector("#cm2Page").onchange = (e) => { CM.page = e.target.value; paint(box); };
    box.querySelector("#cm2Refresh").onclick = () => paint(box);
    box.querySelectorAll(".cm2-row").forEach((r) => (r.onclick = () => thread(box, r.dataset.id)));
  }

  async function thread(box, id) {
    const c = CM.rows.find((x) => x.id === id); if (!c) return;
    sbFn("page-tools", { action: "comments_read", id, ad_account_id: undefined }).catch(() => {});
    const kids = (await sbQuery("page_comments", `select=*&parent_comment_id=eq.${encodeURIComponent(c.comment_id)}&order=created_time.asc`).catch(() => [])) || [];
    const mine = kids.filter((k) => k.is_page_reply).map((k) => `<div class="cm2-me">${escH(k.message)}</div>`).join("") || (c.reply_text ? `<div class="cm2-me">${escH(c.reply_text)}</div>` : "");
    box.innerHTML = `<div style="margin:0 0 10px"><button type="button" class="cm2-btn" id="cm2Back">&larr; Comments</button></div>
      <div class="cm2-th"><div style="font-weight:700;font-size:16px">${escH(c.from_name || "Someone")}</div>
        <div class="cm2-sub">Facebook comment · ${escH(pageName(c.page_id))} · ${ago(c.created_time)} ago${c.ad_name ? ` · on ad: ${escH(c.ad_name)}` : ""}</div>
        <div class="cm2-bub">${escH(c.message || "(a picture, sticker or emoji)")}</div>${mine}
        <div style="margin-top:12px"><textarea id="cm2Text" aria-label="Your public reply" placeholder="Write your reply…"></textarea>
        <div class="cm2-act"><button type="button" class="cm2-btn" id="cm2Sug">Suggest a reply</button><button type="button" class="cm2-btn" id="cm2Hide">${c.status === "hidden" ? "Unhide" : "Hide"}</button><button type="button" class="cm2-btn p" id="cm2Send">Reply publicly</button></div>
        <div id="cm2Res" style="font-size:13px;margin-top:8px;color:var(--text2)">Your reply appears under the comment for everyone to see.</div></div></div>`;
    const res = box.querySelector("#cm2Res"), ta = box.querySelector("#cm2Text");
    box.querySelector("#cm2Back").onclick = () => paint(box);
    box.querySelector("#cm2Sug").onclick = async (e) => {
      const b = e.target; b.disabled = true; b.textContent = "Thinking…";
      const r = await sbFn("page-tools", { action: "comments_suggest", id, ad_account_id: undefined });
      b.disabled = false; b.textContent = "Suggest a reply";
      if (r && r.suggestion) { ta.value = r.suggestion; res.style.color = "var(--text2)"; res.textContent = "Edit it if you like, then tap Reply publicly."; }
      else { res.style.color = "var(--danger,#d33)"; res.textContent = (r && r.error) || "No suggestion right now."; }
    };
    box.querySelector("#cm2Hide").onclick = async () => {
      const r = await sbFn("page-tools", { action: "comments_hide", id, hidden: c.status !== "hidden", ad_account_id: undefined });
      if (r && r.ok) { bvToast(c.status === "hidden" ? "Comment unhidden." : "Comment hidden."); paint(box); } else { res.style.color = "var(--danger,#d33)"; res.textContent = (r && r.error) || "Meta did not accept that."; }
    };
    box.querySelector("#cm2Send").onclick = async (e) => {
      const message = ta.value.trim(); if (!message) { res.style.color = "var(--danger,#d33)"; res.textContent = "Write the reply first."; return; }
      const b = e.target; b.disabled = true; b.textContent = "Replying…";
      const r = await sbFn("page-tools", { action: "comments_reply", id, message, confirmed: true, ad_account_id: undefined });
      if (r && r.ok) { bvToast("Replied."); paint(box); } else { b.disabled = false; b.textContent = "Reply publicly"; res.style.color = "var(--danger,#d33)"; res.textContent = (r && r.error) || "Meta did not accept the reply."; }
    };
  }

  window.renderConversations = async function (el) {
    await orig(el);
    const root = el.querySelector("#convTabRoot"); if (!root) return;
    const head = root.querySelector(".sh");
    const staff = ["owner", "admin", "buyer"].includes(window.myProfile && window.myProfile.role);
    if (!head || !staff) return;
    const seg = document.createElement("div"); seg.className = "cm2-seg"; seg.innerHTML = '<button type="button" class="on" data-s="chats">Chats</button><button type="button" data-s="comments" id="cm2SegC">Comments</button>';
    head.insertAdjacentElement("afterend", seg);
    const box = document.createElement("div"); box.id = "cm2Box"; box.style.display = "none"; seg.insertAdjacentElement("afterend", box);
    const others = () => [...root.children].filter((x) => x !== head && x !== seg && x !== box);
    seg.querySelectorAll("button").forEach((b) => (b.onclick = () => {
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      const on = b.dataset.s === "comments";
      others().forEach((x) => (x.style.display = on ? "none" : ""));
      box.style.display = on ? "" : "none";
      clearInterval(CM.timer);
      if (on) { paint(box); CM.timer = setInterval(() => { if (document.getElementById("cm2Box") && box.querySelector(".cm2-list")) paint(box); }, 90000); }
    }));
    countNew().then((n) => { const c = seg.querySelector("#cm2SegC"); if (c && n) c.textContent = "Comments " + n; });
  };
})();
