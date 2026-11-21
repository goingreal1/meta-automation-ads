// Takes a live, phone-sized look at a public sales page and returns it as a stack of image slices (top to bottom), so the learner can SEE the
// layout, colours and hooks, not only read the words. POST { url } with header x-shot-secret. Read-only; it only opens the page.
// @sparticuz/chromium unpacks the system libraries Chrome needs (libnss3 and friends) only when it believes it runs on Lambda Node 20/22.
// Vercel does not always say so, so say it before the library loads.
if (!/(20|22)\.x/.test(process.env.AWS_EXECUTION_ENV || "")) process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs20.x";
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const SECRET = process.env.SHOT_SECRET || "";
const MAX_SLICES = 11, SLICE_H = 1300, W = 390;

function okUrl(u) {
  let x; try { x = new URL(u); } catch (_) { return null; }
  if (!/^https?:$/.test(x.protocol)) return null;
  const h = x.hostname;
  if (/^(localhost|0\.0\.0\.0)$/i.test(h) || /\.(local|internal|localhost)$/i.test(h) || h.includes(":")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) { const [p, q] = h.split(".").map(Number); if (p === 10 || p === 127 || p === 0 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168)) return null; }
  return x.toString();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!SECRET || req.headers["x-shot-secret"] !== SECRET) return res.status(401).json({ error: "Not allowed." });
  const url = okUrl(String((req.body && req.body.url) || ""));
  if (!url) return res.status(400).json({ error: "Bad url." });
  let browser;
  try {
    browser = await puppeteer.launch({ args: [...chromium.args, "--hide-scrollbars"], defaultViewport: null, executablePath: await chromium.executablePath(), headless: "shell" });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: 844, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
    await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 RevoraLearner/1.0");
    await page.goto(url, { waitUntil: "networkidle2", timeout: 28000 }).catch(() => {});
    // Scroll down so lazy-loaded pictures and sections appear, then back to the top.
    await page.evaluate(async () => { await new Promise((done) => { let y = 0; const t = setInterval(() => { window.scrollBy(0, 700); y += 700; if (y >= Math.min(document.body.scrollHeight, 16000)) { clearInterval(t); done(); } }, 120); }); window.scrollTo(0, 0); });
    await new Promise((r) => setTimeout(r, 700));
    const info = await page.evaluate(() => ({ h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), title: document.title }));
    const total = Math.min(info.h, MAX_SLICES * SLICE_H);
    const slices = [];
    for (let y = 0; y < total; y += SLICE_H) {
      const h = Math.min(SLICE_H, total - y);
      const buf = await page.screenshot({ type: "jpeg", quality: 70, clip: { x: 0, y, width: W, height: h }, captureBeyondViewport: true });
      slices.push({ y, h, b64: Buffer.from(buf).toString("base64") });
    }
    res.status(200).json({ ok: true, title: info.title, page_height: info.h, width: W, truncated: info.h > total, slices });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e).slice(0, 300) });
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
};
