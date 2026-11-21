// Revora dashboard, part 14 of 23: TAB: CARE DESK (owner/admin) · Delivery (Shipbubble)

// ── TAB: DELIVERY (riders) ───────────────────────────────────────────────────
// ── TAB: CARE DESK (owner/admin) ─────────────────────────────────────────────
// Who is calling which customer. New orders are handed to the care agent with the fewest open calls; here an admin
// can see everyone's queue, move an order to someone else, or hand out anything still unassigned.
async function renderCareDesk(el) {
  const [agents, orders] = await Promise.all([
    sbQuery("profiles", "select=id,display_name,role&role=eq.customer_care&order=display_name.asc").catch(() => []),
    sbQuery("orders", "select=id,customer_name,customer_phone,product_name,order_value_naira,order_status,ordered_at,care_agent_id,care_attempts,care_note,customer_city,customer_state,media_buyers(name)&order=ordered_at.desc&limit=200").catch(() => []),
  ]);
  const nm = Object.fromEntries((agents || []).map(a => [a.id, a.display_name || "Care agent"]));
  const stat = (id) => { const mine = (orders || []).filter(o => o.care_agent_id === id); return { open: mine.filter(o => o.order_status === "pending").length, valid: mine.filter(o => o.order_status === "valid" || o.order_status === "delivered").length, cancelled: mine.filter(o => o.order_status === "cancelled").length }; };
  const unassigned = (orders || []).filter(o => !o.care_agent_id && o.order_status === "pending");
  const todo = (orders || []).filter(o => o.order_status === "pending");
  const opts = (cur) => `<option value="">Unassigned</option>${(agents || []).map(a => `<option value="${a.id}" ${a.id === cur ? "selected" : ""}>${escH(a.display_name || "Care agent")}</option>`).join("")}`;
  el.innerHTML = `
    <div class="sh"><div class="sh-title">Care desk</div><div class="sh-actions"><button class="btn btn-g" onclick="render()">↺ Refresh</button>${unassigned.length && (agents || []).length ? `<button class="btn btn-a" id="careSpread">Hand out ${unassigned.length} unassigned</button>` : ""}</div></div>
    ${!(agents || []).length ? `<div class="panel"><div class="empty"><div class="empty-ico">☎️</div>No customer care agents yet. Invite one in Settings → Business &amp; team (role: Customer care). New orders will then be shared between your care agents automatically.</div></div>` : `
    <div class="g4">${(agents || []).map(a => { const t = stat(a.id); return `<div class="kc"><div class="kc-lbl">${escH(a.display_name || "Care agent")}</div><div class="kc-val ${t.open ? "w" : "a"}">${t.open} to call</div><div class="kc-sub">${t.valid} confirmed · ${t.cancelled} cancelled</div></div>`; }).join("")}</div>`}
    <div class="panel">
      <div class="ph"><div class="ph-title">Orders waiting for a call (${todo.length})</div><div class="ph-count">${unassigned.length} unassigned</div></div>
      ${!todo.length ? `<div class="empty"><div class="empty-ico">🎉</div>Nothing waiting. Every order has been called.</div>` : `<div class="tbl-wrap"><table>
        <tr><th>Customer</th><th>Order</th><th>Buyer</th><th>Tries</th><th>Ordered</th><th>Care agent</th></tr>
        ${todo.map(o => `<tr>
          <td class="s n">${escH(o.customer_name || "—")}<div style="font-size:10.5px;color:var(--muted)">${escH(o.customer_phone || "")} · ${escH(o.customer_city || "")}${o.customer_state ? ", " + escH(o.customer_state) : ""}</div></td>
          <td>${escH(o.product_name || "")} · ${fN(o.order_value_naira)}</td>
          <td class="s">${escH(o.media_buyers?.name || "—")}</td>
          <td>${o.care_attempts || 0}</td>
          <td>${ago(o.ordered_at)}</td>
          <td><select class="careSel" data-oid="${o.id}" style="padding:3px 7px;font-size:11px;width:auto;">${opts(o.care_agent_id)}</select></td>
        </tr>`).join("")}
      </table></div>`}
    </div>
    <div class="panel">
      <div class="ph"><div class="ph-title">Recent orders by care agent</div></div>
      <div class="tbl-wrap"><table>
        <tr><th>Customer</th><th>Order</th><th>Status</th><th>Care agent</th><th>Note</th></tr>
        ${(orders || []).filter(o => o.order_status !== "pending").slice(0, 40).map(o => `<tr>
          <td class="s n">${escH(o.customer_name || "—")}</td><td>${escH(o.product_name || "")} · ${fN(o.order_value_naira)}</td>
          <td><span class="pill ${o.order_status}">${escH(o.order_status)}</span></td>
          <td class="s">${escH(nm[o.care_agent_id] || "—")}</td><td class="s" style="max-width:260px">${escH(o.care_note || "")}</td></tr>`).join("")}
      </table></div>
    </div>`;
  el.querySelectorAll(".careSel").forEach(sel => sel.addEventListener("change", async e => {
    const { error } = await supabaseClient.from("orders").update({ care_agent_id: e.target.value || null, care_assigned_at: e.target.value ? new Date().toISOString() : null }).eq("id", e.target.dataset.oid);
    if (error) { alert("Could not assign: " + error.message); return; }
    renderCareDesk(el);
  }));
  document.getElementById("careSpread")?.addEventListener("click", async e => {
    e.target.disabled = true;
    const load = Object.fromEntries((agents || []).map(a => [a.id, stat(a.id).open]));
    for (const o of unassigned) {
      const pick = Object.entries(load).sort((a, b) => a[1] - b[1])[0][0];
      const { error } = await supabaseClient.from("orders").update({ care_agent_id: pick, care_assigned_at: new Date().toISOString() }).eq("id", o.id);
      if (!error) load[pick]++;
    }
    renderCareDesk(el);
  });
}



// Creative upload straight to R2: the file never passes through an edge function (those run out of memory on big videos).
// Takes the same FormData the old upload used and answers like the old function: { asset } or { error }.
async function bvCreUpload(fd) {
  const file = fd.get("file");
  try {
    if (!file) throw new Error("No file chosen.");
    const hdr = { Authorization: `Bearer ${sessionData?.access_token || ANON}`, "Content-Type": "application/json", apikey: ANON };
    const sign = await fetch(`${SUPA_URL}/functions/v1/media`, { method: "POST", headers: hdr, body: JSON.stringify({ action: "sign", folder: "creative-vault", filename: String(file.name || "file").replace(/\.{2,}/g, "."), contentType: file.type, size: file.size }) }).then(r => r.json());
    if (!sign.uploadUrl) throw new Error(sign.error || "Couldn't start the upload.");
    const put = await fetch(sign.uploadUrl, { method: "PUT", headers: sign.headers || { "Content-Type": file.type }, body: file });
    if (!put.ok) throw new Error(`Upload to storage failed (${put.status}).`);
    const get = k => fd.get(k) || undefined;
    const reg = await fetch(`${SUPA_URL}/functions/v1/creative-admin`, { method: "POST", headers: hdr, body: JSON.stringify({ action: "register", key: sign.key, file_name: file.name, content_type: file.type, name: get("creative_name"), primary_text: get("primary_text"), headline: get("headline"), description: get("description"), mechanism: get("mechanism"), format: get("format"), cta_type: get("cta_type"), uploaded_by: get("uploaded_by"), ad_account_id: get("ad_account_id"), product_id: get("product_id"), launch_at: get("launch_at") }) }).then(r => r.json());
    // Phones record HEVC .mov, which Chrome can't play. Convert it to a plain .mp4 in the background so everyone can watch it (ads accept both).
    if (reg?.asset?.id && reg.asset.asset_type === "video") {
      bvToast("Uploaded. Converting the video so it plays in every browser. This takes a minute or two.");
      // TRANSCODE_URL: the AWS Lambda revora-transcode Function URL. Empty = the Vercel function (temporary fallback / rollback).
      const TRANSCODE_URL = "https://qsfqnzeq2zagtxrnmollnt4xt40jibvp.lambda-url.af-south-1.on.aws/";
      fetch(TRANSCODE_URL || "/api/transcode", { method: "POST", headers: { Authorization: hdr.Authorization, "Content-Type": "application/json" }, body: JSON.stringify({ asset_id: reg.asset.id }) })
        .then(r => r.json()).then(tc => {
          if (tc?.converted) { bvToast("Your video is ready and plays in every browser."); if (activeTab === "catalog") document.querySelector('[data-tab="catalog"]')?.click(); }
          else if (tc?.error) bvToast(tc.error, "err");
        }).catch(() => {});
    }
    return reg;
  } catch (e) { return { error: e.message || String(e) }; }
}
function bvCreFetch(fd) { const p = bvCreUpload(fd); return Promise.resolve({ ok: true, json: () => p }); }

// Name + ad text for creatives being uploaded. Returns { name, primary_text, headline, description, cta_type } or null if cancelled.
function bvCreativeUploadSheet(files, d, opt) {
  return new Promise(resolve => {
    d = d || {}; opt = opt || {};
    const stem = opt.noStem ? "" : (files[0]?.name || "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 80);
    const ov = bvOpenSheet("bvCreUp", `
      <button class="bv-modal-close" data-sheet-close>✕</button>
      <h3 style="margin:0 0 4px">${escH(opt.title || "Name this creative")}</h3>
      <div style="color:var(--text2);font-size:12.5px;margin-bottom:12px">${opt.sub ? escH(opt.sub) : files.length > 1 ? `${files.length} files: they share this ad text, and the name gets a number.` : escH(files[0]?.name || "")}</div>
      <div class="field"><label>Name</label><input class="cat-in" id="cuN" value="${escH(d.name || stem)}" placeholder="e.g. Lagos testimonial video"></div>
      <div class="field" style="margin-top:8px"><label>Primary text (the main ad copy)</label><textarea class="cat-in" id="cuP" rows="3" placeholder="Reused every time this creative is in a campaign">${escH(d.primary_text || "")}</textarea></div>
      <div class="field" style="margin-top:8px"><label>Headline</label><input class="cat-in" id="cuH" value="${escH(d.headline || "")}" placeholder="Short bold hook"></div>
      <div class="field" style="margin-top:8px"><label>Description (optional)</label><input class="cat-in" id="cuD" value="${escH(d.description || "")}"></div>
      <div class="field" style="margin-top:8px"><label>Button</label><select class="cat-in" id="cuC">${BV_CTAS.map(c => `<option value="${c[0]}" ${(d.cta_type || "SHOP_NOW") === c[0] ? "selected" : ""}>${escH(c[1])}</option>`).join("")}</select></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button type="button" class="btn btn-g" id="cuX">Cancel</button><button type="button" class="btn btn-a" id="cuOk">${escH(opt.ok || "Upload")}</button></div>`, 520);
    const done = v => { bvCloseSheet("bvCreUp"); resolve(v); };
    ov.querySelector("[data-sheet-close]").onclick = () => done(null);
    ov.querySelector("#cuX").onclick = () => done(null);
    ov.querySelector("#cuOk").onclick = () => done({ name: ov.querySelector("#cuN").value.trim(), primary_text: ov.querySelector("#cuP").value.trim(), headline: ov.querySelector("#cuH").value.trim(), description: ov.querySelector("#cuD").value.trim(), cta_type: ov.querySelector("#cuC").value });
    setTimeout(() => ov.querySelector("#cuN")?.focus(), 30);
  });
}

// Edit a creative's name and ad text (primary text, headline, description, button). Saves on every copy of the file.
async function bvCreativeEdit(id, after) {
  const rows = await sbQuery("creative_assets", `select=id,file_name,display_name,primary_text,headline,description,cta_type&id=eq.${id}`).catch(() => []);
  const a = rows?.[0]; if (!a) return bvToast("Couldn't load that creative.", "err");
  const v = await bvCreativeUploadSheet([{ name: a.file_name || "" }], { name: a.display_name || "", primary_text: a.primary_text, headline: a.headline, description: a.description, cta_type: a.cta_type }, { title: "Edit creative", sub: a.file_name || "", ok: "Save", noStem: true });
  if (!v) return;
  const r = await sbFn("creative-admin", { action: "update", id, name: v.name, primary_text: v.primary_text, headline: v.headline, description: v.description, cta_type: v.cta_type });
  if (r?.error) return bvToast("Couldn't save: " + r.error, "err");
  bvToast("Saved."); if (after) after(); else document.querySelector('[data-tab="catalog"]')?.click();
}
async function bvCatDelCre(id) { if (!confirm("Delete this creative and its file?")) return; if (await bvDeleteCreative(id)) document.querySelector('[data-tab="catalog"]')?.click(); }
// Delete a creative everywhere (library, file on R2/Supabase). Asks again if ads used it.
async function bvDeleteCreative(id) {
  const call = async force => { const r = await sbFn("creative-admin", { action: "delete", id, force }); return r; };
  let r = await call(false);
  if (r?.needs_force) { if (!confirm(r.error)) return false; r = await call(true); }
  if (r?.error) { bvToast("Couldn't delete: " + r.error, "err"); return false; }
  bvToast("Creative deleted."); return true;
}

// ── Delivery (Shipbubble) ───────────────────────────────────────────────────────────────
// Shipbubble picks the courier, collects the parcel and reports every step by webhook, so this view shows what is happening,
// explains a failed booking in plain words, and lets the team fix the order and book again. No riders to assign.
const SD_STEPS = [["booked", "Booked"], ["picked_up", "Picked up"], ["in_transit", "On the way"], ["delivered", "Delivered"]];
function bvShipStage(o) {
  if (o.order_status === "delivered") return "delivered";
  if (o.order_status === "cancelled") return "cancelled";
  if (!o.shipbubble_order_id) return o.shipbubble_error ? "failed" : "waiting";
  const st = String(o.shipbubble_status || "").toLowerCase();
  if (/deliver/.test(st)) return "delivered";
  if (/transit|out_for|on_the_way|dispatch/.test(st) || o.delivery_stage === "on_the_way") return "in_transit";
  if (/pick/.test(st)) return "picked_up";
  return "booked";
}
// Turns Shipbubble's technical error into a title, the reason and what to do next.
function bvShipExplain(o) {
  const raw = String(o.shipbubble_error || "");
  const clean = raw.replace(/^Shipbubble\s+[A-Z]+\s+\S+\s+\d{3}:\s*/i, "").replace(/;.*$/, "").trim();
  if (/insufficient wallet|fund your wallet/i.test(raw)) return { kind: "wallet", title: "Shipbubble wallet is low", why: "There isn't enough money in your Shipbubble wallet to pay for this delivery.", fix: "Top up the wallet, then book again." };
  if (/full name|numbers and symbols|first name|last name/i.test(raw)) return { kind: "name", title: "Customer name needs fixing", why: "Shipbubble needs a first and last name, letters only (for example John Doe).", fix: "Correct the name, then book again." };
  if (/phone/i.test(raw)) return { kind: "phone", title: "Phone number needs fixing", why: "Shipbubble could not use this phone number.", fix: "Correct the number, then book again." };
  if (/validate|address|couldn't validate|could not validate/i.test(raw)) return { kind: "address", title: "Address could not be verified", why: "Shipbubble needs a clear street address with the city and state.", fix: "Add the street, city and state, then book again." };
  if (/no courier|rates?\b.*(not|no)|not available|couriers?/i.test(raw)) return { kind: "courier", title: "No courier available", why: "No courier serves this address right now.", fix: "Check the address or try again later." };
  return { kind: "other", title: "Booking did not go through", why: clean.slice(0, 140) || "Shipbubble did not accept this booking.", fix: "Check the details and book again." };
}
const SD_PILL = { waiting: ["Booking…", "mute"], failed: ["Needs attention", "bad"], booked: ["Booked", "info"], picked_up: ["Picked up", "info"], in_transit: ["On the way", "go"], delivered: ["Delivered", "ok"], cancelled: ["Cancelled", "mute"] };
function bvShipCss() {
  if (document.getElementById("sdCss")) return;
  const st = document.createElement("style"); st.id = "sdCss";
  st.textContent = `
.sd{max-width:980px;margin:0 auto}
.sd-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.sd-head h2{font-family:'Fraunces',Georgia,serif;font-size:26px;font-weight:600;letter-spacing:-.01em;line-height:1.15}
.sd-head p{color:var(--muted);font-size:13px;margin-top:3px}
.sd-search{position:relative;min-width:210px;flex:1;max-width:320px}
.sd-search input{width:100%;border:1px solid var(--border);background:var(--panel);border-radius:10px;padding:9px 12px 9px 34px;font:inherit;font-size:13.5px;color:var(--text);outline:none}
.sd-search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accentBg)}
.sd-search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:15px;height:15px;stroke:var(--muted);fill:none;stroke-width:2;stroke-linecap:round}
.sd-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
.sd-kpi{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px 15px;position:relative;overflow:hidden;box-shadow:var(--shadow-sm)}
.sd-kpi:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--kc,var(--borderStrong))}
.sd-kpi span{display:block;font-size:11.5px;color:var(--muted);font-weight:500;letter-spacing:.02em}
.sd-kpi b{display:block;font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;line-height:1.15;margin-top:4px;color:var(--text)}
.sd-kpi.warn b{color:var(--danger)}
.sd-sum{color:var(--text2);font-size:12.5px;line-height:1.5;margin:-2px 0 14px}.sd-sum b{color:var(--text)}
.sd-alert{display:flex;gap:12px;align-items:flex-start;background:var(--warnBg);border:1px solid var(--warnBdr);border-radius:14px;padding:13px 15px;margin-bottom:14px}
.sd-alert .ic{width:32px;height:32px;border-radius:9px;background:#fff;border:1px solid var(--warnBdr);display:flex;align-items:center;justify-content:center;flex:none;font-size:16px}
.sd-alert b{display:block;font-size:14px;color:var(--warn)}
.sd-alert p{font-size:12.5px;color:var(--text2);margin-top:2px;line-height:1.5}
.sd-alert .tx{flex:1;min-width:0}.sd-alert .go{margin-left:auto;flex:none;align-self:center}
.sd-seg{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;margin-bottom:14px;scrollbar-width:none}
.sd-seg::-webkit-scrollbar{display:none}
.sd-chip{border:1px solid var(--border);background:var(--panel);color:var(--text2);border-radius:999px;padding:7px 13px;font:inherit;font-size:13px;font-weight:500;white-space:nowrap;cursor:pointer}
.sd-chip em{font-style:normal;color:var(--muted);margin-left:5px;font-size:12px}
.sd-chip.on{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.sd-chip.on em{color:inherit;opacity:.7}
.sd-list{display:grid;gap:12px}
@media(min-width:900px){.sd-list{grid-template-columns:1fr 1fr}}
.sd-card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:15px 16px;box-shadow:var(--shadow-sm)}
.sd-hd{display:flex;gap:12px;align-items:flex-start}
.sd-av{width:40px;height:40px;border-radius:12px;background:var(--panel2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;color:var(--text2);flex:none;letter-spacing:.02em}
.sd-who{min-width:0;flex:1}
.sd-who b{display:block;font-size:15px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-who>span{display:block;color:var(--muted);font-size:12.5px;margin-top:2px;line-height:1.5}
.sd-amt{font-weight:600;color:var(--text)}
.sd-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 10px;font-size:11.5px;font-weight:600;white-space:nowrap;flex:none;background:var(--panel2);color:var(--text2)}
.sd-pill:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.sd-pill.ok{background:#e8f6ee;color:#16784a}.sd-pill.go{background:#fdf1de;color:#a35f0a}.sd-pill.info{background:var(--blueBg);color:var(--blue)}
.sd-pill.bad{background:var(--dangerBg);color:var(--danger)}.sd-pill.mute{background:var(--panel2);color:var(--muted)}
.sd-cod{display:inline-block;border:1px solid var(--border);border-radius:6px;padding:0 6px;font-size:11px;color:var(--text2);margin-left:6px;vertical-align:1px;white-space:nowrap}
.sd-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:14px}
.sd-steps i{display:block;height:4px;border-radius:2px;background:var(--border)}
.sd-steps i.on{background:var(--accent)}
.sd-steps div{font-size:10.5px;color:var(--muted);margin-top:6px;text-align:left}
.sd-steps div.on{color:var(--text);font-weight:600}
.sd-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:12px;font-size:12.5px;color:var(--text2)}
.sd-meta span{display:inline-flex;align-items:center;gap:5px}
.sd-issue{margin-top:12px;border-radius:12px;background:var(--dangerBg);border:1px solid var(--dangerBdr);padding:11px 13px}
.sd-issue.warnx{background:var(--warnBg);border-color:var(--warnBdr)}
.sd-issue b{display:block;font-size:13.5px;color:var(--danger)}
.sd-issue.warnx b{color:var(--warn)}
.sd-issue p{font-size:12.5px;color:var(--text2);margin-top:3px;line-height:1.5}
.sd-issue small{display:block;margin-top:6px;font-size:12px;color:var(--text);font-weight:500}
.sd-try{font-size:11.5px;color:var(--muted);margin-top:6px}
.sd-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center}
.sd-btn{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:10px;padding:8px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;line-height:1.2}
.sd-btn:hover{border-color:var(--borderStrong);background:var(--panel2)}
.sd-btn.pri{background:var(--accent);border-color:var(--accent);color:#fff}
.sd-btn.pri:hover{background:var(--accentDk)}
.sd-btn:disabled{opacity:.55;cursor:default}
.sd-link{background:none;border:0;color:var(--text2);font:inherit;font-size:12.5px;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:6px 2px}
.sd-empty{background:var(--panel);border:1px dashed var(--borderStrong);border-radius:16px;padding:34px 20px;text-align:center;color:var(--text2)}
.sd-empty b{display:block;font-size:15px;color:var(--text);margin-bottom:4px}
.sd-skel{height:128px;border-radius:16px;background:linear-gradient(90deg,var(--panel2),var(--border),var(--panel2));background-size:200% 100%;animation:sdsh 1.2s infinite}
@keyframes sdsh{0%{background-position:200% 0}100%{background-position:-200% 0}}
.sd-fx label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
@media(max-width:700px){.sd-kpis{grid-template-columns:repeat(2,1fr)}.sd-kpi b{font-size:24px}.sd-head h2{font-size:23px}.sd-search{max-width:none;min-width:100%}.sd-alert{flex-wrap:wrap}.sd-alert .tx{flex:1 1 calc(100% - 50px)}.sd-alert .go{flex:1 1 100%;margin:8px 0 0;justify-content:center;align-self:stretch}}
`;
  document.head.appendChild(st);
}
async function renderShipDelivery(el) {
  bvShipCss();
  if (!el.querySelector(".sd")) el.innerHTML = `<div class="sd"><div class="sd-head"><div><h2>Deliveries</h2><p>Loading…</p></div></div><div class="sd-list"><div class="sd-skel"></div><div class="sd-skel"></div></div></div>`;
  const orders = await sbQuery("orders", "select=id,customer_name,customer_phone,customer_city,customer_state,customer_address,order_value_naira,order_status,delivery_stage,payment_method,ordered_at,delivered_at,shipbubble_order_id,shipbubble_status,shipbubble_courier,shipbubble_tracking_code,shipbubble_tracking_url,shipbubble_error,shipbubble_attempts,shipbubble_mode,shipping_fee_naira,cod_amount_naira,cod_collected_at,cod_remitted_amount_naira,cod_remitted_at&order_status=in.(valid,delivered)&order=ordered_at.desc&limit=200") || [];
  window.bvShipOrders = orders;
  // A customer who already paid by transfer while Shipbubble is still set to collect cash: the courier may collect twice.
  const pays = await sbQuery("payments", "select=order_id,channel&status=eq.confirmed&order_id=not.is.null&order=paid_at.desc&limit=1000").catch(() => []);
  const paidByTransfer = new Set((pays || []).filter(p => p.channel !== "shipbubble_cod").map(p => p.order_id));
  const rows = orders.map(o => ({ o, st: bvShipStage(o), ex: bvShipStage(o) === "failed" ? bvShipExplain(o) : null, risk: !!(o.shipbubble_order_id && Number(o.cod_amount_naira || 0) > 0 && !o.cod_remitted_at && o.order_status === "valid" && paidByTransfer.has(o.id)) }));
  const n = (st) => rows.filter(r => r.st === st).length;
  const inTransit = n("in_transit") + n("picked_up"), attention = n("failed");
  const active = rows.filter(r => !["delivered", "cancelled"].includes(r.st));
  const tab = window.bvShipFilter || "active", q = (window.bvShipQ || "").trim().toLowerCase();
  let shown = tab === "all" ? rows : tab === "delivered" ? rows.filter(r => r.st === "delivered") : tab === "problem" ? rows.filter(r => r.st === "failed") : active;
  if (q) shown = shown.filter(r => [r.o.customer_name, r.o.customer_phone, r.o.customer_city, r.o.customer_state, r.o.shipbubble_tracking_code].join(" ").toLowerCase().includes(q));
  shown = [...shown].sort((a, b) => (b.st === "failed") - (a.st === "failed"));
  const awaiting = rows.filter(r => r.st === "delivered" && /pay on delivery|cash on delivery|\bcod\b/i.test(r.o.payment_method || "") && !r.o.cod_remitted_at).reduce((s, r) => s + Number(r.o.cod_amount_naira || r.o.order_value_naira || 0), 0);
  const walletN = rows.filter(r => r.ex && r.ex.kind === "wallet").length;
  const initials = (nm) => String(nm || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
  const ago = (iso) => { if (!iso) return ""; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${Math.max(m, 1)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const card = ({ o, st, ex, risk }) => {
    const cod = /pay on delivery|cash on delivery|\bcod\b/i.test(o.payment_method || "");
    const [pl, pc] = SD_PILL[st] || [st, "mute"];
    const idx = SD_STEPS.findIndex(x => x[0] === st);
    const loc = [o.customer_city, o.customer_state].filter(Boolean).join(", ") || "No address";
    const steps = idx >= 0 ? `<div class="sd-steps">${SD_STEPS.map((x, i) => `<div><i class="${idx >= i ? "on" : ""}"></i><div class="${idx === i ? "on" : ""}">${x[1]}</div></div>`).join("")}</div>` : "";
    const issue = ex ? `<div class="sd-issue ${ex.kind === "wallet" ? "warnx" : ""}"><b>${escH(ex.title)}</b><p>${escH(ex.why)}</p><small>${escH(ex.fix)}</small>${o.shipbubble_attempts ? `<div class="sd-try">Tried ${o.shipbubble_attempts} time${o.shipbubble_attempts > 1 ? "s" : ""}</div>` : ""}</div>` : "";
    const meta = o.shipbubble_courier ? `<div class="sd-meta"><span>🚚 ${escH(o.shipbubble_courier)}</span>${o.shipping_fee_naira ? `<span>Fee ${fN(o.shipping_fee_naira)}</span>` : ""}${o.shipbubble_tracking_code ? `<span>#${escH(o.shipbubble_tracking_code)}</span>` : ""}${o.shipbubble_mode && o.shipbubble_mode !== "live" ? `<span>Test shipment</span>` : ""}</div>` : "";
    const codAmt = Number(o.cod_remitted_amount_naira || o.cod_amount_naira || o.order_value_naira || 0);
    const codLine = (cod || o.cod_amount_naira) && st === "delivered" ? `<div class="sd-meta"><span>${o.cod_remitted_at ? `✓ Shipbubble paid out ${fN(codAmt)}` : `⏳ Courier collected ${fN(codAmt)}${o.cod_collected_at ? " on " + escH(new Date(o.cod_collected_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })) : ""}. Awaiting payout from Shipbubble.`}</span></div>` : "";
    const riskBox = risk ? `<div class="sd-issue warnx"><b>Customer already paid by transfer</b><p>Shipbubble is still set to collect ${fN(Number(o.cod_amount_naira || 0))} in cash on delivery.</p><small>Tell the courier not to collect, or cancel the shipment in Shipbubble.</small></div>` : "";
    const wa = o.customer_phone ? `https://wa.me/${escH(String(o.customer_phone).replace(/\D/g, "").replace(/^0/, "234"))}` : "";
    const canBook = ["failed", "waiting"].includes(st) && o.order_status === "valid";
    const needsFix = ex && ["name", "phone", "address"].includes(ex.kind);
    const acts = `<div class="sd-act">
      ${canBook ? (needsFix ? `<button class="sd-btn pri" onclick="bvShipFix('${o.id}')">Fix details</button><button class="sd-btn" onclick="bvShipAct('${o.id}','retry',this)">Book again</button>` : `<button class="sd-btn pri" onclick="bvShipAct('${o.id}','retry',this)">Book delivery</button>`) : ""}
      ${o.shipbubble_tracking_url ? `<a class="sd-btn" href="${escH(o.shipbubble_tracking_url)}" target="_blank" rel="noopener">Track parcel</a>` : ""}
      ${wa ? `<a class="sd-btn" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
      ${canBook ? `<button class="sd-link" onclick="bvShipAct('${o.id}','rates',this)">Check prices</button>` : ""}</div>`;
    return `<div class="sd-card"><div class="sd-hd"><div class="sd-av">${escH(initials(o.customer_name))}</div><div class="sd-who"><b>${escH(o.customer_name || "Customer")}</b><span>${escH(loc)}<br><span class="sd-amt">${fN(o.order_value_naira)}</span>${cod ? '<span class="sd-cod">Pay on delivery</span>' : ""}${o.ordered_at ? ` <span style="white-space:nowrap">· ${escH(ago(o.ordered_at))}</span>` : ""}</span></div><span class="sd-pill ${pc}">${pl}</span></div>${riskBox}${issue || steps}${issue ? "" : meta}${codLine}${acts}</div>`;
  };
  const chip = (id, label, count) => `<button class="sd-chip ${tab === id ? "on" : ""}" onclick="window.bvShipFilter='${id}';renderShipDelivery(document.getElementById('mainContent'))">${label}<em>${count}</em></button>`;
  const kpi = (label, val, color, cls = "") => `<div class="sd-kpi ${cls}" style="--kc:${color}"><span>${label}</span><b>${val}</b></div>`;
  el.innerHTML = `<div class="sd">
    <div class="sd-head"><div><h2>Deliveries</h2><p>Live from Shipbubble. ${rows.length} order${rows.length === 1 ? "" : "s"} in the last 200.</p></div>
      <div class="sd-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="sdQ" value="${escH(window.bvShipQ || "")}" placeholder="Search name, phone, city or tracking number" autocomplete="off"></div></div>
    <div class="sd-kpis">${kpi("On the way", inTransit, "#d98a1f")}${kpi("Booked", n("booked"), "#2f6fc4")}${kpi("Delivered", n("delivered"), "#1f9a5f")}${kpi("Need attention", attention, attention ? "#c0392b" : "#cfcabd", attention ? "warn" : "")}</div>
    ${awaiting ? `<div class="sd-sum">💰 <b>${fN(awaiting)}</b> in cash on delivery is waiting to be paid out by Shipbubble.</div>` : ""}
    ${rows.some(r => r.risk) ? `<div class="sd-alert"><div class="ic">⚠️</div><div class="tx"><b>${rows.filter(r => r.risk).length} customer${rows.filter(r => r.risk).length > 1 ? "s" : ""} paid by transfer after cash on delivery was booked</b><p>The courier may still collect cash. Check the orders marked below.</p></div></div>` : ""}
    ${walletN ? `<div class="sd-alert"><div class="ic">💳</div><div class="tx"><b>Shipbubble wallet is low</b><p>${walletN} order${walletN > 1 ? "s are" : " is"} waiting because the wallet can't cover the delivery fee. Top up the wallet in Shipbubble, then book them all again.</p></div><button class="sd-btn pri go" onclick="bvShipRetryWallet(this)">Book ${walletN} again</button></div>` : ""}
    <div class="sd-seg">${chip("active", "In progress", active.length)}${chip("problem", "Needs attention", attention)}${chip("delivered", "Delivered", n("delivered"))}${chip("all", "All", rows.length)}</div>
    ${shown.length ? `<div class="sd-list">${shown.map(card).join("")}</div>` : `<div class="sd-empty"><b>${q ? "No orders match your search" : tab === "problem" ? "Nothing needs attention" : "No deliveries here yet"}</b>${q ? "Try a different name, phone or city." : tab === "problem" ? "Every confirmed order has been booked with a courier." : "When an order is confirmed, Shipbubble books a courier automatically and the steps show up here."}</div>`}
  </div>`;
  const inp = document.getElementById("sdQ");
  if (inp) { let t; inp.oninput = () => { window.bvShipQ = inp.value; clearTimeout(t); t = setTimeout(() => { renderShipDelivery(el).then(() => { const i2 = document.getElementById("sdQ"); if (i2) { i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); } }); }, 250); }; }
}
async function bvShipAct(orderId, action, btn) {
  if (btn) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = action === "rates" ? "Checking…" : "Booking…"; }
  try {
    const out = await sbFn("delivery-admin", { action, order_id: orderId });
    if (out?.error) throw new Error(out.error);
    if (action === "rates") {
      const r = out?.rates || out?.couriers || out?.quotes || out;
      alert("Courier prices:\n\n" + (Array.isArray(r) ? r.map(x => `${x.courier_name || x.name || "Courier"}: ₦${Number(x.total || x.amount || x.fee || 0).toLocaleString()}`).join("\n") : JSON.stringify(r, null, 2).slice(0, 700)));
    } else bvToast(out?.skipped || "Delivery booked.");
  } catch (e) { bvToast(String(e.message || "That didn't work.").replace(/^Shipbubble\s+[A-Z]+\s+\S+\s+\d{3}:\s*/i, ""), "err"); }
  if (btn) { btn.disabled = false; btn.textContent = btn.dataset.t || btn.textContent; }
  renderShipDelivery(document.getElementById("mainContent"));
}
async function bvShipRetryWallet(btn) {
  const list = (window.bvShipOrders || []).filter(o => o.order_status === "valid" && !o.shipbubble_order_id && bvShipExplain(o).kind === "wallet");
  if (!list.length) return;
  if (!confirm(`Book ${list.length} order${list.length > 1 ? "s" : ""} again? Make sure your Shipbubble wallet has been topped up first.`)) return;
  btn.disabled = true; let ok = 0, fail = 0;
  for (const o of list) { btn.textContent = `Booking ${ok + fail + 1} of ${list.length}…`; const r = await sbFn("delivery-admin", { action: "retry", order_id: o.id }); (r?.error ? fail++ : ok++); }
  bvToast(fail ? `${ok} booked, ${fail} still need attention.` : `${ok} deliveries booked.`, fail ? "err" : "ok");
  renderShipDelivery(document.getElementById("mainContent"));
}
function bvShipFix(orderId) {
  const o = (window.bvShipOrders || []).find(x => x.id === orderId); if (!o) return;
  const ex = bvShipExplain(o);
  const ov = bvOpenSheet("sdFix", `<button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('sdFix')">✕</button>
    <div class="sd-fx"><h3 style="margin:0 0 2px;font-size:18px">Fix delivery details</h3><div style="color:var(--text2);font-size:13px;margin-bottom:4px">${escH(ex.why)}</div>
    <label>Full name (first and last, letters only)</label><input class="cat-in" id="sfN" value="${escH(o.customer_name || "")}" autocomplete="off">
    <label>Phone number</label><input class="cat-in" id="sfP" value="${escH(o.customer_phone || "")}" inputmode="tel" autocomplete="off">
    <label>Street address</label><input class="cat-in" id="sfA" value="${escH(o.customer_address || "")}" placeholder="House number, street, area" autocomplete="off">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label>City</label><input class="cat-in" id="sfC" value="${escH(o.customer_city || "")}" autocomplete="off"></div><div><label>State</label><input class="cat-in" id="sfS" value="${escH(o.customer_state || "")}" autocomplete="off"></div></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="sd-btn" onclick="bvCloseSheet('sdFix')">Cancel</button><button class="sd-btn pri" id="sfGo">Save and book</button></div></div>`, 460);
  ov.querySelector("#sfGo").onclick = async () => {
    const v = id => ov.querySelector(id).value.trim();
    const name = v("#sfN");
    if (!/^[A-Za-z][A-Za-z'.\-]*(\s+[A-Za-z][A-Za-z'.\-]*)+$/.test(name)) return bvToast("Enter a first and last name using letters only, for example John Doe.", "err");
    const b = ov.querySelector("#sfGo"); b.disabled = true; b.textContent = "Saving…";
    const { error } = await supabaseClient.from("orders").update({ customer_name: name, customer_phone: v("#sfP"), customer_address: v("#sfA"), customer_city: v("#sfC"), customer_state: v("#sfS") }).eq("id", orderId);
    if (error) { b.disabled = false; b.textContent = "Save and book"; return bvToast("Couldn't save: " + error.message, "err"); }
    bvCloseSheet("sdFix");
    await bvShipAct(orderId, "retry", null);
  };
}

async function renderRiders(el) {
  const isDeliveryAgent = window.myProfile?.role === "delivery_agent";
  if (!isDeliveryAgent) return renderShipDelivery(el);
  const [agents, orders] = await Promise.all([
    sbQuery("delivery_agents", "select=*&order=name.asc"),
    sbQuery("orders", `select=id,delivery_agent_id,delivery_stage,order_status,assignment_status,assignment_offered_at,order_value_naira,customer_name,customer_phone,customer_city,customer_state,ordered_at,delivered_at,payments(status,paid_at)&delivery_agent_id=not.is.null&order=ordered_at.desc`),
  ]);
  for (const o of orders || []) o.payment = (o.payments || [])[0] || null;

  // orders is already RLS-scoped to just this agent's own assignments for
  // a delivery_agent login -- so there's no "company roster" to show them,
  // only their own work and what it's worth, which is what they actually
  // asked for: "do I get to see my own revenue."
  if (isDeliveryAgent) return renderMyDeliveries(el, orders || [], agents || []);

  const byAgent = new Map();
  for (const a of agents || []) byAgent.set(a.id, { agent: a, assigned: 0, delivered: 0, revenue: 0 });
  for (const o of orders || []) {
    const row = byAgent.get(o.delivery_agent_id);
    if (!row) continue;
    row.assigned++;
    if (o.order_status === "delivered") { row.delivered++; row.revenue += Number(o.order_value_naira || 0); }
  }
  const rows = [...byAgent.values()].sort((a, b) => b.assigned - a.assigned);
  const totAssigned = orders?.length ?? 0;
  const totDelivered = orders?.filter(o => o.order_status === "delivered").length ?? 0;
  const deliveryRate = totAssigned ? (totDelivered / totAssigned * 100).toFixed(1) : "0";

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Delivery</div><div class="sh-actions"><button class="btn btn-g" onclick="render()">↺ Refresh</button></div></div>

    <div class="g4">
      <div class="kc"><div class="kc-lbl">Active agents</div><div class="kc-val">${(agents || []).filter(a => a.active).length}</div></div>
      <div class="kc"><div class="kc-lbl">Orders assigned</div><div class="kc-val">${totAssigned}</div></div>
      <div class="kc"><div class="kc-lbl">Delivered</div><div class="kc-val a">${totDelivered}</div></div>
      <div class="kc"><div class="kc-lbl">Delivery rate</div><div class="kc-val ${deliveryRate >= 70 ? "a" : "w"}">${deliveryRate}%</div></div>
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Agents</div><div class="ph-count">How AI-confirmed orders get routed to a rider by zone</div></div>
      ${!rows.length ? `<div class="empty"><div class="empty-ico">🛵</div>No delivery agents yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Agent</th><th>Area (state, city)</th><th>Phone</th><th>Assigned</th><th>Delivered</th><th>Rate</th><th>Revenue collected</th><th>Status</th></tr>
        ${rows.map(r => {
          const rate = r.assigned ? (r.delivered / r.assigned * 100).toFixed(0) : "0";
          return `<tr>
            <td class="s n">${escH(r.agent.name)}</td>
            <td class="n">${escH(r.agent.state ? r.agent.state + (r.agent.city ? ", " + r.agent.city : "") : (r.agent.zone || "—"))} <button type="button" class="btn btn-g" style="padding:1px 7px;font-size:9px;margin-left:4px;" onclick="bvEditRiderArea('${r.agent.id}', '${escH(r.agent.state || "")}', '${escH(r.agent.city || "")}')">Edit</button></td>
            <td class="n">${escH(r.agent.phone || "—")}</td>
            <td>${r.assigned}</td>
            <td class="a">${r.delivered}</td>
            <td>${rate}%</td>
            <td>${fN(r.revenue)}</td>
            <td><span class="pill ${r.agent.active ? "active" : "paused"}">${r.agent.active ? "active" : "inactive"}</span></td>
          </tr>`;
        }).join("")}
      </table></div>`}
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Recent assignments</div></div>
      ${!orders?.length ? `<div class="empty"><div class="empty-ico">📦</div>No orders assigned yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Customer</th><th>City</th><th>Agent</th><th>Payment</th><th>Status</th><th>Assignment</th><th>Assigned</th></tr>
        ${orders.slice(0, 40).map(o => `<tr>
          <td class="s n">${escH(o.customer_name ?? "—")}</td>
          <td class="n">${escH(o.customer_city ?? "—")}, ${escH(o.customer_state ?? "—")}</td>
          <td class="n">${escH(byAgent.get(o.delivery_agent_id)?.agent.name ?? "—")}</td>
          <td>${bvPaymentCell(o)}</td>
          <td><span class="pill ${o.order_status}">${escH(o.order_status)}</span></td>
          <td>${o.assignment_status === "offered" ? `<span class="pill" style="background:#fff4e0;color:#a66b00;">⏳ Awaiting rider</span>`
              : o.assignment_status === "accepted" ? `<span class="pill">✅ Accepted</span>`
              : `<span style="color:var(--muted);">—</span>`}</td>
          <td>${ago(o.ordered_at)}</td>
        </tr>`).join("")}
      </table></div>`}
    </div>`;
}

// A delivery agent's own view: what's assigned to them, what they've
// delivered, and what that's worth -- no other agent's data in sight.
// A rider's state (and optionally city): orders are offered to riders in the customer's state first. A rider sets their own; an admin can set anyone's.
function bvEditRiderArea(agentId, state, city) {
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal">
    <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
    <div class="ph-title" style="margin-bottom:6px;">Delivery area</div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">Orders from this state are offered to this rider first. Add a city to narrow it down (optional).</div>
    <div class="field"><label>State</label><select id="bvRiderState"><option value="">Choose a state…</option>${BV_NG_STATES.map(x => `<option value="${escH(x.label)}" ${x.label === state ? "selected" : ""}>${escH(x.label)}</option>`).join("")}</select></div>
    <div class="field"><label>City / area (optional)</label><input id="bvRiderCity" value="${escH(city || "")}" placeholder="e.g. Ibadan, Ikeja, Lekki"></div>
    <div id="bvRiderMsg" style="font-size:11.5px;margin:8px 0;"></div>
    <button type="button" class="btn btn-a" id="bvRiderSave">Save</button>
  </div>`;
  document.body.appendChild(overlay);
  document.getElementById("bvRiderSave").addEventListener("click", async (e) => {
    const st = document.getElementById("bvRiderState").value, msg = document.getElementById("bvRiderMsg");
    if (!st) { msg.style.color = "var(--danger)"; msg.textContent = "Choose a state."; return; }
    e.target.disabled = true;
    const { error } = await supabaseClient.rpc("set_delivery_agent_area", { p_agent_id: agentId, p_state: st, p_city: document.getElementById("bvRiderCity").value });
    if (error) { msg.style.color = "var(--danger)"; msg.textContent = (error.message || "Could not save.").replace(/^.*?:\s*/, ""); e.target.disabled = false; return; }
    bvCloseModal();
    render();
  });
}

// The buyer's payment account for one order, so a rider can read it out or send it to the customer on WhatsApp.
async function bvShowPayInfo(orderId) {
  bvCloseModal();
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseModal(); };
  overlay.innerHTML = `<div class="bv-modal"><div style="text-align:center;padding:30px;color:var(--muted);font-size:12px;">Loading…</div></div>`;
  document.body.appendChild(overlay);
  const { data, error } = await supabaseClient.rpc("order_payment_details", { p_order_id: orderId });
  const modal = overlay.querySelector(".bv-modal");
  if (error || !data) { modal.innerHTML = `<button class="bv-modal-close" onclick="bvCloseModal()">✕</button><div class="empty">${escH((error?.message || "Could not load.").replace(/^.*?:\s*/, ""))}</div>`; return; }
  if (!data.account_number) { modal.innerHTML = `<button class="bv-modal-close" onclick="bvCloseModal()">✕</button><div class="empty"><div class="empty-ico">💳</div>This order's buyer has no payment account yet. Ask your admin.</div>`; return; }
  const msg = `Hi ${data.customer_name || ""}, to pay ${fN(data.amount)} for your order, please transfer to:\n${data.bank}\n${data.account_number}\n${data.account_name}${data.code ? "\nPut this code in the narration: " + data.code : ""}`;
  const ph = String(data.customer_phone || "").replace(/\D/g, "").replace(/^0/, "234");
  modal.innerHTML = `
    <button class="bv-modal-close" onclick="bvCloseModal()">✕</button>
    <div class="ph-title" style="margin-bottom:6px;">Payment account</div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">For ${escH(data.customer_name || "the customer")} · ${fN(data.amount)}. Once the transfer lands, Revora marks the order delivered by itself.</div>
    <div style="font-size:20px;font-weight:700;font-family:'JetBrains Mono',monospace;">${escH(data.account_number)}</div>
    <div style="font-size:12.5px;">${escH(data.bank || "")} · ${escH(data.account_name || "")}</div>
    ${data.code ? `<div style="font-size:12px;margin-top:6px;">Narration code: <b>${escH(data.code)}</b></div>` : ""}
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
      <a class="btn btn-a" target="_blank" rel="noopener" href="https://wa.me/${ph}?text=${encodeURIComponent(msg)}">Send on WhatsApp</a>
      <button type="button" class="btn btn-g" id="payInfoCopy">Copy</button>
    </div>`;
  document.getElementById("payInfoCopy").onclick = (e) => { navigator.clipboard?.writeText(msg); e.target.textContent = "Copied"; };
}

function renderMyDeliveries(el, orders, agents) {
  const myAgent = agents.find(a => a.id === window.myProfile?.delivery_agent_id);
  const offered = orders.filter(o => o.assignment_status === "offered");
  const active = orders.filter(o => o.assignment_status !== "offered");
  const delivered = active.filter(o => o.order_status === "delivered");
  const totalRevenue = delivered.reduce((s, o) => s + Number(o.order_value_naira || 0), 0);
  const rate = active.length ? (delivered.length / active.length * 100).toFixed(1) : "0";

  const now = new Date();
  const thisMonthDelivered = delivered.filter(o => o.delivered_at && new Date(o.delivered_at).getMonth() === now.getMonth() && new Date(o.delivered_at).getFullYear() === now.getFullYear());
  const thisMonthRevenue = thisMonthDelivered.reduce((s, o) => s + Number(o.order_value_naira || 0), 0);

  el.innerHTML = `
    <div class="sh"><div class="sh-title">My Deliveries</div><div class="sh-actions"><button class="btn btn-g" onclick="render()">↺ Refresh</button></div></div>

    ${myAgent && !myAgent.state ? `
    <div class="panel" style="border:1.5px solid var(--accent);margin-bottom:16px;">
      <div class="ph"><div class="ph-title">📍 Where do you deliver?</div></div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Orders are offered to riders in the customer's state (and city when you set one). Tell us your area so you get the right orders.</div>
      <button type="button" class="btn btn-a" onclick="bvEditRiderArea('${myAgent.id}', '', '')">Set my area</button>
    </div>` : ""}

    ${offered.length ? `
    <div class="panel" style="border:1.5px solid var(--accent);margin-bottom:16px;">
      <div class="ph"><div class="ph-title">🔔 New assignment${offered.length > 1 ? "s" : ""}</div><div class="ph-count">${offered.length} waiting on you</div></div>
      ${offered.map(o => `
        <div style="padding:12px 0;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:12px;justify-content:space-between;">
          <div>
            <div style="font-weight:600;font-size:13px;">${escH(o.customer_name ?? "—")} -- ${escH(o.customer_city ?? "—")}, ${escH(o.customer_state ?? "—")}</div>
            <div style="font-size:12px;color:var(--muted);">${fN(o.order_value_naira)} · offered ${ago(o.assignment_offered_at)}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-g assignAccept" data-oid="${o.id}">Accept</button>
            <button class="btn btn-g assignDecline" data-oid="${o.id}" style="color:var(--danger);">Decline</button>
          </div>
        </div>`).join("")}
    </div>` : ""}

    <div class="g4">
      <div class="kc"><div class="kc-lbl">Assigned to you</div><div class="kc-val">${active.length}</div></div>
      <div class="kc"><div class="kc-lbl">Delivered</div><div class="kc-val a">${delivered.length}</div></div>
      <div class="kc"><div class="kc-lbl">Delivery rate</div><div class="kc-val ${rate >= 70 ? "a" : "w"}">${rate}%</div></div>
      <div class="kc"><div class="kc-lbl">Revenue delivered</div><div class="kc-val a">${fN(totalRevenue)}</div><div class="kc-sub">all time</div></div>
    </div>

    <div class="g2" style="margin-bottom:18px;">
      <div class="kc"><div class="kc-lbl">This month</div><div class="kc-val">${thisMonthDelivered.length} delivered</div><div class="kc-sub">${fN(thisMonthRevenue)}</div></div>
      <div class="kc"><div class="kc-lbl">Your area</div><div class="kc-val" style="font-size:16px;">${escH(myAgent?.state ? myAgent.state + (myAgent.city ? ", " + myAgent.city : "") : (myAgent?.zone || "—"))}</div><div class="kc-sub">${escH(myAgent?.phone || "")}</div></div>
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Your assignments</div></div>
      ${!active.length ? `<div class="empty"><div class="empty-ico">📦</div>Nothing assigned to you yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Customer</th><th>Phone</th><th>City</th><th>Value</th><th>Payment</th><th>Status</th><th>Assigned</th><th>Update</th></tr>
        ${active.map(o => `<tr>
          <td class="s n">${escH(o.customer_name ?? "—")}</td>
          <td class="n">${o.customer_phone
            ? `<a href="https://wa.me/${o.customer_phone.replace(/\D/g,"")}" target="_blank" style="color:var(--accent);text-decoration:none;display:flex;align-items:center;gap:4px;">${icon("phone",12)} ${escH(o.customer_phone)}</a>`
            : "—"}</td>
          <td class="n">${escH(o.customer_city ?? "—")}, ${escH(o.customer_state ?? "—")}</td>
          <td>${fN(o.order_value_naira)}</td>
          <td>${bvPaymentCell(o)}</td>
          <td><span class="pill ${o.order_status}">${escH(o.order_status)}</span>${o.delivery_stage === "on_the_way" && o.order_status !== "delivered" ? ` <span class="pill">🚚 on the way</span>` : ""}</td>
          <td>${ago(o.ordered_at)}</td>
          <td style="white-space:nowrap;">${o.order_status === "delivered" || o.order_status === "cancelled" || o.order_status === "returned" ? "—" : `
            ${o.delivery_stage !== "on_the_way" ? `<button class="btn btn-g agentStep" data-step="on_the_way" data-oid="${o.id}" style="padding:3px 9px;font-size:10px;">🚚 On the way</button>` : ""}
            <button class="btn btn-a agentStep" data-step="delivered" data-oid="${o.id}" style="padding:3px 9px;font-size:10px;">✓ Delivered</button>
            <button class="btn btn-g payInfoBtn" data-oid="${o.id}" style="padding:3px 9px;font-size:10px;">💳 Payment account</button>`}</td>
        </tr>`).join("")}
      </table></div>`}
    </div>`;

  el.querySelectorAll(".agentStep").forEach(btn => btn.addEventListener("click", () => bvAgentStep(btn.dataset.oid, btn.dataset.step, btn)));
  el.querySelectorAll(".payInfoBtn").forEach(btn => btn.addEventListener("click", () => bvShowPayInfo(btn.dataset.oid)));
  el.querySelectorAll(".assignAccept").forEach(btn => btn.addEventListener("click", () => bvRespondAssignment(btn.dataset.oid, "accepted")));
  el.querySelectorAll(".assignDecline").forEach(btn => btn.addEventListener("click", () => bvRespondAssignment(btn.dataset.oid, "declined")));
}


// The delivery agent's two buttons. "On the way" tells the customer (WhatsApp) the order is out; "Delivered" is the
// agent's proof of handover (cash collected, or paid from another account). Payment is then requested from the customer.
async function bvAgentStep(orderId, step, btn) {
  if (step === "delivered" && !confirm("Mark this order as delivered?\nThe customer will be told, and asked to pay if they haven't yet.")) return;
  if (btn) btn.disabled = true;
  const patch = step === "on_the_way" ? { delivery_stage: "on_the_way" } : { order_status: "delivered", delivered_at: new Date().toISOString() };
  const { error } = await supabaseClient.from("orders").update(patch).eq("id", orderId);
  if (error) { bvToast(error.message, "err"); if (btn) btn.disabled = false; return; }
  bvToast(step === "on_the_way" ? "Customer told you're on the way" : "Marked delivered");
  render();
}

// A rider accepting/declining their own offered assignment. Race-safe the
// same way the support-queue claim button is: the .eq("assignment_status",
// "offered") guard means a second click (or the cron sweep expiring it at
// the same moment) can't double-apply this.
async function bvRespondAssignment(orderId, outcome) {
  const myAgentId = window.myProfile?.delivery_agent_id;
  if (outcome === "accepted") {
    await supabaseClient.from("orders").update({ assignment_status: "accepted" })
      .eq("id", orderId).eq("assignment_status", "offered");
  } else {
    await supabaseClient.from("orders").update({ delivery_agent_id: null, assignment_status: null })
      .eq("id", orderId).eq("assignment_status", "offered");
  }
  await supabaseClient.from("assignment_offers")
    .update({ outcome, responded_at: new Date().toISOString() })
    .eq("order_id", orderId).eq("delivery_agent_id", myAgentId).eq("outcome", "offered");
  render();
}