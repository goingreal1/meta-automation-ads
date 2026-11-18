// Revora dashboard, part 07 of 23: DUPLICATE AD SET(S) MODAL · PLACEMENTS: where the ad may show · helpers for the audience/reach below · WHERE + WHO: states, cities, audience presets, live potential reach

// ── DUPLICATE AD SET(S) MODAL ────────────────────────────────────────────────
// Mirrors Meta's own "Duplicate" flow: pick how many copies, and whether the
// copies keep or drop Advantage+ audience expansion -- a real, visible choice
// instead of a single blind-click button.
function bvOpenDuplicateAdSetModal() {
  const last = bvAdSetRows[bvAdSetRows.length - 1];
  const overlay = document.createElement("div");
  overlay.id = "bvDupModalOverlay";
  overlay.className = "bv-overlay";
  overlay.innerHTML = `
    <div class="bv-modal" style="max-width:420px;">
      <button class="bv-modal-close" onclick="this.closest('.bv-overlay').remove()">✕</button>
      <div class="ph-title" style="margin-bottom:12px;">Duplicate "${escH(bvAdSetName(last))}"</div>
      <div class="field"><label>Number of copies</label>
        <input type="number" id="dupCount" min="1" max="20" value="1">
      </div>
      <div class="field" style="margin-top:12px;"><label>Name for the copies <span style="font-weight:400;color:var(--muted);">(optional)</span></label>
        <input id="dupName" maxlength="120" placeholder="e.g. Lagos women 25-45" value="">
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">With several copies they are numbered (… 1, … 2). Leave blank to name them later in View all.</div>
      </div>
      <label style="display:flex;align-items:center;gap:7px;margin-top:14px;font-size:12px;font-weight:400;cursor:pointer;">
        <input type="checkbox" id="dupKeepAdvantage" ${last.advantage_audience !== false ? "checked" : ""}>
        Keep Advantage+ audience expansion on the duplicate(s)
      </label>
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">Uncheck to turn off Advantage+ on the duplicated ad set(s) only — "${last.label}" itself is unchanged.</div>
      <button type="button" class="btn btn-a btn-full" style="margin-top:16px;" onclick="bvConfirmDuplicateAdSets()">Duplicate</button>
    </div>`;
  document.body.appendChild(overlay);
}

function bvConfirmDuplicateAdSets() {
  const count = Math.max(1, Math.min(20, Number(document.getElementById("dupCount").value) || 1));
  const keepAdvantage = document.getElementById("dupKeepAdvantage").checked;
  const last = bvAdSetRows[bvAdSetRows.length - 1];
  const typed = document.getElementById("dupName")?.value.trim() || "";
  bvCommitFormCopy(); // an ad typed in the form is saved first, so it is copied along
  const used = bvAdSetRows.map(r => r.display_name || "");
  for (let n = 0; n < count; n++) {
    const seed = typed ? (count > 1 ? `${typed} ${n + 1}` : typed) : (last.display_name || "");
    const name = bvNextName(seed, used);
    used.push(name);
    const fresh = {
      ...last,
      device_platforms: [...(last.device_platforms || [])],
      states: [...bvStatesOf(last)], cities: (last.cities || []).map(c => ({ ...c })),
      presets: [...(last.presets || [])], interests: (last.interests || []).map(x => ({ ...x })), placements: [...(last.placements || [])],
      advantage_audience: keepAdvantage,
      display_name: name,
      label: `Ad Set ${bvAdSetRows.length + 1}`,
      uid: bvUid(),
    };
    bvAdSetRows.push(fresh);
    bvCloneAdsToAdSet(last.uid, fresh.uid); // duplicating an ad set duplicates its ads too
  }
  document.getElementById("bvDupModalOverlay")?.remove();
  bvRenderAdSetRows();
  bvToast(`${count} ad set cop${count === 1 ? "y" : "ies"} added — see them all with "View all ad sets".`);
}

function bvRemoveAdSetRow(i) {
  const gone = bvAdSetRows[i];
  const n = gone ? bvStagedOf(gone.uid).length : 0;
  if (n && !confirm(`Remove this ad set and its ${n} ad${n === 1 ? "" : "s"}?`)) return;
  if (gone) bvStagedCopies = bvStagedCopies.filter(c => c.adset_uid !== gone.uid);
  bvAdSetRows.splice(i, 1);
  bvAdSetRows.forEach((row, idx) => { row.label = `Ad Set ${idx + 1}`; });
  bvRenderAdSetRows();
}

// ── PLACEMENTS: where the ad may show ────────────────────────────────────────
// Meta's own rules (checked live): Marketplace / Search / Profile need Facebook feed; Facebook Stories needs
// Facebook feed or Instagram Stories; Explore / Instagram profile need Instagram feed; WhatsApp Status needs
// Instagram Stories; Threads and Audience Network ride on a feed.
const BV_PLACE_GROUPS = [
  { title: "Facebook", items: [["fb_feed", "Feed"], ["fb_reels", "Reels"], ["fb_stories", "Stories"], ["fb_marketplace", "Marketplace"], ["fb_search", "Search results"], ["fb_profile", "Profile feed"]] },
  { title: "Instagram", items: [["ig_feed", "Feed"], ["ig_reels", "Reels"], ["ig_stories", "Stories"], ["ig_explore", "Explore"], ["ig_profile", "Profile feed"]] },
  { title: "More apps", items: [["threads", "Threads"], ["wa_status", "WhatsApp Status"], ["an", "Audience Network"]] },
];
const BV_PLACE_PRESETS = [
  ["Feed only", ["fb_feed", "ig_feed"]],
  ["Feed + Reels", ["fb_feed", "fb_reels", "ig_feed", "ig_reels"]],
  ["Reels & Stories (vertical)", ["fb_reels", "ig_reels", "ig_stories"]],
  ["All Meta apps + Threads + WhatsApp", ["fb_feed", "fb_reels", "ig_feed", "ig_reels", "ig_stories", "threads", "wa_status", "an"]],
];
const BV_PLACE_DEFAULT_WA = ["fb_feed", "fb_search", "fb_reels", "ig_feed", "ig_reels"]; // what "Automatic" launches for WhatsApp ads
function bvPlaceNeeds(set) {
  const s = new Set(set), added = [];
  const need = (k, why) => { if (!s.has(k)) { s.add(k); added.push([k, why]); } };
  if (["fb_marketplace", "fb_search", "fb_profile"].some(k => s.has(k))) need("fb_feed", "Facebook feed");
  if (s.has("fb_stories") && !s.has("fb_feed") && !s.has("ig_stories")) need("fb_feed", "Facebook feed");
  if (["ig_explore", "ig_profile"].some(k => s.has(k))) need("ig_feed", "Instagram feed");
  if (s.has("wa_status")) need("ig_stories", "Instagram Stories");
  if (s.has("threads") && !s.has("fb_feed") && !s.has("ig_feed")) need("fb_feed", "Facebook feed");
  if (s.has("an") && !s.has("fb_feed")) need("fb_feed", "Facebook feed");
  return { set: [...s], added };
}
function bvMigratePlacement(row) {
  if (row.placement_preset && !(row.placements || []).length && !row.place_manual) {
    row.placements = row.placement_preset === "feed_only" ? ["fb_feed", "ig_feed"] : ["fb_feed", "fb_reels", "ig_feed", "ig_reels", "ig_stories"];
    row.place_manual = true; row.placement_preset = "";
  }
}
function bvPlaceSetMode(i, manual) {
  const row = bvAdSetRows[i];
  row.place_manual = manual;
  if (manual && !(row.placements || []).length) row.placements = ["fb_feed", "fb_reels", "ig_feed", "ig_reels"];
  bvRenderAdSetRows();
}
function bvPlaceToggle(i, key, on) {
  const row = bvAdSetRows[i];
  let set = new Set(row.placements || []);
  if (on) set.add(key); else {
    set.delete(key);
    if (key === "fb_feed") ["fb_marketplace", "fb_search", "fb_profile"].forEach(k => set.delete(k));
    if (key === "ig_feed") ["ig_explore", "ig_profile"].forEach(k => set.delete(k));
    if (key === "ig_stories") set.delete("wa_status");
  }
  const r = bvPlaceNeeds(set);
  row.placements = r.set;
  if (!row.placements.length) row.place_manual = false;
  if (on && r.added.length) bvToast(`Also added ${[...new Set(r.added.map(a => a[1]))].join(" and ")} — Meta needs it for that placement.`);
  bvRenderAdSetRows();
}
function bvPlaceApplyPreset(i, keys) { bvAdSetRows[i].placements = [...keys]; bvAdSetRows[i].place_manual = true; bvRenderAdSetRows(); }

function bvPlacementsHtml(row, i, isWa) {
  bvMigratePlacement(row);
  const manual = !!row.place_manual;
  const on = new Set(row.placements || []);
  const blocked = () => false;
  return `
      <div class="field"><label>Where your ad shows</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
          <button type="button" class="bv-preset ${!manual ? "on" : ""}" onclick="bvPlaceSetMode(${i}, false)">✨ Automatic <span style="font-weight:400;">(Meta chooses · broadest)</span></button>
          <button type="button" class="bv-preset ${manual ? "on" : ""}" onclick="bvPlaceSetMode(${i}, true)">☑ Choose placements</button>
        </div>
        ${manual ? `
        <div style="margin-top:8px;">${BV_PLACE_PRESETS.map(([label, keys]) => `<button type="button" class="bv-preset" onclick='bvPlaceApplyPreset(${i}, ${JSON.stringify(keys)})'>${label}</button>`).join("")}</div>
        ${BV_PLACE_GROUPS.map(g => `<div style="margin-top:8px;"><div style="font-size:11.5px;font-weight:700;color:var(--text2);margin-bottom:3px;">${g.title}</div>
          <div class="bv-pgrid">${g.items.map(([k, label]) => `<label class="bv-pcb ${blocked(k) ? "off" : ""}" title="${blocked(k) ? "Meta doesn't offer this for WhatsApp-chat ads" : ""}"><input type="checkbox" ${on.has(k) ? "checked" : ""} ${blocked(k) ? "disabled" : ""} onchange="bvPlaceToggle(${i}, '${k}', this.checked)"> ${label}</label>`).join("")}</div></div>`).join("")}
        ` : `<div style="font-size:11.5px;color:var(--muted);margin-top:6px;">Meta places the ad wherever it gets you the most ${isWa ? "conversations" : "results"} for your budget${isWa ? " (Facebook and Instagram feeds, Reels and search)" : ""}.</div>`}
      </div>`;
}

// ── helpers for the audience/reach below ──
function bvEffectivePlacements(row, isWa) { return row.place_manual && (row.placements || []).length ? row.placements : (isWa ? BV_PLACE_DEFAULT_WA : []); }

// ── WHERE + WHO: states, cities, audience presets, live potential reach ──────
// States/cities become Meta regions/cities; presets and searched interests become Meta
// detailed targeting. Whenever an audience is chosen Advantage+ expansion is off, because
// Meta only treats detailed targeting as a hard filter without expansion.
const BV_NG_STATES = [["Abia"],["Adamawa"],["Akwa Ibom"],["Anambra"],["Bauchi"],["Bayelsa"],["Benue"],["Borno"],["Cross River"],["Delta"],["Ebonyi"],["Edo"],["Ekiti"],["Enugu"],["Abuja (FCT)", "Federal Capital Territory"],["Gombe"],["Imo"],["Jigawa"],["Kaduna"],["Kano"],["Katsina"],["Kebbi"],["Kogi"],["Kwara"],["Lagos"],["Nasarawa"],["Niger"],["Ogun"],["Ondo"],["Osun"],["Oyo"],["Plateau"],["Rivers"],["Sokoto"],["Taraba"],["Yobe"],["Zamfara"]].map(x => ({ label: x[0], value: x[1] || x[0] }));
const bvStateLabel = v => BV_NG_STATES.find(x => x.value === v)?.label || v;
const BV_PRESETS = {
  business: { icon: "💼", label: "Business owners", interests: [{ id: "6002884511422", name: "Small business" }, { id: "6003371567474", name: "Entrepreneurship" }], behaviors: [{ id: "6002714898572", name: "Small business owners" }] },
  students: { icon: "🎓", label: "Students", interests: [{ id: "6003342188930", name: "Student" }], behaviors: [] },
  parents: { icon: "👨‍👩‍👧", label: "Parents", interests: [{ id: "6003232518610", name: "Parenting" }, { id: "6003332764437", name: "Parent" }], behaviors: [] },
  shoppers: { icon: "🛍️", label: "Online shoppers", interests: [{ id: "6003346592981", name: "Online shopping" }], behaviors: [{ id: "6071631541183", name: "Engaged shoppers" }] },
  wellness: { icon: "💪", label: "Health & wellness", interests: [{ id: "6003384248805", name: "Fitness and wellness" }, { id: "6840321905207", name: "Wellness" }], behaviors: [] },
};
const bvStatesOf = row => Array.isArray(row.states) ? row.states : String(row.states || "").split(",").map(s => s.trim()).filter(Boolean);
function bvAudienceOf(row) {
  const ints = new Map(), behs = new Map();
  for (const k of row.presets || []) {
    for (const x of BV_PRESETS[k]?.interests || []) ints.set(x.id, x);
    for (const x of BV_PRESETS[k]?.behaviors || []) behs.set(x.id, x);
  }
  for (const x of row.interests || []) ints.set(x.id, x);
  return { interests: [...ints.values()], behaviors: [...behs.values()] };
}
const bvAudienceCount = row => { const a = bvAudienceOf(row); return a.interests.length + a.behaviors.length; };
function bvAudienceLabel(row) {
  const named = (row.presets || []).map(k => BV_PRESETS[k]?.label).filter(Boolean);
  const extra = (row.interests || []).map(x => x.name);
  return [...named, ...extra].join(" + ");
}
function bvPlacesLabel(row) {
  if (row.geo_type !== "states") return "Nationwide";
  const parts = [...bvStatesOf(row).map(bvStateLabel), ...(row.cities || []).map(c => c.name)];
  return parts.length ? parts.join(", ") : "Nationwide";
}

function bvSetGeoType(i, v) { bvAdSetRows[i].geo_type = v; bvRenderAdSetRows(); }
function bvAddState(i, v) {
  if (!v) return;
  const row = bvAdSetRows[i], cur = bvStatesOf(row);
  if (!cur.includes(v)) row.states = [...cur, v];
  bvRenderAdSetRows();
}
function bvRemoveState(i, v) { const row = bvAdSetRows[i]; row.states = bvStatesOf(row).filter(x => x !== v); bvRenderAdSetRows(); }
function bvAddCity(i, key, name, region) {
  const row = bvAdSetRows[i];
  row.cities = row.cities || [];
  if (!row.cities.some(c => c.key === key)) row.cities.push({ key, name, region });
  bvRenderAdSetRows();
}
function bvRemoveCity(i, key) { const row = bvAdSetRows[i]; row.cities = (row.cities || []).filter(c => c.key !== key); bvRenderAdSetRows(); }
function bvTogglePreset(i, key) {
  const row = bvAdSetRows[i], set = new Set(row.presets || []);
  if (set.has(key)) set.delete(key); else set.add(key);
  row.presets = [...set];
  bvRenderAdSetRows();
}
function bvAddInterest(i, id, name) {
  const row = bvAdSetRows[i];
  row.interests = row.interests || [];
  if (!row.interests.some(x => x.id === id)) row.interests.push({ id, name });
  bvRenderAdSetRows();
}
function bvRemoveInterest(i, id) { const row = bvAdSetRows[i]; row.interests = (row.interests || []).filter(x => x.id !== id); bvRenderAdSetRows(); }

// Search box (city / interest): results fill the list under the input without re-drawing the card.
const bvSearchTimers = new WeakMap();
function bvTargetSearch(input, i, kind) {
  clearTimeout(bvSearchTimers.get(input));
  const box = input.parentElement.querySelector(".bv-res");
  const q = input.value.trim();
  if (q.length < 2) { box.innerHTML = ""; return; }
  bvSearchTimers.set(input, setTimeout(async () => {
    if (!activeAccountId) { box.innerHTML = `<button type="button" disabled>Pick an ad account first</button>`; return; }
    box.innerHTML = `<button type="button" disabled>Searching…</button>`;
    const r = await amCall({ action: "targeting_search", ad_account_id: activeAccountId, kind, q });
    if (input.value.trim() !== q) return;
    if (!r?.ok) { box.innerHTML = `<button type="button" disabled>Couldn't search right now</button>`; return; }
    if (!r.results.length) { box.innerHTML = `<button type="button" disabled>No match</button>`; return; }
    box.innerHTML = r.results.map(x => kind === "city"
      ? `<button type="button" data-k="${escH(x.key)}" data-n="${escH(x.name)}" data-r="${escH(x.region)}" onclick="bvAddCity(${i}, this.dataset.k, this.dataset.n, this.dataset.r)">${escH(x.name)}<small>${escH(x.region)}</small></button>`
      : `<button type="button" data-k="${escH(x.id)}" data-n="${escH(x.name)}" onclick="bvAddInterest(${i}, this.dataset.k, this.dataset.n)">${escH(x.name)}<small>${escH(x.path || "")}${x.size_lower ? ` · ${bvCompact(x.size_lower)}–${bvCompact(x.size_upper)} people` : ""}</small></button>`).join("");
  }, 350));
}

const bvCompact = n => n >= 1e9 ? (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B" : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n);

function bvGeoAudienceHtml(row, i) {
  const chosen = bvStatesOf(row);
  const remaining = BV_NG_STATES.filter(s => !chosen.includes(s.value));
  const specific = row.geo_type === "states";
  const aud = bvAudienceOf(row);
  const customOnly = (row.interests || []).filter(x => !aud.interests.some(y => y.id === x.id && (row.presets || []).some(k => BV_PRESETS[k]?.interests.some(z => z.id === x.id))));
  return `
      <div class="field bv-geo" style="margin-top:8px;"><label>Location</label>
        <select onchange="bvSetGeoType(${i}, this.value)">
          <option value="nationwide" ${!specific ? "selected" : ""}>Nationwide (Nigeria)</option>
          <option value="states" ${specific ? "selected" : ""}>Specific states / cities</option>
        </select>
        ${specific ? `
        <select style="margin-top:6px;" onchange="bvAddState(${i}, this.value)">
          <option value="">+ Add a state…</option>
          ${remaining.map(s => `<option value="${escH(s.value)}">${escH(s.label)}</option>`).join("")}
        </select>
        <div style="position:relative;margin-top:6px;">
          <input placeholder="+ Add a city (Ibadan, Port Harcourt…)" oninput="bvTargetSearch(this, ${i}, 'city')" autocomplete="off">
          <div class="bv-res"></div>
        </div>
        <div>${chosen.map(v => `<span class="bv-chip">${escH(bvStateLabel(v))}<button type="button" onclick="bvRemoveState(${i}, '${escH(v)}')" aria-label="Remove">✕</button></span>`).join("")}${(row.cities || []).map(c => `<span class="bv-chip">📍 ${escH(c.name)}<button type="button" onclick="bvRemoveCity(${i}, '${escH(c.key)}')" aria-label="Remove">✕</button></span>`).join("")}</div>
        ${(row.cities || []).length ? `<div style="margin-top:8px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);">City radius
          <select style="width:auto;" onchange="bvUpdateAdSetRow(${i}, 'city_radius', this.value)">${[10, 17, 25, 40, 80].map(k => `<option value="${k}" ${Number(row.city_radius || 17) === k ? "selected" : ""}>${k} km</option>`).join("")}</select></div>` : ""}
        ${!chosen.length && !(row.cities || []).length ? `<div style="font-size:11.5px;color:var(--muted);margin-top:6px;">Nothing picked yet — this ad set will run nationwide until you add a state or city.</div>` : ""}` : ""}
      </div>

      <div class="field bv-aud" style="margin-top:10px;"><label>Who should see it <span style="font-weight:400;color:var(--muted);">(tap one or more — leave empty for everyone)</span></label>
        <div style="margin-top:4px;">${Object.entries(BV_PRESETS).map(([k, p]) => `<button type="button" class="bv-preset ${(row.presets || []).includes(k) ? "on" : ""}" onclick="bvTogglePreset(${i}, '${k}')">${p.icon} ${p.label}</button>`).join("")}</div>
        <div style="position:relative;margin-top:2px;">
          <input placeholder="+ Search another interest (e.g. Fashion, Real estate…)" oninput="bvTargetSearch(this, ${i}, 'interest')" autocomplete="off">
          <div class="bv-res"></div>
        </div>
        <div>${customOnly.map(x => `<span class="bv-chip">${escH(x.name)}<button type="button" onclick="bvRemoveInterest(${i}, '${escH(x.id)}')" aria-label="Remove">✕</button></span>`).join("")}</div>
      </div>
      <label style="display:flex;align-items:flex-start;gap:7px;margin-top:10px;font-size:12px;font-weight:400;cursor:${bvAudienceCount(row) ? "default" : "pointer"};${bvAudienceCount(row) ? "opacity:.75;" : ""}">
        <input type="checkbox" style="margin-top:2px;" ${row.advantage_audience !== false && !bvAudienceCount(row) ? "checked" : ""} ${bvAudienceCount(row) ? "disabled" : ""} onchange="bvToggleAdSetAdvantage(${i}, this.checked)">
        <span>Let Meta expand this audience automatically (Advantage+)${bvAudienceCount(row) ? `<br><span style="color:var(--muted);">Off while an audience is chosen, so Meta shows the ad only to those people.</span>` : ""}</span>
      </label>
      `;
}

// Live potential reach (Meta's own delivery estimate for exactly this targeting).
const bvReachCache = new Map();
let bvReachTimer = null;
function bvReachPayload(row, baseline = false) {
  const isWa = document.querySelector('input[name="f_destination"]:checked')?.value === "whatsapp";
  const a = bvAudienceOf(row), specific = row.geo_type === "states" && !baseline;
  return {
    states: specific ? bvStatesOf(row) : [],
    cities: specific ? (row.cities || []).map(c => ({ key: c.key, radius: Number(row.city_radius) || 17 })) : [],
    age_min: baseline ? 18 : (Number(row.age_min) || 18), age_max: baseline ? 65 : (Number(row.age_max) || 65), gender: baseline ? "all" : (row.gender || "all"),
    interests: baseline ? [] : a.interests, behaviors: baseline ? [] : a.behaviors,
    placements: bvEffectivePlacements(row, isWa), devices: row.device_platforms?.length ? row.device_platforms : ["mobile"],
    optimization_goal: isWa ? "CONVERSATIONS" : (row.optimization_goal || "OFFSITE_CONVERSIONS"),
  };
}
function bvReachText(r, base) {
  if (!r) return `<span style="color:var(--muted);"><span class="spin"></span> Updating potential reach…</span>`;
  if (!r.ok) return `<span style="color:var(--muted);">Potential reach isn't available right now.</span>`;
  if (!r.ready || r.lower == null) return `<span style="color:var(--muted);">Meta is still calculating — change a setting or wait a moment.</span>`;
  const mid = (r.lower + r.upper) / 2, bmid = base?.ok && base.lower != null ? (base.lower + base.upper) / 2 : null;
  const share = bmid ? Math.min(100, Math.round(mid / bmid * 100)) : null;
  return `Potential reach: <b>${bvCompact(r.lower)}–${bvCompact(r.upper)} people</b>${share != null && share < 100 ? ` · about ${share}% of everyone in Nigeria on these placements` : ""}<small>Meta's estimate for this ad set's age, gender, places, audience and placements. It changes as you change them — not a promise of results.</small>`;
}
function bvReachHtml(row) {
  if (!activeAccountId) return "";
  return bvReachText(bvReachCache.get(JSON.stringify(bvReachPayload(row))), bvReachCache.get(JSON.stringify(bvReachPayload(row, true))));
}
function bvScheduleReach() { clearTimeout(bvReachTimer); bvReachTimer = setTimeout(bvRunReach, 500); }
async function bvRunReach() {
  if (!activeAccountId) return;
  const paint = () => document.querySelectorAll(".bv-reach").forEach(el => {
    const rw = bvAdSetRows.find(x => x.uid === el.dataset.uid);
    if (rw) el.innerHTML = bvReachHtml(rw);
  });
  paint();
  const todo = new Map();
  for (const row of bvAdSetRows) for (const base of [false, true]) { const p = bvReachPayload(row, base); const k = JSON.stringify(p); if (!bvReachCache.has(k)) todo.set(k, p); }
  await Promise.all([...todo].map(async ([k, p]) => {
    const r = await amCall({ action: "reach_estimate", ad_account_id: activeAccountId, ...p });
    bvReachCache.set(k, r?.ok ? r : { ok: false });
    paint();
  }));
}

// Only a Sales ad to a website lets you choose what Meta optimises for. Every other goal / destination has one
// correct setting that Meta (and the launch code) fixes, so say that instead of showing a dropdown that is ignored.
function bvFixedOptimizationLabel(isWhatsappDest) {
  const dest = document.querySelector('input[name="f_destination"]:checked')?.value || "whatsapp";
  const obj = document.getElementById("f_objective")?.value;
  if (isWhatsappDest) return "Conversations (fixed for WhatsApp ads)";
  if (dest === "form") return "Lead form submissions (fixed for instant forms)";
  if (dest === "messenger" || dest === "instagram") return "Conversations (fixed for chat ads)";
  if (obj === "OUTCOME_TRAFFIC") return "Link clicks (fixed for Traffic)";
  if (obj === "OUTCOME_ENGAGEMENT") return "Post engagement (fixed for Engagement)";
  if (obj === "OUTCOME_AWARENESS") return "Reach (fixed for Awareness)";
  if (obj === "OUTCOME_LEADS") return "Conversions (fixed for Leads)";
  return "";
}
function bvAdSetCardHtml(row, i, isWhatsappDest, inModal = false) {
  return `
    <div class="bv-section-card ms-split" data-ms="who budget adv">
      <div class="bv-section-card-title" style="justify-content:space-between;margin-bottom:10px;">
        <span><span class="bv-ico">▦</span> <span data-astitle="${i}">${escH(bvAdSetName(row))}</span>${i === 0 ? " (original)" : " (copy)"}</span>
        ${i > 0 && !inModal ? `<button type="button" onclick="bvRemoveAdSetRow(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:12px;font-weight:400;">✕ Remove</button>` : ""}
      </div>
      <div class="field" data-ms="who" style="margin-bottom:14px;"><label>Ad set name <span style="font-weight:400;color:var(--muted);">(shown on Meta exactly as you type it)</span></label>
        <input value="${escH(row.display_name || "")}" maxlength="120" placeholder="${escH(row.label)} — type your own name" oninput="bvSetAdSetName(${i}, this.value)">
      </div>

      <div data-ms="budget" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--text2);margin-bottom:8px;">Budget</div>
      <div class="fg" data-ms="budget">
        <div class="field"><label>Daily budget (₦)</label><input type="number" min="100" step="100" value="${row.budget_naira}" onchange="bvUpdateAdSetRow(${i}, 'budget_naira', this.value)"></div>
      </div>

      <div data-ms="who" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--text2);margin:14px 0 8px;">Audience</div>
      <div class="fg" data-ms="who">
        <div class="field"><label>Gender</label>
          <select onchange="bvUpdateAdSetRow(${i}, 'gender', this.value)">
            <option value="all" ${row.gender === "all" ? "selected" : ""}>All</option>
            <option value="male" ${row.gender === "male" ? "selected" : ""}>Male only</option>
            <option value="female" ${row.gender === "female" ? "selected" : ""}>Female only</option>
          </select>
        </div>
        <div class="field"><label>Age min</label><input type="number" min="13" max="65" value="${row.age_min}" onchange="bvUpdateAdSetRow(${i}, 'age_min', this.value)"></div>
        <div class="field"><label>Age max</label><input type="number" min="13" max="65" value="${row.age_max}" onchange="bvUpdateAdSetRow(${i}, 'age_max', this.value)"></div>
      </div>
      <div data-ms="who">${bvGeoAudienceHtml(row, i)}</div>

      <div data-ms="adv" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--text2);margin:14px 0 8px;">Placements</div>
      <div data-ms="adv">${bvPlacementsHtml(row, i, isWhatsappDest)}</div>
      <div class="field" data-ms="adv" style="margin-top:8px;"><label>Devices</label>
        <div style="display:flex;gap:14px;margin-top:4px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:400;cursor:pointer;">
            <input type="checkbox" ${!row.device_platforms?.length || row.device_platforms.includes("mobile") ? "checked" : ""} onchange="bvToggleAdSetDevice(${i}, 'mobile', this.checked)"> Mobile
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:400;cursor:pointer;">
            <input type="checkbox" ${row.device_platforms?.includes("desktop") ? "checked" : ""} onchange="bvToggleAdSetDevice(${i}, 'desktop', this.checked)"> Desktop
          </label>
        </div>
      </div>

      <div class="bv-reach" data-ms="who budget" data-uid="${row.uid}">${bvReachHtml(row)}</div>

      <div data-ms="adv" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--text2);margin:14px 0 8px;">Optimization & bidding</div>
      <div class="field" data-ms="adv"><label>Optimization goal <span style="font-weight:400;color:var(--muted);">(what Meta tries to get you the most of)</span></label>
        ${bvFixedOptimizationLabel(isWhatsappDest)
          ? `<input value="${escH(bvFixedOptimizationLabel(isWhatsappDest))}" disabled style="color:var(--muted);">`
          : `<select onchange="bvUpdateAdSetRow(${i}, 'optimization_goal', this.value)">
              <option value="OFFSITE_CONVERSIONS" ${row.optimization_goal === "OFFSITE_CONVERSIONS" || !row.optimization_goal ? "selected" : ""}>Conversions (recommended)</option>
              <option value="LINK_CLICKS" ${row.optimization_goal === "LINK_CLICKS" ? "selected" : ""}>Link clicks</option>
              <option value="LANDING_PAGE_VIEWS" ${row.optimization_goal === "LANDING_PAGE_VIEWS" ? "selected" : ""}>Landing page views</option>
            </select>`}
      </div>
      <div class="fg" data-ms="adv" style="margin-top:8px;">
        <div class="field"><label>Bid strategy</label>
          <select onchange="bvUpdateAdSetRow(${i}, 'bid_strategy', this.value)">
            <option value="LOWEST_COST_WITHOUT_CAP" ${row.bid_strategy === "LOWEST_COST_WITHOUT_CAP" ? "selected" : ""}>Lowest cost (no cap) — recommended</option>
            <option value="LOWEST_COST_WITH_BID_CAP" ${row.bid_strategy === "LOWEST_COST_WITH_BID_CAP" ? "selected" : ""}>Lowest cost with bid cap</option>
            <option value="COST_CAP" ${row.bid_strategy === "COST_CAP" ? "selected" : ""}>Cost cap</option>
          </select>
        </div>
        <div class="field"><label>Billing event</label>
          <select onchange="bvUpdateAdSetRow(${i}, 'billing_event', this.value)">
            <option value="IMPRESSIONS" ${row.billing_event === "IMPRESSIONS" ? "selected" : ""}>Impressions</option>
            <option value="LINK_CLICKS" ${row.billing_event === "LINK_CLICKS" ? "selected" : ""}>Link clicks</option>
          </select>
        </div>
      </div>
      ${row.bid_strategy && row.bid_strategy !== "LOWEST_COST_WITHOUT_CAP" ? `
      <div class="field" data-ms="adv" style="margin-top:8px;"><label>Bid amount (₦) <span style="font-weight:400;color:var(--muted);">(max you'll pay per optimization event)</span></label>
        <input type="number" min="1" step="1" value="${row.bid_amount_naira || ""}" placeholder="e.g. 500" onchange="bvUpdateAdSetRow(${i}, 'bid_amount_naira', this.value)">
      </div>` : ""}
    </div>
  `;
}

function bvRenderAdSetRows() {
  const wrap = document.getElementById("adSetRows");
  if (!wrap) return;
  const totalBudget = bvAdSetRows.reduce((s, r) => s + (Number(r.budget_naira) || 0), 0);
  // Optimization goal is a real choice for a website-destination ad; WhatsApp
  // ads are always optimized for CONVERSATIONS -- Meta requires that for
  // Click-to-WhatsApp under Sales, not something ai-auto-launch-tests can
  // override no matter what's picked here (see its own comment on this).
  const isWhatsappDest = document.querySelector('input[name="f_destination"]:checked')?.value === "whatsapp";

  // WhatsApp ads are always Sales/Conversations under the hood (a real Meta
  // requirement for Click-to-WhatsApp) no matter what's picked in the
  // objective select -- lock it visibly instead of letting the user choose
  // something ai-auto-launch-tests will silently override.
  const objSelect = document.getElementById("f_objective");
  const objNote = document.getElementById("f_objectiveNote");
  const destNow = document.querySelector('input[name="f_destination"]:checked')?.value || "whatsapp";
  if (objSelect) {
    objSelect.disabled = isWhatsappDest || destNow === "form";
    if (isWhatsappDest) objSelect.value = "OUTCOME_SALES";
    if (destNow === "form") objSelect.value = "OUTCOME_LEADS";
    // Messenger / Instagram chats can only be Sales, Leads or Engagement.
    const chatOnly = destNow === "messenger" || destNow === "instagram";
    for (const o of objSelect.options) o.hidden = chatOnly && !["OUTCOME_SALES", "OUTCOME_LEADS", "OUTCOME_ENGAGEMENT"].includes(o.value);
    if (chatOnly && ["OUTCOME_TRAFFIC", "OUTCOME_AWARENESS"].includes(objSelect.value)) objSelect.value = "OUTCOME_SALES";
  }
  if (objNote) {
    objNote.textContent = isWhatsappDest
      ? "WhatsApp ads are always Sales/Conversations — Meta requires this for Click-to-WhatsApp."
      : destNow === "form" ? "Instant form ads are always Leads: people fill a form without leaving Facebook or Instagram."
      : (destNow === "messenger" || destNow === "instagram") ? "Chat ads can be Sales, Leads or Engagement." : "";
  }

  wrap.innerHTML = bvAdSetRows.map((row, i) => bvAdSetCardHtml(row, i, isWhatsappDest)).join("") + `
    <div data-ms="who budget adv" style="margin-top:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <button type="button" class="btn btn-g" style="width:auto;padding:6px 12px;font-size:12px;" onclick="bvOpenDuplicateAdSetModal()">⧉ Duplicate ad set…</button>
      <button type="button" class="btn btn-g" style="width:auto;padding:6px 12px;font-size:12px;" onclick="bvOpenAdSetListModal()">☰ View all ad sets (${bvAdSetRows.length})</button>
      <span style="font-size:11px;color:var(--muted);">${bvAdSetRows.length} ad set${bvAdSetRows.length === 1 ? "" : "s"} will launch • ₦${totalBudget.toLocaleString()}/day total</span>
    </div>`;
  bvRenderBuilderSummary();
  bvRefreshAdSetEdit();
  bvRefreshAdSetList();
  bvRenderAdTabs();
  bvScheduleReach();
  bvDraftSoon();
}