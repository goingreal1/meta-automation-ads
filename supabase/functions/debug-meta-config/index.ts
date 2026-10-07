import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Checks whether the shared Meta business can see one client business. Owners/admins only
// (it used to be open to anyone).
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_BUSINESS_ID = Deno.env.get("META_BUSINESS_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null };
  if (!u?.user) return json({ error: "Sign in first." }, 401);
  const { data: p } = await admin.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
  if (!p || !["owner", "admin"].includes(p.role)) return json({ error: "Owners and admins only." }, 403);

  const checkId = new URL(req.url).searchParams.get("business_id") ?? "";
  if (!/^\d+$/.test(checkId)) return json({ error: "pass ?business_id=<numeric business id>" }, 400);
  if (!META_ACCESS_TOKEN || !META_BUSINESS_ID) return json({ error: "META_ACCESS_TOKEN or META_BUSINESS_ID not set" });
  const out: Record<string, unknown> = { META_BUSINESS_ID };
  let next: string | null = `https://graph.facebook.com/v19.0/${META_BUSINESS_ID}/clients?fields=id,name,adaccount_permissions{id,access_status}&limit=200&access_token=${META_ACCESS_TOKEN}`;
  let found = null, pages = 0;
  while (next && pages < 30) {
    const res = await fetch(next);
    const data = await res.json();
    if (!res.ok) { out.error = data.error; break; }
    pages++;
    found = (data.data ?? []).find((c: any) => c.id === checkId) ?? null;
    if (found) break;
    next = data.paging?.next ?? null;
  }
  out.pages_checked = pages;
  out.found = found;
  return json(out);
});
