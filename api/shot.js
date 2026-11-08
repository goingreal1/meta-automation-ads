/* Page screenshot for the AI: POST /api/shot  { url, device: "mobile"|"desktop", full_page }  -> { image_base64, content_type, width, height, truncated }
   Only the Revora edge function calls it (header x-shot-key = env SHOT_KEY). Only our own site hosts can be opened. */
const crypto = require("crypto");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const ALLOWED_HOSTS = new Set(["revora-sites.vercel.app", "metaautomationads.vercel.app"]);
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAX_H = 8000;

const same = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const send = (res, code, obj) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!same(req.headers["x-shot-key"], process.env.SHOT_KEY)) return send(res, 403, { error: "forbidden" });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  let target;
  try { target = new URL(String(b.url || "")); } catch (e) { return send(res, 400, { error: "bad url" }); }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) return send(res, 400, { error: "that address is not allowed" });
  const mobile = b.device !== "desktop", full = b.full_page === true;
  const W = mobile ? 390 : 1280, H = mobile ? 844 : 800;

  let browser;
  try {
    browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: "shell", defaultViewport: null });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: full ? 1 : (mobile ? 2 : 1), isMobile: mobile, hasTouch: mobile });
    if (mobile) await page.setUserAgent(MOBILE_UA);
    await page.goto(target.toString(), { waitUntil: "networkidle2", timeout: 25000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    let height = H, truncated = false;
    if (full) {
      const total = await page.evaluate(async () => { // scroll down once so lazy pictures load, then back up
        const h = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        for (let y = 0; y < Math.min(h(), 9000); y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 300));
        return h();
      });
      height = Math.min(total, MAX_H); truncated = total > MAX_H;
    }
    const shoot = (q) => page.screenshot({ type: "jpeg", quality: q, clip: { x: 0, y: 0, width: W, height }, captureBeyondViewport: full });
    let buf = Buffer.from(await shoot(78));
    if (buf.length > 3 * 1024 * 1024) buf = Buffer.from(await shoot(45));
    if (buf.length > 3.2 * 1024 * 1024) return send(res, 413, { error: "screenshot too large, try without full_page" });
    return send(res, 200, { image_base64: buf.toString("base64"), content_type: "image/jpeg", width: W, height, truncated });
  } catch (e) {
    return send(res, 500, { error: "could not take the screenshot: " + String(e && e.message || e).slice(0, 200) });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};
