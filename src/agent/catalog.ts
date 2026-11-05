export interface Capability {
  id: string;
  title: string;
  method: string;
  url: string;
  platform: string;
  available: boolean;
  provider?: string;
  price?: { usd: string; atomic: string };
  /** All price tiers, e.g. one per maxResults value. */
  tiers: Array<{ maxResults?: number; atomic: string }>;
}

const CATALOG_URL = "https://gateway.usebuy.ai/v1/catalog";
let cache: { at: number; caps: Map<string, Capability> } | undefined;

/** Live buy catalog, cached for 10 minutes. The 402 challenge for the exact request stays authoritative. */
export async function getCatalog(): Promise<Map<string, Capability>> {
  if (cache && Date.now() - cache.at < 600_000) return cache.caps;
  const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`catalog fetch failed: HTTP ${res.status}`);
  const json = (await res.json()) as { capabilities: any[] };
  const caps = new Map<string, Capability>();
  for (const c of json.capabilities) {
    const p = c.priceOptions?.[0] ?? c.price;
    caps.set(c.id, {
      id: c.id,
      title: c.title,
      method: c.method,
      url: c.url,
      platform: c.platform,
      available: !!c.available,
      provider: c.id.split(".")[2] ?? c.agent?.provider,
      price: p?.atomic ? { usd: p.usd, atomic: p.atomic } : undefined,
      tiers: (c.priceOptions ?? []).filter((o: any) => o.atomic).map((o: any) => ({ maxResults: o.maxResults, atomic: o.atomic })),
    });
  }
  cache = { at: Date.now(), caps };
  return caps;
}
