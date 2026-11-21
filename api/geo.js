// Tells the visitor's browser roughly where it is (country, city, region) from Vercel's edge headers, so recordings can show a location.
// Public and read-only; it returns only what the visitor's own request already carries.
module.exports = (req, res) => {
  const h = (n) => { const v = req.headers[n]; try { return v ? decodeURIComponent(String(v)).slice(0, 80) : ""; } catch (_) { return String(v || "").slice(0, 80); } };
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("cache-control", "private, max-age=3600");
  res.status(200).json({ country: h("x-vercel-ip-country"), city: h("x-vercel-ip-city"), region: h("x-vercel-ip-country-region") });
};
