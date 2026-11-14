/* housing-order.js — rental application flow for order.html
 *
 * Talks to the live `mcp-housing` edge function using its public actions only
 * (public_list, public_property, public_track, public_submit). No keys beyond the
 * anon key order.html already carries; card details are never collected here.
 *
 * order.html usage (see the housing branch in loadProduct):
 *   const h = await RevoraHousing.detect({ supabaseUrl, anonKey, productId, propertyRef });
 *   if (h) { initPixel(...); RevoraHousing.render(h, { page, thankyou }, { fbclid }); return; }
 *   // otherwise carry on with the normal order form, untouched.
 */
(function () {
  "use strict";
  var W = window;
  var cfg = { base: "", anonKey: "", productId: "" };

  /* ---------- tiny helpers ---------- */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n, cur) {
    n = Number(n) || 0;
    var whole = Math.abs(n - Math.round(n)) < 0.005;
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(n);
    } catch (e) { return (cur || "") + " " + n.toFixed(whole ? 0 : 2); }
  }
  function https(u) { u = String(u || ""); return /^https?:\/\//i.test(u) ? u : ""; }
  function phoneDigits(p) { var s = String(p || "").trim(); return (s.charAt(0) === "+" ? "+" : "") + s.replace(/\D/g, ""); }
  function uuid() {
    if (W.crypto && W.crypto.randomUUID) return W.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16);
    });
  }
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function once(key) { // true the first time per browser session
    try { if (sessionStorage.getItem(key)) return false; sessionStorage.setItem(key, "1"); } catch (e) {}
    return true;
  }
  function px(name, data, opts) { try { if (typeof W.fbq === "function") W.fbq("track", name, data || {}, opts || {}); } catch (e) {} }

  function call(body) {
    return fetch(cfg.base + "/functions/v1/mcp-housing", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.anonKey, apikey: cfg.anonKey },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.error) { var e = new Error(data.error || "request_failed"); e.status = res.status; throw e; }
        return data;
      });
    });
  }
  function track(event, productId, property) {
    if (!once("rh_" + event + "_" + (property ? property.id : productId))) return;
    call({ action: "public_track", event: event, product_id: productId, property_id: property ? property.id : undefined }).catch(function () {});
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- detect ---------- */
  // Returns null when the product is not a housing project (backend answers "not_found").
  // A temporary failure retries once, then returns null so the normal order form still works.
  function detect(o) {
    cfg.base = String(o.supabaseUrl || "").replace(/\/$/, "");
    cfg.anonKey = o.anonKey || "";
    cfg.productId = o.productId || "";
    function attempt() { return call({ action: "public_list", product_id: cfg.productId }); }
    return attempt().catch(function (e) {
      if (e.message === "not_found" || e.message === "bad_product") throw e;
      return wait(600).then(attempt);
    }).then(function (list) {
      var h = { project: list.project, properties: list.properties || [], property: null, notice: "" };
      var ref = o.propertyRef;
      if (!ref) return h;
      var q = { action: "public_property", product_id: cfg.productId };
      if (UUID_RE.test(ref)) q.property_id = ref; else q.slug = ref;
      return call(q).then(function (r) {
        h.project = Object.assign({}, h.project, r.project);
        if (r.property.availability === "available") h.property = r.property;
        else h.notice = "Sorry, “" + r.property.title + "” is no longer available. Here are the others.";
        return h;
      }).catch(function () { h.notice = "We couldn’t find that property. Here is what’s available."; return h; });
    }).catch(function (e) {
      if (e.message === "not_found" || e.message === "bad_product") return null;
      if (W.console) console.warn("[housing] detect failed, using normal order form:", e.message);
      return null;
    });
  }

  /* ---------- submit ---------- */
  function submit(f) {
    var body = {
      action: "public_submit", product_id: cfg.productId, property_id: f.property_id,
      applicant_name: f.applicant_name, applicant_email: f.applicant_email || undefined, applicant_phone: f.applicant_phone || undefined,
      desired_move_in: f.desired_move_in || undefined, occupants: f.occupants || undefined,
      answers: f.answers || {}, event_id: f.event_id, fbclid: f.fbclid || undefined,
    };
    return call(body);
  }

  /* ---------- styles ---------- */
  function injectCss() {
    if (document.getElementById("rh-css")) return;
    var s = document.createElement("style"); s.id = "rh-css";
    s.textContent =
      ".rh-card{cursor:pointer}.rh-card:hover{border-color:var(--borderStrong)}" +
      ".rh-row{display:flex;gap:14px;align-items:flex-start}.rh-row img{width:110px;height:84px;object-fit:cover;border-radius:8px;background:var(--bg2);flex:none}" +
      ".rh-rent{font-family:'Fraunces',Georgia,serif;font-size:22px;font-weight:600;color:var(--accent)}" +
      ".rh-facts{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--text2);font-size:13.5px;margin-top:6px}" +
      ".rh-thumbs{display:flex;gap:8px;overflow-x:auto;margin:-6px 0 14px}.rh-thumbs img{width:64px;height:48px;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid transparent;flex:none}.rh-thumbs img.on{border-color:var(--accent)}" +
      ".rh-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.rh-tags span{font-size:12px;background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:3px 10px;color:var(--text2)}" +
      ".rh-note{background:var(--accentBg);border:1px solid var(--accentBdr);border-radius:10px;padding:11px 13px;font-size:13px;color:var(--accentDk);margin:12px 0}" +
      ".rh-back{background:none;border:0;color:var(--accent);font-weight:600;font-size:14px;cursor:pointer;margin-bottom:12px;padding:0}" +
      "#thankyou .rh-ghost{background:#fff;color:var(--accent);border:1.5px solid var(--accent)}";
    document.head.appendChild(s);
  }

  /* ---------- views ---------- */
  function facts(p) {
    var a = [];
    if (p.bedrooms != null) a.push(Number(p.bedrooms) + " bed");
    if (p.bathrooms != null) a.push(Number(p.bathrooms) + " bath");
    if (p.sqft) a.push(Number(p.sqft).toLocaleString() + " sq ft");
    if (p.property_type) a.push(esc(p.property_type));
    return a.map(function (x) { return "<span>" + x + "</span>"; }).join("");
  }
  function place(p) { return esc([p.city, p.state].filter(Boolean).join(", ")); }

  function render(h, els, opts) {
    opts = opts || {};
    injectCss();
    els.thankyou.style.display = "none";
    var projectName = (h.project && h.project.name) || "";
    function showList(notice) {
      document.title = projectName ? "Apply — " + projectName : "Apply for a rental";
      var cards = h.properties.map(function (p, i) {
        var img = (p.images || []).map(https)[0];
        return '<div class="card rh-card" data-i="' + i + '"><div class="rh-row">' + (img ? '<img src="' + esc(img) + '" alt="">' : "") +
          '<div><div class="rh-rent">' + money(p.monthly_rent, p.currency) + '<span class="muted"> /month</span></div><div style="font-weight:600">' + esc(p.title) + '</div>' +
          '<div class="muted">' + place(p) + '</div><div class="rh-facts">' + facts(p) + "</div></div></div></div>";
      }).join("");
      els.page.innerHTML = '<div class="brandbar">Rental applications</div>' +
        (projectName ? "<h1>" + esc(projectName) + "</h1>" : "") +
        (notice ? '<div class="rh-note">' + esc(notice) + "</div>" : "") +
        (cards || '<div class="card"><div class="muted" style="font-size:14.5px">No properties are open for applications right now. Please check back soon.</div></div>');
      els.page.style.display = "";
      Array.prototype.forEach.call(els.page.querySelectorAll(".rh-card"), function (c) {
        c.addEventListener("click", function () { showProperty(h.properties[Number(c.getAttribute("data-i"))], true); });
      });
    }

    function showProperty(p, fromList) {
      try { var u = new URL(location.href); u.searchParams.set("property", p.slug || p.id); history.replaceState(null, "", u); } catch (e) {}
      document.title = "Apply — " + p.title;
      track("property_view", cfg.productId, p);
      px("ViewContent", { content_ids: [p.id], content_name: p.title, content_type: "home_listing", value: Number(p.monthly_rent) || 0, currency: p.currency });
      var imgs = (p.images || []).map(https).filter(Boolean);
      var fee = Number(p.application_fee) || 0;
      var tags = [];
      if (p.deposit != null) tags.push("Deposit " + money(p.deposit, p.currency));
      if (p.lease_term) tags.push("Lease: " + esc(p.lease_term));
      if (p.available_from) tags.push("Available " + esc(p.available_from));
      if (p.pet_policy) tags.push("Pets: " + esc(p.pet_policy));
      if (p.parking) tags.push("Parking: " + esc(p.parking));
      (Array.isArray(p.amenities) ? p.amenities : []).slice(0, 20).forEach(function (a) { tags.push(esc(a)); });
      var questions = Array.isArray(opts.questions) ? opts.questions : [];
      var qHtml = questions.map(function (q, i) {
        var id = "rh_q" + i, req = q.required ? " required" : "";
        var input = q.type === "textarea" ? '<textarea id="' + id + '" rows="3"' + req + "></textarea>"
          : q.type === "select" ? '<select id="' + id + '"' + req + '><option value="">Select</option>' + (q.options || []).map(function (o) { return "<option>" + esc(o) + "</option>"; }).join("") + "</select>"
          : '<input id="' + id + '"' + req + ">";
        return '<div class="field"><label>' + esc(q.label) + (q.required ? " *" : "") + "</label>" + input + "</div>";
      }).join("");
      var today = new Date().toISOString().slice(0, 10);

      els.page.innerHTML =
        (fromList && h.properties.length > 1 ? '<button type="button" class="rh-back" id="rhBack">← All properties</button>' : "") +
        '<div class="brandbar">Rental application</div>' +
        '<div class="card">' + (imgs[0] ? '<img class="prod-photo" id="rhMain" src="' + esc(imgs[0]) + '" alt="">' : "") +
        (imgs.length > 1 ? '<div class="rh-thumbs">' + imgs.slice(0, 8).map(function (u, i) { return '<img src="' + esc(u) + '" alt=""' + (i === 0 ? ' class="on"' : "") + ">"; }).join("") + "</div>" : "") +
        "<h1>" + esc(p.title) + "</h1>" +
        '<div class="muted">' + esc([p.address, p.city, p.state, p.postal_code].filter(Boolean).join(", ")) + "</div>" +
        '<div class="price">' + money(p.monthly_rent, p.currency) + ' <span class="muted">/ month</span></div>' +
        '<div class="rh-facts">' + facts(p) + "</div>" +
        (tags.length ? '<div class="rh-tags">' + tags.map(function (t) { return "<span>" + t + "</span>"; }).join("") + "</div>" : "") +
        (p.description ? '<div class="desc">' + esc(p.description) + "</div>" : "") + "</div>" +
        '<form id="rhForm" class="card" novalidate><div id="rhMsg" class="msg"></div>' +
        '<div class="field"><label>Full name *</label><input id="rh_name" required autocomplete="name"></div>' +
        '<div class="fg2"><div class="field"><label>Phone *</label><input id="rh_phone" type="tel" autocomplete="tel"></div>' +
        '<div class="field"><label>Email</label><input id="rh_email" type="email" autocomplete="email"></div></div>' +
        '<div class="fg2"><div class="field"><label>Desired move-in</label><input id="rh_move" type="date" min="' + today + '"></div>' +
        '<div class="field"><label>People moving in</label><input id="rh_occ" type="number" min="1" max="30" inputmode="numeric"></div></div>' +
        qHtml +
        '<div class="total-row"><span>Application fee</span><span>' + (fee > 0 ? money(fee, p.currency) : "No fee") + "</span></div>" +
        (p.fee_disclosure ? '<div class="rh-note">' + esc(p.fee_disclosure) + "</div>" : "") +
        '<button type="submit" id="rhBtn">Submit application</button>' +
        '<div class="secure">🔒 Don’t enter SSNs or ID numbers here' + (fee > 0 ? " &middot; payment details show right after you submit" : "") + "</div></form>";
      els.page.style.display = "";
      window.scrollTo(0, 0);

      var back = document.getElementById("rhBack");
      if (back) back.addEventListener("click", function () { try { var u = new URL(location.href); u.searchParams.delete("property"); history.replaceState(null, "", u); } catch (e) {} showList(""); });
      var main = document.getElementById("rhMain");
      Array.prototype.forEach.call(els.page.querySelectorAll(".rh-thumbs img"), function (t) {
        t.addEventListener("click", function () {
          main.src = t.src;
          Array.prototype.forEach.call(els.page.querySelectorAll(".rh-thumbs img"), function (x) { x.classList.toggle("on", x === t); });
        });
      });

      var form = document.getElementById("rhForm"), eventId = uuid(), started = false, busy = false;
      form.addEventListener("focusin", function () {
        if (started) return; started = true;
        track("application_start", cfg.productId, p);
        px("InitiateCheckout", { content_ids: [p.id], content_name: p.title, value: fee, currency: p.currency });
      });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (busy) return; // double taps
        var msg = document.getElementById("rhMsg"), btn = document.getElementById("rhBtn");
        function fail(t) { msg.textContent = t; msg.className = "msg err"; msg.style.display = "block"; }
        msg.style.display = "none";
        var name = document.getElementById("rh_name").value.trim(), phone = document.getElementById("rh_phone").value.trim(),
          email = document.getElementById("rh_email").value.trim(), move = document.getElementById("rh_move").value,
          occ = document.getElementById("rh_occ").value;
        if (!name) return fail("Please enter your full name.");
        if (!phone && !email) return fail("Please enter a phone number or an email address.");
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("That email address doesn’t look right.");
        var answers = {};
        for (var i = 0; i < questions.length; i++) {
          var v = document.getElementById("rh_q" + i).value.trim();
          if (questions[i].required && !v) return fail("Please answer: " + questions[i].label);
          if (v) answers[questions[i].key || questions[i].label] = v;
        }
        busy = true; btn.disabled = true; btn.textContent = "Submitting…";
        submit({ property_id: p.id, applicant_name: name, applicant_phone: phone, applicant_email: email, desired_move_in: move, occupants: occ ? Number(occ) : null, answers: answers, event_id: eventId, fbclid: opts.fbclid })
          .then(function (r) {
            px("Lead", { content_ids: [p.id], content_name: p.title, value: fee, currency: p.currency }, { eventID: eventId });
            els.page.style.display = "none";
            renderThanks(els.thankyou, r);
          })
          .catch(function (err) {
            busy = false; btn.disabled = false; btn.textContent = "Submit application";
            fail(/^(request_failed|bad_|not_found)/.test(err.message) ? "Something went wrong, please try again." : err.message);
          });
      });
    }

    if (h.property) showProperty(h.property, false);
    else if (h.properties.length === 1 && !h.notice) showProperty(h.properties[0], false);
    else showList(h.notice);
  }

  /* ---------- thank-you / payment screen ---------- */
  function renderThanks(el, r) {
    var fee = (r.fee && Number(r.fee.amount)) || 0, cur = (r.fee && r.fee.currency) || (r.property && r.property.currency);
    var phone = phoneDigits(r.contact_phone), pay = r.pay || null, rows = "", btns = "";
    var text = "Thank you. Your application for " + ((r.property && r.property.title) || "the property") + " has been submitted.";
    if (fee > 0) {
      text += " Pay the application fee below, then " + (phone ? "call or text your receipt to the property manager." : "send your receipt to the property manager.");
    } else {
      text += " No application fee is due. The property manager will be in touch.";
    }
    rows += '<div class="row"><span>Property</span><b>' + esc(r.property && r.property.title) + "</b></div>";
    rows += '<div class="row"><span>Application fee</span><b>' + (fee > 0 ? money(fee, cur) : "No fee due") + "</b></div>";
    if (fee > 0 && pay) {
      if (pay.bank_name) rows += '<div class="row"><span>Bank</span><b>' + esc(pay.bank_name) + "</b></div>";
      if (pay.account_number) rows += '<div class="row"><span>Account number</span><b class="acct" id="rhAcct">' + esc(pay.account_number) + "</b></div>";
      if (pay.account_name) rows += '<div class="row"><span>Account name</span><b>' + esc(pay.account_name) + "</b></div>";
      rows += '<div class="row"><span>Reference</span><b>' + esc(pay.reference_to_use || r.ref) + "</b></div>";
      if (pay.instructions) rows += '<div style="font-size:13px;color:var(--text2);margin-top:8px;white-space:pre-wrap">' + esc(pay.instructions) + "</div>";
      if (pay.account_number) rows += '<button type="button" id="rhCopy">Copy account number</button>';
      if (https(pay.payment_link_url)) btns += '<a class="waBtn" target="_blank" rel="noopener" href="' + esc(https(pay.payment_link_url)) + '">Pay online</a>';
    } else if (fee > 0) {
      rows += '<div style="font-size:13px;color:var(--text2);margin-top:8px">The property manager will contact you with payment details.</div>';
    }
    if (r.fee && r.fee.disclosure) rows += '<div style="font-size:12.5px;color:var(--muted);margin-top:10px">' + esc(r.fee.disclosure) + "</div>";
    if (phone) {
      var sms = "sms:" + phone + "?&body=" + encodeURIComponent("Hi, I applied for " + ((r.property && r.property.title) || "a property") + (fee > 0 ? " and have paid the application fee." : ".") + " Reference " + r.ref);
      btns += '<a class="waBtn" href="tel:' + esc(phone) + '">Call ' + esc(r.contact_phone) + "</a>";
      if (fee > 0) btns += '<a class="waBtn rh-ghost" href="' + esc(sms) + '">Text receipt</a>';
    }
    el.innerHTML = '<div class="check">✓</div><h1>Application received</h1><p>' + esc(text) + '</p><div class="bank">' + rows + "</div>" + btns +
      '<div class="ref">Reference: ' + esc(r.ref) + "</div>";
    el.style.display = "block";
    var copy = document.getElementById("rhCopy");
    if (copy) copy.addEventListener("click", function () {
      var n = document.getElementById("rhAcct").textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(n) : Promise.reject()).then(function () { copy.textContent = "Copied ✓"; }, function () { copy.textContent = n; });
    });
    window.scrollTo(0, 0);
  }

  W.RevoraHousing = { version: "1.0", detect: detect, render: render, submit: submit, renderThanks: renderThanks };
})();
