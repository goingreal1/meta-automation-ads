import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_BUSINESS_ID = Deno.env.get("META_BUSINESS_ID") ?? "";
const CHECK_BUSINESS_ID = "2655069624912296";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (_req: Request) => {
  if (!META_ACCESS_TOKEN || !META_BUSINESS_ID) {
    return json({ error: "META_ACCESS_TOKEN or META_BUSINESS_ID not set", META_ACCESS_TOKEN: !!META_ACCESS_TOKEN, META_BUSINESS_ID });
  }
  const out: Record<string, unknown> = { META_BUSINESS_ID };
  let url: string | null = `https://graph.facebook.com/v19.0/${META_BUSINESS_ID}/clients?fields=id,name,adaccount_permissions{id,access_status}&limit=200&access_token=${META_ACCESS_TOKEN}`;
  let found = null;
  let pages = 0;
  while (url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) { out.error = data.error; break; }
    pages++;
    const match = (data.data ?? []).find((c: any) => c.id === CHECK_BUSINESS_ID);
    if (match) { found = match; break; }
    url = data.paging?.next ?? null;
  }
  out.pages_checked = pages;
  out.found = found;
  return json(out);
});
