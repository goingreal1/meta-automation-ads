/* Revora purchase marker. Put this on the page a buyer lands on after ordering (your thank-you page):
     <script async src="https://revoracrm.online/rv/thanks.js" data-project="rp_xxxxxxxxxxxxxx"></script>
   It tells Revora that this visit bought something, so the visit shows "Ordered" and the ad is credited. It must be on the same website
   (and same browser tab) as the page that carries rec.js. Optional: if your order system adds ?amount=7500&order=ABC123 to the thank-you
   address, the value and reference are saved with the visit. It never reads anything the buyer typed. */
(function (g) {
  "use strict";
  if (g.__rvThanks) return; g.__rvThanks = true;
  var SUPA = "https://oicqtpjjwmgsiluvkmpu.supabase.co";
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY3F0cGpqd21nc2lsdXZrbXB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5NDQyOTUsImV4cCI6MjExMDUyMDI5NX0.2Psx3_IHVSTL0wY0G6Y8M7IjNCtQi2RDKM0GG4WtMto";
  var THIS = document.currentScript;
  // If the order form redirected inside its own frame, show the thank-you page as the whole page (same site, so this is allowed).
  try { if (g.top !== g.self) { g.top.location.replace(g.location.href); return; } } catch (e) {}
  var project = (THIS && THIS.getAttribute("data-project")) || g.RV_PROJECT || "";
  var site = g.RV_REC && g.RV_REC.site ? g.RV_REC.site : "";
  var key = null; try { key = g.sessionStorage.getItem("rv_sk"); } catch (e) {}
  if (!key || (!project && !site)) return;
  var q = new URLSearchParams(g.location.search);
  var done = "rv_purchase_" + key; try { if (g.sessionStorage.getItem(done)) return; } catch (e) {}
  var p = { key: key, host: g.location.hostname, project: project, site: site, value: q.get("amount") || q.get("value") || q.get("total") || "", ref: q.get("order") || q.get("order_id") || q.get("ref") || "" };
  fetch(SUPA + "/rest/v1/rpc/rv_session_purchase", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", apikey: ANON, Authorization: "Bearer " + ANON }, body: JSON.stringify({ p: p }) })
    .then(function () { try { g.sessionStorage.setItem(done, "1"); } catch (e) {} }).catch(function () {});
})(window);
