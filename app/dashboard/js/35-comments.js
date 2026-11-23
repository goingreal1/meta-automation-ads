// Revora dashboard, part 35: COMMENTS inside Conversations.
// A "Chats | Comments" switch on the Conversations tab. Comments on your Pages and on your ads' posts are synced every 10 minutes
// (page_comments); here you read them, pick a Page, and answer in public. A reply always needs your tap on "Reply publicly".
(function () {
  if (typeof renderConversations !== "function") return;
  const orig = renderConversations;
  const CM = { pages: null, page: "", filter: "open", rows: [], open: null, timer: 0 };

  const css = `
  .cm2-seg{display:flex;background:var(--panel2);border:1px solid var(--border);border-radius:16px;padding:4px;margin:6px 0 20px}
  .cm2-seg button{flex:1;min-height:46px;border:0;border-radius:12px;background:none;font:inherit;font-size:15px;font-weight:600;color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}
  .cm2-seg button.on{background:var(--panel);color:var(--text);box-shadow:0 1px 4px rgba(0,0,0,.12)}
  .cm2-n{min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:#2447d6;color:#fff;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
  #cm2Box{padding-bottom:120px}
  .cm2-sel{width:100%;margin-top:16px;height:50px;padding:0 16px;border-radius:14px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:16px;font-weight:600;margin-bottom:14px;box-sizing:border-box}
  .cm2-chips{display:flex;gap:10px;overflow-x:auto;margin:0 -16px 20px;padding:2px 16px;scrollbar-width:none}
  .cm2-chips::-webkit-scrollbar{display:none}
  .cm2-chip{flex:none;height:40px;padding:0 18px;border-radius:99px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
  .cm2-chip.on{background:#2447d6;border-color:#2447d6;color:#fff}
  .cm2-chip.soon{color:var(--muted);border-style:dashed;background:none;cursor:default;font-weight:500}
  .cm2-list{background:var(--panel);border:1px solid var(--border);border-radius:18px;overflow:hidden}
  .cm2-row{display:flex;gap:14px;padding:18px 18px 18px 16px;border-bottom:1px solid var(--border);cursor:pointer;align-items:flex-start}
  .cm2-row:last-child{border-bottom:0}.cm2-row:active{background:var(--panel2)}
  .cm2-av{width:46px;height:46px;border-radius:99px;background:rgba(36,71,214,.12);color:#2447d6;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;flex:none}
  .cm2-main{flex:1;min-width:0}
  .cm2-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  .cm2-top b{font-size:16px;font-weight:700;color:var(--text)}.cm2-top span{font-size:13px;color:var(--muted);flex:none}
  .cm2-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .cm2-tag{font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;background:rgba(36,71,214,.1);color:#2447d6;white-space:nowrap}
  .cm2-tag.g{background:var(--panel2);color:var(--text2);border:1px solid var(--border)}.cm2-tag.ok{background:rgba(26,154,74,.12);color:#1a9a4a}.cm2-tag.h{background:rgba(217,48,37,.1);color:#d93025}
  .cm2-msg{font-size:16px;line-height:1.5;margin-top:10px;color:var(--text);overflow-wrap:anywhere}
  .cm2-sub{font-size:13px;color:var(--muted);margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cm2-dot{width:10px;height:10px;border-radius:99px;background:#2447d6;flex:none;margin-top:6px}
  .cm2-foot{text-align:center;font-size:13px;color:var(--muted);margin:18px 0 0}
  .cm2-foot button{border:0;background:none;color:#2447d6;font:inherit;font-weight:600;cursor:pointer;padding:6px}
  .cm2-empty{padding:48px 24px;text-align:center;color:var(--text2);font-size:15px;line-height:1.5}
  .cm2-back{border:0;background:none;color:#2447d6;font:inherit;font-size:16px;font-weight:600;padding:8px 0;margin:0 0 10px;cursor:pointer}
  .cm2-th{background:var(--panel);border:1px solid var(--border);border-radius:18px;padding:20px}
  .cm2-bub{background:var(--panel2);border:1px solid var(--border);border-radius:6px 18px 18px 18px;padding:14px 16px;font-size:16px;line-height:1.5;max-width:92%;margin:16px 0;overflow-wrap:anywhere}
  .cm2-me{background:#2447d6;color:#fff;border-radius:18px 6px 18px 18px;padding:14px 16px;font-size:16px;line-height:1.5;max-width:92%;margin:16px 0 16px auto;overflow-wrap:anywhere}
  .cm2-th textarea{width:100%;min-height:110px;border:1px solid var(--border);border-radius:14px;padding:14px 16px;background:var(--panel);color:var(--text);font:inherit;font-size:16px;line-height:1.5;box-sizing:border-box;resize:vertical}
  .cm2-act{display:flex;flex-direction:column;gap:10px;margin-top:14px}
  .cm2-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .cm2-btn{min-height:50px;padding:0 16px;border-radius:14px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:15px;font-weight:700;cursor:pointer}
  .cm2-btn.p{background:#2447d6;border-color:#2447d6;color:#fff}.cm2-btn:disabled{opacity:.55;cursor:default}`;
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
    const bar = `<select class="cm2-sel" id="cm2Page" aria-label="Page"><option value="">All pages</option>${pages.map((p) => `<option value="${escH(p.page_id)}" ${p.page_id === CM.page ? "selected" : ""}>${escH(p.name || p.page_id)}</option>`).join("")}</select>
      <div class="cm2-chips">${chip("open", "Needs a reply")}${chip("replied", "Replied")}${chip("hidden", "Hidden")}${chip("all", "All")}<span class="cm2-chip soon">Messenger · Soon</span><span class="cm2-chip soon">Instagram · Soon</span></div>`;
    const rows = CM.rows.map((c) => {
      const unread = c.status === "new" && !c.read_at;
      const tag = c.status === "replied" ? '<span class="cm2-tag ok">Replied</span>' : c.status === "hidden" ? '<span class="cm2-tag h">Hidden</span>' : c.status === "ignored" ? '<span class="cm2-tag g">Old</span>' : "";
      return `<div class="cm2-row" data-id="${c.id}"><div class="cm2-av">${escH(ini(c.from_name))}</div><div class="cm2-main"><div class="cm2-top"><b>${escH(c.from_name || "Someone")}</b><span>${ago(c.created_time)}</span></div>
        <div class="cm2-tags"><span class="cm2-tag">Facebook comment</span><span class="cm2-tag g">${escH(pageName(c.page_id))}</span>${tag}</div>
        <div class="cm2-msg">${escH(c.message || "(a picture, sticker or emoji)")}</div>${c.ad_name ? `<div class="cm2-sub">On ad: ${escH(c.ad_name)}</div>` : ""}</div>${unread ? '<div class="cm2-dot" aria-label="New"></div>' : ""}</div>`;
    }).join("");
    return bar + (CM.rows.length ? `<div class="cm2-list">${rows}</div>` : `<div class="cm2-list"><div class="cm2-empty">${CM.filter === "open" ? "Nothing needs a reply.<br>New comments show up here within about 10 minutes." : "No comments here."}</div></div>`) + `<div class="cm2-foot">Checked every 10 minutes <button type="button" id="cm2Refresh">Refresh</button></div>`;
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
    box.innerHTML = `<button type="button" class="cm2-back" id="cm2Back">&#8249; Comments</button>
      <div class="cm2-th"><div style="font-weight:700;font-size:18px">${escH(c.from_name || "Someone")}</div>
        <div class="cm2-sub" style="white-space:normal;margin-top:6px">Facebook comment · ${escH(pageName(c.page_id))} · ${ago(c.created_time)} ago${c.ad_name ? `<br>On ad: ${escH(c.ad_name)}` : ""}</div>
        <div class="cm2-bub">${escH(c.message || "(a picture, sticker or emoji)")}</div>${mine}
        <textarea id="cm2Text" aria-label="Your public reply" placeholder="Write your reply…"></textarea>
        <div class="cm2-act"><button type="button" class="cm2-btn p" id="cm2Send">Reply publicly</button>
          <div class="cm2-two"><button type="button" class="cm2-btn" id="cm2Sug">Suggest a reply</button><button type="button" class="cm2-btn" id="cm2Hide">${c.status === "hidden" ? "Unhide" : "Hide"}</button></div></div>
        <div id="cm2Res" style="font-size:13px;line-height:1.4;margin-top:14px;color:var(--text2)">Your reply appears under the comment for everyone to see.</div></div>`;
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

  // ======== INBOX SHELL (title row, three tabs, sections, filter sheet) ========
  const ixcss = `
  #convTabRoot .g4,#convTabRoot .conv-chips,#convTabRoot .conv-search{display:none}
  #convTabRoot.ix-searching .conv-search{display:block}
  #convTabRoot #convListPanel{border:0;border-radius:0;box-shadow:none;background:var(--panel)}
  .ix-head{display:flex;align-items:center;gap:4px;padding:6px 0 10px}
  .ix-head .ix-t{flex:1;min-width:0}
  .ix-head h1{margin:0;font-family:Fraunces,Georgia,serif;font-weight:600;font-size:30px;line-height:1.1;letter-spacing:-.02em;color:var(--text)}
  .ix-head small{display:block;margin-top:5px;font-size:13.5px;font-weight:500;color:var(--muted)}
  .ix-ib{width:44px;height:44px;border:0;background:none;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--text);position:relative;padding:0;cursor:pointer}
  .ix-ib svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .ix-ib i{position:absolute;top:10px;right:10px;width:9px;height:9px;border-radius:50%;background:#2447d6;border:2px solid var(--panel)}
  .ix-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin:0 0 0}
  .ix-tab{height:46px;padding:0 14px;display:flex;align-items:center;gap:8px;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;font:inherit;font-size:14.5px;font-weight:600;color:var(--muted);cursor:pointer;white-space:nowrap}
  .ix-tab.on{color:var(--text);border-bottom-color:var(--text)}
  .ix-tab em{font-style:normal;min-width:20px;height:20px;border-radius:10px;background:var(--panel2);border:1px solid var(--border);font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;padding:0 6px;color:var(--text2)}
  .ix-tab.on em{background:#2447d6;border-color:#2447d6;color:#fff}
  .ix-sec{display:flex;align-items:baseline;gap:8px;padding:14px 20px 8px;background:var(--bg);border-top:1px solid var(--border);border-bottom:1px solid var(--border);font-size:11.5px;font-weight:700;letter-spacing:.08em;color:var(--text2);text-transform:uppercase}
  .ix-sec span{font-weight:500;letter-spacing:0;text-transform:none;color:var(--muted);font-size:12.5px}
  .ix-r{display:flex;gap:14px;padding:14px 20px;border-bottom:1px solid var(--border);align-items:flex-start;cursor:pointer;background:var(--panel)}
  .ix-r:active,.ix-r.active{background:var(--panel2)}
  .ix-av{position:relative;width:48px;height:48px;flex:none}
  .ix-ini{width:48px;height:48px;border-radius:50%;background:var(--panel2);border:1px solid var(--border);color:var(--text2);font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center}
  .ix-ch{position:absolute;right:-3px;bottom:-3px;width:20px;height:20px;border-radius:50%;border:2px solid var(--panel);display:flex;align-items:center;justify-content:center}
  .ix-ch svg{width:11px;height:11px;fill:#fff}
  .ix-ch.wa{background:#168a45}.ix-ch.ms{background:#0a6fe8}.ix-ch.ig{background:#b5307d}.ix-ch.fb{background:#1877f2}
  .ix-rb{flex:1;min-width:0}
  .ix-l1{display:flex;gap:8px;justify-content:space-between;align-items:baseline}
  .ix-l1 b{font-size:15.5px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ix-l1 time{font-size:12.5px;color:var(--muted);flex:none}
  .ix-r.un .ix-l1 b{font-weight:700}.ix-r.un .ix-l1 time{color:#2447d6;font-weight:600}
  .ix-r .ix-l1 time.wt,.ix-r.un .ix-l1 time.wt{color:#9a3a0b;font-weight:600}
  .ix-l2{font-size:14px;color:var(--text2);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.35}
  .ix-r.un .ix-l2{color:var(--text)}
  .ix-l3{display:flex;gap:6px;margin-top:8px;overflow:hidden}
  .ix-tg{font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:6px;background:var(--panel2);border:1px solid var(--border);color:var(--text2);white-space:nowrap}
  .ix-cnt{align-self:center;min-width:22px;height:22px;border-radius:11px;background:#2447d6;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 7px;flex:none}
  .ix-empty{padding:48px 24px;text-align:center;color:var(--text2);font-size:15px;line-height:1.5}
  .ix-scrim{position:fixed;inset:0;background:rgba(20,19,15,.45);z-index:9998}
  .ix-sheet{position:fixed;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;background:var(--panel);border-radius:22px 22px 0 0;padding:10px 0 calc(22px + env(safe-area-inset-bottom));z-index:9999;max-width:520px;margin:0 auto}
  .ix-grab{width:40px;height:4px;border-radius:2px;background:var(--borderStrong,#d6d1c4);margin:0 auto 6px}
  .ix-sh{display:flex;align-items:center;padding:8px 20px 4px}.ix-sh b{font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:600;flex:1;color:var(--text)}
  .ix-sh button{border:0;background:none;color:#2447d6;font:inherit;font-size:14.5px;font-weight:600;height:44px;cursor:pointer}
  .ix-lbl{font-size:11.5px;font-weight:700;letter-spacing:.08em;color:var(--text2);text-transform:uppercase;padding:16px 20px 10px}
  .ix-pills{display:flex;gap:8px;padding:0 20px;flex-wrap:wrap}
  .ix-pill{height:40px;padding:0 16px;border-radius:20px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:14px;font-weight:600;cursor:pointer}
  .ix-pill.on{background:var(--text);color:var(--panel);border-color:var(--text)}
  .ix-opt{display:flex;align-items:center;gap:14px;padding:0 20px;min-height:56px;border:0;border-top:1px solid var(--border);background:none;width:100%;text-align:left;font:inherit;color:var(--text);cursor:pointer}
  .ix-opt b{flex:1;font-size:15px;font-weight:600}
  .ix-rad{width:22px;height:22px;border-radius:50%;border:2px solid #cfc9ba;flex:none}.ix-rad.on{border:7px solid #2447d6}
  .ix-foot{display:flex;gap:10px;padding:16px 20px 0}
  .ix-foot button{flex:1;height:50px;border-radius:14px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit;font-size:15px;font-weight:700;cursor:pointer}`;
  const ixst = document.createElement("style"); ixst.textContent = ixcss; document.head.appendChild(ixst);

  const GL = {
    wa: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z"/>',
    ms: '<path d="M13.5 2L5 13.5h6L10 22l9-12h-6z"/>',
    ig: '<path fill-rule="evenodd" d="M7 3h10a4 4 0 014 4v10a4 4 0 01-4 4H7a4 4 0 01-4-4V7a4 4 0 014-4zm5 5a4 4 0 100 8 4 4 0 000-8zm5.5-2a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z"/>',
    fb: '<path fill-rule="evenodd" d="M3 4h18v13H9l-6 4zM7 8v2h10V8zm0 4v2h7v-2z"/>'
  };
  const CHN = { wa: "WhatsApp", ms: "Messenger", ig: "Instagram", fb: "Comment" };
  const IC = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    sliders: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>'
  };
  const IX = { tab: "all", cmNew: [] };
  const chOf = (c) => (c.channel === "messenger" ? "ms" : c.channel === "instagram" ? "ig" : "wa");
  const lastOf = (c) => (typeof bvLastMsgs !== "undefined" ? bvLastMsgs[c.id] : null);
  const stampOf = (c) => Date.parse((lastOf(c) && lastOf(c).created_at) || c.last_message_at) || 0;
  const needsOf = (c) => { const l = lastOf(c); return !!l && l.direction === "inbound" && c.current_state !== "COMPLETED"; };
  const waitTxt = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return "Waiting " + (m < 60 ? m + " min" : m < 1440 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " d"); };
  const badge = (k) => `<span class="ix-ch ${k}"><svg viewBox="0 0 24 24">${GL[k]}</svg></span>`;

  function ixRow(o) {
    return `<div class="ix-r ${o.un ? "un" : ""} ${o.active ? "active" : ""}" onclick="${o.click}"><div class="ix-av"><div class="ix-ini">${escH(o.ini)}</div>${badge(o.ch)}</div>
      <div class="ix-rb"><div class="ix-l1"><b>${escH(o.name)}</b><time class="${o.wait ? "wt" : ""}">${escH(o.time)}</time></div><div class="ix-l2">${o.ticks || ""}${escH(o.text)}</div>
      <div class="ix-l3"><span class="ix-tg">${CHN[o.ch]}</span>${(o.tags || []).map((t) => `<span class="ix-tg">${escH(t)}</span>`).join("")}</div></div>${o.cnt ? `<span class="ix-cnt">${o.cnt > 99 ? "99+" : o.cnt}</span>` : ""}</div>`;
  }

  window.bvRenderList = function (list) {
    const wrap = document.getElementById("convListItems"); if (!wrap) return;
    const now = Date.now();
    const items = list.map((c) => {
      const l = lastOf(c), t = stampOf(c), needs = needsOf(c);
      return { t, needs, html: ixRow({ ch: chOf(c), ini: ini(bvName(c)), name: bvName(c), un: c.unread_count > 0 || needs, wait: needs, time: needs ? waitTxt(now - t) : bvListTime((l && l.created_at) || c.last_message_at), text: bvPreviewText(l), ticks: l && l.direction === "outbound" ? `<span class="bubble-ticks">${bvTicks(l)}</span>` : "", tags: c.human_handling ? ["You're handling"] : [], cnt: c.unread_count, click: `bvSelectConversation('${c.id}')`, active: c.id === bvSelectedConvId }) };
    });
    if (IX.tab === "all") (IX.cmNew || []).forEach((k) => { const t = Date.parse(k.created_time) || 0; items.push({ t, needs: true, html: ixRow({ ch: "fb", ini: ini(k.from_name), name: k.from_name || "Someone", un: true, wait: true, time: waitTxt(now - t), text: k.message || "(a picture, sticker or emoji)", tags: [pageName(k.page_id)], click: `bvOpenComment('${k.id}')` }) }); });
    const needs = items.filter((x) => x.needs).sort((a, b) => a.t - b.t);
    const rest = items.filter((x) => !x.needs).sort((a, b) => b.t - a.t);
    const day = new Date().toDateString();
    const today = rest.filter((x) => new Date(x.t).toDateString() === day), earlier = rest.filter((x) => new Date(x.t).toDateString() !== day);
    const sec = (title, hint, arr) => arr.length ? `<div class="ix-sec">${title}${hint ? ` <span>${hint}</span>` : ""}</div>` + arr.map((x) => x.html).join("") : "";
    wrap.innerHTML = items.length ? sec("Needs your reply", "longest wait first", needs) + sec("Today", "", today) + sec("Earlier", "", earlier) : `<div class="ix-empty">${bvListFilter === "all" ? "No conversations yet." : "Nothing here."}</div>`;
  };
  window.bvFilterList = function () {
    const q = (document.getElementById("convSearch")?.value || "").toLowerCase();
    let list = bvConversations;
    if (bvListFilter === "unread") list = list.filter((c) => c.unread_count > 0);
    else if (bvListFilter === "handoff") list = list.filter((c) => c.human_handling);
    else if (bvListFilter === "needs") list = list.filter(needsOf);
    if (q) list = list.filter((c) => bvName(c).toLowerCase().includes(q) || (c.phone || "").includes(q));
    bvRenderList(list);
  };

  function ixSheet(el, numbers) {
    const close = () => { document.getElementById("ixSheetWrap")?.remove(); };
    close();
    const w = document.createElement("div"); w.id = "ixSheetWrap";
    const pill = (k, t) => `<button type="button" class="ix-pill ${bvListFilter === k ? "on" : ""}" data-k="${k}">${t}</button>`;
    const opt = (v, t) => `<button type="button" class="ix-opt" data-n="${escH(v)}"><b>${escH(t)}</b><span class="ix-rad ${bvSelectedNumberId === v ? "on" : ""}"></span></button>`;
    w.innerHTML = `<div class="ix-scrim"></div><div class="ix-sheet" role="dialog" aria-label="Filter inbox"><div class="ix-grab"></div>
      <div class="ix-sh"><b>Filter inbox</b><button type="button" id="ixClear">Clear</button></div>
      <div class="ix-lbl">Show</div><div class="ix-pills">${pill("all", "Everything")}${pill("needs", "Needs reply")}${pill("unread", "Unread")}${pill("handoff", "You're handling")}</div>
      ${numbers.length ? `<div class="ix-lbl">WhatsApp number</div>${opt("", "All numbers")}${numbers.map((n) => opt(n.v, n.t)).join("")}` : ""}
      <div class="ix-foot"><button type="button" id="ixSup">Support</button><button type="button" id="ixRef">Refresh</button></div></div>`;
    document.body.appendChild(w);
    w.querySelector(".ix-scrim").onclick = close;
    w.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { bvListFilter = b.dataset.k; bvFilterList(); close(); renderChrome(el); }));
    w.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => { bvSelectedNumberId = b.dataset.n; close(); renderConversations(el); }));
    w.querySelector("#ixClear").onclick = () => { bvListFilter = "all"; if (bvSelectedNumberId) { bvSelectedNumberId = ""; close(); renderConversations(el); return; } bvFilterList(); close(); renderChrome(el); };
    w.querySelector("#ixSup").onclick = () => { close(); if (typeof bvSupportChat === "function") bvSupportChat(); };
    w.querySelector("#ixRef").onclick = () => { close(); if (typeof render === "function") render(); };
  }

  let ixNumbers = [];
  function renderChrome(el) {
    const root = el.querySelector("#convTabRoot"); if (!root) return;
    const needsN = bvConversations.filter(needsOf).length, cmN = (IX.cmNew || []).length;
    const filtered = bvListFilter !== "all" || !!bvSelectedNumberId;
    const sub = needsN + cmN ? `${needsN + cmN} need your reply` : "You're all caught up";
    const head = root.querySelector(".ix-head");
    head.innerHTML = `<div class="ix-t"><h1>Inbox</h1><small>${sub}</small></div>
      <button type="button" class="ix-ib" id="ixSearch" aria-label="Search">${IC.search}</button>
      <button type="button" class="ix-ib" id="ixFilter" aria-label="Filters${filtered ? ", active" : ""}">${IC.sliders}${filtered ? "<i></i>" : ""}</button>`;
    head.querySelector("#ixSearch").onclick = () => { root.classList.toggle("ix-searching"); if (root.classList.contains("ix-searching")) document.getElementById("convSearch")?.focus(); };
    head.querySelector("#ixFilter").onclick = () => ixSheet(el, ixNumbers);
    const tabs = root.querySelector(".ix-tabs");
    const tab = (k, t, n) => `<button type="button" class="ix-tab ${IX.tab === k ? "on" : ""}" data-t="${k}">${t}${n ? `<em>${n}</em>` : ""}</button>`;
    tabs.innerHTML = tab("all", "All", needsN + cmN) + tab("messages", "Messages", needsN) + tab("comments", "Comments", cmN);
    tabs.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => ixTab(el, b.dataset.t)));
  }

  function ixTab(el, k) {
    const root = el.querySelector("#convTabRoot"); if (!root) return;
    IX.tab = k;
    const box = root.querySelector("#cm2Box"), wrap = root.querySelector(".conv-wrap");
    clearInterval(CM.timer);
    if (k === "comments") { wrap.style.display = "none"; box.style.display = ""; paint(box); CM.timer = setInterval(() => { if (document.getElementById("cm2Box") && box.querySelector(".cm2-list")) paint(box); }, 90000); }
    else { box.style.display = "none"; wrap.style.display = ""; bvFilterList(); }
    renderChrome(el);
  }

  window.bvOpenComment = async function (id) {
    const el = document.getElementById("convTabRoot")?.parentElement; if (!el) return;
    IX.tab = "comments";
    const box = document.getElementById("cm2Box");
    el.querySelector(".conv-wrap").style.display = "none"; box.style.display = "";
    await paint(box); thread(box, id); renderChrome(el);
  };

  window.renderConversations = async function (el) {
    await orig(el);
    const root = el.querySelector("#convTabRoot"); if (!root) return;
    const staff = ["owner", "admin", "buyer"].includes(window.myProfile && window.myProfile.role);
    const old = root.querySelector(".sh");
    const sel = root.querySelector("#convNumSel");
    ixNumbers = sel ? [...sel.options].filter((o) => o.value).map((o) => ({ v: o.value, t: o.textContent.trim() })) : [];
    const head = document.createElement("div"); head.className = "ix-head";
    const tabs = document.createElement("div"); tabs.className = "ix-tabs";
    if (old) { old.replaceWith(head); head.insertAdjacentElement("afterend", tabs); } else root.prepend(head, tabs);
    const box = document.createElement("div"); box.id = "cm2Box"; box.style.display = "none";
    root.querySelector(".conv-wrap").insertAdjacentElement("beforebegin", box);
    IX.cmNew = [];
    if (staff) {
      IX.cmNew = (await sbQuery("page_comments", "select=*&is_page_reply=eq.false&status=eq.new&order=created_time.asc&limit=30").catch(() => [])) || [];
      if (!CM.pages) { const r = await sbFn("page-tools", { action: "my_pages", ad_account_id: undefined }).catch(() => null); CM.pages = (r && r.pages) || []; }
    }
    if (!staff) tabs.style.display = "none";
    renderChrome(el);
    if (IX.tab === "comments" && staff) ixTab(el, "comments"); else { IX.tab = IX.tab === "comments" ? "all" : IX.tab; bvFilterList(); }
  };
})();
