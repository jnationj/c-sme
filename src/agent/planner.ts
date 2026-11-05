import { getCatalog } from "./catalog.js";

export interface PlanStep {
  capabilityId: string;
  title: string;
  provider: string;
  url: string;
  body: unknown;
  quoteAtomic: bigint;
  why: string;
}

const STOP = new Set(
  "a an the of and or to in on for with is are was be which what who how that this those these currently right now most best working work looking gaining their they them from by at as it its do does can i me my we our you your accounts account smaller small types type content ideas using use get getting more increase reach niche creators creator strategies strategy contributing tools tool".split(" "),
);

export function keywords(q: string, max = 3): string[] {
  const words = q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => (w.length > 2 || w === "ai") && !STOP.has(w));
  return [...new Set(words)].slice(0, max);
}

/**
 * Deterministic planner: maps a question to a few catalog capabilities with exact bodies.
 * The LLM never chooses what to spend; it only helps explain. Prices come from the live catalog.
 */
export async function planSteps(question: string, maxSteps = 4): Promise<PlanStep[]> {
  const caps = await getCatalog();
  const q = question.toLowerCase();
  const kw = keywords(question);
  const phrase = kw.join(" ") || question.slice(0, 40);
  const wantTikTok = /tiktok|creator|hook|video|\bai\b|reach/.test(q);
  const wantInsta = /instagram|\big\b|sell|price|charge|vendor|shop|cloth|fashion|ankara|boutique/.test(q);
  const both = !wantTikTok && !wantInsta;

  const candidates: Array<{ id: string; body: unknown; why: string }> = [];
  if (wantTikTok || both) {
    candidates.push(
      { id: "monid.tiktok.tikhub.api-v1-tiktok-ads-get-trends-hashtag-list", body: { body: { country_code: "US", time_range: 7, limit: 10 }, queryParams: {} }, why: "Hashtags trending on TikTok this week" },
      { id: "monid.tiktok.tikhub.api-v1-tiktok-web-fetch-search-live", body: { queryParams: { keyword: phrase, count: 10 } }, why: `TikTok posts matching "${phrase}"` },
      { id: "monid.tiktok.tikhub.api-v1-tiktok-web-fetch-search-user", body: { queryParams: { keyword: phrase } }, why: `TikTok creators matching "${phrase}"` },
    );
  }
  if (wantInsta || both) {
    candidates.push(
      { id: "monid.instagram.tikhub.api-v1-instagram-v1-fetch-search", body: { queryParams: { query: phrase } }, why: `Instagram accounts and posts matching "${phrase}"` },
      { id: "monid.instagram.tikhub.api-v1-instagram-v2-fetch-hashtag-posts", body: { queryParams: { keyword: (kw[0] ?? "fashion").replace(/\s/g, ""), feed_type: "top" } }, why: `Top Instagram posts for #${kw[0] ?? "fashion"}` },
    );
  }

  const steps: PlanStep[] = [];
  for (const c of candidates) {
    const cap = caps.get(c.id);
    if (!cap || !cap.available || !cap.price) continue; // only buy what is live and priced
    steps.push({ capabilityId: cap.id, title: cap.title, provider: cap.provider ?? "unknown", url: cap.url, body: c.body, quoteAtomic: BigInt(cap.price.atomic), why: c.why });
    if (steps.length >= maxSteps) break;
  }
  return steps;
}
