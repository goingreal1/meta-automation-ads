// Clears Cloudflare's cached copy of a site's pages the moment it is published or edited, so visitors see the new version in seconds
// instead of waiting for the cache to expire. Only that site's own URLs are purged (never the whole domain's zone), and a failure here
// never blocks the save: the page just refreshes on its normal short cache timer.
const CF_TOKEN = Deno.env.get("CLOUDFLARE_API_TOKEN") ?? "";

// deno-lint-ignore no-explicit-any
export async function purgeSiteCache(db: any, siteId: string): Promise<{ purged: number; skipped?: string }> {
  try {
    if (!CF_TOKEN || !siteId) return { purged: 0, skipped: "not configured" };
    const { data: doms } = await db.from("site_domains").select("hostname, cf_zone_id").eq("site_id", siteId).not("cf_zone_id", "is", null);
    if (!doms?.length) return { purged: 0, skipped: "no Cloudflare domain" };
    const { data: pages } = await db.from("site_pages").select("slug").eq("site_id", siteId);
    const slugs: string[] = [...new Set<string>((pages ?? []).map((p: { slug: string | null }) => String(p.slug ?? "").replace(/^\/+|\/+$/g, "")))];
    if (!slugs.includes("")) slugs.push("");
    const byZone = new Map<string, string[]>();
    for (const d of doms) {
      const urls = byZone.get(d.cf_zone_id) ?? [];
      for (const host of [d.hostname, "www." + d.hostname]) for (const s of slugs) { urls.push(`https://${host}/${s}`); if (s) urls.push(`https://${host}/${s}/`); }
      byZone.set(d.cf_zone_id, urls);
    }
    let n = 0;
    for (const [zone, urls] of byZone) {
      for (let i = 0; i < urls.length; i += 30) { // Cloudflare accepts up to 30 URLs per call
        const chunk = urls.slice(i, i + 30);
        const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
          method: "POST", headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ files: chunk }),
          signal: AbortSignal.timeout(8000),
        }).then((x) => x.json()).catch(() => null);
        if (r?.success) n += chunk.length;
      }
    }
    return { purged: n };
  } catch (e) {
    console.error("cache purge failed", e);
    return { purged: 0, skipped: "error" };
  }
}
