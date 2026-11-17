// Zip site import: pure logic (no network, no database), so it can be tested on its own.
//   unzip(bytes)        -> entries
//   planImport(entries) -> pages / css / js / assets with every local reference rewritten
// Nothing in the uploaded page is removed: scripts, pixels, iframes and forms stay exactly as the person wrote them.
const MAX_ENTRIES = 600;
const MAX_TOTAL = 80 * 1024 * 1024; // uncompressed bytes, guards against zip bombs
const td = new TextDecoder("utf-8", {
  fatal: false
});
// ---------------------------------------------------------------- unzip (stored + deflate)
const u16 = (d, o)=>d.getUint16(o, true);
const u32 = (d, o)=>d.getUint32(o, true);
async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  w.write(data).catch(()=>{});
  w.close().catch(()=>{});
  const buf = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buf);
}
export async function unzip(zip) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for(let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--)if (u32(dv, i) === 0x06054b50) {
    eocd = i;
    break;
  }
  if (eocd < 0) throw new Error("This is not a valid .zip file.");
  const count = u16(dv, eocd + 10);
  let p = u32(dv, eocd + 16);
  if (count > MAX_ENTRIES) throw new Error(`The zip has ${count} files; the limit is ${MAX_ENTRIES}.`);
  const out = [];
  let total = 0;
  for(let n = 0; n < count; n++){
    if (u32(dv, p) !== 0x02014b50) throw new Error("The zip is damaged (bad directory).");
    const flags = u16(dv, p + 8), method = u16(dv, p + 10), csize = u32(dv, p + 20), usize = u32(dv, p + 24);
    const nlen = u16(dv, p + 28), elen = u16(dv, p + 30), clen = u16(dv, p + 32), lho = u32(dv, p + 42);
    const utf8 = (flags & 0x800) !== 0;
    const nameBytes = zip.subarray(p + 46, p + 46 + nlen);
    const name = (utf8 ? td : new TextDecoder("latin1")).decode(nameBytes);
    p += 46 + nlen + elen + clen;
    if (name.endsWith("/")) continue; // folder
    if (flags & 1) throw new Error("The zip is password protected. Remove the password and try again.");
    if (usize === 0xffffffff || csize === 0xffffffff) throw new Error("This zip uses zip64 (files over 4 GB), which is not supported.");
    total += usize;
    if (total > MAX_TOTAL) throw new Error(`The unzipped site is over ${Math.round(MAX_TOTAL / 1048576)} MB.`);
    if (u32(dv, lho) !== 0x04034b50) throw new Error("The zip is damaged (bad file header).");
    const start = lho + 30 + u16(dv, lho + 26) + u16(dv, lho + 28);
    const raw = zip.subarray(start, start + csize);
    let bytes;
    if (method === 0) bytes = raw.slice();
    else if (method === 8) bytes = await inflateRaw(raw);
    else throw new Error(`The zip uses an unsupported compression method (${method}).`);
    out.push({
      path: name,
      bytes
    });
  }
  return out;
}
// ---------------------------------------------------------------- helpers
export const TEXT_EXT = new Set([
  "html",
  "htm",
  "css",
  "js"
]);
const extOf = (p)=>(p.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
const MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  pdf: "application/pdf",
  json: "application/json",
  txt: "text/plain",
  xml: "application/xml",
  css: "text/css",
  js: "application/javascript",
  map: "application/json",
  webmanifest: "application/manifest+json"
};
export const mimeOf = (p)=>MIME[extOf(p)] ?? "application/octet-stream";
const slugPart = (s)=>s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
const decodeEnt = (s)=>s.replace(/&amp;/gi, "&").replace(/&#38;/g, "&").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
const safeDecode = (s)=>{
  try {
    return decodeURIComponent(s);
  } catch  {
    return s;
  }
};
const isAbs = (u)=>/^(https?:)?\/\//i.test(u) || /^[a-z][a-z0-9+.-]*:/i.test(u);
const dirOf = (p)=>p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
function resolvePath(fromDir, ref) {
  let r = decodeEnt(ref).trim().split(/[?#]/)[0];
  if (!r || r.startsWith("#") || isAbs(r) || r.startsWith("data:")) return null;
  r = safeDecode(r);
  const parts = r.startsWith("/") ? [] : fromDir.split("/").filter(Boolean);
  for (const seg of r.split("/")){
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}
const THANKS_RE = /(^|[-_/])(thanks?|thank-?you|thankyou|success|confirmation|order-?(complete|confirmed|success))([-_/.]|$)/i;
export function planImport(entriesIn, assetBase, siteLinks) {
  const warnings = [], notes = [];
  // 1. clean entries, strip a single wrapping folder
  let entries = entriesIn.map((e)=>({
      ...e,
      path: e.path.replace(/\\/g, "/").replace(/^\/+/, "")
    })).filter((e)=>e.path && !e.path.split("/").some((s)=>s === "..") && !/(^|\/)(__MACOSX|\.git|node_modules)(\/|$)/.test(e.path) && !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(e.path));
  const tops = new Set(entries.map((e)=>e.path.split("/")[0]));
  const allNested = entries.length > 0 && entries.every((e)=>e.path.includes("/"));
  if (allNested && tops.size === 1) {
    const t = [
      ...tops
    ][0] + "/";
    entries = entries.map((e)=>({
        ...e,
        path: e.path.slice(t.length)
      }));
    notes.push(`Opened the wrapping folder "${t.slice(0, -1)}".`);
  }
  const key = (p)=>p.toLowerCase();
  const htmls = entries.filter((e)=>/\.html?$/i.test(e.path));
  if (!htmls.length) throw new Error("No .html page was found in the zip. A site needs at least an index.html.");
  // 2. page roles
  const isIndexLike = (p)=>/(^|\/)index\.html?$/i.test(p);
  const depth = (p)=>p.split("/").length;
  const mainSrc = [
    ...htmls
  ].sort((a, b)=>Number(isIndexLike(b.path)) - Number(isIndexLike(a.path)) || depth(a.path) - depth(b.path) || a.path.length - b.path.length)[0];
  const thanksSrc = htmls.find((e)=>e !== mainSrc && THANKS_RE.test(e.path.replace(/\.html?$/i, "").replace(/\/index$/i, "")));
  // 3. names for html pages, css/js files and assets
  const used = new Set([
    "index.html",
    "thanks.html"
  ]);
  const uniq = (name)=>{
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    const m = name.match(/^(.*?)(\.[a-z0-9.]+)?$/);
    for(let i = 2;; i++){
      const c = `${m[1]}-${i}${m[2] ?? ""}`;
      if (!used.has(c)) {
        used.add(c);
        return c;
      }
    }
  };
  const pageName = (e)=>{
    if (e === mainSrc) return "index.html";
    if (e === thanksSrc) return "thanks.html";
    const base = e.path.replace(/\.html?$/i, "").replace(/\/index$/i, "");
    return uniq((slugPart(base.replace(/\//g, "-")).slice(0, 40) || "page") + ".html");
  };
  const textName = (e)=>{
    const segs = e.path.split("/").map(slugPart).filter(Boolean);
    let file = segs.slice(-4).join("/");
    if (file === "styles.css" || file === "scripts.js") file = "site-" + file; // these two names are applied to every page by Revora: avoid running a file twice
    const first = file.split("/")[0];
    if (file === first && !/^[a-z0-9]/.test(first)) file = "f-" + file;
    return uniq(file.slice(0, 120));
  };
  const outPage = new Map(); // lower source path -> revora file
  const outText = new Map();
  const outAsset = new Map(); // lower source path -> public url
  const assets = [];
  const BIG_TEXT = 380_000; // site files are capped at 400k characters; bigger css/js is hosted as an asset
  for (const e of entries){
    const k = key(e.path), ext = extOf(e.path);
    if (/\.html?$/i.test(e.path)) {
      outPage.set(k, pageName(e));
      continue;
    }
    if ((ext === "css" || ext === "js") && e.bytes.length < BIG_TEXT) {
      outText.set(k, textName(e));
      continue;
    }
    const safe = e.path.split("/").map(slugPart).filter(Boolean).join("/") || "file";
    const name = uniq("assets-" + safe.replace(/\//g, "__")).replace(/^assets-/, "");
    assets.push({
      from: e.path,
      name,
      bytes: e.bytes,
      mime: mimeOf(e.path)
    });
    outAsset.set(k, `${assetBase}${name.split("/").map(encodeURIComponent).join("/")}`);
  }
  const pageUrlFor = (srcKey)=>{
    const f = outPage.get(srcKey);
    if (!f) return null;
    if (f === "thanks.html" && siteLinks) return siteLinks.thanksUrl;
    return null;
  };
  // 4. rewrite references
  const missing = new Set();
  const mapRef = (fromDir, ref, kind)=>{
    const r = resolvePath(fromDir, ref);
    if (r === null) return null;
    const k = key(r);
    if (outAsset.has(k)) return outAsset.get(k);
    if (outText.has(k)) return outText.get(k); // bundled by Revora into the page
    // folder style page links: "thank-you/" or "about"
    const cands = [
      k,
      k + ".html",
      k.replace(/\/$/, "") + "/index.html",
      k.replace(/\/$/, "") + ".html"
    ];
    for (const c of cands){
      const u = pageUrlFor(c);
      if (u) return u;
    }
    if (kind === "html" && /\.(png|jpe?g|gif|webp|svg|mp4|webm|woff2?|ttf|otf|pdf|css|js)$/i.test(r)) missing.add(r);
    return null;
  };
  const rewriteSrcset = (fromDir, v)=>v.split(",").map((part)=>{
      const m = part.trim().match(/^(\S+)(\s+.*)?$/);
      if (!m) return part;
      const u = mapRef(fromDir, m[1], "html");
      return (u ?? m[1]) + (m[2] ?? "");
    }).join(", ");
  const rewriteCss = (fromDir, css)=>css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref)=>{
      const u = mapRef(fromDir, ref, "css");
      return u ? `url(${q}${u}${q})` : m;
    });
  // A script's file paths are normally relative to the PAGE that loads it, so try the page folder first, then the script's own folder.
  const rewriteJs = (fromDir, js, altDir)=>js.replace(/(["'`])((?:\.{0,2}\/)?[A-Za-z0-9_\-. %&/]+\.(?:png|jpe?g|gif|webp|svg|mp4|webm|woff2?|ttf|otf|pdf))\1/g, (m, q, ref)=>{
      const u = mapRef(fromDir, ref, "css") ?? (altDir !== undefined ? mapRef(altDir, ref, "css") : null);
      return u ? `${q}${u}${q}` : m;
    });
  const rewriteHtml = (fromDir, html)=>{
    let out = html.replace(/(<(?:img|source|video|audio|track|embed|input|script|link|a|iframe|object|image|use)\b[^>]*?)(\s(?:src|href|poster|data|data-src|data-lazy-src|data-original|data-bg|data-background|xlink:href)\s*=\s*)(["'])(.*?)\3/gis, (m, pre, attr, q, val)=>{
      if (/^<a\b/i.test(pre) && /^(mailto:|tel:|sms:|https?:|#|javascript:)/i.test(val.trim())) return m;
      const u = mapRef(fromDir, val, "html");
      return u ? `${pre}${attr}${q}${u}${q}` : m;
    });
    out = out.replace(/(\s(?:srcset|data-srcset)\s*=\s*)(["'])(.*?)\2/gis, (_m, attr, q, val)=>`${attr}${q}${rewriteSrcset(fromDir, val)}${q}`);
    out = out.replace(/(\sstyle\s*=\s*)(["'])(.*?)\2/gis, (_m, attr, q, val)=>`${attr}${q}${rewriteCss(fromDir, val)}${q}`);
    out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (blk)=>rewriteCss(fromDir, blk));
    out = out.replace(/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi, (blk)=>rewriteJs(fromDir, blk));
    return out;
  };
  const pages = [];
  const textFiles = [];
  for (const e of entries){
    const k = key(e.path), dir = dirOf(e.path);
    if (outPage.has(k)) pages.push({
      file: outPage.get(k),
      from: e.path,
      content: rewriteHtml(dir, td.decode(e.bytes)),
      role: outPage.get(k) === "index.html" ? "index" : outPage.get(k) === "thanks.html" ? "thanks" : "page"
    });
    else if (outText.has(k)) {
      const src = td.decode(e.bytes);
      textFiles.push({
        file: outText.get(k),
        from: e.path,
        content: extOf(e.path) === "css" ? rewriteCss(dir, src) : rewriteJs("", src, dir)
      });
    }
  }
  // css/js too big to be a site file: host it, rewriting its own references first
  for (const a of assets){
    const ext = extOf(a.from);
    if ((ext === "css" || ext === "js") && a.bytes.length >= BIG_TEXT) {
      const src = td.decode(a.bytes);
      a.bytes = new TextEncoder().encode(ext === "css" ? rewriteCss(dirOf(a.from), src) : rewriteJs("", src, dirOf(a.from)));
      warnings.push(`${a.from} is large, so it is hosted as a file instead of being built into the page.`);
    }
  }
  pages.sort((x, y)=>x.role === "index" ? -1 : y.role === "index" ? 1 : x.file.localeCompare(y.file));
  if (missing.size) warnings.push(`${missing.size} file(s) the page points to were not in the zip: ${[
    ...missing
  ].slice(0, 6).join(", ")}${missing.size > 6 ? ", ..." : ""}.`);
  if (!thanksSrc) notes.push("No thank-you page was found in the zip. Revora's own thank-you page is used after an order placed with the Revora form.");
  // 5. pixels and foreign pieces (read-only: nothing is removed)
  const pixelIds = (s)=>[
      ...new Set([
        ...s.matchAll(/fbq\s*\(\s*['"]init['"]\s*,\s*['"]?(\d{8,20})/g)
      ].map((m)=>m[1]).concat([
        ...s.matchAll(/facebook\.com\/tr\?id=(\d{8,20})/g)
      ].map((m)=>m[1])))
    ];
  const perPage = {};
  const all = new Set();
  const inBodyOnly = [];
  for (const p of pages){
    const ids = pixelIds(p.content);
    if (ids.length) perPage[p.file] = ids;
    ids.forEach((i)=>all.add(i));
    const head = (p.content.match(/<head[^>]*>([\s\S]*?)<\/head>/i) ?? [])[1] ?? "";
    if (ids.length && !/fbq\s*\(/.test(head)) inBodyOnly.push(p.file);
  }
  const hosts = {
    scripts: new Set(),
    iframes: new Set(),
    formActions: new Set()
  };
  const hostOf = (u)=>{
    try {
      return new URL(u.trim().startsWith("//") ? "https:" + u.trim() : u.trim()).hostname.toLowerCase();
    } catch  {
      return "";
    }
  };
  for (const p of pages){
    for (const m of p.content.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi))if (isAbs(m[1])) {
      const h = hostOf(m[1]);
      if (h) hosts.scripts.add(h);
    }
    for (const m of p.content.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi))if (isAbs(m[1])) {
      const h = hostOf(m[1]);
      if (h) hosts.iframes.add(h);
    }
    for (const m of p.content.matchAll(/<form\b[^>]*\baction\s*=\s*["']([^"']+)["']/gi))if (isAbs(m[1])) {
      const h = hostOf(m[1]);
      if (h) hosts.formActions.add(h);
    }
  }
  return {
    pages,
    textFiles,
    assets,
    pixels: {
      ids: [
        ...all
      ],
      perPage,
      inBodyOnly
    },
    hosts: {
      scripts: [
        ...hosts.scripts
      ],
      iframes: [
        ...hosts.iframes
      ],
      formActions: [
        ...hosts.formActions
      ]
    },
    notes,
    warnings
  };
}
// Swap every pixel id on a page for another one (only called when the person chose "swap").
export function swapPixel(html, toId) {
  return html.replace(/(fbq\s*\(\s*['"]init['"]\s*,\s*['"]?)(\d{8,20})/g, `$1${toId}`).replace(/(facebook\.com\/tr\?id=)(\d{8,20})/g, `$1${toId}`);
}
// Revora skips its own pixel only when the page's pixel code sits in <head>. When "keep" is chosen and the person's pixel
// is in the body, move that pixel block (and its <noscript> image) into <head>: same code, the place Meta documents.
export function hoistPixel(html) {
  const at = html.search(/<\/head>/i);
  if (at < 0) return html;
  const head = html.slice(0, at), rest = html.slice(at);
  const moved = [];
  const out = rest.replace(/<script\b(?![^>]*\bsrc\s*=)[^>]*>(?:(?!<\/script>)[\s\S])*?fbq\s*\(\s*['"]init['"][\s\S]*?<\/script>/gi, (m)=>{
    moved.push(m);
    return "";
  }).replace(/<noscript>\s*<img\b[^>]*facebook\.com\/tr\?id=\d+[^>]*>\s*<\/noscript>/gi, (m)=>{
    moved.push(m);
    return "";
  });
  return moved.length ? head + "\n" + moved.join("\n") + "\n" + out : html;
}
