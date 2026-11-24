// ── Warm-up: as soon as the app is open and signed in, quietly load Home and the Campaigns data from Meta and keep them, so tapping Campaigns
// (or coming back to Home) shows everything at once. The screens still refresh themselves in the background after they open.
// Meta limits how fast it can be asked, so the requests go one after another, the important ones first.
(function () {
  if (window.__pfInstalled) return; window.__pfInstalled = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lite = () => { try { const c = navigator.connection; return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ""))); } catch (e) { return false; } };
  const canAds = () => ["owner", "admin", "buyer"].includes(window.myProfile && window.myProfile.role);
  const ready = () => typeof activeAccountId !== "undefined" && activeAccountId && window.myProfile && typeof sbFn === "function" && typeof am !== "undefined";
  let running = false, last = 0, lastAcct = null;

  // One Campaigns list for one range + status: first the database copy (fast, only if this device has nothing saved), then live from Meta.
  async function warmList(range, status) {
    const acct = activeAccountId, key = `${acct}|${range}|${status}`;
    if (!amLocalGet(key)) {
      const c = await sbFn("ads-manager", { action: "list_cached", range, status }).catch(() => null);
      if (acct !== activeAccountId) return;
      if (c && c.ok && !c.none) amLocalSet(key, c);
    }
    const r = await sbFn("ads-manager", { action: "list", range, status }).catch(() => null);
    if (acct !== activeAccountId || !r || r.ok === false || r.error || r.stale) return;
    amLocalSet(key, r);
    // If this is the list the Campaigns screen will open on, hand it over already loaded.
    if (!am.loading && (am.key === key || (!am.data && amKey() === key))) { am.data = r; am.key = key; am.at = Date.now(); am.fromSaved = false; try { amPruneSelection(); } catch (e) {} }
  }

  async function warm(force) {
    if (running || !ready()) return;
    if (!force && Date.now() - last < 90000 && lastAcct === activeAccountId) return;
    running = true; last = Date.now(); lastAcct = activeAccountId;
    try {
      const homeRange = typeof OV !== "undefined" ? OV.range : 7;
      if (typeof hxWarm === "function") await hxWarm();                                   // Home, for the range it opens on
      if (canAds()) {
        await warmList(am.range, am.filter);                                               // what Campaigns opens on
        const home = homeRange === 1 ? "today" : homeRange === 30 ? "last30" : "last7";
        if (home !== am.range || am.filter !== "all") await warmList(home, "all");        // what tapping a campaign on Home needs
      }
      if (lite()) return;                                                                  // slow or data-saver connection: stop at the essentials
      await sleep(2500);
      if (typeof hxWarm === "function") for (const r of [1, 7, 30]) { if (r !== homeRange) { await hxWarm(r); await sleep(1500); } }
      if (canAds()) for (const [r, s] of [["last7", "live"], ["last30", "live"]]) { if (r !== am.range || s !== am.filter) { await warmList(r, s); await sleep(2500); } }
    } catch (e) { console.warn("warm-up", e); } finally { running = false; }
  }
  window.rvWarm = warm;

  // Start once the app knows who is signed in and which ad account is selected.
  let tries = 0; const t = setInterval(() => { if (ready()) { clearInterval(t); setTimeout(() => warm(true), 400); } else if (++tries > 120) clearInterval(t); }, 500);
  // Coming back to the app after a while, or switching ad account: warm again.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") warm(false); });
  setInterval(() => { if (ready() && lastAcct !== activeAccountId) warm(true); }, 2000);

  // Signing out removes what was kept on this device.
  try { supabaseClient.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { try { Object.keys(localStorage).filter((k) => k.startsWith("rv_hx:") || k.startsWith("rv_am:")).forEach((k) => localStorage.removeItem(k)); } catch (e) {} } }); } catch (e) {}
})();
