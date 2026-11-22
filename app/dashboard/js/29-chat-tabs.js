// Revora dashboard, part 29: CHAT TABS (Plans / Code / Projects of the chat screen)
// Reading is done here; anything that changes, spends or publishes goes to the assistant's confirm cards (nothing runs without a tap).
(function () {
  if (/[?&]classic=1/.test(location.search) || !window.cmTabs) return;
  const css = `
  .ct-seg{display:flex;gap:6px;padding:4px 16px 10px;flex-wrap:wrap}
  .ct-seg button{min-height:44px;padding:0 16px;border-radius:99px;font:inherit;font-size:13px;font-weight:600;background:var(--panel);border:1px solid var(--borderStrong,var(--border));color:var(--text);cursor:pointer}
  .ct-seg button[aria-pressed=true]{background:var(--text);color:var(--bg);border-color:var(--text)}
  .ct-card{margin:0 16px 10px;border:1px solid var(--borderStrong,var(--border));background:var(--panel);border-radius:18px;overflow:hidden}
  .ct-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:13px 14px 8px}
  .ct-top b{font-size:15px;display:block}.ct-top span{font-size:13px;color:var(--text2)}
  .ct-pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;flex:none;background:var(--panel2);color:var(--text2)}
  .ct-pill.d{background:rgba(245,165,36,.16);color:#b7791f}.ct-pill.s{background:rgba(24,119,242,.12);color:#1877F2}.ct-pill.l{background:rgba(26,154,74,.12);color:#1a9a4a}
  .ct-kv{display:flex;justify-content:space-between;gap:10px;padding:8px 14px;border-top:1px solid var(--border);font-size:13px}
  .ct-kv span{color:var(--text2)}.ct-kv b{text-align:right}
  .ct-act{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--border);flex-wrap:wrap}
  .ct-act button,.ct-btn{flex:1;min-height:44px;border-radius:12px;font:inherit;font-size:13px;font-weight:700;border:1px solid var(--border);background:var(--panel);color:var(--text);cursor:pointer;padding:0 10px}
  .ct-act .p,.ct-btn.p{background:var(--accent,#1877F2);border-color:var(--accent,#1877F2);color:#fff}
  .ct-lbl{font-size:12px;font-weight:700;letter-spacing:.05em;color:var(--text2);padding:12px 16px 8px}
  .ct-row{display:flex;gap:12px;align-items:center;padding:10px 14px;min-height:44px;border-bottom:1px solid var(--border);width:100%;background:none;border-left:0;border-right:0;border-top:0;font:inherit;color:var(--text);text-align:left;cursor:pointer}
  .ct-row:last-child{border-bottom:0}.ct-row b{font-size:14px;display:block}.ct-row span.s{font-size:12px;color:var(--text2)}
  .ct-ic{width:38px;height:38px;border-radius:11px;flex:none;display:flex;align-items:center;justify-content:center;background:var(--panel2);font-size:18px}
  .ct-file{display:flex;gap:10px;align-items:center;padding:9px 14px;border-top:1px solid var(--border);font:500 12.5px ui-monospace,Menlo,monospace}
  .ct-file i{font-style:normal;margin-left:auto;font:500 11px system-ui,sans-serif;color:var(--muted)}
  .ct-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 16px 10px}
  .ct-grid .th{aspect-ratio:1;border-radius:12px;overflow:hidden;background:var(--panel2);border:1px solid var(--border)}
  .ct-grid img,.ct-grid video{width:100%;height:100%;object-fit:cover;display:block}
  .ct-empty{margin:8px 16px;color:var(--text2);font-size:13.5px;line-height:1.45}
  .ct-sheet{padding:0 10px 10px}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const ask = (text, label) => { if (window.cmTab) cmTab("chat"); askChat(text, label || text); };
  const read = async (tool, args) => { const r = await sbFn("ai-chat", { action: "run_read", tool, args: args || {} }); return r; };
  const loading = (v) => { v.innerHTML = '<div class="ct-empty">Loading…</div>'; };
  const seg = (items, cur, on) => { const d = document.createElement("div"); d.className = "ct-seg"; d.innerHTML = items.map(i => `<button type="button" data-k="${i[0]}" aria-pressed="${i[0] === cur}">${escH(i[1])}</button>`).join(""); d.querySelectorAll("button").forEach(b => b.onclick = () => on(b.dataset.k)); return d; };
  const empty = (txt, btn, fn) => { const d = document.createElement("div"); d.className = "ct-empty"; d.innerHTML = escH(txt) + (btn ? `<div style="margin-top:10px"><button type="button" class="ct-btn p" style="flex:none;padding:0 18px">${escH(btn)}</button></div>` : ""); if (btn) d.querySelector("button").onclick = fn; return d; };
  const firstList = (o) => { for (const k of Object.keys(o || {})) if (Array.isArray(o[k]) && o[k].length && typeof o[k][0] === "object") return o[k]; return []; };

  // ── PLANS ────────────────────────────────────────────────────────────────────────────────────────────────────
  let plansSeg = "drafts";
  window.cmTabs.plans = async function plans(v) {
    loading(v);
    const r = await sbFn("ai-chat", { action: "tab_plans" });
    v.innerHTML = "";
    if (r?.error) { v.appendChild(empty("Could not load your plans: " + r.error)); return; }
    const sets = { drafts: r.drafts || [], scheduled: r.scheduled || [], live: r.live || [] };
    v.appendChild(seg([["drafts", `Drafts ${sets.drafts.length}`], ["scheduled", `Scheduled ${sets.scheduled.length}`], ["live", `Live ${sets.live.length}`]], plansSeg, k => { plansSeg = k; plans(v); }));
    const list = sets[plansSeg];
    if (!list.length) v.appendChild(empty(plansSeg === "drafts" ? "No drafts yet. Ask the assistant to plan a campaign for a product." : plansSeg === "scheduled" ? "Nothing is scheduled." : "No live campaigns from plans yet.", plansSeg === "drafts" ? "Plan a campaign" : null, () => ask("Plan a campaign for one of my products. Ask me what you need.", "Plan a campaign")));
    for (const p of list) {
      const el = document.createElement("div"); el.className = "ct-card";
      const pill = plansSeg === "drafts" ? ["d", "Draft"] : plansSeg === "scheduled" ? ["s", "Scheduled"] : ["l", p.paused ? "Paused" : "Live"];
      el.innerHTML = `<div class="ct-top"><div><b>${escH(p.name)}</b><span>${escH(p.product)}</span></div><span class="ct-pill ${pill[0]}">${pill[1]}</span></div>
        <div class="ct-kv"><span>Starts</span><b>${escH(p.start_label || "Right away")}</b></div>
        ${p.budget ? `<div class="ct-kv"><span>Budget</span><b>${escH(p.budget)}</b></div>` : ""}
        <div class="ct-kv"><span>Ad sets</span><b>${p.ad_sets} · ${p.ads} ad${p.ads === 1 ? "" : "s"}</b></div>
        <div class="ct-act">${plansSeg === "drafts" ? '<button type="button" data-a="time">Edit start time</button><button type="button" data-a="sets">Edit ad sets</button><button type="button" class="p" data-a="launch">Launch</button>'
          : plansSeg === "scheduled" ? '<button type="button" data-a="chg">Change time</button><button type="button" data-a="cancel">Cancel</button>'
          : '<button type="button" data-a="ask">How is it doing?</button><button type="button" data-a="pause">Pause</button>'}</div><div class="ct-sheet"></div>`;
      const sheet = el.querySelector(".ct-sheet");
      const openCard = async (edit) => {
        sheet.innerHTML = '<div class="ct-empty">Opening…</div>';
        const c = await sbFn("ai-chat", { action: "plan_card", plan_id: p.id });
        sheet.innerHTML = "";
        if (!c?.card) { sheet.appendChild(empty(c?.error || "Could not open the plan.")); return; }
        sheet.appendChild(ccPlan(c.card, { edit, onDone: () => setTimeout(() => plans(v), 700) }));
      };
      el.querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        if (a === "time" || a === "sets") openCard(true);
        else if (a === "launch") openCard(false);
        else if (a === "chg") ask(`Change the start time of the scheduled campaign "${p.name}".`, "Change start time");
        else if (a === "cancel") ask(`Cancel the scheduled campaign "${p.name}" (pause it so it never starts).`, "Cancel scheduled campaign");
        else if (a === "ask") ask(`How is the campaign "${p.name}" doing?`, `How is ${p.name} doing?`);
        else if (a === "pause") ask(`Pause the live campaign "${p.name}".`, "Pause campaign");
      });
      v.appendChild(el);
    }
  };

  // ── CODE ─────────────────────────────────────────────────────────────────────────────────────────────────────
  let codeSeg = "sites";
  window.cmTabs.code = async function code(v) {
    loading(v);
    v.innerHTML = "";
    v.appendChild(seg([["sites", "Sites"], ["assets", "Assets"]], codeSeg, k => { codeSeg = k; code(v); }));
    const body = document.createElement("div"); v.appendChild(body); body.innerHTML = '<div class="ct-empty">Loading…</div>';
    if (codeSeg === "sites") {
      const r = await read("site_list_files", {});
      body.innerHTML = "";
      const sites = r?.out?.sites || [];
      if (r?.error || r?.out?.error) { body.appendChild(empty("Could not load your sites: " + (r.error || r.out.error))); return; }
      if (!sites.length) { body.appendChild(empty("No file-based sites yet. Ask the assistant to build a sales page as real files.", "Build a sales page", () => ask("Build a sales page for one of my products. Ask me which product.", "Build a sales page"))); return; }
      sites.forEach((s, i) => {
        const el = document.createElement("div"); el.className = "ct-card";
        const live = /publish|live/i.test(s.status || "") && !/draft/i.test(s.status || "");
        el.innerHTML = `<div class="ct-top"><div><b>${escH(s.name)}</b><span>Real HTML files · ${live ? "live" : "draft"}</span></div><span class="ct-pill ${live ? "l" : "d"}">${live ? "Live" : "Draft"}</span></div><div class="ct-files"></div><div class="ct-pv"></div>
          <div class="ct-act"><button type="button" data-a="open">Files</button>${s.test_link ? '<button type="button" data-a="pv">Preview</button>' : ""}<button type="button" data-a="rb">Rollback</button><button type="button" class="${live ? "" : "p"}" data-a="live">${live ? "Take offline" : "Go live"}</button></div>
          <div class="ct-note" style="padding:0 14px 10px;font-size:12px;color:var(--text2)">Going live asks you to confirm first.</div><div class="ct-sheet"></div>`;
        const files = el.querySelector(".ct-files"), pv = el.querySelector(".ct-pv"), sheet = el.querySelector(".ct-sheet");
        const loadFiles = async () => {
          files.innerHTML = '<div class="ct-empty">Loading files…</div>';
          const f = await read("site_list_files", { site_id: s.site_id });
          const list = f?.out?.files || [];
          files.innerHTML = list.length ? list.map(x => `<div class="ct-file">${escH(x.path)}<i>v${x.version ?? 1}</i></div>`).join("") : '<div class="ct-empty">No files yet.</div>';
        };
        el.querySelector('[data-a="open"]').onclick = () => { if (files.firstChild) files.innerHTML = ""; else loadFiles(); };
        const pvb = el.querySelector('[data-a="pv"]');
        if (pvb) pvb.onclick = () => { if (pv.firstChild) { pv.innerHTML = ""; pvb.textContent = "Preview"; } else { pv.innerHTML = `<iframe src="${escH(s.test_link)}" loading="lazy" style="width:calc(100% - 28px);margin:8px 14px;height:380px;border:1px solid var(--border);border-radius:10px;background:#fff"></iframe>`; pvb.textContent = "Hide preview"; } };
        el.querySelector('[data-a="rb"]').onclick = () => ask(`Roll back the site "${s.name}" to its previous version. Show me the history first.`, "Roll back site");
        el.querySelector('[data-a="live"]').onclick = async (ev) => {
          const b = ev.target; b.disabled = true;
          const q = await sbFn("ai-chat", { action: "queue_publish", site_id: s.site_id, live: !live });
          b.disabled = false; sheet.innerHTML = "";
          if (q?.card) sheet.appendChild(ccConfirm(q.card)); else sheet.appendChild(empty(q?.error || "Could not prepare that."));
        };
        body.appendChild(el);
        if (i === 0) loadFiles();
      });
    } else {
      const up = document.createElement("div"); up.className = "ct-sheet"; body.innerHTML = ""; body.appendChild(up);
      const bar = document.createElement("div"); bar.style.cssText = "padding:0 16px 10px"; bar.innerHTML = '<button type="button" class="ct-btn p" style="width:100%">Add pictures or video</button>'; body.appendChild(bar);
      bar.querySelector("button").onclick = () => { up.innerHTML = ""; up.appendChild(ccUpload({ purpose: "Add pictures or video", product: null, video: true })); };
      const grid = document.createElement("div"); grid.className = "ct-grid"; body.appendChild(grid);
      const r = await read("list_creatives", {});
      const items = firstList(r?.out);
      if (!items.length) { grid.style.display = "block"; grid.appendChild(empty(r?.error || r?.out?.error ? "Could not load your assets." : "No creatives yet. Add some above.")); return; }
      items.slice(0, 60).forEach(it => {
        const u = it.preview_url || it.public_url || it.url; if (!u) return;
        const d = document.createElement("div"); d.className = "th"; d.title = it.name || it.file_name || "";
        d.innerHTML = /video/i.test(it.type || it.asset_type || "") ? `<video src="${escH(u)}" muted preload="metadata"></video>` : `<img src="${escH(u)}" loading="lazy" alt="">`;
        grid.appendChild(d);
      });
    }
  };

  // ── PROJECTS ─────────────────────────────────────────────────────────────────────────────────────────────────
  window.cmTabs.projects = async function projects(v) {
    v.innerHTML = "";
    const staff = ["owner", "admin"].includes(window.myProfile?.role);
    const sec = (label, rows) => { const l = document.createElement("div"); l.className = "ct-lbl"; l.textContent = label; v.appendChild(l); const c = document.createElement("div"); c.className = "ct-card"; rows.forEach(r => c.appendChild(r)); v.appendChild(c); return c; };
    const row = (ic, title, sub, pill, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "ct-row"; b.innerHTML = `<span class="ct-ic">${ic}</span><span style="min-width:0;flex:1"><b>${escH(title)}</b><span class="s">${escH(sub)}</span></span>${pill ? `<span class="ct-pill ${pill[0]}">${escH(pill[1])}</span>` : ""}`; b.onclick = fn; return b; };
    if (staff) {
      const holder = document.createElement("div"); holder.className = "ct-card"; holder.innerHTML = '<div class="ct-empty">Loading Autopilot…</div>';
      const l = document.createElement("div"); l.className = "ct-lbl"; l.textContent = "AUTOPILOT"; v.appendChild(l); v.appendChild(holder);
      read("autopilot_status", {}).then(r => {
        holder.innerHTML = "";
        const runs = r?.card?.runs || [];
        if (r?.error || r?.out?.error) holder.appendChild(empty("Could not load Autopilot: " + (r.error || r.out.error)));
        else if (!runs.length) holder.appendChild(empty("No Autopilot runs yet. Ask the assistant to run autopilot for a product.", "Run autopilot", () => ask("Run autopilot for one of my products. Ask me which product and the budgets.", "Run autopilot")));
        runs.forEach(run => {
          const need = run.waiting_for_approval, bad = run.status === "failed" || run.status === "cancelled";
          const step = (run.steps || []).find(s => s.state === "now" || s.state === "needs_you" || s.state === "failed");
          const rw = row("★", `${run.product} run`, need ? "Waiting for your approval" : step ? step.label : run.status, need ? ["d", "Needs you"] : bad ? ["d", run.status] : ["s", run.status], () => { det.style.display = det.style.display === "none" ? "block" : "none"; });
          const det = document.createElement("div"); det.style.display = "none"; det.className = "ct-sheet"; det.appendChild(ccAutopilot({ runs: [run] }));
          holder.appendChild(rw); holder.appendChild(det);
        });
        holder.appendChild(row("⚙", "Autopilot settings", "Budgets, hard stop, launch mode", null, () => { location.href = "/autopilot.html"; }));
      });
    }
    sec("WORKING ON", [
      row("▣", "New product", "Add a product to your catalog", null, () => ask("I want to add a new product. Ask me what you need to know.", "New product")),
      row("🖼", "Image generation", "Make ad pictures from your product photo", null, () => ask("Make ad images for one of my products. Ask me which product and what look I want.", "Make ad images")),
      row("🎬", "Video script", "Write a short video ad script", null, () => ask("Write a short video ad script for one of my products. Ask me which product.", "Video script")),
    ]);
    // KNOWLEDGE ("What the team learned") stays hidden until the knowledge search is wired into the chat (see KNOWLEDGE_TOOL_HOOK in ai-chat/bridge.ts).
  };
  if (window.cmRepaint) window.cmRepaint();
})();
