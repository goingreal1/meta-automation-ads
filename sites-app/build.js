/* Builds the dedicated "sites" Vercel project with the Build Output API.
   It serves ONLY customer pages: the /api/site renderer, /rv/* assets and the Zumifa preview.
   No dashboard, builder or login page exists in this deployment, so a script on a customer page
   can never reach a dashboard session. Every hostname (revora-sites.vercel.app and customers'
   custom domains) is handled by the same function; see api/site.js. */
const fs = require("fs"), path = require("path");
// Works whether Vercel runs it from the repo root or from sites-app/ (the output always goes to <cwd>/.vercel/output).
const ROOT = [path.join(__dirname, ".."), process.cwd()].find((d) => fs.existsSync(path.join(d, "rv", "form.js")));
if (!ROOT) { console.error("build.js: can't find the rv/ folder (is 'include source files outside the root directory' on?)", { __dirname, cwd: process.cwd() }); process.exit(1); }
const OUT = path.join(process.cwd(), ".vercel", "output");
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true });

rm(path.join(process.cwd(), ".vercel"));
fs.mkdirSync(OUT, { recursive: true });

// static files
copy("rv", "static/rv");
copy("icons", "static/icons");
copy("zumifa-preview.html", "static/zumifa-preview.html");

// the renderer + the files it reads at runtime
const fn = "functions/api/site.func";
copy("api/site.js", fn + "/api/site.js");
copy("rv", fn + "/rv");
fs.writeFileSync(path.join(OUT, fn, ".rv-sites"), "1");
fs.writeFileSync(path.join(OUT, fn, ".vc-config.json"), JSON.stringify({
  runtime: "nodejs22.x", handler: "api/site.js", launcherType: "Nodejs", maxDuration: 15,
}));

const sec = { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" };
fs.writeFileSync(path.join(OUT, "config.json"), JSON.stringify({
  version: 3,
  routes: [
    { src: "/(.*)", headers: sec, continue: true },
    { src: "/rv/(.*)", headers: { "cache-control": "public, max-age=300, stale-while-revalidate=86400" }, continue: true },
    { src: "/icons/(.*)", headers: { "cache-control": "public, max-age=86400" }, continue: true },
    { src: "/zumifa-preview\\.html", headers: { "cache-control": "no-cache, no-store, must-revalidate" }, continue: true },
    { handle: "filesystem" },
    // everything else (/s/<slug>/<page>, and "/<page>" on custom domains) is a site page
    { src: "/(.*)", dest: "/api/site?__p=$1" },
  ],
}));
console.log("sites-app built:", fs.readdirSync(OUT).join(", "));
