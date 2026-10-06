/* Where published sites are served from. Leave "" to use the same domain as the dashboard (not recommended).
   For safety with pasted scripts (custom HTML, tracking codes) set this to a SEPARATE domain,
   e.g. "https://sites.yourbrand.com", so customer sites cannot touch dashboard logins. */
window.RV_SITE_ORIGIN = "https://revora-sites.vercel.app";
window.RV_siteUrl = function (slug, page) { return (window.RV_SITE_ORIGIN || location.origin) + "/s/" + slug + (page ? "/" + page : ""); };
