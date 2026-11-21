// AWS Lambda version of the old Vercel api/screenshot.js. Same contract:
//   POST { url } with header x-shot-secret  ->  { ok, title, page_height, width, truncated, slices: [{ y, h, b64 }] }
// Takes a live, phone-sized look at a public sales page and returns it as a stack of image slices (top to bottom), so the learner can SEE the
// layout, colours and hooks, not only read the words. Read-only; it only opens the page.
// @sparticuz/chromium unpacks the system libraries Chrome needs (libnss3 and friends) only when it believes it runs on Lambda Node 20/22.
// Lambda sets AWS_EXECUTION_ENV itself; this is only a safety net for local runs.
if (!/(20|22)\.x/.test(process.env.AWS_EXECUTION_ENV || "")) process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs22.x";
const crypto = require("crypto");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const SECRET = process.env.SHOT_SECRET || "";
const MAX_SLICES = 22, SLICE_H = 1300, W = 390;
// A Lambda Function URL can return at most 6 MB. Stop adding slices before we get there (the response says truncated:true).
const MAX_BODY_B64 = 5_600_000;

function okUrl(u) {
  let x; try { x = new URL(u); } catch (_) { return null; }
  if (!/^https?:$/.test(x.protocol)) return null;
  const h = x.hostname;
  if (/^(localhost|0\.0\.0\.0)$/i.test(h) || /\.(local|internal|localhost)$/i.test(h) || h.includes(":")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) { const [p, q] = h.split(".").map(Number); if (p === 10 || p === 127 || p === 0 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168)) return null; }
  return x.toString();
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const reply = (statusCode, obj) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || event.httpMethod;
  if (method !== "POST") return reply(405, { error: "POST only" });
  const headers = event.headers || {};
  if (!SECRET || !sameSecret(headers["x-shot-secret"], SECRET)) return reply(401, { error: "Not allowed." });
  let body = {};
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "{}")); } catch (_) {}
  const url = okUrl(String((body && body.url) || ""));
  if (!url) return reply(400, { error: "Bad url." });
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
    let used = 0, cut = false;
    for (let y = 0; y < total; y += SLICE_H) {
      const h = Math.min(SLICE_H, total - y);
      const buf = await page.screenshot({ type: "jpeg", quality: 70, clip: { x: 0, y, width: W, height: h }, captureBeyondViewport: true });
      const b64 = Buffer.from(buf).toString("base64");
      if (used + b64.length > MAX_BODY_B64 && slices.length) { cut = true; break; }
      used += b64.length;
      slices.push({ y, h, b64 });
    }
    return reply(200, { ok: true, title: info.title, page_height: info.h, width: W, truncated: cut || info.h > total, slices });
  } catch (e) {
    return reply(500, { error: String((e && e.message) || e).slice(0, 300) });
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
};
