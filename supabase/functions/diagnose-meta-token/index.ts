import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async () => {
  const delRes = await fetch(`${META_GRAPH_BASE}/1549225060578123?access_token=${META_ACCESS_TOKEN}`, { method: "DELETE" });
  return json({ status: delRes.status, body: await delRes.json() });
});
