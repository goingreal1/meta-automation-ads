/* Revora service worker: lets the dashboard install as an app, load when the
   network is flaky, and show push notifications (new customer messages etc.).
   Bump CACHE_VERSION when the precache list changes. */
const CACHE_VERSION = "revora-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const PRECACHE = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/badge-96.png",
  "/icons/apple-touch-icon.png",
  "/lame.min.js",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pages: network first (the dashboard changes often and is served no-store),
// falling back to the last copy so the app still opens offline.
// Static files: cache first. Everything else (Supabase API, Meta, etc.) is
// never touched -- live data must never come from a cache.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(PAGE_CACHE).then((c) => c.put(url.pathname, copy)); }
          return res;
        })
        .catch(() => caches.match(url.pathname).then((hit) => hit || caches.match("/dashboard_new.html")))
    );
    return;
  }

  const isStatic = url.origin === self.location.origin &&
    (url.pathname.startsWith("/icons/") || url.pathname.endsWith(".webmanifest") ||
     url.pathname === "/lame.min.js" || url.pathname === "/opus-encoder-worker.min.js");
  const isFont = url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com";
  if (isStatic || isFont) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(STATIC_CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});

// ── Push ─────────────────────────────────────────────────────────────────────
// Payload (JSON, built by the send-push edge function):
//   { title, body, url, tag, icon?, badge?, image?, timestamp?, data? }
// iPhone requires every push to show a notification, so we always show one --
// even if the app is open (a tag makes repeats replace each other instead of piling up).
self.addEventListener("push", (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = { title: "Revora", body: event.data ? event.data.text() : "" }; }
  const title = p.title || "Revora";
  const options = {
    body: p.body || "",
    icon: p.icon || "/icons/icon-192.png",
    badge: p.badge || "/icons/badge-96.png",
    tag: p.tag || undefined,
    renotify: !!p.tag,
    timestamp: p.timestamp || Date.now(),
    data: { url: p.url || "/dashboard_new.html", ...(p.data || {}) },
  };
  if (p.image) options.image = p.image;
  event.waitUntil(
    self.registration.showNotification(title, options).then(async () => {
      // Home-screen badge count (supported on installed PWAs).
      if (typeof p.badgeCount === "number" && self.navigator.setAppBadge) {
        try { await self.navigator.setAppBadge(p.badgeCount); } catch {}
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/dashboard_new.html", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Reuse an open dashboard window: tell it where to go instead of reloading.
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        // focus() can be refused (e.g. some mobile browsers); still tell the page where to go.
        try { await w.focus(); } catch {}
        w.postMessage({ type: "open", url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

// The browser may rotate the push endpoint; tell any open page to re-register.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => wins.forEach((w) => w.postMessage({ type: "push-resubscribe" })))
  );
});
