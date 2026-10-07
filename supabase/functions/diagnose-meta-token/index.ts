import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Read-only Graph API lookup using the shared META_ACCESS_TOKEN, for owners/admins only.
//   GET ?path=<graph path, e.g. 120248136860460710/ads>&fields=...
// (This used to be an open proxy that also forwarded writes. Anyone on the internet could call it.)

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Read-only: use GET." }, 405);

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null };
  if (!u?.user) return json({ error: "Sign in first." }, 401);
  const { data: p } = await admin.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
  if (!p || !["owner", "admin"].includes(p.role)) return json({ error: "Owners and admins only." }, 403);

  const url = new URL(req.url);
  const path = (url.searchParams.get("path") || "").replace(/^\/+/, "");
  const fields = url.searchParams.get("fields") || "";
  if (!path || /[?#\\]|\.\./.test(path)) return json({ error: "pass ?path=<graph api path>" }, 400);
  const q = new URLSearchParams({ access_token: META_ACCESS_TOKEN });
  if (fields) q.set("fields", fields);
  const res = await fetch(`https://graph.facebook.com/v21.0/${path}?${q}`);
  return json({ status: res.status, data: await res.json() });
});
