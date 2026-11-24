// Revora dashboard, part 48: AUTOMATIC REPLIES to comments and Page messages.
// A keyword (or any message) triggers the text the seller wrote, or AI. Rules live in page_automations; the server (page-tools) runs them after each sync.
//  - On a creative: "Auto-reply to comments" for the posts made from it (next to Post to Page).
//  - Settings > Automation & alerts > Page messages & comments: replies to Messenger messages, keyword replies, comments on every post, Instagram check.
(function () {
  if (window.__paInstalled) return; window.__paInstalled = true;
  const css = `.pa-ov{position:fixed;inset:0;z-index:9991;background:var(--bg);overflow:auto;-webkit-overflow-scrolling:touch}
  .pa-in{max-width:640px;margin:0 auto;padding:12px 16px calc(32px + env(safe-area-inset-bottom))}
  .pa-card{background:var(--panel);border-radius:22px;padding:16px;margin-top:12px;box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06)}
  .pa-lbl{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.04em;margin:18px 4px 0}
  .pa-line{display:flex;align-items:center;gap:12px}.pa-line b{display:block;font-size:15px;font-weight:700}.pa-line small{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}.pa-line .tx{flex:1;min-width:0}
  .pa-sw{width:50px;height:30px;border-radius:15px;background:rgba(120,130,150,.35);position:relative;flex:none;border:0;cursor:pointer;padding:0}.pa-sw i{position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .15s}.pa-sw.on{background:#18a35a}.pa-sw.on i{left:23px}
  .pa-card textarea,.pa-card input[type=text]{width:100%;box-sizing:border-box;border:0;border-radius:14px;background:var(--panel2);color:var(--text);font:inherit;font-size:15px;line-height:1.4;padding:12px 14px;margin-top:10px;resize:none}
  .pa-card textarea{min-height:84px}
  .pa-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
  .pa-chip{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:17px;background:rgba(31,111,255,.14);color:#1f6fff;font-weight:700;font-size:13px;border:0;cursor:pointer;font-family:inherit}
  .pa-chip.off{background:var(--panel2);color:var(--text)}
  .pa-seg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.pa-seg button{min-height:50px;border:0;border-radius:16px;background:var(--panel);box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06);color:var(--text);font:inherit;font-weight:700;cursor:pointer}.pa-seg button.on{background:#1f6fff;color:#fff}
  .pa-go{width:100%;height:56px;margin-top:18px;border:0;border-radius:16px;background:#1f6fff;color:#fff;font:inherit;font-size:16px;font-weight:750;cursor:pointer}.pa-go:disabled{opacity:.6}
  .pa-del{display:block;width:100%;min-height:44px;margin-top:10px;border:0;background:none;color:#b3262c;font:inherit;font-weight:700;cursor:pointer}
  .pa-note{text-align:center;font-size:12px;color:var(--muted);margin-top:10px;line-height:1.45}
  .pa-add{display:flex;align-items:center;gap:8px;margin-top:6px}.pa-add input{margin-top:0!important;flex:1}.pa-add button{height:46px;padding:0 16px;border:0;border-radius:14px;background:var(--panel2);color:var(--text);font:inherit;font-weight:700;cursor:pointer}
  .pa-top{display:flex;align-items:center;gap:8px;padding:4px 0 10px}.pa-top .bk{width:44px;height:44px;border:0;border-radius:50%;background:var(--panel);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06)}
  .pa-top .t{flex:1;min-width:0}.pa-top small{display:block;font-size:12px;color:var(--muted)}.pa-top h2{margin:0;font-size:18px;font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pa-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:14px 16px;margin-top:10px;border:0;border-radius:20px;background:var(--panel);color:var(--text);font:inherit;box-shadow:0 1px 2px rgba(15,30,70,.06),0 6px 20px rgba(15,30,70,.06);cursor:pointer}
  .pa-row .ic{width:44px;height:44px;border-radius:14px;background:#7a5cff;color:#fff;display:flex;align-items:center;justify-content:center;flex:none}.pa-row .tx{flex:1;min-width:0}.pa-row b{display:block;font-size:15px}.pa-row small{display:block;color:var(--muted);font-size:12px;margin:2px 0 6px}
  .pa-pill{display:inline-flex;align-items:center;height:22px;padding:0 10px;border-radius:11px;font-size:11.5px;font-weight:700;background:rgba(120,130,150,.18);color:var(--muted)}.pa-pill.ok{background:rgba(24,163,90,.14);color:#127a43}
  .pa-msg{margin-top:10px;font-size:13px;line-height:1.45}.pa-msg.err{color:#b3262c}.pa-msg.ok{color:#127a43}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const esc = (s) => (typeof escH === "function" ? escH(s) : String(s == null ? "" : s));
  const BACK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  const CHEV = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>';
  const CHAT = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-12 7l-5 1 1-4.5A8 8 0 1 1 21 12z"/></svg>';
  const cid = () => window.myProfile && window.myProfile.company_id;

  // The Pages this person can set rules for (one per Page, with an ad account that carries it).
  function pages() {
    const seen = new Map();
    for (const a of (typeof accountsList !== "undefined" ? accountsList : []) || []) if (a.fb_page_id && !seen.has(String(a.fb_page_id))) seen.set(String(a.fb_page_id), { id: String(a.fb_page_id), name: a.fb_page_name || String(a.fb_page_id), ad_account_id: a.id });
    return [...seen.values()];
  }
  const tbl = () => supabaseClient.from("page_automations");
  const sw = (id, on) => `<button type="button" class="pa-sw ${on ? "on" : ""}" id="${id}" aria-pressed="${on ? "true" : "false"}"><i></i></button>`;
  const wireSw = (root, id, init, cb) => { const b = root.querySelector("#" + id); let v = !!init; b.onclick = () => { v = !v; b.classList.toggle("on", v); b.setAttribute("aria-pressed", v); if (cb) cb(v); }; return () => v; };
  function chipsEditor(root, host, initial) {
    const list = [...(initial || [])];
    const paint = () => { host.querySelector(".pa-chips").innerHTML = list.map((k, i) => `<button type="button" class="pa-chip" data-i="${i}">${esc(k)} ✕</button>`).join("") || `<span style="color:var(--muted);font-size:13px">No words: it answers every one.</span>`; host.querySelectorAll(".pa-chip").forEach((c) => (c.onclick = () => { list.splice(Number(c.dataset.i), 1); paint(); })); };
    const input = host.querySelector("input"), add = () => { const v = input.value.trim().toLowerCase(); if (v && !list.includes(v)) list.push(v); input.value = ""; paint(); };
    host.querySelector(".pa-addbtn").onclick = add; input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    paint(); return () => { if (input.value.trim()) add(); return list; };
  }

  // ---------- the rule editor (full screen): comments on a creative's posts, comments on every post, or a Messenger keyword reply ----------
  window.rvRuleEdit = async function (o) {
    const trig = o.trigger, ps = pages(); if (!ps.length) { bvToast("Link a Facebook Page first (Settings, Facebook Pages).", "err"); return; }
    let rule = o.rule || null;
    if (!rule && o.creative_id) { const r = await sbQuery("page_automations", `select=*&creative_id=eq.${o.creative_id}&trigger=eq.comment&order=created_at.asc&limit=1`).catch(() => []); rule = r && r[0] || null; }
    if (!rule && trig === "comment" && !o.creative_id) { const r = await sbQuery("page_automations", `select=*&creative_id=is.null&trigger=eq.comment&channel=eq.${o.channel || "facebook"}&order=created_at.asc&limit=1`).catch(() => []); rule = r && r[0] || null; }
    let chan = (rule && rule.channel) || o.channel || "facebook";
    const r0 = rule || { keywords: [], reply_mode: "text", public_enabled: true, public_text: "", dm_enabled: false, dm_text: "", message_text: "", when_mode: "always", enabled: true };
    const pg = ps.find((p) => p.id === (rule && rule.page_id)) || ps.find((p) => p.ad_account_id === window.activeAccountId) || ps[0];
    const ov = document.createElement("div"); ov.className = "pa-ov rv-ui"; ov.id = "paEdit";
    const isC = trig === "comment";
    ov.innerHTML = `<div class="pa-in"><div class="pa-top"><button type="button" class="bk" aria-label="Back" id="paBack">${BACK}</button><div class="t"><small>${esc(o.sub || "")}</small><h2>${esc(o.title)}</h2></div></div>
      <div class="pa-card"><div class="pa-line"><span class="tx"><b>${o.creative_id ? "Turn on for this post" : "Turn on"}</b></span>${sw("paOn", r0.enabled !== false)}</div></div>
      ${ps.length > 1 ? `<div class="pa-lbl">PAGE</div><div class="pa-card" style="padding:6px 10px"><select id="paPage" style="width:100%;border:0;background:transparent;color:var(--text);font:inherit;font-weight:700;min-height:44px">${ps.map((p) => `<option value="${esc(p.id)}"${p.id === pg.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>` : ""}
      ${o.newKw || (!rule && !o.creative_id && !o.channel) ? `<div class="pa-lbl">WHERE</div><div class="pa-card"><div class="pa-chips"><button type="button" class="pa-chip off" data-c="facebook">Facebook / Messenger</button><button type="button" class="pa-chip off" data-c="instagram">Instagram</button></div></div>` : ""}
      <div class="pa-lbl">${isC ? "WHEN SOMEONE COMMENTS" : "WHEN A CUSTOMER WRITES"}</div>
      <div class="pa-card" id="paKw"><div class="pa-chips"></div><div class="pa-add" style="margin-top:10px"><input type="text" placeholder="Add a word, e.g. price" autocomplete="off"><button type="button" class="pa-addbtn">Add</button></div><div class="pa-note" style="text-align:left;margin-top:8px">${isC ? "Any comment with one of these words. Leave empty to answer every comment." : "A message with one of these words. Leave empty to answer every message."}</div></div>
      <div class="pa-lbl">WRITE IT</div>
      <div class="pa-seg" id="paMode"><button type="button" data-m="text">I write the message</button><button type="button" data-m="ai">Let AI answer</button></div>
      <div id="paText">
      ${isC ? `<div class="pa-lbl">THEN</div><div class="pa-card"><div class="pa-line"><span class="tx"><b>Reply under the comment</b><small>Public, short</small></span>${sw("paPub", r0.public_enabled)}</div><textarea id="paPubT" placeholder="Thanks! I have sent you the details in a message">${esc(r0.public_text || "")}</textarea>
        <div style="height:1px;background:var(--border);margin:14px 0 12px"></div><div class="pa-line"><span class="tx"><b>Send a private message</b><small>Opens a Messenger chat with them</small></span>${sw("paDm", r0.dm_enabled)}</div><textarea id="paDmT" placeholder="Hi {name}! The price is … Order here: …">${esc(r0.dm_text || "")}</textarea></div>`
      : `<div class="pa-card"><b style="font-size:15px">Your reply</b><textarea id="paMsgT" placeholder="Hi {name}! Thanks for writing. …">${esc(r0.message_text || "")}</textarea></div>`}
      </div>
      <div id="paAi" style="display:none"><div class="pa-card"><div class="pa-note" style="text-align:left;margin:0">AI answers with your products and prices. It does not reply when it is unsure or the customer asks for a person${isC ? "." : ", and the chat is marked unread so you see it."}</div>
        ${isC ? `<div class="pa-line" style="margin-top:12px"><span class="tx"><b>Reply under the comment</b></span>${sw("paPubA", r0.public_enabled)}</div><div class="pa-line" style="margin-top:12px"><span class="tx"><b>Send a private message</b></span>${sw("paDmA", r0.dm_enabled)}</div>` : ""}</div></div>
      ${isC ? "" : `<div class="pa-lbl">WHEN</div><div class="pa-card"><div class="pa-chips"><button type="button" class="pa-chip off" data-w="first">First message</button><button type="button" class="pa-chip off" data-w="always">Always</button></div></div>`}
      <div class="pa-msg" id="paMsg"></div>
      <button type="button" class="pa-go" id="paSave">Save</button>
      ${rule ? `<button type="button" class="pa-del" id="paDel">Delete this rule</button>` : ""}
      <div class="pa-note">${isC ? "Each comment gets one reply. " : ""}Revora checks Meta every minute or two, so replies are not instant.</div></div>`;
    document.body.appendChild(ov);
    try { history.pushState({ paEdit: 1 }, "", location.href); } catch (e) {}
    const close = () => { ov.remove(); };
    ov.querySelector("#paBack").onclick = () => { close(); try { history.back(); } catch (e) {} };
    const getOn = wireSw(ov, "paOn", r0.enabled !== false);
    const getKw = chipsEditor(ov, ov.querySelector("#paKw"), r0.keywords);
    let mode = r0.reply_mode || "text", when = r0.when_mode || "always";
    const paintMode = () => { ov.querySelectorAll("#paMode button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode)); ov.querySelector("#paText").style.display = mode === "text" ? "" : "none"; ov.querySelector("#paAi").style.display = mode === "ai" ? "" : "none"; };
    ov.querySelector("#paMode").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; mode = b.dataset.m; paintMode(); }; paintMode();
    const paintChan = () => ov.querySelectorAll("[data-c]").forEach((b) => b.classList.toggle("off", b.dataset.c !== chan));
    ov.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { chan = b.dataset.c; paintChan(); })); paintChan();
    const paintWhen = () => ov.querySelectorAll("[data-w]").forEach((b) => b.classList.toggle("off", b.dataset.w !== when));
    ov.querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => { when = b.dataset.w; paintWhen(); })); paintWhen();
    const g = isC ? { pub: wireSw(ov, "paPub", r0.public_enabled), dm: wireSw(ov, "paDm", r0.dm_enabled), pubA: wireSw(ov, "paPubA", r0.public_enabled), dmA: wireSw(ov, "paDmA", r0.dm_enabled) } : null;
    ov.querySelector("#paSave").onclick = async (e) => {
      const btn = e.currentTarget, m = ov.querySelector("#paMsg"); m.className = "pa-msg"; m.textContent = "";
      const pid = ov.querySelector("#paPage") ? ov.querySelector("#paPage").value : pg.id, page = ps.find((p) => p.id === pid) || pg, kws = getKw();
      const row = { company_id: cid(), page_id: page.id, ad_account_id: page.ad_account_id, channel: chan, trigger: trig, creative_id: o.creative_id || null, keywords: kws, reply_mode: mode, enabled: getOn(), updated_at: new Date().toISOString(), created_by: sessionData && sessionData.user && sessionData.user.id };
      if (isC) {
        const pubOn = mode === "ai" ? g.pubA() : g.pub(), dmOn = mode === "ai" ? g.dmA() : g.dm(), pt = ov.querySelector("#paPubT").value.trim(), dt = ov.querySelector("#paDmT").value.trim();
        if (!pubOn && !dmOn) { m.className = "pa-msg err"; m.textContent = "Turn on a reply under the comment, a private message, or both."; return; }
        if (mode === "text" && ((pubOn && !pt) || (dmOn && !dt))) { m.className = "pa-msg err"; m.textContent = "Write the message you want sent."; return; }
        Object.assign(row, { public_enabled: pubOn, dm_enabled: dmOn, public_text: pt || null, dm_text: dt || null });
      } else {
        const mt = ov.querySelector("#paMsgT").value.trim();
        if (o.newKw && !kws.length) { m.className = "pa-msg err"; m.textContent = "Add at least one word that triggers this reply."; return; }
        if (mode === "text" && !mt) { m.className = "pa-msg err"; m.textContent = "Write the message you want sent."; return; }
        Object.assign(row, { message_text: mt || null, when_mode: when });
      }
      btn.disabled = true; btn.textContent = "Saving…";
      const res = rule ? await tbl().update(row).eq("id", rule.id) : await tbl().insert(row);
      btn.disabled = false; btn.textContent = "Save";
      if (res.error) { m.className = "pa-msg err"; m.textContent = "Could not save: " + res.error.message; return; }
      bvToast("Saved."); close(); try { history.back(); } catch (e2) {} if (o.onDone) o.onDone();
    };
    const del = ov.querySelector("#paDel");
    if (del) del.onclick = async () => { if (!confirm("Delete this rule?")) return; await tbl().delete().eq("id", rule.id); bvToast("Deleted."); close(); try { history.back(); } catch (e) {} if (o.onDone) o.onDone(); };
  };
  window.addEventListener("popstate", () => { const e = document.getElementById("paEdit"); if (e) e.remove(); });

  // ---------- on a creative: the Auto-reply row ----------
  const prevOpen = window.ccOpen;
  if (typeof prevOpen === "function") window.ccOpen = async function (id) {
    const r = await prevOpen.apply(this, arguments);
    try {
      const ov = document.getElementById("ccDetail"), two = ov && ov.querySelector(".cd-two"); if (!two || !two.querySelector('button[onclick^="ccPost"]') || ov.querySelector("#paRow")) return r;
      const a = (window.bvCatData.assets || []).find((x) => x.id === id) || {};
      const rows = await sbQuery("page_automations", `select=id,enabled,keywords&creative_id=eq.${id}&trigger=eq.comment`).catch(() => []), on = (rows || []).filter((x) => x.enabled), kw = on.reduce((n, x) => n + ((x.keywords || []).length || 1), 0);
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "pa-row"; btn.id = "paRow";
      btn.innerHTML = `<span class="ic">${CHAT}</span><span class="tx"><b>Auto-reply to comments</b><small>When someone comments on this post</small><span class="pa-pill ${on.length ? "ok" : ""}">${on.length ? (kw === 1 && !(on[0].keywords || []).length ? "On for every comment" : kw + " keyword" + (kw === 1 ? "" : "s") + " on") : "Off"}</span></span>${CHEV}`;
      btn.onclick = () => window.rvRuleEdit({ trigger: "comment", creative_id: id, title: "Auto-reply to comments", sub: a.display_name || a.file_name || "Creative", onDone: () => { const o2 = document.getElementById("ccDetail"); if (o2) { o2.remove(); window.ccOpen(id); } } });
      two.insertAdjacentElement("afterend", btn);
    } catch (e) { console.warn("auto-reply row", e); }
    return r;
  };

  // ---------- Automation & alerts > Page messages & comments ----------
  window.adxAutoPage = async function (root) {
    const ps = pages();
    if (!ps.length) { root.innerHTML = `<div class="adx-note warn">Link a Facebook Page first (Settings, Facebook Pages).</div>`; return; }
    root.innerHTML = `<div class="empty"><div class="spin" style="width:16px;height:16px;border-width:2px;"></div></div>`;
    const rules = (await sbQuery("page_automations", `select=*&creative_id=is.null&order=created_at.asc`).catch(() => [])) || [];
    const ch = (r) => r.channel === "instagram" ? "instagram" : "facebook", CH = { facebook: "Facebook", instagram: "Instagram" };
    const msgRules = rules.filter((r) => r.trigger === "message"), cmRules = rules.filter((r) => r.trigger === "comment");
    const def = (c) => msgRules.find((r) => ch(r) === c && !(r.keywords || []).length), kwRules = msgRules.filter((r) => (r.keywords || []).length), allC = (c) => cmRules.find((r) => ch(r) === c);
    const state = (r) => (r ? (r.enabled ? (r.reply_mode === "ai" ? "On · AI answers" : "On · your message") : "Off") : "Off");
    const row = (k, t, sub, pill, ok) => `<button type="button" class="pa-row" data-k="${k}"><span class="ic">${CHAT}</span><span class="tx"><b>${esc(t)}</b><small>${esc(sub)}</small><span class="pa-pill ${ok ? "ok" : ""}">${esc(pill)}</span></span>${CHEV}</button>`;
    root.innerHTML = `<div class="adx-intro"><p>Replies that go out on their own. Settings for one post are on that creative.</p></div>
      <div class="pa-lbl" style="margin-top:6px">MESSAGES</div>
      ${row("def:facebook", "Messenger messages", "When a customer writes to your Page", state(def("facebook")), def("facebook") && def("facebook").enabled)}
      ${row("def:instagram", "Instagram messages", "When someone writes to your Instagram", state(def("instagram")), def("instagram") && def("instagram").enabled)}
      <div class="pa-lbl">KEYWORD REPLIES</div>
      ${kwRules.map((r) => row("kw:" + r.id, (r.keywords || []).join(", "), CH[ch(r)] + " · " + (r.reply_mode === "ai" ? "AI answers" : (r.message_text || "").slice(0, 50)), r.enabled ? "On" : "Off", r.enabled)).join("")}
      <button type="button" class="pa-row" data-k="addkw"><span class="ic" style="background:#1f6fff"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><span class="tx"><b>Add a keyword reply</b></span></button>
      <div class="pa-lbl">COMMENTS ON EVERY POST AND AD</div>
      ${row("allc:facebook", "Facebook comments", "Reply to comments anywhere on your Page", state(allC("facebook")), allC("facebook") && allC("facebook").enabled)}
      ${row("allc:instagram", "Instagram comments", "Reply to comments on your Instagram posts", state(allC("instagram")), allC("instagram") && allC("instagram").enabled)}
      <div class="pa-lbl">CONNECTION</div>
      <div class="pa-card"><div class="pa-line"><span class="tx"><b>Check Instagram</b><small>Shows whether Instagram comments and messages can be answered automatically</small></span></div><button type="button" class="adx-btn" id="paIg" style="margin-top:12px">Check Instagram connection</button><div id="paIgOut" class="pa-msg"></div></div>`;
    const done = () => window.adxAutoPage(root);
    root.querySelectorAll(".pa-row").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.k;
      if (k.startsWith("def:")) { const c = k.slice(4); window.rvRuleEdit({ trigger: "message", channel: c, rule: def(c) || null, title: c === "instagram" ? "Instagram messages" : "Messenger messages", sub: "Replies to messages", onDone: done }); }
      else if (k === "addkw") window.rvRuleEdit({ trigger: "message", rule: null, title: "New keyword reply", sub: "Replies to messages", onDone: done, newKw: true });
      else if (k.startsWith("allc:")) { const c = k.slice(5); window.rvRuleEdit({ trigger: "comment", channel: c, rule: allC(c) || null, title: c === "instagram" ? "Instagram comments" : "Facebook comments", sub: "Every post and ad", onDone: done }); }
      else if (k.startsWith("kw:")) window.rvRuleEdit({ trigger: "message", rule: kwRules.find((r) => r.id === k.slice(3)), title: "Keyword reply", sub: "Replies to messages", onDone: done });
    }));
    root.querySelector("#paIg").onclick = async (e) => {
      const btn = e.currentTarget, out = root.querySelector("#paIgOut"); btn.disabled = true; btn.textContent = "Checking…"; out.className = "pa-msg"; out.textContent = "";
      const acct = (ps.find((p) => p.ad_account_id === window.activeAccountId) || ps[0]).ad_account_id;
      const r = await sbFn("page-tools", { action: "ig_check", ad_account_id: acct }).catch((err) => ({ error: err.message }));
      btn.disabled = false; btn.textContent = "Check Instagram connection";
      if (r.error) { out.className = "pa-msg err"; out.textContent = r.error; return; }
      const names = { instagram_manage_comments: "answer Instagram comments", instagram_manage_messages: "answer Instagram messages", instagram_basic: "read the Instagram account", pages_messaging: "answer Messenger messages", pages_manage_engagement: "reply to comments", pages_read_engagement: "read comments" };
      const lines = [];
      lines.push(r.instagram ? `✓ Instagram account linked to this Page: @${esc(r.instagram.username || r.instagram.id)}` : "✗ No Instagram account is linked to this Page. Connect the Instagram profile to the Page in Meta Business Suite.");
      if (r.scopes_error) lines.push("Couldn't read what this Meta connection is allowed to do: " + esc(r.scopes_error));
      else if ((r.missing || []).length) lines.push("✗ Meta has not allowed Revora to: " + r.missing.map((x) => esc(names[x] || x)).join(", ") + ".");
      else lines.push("✓ Meta allows Revora to answer Instagram and Messenger for this Page.");
      out.className = "pa-msg"; out.innerHTML = lines.join("<br>");
    };
  };
})();
