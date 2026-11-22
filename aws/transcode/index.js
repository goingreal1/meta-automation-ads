// AWS Lambda version of the old Vercel api/transcode.js. Same contract and behaviour.
// Makes an uploaded video play in every browser: H.264 video + AAC audio in an .mp4 (phones record HEVC .mov, which Chrome cannot play).
// POST { asset_id }  with the logged-in person's token (Authorization header), or { asset_id, ticket } from the server (mcp-social).
// Downloads the file from R2, converts it only when needed, uploads the .mp4 through a signed link from the `media` function,
// then `creative-admin` swaps the library record to the new file and removes the old one.
// If anything fails the original file is left exactly as it was (Meta ads accept both).
// CORS (dashboard origins, POST + OPTIONS, authorization + content-type) is answered by the Lambda Function URL itself (see ../template.yaml),
// so this code does not add CORS headers.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const SUPA = process.env.SUPABASE_URL || "https://oicqtpjjwmgsiluvkmpu.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY3F0cGpqd21nc2lsdXZrbXB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5NDQyOTUsImV4cCI6MjExMDUyMDI5NX0.2Psx3_IHVSTL0wY0G6Y8M7IjNCtQi2RDKM0GG4WtMto";
// Lambda unpacks the zip read-only. If the ffmpeg file lost its "run" permission on the way (zip made on Windows), run a copy from /tmp.
function ffmpegPath() {
  const p = require("ffmpeg-static");
  try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) {}
  const q = "/tmp/ffmpeg";
  if (!fs.existsSync(q)) { fs.copyFileSync(p, q); fs.chmodSync(q, 0o755); }
  return q;
}
const FFMPEG = ffmpegPath();
const BUDGET_MS = 280000; // Lambda allows far longer than Vercel did (function timeout is 300 s)

function run(args, ms) {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, args); let err = ""; let killed = false;
    const t = setTimeout(() => { killed = true; p.kill("SIGKILL"); }, ms);
    p.stderr.on("data", (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code, err, killed }); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: -1, err: String(e), killed }); });
  });
}

const reply = (statusCode, obj) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });


// ---- scene frames for learning (read-only): POST { action: "frames", video_id, video_url, exp, sig } ----
// Takes a winning ad's video file from Meta, returns a small picture at every scene change (plus the first picture) with its time, and the sound as a small mp3.
// No secrets live here: the signed request is checked by asking Revora (ads-manager frames_check), and only Meta's own file hosts are fetched.
const META_HOST = /(^|\.)(fbcdn\.net|facebook\.com|fbsbx\.com|cdninstagram\.com)$/i;
async function framesJob(b) {
  const id = String(b.video_id || ""), url = String(b.video_url || "");
  let host = ""; try { const u = new URL(url); if (u.protocol !== "https:") throw 0; host = u.hostname; } catch (_) { return reply(400, { error: "Bad video address." }); }
  if (!META_HOST.test(host) || !/^\d{5,25}$/.test(id)) return reply(400, { error: "Only Meta video files are allowed." });
  const chk = await fetch(`${SUPA}/functions/v1/ads-manager`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ action: "frames_check", video_id: id, exp: b.exp, sig: b.sig }) }).then((r) => r.json()).catch(() => ({}));
  if (!chk.ok) return reply(403, { error: "Not allowed." });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fr-"));
  const src = path.join(tmp, "in");
  try {
    const dl = await fetch(url);
    if (!dl.ok) return reply(502, { error: `Couldn't read the video (${dl.status}).` });
    if (Number(dl.headers.get("content-length") || 0) > 90 * 1024 * 1024) return reply(413, { error: "Video is too large." });
    await pipeline(Readable.fromWeb(dl.body), fs.createWriteStream(src));
    const probe = await run(["-hide_banner", "-i", src], 15000);
    const dm = probe.err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    const dur = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 30;
    const hasAudio = /Audio: /.test(probe.err);
    const grab = async (vf, max) => {
      for (const f of fs.readdirSync(tmp)) if (/^f_\d+\.jpg$/.test(f)) fs.unlinkSync(path.join(tmp, f));
      const r = await run(["-hide_banner", "-y", "-i", src, "-vf", vf, "-vsync", "vfr", "-q:v", "7", "-frames:v", String(max), path.join(tmp, "f_%02d.jpg")], 90000);
      const times = [...r.err.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
      const files = fs.readdirSync(tmp).filter((f) => /^f_\d+\.jpg$/.test(f)).sort();
      return files.map((f, i) => ({ t: Math.round((times[i] != null ? times[i] : i * dur / Math.max(files.length, 1)) * 10) / 10, file: path.join(tmp, f) }));
    };
    // A picture at the very start and at every scene change; videos with few cuts fall back to evenly spaced pictures.
    let fr = await grab("select='eq(n,0)+gt(scene,0.18)',showinfo,scale=540:-2", 18);
    if (fr.length < 4) fr = await grab(`fps=${(10 / Math.max(dur, 4)).toFixed(4)},showinfo,scale=540:-2`, 12);
    // Scenes that last long get a picture in the middle too, and the very end gets one (end screens and the final call to action).
    const extra = [];
    const ts = fr.map((x) => x.t).concat([dur]);
    for (let i = 0; i < ts.length - 1; i++) if (ts[i + 1] - ts[i] > 7) extra.push((ts[i] + ts[i + 1]) / 2);
    if (dur > 4) extra.push(Math.max(0, dur - 0.6));
    for (const [k, at] of extra.slice(0, 8).entries()) {
      const f = path.join(tmp, `x_${String(k).padStart(2, "0")}.jpg`);
      await run(["-hide_banner", "-loglevel", "error", "-y", "-ss", String(at), "-i", src, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "7", f], 20000);
      if (fs.existsSync(f)) fr.push({ t: Math.round(at * 10) / 10, file: f });
    }
    fr.sort((a, b) => a.t - b.t);
    const frames = fr.map((x) => ({ t: x.t, jpg: fs.readFileSync(x.file).toString("base64") }));
    let audio = null;
    if (hasAudio) {
      const out = path.join(tmp, "a.mp3");
      await run(["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", "-t", "150", out], 60000);
      if (fs.existsSync(out) && fs.statSync(out).size < 3 * 1024 * 1024) audio = fs.readFileSync(out).toString("base64");
    }
    return reply(200, { ok: true, duration: Math.round(dur * 10) / 10, has_audio: hasAudio, frames, audio });
  } catch (e) {
    return reply(500, { error: String((e && e.message) || e) });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

exports.handler = async (event) => {
  const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || event.httpMethod;
  if (method === "OPTIONS") return { statusCode: 204, body: "" };
  if (method !== "POST") return reply(405, { error: "POST only" });
  const started = Date.now();
  let b = {};
  try { b = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "{}")); } catch (_) {}
  if (b && b.action === "frames") return framesJob(b);
  const token = String((event.headers || {}).authorization || "").replace(/^Bearer\s+/i, "");
  const id = String((b && b.asset_id) || "");
  const ticket = String((b && b.ticket) || "");
  if ((!token && !ticket) || !/^[0-9a-f-]{36}$/i.test(id)) return reply(400, { error: "Missing token or asset_id." });
  const H = { Authorization: `Bearer ${token}`, apikey: ANON };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-"));
  const src = path.join(tmp, "in"), out = path.join(tmp, "out.mp4");
  try {
    // Two ways in: the logged-in person's token, or a ticket the server made for this one file (upload links have no login).
    const adm = (b) => fetch(`${SUPA}/functions/v1/creative-admin`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ ...b, asset_id: id, ticket }) }).then((r) => r.json());
    let a;
    if (ticket) {
      a = await adm({ action: "t_info" });
      if (a.error) return reply(403, { error: a.error });
    } else {
      const me = await fetch(`${SUPA}/auth/v1/user`, { headers: H });
      if (!me.ok) return reply(401, { error: "Please log in again." });
      const rows = await fetch(`${SUPA}/rest/v1/creative_assets?id=eq.${id}&select=id,public_url,asset_type,file_name`, { headers: H }).then((r) => r.json());
      a = Array.isArray(rows) ? rows[0] : null;
    }
    if (!a || a.asset_type !== "video" || !/^https:\/\//.test(a.public_url || "")) return reply(404, { error: "Video not found." });

    const dl = await fetch(a.public_url);
    if (!dl.ok) return reply(502, { error: `Couldn't read the file (${dl.status}).` });
    await pipeline(Readable.fromWeb(dl.body), fs.createWriteStream(src));

    const dlMs = Date.now() - started;
    const probe = await run(["-hide_banner", "-i", src], 15000);
    const v = (probe.err.match(/Video: (\w+)/) || [])[1] || "";
    const au = (probe.err.match(/Audio: (\w+)/) || [])[1] || "";
    const isMp4Url = /\.mp4(\?|$)/i.test(a.public_url);
    if (v === "h264" && (!au || au === "aac") && isMp4Url) return reply(200, { skipped: true, reason: "already plays everywhere" });

    const left = BUDGET_MS - (Date.now() - started) - 9000; // keep time for the upload
    if (left < 8000) return reply(504, { error: "File took too long to fetch." });
    // Longer clips get a smaller picture so the conversion finishes inside the time limit.
    const dm = probe.err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    const secs = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 60;
    const cap = secs <= 20 ? 1080 : 720;
    const vf = `scale='if(lt(iw,ih),min(${cap},iw),-2)':'if(lt(iw,ih),-2,min(${cap},ih))'`;
    // Already H.264 + AAC (typical when the phone records "Most Compatible"): just rewrap it as .mp4, no re-encoding (seconds, no quality loss).
    const remux = v === "h264" && (!au || au === "aac");
    const enc = remux
      ? await run(["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", out], left)
      : await run(["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-vf", vf, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "27", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out], left);
    const info = { video: v, audio: au, seconds: secs, size: (probe.err.match(/Video:[^\n]*?(\d{3,5}x\d{3,5})/) || [])[1], fps: (probe.err.match(/(\d+(?:\.\d+)?) fps/) || [])[1], bytes: fs.statSync(src).size, dlMs, encMs: Date.now() - started - dlMs, cap };
    if (enc.killed) return reply(504, { error: "This video is too long to convert here. It still works in Safari and in ads.", info });
    if (enc.code !== 0 || !fs.existsSync(out)) return reply(500, { error: "Conversion failed.", detail: enc.err.slice(-300) });

    const size = fs.statSync(out).size;
    const base = String(a.file_name || "video").replace(/\.[^.]+$/, "") || "video";
    const sign = ticket ? await adm({ action: "t_sign" }) : await fetch(`${SUPA}/functions/v1/media`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign", folder: "creative-vault", filename: (base + ".mp4").replace(/\.{2,}/g, "."), contentType: "video/mp4", size }) }).then((r) => r.json());
    if (!sign.uploadUrl) return reply(502, { error: sign.error || "Couldn't start the upload." });
    const put = await fetch(sign.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: fs.readFileSync(out) });
    if (!put.ok) return reply(502, { error: `Upload failed (${put.status}).` });
    const done = ticket ? await adm({ action: "t_replace" }) : await fetch(`${SUPA}/functions/v1/creative-admin`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ action: "replace_file", id, key: sign.key, content_type: "video/mp4" }) }).then((r) => r.json());
    if (done.error) return reply(502, { error: done.error });
    return reply(200, { converted: true, from: `${v}/${au}`, bytes: size, asset: done.asset });
  } catch (e) {
    return reply(500, { error: String((e && e.message) || e) });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
};
