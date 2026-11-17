import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AI chat for the site IDE (Claude). The assistant works on ONE site, using the same file tools (mcp-code) as ChatGPT/Claude connected over MCP,
// so every edit is versioned, safety-checked and undoable from History. It cannot publish or roll back: only the person does that.
//   POST { site_id, messages: [{ role: "user" | "assistant", content: string }] }  ->  { reply, changed: [paths], steps }
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("SITE_AI_MODEL") ?? "claude-sonnet-5-5";
const db = createClient(SUPABASE_URL, SERVICE);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors } });
const ALLOWED = ["site_list_files", "site_read_file", "site_search", "site_write_file", "site_patch_file", "site_delete_file"];
const MAX_STEPS = 12;

async function code(body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mcp-code`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": SERVICE }, body: JSON.stringify(body) });
  return await r.json().catch(() => ({}));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!KEY) return json({ error: "AI chat is not switched on yet (ANTHROPIC_API_KEY)." }, 503);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: ud } = await db.auth.getUser(token);
  if (!ud?.user) return json({ error: "Please log in." }, 401);
  const { data: p } = await db.from("profiles").select("company_id, role, display_name, media_buyer_id").eq("id", ud.user.id).maybeSingle();
  if (!p?.company_id) return json({ error: "No company on this account." }, 403);
  const ctx = { token, userId: ud.user.id, email: ud.user.email ?? null, companyId: p.company_id, role: p.role ?? "", mediaBuyerId: p.media_buyer_id ?? null, displayName: p.display_name ?? "" };
  const b = await req.json().catch(() => ({}));
  const siteId = String(b?.site_id ?? "");
  const active = String(b?.active_file ?? "").slice(0, 200);
  const { data: site } = await db.from("sites").select("id, company_id, name").eq("id", siteId).maybeSingle();
  if (!site || site.company_id !== ctx.companyId) return json({ error: "Site not found." }, 404);
  const history = (Array.isArray(b?.messages) ? b.messages : []).slice(-20).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 8000) })).filter((m: any) => m.content);
  if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Send a message." }, 400);

  const listed = await code({ action: "list" });
  const tools = (listed?.tools ?? []).filter((t: any) => ALLOWED.includes(t.name)).map((t: any) => {
    const schema = JSON.parse(JSON.stringify(t.inputSchema ?? { type: "object", properties: {} }));
    if (schema.properties) delete schema.properties.site_id;
    if (Array.isArray(schema.required)) schema.required = schema.required.filter((x: string) => x !== "site_id");
    return { name: t.name, description: String(t.description ?? "").slice(0, 900), input_schema: schema };
  });

  const system = `You are the coding assistant inside Revora's site IDE, working on the site "${site.name}". You change the site by reading and editing its files with the tools.
Rules: look at the file list first, read a file before you change it, prefer small exact edits (site_patch_file) over rewriting whole files, keep what already works, keep the Revora order form and pixel as they are. Do the work, then reply in 1 to 4 short sentences saying what you changed and in which files. If a tool refuses something, explain it plainly and offer another way. The person currently has ${active ? `"${active}" open in the editor (changes about "this page" or "here" usually mean that file)` : "no file open"}. You cannot publish the site or undo changes; the person does that from the IDE (History restores any earlier version). Write in plain, friendly English.`;

  const messages: any[] = history.map((m: any) => ({ role: m.role, content: m.content }));
  const changed = new Set<string>();
  let reply = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, system, tools, messages }),
    });
    const o = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: o?.error?.message || "The AI request failed." }, 502);
    messages.push({ role: "assistant", content: o.content });
    const texts = (o.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
    const uses = (o.content ?? []).filter((c: any) => c.type === "tool_use");
    if (!uses.length) { reply = texts; break; }
    const results: any[] = [];
    for (const u of uses) {
      let out: any;
      try {
        if (!ALLOWED.includes(u.name)) throw new Error("That tool isn't available here.");
        const res = await code({ action: "call", tool: u.name, args: { ...(u.input ?? {}), site_id: siteId }, ctx });
        out = res?.out ?? res;
        if (!out?.error && ["site_write_file", "site_patch_file", "site_delete_file"].includes(u.name) && u.input?.path) changed.add(String(u.input.path));
      } catch (e) { out = { error: String((e as Error).message ?? e) }; }
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000), is_error: !!out?.error });
    }
    messages.push({ role: "user", content: results });
    if (step === MAX_STEPS - 1) reply = texts || "I made some changes but ran out of steps. Ask me to continue.";
  }
  return json({ reply: reply || "Done.", changed: [...changed] });
});
