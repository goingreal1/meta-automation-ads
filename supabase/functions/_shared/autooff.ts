// Pure rules for switching off the parents of an ad (and for spend limits). No network here, so they can be tested alone.
// Status values are Meta's configured `status` (ACTIVE, PAUSED, ...), not the effective one.

export type Obj = { id: string; name?: string; status?: string; created_time?: string; campaign_id?: string; adset_id?: string };
export type Pause = { level: "adset" | "campaign"; id: string; name: string; reason: string };

const MIN_AGE_MS = 30 * 60 * 1000; // never touch something created in the last 30 minutes: it may still be being built

const isActive = (o: Obj) => o.status === "ACTIVE";
const oldEnough = (o: Obj, now: number) => !o.created_time || now - new Date(o.created_time).getTime() > MIN_AGE_MS;

// An ad set with ads, none of them live, is burning nothing but also doing nothing: switch it off.
// Then a campaign whose ad sets are all off (counting the ones just switched off) is switched off too.
// An ad set or campaign with no ads / ad sets at all is left alone (it is probably still being built).
export function planCascade(campaigns: Obj[], adsets: Obj[], ads: Obj[], now = Date.now()): Pause[] {
  const out: Pause[] = [];
  const adsBySet = new Map<string, Obj[]>(), setsByCamp = new Map<string, Obj[]>();
  for (const a of ads) if (a.adset_id) (adsBySet.get(a.adset_id) ?? adsBySet.set(a.adset_id, []).get(a.adset_id)!).push(a);
  for (const s of adsets) if (s.campaign_id) (setsByCamp.get(s.campaign_id) ?? setsByCamp.set(s.campaign_id, []).get(s.campaign_id)!).push(s);
  const offSets = new Set<string>();
  for (const s of adsets) {
    if (!isActive(s) || !oldEnough(s, now)) continue;
    const kids = adsBySet.get(s.id) ?? [];
    if (kids.length && !kids.some(isActive)) {
      offSets.add(s.id);
      out.push({ level: "adset", id: s.id, name: s.name ?? s.id, reason: "Every ad in it is off, so I switched it off too." });
    }
  }
  for (const c of campaigns) {
    if (!isActive(c) || !oldEnough(c, now)) continue;
    const kids = setsByCamp.get(c.id) ?? [];
    if (kids.length && !kids.some((s) => isActive(s) && !offSets.has(s.id))) {
      out.push({ level: "campaign", id: c.id, name: c.name ?? c.id, reason: "Every ad set in it is off, so I switched it off too." });
    }
  }
  return out;
}

// Spend limits: a campaign or ad set that has spent its limit (all its ads together, whole life) is switched off.
// caps: the smallest limit set by anyone watching this account, per level. spend: lifetime spend by object id.
export function planCaps(
  caps: { campaign?: number | null; adset?: number | null },
  campaigns: Obj[], adsets: Obj[],
  spend: { campaign: Record<string, number>; adset: Record<string, number> },
  fmt: (n: number) => string = (n) => "₦" + Math.round(n).toLocaleString("en-NG"),
): Pause[] {
  const out: Pause[] = [];
  if (caps.adset && caps.adset > 0) {
    for (const s of adsets) {
      const sp = spend.adset[s.id] ?? 0;
      if (isActive(s) && sp >= caps.adset) out.push({ level: "adset", id: s.id, name: s.name ?? s.id, reason: `It has spent ${fmt(sp)}, which reaches your ${fmt(caps.adset)} limit for an ad set.` });
    }
  }
  if (caps.campaign && caps.campaign > 0) {
    for (const c of campaigns) {
      const sp = spend.campaign[c.id] ?? 0;
      if (isActive(c) && sp >= caps.campaign) out.push({ level: "campaign", id: c.id, name: c.name ?? c.id, reason: `All its ad sets together have spent ${fmt(sp)}, which reaches your ${fmt(caps.campaign)} limit for a campaign.` });
    }
  }
  return out;
}
