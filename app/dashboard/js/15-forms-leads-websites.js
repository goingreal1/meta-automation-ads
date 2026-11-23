// Revora dashboard, part 15 of 23: TAB: ORDER FORMS · TAB: WEBSITE LEADS (10s modal captures on product sales pages) · TAB: WEBSITES (sites built in the drag-and-drop builder + HFCM-style tracking codes)

// ── TAB: ORDER FORMS ──────────────────────────────────────────────────────────
let formsSelectedProduct = null;
let formsSelectedBuyer = "";

async function renderForms(el) {
  const [prods, buyers] = await Promise.all([
    sbQuery("products", "select=id,product_name,default_order_value_naira,currency,is_active&order=product_name.asc"),
    sbQuery("media_buyers", "select=id,code,name&order=code.asc"),
  ]);
  if (!formsSelectedProduct && prods?.length) formsSelectedProduct = prods[0].id;
  const product = prods?.find(p => p.id === formsSelectedProduct);

  // A buyer only ever builds links for themselves -- the picker that lets
  // anyone tag any buyer's code is an owner/admin-only tool (e.g. building a
  // link on a buyer's behalf, or leaving it unattributed). Without this, a
  // buyer could generate a link carrying a teammate's code and claim their
  // orders/ROAS instead of their own.
  const isAdmin = window.myProfile?.role === "owner" || window.myProfile?.role === "admin";
  const myBuyer = (buyers || []).find(b => b.id === window.myProfile?.media_buyer_id);
  if (!isAdmin) formsSelectedBuyer = myBuyer?.id || "";

  // The link's buyer param is the buyer's own id (already an opaque UUID,
  // not something to guess or type) -- not the short [CODE] used for ad set
  // naming. receive-order looks the order up by this id directly, so a
  // customer landing via Moses's link always lands as Moses's order with no
  // separate attribution step for anyone to get wrong.
  const baseUrl = location.origin + location.pathname.replace(/[^/]*$/, "") + "order.html";
  const link = product ? `${baseUrl}?product=${product.id}${formsSelectedBuyer ? `&buyer=${encodeURIComponent(formsSelectedBuyer)}` : ""}` : "";
  const embedSnippet = product ? `<iframe src="${link}" style="width:100%;max-width:480px;height:720px;border:0;" title="${escH(product.product_name)} order form"></iframe>` : "";

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Order Forms</div></div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Why one shared form</div></div>
      <div style="font-size:12px;color:var(--text2);line-height:1.6;">
        Every buyer uses the same fast, no-friction order form for every product — no separate checkout page to design or host per campaign. It shows the product, collects delivery details, and creates a real order here immediately. Point your ad or WordPress "Order Now" button at the link below; keeping the path from ad click to order short is a big part of what keeps cost per result down.
      </div>
    </div>

    ${!prods?.length ? `<div class="panel"><div class="empty"><div class="empty-ico">📦</div>No products yet — add one in Products first.</div></div>` : `
    <div class="panel">
      <div class="ph"><div class="ph-title">Build your link</div></div>
      <div class="fg">
        <div class="field"><label>Product / package</label>
          <select id="formsProdSel">
            ${prods.map(p => `<option value="${p.id}" ${p.id === formsSelectedProduct ? "selected" : ""}>${escH(p.product_name)} — ${fN(p.default_order_value_naira)}${p.is_active ? "" : " (inactive)"}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Attribute orders to</label>
          ${isAdmin ? `
          <select id="formsBuyerSel">
            <option value="">No buyer (unattributed)</option>
            ${(buyers || []).map(b => `<option value="${escH(b.id)}" ${b.id === formsSelectedBuyer ? "selected" : ""}>${escH(b.name)}</option>`).join("")}
          </select>` : `
          <input value="${myBuyer ? escH(myBuyer.name) : "Not linked to a media buyer -- ask your admin"}" disabled style="opacity:.75;">`}
        </div>
      </div>

      <div class="field" style="margin-top:12px;"><label>Direct link — use as your ad's website URL or "Order Now" button</label>
        <div style="display:flex;gap:8px;">
          <input id="formsLink" readonly value="${escH(link)}" style="flex:1;">
          <button type="button" class="btn btn-a formsCopyBtn" data-target="formsLink" style="white-space:nowrap;">Copy</button>
        </div>
      </div>

      <div class="field" style="margin-top:12px;"><label>WordPress embed — paste into a page/post's HTML block to show the form inline instead of linking out</label>
        <div style="display:flex;gap:8px;align-items:flex-start;">
          <textarea id="formsEmbed" readonly rows="2" style="flex:1;font-family:'JetBrains Mono',monospace;font-size:11px;">${escH(embedSnippet)}</textarea>
          <button type="button" class="btn btn-a formsCopyBtn" data-target="formsEmbed" style="white-space:nowrap;">Copy</button>
        </div>
      </div>
      <div id="formsCopyMsg" style="font-size:11px;color:var(--muted);margin-top:6px;"></div>
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">Live preview</div><div class="ph-count">What the customer sees</div></div>
      <div style="display:flex;justify-content:center;background:var(--panel2);border-radius:10px;padding:16px;">
        <iframe src="${link}" style="width:100%;max-width:420px;height:640px;border:1px solid var(--border);border-radius:10px;background:#fff;"></iframe>
      </div>
    </div>`}`;

  document.getElementById("formsProdSel")?.addEventListener("change", e => { formsSelectedProduct = e.target.value; renderForms(el); });
  document.getElementById("formsBuyerSel")?.addEventListener("change", e => { formsSelectedBuyer = e.target.value; renderForms(el); });
  document.querySelectorAll(".formsCopyBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const input = document.getElementById(btn.dataset.target);
      try {
        await navigator.clipboard.writeText(input.value);
        document.getElementById("formsCopyMsg").textContent = "Copied.";
      } catch {
        input.select();
        document.getElementById("formsCopyMsg").textContent = "Couldn't auto-copy — text is selected, use Ctrl/Cmd+C.";
      }
      setTimeout(() => { const m = document.getElementById("formsCopyMsg"); if (m) m.textContent = ""; }, 2000);
    });
  });
}

// ── TAB: WEBSITE LEADS (10s modal captures on product sales pages) ─────────────
// Populated by the public submit-website-lead edge function -- built for the
// Lunessa page's "want us to reach out" drawer, which sends name/phone/
// address/city/state/package here instead of the full CRM form. Reusable for
// any other product's page that wires up the same modal.
async function renderWebsiteLeads(el) {
  const leads = await sbQuery("website_leads", "select=*&order=created_at.desc&limit=200");
  const all = leads || [];

  const tot = all.length;
  const nw = all.filter(l => l.status === "new").length;
  const contacted = all.filter(l => l.status === "contacted").length;
  const converted = all.filter(l => l.status === "converted").length;

  el.innerHTML = `
    <div class="sh"><div class="sh-title">Website Leads</div><div class="sh-actions"><button class="btn btn-g" onclick="render()">↺ Refresh</button></div></div>

    <div class="g4">
      <div class="kc"><div class="kc-lbl">Total</div><div class="kc-val">${tot}</div></div>
      <div class="kc"><div class="kc-lbl">New</div><div class="kc-val b">${nw}</div></div>
      <div class="kc"><div class="kc-lbl">Contacted</div><div class="kc-val w">${contacted}</div></div>
      <div class="kc"><div class="kc-lbl">Converted</div><div class="kc-val a">${converted}</div></div>
    </div>

    <div class="panel">
      <div class="ph"><div class="ph-title">All leads</div><div class="ph-count">${tot}</div></div>
      ${!tot ? `<div class="empty"><div class="empty-ico">📝</div>No website leads yet.</div>` : `
      <div class="tbl-wrap"><table>
        <tr><th>Name</th><th>Phone</th><th>Product</th><th>Package</th><th>Address</th><th>Submitted</th><th>Status</th></tr>
        ${all.map(l => `<tr>
          <td class="s n">${bvEscape(l.name ?? "—")}</td>
          <td class="n">${l.phone
            ? `<a href="#" data-chat-phone="${bvEscape(l.phone)}" data-chat-name="${bvEscape(l.name || "")}" onclick="return bvOpenChatBtn(this)" style="color:var(--accent);text-decoration:none;display:flex;align-items:center;gap:4px;">${icon("phone",12)} ${bvEscape(l.phone)}</a>`
            : "—"}</td>
          <td class="n">${bvEscape(l.product_name ?? "—")}</td>
          <td class="n">${bvEscape(l.package ?? "—")}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${bvEscape([l.address, l.city, l.state].filter(Boolean).join(", "))}">${bvEscape([l.address, l.city, l.state].filter(Boolean).join(", ")) || "—"}</td>
          <td>${ago(l.created_at)}</td>
          <td>
            <select data-lid="${l.id}" class="leadSel" style="padding:3px 7px;font-size:11px;width:auto;">
              <option value="new"       ${l.status==="new"       ?"selected":""}>New</option>
              <option value="contacted" ${l.status==="contacted" ?"selected":""}>Contacted</option>
              <option value="converted" ${l.status==="converted" ?"selected":""}>Converted</option>
              <option value="lost"      ${l.status==="lost"      ?"selected":""}>Lost</option>
            </select>
          </td>
        </tr>`).join("")}
      </table></div>`}
    </div>`;

  document.querySelectorAll(".leadSel").forEach(sel => {
    sel.addEventListener("change", async e => {
      const id = e.target.dataset.lid;
      const ns = e.target.value;
      try {
        const { error } = await supabaseClient.from('website_leads').update({ status: ns }).eq('id', id);
        if (error) throw error;
      } catch(err) { alert("Update failed: " + err.message); }
    });
  });
}

// ── TAB: WEBSITES (sites built in the drag-and-drop builder + HFCM-style tracking codes) ─────────
// Every order placed on a built site goes through receive-order, so it lands in the Orders tab
// (tagged with its site) - not in Website Leads.
let bvWebSub = "sites";
let bvWebData = { sites: [], pages: [], snippets: [], orders: [], products: [], domains: [] };

async function renderWebsites(el) {
  const [sites, pages, snippets, orders, products, domains] = await Promise.all([
    sbQuery("sites", "select=*&order=created_at.desc", { allAccounts: true }),
    sbQuery("site_pages", "select=id,site_id,title,slug,kind,published_at,updated_at&order=created_at.asc"),
    sbQuery("tracking_snippets", "select=*&order=created_at.desc"),
    sbQuery("orders", "select=site_id,order_value_naira,order_status&site_id=not.is.null&limit=5000"),
    sbQuery("products", "select=id,product_name,is_service&is_active=eq.true&order=product_name", { allAccounts: true }),
    sbQuery("site_domains", "select=id,hostname,site_id,status&order=created_at.asc").catch(() => []),
  ]);
  bvWebData = { sites: sites || [], pages: pages || [], snippets: snippets || [], orders: orders || [], products: products || [], domains: domains || [] };
  bvWebDraw(el);
}

function bvWebDraw(el) {
  const host = el || document.getElementById("mainContent");
  if (!host) return;
  host.innerHTML = `
    <div class="sh"><div class="sh-title">Websites</div><div class="sh-actions">
      ${bvWebSub === "sites" ? `<button class="btn btn-a" onclick="bvWebNew()">+ New website</button>` : `<button class="btn btn-a" onclick="bvWebSnippet()">+ Add tracking code</button>`}
    </div></div>
    <div class="ws-sub"><button class="${bvWebSub === "sites" ? "on" : ""}" onclick="bvWebSwitch('sites')">My websites</button><button class="${bvWebSub === "codes" ? "on" : ""}" onclick="bvWebSwitch('codes')">Tracking codes</button></div>
    <div id="wsBody">${bvWebSub === "sites" ? bvWebSitesHtml() : bvWebCodesHtml()}</div>`;
  bvWebHost = host;
}
let bvWebHost = null;
function bvWebSwitch(t) { bvWebSub = t; bvWebDraw(bvWebHost); }
async function bvWebReload() { await renderWebsites(bvWebHost); }

function bvWebSitesHtml() {
  const { sites, pages, orders, products, domains } = bvWebData;
  if (!sites.length) return `<div class="panel"><div class="empty"><div class="empty-ico">🌐</div>
    <div style="font-weight:700;font-size:15px;margin-bottom:6px;">Build your first sales website</div>
    <div style="max-width:420px;margin:0 auto 14px;">Drag-and-drop pages with a built-in order form. Every order lands in your Orders tab, and your Meta pixel is already connected.</div>
    <button class="btn btn-a" style="width:auto;" onclick="bvWebNew()">+ New website</button></div></div>`;
  return `<div class="ws-grid">${sites.map(s => {
    const mine = pages.filter(p => p.site_id === s.id);
    const live = mine.filter(p => p.published_at).length;
    const so = orders.filter(o => o.site_id === s.id);
    const rev = so.reduce((a, o) => a + (Number(o.order_value_naira) || 0), 0);
    const prod = products.find(p => p.id === s.product_id);
    // A live custom domain assigned to this site is its main address.
    const dom = (domains || []).find(d => d.site_id === s.id && d.status === "active");
    const url = dom ? "https://" + dom.hostname : window.RV_siteUrl(s.slug);
    return `<div class="ws-card">
      <div class="ws-top"><div class="ws-name">${escH(s.name)}</div><span class="ws-pill ${s.status === "published" ? "live" : ""}">${s.status === "published" ? "Live" : "Draft"}</span></div>
      <div class="ws-url">${escH(url)}</div>
      <div class="ws-meta"><span><b>${mine.length}</b> page${mine.length === 1 ? "" : "s"}${live ? ` (${live} live)` : ""}</span><span><b>${so.length}</b> order${so.length === 1 ? "" : "s"}</span><span><b>${fN(rev)}</b></span></div>
      <div class="ws-meta"><span>${prod ? "Sells: <b>" + escH(prod.product_name) + "</b>" : "⚠️ No product selected yet"}</span></div>
      <div class="ws-act">
        <button class="btn btn-a" onclick="bvWebEdit('${s.id}')">Edit</button>
        <button class="btn btn-g" onclick="location.href='/ide.html?site=${s.id}'" title="Open the file editor">IDE</button>
        ${s.status === "published" ? `<a class="btn btn-g" href="${escH(url)}" target="_blank" rel="noopener" style="text-decoration:none;">View</a>` : ""}
        <button class="btn btn-g" onclick="bvWebLinks('${s.id}')" title="Links to every page, on your domain or ours">🔗 Links</button>
        <button class="btn btn-g" onclick="bvWebAdvertise('${s.id}')" title="Run Meta ads that send people to this site">📣 Advertise</button>
        <button class="btn btn-g" onclick="bvWebDelete('${s.id}')" title="Delete">🗑</button>
      </div></div>`;
  }).join("")}</div>`;
}

// Links to every page of a site, on the platform address or any of the company's domains.
let bvLinkKey = "";
function bvWebLinkUrl(site, slug, domId) {
  const d = domId ? (bvWebData.domains || []).find(x => x.id === domId) : null;
  if (!d) return window.RV_siteUrl(site.slug, slug);
  if (d.site_id === site.id) return "https://" + d.hostname + (slug ? "/" + slug : "");
  return "https://" + d.hostname + "/s/" + site.slug + (slug ? "/" + slug : "");
}
function bvWebLinks(id, keepKey) {
  const s = bvWebData.sites.find(x => x.id === id); if (!s) return;
  const doms = bvWebData.domains || [];
  if (!keepKey) bvLinkKey = (doms.find(d => d.site_id === s.id && d.status === "active") || {}).id || "";
  const d = doms.find(x => x.id === bvLinkKey);
  const pgs = bvWebData.pages.filter(p => p.site_id === s.id).sort((a, b) => (a.slug === "" ? -1 : b.slug === "" ? 1 : 0));
  const body = `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('bvWebOverlay')">✕</button>
    <div class="ph-title" style="margin-bottom:4px;">${escH(s.name)} · links</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Copy the link of any page. Pick an address first: ours, or one of your own domains.</div>
    <div class="ws-field"><label>Address</label><select id="wlAddr" onchange="bvLinkKey=this.value;bvWebLinks('${s.id}',true)">
      <option value="">${escH((window.RV_SITE_ORIGIN || location.origin).replace(/^https?:\/\//, ""))} (platform address)</option>
      ${doms.map(x => `<option value="${x.id}" ${x.id === bvLinkKey ? "selected" : ""}>${escH(x.hostname)}${x.status === "active" ? "" : " (not live yet)"}${x.site_id === s.id ? " — main site" : ""}</option>`).join("")}
    </select></div>
    ${!doms.length ? `<div style="font-size:11.5px;color:var(--muted);margin:-4px 0 10px;">No domain connected yet. Add one in <a href="javascript:void(0)" onclick="bvCloseSheet('bvWebOverlay');bvSetupGo('settings','domains')" style="color:var(--accent);">Settings → Domains</a>.</div>` : ""}
    ${d && d.status !== "active" ? `<div class="msg err" style="display:block;margin-bottom:10px;">This domain isn't live yet. Finish its DNS record in Settings → Domains and press Check.</div>` : ""}
    ${d && d.site_id !== s.id ? `<div style="margin-bottom:12px;"><button class="btn btn-a" id="wlMain" style="width:auto;" onclick="bvWebMakeMain('${s.id}','${d.id}')">Make this the main site on ${escH(d.hostname)}</button>
      <div style="font-size:11.5px;color:var(--muted);margin-top:4px;">${d.site_id ? "Another site is the main one there now. " : ""}Until then this site opens at ${escH(d.hostname)}/s/${escH(s.slug)}.</div></div>` : ""}
    ${d && d.site_id === s.id ? `<div style="color:var(--accent);font-size:12px;margin-bottom:10px;">✓ ${escH(d.hostname)} opens this site at its root.</div>` : ""}
    ${pgs.map(p => { const u = bvWebLinkUrl(s, p.slug, bvLinkKey); return `<div style="margin-bottom:10px;">
      <div style="font-size:12.5px;font-weight:700;">${escH(p.title)}${p.kind === "thanks" ? " · thank-you" : ""} ${p.published_at ? "" : `<span style="color:var(--warn);font-weight:500;">(draft: publish to open)</span>`}</div>
      <div style="display:flex;gap:6px;margin-top:3px;"><input readonly value="${escH(u)}" style="flex:1;min-width:0;" onclick="this.select()"><button class="btn btn-g" style="width:auto;" onclick="bvWebCopy('${escH(u)}')">Copy</button>${p.published_at ? `<a class="btn btn-g" style="width:auto;text-decoration:none;" href="${escH(u)}" target="_blank" rel="noopener">Open</a>` : ""}</div></div>`; }).join("")}`;
  bvOpenSheet("bvWebOverlay", body, 520);
}
async function bvWebMakeMain(siteId, domId) {
  const btn = document.getElementById("wlMain"); if (btn) btn.disabled = true;
  const r = await sbFn("manage-domain", { action: "assign", id: domId, site_id: siteId });
  if (r.error) { bvToast(r.error, "err"); if (btn) btn.disabled = false; return; }
  const d = bvWebData.domains.find(x => x.id === domId); if (d) d.site_id = siteId;
  bvToast("Done. The domain now opens this site."); bvWebLinks(siteId, true); bvWebDraw(bvWebHost);
}
function bvWebCopy(t) { try { navigator.clipboard.writeText(t); bvToast("Link copied"); } catch (e) { prompt("Copy this link", t); } }
async function bvWebAdvertise(id) {
  const s = bvWebData.sites.find(x => x.id === id); if (!s) return;
  if (!s.product_id) return bvToast("Choose the product this site sells first (open the builder → Settings).", "err");
  if (s.status !== "published") return bvToast("Publish the site first, then you can advertise it.", "err");
  const url = window.RV_siteUrl(s.slug);
  if (!confirm(`Send ad traffic to this site?\n\nNew website-purchase ads for this product will open:\n${url}\n\nThen you launch the ad from the Campaigns tab as usual.`)) return;
  const { error } = await supabaseClient.from("products").update({ landing_page_url: url, destination_type: "website" }).eq("id", s.product_id);
  if (error) return bvToast("Couldn't set the landing page: " + error.message, "err");
  bvToast("Landing page set. Opening Campaigns…");
  setTimeout(() => document.querySelector('[data-tab="campaigns"]')?.click(), 600);
}
function bvWebEdit(id) { location.href = "/builder.html?site=" + id; }

function bvWebSlugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38); }
function bvWebNew() {
  const prods = bvWebData.products;
  bvOpenSheet("bvWebOverlay", `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('bvWebOverlay')">✕</button>
    <div class="ph-title" style="margin-bottom:12px;">New website</div>
    <div class="ws-field"><label>Website name</label><input id="wsName" placeholder="e.g. Herbal Tea Store" oninput="document.getElementById('wsSlug').value=bvWebSlugify(this.value);bvWebSlugHint()"></div>
    <div class="ws-field"><label>Put it on</label><select id="wsDom" onchange="bvWebDomChange()">
      <option value="">${escH((window.RV_SITE_ORIGIN || location.origin).replace(/^https?:\/\//, ""))} (platform address)</option>
      ${(bvWebData.domains || []).map(d => `<option value="${d.id}">${escH(d.hostname)}${d.status === "active" ? "" : " (not live yet)"}</option>`).join("")}
    </select>${(bvWebData.domains || []).length ? "" : `<small>Connect your own domain in Settings → Domains, then pick it here.</small>`}</div>
    <div class="ws-field"><label>Address</label><div style="display:flex;align-items:center;gap:6px;"><span id="wsPrefix" style="color:var(--muted);font-size:12.5px;white-space:nowrap;">${escH((window.RV_SITE_ORIGIN || location.origin).replace(/^https?:\/\//, ""))}/s/</span><input id="wsSlug" placeholder="herbal-tea" oninput="bvWebSlugHint()"></div><small id="wsSlugHint">Lowercase letters, numbers and dashes.</small>
      <label id="wsMainRow" style="display:none;margin-top:8px;font-size:12.5px;align-items:center;gap:6px;"><input type="checkbox" id="wsMain" style="width:auto;" onchange="bvWebSlugHint()"> <span id="wsMainTxt"></span></label></div>
    <div class="ws-field"><label>Product it sells</label><select id="wsProduct"><option value="">Choose later</option>${prods.map(p => `<option value="${p.id}">${escH(p.product_name)}${p.is_service ? " (service)" : ""}</option>`).join("")}</select><small>Its price, packages and bank details power the built-in order form.</small></div>
    <div id="wsErr"></div>
    <button class="btn btn-a" id="wsCreate" onclick="bvWebCreate()">Create &amp; open builder</button>`, 480);
}
function bvWebDomChange() {
  const id = document.getElementById("wsDom").value, d = (bvWebData.domains || []).find(x => x.id === id);
  document.getElementById("wsPrefix").textContent = d ? d.hostname + "/s/" : (window.RV_SITE_ORIGIN || location.origin).replace(/^https?:\/\//, "") + "/s/";
  const row = document.getElementById("wsMainRow");
  row.style.display = d ? "flex" : "none";
  if (d) {
    document.getElementById("wsMain").checked = !d.site_id;
    document.getElementById("wsMainTxt").textContent = d.site_id ? `Make it the main site on ${d.hostname} (replaces the current main site)` : `Make it the main site: ${d.hostname} opens it directly`;
  }
  bvWebSlugHint();
}
function bvWebSlugHint() {
  const v = document.getElementById("wsSlug").value, h = document.getElementById("wsSlugHint");
  if (!h) return;
  if (!v) { h.textContent = "Lowercase letters, numbers and dashes."; return; }
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(v)) { h.textContent = "Use 2–40 lowercase letters, numbers or dashes."; return; }
  const d = (bvWebData.domains || []).find(x => x.id === document.getElementById("wsDom")?.value);
  const main = d && document.getElementById("wsMain")?.checked;
  h.textContent = "Your site will be at " + (d ? (main ? d.hostname : d.hostname + "/s/" + v) : window.RV_siteUrl(v).replace(/^https?:\/\//, ""));
}
async function bvWebCreate() {
  const name = document.getElementById("wsName").value.trim();
  const slug = bvWebSlugify(document.getElementById("wsSlug").value);
  const product_id = document.getElementById("wsProduct").value || null;
  const err = document.getElementById("wsErr"), btn = document.getElementById("wsCreate");
  if (!name) { err.innerHTML = `<div class="msg err">Give your website a name.</div>`; return; }
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) { err.innerHTML = `<div class="msg err">Pick an address of 2–40 letters, numbers or dashes.</div>`; return; }
  btn.disabled = true; btn.textContent = "Creating…"; err.innerHTML = "";
  try {
    const ac = (typeof activeAccountId !== "undefined" && activeAccountId) ? activeAccountId : null;
    let ad_account_id = null;
    if (product_id) { const pr = (await sbQuery("products", `select=ad_account_id&id=eq.${product_id}`, { allAccounts: true }))?.[0]; ad_account_id = pr?.ad_account_id || ac; }
    const { data, error } = await supabaseClient.from("sites").insert({ name, slug, product_id, ad_account_id }).select("id").single();
    if (error) throw error;
    await supabaseClient.from("site_pages").insert({ site_id: data.id, slug: "", title: "Home" });
    const domId = document.getElementById("wsDom")?.value;
    if (domId) {
      try { localStorage.setItem("rv_addr_" + data.id, domId); } catch (e) {}
      if (document.getElementById("wsMain")?.checked) await sbFn("manage-domain", { action: "assign", id: domId, site_id: data.id }).catch(() => {});
    }
    location.href = "/builder.html?site=" + data.id;
  } catch (e) {
    btn.disabled = false; btn.textContent = "Create & open builder";
    err.innerHTML = `<div class="msg err">${/duplicate|unique/i.test(e.message) ? "That address is already taken. Try another." : escH(e.message)}</div>`;
  }
}
async function bvWebDelete(id) {
  const s = bvWebData.sites.find(x => x.id === id); if (!s) return;
  if (!confirm(`Delete "${s.name}" and all its pages? Orders already received stay in your Orders tab.`)) return;
  const { error } = await supabaseClient.from("sites").delete().eq("id", id);
  if (error) return bvToast("Couldn't delete: " + error.message, "err");
  bvToast("Website deleted"); bvWebReload();
}

/* ---- Tracking codes (HFCM-style) ---- */
const BV_WEB_LOC = { head: "Header (<head>)", body_start: "Start of <body>", footer: "Footer (end of <body>)" };
function bvWebScopeText(sn) {
  const { sites, pages } = bvWebData;
  if (sn.scope === "all") return "All my websites";
  if (sn.scope === "sites") { const n = (sn.site_ids || []).map(id => sites.find(s => s.id === id)?.name).filter(Boolean); return n.length ? n.join(", ") : "No websites selected"; }
  const n = (sn.page_ids || []).map(id => { const p = pages.find(x => x.id === id); const s = p && sites.find(x => x.id === p.site_id); return p ? `${s?.name || "?"} › ${p.title}` : null; }).filter(Boolean);
  return n.length ? n.join(", ") : "No pages selected";
}
function bvWebCodesHtml() {
  const { snippets } = bvWebData;
  const intro = `<div style="font-size:12.5px;color:var(--muted);margin-bottom:14px;max-width:640px;">Add your Meta Pixel, Google Analytics, TikTok pixel or any script here once, and choose where it runs: every website, specific websites, or only certain pages. Your ad account's Meta Pixel is already loaded automatically on every site.</div>`;
  if (!snippets.length) return intro + `<div class="panel"><div class="empty"><div class="empty-ico">🏷️</div>No tracking codes yet.<div style="margin-top:12px;"><button class="btn btn-a" style="width:auto;" onclick="bvWebSnippet()">+ Add tracking code</button></div></div></div>`;
  return intro + `<div class="panel"><div class="tbl-wrap"><table>
    <tr><th>Name</th><th>Placed in</th><th>Runs on</th><th>Active</th><th></th></tr>
    ${snippets.map(sn => `<tr>
      <td class="s n">${escH(sn.name)}</td>
      <td class="n">${escH(BV_WEB_LOC[sn.location] || sn.location)}</td>
      <td style="max-width:300px;">${escH(bvWebScopeText(sn))}</td>
      <td><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" ${sn.is_active ? "checked" : ""} onchange="bvWebToggleSnippet('${sn.id}', this.checked)" style="width:auto;"></label></td>
      <td style="white-space:nowrap;"><button class="btn btn-g" style="width:auto;padding:4px 10px;font-size:12px;" onclick="bvWebSnippet('${sn.id}')">Edit</button> <button class="btn btn-g" style="width:auto;padding:4px 10px;font-size:12px;" onclick="bvWebDeleteSnippet('${sn.id}')">🗑</button></td>
    </tr>`).join("")}</table></div></div>`;
}
async function bvWebToggleSnippet(id, on) {
  const { error } = await supabaseClient.from("tracking_snippets").update({ is_active: on, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return bvToast("Couldn't update: " + error.message, "err");
  const sn = bvWebData.snippets.find(x => x.id === id); if (sn) sn.is_active = on;
  bvToast(on ? "Code turned on" : "Code turned off");
}
async function bvWebDeleteSnippet(id) {
  const sn = bvWebData.snippets.find(x => x.id === id);
  if (!confirm(`Delete "${sn?.name}"? It will stop running on your websites.`)) return;
  const { error } = await supabaseClient.from("tracking_snippets").delete().eq("id", id);
  if (error) return bvToast("Couldn't delete: " + error.message, "err");
  bvToast("Code deleted"); bvWebReload();
}
const BV_WEB_PRESET_KEY = { meta: "metapx", ga: "ga4", tiktok: "tiktok", clarity: "clarity", hotjar: "hotjar", gtm: "gtm" };
const BV_WEB_PRESETS = {
  clarity: { name: "Microsoft Clarity", location: "head", ask: "Clarity Project ID", ph: "e.g. k8x2abcd9z", make: id => `<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${id}");<\/script>` },
  hotjar: { name: "Hotjar", location: "head", ask: "Hotjar Site ID (numbers)", ph: "e.g. 1234567", make: id => `<script>(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};h._hjSettings={hjid:${id.replace(/\D/g, "")},hjsv:6};a=o.getElementsByTagName('head')[0];r=o.createElement('script');r.async=1;r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;a.appendChild(r);})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');<\/script>` },
  gtm: { name: "Google Tag Manager", location: "head", ask: "Container ID", ph: "GTM-XXXXXXX", make: id => `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');<\/script>` },
  meta: { name: "Meta Pixel", location: "head", ask: "Pixel ID", ph: "e.g. 1234567890123456", make: id => `<!-- Meta Pixel -->\n<script>\n!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');\nfbq('init','${id}');\nfbq('track','PageView');\n<\/script>` },
  ga: { name: "Google Analytics", location: "head", ask: "Measurement ID", ph: "G-XXXXXXXXXX", make: id => `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"><\/script>\n<script>\nwindow.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}\ngtag('js',new Date());gtag('config','${id}');\n<\/script>` },
  tiktok: { name: "TikTok Pixel", location: "head", ask: "Pixel ID", ph: "e.g. C1234567890", make: id => `<script>\n!function (w, d, t) {w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${id}');ttq.page();}(window, document, 'ttq');\n<\/script>` },
};
function bvWebPreset(k) {
  const pr = BV_WEB_PRESETS[k]; if (!pr) return;
  const id = prompt(`${pr.name} — ${pr.ask}`, "");
  if (!id || !id.trim()) return;
  const clean = id.trim().replace(/[^A-Za-z0-9_-]/g, "");
  if (!clean) return bvToast("That ID doesn't look right", "err");
  // the marker line lets the website builder's Plugins panel recognise (and manage) this tool too
  document.getElementById("snCode").value = `<!-- rv-plugin:${BV_WEB_PRESET_KEY[k] || k} id=${clean} -->\n` + pr.make(clean);
  if (!document.getElementById("snName").value) document.getElementById("snName").value = pr.name;
  document.getElementById("snLoc").value = pr.location;
}
function bvWebSnippet(id) {
  const sn = id ? bvWebData.snippets.find(x => x.id === id) : null;
  const { sites, pages } = bvWebData;
  const scope = sn?.scope || "all";
  const siteSel = new Set(sn?.site_ids || []), pageSel = new Set(sn?.page_ids || []);
  const opt = (v, t, sub) => `<label class="${scope === v ? "on" : ""}"><input type="radio" name="snScope" value="${v}" ${scope === v ? "checked" : ""} onchange="bvWebScopeChange()"><div>${t}<span>${sub}</span></div></label>`;
  bvOpenSheet("bvWebOverlay", `
    <button class="bv-modal-close" data-sheet-close onclick="bvCloseSheet('bvWebOverlay')">✕</button>
    <div class="ph-title" style="margin-bottom:12px;">${sn ? "Edit tracking code" : "Add tracking code"}</div>
    ${sn ? "" : `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px;"><span style="font-size:11.5px;color:var(--muted);">Quick add:</span>
      <button class="btn btn-g" style="width:auto;padding:4px 10px;font-size:11.5px;" onclick="bvWebPreset('meta')">Meta Pixel</button>
      <button class="btn btn-g" style="width:auto;padding:4px 10px;font-size:11.5px;" onclick="bvWebPreset('tiktok')">TikTok Pixel</button>
      <button class="btn btn-g" style="width:auto;padding:4px 10px;font-size:11.5px;" onclick="bvWebPreset('ga')">Google Analytics</button>
      <button class="btn btn-g" style="width:auto;padding:4px 10px;font-size:11.5px;" onclick="bvWebPreset('clarity')">Microsoft Clarity</button>
      <button class="btn btn-g" style="width:auto;padding:4px 10px;font-size:11.5px;" onclick="bvWebPreset('gtm')">Tag Manager</button>
      <button class="btn btn-g" style="width:auto;padding:4px 10px;font-size:11.5px;" onclick="bvWebPreset('hotjar')">Hotjar</button></div>`}
    <div class="ws-field"><label>Name</label><input id="snName" value="${escH(sn?.name || "")}" placeholder="e.g. TikTok pixel - Herbal Tea"></div>
    <div class="ws-field"><label>Code</label><textarea id="snCode" class="ws-code" spellcheck="false" placeholder="Paste your script or HTML here">${escH(sn?.code || "")}</textarea></div>
    <div class="ws-field"><label>Where on the page</label><select id="snLoc">${Object.entries(BV_WEB_LOC).map(([k, t]) => `<option value="${k}" ${sn?.location === k ? "selected" : ""}>${escH(t)}</option>`).join("")}</select></div>
    <div class="ws-field"><label>Runs on</label><div class="ws-radio">
      ${opt("all", "All my websites", "Every page, including new sites you build later")}
      ${opt("sites", "Specific websites", "Pick which websites run it")}
      ${opt("pages", "Specific pages", "Only the pages you choose, e.g. the thank-you page")}
    </div></div>
    <div id="snSitesBox" class="ws-field" style="display:none;"><div class="ws-checks">${sites.map(s => `<label><input type="checkbox" class="snSite" value="${s.id}" ${siteSel.has(s.id) ? "checked" : ""}>${escH(s.name)}</label>`).join("") || `<span style="color:var(--muted);font-size:12px;">No websites yet.</span>`}</div></div>
    <div id="snPagesBox" class="ws-field" style="display:none;"><div class="ws-checks">${pages.map(p => { const s = sites.find(x => x.id === p.site_id); return `<label><input type="checkbox" class="snPage" value="${p.id}" ${pageSel.has(p.id) ? "checked" : ""}>${escH(s?.name || "?")} › ${escH(p.title)}${p.kind === "thanks" ? " (thank-you)" : ""}</label>`; }).join("") || `<span style="color:var(--muted);font-size:12px;">No pages yet.</span>`}</div></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px;"><input type="checkbox" id="snActive" ${sn ? (sn.is_active ? "checked" : "") : "checked"} style="width:auto;"> Active</label>
    <div id="snErr"></div>
    <button class="btn btn-a" id="snSave" onclick="bvWebSaveSnippet('${sn?.id || ""}')">Save tracking code</button>`, 560);
  bvWebScopeChange();
}
function bvWebScopeChange() {
  const v = document.querySelector('input[name="snScope"]:checked')?.value || "all";
  document.querySelectorAll(".ws-radio label").forEach(l => l.classList.toggle("on", l.querySelector("input").value === v));
  const a = document.getElementById("snSitesBox"), b = document.getElementById("snPagesBox");
  if (a) a.style.display = v === "sites" ? "" : "none";
  if (b) b.style.display = v === "pages" ? "" : "none";
}
async function bvWebSaveSnippet(id) {
  const name = document.getElementById("snName").value.trim(), code = document.getElementById("snCode").value;
  const err = document.getElementById("snErr"), btn = document.getElementById("snSave");
  const scope = document.querySelector('input[name="snScope"]:checked')?.value || "all";
  const site_ids = scope === "sites" ? [...document.querySelectorAll(".snSite:checked")].map(x => x.value) : [];
  const page_ids = scope === "pages" ? [...document.querySelectorAll(".snPage:checked")].map(x => x.value) : [];
  if (!name) { err.innerHTML = `<div class="msg err">Give this code a name.</div>`; return; }
  if (!code.trim()) { err.innerHTML = `<div class="msg err">Paste the code first.</div>`; return; }
  if (scope === "sites" && !site_ids.length) { err.innerHTML = `<div class="msg err">Choose at least one website.</div>`; return; }
  if (scope === "pages" && !page_ids.length) { err.innerHTML = `<div class="msg err">Choose at least one page.</div>`; return; }
  btn.disabled = true; btn.textContent = "Saving…"; err.innerHTML = "";
  const row = { name, code, location: document.getElementById("snLoc").value, scope, site_ids, page_ids, is_active: document.getElementById("snActive").checked, updated_at: new Date().toISOString() };
  const { error } = id ? await supabaseClient.from("tracking_snippets").update(row).eq("id", id) : await supabaseClient.from("tracking_snippets").insert(row);
  if (error) { btn.disabled = false; btn.textContent = "Save tracking code"; err.innerHTML = `<div class="msg err">${escH(error.message)}</div>`; return; }
  bvCloseSheet("bvWebOverlay"); bvToast("Tracking code saved"); bvWebReload();
}