import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const ACCOUNT_ID = "643541631210844";

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async () => {
  const fields = "adset_id,adset_name,spend,impressions";
  const results: Record<string, any> = {};
  for (const version of ["v18.0", "v21.0"]) {
    const url = `https://graph.facebook.com/${version}/act_${ACCOUNT_ID}/insights?level=adset&fields=${fields}&date_preset=today&access_token=${META_ACCESS_TOKEN}`;
    const res = await fetch(url);
    const data = await res.json();
    results[version] = { status: res.status, rowCount: data.data?.length ?? 0, error: data.error };
  }
  return json(results);
});
