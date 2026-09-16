import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Cleanup utility: lists (and optionally deletes) campaigns on the real ad
// account matching today's debugging session's naming pattern, so orphaned
// empty test campaigns created while diagnosing ai-auto-launch-tests can be
// found and removed reliably instead of guessing IDs from log text.
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v21.0";
const ACCOUNT_ID = "643541631210844";

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const doDelete = url.searchParams.get("delete") === "true";

  const listRes = await fetch(
    `${META_GRAPH_BASE}/act_${ACCOUNT_ID}/campaigns?fields=id,name,status,created_time,objective&limit=100&access_token=${META_ACCESS_TOKEN}`
  );
  const listData = await listRes.json();
  const campaigns = (listData?.data || []).filter((c: any) => c.name?.startsWith("Yorvix SB-"));

  const result: Record<string, any> = { found: campaigns.length, campaigns };

  if (doDelete) {
    const deletions: any[] = [];
    for (const c of campaigns) {
      const delRes = await fetch(`${META_GRAPH_BASE}/${c.id}?access_token=${META_ACCESS_TOKEN}`, { method: "DELETE" });
      const delBody = await delRes.json();
      deletions.push({ id: c.id, name: c.name, status: delRes.status, body: delBody });
    }
    result.deletions = deletions;
  }

  return json(result);
});
