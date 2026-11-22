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
      else if (c.type === "upload") el = ccUpload(c);
      else if (c.type === "site") el = ccSite(c);
      else if (c.type === "result") el = ccResult(c);
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
      if (r.card) appendCards([r.card]);
      chatHistory.push({ role: "user", content: `[I tapped Confirm on "${c.title}". It ran. Result: ${String(r.text || "ok").slice(0, 1500)}]` });
      // let the assistant carry on with the next step (for example the next file of a site) or say what happened
      askChat("I confirmed it. Carry on with the next step if there is one, or tell me in plain words what was done.", "Confirmed ✓");
    } else { b.disabled = false; b.textContent = "Try again"; res.style.color = "#d93025"; res.textContent = "❌ " + (r?.error || "Could not do that."); }
  };
  return card;
}

// "2026-11-05T07:00:00Z" -> "2026-11-05T08:00" (Nigeria time) for a date-time box
function ccLagosLocal(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("sv-SE", { timeZone: "Africa/Lagos" }).replace(" ", "T").slice(0, 16); } catch { return ""; }
}

// UPLOAD CARD: pictures and videos go straight into the creative vault from the chat (no upload links).
function ccUpload(c) {
  const card = ccEl(`<h4>${escH(c.purpose || "Add pictures")}</h4><div class="cc-sub">${c.product ? "For " + escH(c.product) + ". " : ""}Tap to pick ${c.video === false ? "pictures" : "pictures or videos"} from your phone or computer, or drop them here.</div>
    <label class="cc-drop" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:96px;border:1.5px dashed var(--borderStrong,var(--border));border-radius:14px;background:var(--panel2);color:var(--text2);cursor:pointer;text-align:center;padding:14px">
      <b style="color:var(--text)">Tap to add</b><span style="font-size:12px">${c.video === false ? "Pictures" : "Pictures or videos"}</span>
      <input type="file" accept="${c.video === false ? "image/*" : "image/*,video/*"}" multiple hidden></label>
    <div class="cc-thumbs"></div>
    <div class="cc-row act" style="margin-top:8px"><span class="cc-sp"></span><button type="button" class="cc-btn p go" disabled>Use these</button></div><div class="cc-res"></div>`);
  const fi = card.querySelector("input"), box = card.querySelector(".cc-thumbs"), res = card.querySelector(".cc-res"), go = card.querySelector(".go"), drop = card.querySelector(".cc-drop");
  const got = [];
  const send = async (files) => {
    for (const f of files) {
      res.style.color = "var(--muted)"; res.textContent = "Uploading " + f.name + "…";
      const fd = new FormData(); fd.append("file", f); fd.append("uploaded_by", "ai_chat"); fd.append("ad_account_id", activeAccountId || "");
      const pr = (window.bvProductsCache || []).find(x => c.product && String(x.product_name).toLowerCase() === String(c.product).toLowerCase()); if (pr) fd.append("product_id", pr.id);
      try {
        const r = await bvCreFetch(fd).then(x => x.json());
        if (r.error || !r.asset?.id) throw new Error(r.error || "upload failed");
        got.push(r.asset.id);
        const t = document.createElement("div"); t.className = "cc-th"; t.style.cursor = "default";
        t.innerHTML = /video/.test(r.asset.asset_type || f.type) ? `<video src="${escH(r.asset.public_url)}" muted preload="metadata"></video>` : `<img src="${escH(r.asset.public_url)}" alt="">`;
        box.appendChild(t); res.textContent = ""; go.disabled = false;
      } catch (e) { res.style.color = "#d93025"; res.textContent = "Could not upload " + f.name + ": " + e.message; }
    }
  };
  fi.onchange = async () => { const fs = [...fi.files]; fi.value = ""; await send(fs); };
  drop.ondragover = e => { e.preventDefault(); drop.style.borderColor = "var(--accent)"; };
  drop.ondragleave = () => { drop.style.borderColor = ""; };
  drop.ondrop = e => { e.preventDefault(); drop.style.borderColor = ""; send([...(e.dataTransfer?.files || [])]); };
  go.onclick = () => {
    ccDone(card, `Added ${got.length} file${got.length > 1 ? "s" : ""} to your creatives.`);
    askChat(`I uploaded ${got.length} file${got.length > 1 ? "s" : ""} to my creative vault (creative ids: ${got.join(",")}). ${c.purpose || ""} Carry on.`, `Uploaded ${got.length} file${got.length > 1 ? "s" : ""}`);
  };
  return card;
}

// SITE CARD: the files of a website the assistant is building, with an in-chat preview and a Publish button (which still asks for a confirm tap).
function ccSite(c) {
  const live = /publish|live/i.test(c.status || "") && !/draft/i.test(c.status || "");
  const card = ccEl(`<div class="cc-row"><h4 style="margin:0">${escH(c.name)}</h4><span class="cc-sp"></span><span class="cc-tag ${live ? "cc-keep" : "cc-watch"}">${live ? "Live" : "Draft"}</span></div>
    <div class="cc-sub">${(c.files || []).length} file${(c.files || []).length === 1 ? "" : "s"}</div>
    <div style="max-height:170px;overflow:auto;border:1px solid var(--border);border-radius:10px;background:var(--panel2)">${(c.files || []).map(f => `<div class="cc-item" style="padding:6px 10px"><span style="font-family:ui-monospace,monospace;font-size:12px;word-break:break-all">${escH(f.path)}</span><span style="color:var(--muted);font-size:11.5px;white-space:nowrap">${f.lines ? f.lines + " lines" : ""}</span></div>`).join("") || '<div style="padding:10px;color:var(--muted)">No files yet.</div>'}</div>
    <div class="cc-row act" style="margin-top:12px">${c.preview ? '<button type="button" class="cc-btn pv">Preview</button>' : ""}<span class="cc-sp"></span><button type="button" class="cc-btn ${live ? "" : "p"} pub">${live ? "Take offline" : "Publish"}</button></div>
    <div class="cc-pvbox"></div><div class="cc-res"></div>`);
  const res = card.querySelector(".cc-res"), box = card.querySelector(".cc-pvbox");
  const pv = card.querySelector(".pv");
  if (pv) pv.onclick = () => {
    if (box.firstChild) { box.innerHTML = ""; pv.textContent = "Preview"; return; }
    box.innerHTML = `<iframe src="${escH(c.preview)}" style="width:100%;height:380px;border:1px solid var(--border);border-radius:10px;margin-top:10px;background:#fff" loading="lazy"></iframe>`; pv.textContent = "Hide preview";
  };
  card.querySelector(".pub").onclick = async (ev) => {
    const b = ev.target; b.disabled = true;
    const r = await sbFn("ai-chat", { action: "queue_publish", site_id: c.site_id, live: !live }).catch(e => ({ error: e.message }));
    b.disabled = false;
    if (r?.card) appendCards([r.card]); else { res.style.color = "#d93025"; res.textContent = "❌ " + (r?.error || "Could not prepare that."); }
  };
  return card;
}

// RESULT CARD: any answer of a reading tool (lists with pictures, or a few facts)
function ccResult(c) {
  const body = c.rows
    ? `<table><thead><tr>${c.rows.some(r => r.img) ? "<th></th>" : ""}${(c.cols || []).map(h => `<th>${escH(h)}</th>`).join("")}</tr></thead><tbody>${c.rows.map(r => `<tr>${c.rows.some(x => x.img) ? `<td style="width:52px">${r.img ? `<img src="${escH(r.img)}" alt="" loading="lazy" style="width:44px;height:44px;object-fit:cover;border-radius:8px;display:block">` : ""}</td>` : ""}${r.cells.map(v => `<td style="word-break:break-word">${escH(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>${c.more ? `<div class="cc-note">+ ${c.more} more. Ask me to narrow it down.</div>` : ""}`
    : `<div class="cc-f">${(c.kv || []).map(x => `<div class="cc-fld"><span>${escH(x.k)}</span><b>${escH(x.v)}</b></div>`).join("")}</div>`;
  return ccEl(`<h4>${escH(c.title)}${c.count != null ? ` <span style="color:var(--muted);font-weight:500">(${c.count})</span>` : ""}</h4><div style="overflow-x:auto;margin-top:6px">${body}</div>`);
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
      <div class="cc-sub" style="margin-top:-6px"><b>${c.start_label ? "Starts " + escH(c.start_label) : "Starts right away"}</b>${c.end_label ? " · Stops " + escH(c.end_label) : ""}</div>
      <table><thead><tr><th>Ad set</th><th>Who</th><th>Where</th><th>Budget</th><th>Reach</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="cc-f"><div class="cc-fld"><span>Creatives</span><b>${escH(c.creatives)}</b></div>
        <div class="cc-fld"><span>Tracking</span><b style="color:${c.pixel === false ? "#d93025" : "#1a9a4a"}">${c.pixel === null ? "● WhatsApp messages counted by Meta" : c.pixel ? "● Pixel saved on this account" : "● No pixel saved"}</b></div>
        <div class="cc-fld w"><span>Rules I will follow</span><b>${escH(c.rules)}</b></div></div>
      ${(c.warnings || []).map(w => `<div class="cc-warn">⚠️ ${escH(w)}</div>`).join("")}
      <div class="cc-row act" style="margin-top:14px"><button type="button" class="cc-btn no">Cancel</button><span class="cc-sp"></span><button type="button" class="cc-btn ed">Edit plan</button><button type="button" class="cc-btn g ok">${c.start_time ? "Approve and schedule" : "Approve and launch"}</button></div>
      <div class="cc-res"></div><div class="cc-note">${c.start_time ? "Approving creates the campaign now. It shows as Scheduled and spends nothing until the start time." : "Approving creates the campaign and turns it on right away."}</div>`;
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
      <div class="cc-f"><div class="cc-fld"><span>Starts (Nigeria time, empty = right away)</span><input type="datetime-local" class="st" value="${ccLagosLocal(c.start_time)}" style="width:100%"></div>
        <div class="cc-fld"><span>Stops (optional)</span><input type="datetime-local" class="en" value="${ccLagosLocal(c.end_time)}" style="width:100%"></div></div>
      ${c.adsets.map((a, i) => `<div class="cc-f" data-i="${i}" style="border-top:1px solid var(--border);padding-top:10px;margin-top:12px"><div class="cc-fld w"><span>${escH(a.label)}</span><b>${escH(a.who)}</b></div>
        <div class="cc-fld"><span>Daily budget (₦)</span><input type="number" class="eb" value="${a.budget}"></div><div class="cc-fld"><span>Ages</span><div class="cc-row"><input type="number" class="amin" value="${a.age_min}" style="width:70px"><input type="number" class="amax" value="${a.age_max}" style="width:70px"></div></div>
        <div class="cc-fld w"><span>States (comma separated, empty = all Nigeria)</span><input type="text" class="es" value="${escH((a.states || []).join(", "))}"></div>
        ${c.adsets.length > 1 ? `<label class="cc-fld w" style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="rm" style="width:auto"> Remove this ad set</label>` : ""}</div>`).join("")}
      <div class="cc-row" style="margin-top:14px"><button type="button" class="cc-btn bk">Back</button><span class="cc-sp"></span><button type="button" class="cc-btn p sv">Save changes</button></div><div class="cc-res"></div>`;
    card.querySelector(".bk").onclick = () => paint(c);
    card.querySelector(".sv").onclick = async (ev) => {
      const b = ev.target; b.disabled = true; b.textContent = "Saving…";
      const stv = card.querySelector(".st").value, env = card.querySelector(".en").value;
      const edits = { ...(stv !== ccLagosLocal(c.start_time) ? { start_time: stv } : {}), ...(env !== ccLagosLocal(c.end_time) ? { end_time: env } : {}), campaign_name: card.querySelector(".cn").value, adsets: [...card.querySelectorAll("[data-i]")].map(e => ({
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

// Talks to ai-chat as a server-sent stream. If the stream cannot be used, it falls back to the plain request.
async function chStream(body, on) {
  try {
    const res = await fetch(`${SUPA_URL}/functions/v1/ai-chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionData?.access_token || ANON}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (!/event-stream/.test(res.headers.get("content-type") || "")) return await res.json();
    const rd = res.body.getReader(), dec = new TextDecoder();
    let buf = "", final = null;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
        if (!line.startsWith("data:")) continue;
        let e; try { e = JSON.parse(line.slice(5)); } catch { continue; }
        if (e.type === "done") final = e; else on[e.type]?.(e.text);
      }
    }
    return final || { error: "The answer was cut off. Try again." };
  } catch (e) {
    return await sbFn("ai-chat", body);
  }
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
    // The answer arrives as it is written, with short progress lines while tools run ("Checking your live ads...").
    let streamed = "";
    const r = await chStream({ question: q, history: chatHistory, active_ad_account_id: activeAccountId || null }, {
      status: t => { if (!streamed) thinking.innerHTML = `<span class="ch-typing"><i></i><i></i><i></i></span><span style="margin-left:8px;color:var(--muted);font-size:12.5px">${escH(t)}</span>`; },
      delta: t => { streamed += t; thinking.style.padding = ""; thinking.classList.remove("typing"); thinking.innerHTML = chFmt(streamed); const m = document.getElementById("chMsgs"); m.scrollTop = m.scrollHeight; },
      reset: () => { streamed = ""; thinking.classList.add("typing"); thinking.style.padding = "0"; },
    });
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
