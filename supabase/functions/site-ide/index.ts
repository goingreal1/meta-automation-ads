import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Backend for the dashboard's site IDE. It runs the same file tools the AI assistants use (mcp-code), for the logged-in person,
// so every save keeps versions, is checked by the same safety rules, and rebuilds the live pages exactly as before.
//   POST { action: "tool", tool, args }      one of the allowed site_* tools
//   POST { action: "get", site_id, path }    raw file text + version (what the editor opens)
//   POST { action: "get_many", site_id, paths: [...] }   several files at once (the live preview needs them)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(SUPABASE_URL, SERVICE);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors } });
const TOOLS = new Set(["site_new", "site_list_files", "site_search", "site_write_file", "site_patch_file", "site_delete_file", "site_history", "site_rollback", "site_set_live"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: ud } = await db.auth.getUser(token);
  if (!ud?.user) return json({ error: "Please log in." }, 401);
  const { data: p } = await db.from("profiles").select("company_id, role, display_name, media_buyer_id").eq("id", ud.user.id).maybeSingle();
  if (!p?.company_id) return json({ error: "No company on this account." }, 403);
  const ctx = { token, userId: ud.user.id, email: ud.user.email ?? null, companyId: p.company_id, role: p.role ?? "", mediaBuyerId: p.media_buyer_id ?? null, displayName: p.display_name ?? "" };
  const b = await req.json().catch(() => ({}));

  if (b?.action === "tool") {
    if (!TOOLS.has(String(b?.tool))) return json({ error: "Unknown tool." }, 400);
    const r = await fetch(`${SUPABASE_URL}/functions/v1/mcp-code`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": SERVICE },
      body: JSON.stringify({ action: "call", tool: b.tool, args: b.args && typeof b.args === "object" ? b.args : {}, ctx }),
    });
    const o = await r.json().catch(() => ({}));
    return json(o?.out ?? o, r.ok ? 200 : 502);
  }

  if (b?.action === "ai") {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/site-ide-ai`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ site_id: b.site_id, messages: b.messages }) });
    const o = await r.json().catch(() => ({}));
    return json(o, r.ok ? 200 : r.status);
  }

  if (b?.action === "get" || b?.action === "get_many") {
    const siteId = String(b?.site_id ?? "");
    const { data: site } = await db.from("sites").select("id, company_id").eq("id", siteId).maybeSingle();
    if (!site || site.company_id !== ctx.companyId) return json({ error: "Site not found." }, 404);
    const paths: string[] = b.action === "get" ? [String(b?.path ?? "")] : (Array.isArray(b?.paths) ? b.paths.map(String).slice(0, 80) : []);
    const { data: files } = await db.from("site_files").select("path, content, version").eq("site_id", siteId).in("path", paths);
    if (b.action === "get") return files?.[0] ? json(files[0]) : json({ error: "File not found." }, 404);
    return json({ files: files ?? [] });
  }
  return json({ error: "Unknown action." }, 400);
});
