import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";
const META_AD_ACCOUNT_ID = "1624710972577463";
const PIXEL_ID = "2251041928961730";

async function createWebsiteAudience(name: string, urlContains: string, retentionDays: number) {
  const rule = JSON.stringify({
    inclusions: {
      operator: "or",
      rules: [
        {
          event_sources: [{ type: "pixel", id: PIXEL_ID }],
          retention_seconds: retentionDays * 86400,
          filter: {
            operator: "and",
            filters: [
              { field: "url", operator: "i_contains", value: urlContains },
              { field: "event", operator: "=", value: "PageView" },
            ],
          },
        },
      ],
    },
  });

  const res = await fetch(`${META_GRAPH_BASE}/act_${META_AD_ACCOUNT_ID}/customaudiences`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, rule, prefill: true, access_token: META_ACCESS_TOKEN }),
  });
  const data = await res.json();
  return data.id ? { id: data.id } : { error: JSON.stringify(data.error ?? data) };
}

Deno.serve(async (_req: Request) => {
  const lunessa = await createWebsiteAudience("Lunessa Website Visitors 30d", "lunessa", 30);
  return new Response(JSON.stringify({ lunessa }, null, 2), { headers: { "Content-Type": "application/json" } });
});
