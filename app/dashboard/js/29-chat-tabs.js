// Revora dashboard, part 29: CHAT TABS (Plans / Code / Projects of the chat screen)
// Reading happens here. Anything that changes, spends or publishes goes to a confirm card: nothing runs without a tap.
(function () {
  if (/[?&]classic=1/.test(location.search) || !window.cmTabs) return;
  const css = `
  /* shared: big, full-width, easy to tap */
  #cmView{text-align:left}
  .ct-seg{display:flex;gap:8px;padding:6px 12px 12px;flex-wrap:wrap}
  .ct-seg button{min-height:46px;padding:0 18px;border-radius:99px;font:inherit;font-size:14px;font-weight:600;background:var(--panel);border:1px solid var(--borderStrong,var(--border));color:var(--text);cursor:pointer}
  .ct-seg button[aria-pressed=true]{background:var(--text);color:var(--bg);border-color:var(--text)}
  .ct-card{margin:0 12px 12px;border:1px solid var(--borderStrong,var(--border));background:var(--panel);border-radius:20px;overflow:hidden;box-sizing:border-box}
  .ct-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 16px 10px}
  .ct-top b{font-size:16px;display:block;line-height:1.3}.ct-top span{font-size:14px;color:var(--text2)}
  .ct-pill{font-size:12px;font-weight:700;padding:4px 11px;border-radius:99px;flex:none;background:var(--panel2);color:var(--text2)}
  .ct-pill.d{background:rgba(245,165,36,.18);color:#b7791f}.ct-pill.s{background:rgba(24,119,242,.12);color:#1877F2}.ct-pill.l{background:rgba(26,154,74,.14);color:#1a9a4a}
  .ct-kv{display:flex;justify-content:space-between;gap:12px;padding:11px 16px;border-top:1px solid var(--border);font-size:14.5px}
  .ct-kv span{color:var(--text2)}.ct-kv b{text-align:right}
  .ct-act{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--border);flex-wrap:wrap}
  .ct-act button,.ct-btn{flex:1;min-height:48px;border-radius:14px;font:inherit;font-size:14px;font-weight:700;border:1px solid var(--borderStrong,var(--border));background:var(--panel);color:var(--text);cursor:pointer;padding:0 12px}
  .ct-act .p,.ct-btn.p{background:var(--accent,#1877F2);border-color:var(--accent,#1877F2);color:#fff}
  .ct-lbl{font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--text2);padding:18px 20px 10px;text-transform:uppercase;text-align:left}
  .ct-row{display:flex;gap:14px;align-items:center;padding:14px 16px;min-height:72px;border-bottom:1px solid var(--border);width:100%;box-sizing:border-box;background:none;border-left:0;border-right:0;border-top:0;font:inherit;color:var(--text);text-align:left;cursor:pointer}
  .ct-row:last-child{border-bottom:0}.ct-row b{font-size:16px;display:block;line-height:1.3}.ct-row span.s{font-size:13.5px;color:var(--text2);line-height:1.35}
  .ct-ic{width:46px;height:46px;border-radius:14px;flex:none;display:flex;align-items:center;justify-content:center}
  .ct-ic svg{width:24px;height:24px}
  .ct-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 12px 12px}
  .ct-grid .th{aspect-ratio:1;border-radius:14px;overflow:hidden;background:var(--panel2);border:1px solid var(--border)}
  .ct-grid img,.ct-grid video{width:100%;height:100%;object-fit:cover;display:block}
  .ct-empty{margin:10px 16px;color:var(--text2);font-size:15px;line-height:1.5}
  .ct-sheet{padding:0 10px 10px}
  /* CODE: a real editor look */
  #chatPanel.cm.page.cm-code #cmView{display:flex;flex-direction:column;overflow:hidden;padding:0}
  .ide{flex:1;min-height:0;display:flex;flex-direction:column;text-align:left;background:#1e1e1e;color:#d4d4d4;font-family:Inter,system-ui,sans-serif;position:relative}
  .ide-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#252526;border-bottom:1px solid #333;flex-wrap:nowrap;overflow-x:auto}
  .ide-bar::-webkit-scrollbar{display:none}
  .ide-site{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 10px;border-radius:10px;background:#333;border:0;color:#fff;font:600 14px Inter,system-ui,sans-serif;max-width:42vw;min-width:0;flex:0 1 auto}
  .ide-site select{background:transparent;border:0;color:#fff;font:inherit;max-width:100%;min-width:0;text-overflow:ellipsis}
  .ide-site select option{color:#000}
  .ide-st{font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;flex:none}
  .ide-st.d{background:#5a4a1a;color:#f5c75b}.ide-st.l{background:#1d4a2c;color:#6fdc8c}
  .ide-sp{flex:1}
  .ide-tb{min-height:40px;padding:0 12px;border-radius:10px;background:#333;border:0;color:#e6e6e6;font:600 13px Inter,system-ui,sans-serif;flex:none;cursor:pointer;white-space:nowrap}
  .ide-tb.p{background:#1877F2;color:#fff}.ide-tb[aria-pressed=true]{background:#094771}
  .ide-body{flex:1;min-height:0;display:flex;position:relative}
  .ide-tree{width:230px;flex:none;background:#252526;border-right:1px solid #333;overflow:auto;padding:6px 0;display:none}
  .ide-tree.on{display:block}
  @media (max-width:760px){.ide-tree.on{position:absolute;z-index:6;left:0;top:0;bottom:0;box-shadow:6px 0 24px rgba(0,0,0,.5);width:78%}}
  .ide-t-h{font:700 11px Inter,sans-serif;letter-spacing:.08em;color:#9da0a6;padding:8px 14px}
  .ide-f{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;color:#d4d4d4;font:13px ui-monospace,'JetBrains Mono',Menlo,monospace;cursor:pointer;border:0;background:none;width:100%;text-align:left}
  .ide-f.on{background:#37373d;color:#fff}.ide-f.dir{color:#c8c8c8;font-weight:600}
  .ide-f i{font-style:normal;font:700 9px Inter,sans-serif;width:30px;text-align:center;border-radius:4px;padding:2px 0;flex:none;color:#111}
  .ide-main{flex:1;min-width:0;display:flex;flex-direction:column}
  .ide-tabs{display:flex;background:#252526;overflow-x:auto;flex:none}.ide-tabs::-webkit-scrollbar{display:none}
  .ide-tab{display:flex;align-items:center;gap:8px;min-height:42px;padding:0 14px;border:0;border-right:1px solid #1e1e1e;border-top:2px solid transparent;background:#2d2d2d;color:#9da0a6;font:13px ui-monospace,'JetBrains Mono',Menlo,monospace;white-space:nowrap;cursor:pointer;flex:none}
  .ide-tab.on{background:#1e1e1e;color:#fff;border-top-color:#1877F2}
  .ide-code{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;background:#1e1e1e;padding:8px 0}
  .ide-code .l{display:block;text-align:left;min-width:max-content;padding:0 14px 0 0;white-space:pre;font:12.5px/1.65 ui-monospace,'JetBrains Mono',Menlo,Consolas,monospace;color:#d4d4d4;tab-size:2}
  .ide-code .l::before{content:attr(data-n);display:inline-block;width:46px;padding-right:14px;margin-right:12px;text-align:right;color:#6e7681;user-select:none;border-right:1px solid #2f2f2f}
  .tk-t{color:#569cd6}.tk-a{color:#9cdcfe}.tk-s{color:#ce9178}.tk-c{color:#6a9955;font-style:italic}.tk-k{color:#c586c0}.tk-n{color:#b5cea8}.tk-p{color:#9cdcfe}.tk-sel{color:#d7ba7d}.tk-pu{color:#808080}
  .ide-pv{flex:1;min-height:0;background:#fff;display:none}.ide-pv iframe{width:100%;height:100%;border:0}
  .ide-status{display:flex;align-items:center;gap:12px;min-height:36px;padding:0 12px;background:#1877F2;color:#fff;font:600 12px Inter,system-ui,sans-serif;flex:none;overflow-x:auto;white-space:nowrap}
  .ide-status .sp{flex:1}.ide-status button{background:rgba(255,255,255,.18);border:0;color:#fff;font:700 12px Inter,sans-serif;border-radius:8px;min-height:28px;padding:0 10px;cursor:pointer}
  .ide-sheet{position:absolute;left:0;right:0;bottom:0;z-index:8;background:var(--bg);padding:10px;border-top:1px solid #333;max-height:75%;overflow:auto;display:none;color:var(--text)}
  .ide-empty{padding:28px 20px;color:#9da0a6;font-size:15px;line-height:1.5}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const ask = (text, label) => { if (window.cmTab) cmTab("chat"); askChat(text, label || text); };
  const read = async (tool, args) => sbFn("ai-chat", { action: "run_read", tool, args: args || {} });
  const loading = (v) => { v.innerHTML = '<div class="ct-empty">Loading…</div>'; };
  const seg = (items, cur, on) => { const d = document.createElement("div"); d.className = "ct-seg"; d.innerHTML = items.map(i => `<button type="button" data-k="${i[0]}" aria-pressed="${i[0] === cur}">${escH(i[1])}</button>`).join(""); d.querySelectorAll("button").forEach(b => b.onclick = () => on(b.dataset.k)); return d; };
  const empty = (txt, btn, fn) => { const d = document.createElement("div"); d.className = "ct-empty"; d.innerHTML = escH(txt) + (btn ? `<div style="margin-top:12px"><button type="button" class="ct-btn p" style="flex:none;padding:0 22px">${escH(btn)}</button></div>` : ""); if (btn) d.querySelector("button").onclick = fn; return d; };
  const firstList = (o) => { for (const k of Object.keys(o || {})) if (Array.isArray(o[k]) && o[k].length && typeof o[k][0] === "object") return o[k]; return []; };
  const TILE = {
    star: ["#e9f1fe", "#1877F2", '<path d="M12 3l3 7h7l-5.5 4.3L18.5 21 12 16.8 5.5 21l2-7.7L2 10h7z"/>'],
    cog: ["#eceae1", "#3f3c34", '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>'],
    box: ["#e1f4e8", "#14703b", '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/>'],
    img: ["#f3e8fb", "#6a2c9e", '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="M21 15l-5-5-9 11"/>'],
    vid: ["#fde8e6", "#a1271b", '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9l5 3-5 3z"/>'],
  };
  const tile = (k) => `<span class="ct-ic" style="background:${TILE[k][0]}"><svg viewBox="0 0 24 24" fill="none" stroke="${TILE[k][1]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TILE[k][2]}</svg></span>`;

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

  // ── CODE: an editor ──────────────────────────────────────────────────────────────────────────────────────────
  const KW = new Set("const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of null undefined true false this".split(" "));
  const BADGE = { html: ["HTML", "#e8825a"], css: ["CSS", "#5aa0e8"], js: ["JS", "#e6d25a"], json: ["JSON", "#9ccf6a"], svg: ["SVG", "#d49be8"] };
  const extOf = (p) => (String(p).split(".").pop() || "").toLowerCase();
  const badge = (p) => { const b = BADGE[extOf(p)] || ["FILE", "#a0a0a0"]; return `<i style="background:${b[1]}">${b[0]}</i>`; };
  const E = (s) => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  // small colouring: per line, with a flag that carries a block comment onto the next line
  function colour(ext, lines) {
    let inC = false;
    const lang = ext === "css" ? "css" : ext === "js" || ext === "json" ? "js" : "html";
    const RX = {
      html: /<!--[\s\S]*?-->|<\/?[A-Za-z][\w-]*|\/?>|"[^"]*"|'[^']*'|[\w:@-]+(?==)|&\w+;/g,
      css: /\/\*[\s\S]*?\*\/|"[^"]*"|'[^']*'|#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms)?\b|[\w-]+(?=\s*:)|[.#]?[A-Za-z][\w-]*(?=[^{]*\{)|[{}();:,]/g,
      js: /\/\/.*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|[{}()[\];,.:]/g,
    }[lang];
    return lines.map(line => {
      let out = "", i = 0, s = line;
      if (inC) { const e = lang === "html" ? s.indexOf("-->") : s.indexOf("*/"); if (e < 0) return `<span class="tk-c">${E(s)}</span>`; const n = e + (lang === "html" ? 3 : 2); out += `<span class="tk-c">${E(s.slice(0, n))}</span>`; i = n; inC = false; s = s; }
      RX.lastIndex = i;
      let m;
      while ((m = RX.exec(s))) {
        if (m.index > i) out += E(s.slice(i, m.index));
        const t = m[0]; let c = "";
        if (lang === "html") c = t.startsWith("<!--") ? "tk-c" : /^<\/?[A-Za-z]/.test(t) ? "tk-t" : t === ">" || t === "/>" ? "tk-t" : /^["']/.test(t) ? "tk-s" : t[0] === "&" ? "tk-n" : "tk-a";
        else if (lang === "css") c = t.startsWith("/*") ? "tk-c" : /^["']/.test(t) ? "tk-s" : /^[{}();:,]$/.test(t) ? "tk-pu" : /^#[0-9a-f]/i.test(t) || /^-?\d/.test(t) ? "tk-n" : /^[.#]/.test(t) ? "tk-sel" : RX && /:\s*/.test(s.slice(m.index + t.length, m.index + t.length + 2)) ? "tk-p" : "tk-sel";
        else c = t.startsWith("//") || t.startsWith("/*") ? "tk-c" : /^["'`]/.test(t) ? "tk-s" : /^\d/.test(t) ? "tk-n" : KW.has(t) ? "tk-k" : /^[{}()[\];,.:]$/.test(t) ? "tk-pu" : "";
        out += c ? `<span class="${c}">${E(t)}</span>` : E(t);
        i = m.index + t.length;
      }
      if (i < s.length) {
        const rest = s.slice(i);
        if (lang === "html" && rest.includes("<!--") && !rest.includes("-->")) { out += `<span class="tk-c">${E(rest)}</span>`; inC = true; }
        else if (lang !== "html" && rest.includes("/*") && !rest.includes("*/")) { out += `<span class="tk-c">${E(rest)}</span>`; inC = true; }
        else out += E(rest);
      } else if (lang !== "html" && /\/\*(?!.*\*\/)/.test(s)) inC = true;
      else if (lang === "html" && /<!--(?!.*-->)/.test(s)) inC = true;
      return out || " ";
    });
  }
  const fileLines = (txt) => String(txt || "").split("\n").map(r => r.replace(/^\d+\t/, ""));

  let codeSeg = "sites", ideSite = null;
  window.cmTabs.code = async function code(v) {
    const panel = document.getElementById("chatPanel");
    panel.classList.toggle("cm-code", codeSeg === "sites");
    v.innerHTML = "";
    if (codeSeg === "assets") {
      v.appendChild(seg([["sites", "Sites"], ["assets", "Assets"]], codeSeg, k => { codeSeg = k; code(v); }));
      const body = document.createElement("div"); v.appendChild(body); body.innerHTML = '<div class="ct-empty">Loading…</div>';
      const up = document.createElement("div"); up.className = "ct-sheet"; body.innerHTML = ""; body.appendChild(up);
      const bar = document.createElement("div"); bar.style.cssText = "padding:0 12px 12px"; bar.innerHTML = '<button type="button" class="ct-btn p" style="width:100%">Add pictures or video</button>'; body.appendChild(bar);
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
      return;
    }
    // the IDE
    const ide = document.createElement("div"); ide.className = "ide"; v.appendChild(ide);
    ide.innerHTML = '<div class="ide-empty">Opening your sites…</div>';
    const list = await read("site_list_files", {});
    const sites = list?.out?.sites || [];
    if (list?.error || list?.out?.error) { ide.innerHTML = `<div class="ide-empty">Could not load your sites: ${escH(list.error || list.out.error)}</div>`; return; }
    if (!sites.length) { ide.innerHTML = '<div class="ide-empty">No file-based sites yet. Ask the assistant to build a sales page as real files and it will appear here.<div style="margin-top:14px"><button type="button" class="ide-tb p" id="ideNew">Build a sales page</button></div></div>'; ide.querySelector("#ideNew").onclick = () => ask("Build a sales page for one of my products. Ask me which product.", "Build a sales page"); return; }
    let site = sites.find(s => s.site_id === ideSite) || sites[0]; ideSite = site.site_id;
    const cache = new Map(); let files = [], open = [], active = null, treeOn = window.innerWidth > 760, pvOn = false;
    ide.innerHTML = `<div class="ide-bar"><label class="ide-site"><select aria-label="Site">${sites.map(s => `<option value="${escH(s.site_id)}" ${s.site_id === site.site_id ? "selected" : ""}>${escH(s.name)}</option>`).join("")}</select></label><span class="ide-st"></span><span class="ide-sp"></span>
        <button type="button" class="ide-tb" data-a="tree" aria-pressed="${treeOn}">Files</button><button type="button" class="ide-tb" data-a="pv" aria-pressed="false">Preview</button><button type="button" class="ide-tb p" data-a="live"></button></div>
      <div class="ide-body"><div class="ide-tree${treeOn ? " on" : ""}"></div><div class="ide-main"><div class="ide-tabs"></div><div class="ide-code"></div><div class="ide-pv"></div><div class="ide-status"></div></div></div><div class="ide-sheet"></div>`;
    const $ = (s) => ide.querySelector(s);
    const isLive = () => /publish|live/i.test(site.status || "") && !/draft/i.test(site.status || "");
    const paintBar = () => { const st = $(".ide-st"); st.className = "ide-st " + (isLive() ? "l" : "d"); st.textContent = isLive() ? "Live" : "Draft"; $('[data-a="live"]').textContent = isLive() ? "Take offline" : "Go live"; };
    const paintTree = () => {
      const dirs = new Map(); files.forEach(f => { const d = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""; (dirs.get(d) || dirs.set(d, []).get(d)).push(f); });
      const out = [`<div class="ide-t-h">${escH(site.name.toUpperCase())}</div>`];
      [...dirs.keys()].sort((a, b) => a.localeCompare(b)).forEach(d => { if (d) out.push(`<div class="ide-f dir">▾ ${escH(d)}</div>`); dirs.get(d).forEach(f => out.push(`<button type="button" class="ide-f${f.path === active ? " on" : ""}" data-p="${escH(f.path)}" style="padding-left:${d ? 28 : 14}px">${badge(f.path)}${escH(f.path.split("/").pop())}</button>`)); });
      const t = $(".ide-tree"); t.innerHTML = out.join(""); t.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { openFile(b.dataset.p); if (window.innerWidth <= 760) { treeOn = false; t.classList.remove("on"); $('[data-a="tree"]').setAttribute("aria-pressed", "false"); } });
    };
    const paintTabs = () => { const t = $(".ide-tabs"); t.innerHTML = open.map(p => `<button type="button" class="ide-tab${p === active ? " on" : ""}" data-p="${escH(p)}">${badge(p)}${escH(p.split("/").pop())}</button>`).join(""); t.querySelectorAll("button").forEach(b => b.onclick = () => openFile(b.dataset.p)); };
    const paintStatus = (f) => { const s = $(".ide-status"); const n = f ? f.lines.length : 0; s.innerHTML = `<span>${(BADGE[extOf(active)] || ["Text"])[0]}</span><span>${n} line${n === 1 ? "" : "s"}${f?.total > n ? " of " + f.total : ""}</span><span>${f?.version ? "v" + f.version : ""}</span><span class="sp"></span><button type="button" data-a="edit">Edit with AI</button><button type="button" data-a="hist">History</button><button type="button" data-a="editor">Editor</button>`; s.querySelector('[data-a="edit"]').onclick = () => ask(`In the site "${site.name}", open ${active} and help me change it. Ask me what to change.`, `Edit ${active}`); s.querySelector('[data-a="hist"]').onclick = () => ask(`Show the version history of ${active} in the site "${site.name}" and let me pick a version to roll back to.`, "Version history"); s.querySelector('[data-a="editor"]').onclick = () => { location.href = "/ide.html?site=" + encodeURIComponent(site.site_id); }; };
    async function openFile(path) {
      if (!path) return; if (!open.includes(path)) open.push(path); active = path; pvOn = false; $(".ide-pv").style.display = "none"; $(".ide-code").style.display = ""; $('[data-a="pv"]').setAttribute("aria-pressed", "false");
      paintTabs(); paintTree();
      const code = $(".ide-code");
      if (!cache.has(path)) { code.innerHTML = '<div class="ide-empty">Opening…</div>'; const r = await read("site_read_file", { site_id: site.site_id, path }); const o = r?.out || {}; if (r?.error || o.error) { code.innerHTML = `<div class="ide-empty">${escH(r.error || o.error)}</div>`; return; } cache.set(path, { lines: fileLines(o.content), total: o.total_lines, version: o.version }); }
      if (active !== path) return;
      const f = cache.get(path), html = colour(extOf(path), f.lines);
      code.innerHTML = html.map((h, i) => `<span class="l" data-n="${i + 1}">${h}</span>`).join(""); code.scrollTop = 0;
      paintStatus(f);
    }
    async function loadSite() {
      cache.clear(); open = []; active = null; paintBar();
      $(".ide-code").innerHTML = '<div class="ide-empty">Opening…</div>';
      const f = await read("site_list_files", { site_id: site.site_id });
      files = (f?.out?.files || []).map(x => ({ path: String(x.path), version: x.version }));
      if (f?.out?.test_link) site.test_link = f.out.test_link;
      paintTree();
      if (!files.length) { $(".ide-code").innerHTML = '<div class="ide-empty">No files yet. Ask the assistant to write them.</div>'; paintTabs(); return; }
      openFile((files.find(x => x.path === "index.html") || files[0]).path);
    }
    ide.querySelector("select").onchange = (e) => { site = sites.find(s => s.site_id === e.target.value) || site; ideSite = site.site_id; loadSite(); };
    $('[data-a="tree"]').onclick = (e) => { treeOn = !treeOn; $(".ide-tree").classList.toggle("on", treeOn); e.currentTarget.setAttribute("aria-pressed", String(treeOn)); };
    $('[data-a="pv"]').onclick = (e) => { if (!site.test_link) return; pvOn = !pvOn; const pv = $(".ide-pv"); pv.style.display = pvOn ? "block" : "none"; $(".ide-code").style.display = pvOn ? "none" : ""; if (pvOn) pv.innerHTML = `<iframe src="${escH(site.test_link)}" title="Preview"></iframe>`; e.currentTarget.setAttribute("aria-pressed", String(pvOn)); };
    $('[data-a="live"]').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      const q = await sbFn("ai-chat", { action: "queue_publish", site_id: site.site_id, live: !isLive() });
      b.disabled = false; const sh = $(".ide-sheet"); sh.innerHTML = ""; sh.style.display = "block";
      if (q?.card) { sh.appendChild(ccConfirm(q.card)); const x = document.createElement("button"); x.type = "button"; x.className = "ct-btn"; x.style.cssText = "width:100%;margin-top:8px;flex:none"; x.textContent = "Close"; x.onclick = () => { sh.style.display = "none"; }; sh.appendChild(x); }
      else sh.appendChild(empty(q?.error || "Could not prepare that."));
    };
    loadSite();
  };

  // ── PROJECTS ─────────────────────────────────────────────────────────────────────────────────────────────────
  window.cmTabs.projects = async function projects(v) {
    document.getElementById("chatPanel").classList.remove("cm-code");
    v.innerHTML = "";
    const staff = ["owner", "admin"].includes(window.myProfile?.role);
    const sec = (label, rows) => { const l = document.createElement("div"); l.className = "ct-lbl"; l.textContent = label; v.appendChild(l); const c = document.createElement("div"); c.className = "ct-card"; rows.forEach(r => c.appendChild(r)); v.appendChild(c); return c; };
    const row = (ic, title, sub, pill, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "ct-row"; b.innerHTML = `${tile(ic)}<span style="min-width:0;flex:1"><b>${escH(title)}</b><span class="s">${escH(sub)}</span></span>${pill ? `<span class="ct-pill ${pill[0]}">${escH(pill[1])}</span>` : ""}`; b.onclick = fn; return b; };
    if (staff) {
      const holder = document.createElement("div"); holder.className = "ct-card"; holder.innerHTML = '<div class="ct-empty">Loading Autopilot…</div>';
      const l = document.createElement("div"); l.className = "ct-lbl"; l.textContent = "Autopilot"; v.appendChild(l); v.appendChild(holder);
      read("autopilot_status", {}).then(r => {
        holder.innerHTML = "";
        const runs = r?.card?.runs || [];
        if (r?.error || r?.out?.error) holder.appendChild(empty("Could not load Autopilot: " + (r.error || r.out.error)));
        else if (!runs.length) holder.appendChild(empty("No Autopilot runs yet. Ask the assistant to run autopilot for a product.", "Run autopilot", () => ask("Run autopilot for one of my products. Ask me which product and the budgets.", "Run autopilot")));
        runs.forEach(run => {
          const need = run.waiting_for_approval, bad = run.status === "failed" || run.status === "cancelled";
          const step = (run.steps || []).find(s => s.state === "now" || s.state === "needs_you" || s.state === "failed");
          const rw = row("star", `${run.product} run`, need ? "Waiting for your approval" : step ? step.label : run.status, need ? ["d", "Needs you"] : bad ? ["d", run.status] : ["s", run.status], () => { det.style.display = det.style.display === "none" ? "block" : "none"; });
          const det = document.createElement("div"); det.style.display = "none"; det.className = "ct-sheet"; det.appendChild(ccAutopilot({ runs: [run] }));
          holder.appendChild(rw); holder.appendChild(det);
        });
        holder.appendChild(row("cog", "Autopilot settings", "Budgets, hard stop, launch mode", null, () => { location.href = "/autopilot.html"; }));
      });
    }
    sec("Working on", [
      row("box", "New product", "Add a product to your catalog", null, () => ask("I want to add a new product. Ask me what you need to know.", "New product")),
      row("img", "Image generation", "Make ad pictures from your product photo", null, () => ask("Make ad images for one of my products. Ask me which product and what look I want.", "Make ad images")),
      row("vid", "Video script", "Write a short video ad script", null, () => ask("Write a short video ad script for one of my products. Ask me which product.", "Video script")),
    ]);
    // KNOWLEDGE ("What the team learned") stays hidden until the knowledge search is wired into the chat (see KNOWLEDGE_TOOL_HOOK in ai-chat/bridge.ts).
  };
  const origCode = window.cmTabs.code, origPlans = window.cmTabs.plans;
  window.cmTabs.plans = function (v) { document.getElementById("chatPanel").classList.remove("cm-code"); return origPlans(v); };
  if (window.cmRepaint) window.cmRepaint();
})();
