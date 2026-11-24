// Revora dashboard, part 17 of 23: Media sending · Voice notes · WebM/Opus -> OGG/Opus remux (no re-encoding) · Opus encoding for browsers that can't record it (Safari / iPhone)

// ── Media sending ─────────────────────────────────────────────────────────────
// Files from the attach menu, drag-and-drop, or paste all go through the same
// preview modal (with optional caption) before anything is sent.
const BV_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/3gpp", "audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"];

function bvPickMedia(input) {
  const file = input?.files?.[0];
  input.value = "";
  if (file) bvOpenMediaPreview(file);
}

function bvPasteMedia(e) {
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  if (!file) return;
  e.preventDefault();
  bvOpenMediaPreview(file);
}

function bvInitDropZone() {
  const thread = document.getElementById("convThread");
  if (!thread || thread.dataset.dropReady) return;
  thread.dataset.dropReady = "1";
  ["dragenter", "dragover"].forEach((ev) => thread.addEventListener(ev, (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    thread.classList.add("drag-over");
  }));
  ["dragleave", "drop"].forEach((ev) => thread.addEventListener(ev, (e) => {
    if (ev === "dragleave" && thread.contains(e.relatedTarget)) return;
    thread.classList.remove("drag-over");
  }));
  thread.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    bvOpenMediaPreview(file);
  });
}

function bvOpenMediaPreview(file, opts = {}) {
  if (!bvSelectedConvId) return;
  const baseType = (file.type || "").split(";")[0];
  const kind = baseType.startsWith("video/") ? "video" : baseType.startsWith("audio/") ? "audio" : "image";
  if (!BV_MEDIA_TYPES.includes(baseType)) {
    alert(`WhatsApp can't send this file type (${file.type || "unknown"}). Use JPG/PNG/WebP images, MP4 videos, or AAC/MP3/OGG audio.`);
    return;
  }
  if (file.size > 16 * 1024 * 1024) {
    alert("This file is over WhatsApp's 16 MB limit.");
    return;
  }
  bvCloseModal();
  const url = URL.createObjectURL(file);
  const preview = kind === "video"
    ? `<video class="bv-media-preview" src="${url}" controls></video>`
    : kind === "audio"
      ? `<audio class="bv-media-preview" style="max-height:48px;" src="${url}" controls></audio>`
      : `<img class="bv-media-preview" src="${url}" alt="">`;
  const overlay = document.createElement("div");
  overlay.id = "bvModalOverlay";
  overlay.className = "bv-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) bvCloseMediaPreview(); };
  overlay.innerHTML = `<div class="bv-modal" style="max-width:420px;">
    <button class="bv-modal-close" onclick="bvCloseMediaPreview()">✕</button>
    <div style="font-weight:600;font-size:14px;margin-bottom:10px;">${kind === "audio" ? (opts.voiceNote ? "Send voice note" : "Send audio") : kind === "video" ? "Send video" : "Send photo"}</div>
    ${preview}
    ${kind === "audio" ? "" : `<input id="bvMediaCaption" placeholder="Add a caption (optional)…" style="width:100%;font-size:13px;padding:9px 10px;border-radius:8px;border:1px solid var(--border);background:var(--panel2);color:var(--text);">`}
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
      <button class="btn btn-a" style="width:auto;padding:8px 16px;" onclick="bvCloseMediaPreview()">Cancel</button>
      <button class="btn btn-g" style="width:auto;padding:8px 16px;" id="bvMediaSendBtn">Send</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay._objectUrl = url;
  const sendBtn = document.getElementById("bvMediaSendBtn");
  const doSend = async () => {
    const caption = document.getElementById("bvMediaCaption")?.value?.trim() || "";
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    const ok = await bvSendMediaFile(file, caption);
    if (ok) bvCloseMediaPreview();
    else { sendBtn.disabled = false; sendBtn.textContent = "Send"; }
  };
  sendBtn.onclick = doSend;
  const cap = document.getElementById("bvMediaCaption");
  if (cap) {
    cap.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSend(); } });
    cap.focus();
  } else {
    sendBtn.focus();
  }
}

function bvCloseMediaPreview() {
  const overlay = document.getElementById("bvModalOverlay");
  if (overlay?._objectUrl) URL.revokeObjectURL(overlay._objectUrl);
  bvCloseModal();
}

// Returns true on success so the preview modal knows whether to close.
async function bvSendMediaFile(file, caption) {
  if (!bvSelectedConvId) return false;
  const convId = bvSelectedConvId;
  try {
    const fd = new FormData();
    fd.append("file", file, file.name || "upload");
    fd.append("conversation_id", convId);
    if (caption) fd.append("caption", caption);
    const res = await fetch(`${SUPA_URL}/functions/v1/send-whatsapp-media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionData?.access_token || ANON}` },
      body: fd,
    });
    const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
    if (data.error) {
      alert("Failed to send media: " + data.error);
      return false;
    }
    // The new bubble arrives via the realtime subscription (bvOnRealtimeMessage).
    bvAfterAgentSend();
    return true;
  } catch (e) {
    alert("Failed to send media: " + e.message);
    return false;
  }
}

// ── Voice notes ───────────────────────────────────────────────────────────────
// WhatsApp accepts ogg/opus, mp4/aac and mp3 -- NOT webm, which is all Chrome's
// MediaRecorder produces. Prefer a natively-supported format; otherwise record
// webm and re-encode to mp3 in the browser (lamejs) before sending.
let bvRec = null;

function bvPickRecorderMime() {
  const prefs = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return prefs.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}

async function bvStartRecording() {
  if (bvRec || !bvSelectedConvId) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    alert("Voice notes aren't supported in this browser. Try Chrome, Edge, Firefox or Safari over https.");
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  } catch (e) {
    alert("Couldn't access the microphone. Allow microphone permission for this site and try again.");
    return;
  }
  const mime = bvPickRecorderMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  bvRec = { recorder, stream, chunks, startedAt: Date.now(), timer: null, send: false, convId: bvSelectedConvId };
  recorder.onstop = () => bvFinishRecording(bvRec);
  recorder.start();

  document.getElementById("convReplyInput").style.display = "none";
  document.getElementById("convRecording").style.display = "flex";
  document.getElementById("convMicBtn").style.display = "";
  document.getElementById("convSendBtn").style.display = "none";
  const micBtn = document.getElementById("convMicBtn");
  micBtn.title = "Send voice note";
  micBtn.innerHTML = "✓";
  micBtn.style.cssText = "background:var(--accent);color:#fff;border-color:transparent;";
  micBtn.onclick = () => bvStopRecording(true);
  const timeEl = document.getElementById("convRecTime");
  bvRec.timer = setInterval(() => {
    const sec = Math.floor((Date.now() - bvRec.startedAt) / 1000);
    timeEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    if (sec >= 300) bvStopRecording(true); // keep notes well under WhatsApp's 16 MB cap
  }, 250);
}

function bvStopRecording(send) {
  if (!bvRec) return;
  bvRec.send = send;
  if (bvRec.recorder.state !== "inactive") bvRec.recorder.stop();
}

function bvResetRecordingUI() {
  document.getElementById("convRecording")?.style.setProperty("display", "none");
  const input = document.getElementById("convReplyInput");
  if (input) input.style.display = "";
  const micBtn = document.getElementById("convMicBtn");
  if (micBtn) {
    micBtn.title = "Record voice note";
    micBtn.innerHTML = icon("mic", 16);
    micBtn.style.cssText = "";
    micBtn.onclick = bvStartRecording;
    micBtn.disabled = false;
  }
  bvSyncComposeBtns();
}

async function bvFinishRecording(rec) {
  clearInterval(rec.timer);
  rec.stream.getTracks().forEach((t) => t.stop());
  bvRec = null;
  bvResetRecordingUI();
  const durationMs = Date.now() - rec.startedAt;
  if (!rec.send || !rec.chunks.length) return;
  if (durationMs < 700) return; // an accidental tap, not a message
  if (rec.convId !== bvSelectedConvId) {
    alert("You switched conversations -- the voice note was discarded.");
    return;
  }
  const micBtn = document.getElementById("convMicBtn");
  micBtn.disabled = true;
  try {
    const rawType = rec.recorder.mimeType || rec.chunks[0].type || "audio/webm";
    let blob = new Blob(rec.chunks, { type: rawType });
    let ext = rawType.includes("ogg") ? "ogg" : rawType.includes("mp4") ? "m4a" : "webm";
    // Only ogg/opus is sent as recorded. Chrome's webm and MP4 recordings are
    // fragmented/odd containers that WhatsApp accepts the upload for and then
    // reports as failed (seen live with a Chrome .m4a) -- so re-encode to mp3.
    if (rawType.includes("webm")) {
      // Chrome/Edge: re-wrap the recorded Opus audio as OGG/Opus without
      // re-encoding. WhatsApp only shows the sender's profile picture, mic icon
      // and waveform (a real "voice note") for OGG/Opus -- MP3 arrives as a
      // plain audio file with a music-note icon.
      try {
        blob = await bvWebmOpusToOgg(blob);
        ext = "ogg";
      } catch (err) {
        console.warn("OGG remux failed, falling back to mp3:", err);
        blob = await bvWebmToMp3(blob);
        ext = "mp3";
      }
    } else if (!rawType.includes("ogg")) {
      // Safari records MP4/AAC, which WhatsApp rejects as a voice note. Encode
      // real Opus instead; mp3 (plain audio file) only if that fails.
      try {
        blob = await bvAudioToOggOpus(blob);
        ext = "ogg";
      } catch (err) {
        console.warn("Opus encode failed, falling back to mp3:", err);
        blob = await bvWebmToMp3(blob);
        ext = "mp3";
      }
    }
    const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: blob.type });
    bvOpenMediaPreview(file, { voiceNote: true });
  } catch (e) {
    alert("Couldn't prepare the voice note: " + e.message);
  } finally {
    micBtn.disabled = false;
  }
}

// ── WebM/Opus -> OGG/Opus remux (no re-encoding) ─────────────────────────────
function bvReadVint(b, i, keepMarker) {
  const first = b[i];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8) throw new Error("bad EBML vint");
  let val = keepMarker ? first : first & (0xff >> len);
  let allOnes = (first & (0xff >> len)) === (0xff >> len);
  for (let k = 1; k < len; k++) {
    val = val * 256 + b[i + k];
    if (b[i + k] !== 0xff) allOnes = false;
  }
  return { len, val, unknown: !keepMarker && allOnes };
}

function bvParseWebmOpus(buf) {
  const b = new Uint8Array(buf);
  const packets = [];
  let head = null;
  const MASTER = new Set([0x18538067, 0x1f43b675, 0xa0, 0x1654ae6b, 0xae]); // Segment, Cluster, BlockGroup, Tracks, TrackEntry
  (function walk(start, end) {
    let i = start;
    while (i < end) {
      const id = bvReadVint(b, i, true);
      const size = bvReadVint(b, i + id.len, false);
      const dataStart = i + id.len + size.len;
      const dataEnd = size.unknown ? end : Math.min(end, dataStart + size.val);
      if (MASTER.has(id.val)) {
        walk(dataStart, dataEnd);
      } else if (id.val === 0x63a2) { // CodecPrivate (OpusHead)
        head = b.slice(dataStart, dataEnd);
      } else if (id.val === 0xa3 || id.val === 0xa1) { // SimpleBlock / Block
        const track = bvReadVint(b, dataStart, false);
        const hdr = track.len + 3; // track number + 16-bit timecode + flags
        if (b[dataStart + track.len + 2] & 0x06) throw new Error("laced WebM blocks not supported");
        packets.push(b.slice(dataStart + hdr, dataEnd));
      }
      i = dataEnd;
    }
  })(0, b.length);
  if (!packets.length) throw new Error("no audio packets found");
  return { packets, head };
}

// Samples at 48 kHz in one Opus packet, from its TOC byte (RFC 6716 section 3.1).
function bvOpusPacketSamples(p) {
  const toc = p[0], config = toc >> 3, code = toc & 3;
  let frameMs;
  if (config < 12) frameMs = [10, 20, 40, 60][config % 4];
  else if (config < 16) frameMs = [10, 20][config % 2];
  else frameMs = [2.5, 5, 10, 20][config % 4];
  const frames = code === 0 ? 1 : code === 3 ? (p[1] & 0x3f) : 2;
  return Math.round(frameMs * 48 * frames);
}

let BV_OGG_CRC = null;
function bvOggCrc(bytes) {
  if (!BV_OGG_CRC) {
    BV_OGG_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n << 24;
      for (let k = 0; k < 8; k++) c = (c & 0x80000000) ? ((c << 1) ^ 0x04c11db7) : (c << 1);
      BV_OGG_CRC[n] = c >>> 0;
    }
  }
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ BV_OGG_CRC[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  return crc;
}

function bvOggPage(packets, headerType, granule, serial, seq) {
  const lacing = [];
  packets.forEach((p) => {
    let n = p.length;
    while (n >= 255) { lacing.push(255); n -= 255; }
    lacing.push(n);
  });
  const dataLen = packets.reduce((a, p) => a + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + dataLen);
  const v = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53, 0, headerType]); // "OggS", version, type
  v.setUint32(6, granule % 4294967296, true);
  v.setUint32(10, Math.floor(granule / 4294967296), true);
  v.setUint32(14, serial, true);
  v.setUint32(18, seq, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let o = 27 + lacing.length;
  packets.forEach((p) => { page.set(p, o); o += p.length; });
  v.setUint32(22, bvOggCrc(page), true);
  return page;
}

async function bvWebmOpusToOgg(blob) {
  const { packets, head } = bvParseWebmOpus(await blob.arrayBuffer());
  const channels = head && head.length >= 19 ? head[9] : 1;
  const preSkip = head && head.length >= 19 ? head[10] | (head[11] << 8) : 312;
  const enc = new TextEncoder();

  const opusHead = new Uint8Array(19);
  opusHead.set(enc.encode("OpusHead"));
  opusHead[8] = 1; opusHead[9] = channels;
  new DataView(opusHead.buffer).setUint16(10, preSkip, true);
  new DataView(opusHead.buffer).setUint32(12, 48000, true);
  const vendor = enc.encode("dashboard");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set(enc.encode("OpusTags"));
  new DataView(tags.buffer).setUint32(8, vendor.length, true);
  tags.set(vendor, 12);

  const serial = (Math.random() * 0xffffffff) >>> 0;
  const pages = [bvOggPage([opusHead], 0x02, 0, serial, 0), bvOggPage([tags], 0, 0, serial, 1)];
  let seq = 2, granule = 0, i = 0;
  while (i < packets.length) {
    const group = [];
    let segs = 0;
    while (i < packets.length && group.length < 40) {
      const need = Math.floor(packets[i].length / 255) + 1;
      if (segs + need > 255) break;
      segs += need;
      granule += bvOpusPacketSamples(packets[i]);
      group.push(packets[i++]);
    }
    pages.push(bvOggPage(group, i >= packets.length ? 0x04 : 0, granule, serial, seq++));
  }
  return new Blob(pages, { type: "audio/ogg; codecs=opus" });
}

// ── Opus encoding for browsers that can't record it (Safari / iPhone) ────────
// Decodes the recording, then encodes it to OGG/Opus with libopus (WASM, served
// from our own origin as /opus-encoder-worker.min.js -- opus-recorder, MIT).
function bvOpusEncode(pcm, sampleRate) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/opus-encoder-worker.min.js");
    const pages = [];
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("opus encoder timed out")); }, 30000);
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message || "opus encoder failed")); };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.message === "ready") {
        worker.postMessage({ command: "getHeaderPages" }); // OpusHead + OpusTags
        worker.postMessage({ command: "encode", buffers: [pcm] });
        worker.postMessage({ command: "done" });
      } else if (m.message === "page") {
        pages.push(m.page);
      } else if (m.message === "done") {
        clearTimeout(timer);
        worker.terminate();
        resolve(new Blob(pages, { type: "audio/ogg; codecs=opus" }));
      }
    };
    worker.postMessage({ command: "init", originalSampleRate: sampleRate, numberOfChannels: 1, encoderSampleRate: 48000, encoderApplication: 2048, encoderFrameSize: 20, resampleQuality: 3, streamPages: false });
  });
}

async function bvAudioToOggOpus(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    // Safari's decodeAudioData is callback-based on older versions.
    const data = await blob.arrayBuffer();
    const audio = await new Promise((res, rej) => { const r = ctx.decodeAudioData(data, res, rej); if (r?.then) r.then(res, rej); });
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
    }
    const ogg = await bvOpusEncode(mono, audio.sampleRate);
    // Sanity check: the last Ogg page's granule position is the length in 48 kHz
    // samples; it must match the source length or something went wrong.
    const bytes = new Uint8Array(await ogg.arrayBuffer());
    let last = -1;
    for (let i = bytes.length - 27; i >= 0; i--) {
      if (bytes[i] === 0x4f && bytes[i + 1] === 0x67 && bytes[i + 2] === 0x67 && bytes[i + 3] === 0x53) { last = i; break; }
    }
    if (last < 0) throw new Error("opus output has no pages");
    const dv = new DataView(bytes.buffer, last);
    const granule = dv.getUint32(6, true) + dv.getUint32(10, true) * 4294967296;
    if (Math.abs(granule / 48000 - audio.duration) > Math.max(0.3, audio.duration * 0.1)) {
      throw new Error("opus output length mismatch");
    }
    return ogg;
  } finally {
    ctx.close();
  }
}

// Served from our own origin first (ad blockers / office networks often block
// third-party CDNs, which silently broke voice notes on some computers), with
// the CDN only as a fallback.
function bvLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error("couldn't load " + src)); };
    document.head.appendChild(s);
  });
}

async function bvLoadLame() {
  if (window.lamejs?.Mp3Encoder) return;
  const sources = ["/lame.min.js", "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js"];
  for (const src of sources) {
    try {
      await bvLoadScript(src);
      if (window.lamejs?.Mp3Encoder) return;
    } catch {}
  }
  throw new Error("couldn't load the audio encoder (is a content blocker active on this site?)");
}

async function bvWebmToMp3(blob) {
  await bvLoadLame();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const samples = audio.getChannelData(0); // mono is plenty for speech
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const v = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    const encoder = new lamejs.Mp3Encoder(1, audio.sampleRate, 64);
    const parts = [];
    for (let i = 0; i < pcm.length; i += 1152) {
      const buf = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
      if (buf.length) parts.push(new Int8Array(buf));
    }
    const tail = encoder.flush();
    if (tail.length) parts.push(new Int8Array(tail));
    return new Blob(parts, { type: "audio/mpeg" });
  } finally {
    ctx.close();
  }
}
