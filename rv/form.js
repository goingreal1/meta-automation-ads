/* Revora site runtime: built-in order form, bank card, thank-you. Shared by site.html (live pages)
   and builder.html (editor canvas), so what you build is exactly what visitors get.
   Orders are posted to receive-order -> they land in the Orders tab. */
(function (global) {
  var SUPABASE_URL = "https://rrkhkhgdxhmogxxtbvyt.supabase.co";
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJya2hraGdkeGhtb2d4eHRidnl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwNTc3ODgsImV4cCI6MjEwMTYzMzc4OH0.zAWC-s3PVsYi_EIHibbqLkCQ0u095ppDh-2l_DA-_Pc";
  var STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT (Abuja)","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];

  var STORE = null; try { STORE = global.sessionStorage; } catch (e) {}
  function sget(k) { try { return STORE && STORE.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { STORE && STORE.setItem(k, v); } catch (e) {} }
  var params = new URLSearchParams(global.location.search);
  // Attribution survives page-to-page navigation inside a funnel
  ["buyer", "asid", "crid", "fbclid", "ad_id"].forEach(function (k) { var v = params.get(k); if (v) sset("rv_" + k, v); });
  function attr(k) { return params.get(k) || sget("rv_" + k) || undefined; }

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n, cur) { try { return new Intl.NumberFormat("en-NG", { style: "currency", currency: cur || "NGN", maximumFractionDigits: 0 }).format(n || 0); } catch (e) { return (cur || "NGN") + " " + n; } }
  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); });
  }
  function cookie(n) { var m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : undefined; }

  function mountOrderForm(el, d, opts) {
    opts = opts || {};
    var site = d.site, product = d.product;
    var ds = el.dataset;
    el.classList.add("rv-form");
    if (ds.rvAccent) {
      el.style.setProperty("--rv-accent", ds.rvAccent);
      el.style.setProperty("--rv-accent-dk", ds.rvAccent);
      el.style.setProperty("--rv-accent-bg", ds.rvAccent + "1a");
    }
    if (ds.rvRadius) el.style.setProperty("--rv-radius", ds.rvRadius + "px");
    if (!product) {
      el.innerHTML = '<div class="rv-empty">Order form &mdash; choose a product for this site (Site settings) to show it here.</div>';
      return;
    }
    var hasTiers = product.tiers && product.tiers.length;
    var selectedTier = hasTiers ? (product.tiers.find(function (t) { return t.is_default; }) || product.tiers.find(function (t) { return t.badge; }) || product.tiers[0]).id : null;
    var qty = 1;
    var isService = !!product.is_service;
    var btnText = ds.rvButton || (isService ? "Submit & get payment details" : "Complete my order");
    var title = ds.rvTitle != null ? ds.rvTitle : "Complete your order";
    var subtitle = ds.rvSubtitle != null ? ds.rvSubtitle : (isService ? "Your payment details show right after you submit." : "Pay on delivery — a team member will call to confirm.");

    // Custom fields built in the editor (data-rv-fields = JSON array of {id,label,type,options,required,placeholder})
    var custom = [];
    try { custom = JSON.parse(ds.rvFields || "[]") || []; } catch (e) { custom = []; }
    custom = custom.filter(function (f) { return f && f.label; }).slice(0, 12);
    function customHtml() {
      return custom.map(function (f, i) {
        var nm = "cf_" + i, req = f.required ? " required" : "", ph = esc(f.placeholder || ""), lab = esc(f.label) + (f.required ? "" : ' <span style="font-weight:400;color:#8c887c">(optional)</span>');
        var ctl;
        if (f.type === "select") ctl = '<select name="' + nm + '"' + req + '><option value="">Select</option>' + String(f.options || "").split(",").map(function (o) { o = o.trim(); return o ? "<option>" + esc(o) + "</option>" : ""; }).join("") + "</select>";
        else if (f.type === "textarea") ctl = '<textarea name="' + nm + '" rows="3" placeholder="' + ph + '"' + req + ' style="width:100%;border:1.5px solid var(--rv-border);border-radius:var(--rv-radius);padding:13px 14px;font:inherit;font-size:16px"></textarea>';
        else if (f.type === "checkbox") return '<div class="rv-field"><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" name="' + nm + '" style="width:auto"> ' + esc(f.label) + "</label></div>";
        else ctl = '<input name="' + nm + '" type="' + (f.type === "email" ? "email" : f.type === "number" ? "number" : f.type === "tel" ? "tel" : "text") + '" placeholder="' + ph + '"' + req + ">";
        return '<div class="rv-field"><label>' + lab + "</label>" + ctl + "</div>";
      }).join("");
    }
    function total() {
      if (hasTiers) { var t = product.tiers.find(function (x) { return x.id === selectedTier; }); return t ? Number(t.price_naira) : 0; }
      return Number(product.default_order_value_naira || 0) * qty;
    }
    var stateOpts = STATES.map(function (s) { return "<option>" + s + "</option>"; }).join("");

    el.innerHTML =
      '<form class="rv-card" novalidate>' +
      (title ? '<h3 class="rv-title">' + esc(title) + "</h3>" : "") +
      (subtitle ? '<p class="rv-sub">' + esc(subtitle) + "</p>" : "") +
      (hasTiers
        ? '<div class="rv-field rv-pkgfield"><label>Choose your package</label><div class="rv-tiersum"><div><small>Your package</small><b class="rv-sumlabel"></b></div><button type="button" class="rv-change">Change</button></div><div class="rv-tiers">' + product.tiers.map(function (t) {
            return '<div class="rv-tier' + (t.id === selectedTier ? " on" : "") + '" data-tier="' + esc(t.id) + '">' + (t.image_url ? '<img class="rv-tierimg" src="' + esc(t.image_url) + '" alt="" loading="lazy">' : "") + '<div style="flex:1"><b>' + esc(t.label) + "</b>" + (t.badge ? "<em>" + esc(t.badge) + "</em>" : "") + "</div><span>" + fmt(t.price_naira, product.currency) + "</span></div>";
          }).join("") + "</div></div>"
        : (isService ? "" : '<div class="rv-field"><label>Quantity</label><div class="rv-qty"><button type="button" data-q="-1" aria-label="Less">&minus;</button><b class="rv-qv">1</b><button type="button" data-q="1" aria-label="More">+</button></div></div>')) +
      '<div class="rv-field"><label>Full name</label><input name="name" autocomplete="name" placeholder="Your full name" required></div>' +
      '<div class="rv-field"><label>Phone number (WhatsApp)</label><input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="080..." required></div>' +
      customHtml() +
      (isService
        ? '<div class="rv-field"><label>State you want to advertise in</label><select name="state" required><option value="">Select state</option>' + stateOpts + "</select></div>"
        : '<div class="rv-field"><label>Delivery address</label><input name="address" autocomplete="street-address" placeholder="House number, street" required></div>' +
          '<div class="rv-row"><div class="rv-field"><label>City</label><input name="city" autocomplete="address-level2" placeholder="City" required></div>' +
          '<div class="rv-field"><label>State</label><select name="state" required><option value="">Select state</option>' + stateOpts + "</select></div></div>" +
          '<div class="rv-field"><label>Payment method</label><select name="payment"><option>Pay on delivery</option><option>Bank transfer</option></select></div>') +
      '<div class="rv-total"><span>Order total</span><strong class="rv-tot">' + fmt(total(), product.currency) + "</strong></div>" +
      '<button type="submit" class="rv-btn">' + esc(btnText) + "</button>" +
      '<div class="rv-msg"></div>' +
      '<div class="rv-note">🔒 Your details are kept private</div>' +
      "</form>";

    var form = el.querySelector("form"), tot = el.querySelector(".rv-tot");
    function syncSummary() {
      var t = hasTiers && product.tiers.find(function (x) { return x.id === selectedTier; }), sl = el.querySelector(".rv-sumlabel");
      if (t && sl) sl.textContent = t.label + " \u00b7 " + fmt(t.price_naira, product.currency);
    }
    el.querySelectorAll(".rv-tier").forEach(function (c) {
      c.addEventListener("click", function () {
        selectedTier = c.dataset.tier;
        el.querySelectorAll(".rv-tier").forEach(function (x) { x.classList.toggle("on", x.dataset.tier === selectedTier); });
        tot.textContent = fmt(total(), product.currency); syncSummary();
        // chosen from an offer card on the page -> show it as a one-line summary instead of asking again
        if (c.__fromCard) { el.classList.add("rv-picked"); c.__fromCard = false; }
      });
    });
    var chg = el.querySelector(".rv-change"); if (chg) chg.addEventListener("click", function () { el.classList.remove("rv-picked"); });
    syncSummary();
    el.querySelectorAll("[data-q]").forEach(function (b) {
      b.addEventListener("click", function () {
        qty = Math.max(1, Math.min(20, qty + Number(b.dataset.q)));
        el.querySelector(".rv-qv").textContent = qty;
        tot.textContent = fmt(total(), product.currency);
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = form.elements, msg = el.querySelector(".rv-msg"), btn = el.querySelector(".rv-btn");
      msg.classList.remove("on");
      var name = f.name.value.trim(), phone = f.phone.value.trim();
      var address = isService ? "Service - no delivery" : f.address.value.trim();
      var city = isService ? "-" : f.city.value.trim();
      var state = f.state.value;
      var payment = isService ? "Bank transfer" : f.payment.value;
      if (!name || !phone || !address || !city || !state) { msg.textContent = "Please fill in every field."; msg.classList.add("on"); return; }
      if (phone.replace(/\D/g, "").length < 10) { msg.textContent = "Please enter a valid phone number."; msg.classList.add("on"); return; }
      var formData = {}, emailVal;
      for (var ci = 0; ci < custom.length; ci++) {
        var cf = custom[ci], el2 = f["cf_" + ci]; if (!el2) continue;
        var v = cf.type === "checkbox" ? (el2.checked ? "Yes" : "No") : String(el2.value || "").trim();
        if (cf.required && !v) { msg.textContent = "Please fill in: " + cf.label; msg.classList.add("on"); return; }
        if (v) formData[cf.label] = v.slice(0, 500);
        if (cf.type === "email" && v) emailVal = v;
      }
      if (opts.preview) { msg.textContent = "Preview mode — orders are not sent."; msg.classList.add("on"); return; }

      var tier = hasTiers ? product.tiers.find(function (x) { return x.id === selectedTier; }) : null;
      var eventId = uuid();
      var value = total();
      var payload = {
        event_id: eventId, customer_name: name, phone: phone, customer_address: address, customer_city: city,
        customer_state: state, customer_country: "NG", payment_method: payment,
        product_id: product.id, tier_id: tier ? tier.id : undefined,
        product_name: tier ? product.product_name + " (" + tier.label + ")" : product.product_name,
        quantity: tier ? tier.quantity : qty, order_value_naira: value, currency: product.currency || "NGN",
        site_id: site.id, site_page_id: d.page.id, form_data: Object.keys(formData).length ? formData : undefined, email: emailVal,
        ad_set_id: attr("asid") || null, creative_id: attr("crid") || null, buyer: attr("buyer"),
        fbclid: attr("fbclid"), ad_id: attr("ad_id"), fbp: cookie("_fbp"), fbc: cookie("_fbc")
      };
      btn.disabled = true; var old = btn.textContent; btn.textContent = "Submitting…";
      fetch(SUPABASE_URL + "/functions/v1/receive-order", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + ANON }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.error) throw new Error(res.error);
          var pname = tier ? product.product_name + " (" + tier.label + ")" : product.product_name, pqty = tier ? tier.quantity : qty;
          var ref = eventId.slice(0, 8).toUpperCase();
          sset("rv_last_ref", ref); sset("rv_last_value", String(value)); sset("rv_last_payment", payment);
          var counts = site.purchase_event === "submit";
          // With a thank-you page the Purchase is counted THERE (once, with the same event id the server sends, so Meta de-duplicates);
          // without one it is counted right here.
          if (site.thanks_slug != null) {
            if (counts) { try { global.sessionStorage.setItem("rv_pending_purchase", JSON.stringify({ value: value, cur: product.currency || "NGN", eventId: eventId, name: pname, qty: pqty, site: site.id })); } catch (e) {} }
            global.location.href = "/s/" + site.slug + (site.thanks_slug ? "/" + site.thanks_slug : "") + "?ref=" + ref;
          } else {
            if (counts) firePurchase(value, product.currency || "NGN", eventId, pname, pqty);
            showThanks(el, d, ref, value, payment);
          }
        })
        .catch(function (err) { msg.textContent = "Something went wrong, please try again. (" + err.message + ")"; msg.classList.add("on"); btn.disabled = false; btn.textContent = old; });
    });
  }

  /* ---------- Housing: rental application ----------
     A housing project is saved as a service, so only service products are checked against mcp-housing.
     Not housing (or the lookup can't be reached) -> the normal order form runs exactly as before. */
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function hCall(body) {
    return fetch(SUPABASE_URL + "/functions/v1/mcp-housing", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + ANON, apikey: ANON }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.error) throw new Error(j.error || "request_failed"); return j; }); });
  }
  function hMoney(n, cur) {
    n = Number(n) || 0; var whole = Math.abs(n - Math.round(n)) < 0.005;
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(n); } catch (e) { return (cur || "") + " " + n.toFixed(whole ? 0 : 2); }
  }
  function hHttps(u) { u = String(u || ""); return /^https?:\/\//i.test(u) ? u : ""; }
  function hPhone(p) { var s = String(p || "").trim(); return (s.charAt(0) === "+" ? "+" : "") + s.replace(/\D/g, ""); }
  function hOnce(k) { if (sget(k)) return false; sset(k, "1"); return true; }
  function hPx(name, data, o) { try { if (typeof global.fbq === "function") global.fbq("track", name, data || {}, o || {}); } catch (e) {} }
  function hTrack(event, productId, p) {
    if (!hOnce("rh_" + event + "_" + (p ? p.id : productId))) return;
    hCall({ action: "public_track", event: event, product_id: productId, property_id: p ? p.id : undefined }).catch(function () {});
  }
  // Resolves to { project, properties, property, notice } for a housing project, or null for anything else.
  function hDetect(productId, ref) {
    function attempt() { return hCall({ action: "public_list", product_id: productId }); }
    return attempt().catch(function (e) {
      if (e.message === "not_found" || e.message === "bad_product") throw e;
      return new Promise(function (r) { setTimeout(r, 600); }).then(attempt);
    }).then(function (list) {
      var h = { project: list.project, properties: list.properties || [], property: null, notice: "" };
      if (!ref) return h;
      var q = { action: "public_property", product_id: productId };
      if (UUID_RE.test(ref)) q.property_id = ref; else q.slug = ref;
      return hCall(q).then(function (r) {
        h.project = Object.assign({}, h.project, r.project);
        if (r.property.availability === "available") h.property = r.property;
        else h.notice = "Sorry, “" + r.property.title + "” is no longer available. Here are the others.";
        return h;
      }).catch(function () { h.notice = "We couldn’t find that property. Here is what’s available."; return h; });
    }).catch(function () { return null; });
  }
  function hStyle() {
    if (document.getElementById("rv-housing-css")) return;
    var s = document.createElement("style"); s.id = "rv-housing-css";
    s.textContent =
      ".rv-form .rv-pick{display:block;width:100%;text-align:left;margin:0 0 10px;padding:14px;border:1.5px solid var(--rv-border);border-radius:var(--rv-radius);background:#fff;cursor:pointer;font:inherit;color:inherit}.rv-form .rv-pick:hover{border-color:var(--rv-accent)}" +
      ".rv-form .rv-pick b{display:block;font-size:15px}.rv-form .rv-pick span{font-size:13px;color:var(--rv-muted)}" +
      ".rv-form .rv-prop{display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:12px 14px;margin-bottom:14px;border-radius:var(--rv-radius);background:var(--rv-accent-bg)}.rv-form .rv-prop b{font-size:15px}.rv-form .rv-prop strong{white-space:nowrap}" +
      ".rv-form .rv-fine{margin:10px 0 0;padding:10px 12px;border-radius:8px;background:#f6f5f1;font-size:12.5px;color:#6a675d}" +
      ".rv-form .rv-back{background:none;border:0;padding:0;margin:0 0 10px;color:var(--rv-accent-dk);font:inherit;font-size:13.5px;font-weight:700;cursor:pointer}" +
      ".rv-thanks a.rv-lbtn{display:block;max-width:380px;margin:10px auto 0;padding:12px;border-radius:12px;background:var(--rv-accent);color:#fff;font-weight:600;text-align:center;text-decoration:none}.rv-thanks a.rv-lbtn.ghost{background:#fff;color:var(--rv-accent-dk);border:1.5px solid var(--rv-accent)}";
    document.head.appendChild(s);
  }
  function mountHousing(el, d, h, opts) {
    var site = d.site, product = d.product, ds = el.dataset;
    hStyle();
    el.classList.add("rv-form");
    if (ds.rvAccent) { el.style.setProperty("--rv-accent", ds.rvAccent); el.style.setProperty("--rv-accent-dk", ds.rvAccent); el.style.setProperty("--rv-accent-bg", ds.rvAccent + "1a"); }
    if (ds.rvRadius) el.style.setProperty("--rv-radius", ds.rvRadius + "px");
    var title = ds.rvTitle != null ? ds.rvTitle : "Apply for this rental";
    var btnText = ds.rvButton || "Submit application";
    var preview = !!opts.preview;

    function place(p) { return esc([p.city, p.state].filter(Boolean).join(", ")); }
    function showList(notice) {
      el.innerHTML = '<div class="rv-card">' + (title ? '<h3 class="rv-title">' + esc(title) + "</h3>" : "") +
        (notice ? '<div class="rv-fine" style="margin:0 0 12px">' + esc(notice) + "</div>" : "") +
        (h.properties.length ? '<p class="rv-sub">Choose a property to apply for.</p>' : '<p class="rv-sub">No properties are open for applications right now. Please check back soon.</p>') +
        h.properties.map(function (p, i) { return '<button type="button" class="rv-pick" data-i="' + i + '"><b>' + esc(p.title) + "</b><span>" + hMoney(p.monthly_rent, p.currency) + " / month &middot; " + place(p) + "</span></button>"; }).join("") + "</div>";
      el.querySelectorAll(".rv-pick").forEach(function (b) { b.addEventListener("click", function () { showProperty(h.properties[Number(b.getAttribute("data-i"))], true); }); });
    }
    function showProperty(p, fromList) {
      var fee = Number(p.application_fee) || 0, today = new Date().toISOString().slice(0, 10);
      if (!preview) {
        hTrack("property_view", product.id, p);
        hPx("ViewContent", { content_ids: [p.id], content_name: p.title, content_type: "home_listing", value: Number(p.monthly_rent) || 0, currency: p.currency });
      }
      el.innerHTML = '<form class="rv-card" novalidate>' +
        (fromList && h.properties.length > 1 ? '<button type="button" class="rv-back">&larr; All properties</button>' : "") +
        (title ? '<h3 class="rv-title">' + esc(title) + "</h3>" : "") +
        '<div class="rv-prop"><div><b>' + esc(p.title) + '</b><div style="font-size:12.5px;color:var(--rv-muted)">' + place(p) + "</div></div><strong>" + hMoney(p.monthly_rent, p.currency) + "/mo</strong></div>" +
        '<div class="rv-field"><label>Full name</label><input name="name" autocomplete="name" required></div>' +
        '<div class="rv-row"><div class="rv-field"><label>Phone</label><input name="phone" type="tel" autocomplete="tel" inputmode="tel"></div>' +
        '<div class="rv-field"><label>Email <span style="font-weight:400;color:#8c887c">(optional)</span></label><input name="email" type="email" autocomplete="email"></div></div>' +
        '<div class="rv-row"><div class="rv-field"><label>Desired move-in <span style="font-weight:400;color:#8c887c">(optional)</span></label><input name="move" type="date" min="' + today + '"></div>' +
        '<div class="rv-field"><label>People moving in <span style="font-weight:400;color:#8c887c">(optional)</span></label><input name="occ" type="number" min="1" max="30" inputmode="numeric"></div></div>' +
        '<div class="rv-total"><span>Application fee</span><strong>' + (fee > 0 ? hMoney(fee, p.currency) : "No fee") + "</strong></div>" +
        (p.fee_disclosure ? '<div class="rv-fine">' + esc(p.fee_disclosure) + "</div>" : "") +
        '<button type="submit" class="rv-btn">' + esc(btnText) + "</button>" +
        '<div class="rv-msg"></div>' +
        '<div class="rv-note">🔒 Please don’t enter SSNs or ID numbers here' + (fee > 0 ? " &middot; payment details show right after you submit" : "") + "</div></form>";
      var form = el.querySelector("form"), eventId = uuid(), started = false, busy = false;
      var back = el.querySelector(".rv-back"); if (back) back.addEventListener("click", function () { showList(""); });
      form.addEventListener("focusin", function () {
        if (started || preview) return; started = true;
        hTrack("application_start", product.id, p);
        hPx("InitiateCheckout", { content_ids: [p.id], content_name: p.title, value: fee, currency: p.currency });
      });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (busy) return; // double taps
        var f = form.elements, msg = el.querySelector(".rv-msg"), btn = el.querySelector(".rv-btn");
        function fail(t) { msg.textContent = t; msg.classList.add("on"); }
        msg.classList.remove("on");
        var name = f.name.value.trim(), phone = f.phone.value.trim(), email = f.email.value.trim();
        if (!name) return fail("Please enter your full name.");
        if (!phone && !email) return fail("Please enter a phone number or an email address.");
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("That email address doesn’t look right.");
        if (preview) return fail("Preview mode — applications are not sent.");
        busy = true; btn.disabled = true; var old = btn.textContent; btn.textContent = "Submitting…";
        hCall({
          action: "public_submit", product_id: product.id, property_id: p.id, site_id: site && site.id, site_page_id: d.page && d.page.id,
          applicant_name: name, applicant_phone: phone || undefined, applicant_email: email || undefined,
          desired_move_in: f.move.value || undefined, occupants: f.occ.value ? Number(f.occ.value) : undefined, answers: {}, event_id: eventId, fbclid: attr("fbclid")
        }).then(function (r) {
          hPx("Lead", { content_ids: [p.id], content_name: p.title, value: fee, currency: p.currency }, { eventID: eventId });
          hThanks(el, r);
        }).catch(function (err) {
          busy = false; btn.disabled = false; btn.textContent = old;
          fail(/^(request_failed|bad_|not_found)/.test(err.message) ? "Something went wrong, please try again." : err.message);
        });
      });
    }
    if (h.property) showProperty(h.property, false);
    else if (h.properties.length === 1 && !h.notice) showProperty(h.properties[0], false);
    else showList(h.notice);
  }
  // Inline thank-you / payment screen for a rental application
  function hThanks(el, r) {
    var fee = (r.fee && Number(r.fee.amount)) || 0, cur = (r.fee && r.fee.currency) || (r.property && r.property.currency), pay = r.pay || null, phone = hPhone(r.contact_phone);
    var ptitle = (r.property && r.property.title) || "the property", rows = "", btns = "";
    var text = "Thank you. Your application for " + ptitle + " has been submitted." + (fee > 0 ? " Pay the application fee below, then " + (phone ? "call or text your receipt to the property manager." : "send your receipt to the property manager.") : " No application fee is due. The property manager will be in touch.");
    rows += '<div class="r"><span>Property</span><b>' + esc(ptitle) + "</b></div>";
    rows += '<div class="r"><span>Application fee</span><b>' + (fee > 0 ? hMoney(fee, cur) : "No fee due") + "</b></div>";
    if (fee > 0 && pay) {
      if (pay.bank_name) rows += '<div class="r"><span>Bank</span><b>' + esc(pay.bank_name) + "</b></div>";
      if (pay.account_number) rows += '<div class="r"><span>Account number</span><b class="acct">' + esc(pay.account_number) + "</b></div>";
      if (pay.account_name) rows += '<div class="r"><span>Account name</span><b>' + esc(pay.account_name) + "</b></div>";
      rows += '<div class="r"><span>Reference</span><b>' + esc(pay.reference_to_use || r.ref) + "</b></div>";
      if (pay.instructions) rows += '<div style="font-size:13px;color:#6a675d;margin-top:6px;white-space:pre-wrap">' + esc(pay.instructions) + "</div>";
      if (pay.account_number) rows += '<button type="button" data-copy="' + esc(pay.account_number) + '">Copy account number</button>';
      if (hHttps(pay.payment_link_url)) btns += '<a class="rv-lbtn" target="_blank" rel="noopener" href="' + esc(hHttps(pay.payment_link_url)) + '">Pay online</a>';
    } else if (fee > 0) {
      rows += '<div style="font-size:13px;color:#6a675d;margin-top:6px">The property manager will contact you with payment details.</div>';
    }
    if (r.fee && r.fee.disclosure) rows += '<div style="font-size:12.5px;color:#8c887c;margin-top:10px">' + esc(r.fee.disclosure) + "</div>";
    if (phone) {
      btns += '<a class="rv-lbtn" href="tel:' + esc(phone) + '">Call ' + esc(r.contact_phone) + "</a>";
      if (fee > 0) btns += '<a class="rv-lbtn ghost" href="sms:' + esc(phone) + "?&body=" + encodeURIComponent("Hi, I applied for " + ptitle + " and have paid the application fee. Reference " + r.ref) + '">Text receipt</a>';
    }
    el.innerHTML = '<div class="rv-thanks"><div class="rv-check">✓</div><h2>Application received</h2><p>' + esc(text) + '</p><div class="rv-bank">' + rows + "</div>" + btns + '<div class="rv-ref">Reference: ' + esc(r.ref) + "</div></div>";
    wireCopy(el);
    try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
  }
  // Entry point used by mountAll: housing projects get the rental application, everything else the order form.
  function mountForm(el, d, opts) {
    var p = d && d.product;
    if (p && p.is_service) {
      hDetect(p.id, el.dataset.rvProperty || params.get("property")).then(function (h) {
        if (h) mountHousing(el, d, h, opts || {}); else mountOrderForm(el, d, opts);
      });
      return;
    }
    mountOrderForm(el, d, opts);
  }

  // Tell every pixel the customer installed about the purchase. The value is the price of the package they picked.
  function firePurchase(value, cur, eventId, name, qty) {
    var any = false;
    try { if (typeof global.fbq === "function") { global.fbq("track", "Purchase", { value: value, currency: cur, content_name: name, num_items: qty }, { eventID: eventId }); any = true; } } catch (e) {}
    try { if (global.ttq && typeof global.ttq.track === "function") { global.ttq.track("CompletePayment", { value: value, currency: cur, content_type: "product", content_name: name, quantity: qty }, { event_id: eventId }); any = true; } } catch (e) {}
    try { if (typeof global.gtag === "function") { global.gtag("event", "purchase", { transaction_id: eventId, value: value, currency: cur, items: [{ item_name: name, quantity: qty, price: value }] }); any = true; } } catch (e) {}
    try { if (global.dataLayer && typeof global.dataLayer.push === "function") { global.dataLayer.push({ event: "purchase", ecommerce: { transaction_id: eventId, value: value, currency: cur, items: [{ item_name: name, quantity: qty }] } }); any = true; } } catch (e) {}
    try { if (typeof global.clarity === "function") { global.clarity("event", "purchase"); any = true; } } catch (e) {}
    try { if (typeof global.hj === "function") { global.hj("event", "purchase"); any = true; } } catch (e) {}
    return any;
  }
  function bankHtml(product, value, payment, ref) {
    if (!product || !product.bank_account_number || !/bank/i.test(payment || "")) return "";
    var wa = String(product.whatsapp_number || "").replace(/\D/g, "");
    return '<div class="rv-bank">' +
      '<div class="r"><span>Amount</span><b>' + fmt(value, product.currency) + "</b></div>" +
      (product.bank_name ? '<div class="r"><span>Bank</span><b>' + esc(product.bank_name) + "</b></div>" : "") +
      '<div class="r"><span>Account number</span><b class="acct">' + esc(product.bank_account_number) + "</b></div>" +
      (product.bank_account_name ? '<div class="r"><span>Account name</span><b>' + esc(product.bank_account_name) + "</b></div>" : "") +
      '<div class="r"><span>Reference</span><b>' + esc(ref) + "</b></div>" +
      (product.payment_note ? '<div style="font-size:13px;color:#6a675d;margin-top:6px">' + esc(product.payment_note) + "</div>" : "") +
      '<button type="button" data-copy="' + esc(product.bank_account_number) + '">Copy account number</button>' +
      (wa ? '<a class="wa" target="_blank" rel="noopener" href="https://wa.me/' + wa + "?text=" + encodeURIComponent("Hi, I have paid. Reference " + ref) + '">Send payment proof on WhatsApp</a>' : "") +
      "</div>";
  }
  function wireCopy(scope) {
    scope.querySelectorAll("[data-copy]").forEach(function (b) {
      b.addEventListener("click", function () { try { navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied ✓"; } catch (e) {} });
    });
  }
  // Inline thank-you (used when the site has no thank-you page)
  function showThanks(el, d, ref, value, payment) {
    var bank = bankHtml(d.product, value, payment, ref);
    el.innerHTML = '<div class="rv-thanks"><div class="rv-check">✓</div><h2>' + (bank ? "Almost done — make your payment" : "Order received!") + "</h2>" +
      "<p>" + (bank ? "Transfer " + fmt(value, d.product.currency) + " to the account below, then send your payment screenshot on WhatsApp." : "Thank you. Our team will call you shortly to confirm your order and delivery details.") + "</p>" + bank + '<div class="rv-ref">Reference: ' + esc(ref) + "</div></div>";
    wireCopy(el);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  // Bank card element on a thank-you page
  function mountBank(el, d, opts) {
    opts = opts || {};
    var ref = params.get("ref") || sget("rv_last_ref") || (opts.preview ? "A1B2C3D4" : "");
    var value = Number(sget("rv_last_value") || (d.product && d.product.default_order_value_naira) || 0);
    var payment = sget("rv_last_payment") || (d.product && d.product.is_service ? "Bank transfer" : (opts.preview ? "Bank transfer" : ""));
    el.innerHTML = bankHtml(d.product, value, payment, ref) || (opts.preview ? '<div class="rv-empty">Bank details card — shows when the customer pays by bank transfer.</div>' : "");
    wireCopy(el);
  }

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtDate(f, off) {
    var d = new Date(Date.now() + (off || 0) * 86400000), p2 = function (n) { return (n < 10 ? "0" : "") + n; }, h12 = d.getHours() % 12 || 12;
    return String(f).replace(/[DlMFdjYHhiA]/g, function (c) { return { D: DAYS[d.getDay()].slice(0, 3), l: DAYS[d.getDay()], M: MONTHS[d.getMonth()].slice(0, 3), F: MONTHS[d.getMonth()], d: p2(d.getDate()), j: d.getDate(), Y: d.getFullYear(), H: p2(d.getHours()), h: p2(h12), i: p2(d.getMinutes()), A: d.getHours() < 12 ? "AM" : "PM" }[c]; });
  }
  // Mount every dynamic element inside a root
  function mountAll(root, d, opts) {
    root.querySelectorAll("[data-rv-form]").forEach(function (el) { mountForm(el, d, opts); });
    root.querySelectorAll("[data-rv-bank]").forEach(function (el) { mountBank(el, d, opts); });
    root.querySelectorAll("[data-rv-ref]").forEach(function (el) { el.textContent = sget("rv_last_ref") || (opts && opts.preview ? "A1B2C3D4" : ""); });
    // thank-you page: count the Purchase that the order form stored (once)
    try {
      var pend = global.sessionStorage.getItem("rv_pending_purchase");
      if (pend && d && d.page && d.page.kind === "thanks" && !(opts && opts.preview)) {
        var pp = JSON.parse(pend); global.sessionStorage.removeItem("rv_pending_purchase");
        if (!pp.site || !d.site || pp.site === d.site.id) firePurchase(pp.value, pp.cur, pp.eventId, pp.name, pp.qty);
      }
    } catch (e) {}
    root.querySelectorAll("[data-rv-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
    root.querySelectorAll("[data-rv-date]").forEach(function (el) { el.textContent = fmtDate(el.getAttribute("data-rv-fmt") || "D, d M", parseInt(el.getAttribute("data-rv-date"), 10) || 0); });
    // package buttons ([data-rv-tier="1" or a package name]) pre-select that package in the order form
    if (!global.__rvTierWired) {
      global.__rvTierWired = true;
      document.addEventListener("click", function (e) {
        var t = e.target.closest && e.target.closest("[data-rv-tier]"); if (!t) return;
        var form = document.querySelector("[data-rv-form]"); if (!form) return;
        var pick = String(t.getAttribute("data-rv-tier")), tiers = form.querySelectorAll(".rv-tier"), hit = null;
        if (/^\d+$/.test(pick)) hit = tiers[parseInt(pick, 10) - 1]; else tiers.forEach(function (x) { if (!hit && x.textContent.toLowerCase().indexOf(pick.toLowerCase()) > -1) hit = x; });
        if (hit) { hit.__fromCard = true; hit.click(); }
      });
    }
  }

  global.RV = { SUPABASE_URL: SUPABASE_URL, ANON: ANON, esc: esc, fmt: fmt, mountForm: mountForm, mountBank: mountBank, mountAll: mountAll, sget: sget, sset: sset, params: params };
})(window);
