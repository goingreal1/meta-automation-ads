// On the public site (revoracrm.online, or the older revoracrm.app) send login and sign-up to the app at dash.<same domain>.
(function () {
  var h = location.hostname, base = /(^|\.)revoracrm\.online$/.test(h) ? "revoracrm.online" : /(^|\.)revoracrm\.app$/.test(h) ? "revoracrm.app" : "";
  if (!base || (h !== base && h !== "www." + base)) return;
  document.querySelectorAll('a[href]').forEach(function (a) {
    var href = a.getAttribute("href") || "";
    var m = href.match(/^\/?(login|setup-company|reset-password|dashboard_new)\.html(.*)$/);
    if (m) a.setAttribute("href", "https://dash." + base + "/" + m[1] + ".html" + m[2]);
  });
})();
