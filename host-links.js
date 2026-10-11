// On the public site (revoracrm.app) send login and sign-up to the app at dash.revoracrm.app.
(function () {
  var h = location.hostname;
  if (h !== "revoracrm.app" && h !== "www.revoracrm.app") return;
  document.querySelectorAll('a[href]').forEach(function (a) {
    var href = a.getAttribute("href") || "";
    var m = href.match(/^\/?(login|setup-company|reset-password|dashboard_new)\.html(.*)$/);
    if (m) a.setAttribute("href", "https://dash.revoracrm.app/" + m[1] + ".html" + m[2]);
  });
})();
