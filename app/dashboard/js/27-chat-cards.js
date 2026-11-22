// Revora dashboard, part 27 of 27: CHAT CARDS

// ── CHAT CARDS ────────────────────────────────────────────────────────────────
// The assistant returns cards next to its text. Cards are plain UI: answering one just sends a normal message,
// and the only thing that ever launches ads is the Approve button on a plan card.
function ccEl(html) { const d = document.createElement("div"); d.className = "cc"; d.innerHTML = html; return d; }
function ccDone(card, text) {
  card.querySelectorAll("button,input,textarea").forEach(b => b.disabled = true);
  card.querySelectorAll(".cc-row.act").forEach(r => r.remove());
  if (text) { const n = document.createElement("div"); n.className = "cc-res"; n.style.color = "var(--muted)"; n.textContent = text; card.appendChild(n); }
}
function appendCards(list) {
  const msgs = document.getElementById("chMsgs");
  for (const c of list || []) {
    let el = null;
    try {
      if (c.type === "questions") el = ccQuestions(c);
      else if (c.type === "creatives") el = ccCreatives(c);
      else if (c.type === "plan") el = ccPlan(c);
      else if (c.type === "review") el = ccReview(c);
      else if (c.type === "confirm") el = ccConfirm(c);
    } catch (e) { console.warn("card", e); }
    if (el) msgs.appendChild(el);
  }
  msgs.scrollTop = msgs.scrollHeight;
}

// CONFIRM CARD: the assistant never changes, spends, publishes or moves money by itself. It asks here with the exact settings,
// and only this Confirm tap (a signed-in call to the server) runs it.
function ccConfirm(c) {
  const warnCol = { money: "#d93025", spend: "#c77700", live: "#c77700", delete: "#d93025", edit: "var(--muted)" }[c.risk] || "var(--muted)";
  const card = ccEl(`<div class="cc-row"><h4 style="margin:0">${escH(c.title)}</h4><span class="cc-sp"></span><span class="cc-tag cc-watch">Needs your OK</span></div>
    <table><tbody>${(c.lines || []).map(l => `<tr><td style="color:var(--muted);white-space:nowrap">${escH(l.k)}</td><td style="word-break:break-word"><b>${escH(l.v)}</b></td></tr>`).join("")}</tbody></table>
    <div class="cc-note" style="color:${warnCol}">${escH(c.warn || "")}</div>
    <div class="cc-row act" style="margin-top:12px"><button type="button" class="cc-btn no">Cancel</button><span class="cc-sp"></span><button type="button" class="cc-btn p ok">Confirm</button></div><div class="cc-res"></div>`);
  const res = card.querySelector(".cc-res");
  card.querySelector(".no").onclick = async () => { await sbFn("ai-chat", { action: "cancel_tool", pending_id: c.pending_id }).catch(() => {}); ccDone(card, "Cancelled. Nothing was changed."); chatHistory.push({ role: "user", content: `[I cancelled the confirm card: ${c.title}. Nothing was done.]` }); };
  card.querySelector(".ok").onclick = async (ev) => {
    const b = ev.target; b.disabled = true; b.textContent = "Working…";
    const r = await sbFn("ai-chat", { action: "confirm_tool", pending_id: c.pending_id }).catch(e => ({ ok: false, error: e.message }));
    if (r?.ok) {
      ccDone(card, "");
      const n = document.createElement("div"); n.className = "cc-res"; n.style.color = "#1a9a4a"; n.textContent = "✅ Done: " + (r.title || c.title); card.appendChild(n);
      chatHistory.push({ role: "user", content: `[I tapped Confirm on "${c.title}". It ran. Result: ${String(r.text || "ok").slice(0, 1500)}]` });
      // let the assistant carry on with the next step (for example the next file of a site) or say what happened
      askChat("I confirmed it. Carry on with the next step if there is one, or tell me in plain words what was done.", "Confirmed ✓");
    } else { b.disabled = false; b.textContent = "Try again"; res.style.color = "#d93025"; res.textContent = "❌ " + (r?.error || "Could not do that."); }
  };
  return card;
}

function ccQuestions(c) {
  const card = ccEl(`<h4>${escH(c.title)}</h4><div class="cc-sub">${escH(c.subtitle || "")}</div>
    ${c.questions.map((q, qi) => `<div class="cc-q" data-qi="${qi}"><label>${escH(q.label)}</label><div class="cc-chips">${q.options.map(o => `<button type="button" class="cc-chip ${q.recommended === o ? "on" : ""}" data-v="${escH(o)}">${escH(o)}${q.recommended === o ? " (recommended)" : ""}</button>`).join("")}</div></div>`).join("")}
    <div class="cc-row act"><span class="cc-sp"></span><button type="button" class="cc-btn skip">Skip, you decide</button><button type="button" class="cc-btn p go">Continue</button></div>`);
  card.querySelectorAll(".cc-q").forEach(qe => {
    const q = c.questions[+qe.dataset.qi];
    qe.querySelectorAll(".cc-chip").forEach(ch => ch.onclick = () => {
      if (q.multi) ch.classList.toggle("on");
      else { qe.querySelectorAll(".cc-chip").forEach(x => x.classList.remove("on")); ch.classList.add("on"); }
    });
  });
  card.querySelector(".skip").onclick = () => { ccDone(card, "You decide."); askChat("You decide the rest, use your best judgement.", "Skip, you decide"); };
  card.querySelector(".go").onclick = () => {
    const ans = [...card.querySelectorAll(".cc-q")].map(qe => {
      const q = c.questions[+qe.dataset.qi];
      const v = [...qe.querySelectorAll(".cc-chip.on")].map(x => x.dataset.v);
      return v.length ? `${q.label} ${v.join(", ")}` : null;
    }).filter(Boolean);
    ccDone(card, "Answered.");
    askChat("My answers: " + (ans.join(" | ") || "no preference, you decide."), ans.length ? "Here are my answers" : "You decide");
  };
  return card;
}

function ccCreatives(c) {
  const card = ccEl(`<h4>Creatives${c.product ? " for " + escH(c.product) : ""}</h4><div class="cc-sub">Tick the ones to use. Each ad set gets one ad per creative.</div>
    <div class="cc-thumbs"></div>
    <div class="cc-row"><button type="button" class="cc-btn s up">Upload image or video</button><button type="button" class="cc-btn s" disabled title="Coming soon">Make with AI (soon)</button><input type="file" accept="image/*,video/*" multiple hidden></div>
    <div class="cc-lbl">Primary text <span style="font-weight:500">(edit if you like)</span></div><textarea class="pt">${escH(c.copy?.primary_text || "")}</textarea>
    <div class="cc-f"><div class="cc-fld"><span>Headline</span><input type="text" class="hl" value="${escH(c.copy?.headline || "")}"></div><div class="cc-fld"><span>Description</span><input type="text" class="ds" value="${escH(c.copy?.description || "")}"></div></div>
    <div class="cc-row act" style="margin-top:12px"><span class="cc-sp"></span><button type="button" class="cc-btn p use">Use these</button></div><div class="cc-res"></div>`);
  const box = card.querySelector(".cc-thumbs"), sel = new Set(c.preselect || []);
  const add = a => {
    const b = document.createElement("button"); b.type = "button"; b.className = "cc-th" + (sel.has(a.id) ? " sel" : ""); b.dataset.id = a.id; b.title = a.name || "";
    b.innerHTML = a.type === "video" ? `<video src="${escH(a.url)}" muted preload="metadata"></video>` : `<img src="${escH(a.url)}" loading="lazy" alt="">`;
    b.onclick = () => { if (sel.has(a.id)) sel.delete(a.id); else sel.add(a.id); b.classList.toggle("sel"); };
    box.appendChild(b);
  };
  (c.assets || []).forEach(add);
  if (!(c.assets || []).length) box.innerHTML = '<div style="color:var(--muted);font-size:12.5px">No creatives saved yet. Upload one to continue.</div>';
  const fi = card.querySelector('input[type=file]'), res = card.querySelector(".cc-res");
  card.querySelector(".up").onclick = () => fi.click();
  fi.onchange = async () => {
    for (const f of [...fi.files]) {
      res.textContent = "Uploading " + f.name + "…";
      const fd = new FormData(); fd.append("file", f); fd.append("uploaded_by", "ai_chat"); fd.append("ad_account_id", activeAccountId || "");
      const pr = (window.bvProductsCache || []).find(x => c.product && String(x.product_name).toLowerCase() === String(c.product).toLowerCase()); if (pr) fd.append("product_id", pr.id);
      fd.append("cta_type", "WHATSAPP_MESSAGE");
      try {
        const r = await bvCreFetch(fd).then(x => x.json());
        if (r.error || !r.asset?.id) throw new Error(r.error || "upload failed");
        if (box.querySelector("div")) box.innerHTML = "";
        sel.add(r.asset.id); add({ id: r.asset.id, url: r.asset.public_url, type: /video/.test(r.asset.asset_type || f.type) ? "video" : "image", name: f.name }); res.textContent = "";
      } catch (e) { res.style.color = "#d93025"; res.textContent = "Could not upload " + f.name + ": " + e.message; }
    }
    fi.value = "";
  };
  card.querySelector(".use").onclick = () => {
    if (!sel.size) { res.style.color = "#d93025"; res.textContent = "Pick at least one creative."; return; }
    const pt = card.querySelector(".pt").value.trim(), hl = card.querySelector(".hl").value.trim(), ds = card.querySelector(".ds").value.trim();
    const n = sel.size;
    ccDone(card, `Using ${n} creative${n > 1 ? "s" : ""}.`);
    askChat(`I chose these creatives (ids: ${[...sel].join(",")}). Use this ad copy. Primary text: ${pt} | Headline: ${hl} | Description: ${ds}. Now plan the campaign.`, `Use these ${n} creative${n > 1 ? "s" : ""}`);
  };
  return card;
}

function ccPlan(c) {
  const card = ccEl("");
  const paint = (c) => {
    const rows = c.adsets.map(a => `<tr><td><b>${escH(a.label)}</b></td><td>${escH(a.who)}</td><td>${escH(a.where)}</td><td>${fN(a.budget)}</td><td>${a.reach ? "≈ " + escH(a.reach) : "—"}</td></tr>`).join("");
    card.innerHTML = `<div class="cc-row"><h4 style="font-size:16px;margin:0">${escH(c.title)}</h4><span class="cc-sp"></span><span class="cc-tag cc-watch">Draft</span></div>
      <div class="cc-sub">${escH(c.summary)}</div>
      <table><thead><tr><th>Ad set</th><th>Who</th><th>Where</th><th>Budget</th><th>Reach</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="cc-f"><div class="cc-fld"><span>Creatives</span><b>${escH(c.creatives)}</b></div>
        <div class="cc-fld"><span>Tracking</span><b style="color:${c.pixel === false ? "#d93025" : "#1a9a4a"}">${c.pixel === null ? "● WhatsApp messages counted by Meta" : c.pixel ? "● Pixel saved on this account" : "● No pixel saved"}</b></div>
        <div class="cc-fld w"><span>Rules I will follow</span><b>${escH(c.rules)}</b></div></div>
      ${(c.warnings || []).map(w => `<div class="cc-warn">⚠️ ${escH(w)}</div>`).join("")}
      <div class="cc-row act" style="margin-top:14px"><button type="button" class="cc-btn no">Cancel</button><span class="cc-sp"></span><button type="button" class="cc-btn ed">Edit plan</button><button type="button" class="cc-btn g ok">Approve and launch</button></div>
      <div class="cc-res"></div><div class="cc-note">Approving creates the campaign and turns it on right away.</div>`;
    const res = card.querySelector(".cc-res");
    card.querySelector(".no").onclick = async () => { await sbFn("ai-chat", { action: "cancel_plan", plan_id: c.plan_id }); ccDone(card, "Plan cancelled."); };
    card.querySelector(".ok").onclick = async (ev) => {
      const b = ev.target; b.disabled = true; b.textContent = "Launching…";
      const r = await sbFn("ai-chat", { action: "approve_plan", plan_id: c.plan_id });
      if (r?.ok) {
        ccDone(card, "");
        const n = document.createElement("div"); n.className = "cc-res"; n.style.color = "#1a9a4a"; n.innerHTML = `✅ Launched: ${r.ad_sets} ad set${r.ad_sets > 1 ? "s" : ""}, ${r.ads} ads. ${escH(r.message || "")}`; card.appendChild(n);
        chatHistory.push({ role: "user", content: `[I approved the plan and it launched: ${r.message || "ok"}]` });
        setTimeout(() => { try { render(); } catch {} }, 600);
      } else { b.disabled = false; b.textContent = "Try again"; res.style.color = "#d93025"; res.textContent = "❌ " + (r?.error || "Could not launch."); }
    };
    card.querySelector(".ed").onclick = () => edit(c);
  };
  const edit = (c) => {
    card.innerHTML = `<h4>Edit plan</h4><div class="cc-sub">Change what you need, then save. Reach is re-checked.</div>
      <div class="cc-lbl">Campaign name</div><input type="text" class="cn" value="${escH(c.campaign_name || "")}">
      ${c.adsets.map((a, i) => `<div class="cc-f" data-i="${i}" style="border-top:1px solid var(--border);padding-top:10px;margin-top:12px"><div class="cc-fld w"><span>${escH(a.label)}</span><b>${escH(a.who)}</b></div>
        <div class="cc-fld"><span>Daily budget (₦)</span><input type="number" class="eb" value="${a.budget}"></div><div class="cc-fld"><span>Ages</span><div class="cc-row"><input type="number" class="amin" value="${a.age_min}" style="width:70px"><input type="number" class="amax" value="${a.age_max}" style="width:70px"></div></div>
        <div class="cc-fld w"><span>States (comma separated, empty = all Nigeria)</span><input type="text" class="es" value="${escH((a.states || []).join(", "))}"></div>
        ${c.adsets.length > 1 ? `<label class="cc-fld w" style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="rm" style="width:auto"> Remove this ad set</label>` : ""}</div>`).join("")}
      <div class="cc-row" style="margin-top:14px"><button type="button" class="cc-btn bk">Back</button><span class="cc-sp"></span><button type="button" class="cc-btn p sv">Save changes</button></div><div class="cc-res"></div>`;
    card.querySelector(".bk").onclick = () => paint(c);
    card.querySelector(".sv").onclick = async (ev) => {
      const b = ev.target; b.disabled = true; b.textContent = "Saving…";
      const edits = { campaign_name: card.querySelector(".cn").value, adsets: [...card.querySelectorAll("[data-i]")].map(e => ({
        budget_naira: +e.querySelector(".eb").value, age_min: +e.querySelector(".amin").value, age_max: +e.querySelector(".amax").value,
        states: e.querySelector(".es").value.split(",").map(x => x.trim()).filter(Boolean), remove: !!e.querySelector(".rm")?.checked })) };
      const r = await sbFn("ai-chat", { action: "update_plan", plan_id: c.plan_id, edits });
      if (r?.card) { c = r.card; paint(c); } else { b.disabled = false; b.textContent = "Save changes"; card.querySelector(".cc-res").textContent = r?.error || "Could not save."; }
    };
  };
  paint(c);
  return card;
}

function ccReview(c) {
  const grp = (tag, cls, items, label) => items.length ? `<div class="cc-row" style="margin:10px 0 4px"><span class="cc-tag ${cls}">${tag}</span><span style="color:var(--text2);font-size:12.5px">${items.length} ${label}</span></div>` +
    items.map((x, i) => `<div class="cc-item"><div style="min-width:0"><b>${escH(x.name)}</b><small>${escH(x.why)}</small></div><div class="cc-row">${x.actions.map((a, k) => `<button type="button" class="cc-btn s" data-g="${tag}" data-i="${i}" data-k="${k}">${escH(a.label)}</button>`).join("")}</div></div>`).join("") : "";
  const card = ccEl(`${grp("KEEP AND SCALE", "cc-keep", c.keep, "ad" + (c.keep.length > 1 ? "s" : ""))}
    ${c.watch.count ? `<div class="cc-row" style="margin:12px 0 4px"><span class="cc-tag cc-watch">WATCH</span><span style="color:var(--text2);font-size:12.5px">${c.watch.count} ads, ${escH(c.watch.note || "too early to judge")}</span></div>` : ""}
    ${grp("STOP", "cc-stop", c.stop, "ad" + (c.stop.length > 1 ? "s" : ""))}<div class="cc-res"></div>`);
  card.querySelectorAll("button[data-g]").forEach(btn => btn.onclick = async () => {
    const x = (btn.dataset.g === "STOP" ? c.stop : c.keep)[+btn.dataset.i], a = x.actions[+btn.dataset.k];
    if (!x.id || !c.account_id) return;
    btn.disabled = true; const old = btn.textContent; btn.textContent = "Working…";
    let r;
    if (a.kind === "pause" || a.kind === "resume") r = await amCall({ action: "set_status", ad_account_id: c.account_id, level: x.level, object_id: x.id, status: a.kind === "pause" ? "PAUSED" : "ACTIVE", reason: "Via AI chat review: " + x.why });
    else if (a.kind === "budget" && a.new_daily_budget) r = await amCall({ action: "set_budget", ad_account_id: c.account_id, level: x.level === "ad" ? "adset" : x.level, object_id: x.id, daily_budget: a.new_daily_budget, reason: "Via AI chat review" });
    else if (a.kind === "duplicate") {
      // A winner is copied and keeps running; the copy goes live. A losing ad is relaunched fresh: copy it, then switch the old one off.
      r = await sbFn("ai-chat", { action: "duplicate", ad_account_id: c.account_id, level: x.level, object_id: x.id, object_name: x.name, start_paused: false });
      if (r?.ok && btn.dataset.g === "STOP") {
        const off = await amCall({ action: "set_status", ad_account_id: c.account_id, level: x.level, object_id: x.id, status: "PAUSED", reason: "Relaunched as a fresh copy: " + x.why });
        if (!off?.ok) r = { ok: false, error: "The fresh copy is live, but I could not switch the old ad off: " + (off?.error || "Meta did not accept it") };
      }
    }
    if (r?.ok) { btn.textContent = "Done ✓"; chatHistory.push({ role: "user", content: `[I tapped "${a.label}" on ${x.name}: done]` }); }
    else { btn.disabled = false; btn.textContent = old; const rs = card.querySelector(".cc-res"); rs.style.color = "#d93025"; rs.textContent = "❌ " + (r?.error || "Meta did not accept that."); }
  });
  return card;
}

async function askChat(q, display) {
  if (chBusy) return;
  chBusy = true;
  document.getElementById("chSend").disabled = true;
  document.getElementById("chSuggs").style.display = "none";
  chRefreshAcct();
  appendMsg(display || q, "user");
  const thinking = appendMsg("", "bot");
  thinking.classList.add("typing");
  thinking.innerHTML = '<span class="ch-typing"><i></i><i></i><i></i></span>';
  thinking.style.padding = "0";
  try {
    const r = await sbFn("ai-chat", { question: q, history: chatHistory, active_ad_account_id: activeAccountId || null });
    thinking.style.padding = "";
    if (r?.answer) {
      chSetBot(thinking, r.answer);
      chatHistory.push({ role: "user", content: q }, { role: "assistant", content: r.answer });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
      appendProposalCards(r.proposals);
      appendCards(r.cards);
      appendQuickReplies(r.quick_replies);
      appendPendingPaymentCard(r.pending_payment);
    } else {
      chSetBot(thinking, r?.error ? `Couldn't do that: ${r.error}` : "I couldn't get an answer just now — try again.");
    }
  } catch {
    thinking.style.padding = "";
    chSetBot(thinking, "Connection error. Try again in a moment.");
  }
  chBusy = false;
  document.getElementById("chSend").disabled = false;
  const m = document.getElementById("chMsgs"); m.scrollTop = m.scrollHeight;
}

function sendChat() {
  const inp = document.getElementById("chInput");
  const q   = inp.value.trim();
  if (!q || chBusy) return;
  inp.value = ""; inp.style.height = "auto";
  askChat(q);
}

// Kickoff
init().then(() => {
  chLoadInbox();
  setInterval(chLoadInbox, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) chLoadInbox(); });
  if (window.bvPendingAi || location.hash === "#ai") { window.bvPendingAi = false; history.replaceState(null, "", location.pathname + location.search); toggleChat(true); }
});
