import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Custom domains for the website builder (Settings -> Domains).
//   POST { action: "add",    hostname, media_buyer_id?, site_id? }   owner/admin (any buyer) or a media buyer (always theirs)
//        { action: "check",  id }                                    owner/admin or the assigned buyer
//        { action: "assign", id, media_buyer_id?, site_id? }         owner/admin (buyer + site) or the assigned buyer (site only)
//        { action: "remove", id }                                    owner/admin or the assigned buyer
// The hostname is registered on the dedicated sites Vercel project, which then serves it (api/site.js).
// Secrets: VERCEL_API_TOKEN, VERCEL_SITES_PROJECT_ID (and optionally VERCEL_TEAM_ID).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VERCEL_TOKEN = Deno.env.get("VERCEL_API_TOKEN") ?? "";
const VERCEL_PROJECT = Deno.env.get("VERCEL_SITES_PROJECT_ID") ?? "";
const VERCEL_TEAM = Deno.env.get("VERCEL_TEAM_ID") ?? "team_gVtophWuO8VG2WgELZemZZbj";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey"
};
const json = (obj, status = 200)=>new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
const SECOND_LEVEL = new Set([
  "co.uk",
  "org.uk",
  "com.ng",
  "org.ng",
  "net.ng",
  "edu.ng",
  "gov.ng",
  "com.gh",
  "co.za",
  "co.ke",
  "com.au",
  "co.nz",
  "com.br"
]);
function isApex(host) {
  const labels = host.split(".");
  if (labels.length <= 2) return true;
  return labels.length === 3 && SECOND_LEVEL.has(labels.slice(1).join("."));
}
function dnsFor(host, verification = []) {
  const rows = isApex(host) ? [
    {
      type: "A",
      name: "@",
      value: "76.76.21.21",
      note: "Point the root of your domain here"
    }
  ] : [
    {
      type: "CNAME",
      name: host.split(".")[0],
      value: "cname.vercel-dns.com",
      note: "Point this subdomain here"
    }
  ];
  for (const v of verification || [])rows.push({
    type: v.type || "TXT",
    name: v.domain || "_vercel",
    value: v.value,
    note: "Ownership check (only needed if the domain was used elsewhere)"
  });
  return rows;
}
async function vercel(path, init = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.vercel.com${path}${sep}teamId=${VERCEL_TEAM}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers ?? {}
    }
  });
  const body = await res.json().catch(()=>({}));
  return {
    ok: res.ok,
    status: res.status,
    body
  };
}
// ── Cloudflare (DNS, HTTPS and cache in front of Vercel) ────────────────────────────────────────────────────────────────────
// A root domain added here gets a Cloudflare zone in the platform's account. The customer only changes the domain's name servers; Revora creates the DNS records,
// turns on strict HTTPS and caches published pages at the edge. Ad-tracking tags (fbclid, utm_*, ...) are dropped from the CACHED request only, so every ad click
// shares one saved copy, while the visitor's own link is untouched and the Meta pixel still reads every tag in the browser. Previews (pt=, preview=) are never cached.
const CF_TOKEN = Deno.env.get("CLOUDFLARE_API_TOKEN") ?? "";
const CF_ACCOUNT = Deno.env.get("R2_ACCOUNT_ID") ?? "";
const TRACKING = ["fbclid", "gclid", "ttclid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "ad_id", "asid", "crid", "buyer"];
async function cf(method, path, body) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return await r.json().catch(()=>({ success: false, errors: [{ message: "Cloudflare did not answer" }] }));
}
const cfErr = (j) => (j?.errors?.[0]?.message || "Cloudflare refused the request").slice(0, 200);
function apexOf(host) {
  const l = host.split(".");
  return l.length >= 3 && SECOND_LEVEL.has(l.slice(-2).join(".")) ? l.slice(-3).join(".") : l.slice(-2).join(".");
}
async function cfFindZone(apex) {
  const j = await cf("GET", `/zones?name=${encodeURIComponent(apex)}`);
  return j?.result?.[0] ?? null;
}
async function cfEnsureRecords(zoneId, hosts) {
  const have = (await cf("GET", `/zones/${zoneId}/dns_records?per_page=100`))?.result ?? [];
  for (const h of hosts) {
    if (have.some((x)=>x.name === h && ["CNAME", "A", "AAAA"].includes(x.type))) continue; // never overwrite a record the customer already had
    await cf("POST", `/zones/${zoneId}/dns_records`, { type: "CNAME", name: h, content: "cname.vercel-dns.com", ttl: 1, proxied: true });
  }
}
async function cfHarden(zoneId, apex) {
  // Settings: strict HTTPS everywhere, modern TLS, HTTP/3, compression.
  for (const [k, v] of [["ssl", "strict"], ["always_use_https", "on"], ["min_tls_version", "1.2"], ["http3", "on"], ["brotli", "on"], ["early_hints", "on"]]) await cf("PATCH", `/zones/${zoneId}/settings/${k}`, { value: v });
  // Put the proxy (orange cloud) on the records that point at Vercel.
  const recs = (await cf("GET", `/zones/${zoneId}/dns_records?per_page=100`))?.result ?? [];
  for (const x of recs) if (x.type === "CNAME" && /vercel-dns\.com$/.test(x.content) && !x.proxied) await cf("PATCH", `/zones/${zoneId}/dns_records/${x.id}`, { proxied: true });
  // Rules cover every Revora domain that lives in this zone.
  const { data: doms } = await admin.from("site_domains").select("hostname").eq("cf_zone_id", zoneId);
  const hosts = new Set();
  for (const d of doms ?? []) { hosts.add(d.hostname); if (d.hostname === apex) hosts.add(`www.${apex}`); }
  if (!hosts.size) return;
  const list = [...hosts].map((h)=>`"${h}"`).join(" ");
  const cond = `(http.host in {${list}}) and (http.request.method eq "GET") and not (http.request.uri.query contains "pt=") and not (http.request.uri.query contains "preview=")`;
  let stripped = "http.request.uri.query";
  for (const k of TRACKING) stripped = `remove_query_args(${stripped}, "${k}")`;
  await cf("PUT", `/zones/${zoneId}/rulesets/phases/http_request_transform/entrypoint`, { rules: [{ description: "Revora: drop ad-tracking tags from the cached request only (the visitor's link is unchanged)", expression: `${cond} and http.request.uri.query ne ""`, action: "rewrite", action_parameters: { uri: { query: { expression: stripped } } }, enabled: true }] });
  await cf("PUT", `/zones/${zoneId}/rulesets/phases/http_request_cache_settings/entrypoint`, { rules: [{ description: "Revora: cache published pages for 2 minutes (previews are never cached)", expression: cond, action: "set_cache_settings", action_parameters: { cache: true, edge_ttl: { mode: "override_origin", default: 120 }, browser_ttl: { mode: "respect_origin" } }, enabled: true }] });
}
function nsRows(zone) {
  return (zone?.name_servers ?? []).map((n)=>({ type: "NS", name: "@", value: n, note: "At your domain registrar, set the name servers to these two (this puts the domain on Cloudflare for speed)" }));
}

async function getCaller(req) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await admin.from("profiles").select("company_id, role, media_buyer_id").eq("id", data.user.id).maybeSingle();
  return p?.company_id ? {
    id: data.user.id,
    company_id: p.company_id,
    role: p.role,
    media_buyer_id: p.media_buyer_id ?? null
  } : null;
}
function normalizeHost(raw) {
  return String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[\/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
}
async function checkWithVercel(row) {
  if (!VERCEL_TOKEN || !VERCEL_PROJECT) return {
    status: "pending",
    error: "Domains aren't switched on for this platform yet (VERCEL_API_TOKEN / VERCEL_SITES_PROJECT_ID not set).",
    dns: dnsFor(row.hostname)
  };
  const dom = await vercel(`/v9/projects/${VERCEL_PROJECT}/domains/${encodeURIComponent(row.hostname)}`);
  if (!dom.ok) return {
    status: "error",
    error: dom.body?.error?.message || "Domain isn't registered on the sites project.",
    dns: dnsFor(row.hostname)
  };
  let verified = !!dom.body.verified;
  if (!verified) {
    const v = await vercel(`/v9/projects/${VERCEL_PROJECT}/domains/${encodeURIComponent(row.hostname)}/verify`, {
      method: "POST"
    });
    verified = !!v.body?.verified;
    if (!verified) return {
      status: "pending",
      error: null,
      dns: dnsFor(row.hostname, dom.body.verification)
    };
  }
  const cfg = await vercel(`/v6/domains/${encodeURIComponent(row.hostname)}/config?projectIdOrName=${VERCEL_PROJECT}`);
  if (cfg.ok && cfg.body?.misconfigured === false) return {
    status: "active",
    error: null,
    dns: dnsFor(row.hostname)
  };
  return {
    status: "pending",
    error: null,
    dns: dnsFor(row.hostname)
  };
}
// One status check: Cloudflare first (is the domain on Cloudflare yet? then apply HTTPS, proxy and cache), then Vercel (is it serving the site?).
async function runCheck(row) {
  let r = null, cfStatus = row.cf_status ?? null;
  if (CF_TOKEN && row.cf_zone_id) {
    let z = (await cf("GET", `/zones/${row.cf_zone_id}`))?.result;
    if (z && z.status !== "active") {
      await cf("PUT", `/zones/${row.cf_zone_id}/activation_check`);
      z = (await cf("GET", `/zones/${row.cf_zone_id}`))?.result ?? z;
    }
    if (z) {
      cfStatus = z.status;
      if (z.status !== "active") r = { status: "pending", error: null, dns: nsRows(z) };
      else if (row.cf_status !== "active") await cfHarden(row.cf_zone_id, apexOf(row.hostname));
    }
  }
  if (!r) r = await checkWithVercel(row);
  const { data: upd } = await admin.from("site_domains").update({ status: r.status, last_error: r.error, dns: r.dns, cf_status: cfStatus, checked_at: new Date().toISOString() }).eq("id", row.id).select("*").single();
  return upd;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: CORS
  });
  if (req.method !== "POST") return json({
    error: "POST only"
  }, 405);
  // Scheduler: re-check every domain that is not live yet, so customers never have to press "Check".
  const cronKey = req.headers.get("x-cron-secret") || "";
  if (cronKey) {
    const { data: sec } = await admin.from("app_secrets").select("value").eq("key", "ads_cron_secret").maybeSingle();
    if (!sec?.value || cronKey !== sec.value) return json({ error: "Unauthorized" }, 401);
    const { data: rows } = await admin.from("site_domains").select("*").neq("status", "active").order("checked_at", { ascending: true, nullsFirst: true }).limit(30);
    let n = 0;
    for (const row of rows ?? []) { try { await runCheck(row); n++; } catch (e) { console.error("check failed", row.hostname, e?.message); } }
    return json({ ok: true, checked: n });
  }
  const me = await getCaller(req);
  if (!me) return json({
    error: "Not signed in"
  }, 401);
  const isAdmin = me.role === "owner" || me.role === "admin";
  let body = {};
  try {
    body = await req.json();
  } catch  {}
  const action = String(body?.action || "");
  const loadRow = async (id)=>{
    const { data } = await admin.from("site_domains").select("*").eq("id", id).eq("company_id", me.company_id).maybeSingle();
    return data;
  };
  const siteOk = async (siteId, buyerScope)=>{
    if (!siteId) return true;
    const { data: s } = await admin.from("sites").select("id, company_id, media_buyer_id").eq("id", siteId).maybeSingle();
    if (!s || s.company_id !== me.company_id) return false;
    return buyerScope ? s.media_buyer_id === buyerScope : true;
  };
  const buyerOk = async (buyerId)=>{
    if (!buyerId) return true;
    const { data: b } = await admin.from("media_buyers").select("id").eq("id", buyerId).eq("company_id", me.company_id).maybeSingle();
    return !!b;
  };
  try {
    if (action === "add") {
      if (!isAdmin && !(me.role === "buyer" && me.media_buyer_id)) return json({
        error: "Only an owner, admin or media buyer can connect a domain."
      }, 403);
      const hostname = normalizeHost(body.hostname);
      if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname)) return json({
        error: "That doesn't look like a domain (example: shop.mybrand.com)."
      }, 400);
      if (/\.vercel\.app$|\.supabase\.co$/.test(hostname)) return json({
        error: "Use your own domain, not a vercel.app address."
      }, 400);
      // A buyer's domain is always theirs, and can only show their own sites.
      const buyerId = isAdmin ? body.media_buyer_id || null : me.media_buyer_id, siteId = body.site_id || null;
      if (!await buyerOk(buyerId)) return json({
        error: "Unknown media buyer."
      }, 400);
      if (!await siteOk(siteId, isAdmin ? null : me.media_buyer_id)) return json({
        error: "Unknown site."
      }, 400);
      const { data: existing } = await admin.from("site_domains").select("id").eq("hostname", hostname).maybeSingle();
      if (existing) return json({
        error: "This domain is already connected."
      }, 409);
      let status = "pending", lastError = null, dns = dnsFor(hostname);
      if (VERCEL_TOKEN && VERCEL_PROJECT) {
        const add = await vercel(`/v10/projects/${VERCEL_PROJECT}/domains`, {
          method: "POST",
          body: JSON.stringify({
            name: hostname
          })
        });
        if (!add.ok) {
          const code = add.body?.error?.code;
          if (code === "domain_already_in_use" || code === "domain_taken" || add.status === 409) return json({
            error: "That domain is already attached to another Vercel project. Remove it there first, or use a different domain."
          }, 409);
          return json({
            error: add.body?.error?.message || "Couldn't register the domain."
          }, 502);
        }
        dns = dnsFor(hostname, add.body.verification);
      } else {
        lastError = "Saved. It will start working once the platform's domain connection is switched on.";
      }
      // Cloudflare: a root domain gets its own zone; a subdomain uses the zone if the platform already hosts that domain.
      let cfZoneId = null, cfStatus = null;
      if (CF_TOKEN && CF_ACCOUNT) {
        try {
          const apex = apexOf(hostname), isRoot = hostname === apex;
          let zone = await cfFindZone(apex);
          if (!zone && isRoot) {
            const c = await cf("POST", "/zones", { name: apex, account: { id: CF_ACCOUNT }, type: "full", jump_start: true });
            if (c.success) zone = c.result; else lastError = `Cloudflare could not take this domain (${cfErr(c)}). Use the records below instead.`;
          }
          if (zone) {
            cfZoneId = zone.id; cfStatus = zone.status;
            await cfEnsureRecords(zone.id, isRoot ? [apex, `www.${apex}`] : [hostname]);
            if (isRoot && VERCEL_TOKEN && VERCEL_PROJECT) await vercel(`/v10/projects/${VERCEL_PROJECT}/domains`, { method: "POST", body: JSON.stringify({ name: `www.${apex}`, redirect: apex, redirectStatusCode: 308 }) });
            if (zone.status === "active") await cfHarden(zone.id, apex); else dns = nsRows(zone);
          }
        } catch (e) { lastError = `Cloudflare setup did not finish (${String(e?.message ?? e).slice(0, 120)}). Use the records below instead.`; }
      }
      const { data: row, error } = await admin.from("site_domains").insert({
        company_id: me.company_id,
        hostname,
        site_id: siteId,
        media_buyer_id: buyerId,
        status,
        dns,
        last_error: lastError,
        created_by: me.id,
        cf_zone_id: cfZoneId,
        cf_status: cfStatus
      }).select("*").single();
      if (error) return json({
        error: error.message
      }, 500);
      return json({
        ok: true,
        domain: row
      });
    }
    if (action === "check") {
      const row = await loadRow(String(body.id || ""));
      if (!row) return json({
        error: "Domain not found"
      }, 404);
      if (!isAdmin && !(row.media_buyer_id && row.media_buyer_id === me.media_buyer_id)) return json({
        error: "Forbidden"
      }, 403);
      const upd = await runCheck(row);
      return json({
        ok: true,
        domain: upd
      });
    }
    if (action === "assign") {
      const row = await loadRow(String(body.id || ""));
      if (!row) return json({
        error: "Domain not found"
      }, 404);
      const patch = {};
      if (isAdmin) {
        if ("media_buyer_id" in body) {
          if (!await buyerOk(body.media_buyer_id || null)) return json({
            error: "Unknown media buyer."
          }, 400);
          patch.media_buyer_id = body.media_buyer_id || null;
        }
        if ("site_id" in body) {
          if (!await siteOk(body.site_id || null, null)) return json({
            error: "Unknown site."
          }, 400);
          patch.site_id = body.site_id || null;
        }
      } else {
        if (!(row.media_buyer_id && row.media_buyer_id === me.media_buyer_id)) return json({
          error: "Forbidden"
        }, 403);
        if (!("site_id" in body) || !await siteOk(body.site_id || null, me.media_buyer_id)) return json({
          error: "Pick one of your own sites."
        }, 400);
        patch.site_id = body.site_id || null;
      }
      const { data: upd, error } = await admin.from("site_domains").update(patch).eq("id", row.id).select("*").single();
      if (error) return json({
        error: error.message
      }, 500);
      return json({
        ok: true,
        domain: upd
      });
    }
    if (action === "remove") {
      const row = await loadRow(String(body.id || ""));
      if (!row) return json({
        error: "Domain not found"
      }, 404);
      if (!isAdmin && !(row.media_buyer_id && row.media_buyer_id === me.media_buyer_id)) return json({
        error: "You can only remove your own domains."
      }, 403);
      if (VERCEL_TOKEN && VERCEL_PROJECT) await vercel(`/v9/projects/${VERCEL_PROJECT}/domains/${encodeURIComponent(row.hostname)}`, {
        method: "DELETE"
      });
      if (CF_TOKEN && row.cf_zone_id) {
        try {
          const apex = apexOf(row.hostname), names = new Set([row.hostname, ...(row.hostname === apex ? [`www.${apex}`] : [])]);
          const recs = (await cf("GET", `/zones/${row.cf_zone_id}/dns_records?per_page=100`))?.result ?? [];
          for (const x of recs) if (names.has(x.name) && x.type === "CNAME" && /vercel-dns\.com$/.test(x.content)) await cf("DELETE", `/zones/${row.cf_zone_id}/dns_records/${x.id}`);
        } catch (_e) { /* the domain is removed either way */ }
      }
      await admin.from("site_domains").delete().eq("id", row.id);
      return json({
        ok: true
      });
    }
    return json({
      error: "Unknown action"
    }, 400);
  } catch (err) {
    console.error("manage-domain error:", err);
    return json({
      error: err.message || "Something went wrong"
    }, 500);
  }
});
