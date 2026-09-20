import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Scratch diagnostic -- generic Graph API proxy using the server-side
// META_ACCESS_TOKEN, for ad-hoc lookups that don't have a dedicated function
// yet (e.g. "what ads exist under this ad set id"). Not for production use.

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.searchParams.get("path") || "";
  const fields = url.searchParams.get("fields") || "";
  if (!path) return json({ error: "pass ?path=<graph api path, e.g. 120248136860460710/ads>" }, 400);

  const graphUrl = `https://graph.facebook.com/v21.0/${path}${path.includes("?") ? "&" : "?"}${fields ? `fields=${fields}&` : ""}access_token=${META_ACCESS_TOKEN}`;
  const res = await fetch(graphUrl);
  const data = await res.json();
  return json({ status: res.status, data });
});
