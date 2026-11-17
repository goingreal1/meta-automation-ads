import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

// Rename a creative, edit its ad text, or delete it (and its file). Logged-in owners, admins and media buyers, for their own company only.
//   POST { action: "update", id, name?, primary_text?, headline?, description?, cta_type? }   -> changes every saved copy of that file
//   POST { action: "delete", id, force? }   -> removes the creative and its file; refuses if ads used it unless force is true
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(SUPABASE_URL, SERVICE);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors } });
const CTAS = new Set(["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "ORDER_NOW", "BUY_NOW", "GET_OFFER", "CONTACT_US", "WHATSAPP_MESSAGE", "SEND_MESSAGE", "BOOK_NOW", "APPLY_NOW", "GET_QUOTE", "DOWNLOAD", "SUBSCRIBE", "NO_BUTTON"]);

export async function removeFile(row: { storage_provider?: string | null; storage_path?: string | null }) {
  if (!row.storage_path) return;
  if (row.storage_provider === "r2") {
    const acc = Deno.env.get("R2_ACCOUNT_ID"), bucket = Deno.env.get("R2_BUCKET");
    if (!acc || !bucket) return;
    const r2 = new AwsClient({ accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!, secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!, service: "s3", region: "auto" });
    await r2.fetch(`https://${acc}.r2.cloudflarestorage.com/${bucket}/${row.storage_path.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" }).catch(() => {});
  } else {
    await db.storage.from("creative-vault").remove([row.storage_path]).catch(() => {});
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: ud } = await db.auth.getUser(token);
  if (!ud?.user) return json({ error: "Please log in." }, 401);
  const { data: me } = await db.from("profiles").select("company_id, role").eq("id", ud.user.id).maybeSingle();
  if (!me?.company_id || !["owner", "admin", "buyer"].includes(me.role)) return json({ error: "Only owners, admins and media buyers can change creatives." }, 403);
  const b = await req.json().catch(() => ({}));
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Missing creative id." }, 400);
  const { data: src } = await db.from("creative_assets").select("id, public_url, company_id").eq("id", id).eq("company_id", me.company_id).maybeSingle();
  if (!src) return json({ error: "Creative not found." }, 404);

  if (b.action === "update") {
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch.display_name = String(b.name).trim().slice(0, 120) || null;
    if (b.primary_text !== undefined) patch.primary_text = String(b.primary_text).slice(0, 2000) || null;
    if (b.headline !== undefined) patch.headline = String(b.headline).slice(0, 255) || null;
    if (b.description !== undefined) patch.description = String(b.description).slice(0, 500) || null;
    if (b.cta_type !== undefined) { const c = String(b.cta_type).toUpperCase(); if (!CTAS.has(c)) return json({ error: "Unknown button type." }, 400); patch.cta_type = c; }
    if (!Object.keys(patch).length) return json({ error: "Nothing to change." }, 400);
    const { error, count } = await db.from("creative_assets").update(patch, { count: "exact" }).eq("company_id", me.company_id).eq("public_url", src.public_url);
    return error ? json({ error: error.message }, 500) : json({ ok: true, copies: count });
  }

  if (b.action === "delete") {
    const { data: rows } = await db.from("creative_assets").select("id, storage_provider, storage_path, launch_batch_id, campaign_name").eq("company_id", me.company_id).eq("public_url", src.public_url);
    const used = (rows ?? []).filter((r: any) => r.launch_batch_id || r.campaign_name).length;
    if (used && b.force !== true) return json({ error: `This creative was used in ${used} ad${used > 1 ? "s" : ""}. Deleting it won't stop those ads, but you can't reuse it. Delete anyway?`, used, needs_force: true }, 409);
    const { error } = await db.from("creative_assets").delete().eq("company_id", me.company_id).eq("public_url", src.public_url);
    if (error) return json({ error: error.message }, 500);
    // The file goes only when no other creative row (in any company) still points at it.
    const { count: left } = await db.from("creative_assets").select("id", { count: "exact", head: true }).eq("public_url", src.public_url);
    if (!left) for (const r of rows ?? []) await removeFile(r as any);
    return json({ ok: true, deleted: rows?.length ?? 0 });
  }
  return json({ error: "Unknown action." }, 400);
});
