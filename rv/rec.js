/* Revora session recorder. Works on pages built in Revora and on any other website:
     <script async src="https://revoracrm.app/rv/rec.js" data-project="rp_xxxxxxxxxxxxxx"></script>
   It records how the page is used (scrolling, taps, mouse, page changes) as a replay, never what is typed: every input is masked.
   Add class "rv-norec" (or data-rv-norec) to any element you never want recorded. Visitors who send "Do Not Track" are not recorded. */
(function (g) {
  "use strict";
  if (g.__rvRec) return; g.__rvRec = true;
  var SUPA = "https://oicqtpjjwmgsiluvkmpu.supabase.co";
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY3F0cGpqd21nc2lsdXZrbXB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5NDQyOTUsImV4cCI6MjExMDUyMDI5NX0.2Psx3_IHVSTL0wY0G6Y8M7IjNCtQi2RDKM0GG4WtMto";
  var THIS = document.currentScript, BASE = "https://revoracrm.app";
  try { if (THIS && THIS.src) BASE = THIS.src.replace(/\/rv\/rec\.js.*$/, ""); } catch (e) {}
  var PROJECT = (THIS && THIS.getAttribute("data-project")) || g.RV_PROJECT || "";
  if (navigator.doNotTrack === "1" || g.doNotTrack === "1") return;

  var STORE = null; try { STORE = g.sessionStorage; } catch (e) {}
  function sget(k) { try { return STORE && STORE.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { STORE && STORE.setItem(k, v); } catch (e) {} }
  function uuid() { if (g.crypto && crypto.randomUUID) return crypto.randomUUID(); return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }); }
  function cookie(n) { var m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : ""; }
  var params = new URLSearchParams(g.location.search);
  ["fbclid", "ad_id", "mas", "mcm", "mpl", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) { var v = params.get(k); if (v) sset("rv_" + k, v); });
  function attr(k) { return params.get(k) || sget("rv_" + k) || ""; }
  var VID = null;
  function visitorId() { if (VID) return VID; try { VID = g.localStorage.getItem("rv_vid"); if (!VID) { VID = uuid(); g.localStorage.setItem("rv_vid", VID); } } catch (e) { VID = VID || uuid(); } return VID; }

  // Which visit is this? On pages built in Revora the page's own tracker already counts the visit; on any other site this script does it.
  var revoraSite = g.RV_REC && g.RV_REC.site ? g.RV_REC : null;
  var KEY = (g.RVSessionKey && g.RVSessionKey()) || sget("rv_sk");
  if (!KEY) { KEY = uuid(); sset("rv_sk", KEY); }
  if (!revoraSite && !PROJECT) return;

  var S = { dur: 0, scroll: 0, clicks: 0, cta: 0, form: false };
  function scrollPct() { var d = document.documentElement, h = Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0) - g.innerHeight; return h > 0 ? Math.min(100, Math.round((g.scrollY || d.scrollTop || 0) / h * 100)) : 100; }
  function post(body, keepalive) {
    return fetch(SUPA + "/functions/v1/ads-manager", { method: "POST", keepalive: !!keepalive, headers: { "Content-Type": "application/json", apikey: ANON, Authorization: "Bearer " + ANON }, body: JSON.stringify(body) });
  }
  function rpc(p, keepalive) {
    return fetch(SUPA + "/rest/v1/rpc/rv_session", { method: "POST", keepalive: !!keepalive, headers: { "Content-Type": "application/json", apikey: ANON, Authorization: "Bearer " + ANON }, body: JSON.stringify({ p: p }) }).catch(function () {});
  }
  function pingPayload() {
    var ref = ""; try { ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : ""; if (ref === g.location.hostname) ref = ""; } catch (e) {}
    var ua = navigator.userAgent || "", dev = /ipad|tablet/i.test(ua) ? "tablet" : /mobi|android|iphone/i.test(ua) ? "mobile" : "desktop";
    return { project: PROJECT, host: g.location.hostname, key: KEY, vid: visitorId(), page: (g.location.pathname || "/").slice(0, 80), fbclid: attr("fbclid"), fbc: cookie("_fbc"), fbp: cookie("_fbp"),
      ad: attr("ad_id"), adset: attr("mas"), camp: attr("mcm"), pl: attr("mpl"), us: attr("utm_source"), um: attr("utm_medium"), uc: attr("utm_campaign"), ut: attr("utm_content"), uterm: attr("utm_term"),
      ref: ref, path: g.location.pathname, dev: dev, vp: g.innerWidth + "x" + g.innerHeight, dur: S.dur, scroll: S.scroll, clicks: S.clicks, cta: S.cta, form: S.form };
  }
  // Project mode (any other website): count the visit here.
  if (!revoraSite) {
    S.scroll = scrollPct();
    g.addEventListener("scroll", function () { var v = scrollPct(); if (v > S.scroll) S.scroll = v; }, { passive: true });
    document.addEventListener("click", function (e) {
      S.clicks++;
      var t = e.target && e.target.closest ? e.target.closest("a,button,[role=button],input[type=submit]") : null;
      if (t && /order|buy|shop|get |checkout|whatsapp|submit|add to|pay|start|call|claim|yes/i.test((t.innerText || t.value || "") + " " + (t.getAttribute("href") || ""))) S.cta++;
    }, true);
    document.addEventListener("focusin", function (e) { if (e.target && /^(input|select|textarea)$/i.test(e.target.tagName)) S.form = true; }, true);
    setInterval(function () { if (document.visibilityState === "visible") S.dur++; }, 1000);
    var ping = function (k) { rpc(pingPayload(), k); };
    setInterval(function () { if (document.visibilityState === "visible") ping(false); }, 15000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") ping(true); });
    g.addEventListener("pagehide", function () { ping(true); });
    ping(false);
  }

  // The replay itself.
  var buf = [], seq = 0, stopped = false, t0 = Date.now(), bytes = 0, stopFn = null;
  function flush(final) {
    if (!buf.length) return;
    var events = buf; buf = [];
    var body = { action: "rec_ingest", site: revoraSite ? revoraSite.site : "", project: PROJECT, key: KEY, seq: seq++, host: g.location.hostname, events: events, final: !!final };
    post(body, !!final).then(function (r) { if (r.status >= 400 && r.status < 500) stopRec(); }).catch(function () {});
  }
  function stopRec() { stopped = true; try { stopFn && stopFn(); } catch (e) {} }
  function start() {
    if (!g.rrweb || !g.rrweb.record) return;
    stopFn = g.rrweb.record({
      emit: function (ev) {
        if (stopped) return;
        buf.push(ev); bytes += 200;
        if (Date.now() - t0 > 15 * 60 * 1000) { flush(true); stopRec(); return; }
        if (buf.length >= 300) flush(false);
      },
      maskAllInputs: true, maskInputOptions: { password: true },
      blockClass: "rv-norec", blockSelector: "[data-rv-norec],.rv-norec",
      recordCanvas: false, collectFonts: false, inlineImages: false, inlineStylesheet: true,
      sampling: { scroll: 150, mousemove: 60, input: "last" },
      checkoutEveryNms: 120000
    });
    setInterval(function () { if (!stopped) flush(false); }, 10000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(true); });
    g.addEventListener("pagehide", function () { flush(true); });
  }
  var s = document.createElement("script"); s.src = BASE + "/rv/rrweb-record.min.js"; s.async = true; s.onload = start; document.head.appendChild(s);
  g.RVRec = { stop: stopRec, session: function () { return KEY; } };
})(window);
