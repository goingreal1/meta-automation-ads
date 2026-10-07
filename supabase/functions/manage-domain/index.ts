import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Custom domains for the website builder (Settings -> Domains).
//   POST { action: "add",    hostname, media_buyer_id?, site_id? }   owner/admin
//        { action: "check",  id }                                    owner/admin or the assigned buyer
//        { action: "assign", id, media_buyer_id?, site_id? }         owner/admin (buyer + site) or the assigned buyer (site only)
//        { action: "remove", id }                                    owner/admin
// The hostname is registered on the dedicated sites Vercel project, which then serves it (api/site.js).
// Secrets: VERCEL_API_TOKEN, VERCEL_SITES_PROJECT_ID (and optionally VERCEL_TEAM_ID).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VERCEL_TOKEN = Deno.env.get("VERCEL_API_TOKEN") ?? "";
const VERCEL_PROJECT = Deno.env.get("VERCEL_SITES_PROJECT_ID") ?? "";
const VERCEL_TEAM = Deno.env.get("VERCEL_TEAM_ID") ?? "team_gVtophWuO8VG2WgELZemZZbj";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" };
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

const SECOND_LEVEL = new Set(["co.uk", "org.uk", "com.ng", "org.ng", "net.ng", "edu.ng", "gov.ng", "com.gh", "co.za", "co.ke", "com.au", "co.nz", "com.br"]);
function isApex(host: string): boolean {
  const labels = host.split(".");
  if (labels.length <= 2) return true;
  return labels.length === 3 && SECOND_LEVEL.has(labels.slice(1).join("."));
}
function dnsFor(host: string, verification: any[] = []) {
  const rows: any[] = isApex(host)
    ? [{ type: "A", name: "@", value: "76.76.21.21", note: "Point the root of your domain here" }]
    : [{ type: "CNAME", name: host.split(".")[0], value: "cname.vercel-dns.com", note: "Point this subdomain here" }];
  for (const v of verification || []) rows.push({ type: v.type || "TXT", name: v.domain || "_vercel", value: v.value, note: "Ownership check (only needed if the domain was used elsewhere)" });
  return rows;
}

async function vercel(path: string, init: RequestInit = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.vercel.com${path}${sep}teamId=${VERCEL_TEAM}`, {
    ...init,
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function getCaller(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await admin.from("profiles").select("company_id, role, media_buyer_id").eq("id", data.user.id).maybeSingle();
  return p?.company_id ? { id: data.user.id, company_id: p.company_id as string, role: p.role as string, media_buyer_id: (p.media_buyer_id ?? null) as string | null } : null;
}

function normalizeHost(raw: string): string {
  return String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[\/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
}

async function checkWithVercel(row: { id: string; hostname: string }) {
  if (!VERCEL_TOKEN || !VERCEL_PROJECT) return { status: "pending", error: "Domains aren't switched on for this platform yet (VERCEL_API_TOKEN / VERCEL_SITES_PROJECT_ID not set).", dns: dnsFor(row.hostname) };
  const dom = await vercel(`/v9/projects/${VERCEL_PROJECT}/domains/${encodeURIComponent(row.hostname)}`);
  if (!dom.ok) return { status: "error", error: dom.body?.error?.message || "Domain isn't registered on the sites project.", dns: dnsFor(row.hostname) };
  let verified = !!dom.body.verified;
  if (!verified) {
    const v = await vercel(`/v9/projects/${VERCEL_PROJECT}/domains/${encodeURIComponent(row.hostname)}/verify`, { method: "POST" });
    verified = !!v.body?.verified;
    if (!verified) return { status: "pending", error: null, dns: dnsFor(row.hostname, dom.body.verification) };
  }
  const cfg = await vercel(`/v6/domains/${encodeURIComponent(row.hostname)}/config?projectIdOrName=${VERCEL_PROJECT}`);
  if (cfg.ok && cfg.body?.misconfigured === false) return { status: "active", error: null, dns: dnsFor(row.hostname) };
  return { status: "pending", error: null, dns: dnsFor(row.hostname) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const me = await getCaller(req);
  if (!me) return json({ error: "Not signed in" }, 401);
  const isAdmin = me.role === "owner" || me.role === "admin";
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body?.action || "");

  const loadRow = async (id: string) => {
    const { data } = await admin.from("site_domains").select("*").eq("id", id).eq("company_id", me.company_id).maybeSingle();
    return data;
  };
  const siteOk = async (siteId: string | null, buyerScope: string | null) => {
    if (!siteId) return true;
    const { data: s } = await admin.from("sites").select("id, company_id, media_buyer_id").eq("id", siteId).maybeSingle();
    if (!s || s.company_id !== me.company_id) return false;
    return buyerScope ? s.media_buyer_id === buyerScope : true;
  };
  const buyerOk = async (buyerId: string | null) => {
    if (!buyerId) return true;
    const { data: b } = await admin.from("media_buyers").select("id").eq("id", buyerId).eq("company_id", me.company_id).maybeSingle();
    return !!b;
  };

  try {
    if (action === "add") {
      if (!isAdmin) return json({ error: "Only an owner/admin can connect a domain." }, 403);
      const hostname = normalizeHost(body.hostname);
      if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname)) return json({ error: "That doesn't look like a domain (example: shop.mybrand.com)." }, 400);
      if (/\.vercel\.app$|\.supabase\.co$/.test(hostname)) return json({ error: "Use your own domain, not a vercel.app address." }, 400);
      const buyerId = body.media_buyer_id || null, siteId = body.site_id || null;
      if (!(await buyerOk(buyerId))) return json({ error: "Unknown media buyer." }, 400);
      if (!(await siteOk(siteId, null))) return json({ error: "Unknown site." }, 400);

      const { data: existing } = await admin.from("site_domains").select("id").eq("hostname", hostname).maybeSingle();
      if (existing) return json({ error: "This domain is already connected." }, 409);

      let status = "pending", lastError: string | null = null, dns = dnsFor(hostname);
      if (VERCEL_TOKEN && VERCEL_PROJECT) {
        const add = await vercel(`/v10/projects/${VERCEL_PROJECT}/domains`, { method: "POST", body: JSON.stringify({ name: hostname }) });
        if (!add.ok) {
          const code = add.body?.error?.code;
          if (code === "domain_already_in_use" || code === "domain_taken" || add.status === 409) return json({ error: "That domain is already attached to another Vercel project. Remove it there first, or use a different domain." }, 409);
          return json({ error: add.body?.error?.message || "Couldn't register the domain." }, 502);
        }
        dns = dnsFor(hostname, add.body.verification);
      } else {
        lastError = "Saved. It will start working once the platform's domain connection is switched on.";
      }
      const { data: row, error } = await admin.from("site_domains").insert({ company_id: me.company_id, hostname, site_id: siteId, media_buyer_id: buyerId, status, dns, last_error: lastError, created_by: me.id }).select("*").single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, domain: row });
    }

    if (action === "check") {
      const row = await loadRow(String(body.id || ""));
      if (!row) return json({ error: "Domain not found" }, 404);
      if (!isAdmin && !(row.media_buyer_id && row.media_buyer_id === me.media_buyer_id)) return json({ error: "Forbidden" }, 403);
      const r = await checkWithVercel(row);
      const { data: upd } = await admin.from("site_domains").update({ status: r.status, last_error: r.error, dns: r.dns, checked_at: new Date().toISOString() }).eq("id", row.id).select("*").single();
      return json({ ok: true, domain: upd });
    }

    if (action === "assign") {
      const row = await loadRow(String(body.id || ""));
      if (!row) return json({ error: "Domain not found" }, 404);
      const patch: Record<string, unknown> = {};
      if (isAdmin) {
        if ("media_buyer_id" in body) {
          if (!(await buyerOk(body.media_buyer_id || null))) return json({ error: "Unknown media buyer." }, 400);
          patch.media_buyer_id = body.media_buyer_id || null;
        }
        if ("site_id" in body) {
          if (!(await siteOk(body.site_id || null, null))) return json({ error: "Unknown site." }, 400);
          patch.site_id = body.site_id || null;
        }
      } else {
        if (!(row.media_buyer_id && row.media_buyer_id === me.media_buyer_id)) return json({ error: "Forbidden" }, 403);
        if (!("site_id" in body) || !(await siteOk(body.site_id || null, me.media_buyer_id))) return json({ error: "Pick one of your own sites." }, 400);
        patch.site_id = body.site_id || null;
      }
      const { data: upd, error } = await admin.from("site_domains").update(patch).eq("id", row.id).select("*").single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, domain: upd });
    }

    if (action === "remove") {
      if (!isAdmin) return json({ error: "Only an owner/admin can remove a domain." }, 403);
      const row = await loadRow(String(body.id || ""));
      if (!row) return json({ error: "Domain not found" }, 404);
      if (VERCEL_TOKEN && VERCEL_PROJECT) await vercel(`/v9/projects/${VERCEL_PROJECT}/domains/${encodeURIComponent(row.hostname)}`, { method: "DELETE" });
      await admin.from("site_domains").delete().eq("id", row.id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err: any) {
    console.error("manage-domain error:", err);
    return json({ error: err.message || "Something went wrong" }, 500);
  }
});
