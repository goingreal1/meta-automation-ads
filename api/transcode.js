// Makes an uploaded video play in every browser: H.264 video + AAC audio in an .mp4 (phones record HEVC .mov, which Chrome cannot play).
// POST { asset_id }  with the logged-in person's token. Downloads the file from R2, converts it only when needed, uploads the .mp4
// through a signed link from the `media` function, then `creative-admin` swaps the library record to the new file and removes the old one.
// If anything fails the original file is left exactly as it was (Meta ads accept both).
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const SUPA = process.env.SUPABASE_URL || "https://oicqtpjjwmgsiluvkmpu.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY3F0cGpqd21nc2lsdXZrbXB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5NDQyOTUsImV4cCI6MjExMDUyMDI5NX0.2Psx3_IHVSTL0wY0G6Y8M7IjNCtQi2RDKM0GG4WtMto";
const FFMPEG = require("ffmpeg-static");
const BUDGET_MS = 285000;

function run(args, ms) {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, args); let err = ""; let killed = false;
    const t = setTimeout(() => { killed = true; p.kill("SIGKILL"); }, ms);
    p.stderr.on("data", (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code, err, killed }); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: -1, err: String(e), killed }); });
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const started = Date.now();
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const id = String((req.body && req.body.asset_id) || "");
  if (!token || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Missing token or asset_id." });
  const H = { Authorization: `Bearer ${token}`, apikey: ANON };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-"));
  const src = path.join(tmp, "in"), out = path.join(tmp, "out.mp4");
  try {
    const me = await fetch(`${SUPA}/auth/v1/user`, { headers: H });
    if (!me.ok) return res.status(401).json({ error: "Please log in again." });
    const rows = await fetch(`${SUPA}/rest/v1/creative_assets?id=eq.${id}&select=id,public_url,asset_type,file_name`, { headers: H }).then((r) => r.json());
    const a = Array.isArray(rows) ? rows[0] : null;
    if (!a || a.asset_type !== "video" || !/^https:\/\//.test(a.public_url || "")) return res.status(404).json({ error: "Video not found." });

    const dl = await fetch(a.public_url);
    if (!dl.ok) return res.status(502).json({ error: `Couldn't read the file (${dl.status}).` });
    await pipeline(Readable.fromWeb(dl.body), fs.createWriteStream(src));

    const probe = await run(["-hide_banner", "-i", src], 15000);
    const v = (probe.err.match(/Video: (\w+)/) || [])[1] || "";
    const au = (probe.err.match(/Audio: (\w+)/) || [])[1] || "";
    const isMp4Url = /\.mp4(\?|$)/i.test(a.public_url);
    if (v === "h264" && (!au || au === "aac") && isMp4Url) return res.json({ skipped: true, reason: "already plays everywhere" });

    const left = BUDGET_MS - (Date.now() - started) - 9000; // keep time for the upload
    if (left < 8000) return res.status(504).json({ error: "File took too long to fetch." });
    const vf = "scale='if(lt(iw,ih),min(1080,iw),-2)':'if(lt(iw,ih),-2,min(1080,ih))'";
    const enc = await run(["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out], left);
    if (enc.killed) return res.status(504).json({ error: "This video is too long to convert here. It still works in Safari and in ads." });
    if (enc.code !== 0 || !fs.existsSync(out)) return res.status(500).json({ error: "Conversion failed.", detail: enc.err.slice(-300) });

    const size = fs.statSync(out).size;
    const base = String(a.file_name || "video").replace(/\.[^.]+$/, "") || "video";
    const sign = await fetch(`${SUPA}/functions/v1/media`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign", folder: "creative-vault", filename: base + ".mp4", contentType: "video/mp4", size }) }).then((r) => r.json());
    if (!sign.uploadUrl) return res.status(502).json({ error: sign.error || "Couldn't start the upload." });
    const put = await fetch(sign.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: fs.readFileSync(out) });
    if (!put.ok) return res.status(502).json({ error: `Upload failed (${put.status}).` });
    const done = await fetch(`${SUPA}/functions/v1/creative-admin`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ action: "replace_file", id, key: sign.key, content_type: "video/mp4" }) }).then((r) => r.json());
    if (done.error) return res.status(502).json({ error: done.error });
    return res.json({ converted: true, from: `${v}/${au}`, bytes: size, asset: done.asset });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
};
