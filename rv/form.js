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

  function mountForm(el, d, opts) {
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
          var fired = site.purchase_event === "submit" ? firePurchase(value, product.currency || "NGN", eventId, tier ? product.product_name + " (" + tier.label + ")" : product.product_name, tier ? tier.quantity : qty) : false;
          var ref = eventId.slice(0, 8).toUpperCase();
          sset("rv_last_ref", ref); sset("rv_last_value", String(value)); sset("rv_last_payment", payment);
          if (site.thanks_slug != null) { var dest = "/s/" + site.slug + (site.thanks_slug ? "/" + site.thanks_slug : "") + "?ref=" + ref; if (fired) setTimeout(function () { global.location.href = dest; }, 350); else global.location.href = dest; }   // give the pixels a moment to send before leaving the page
          else showThanks(el, d, ref, value, payment);
        })
        .catch(function (err) { msg.textContent = "Something went wrong, please try again. (" + err.message + ")"; msg.classList.add("on"); btn.disabled = false; btn.textContent = old; });
    });
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
