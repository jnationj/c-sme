/**
 * Turns raw provider output into facts computed in CODE (counts, medians, top items, hook patterns).
 * The AI then explains these facts; it is not asked to read raw data or do arithmetic, so the numbers can be checked.
 */

export interface StepResultLike {
  title: string;
  why: string;
  output: unknown;
  ref?: string;
  provider?: string;
  serviceId?: string;
  paidUsd?: string;
  purchaseStatus?: string;
  transaction?: string | null;
  retrievedAt?: string;
}

export interface Analysis {
  ref: string;
  source: string;
  why: string;
  itemCount: number;
  topHashtags: Array<{ tag: string; count: number }>;
  metrics: Array<{ name: string; median: number; max?: number; n: number }>;
  topItems: Array<{ text: string; author?: string; metric?: { name: string; value: number }; url?: string }>;
  hooks?: { total: number; numbered: number; question: number; howTo: number; negative: number; pov: number; beforeAfter: number };
  provider?: string;
  serviceId?: string;
  paidUsd?: string;
  purchaseStatus?: string;
  transaction?: string | null;
  retrievedAt?: string;
  raw?: string; // trimmed raw JSON, only when nothing could be mined
}

type Flat = Record<string, string | number>;

/** First array of objects in a JSON tree: where list-style provider responses keep their rows. */
export function findItems(output: unknown): Array<Record<string, unknown>> {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): Array<Record<string, unknown>> | undefined => {
    if (!v || typeof v !== "object" || depth > 6 || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      if (v.length && v.every((x) => x && typeof x === "object" && !Array.isArray(x))) return v as Array<Record<string, unknown>>;
      return;
    }
    for (const k of Object.keys(v as object)) {
      const r = walk((v as Record<string, unknown>)[k], depth + 1);
      if (r) return r;
    }
  };
  return walk(output, 0) ?? [];
}

/** Scalar fields of one item, with dotted paths, depth-limited. Arrays of strings are joined under their key. */
function flatten(item: Record<string, unknown>, maxKeys = 300): { flat: Flat; tagLists: string[] } {
  const flat: Flat = {};
  const tagLists: string[] = [];
  let count = 0;
  const walk = (v: unknown, path: string, depth: number) => {
    if (count > maxKeys || depth > 4) return;
    if (typeof v === "string" || typeof v === "number") {
      flat[path] = v;
      count++;
    } else if (Array.isArray(v)) {
      const last = path.split(".").pop() ?? "";
      if (/hashtag|tag/i.test(last)) {
        for (const e of v) {
          if (typeof e === "string") tagLists.push(e);
          else if (e && typeof e === "object") {
            const name = (e as Record<string, unknown>).name ?? (e as Record<string, unknown>).title ?? (e as Record<string, unknown>).hashtagName;
            if (typeof name === "string") tagLists.push(name);
          }
        }
      }
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? path + "." + k : k, depth + 1);
    }
  };
  walk(item, "", 0);
  return { flat, tagLists };
}

const lastKey = (p: string) => (p.split(".").pop() ?? p).toLowerCase();

const METRIC_RULES: Array<[RegExp, string]> = [
  [/^(playcount|play_count|plays|views|viewcount|view_count|vv)$/, "views"],
  [/^(diggcount|digg_count|likes|likecount|like_count)$/, "likes"],
  [/^(commentcount|comment_count|comments)$/, "comments"],
  [/^(sharecount|share_count|shares)$/, "shares"],
  [/^(collectcount|collect_count|savecount|save_count|saves|bookmarks|bookmarkcount)$/, "saves"],
  [/^(followers|followercount|follower_count|fans|followedcnt)$/, "followers"],
  [/^(publishcnt|postcount|post_count|posts)$/, "posts"],
];
const metricName = (key: string): string | undefined => METRIC_RULES.find(([re]) => re.test(key))?.[1];

// TEXT_KEYS are shown as an item's label. Only CAPTION_KEYS are real post text: hooks and hashtags are mined from those alone.
const TEXT_KEYS = /^(title|desc|description|caption|text|hashtagname|full_name)$/;
const CAPTION_KEYS = /^(title|desc|description|caption|text)$/;
const AUTHOR_KEYS = /^(unique_?id|username|handlename|handle|nickname|nick_name|full_name)$/;
const BAD_URL = /(cover|avatar|profile_?pic|image|thumb|cdn|fbcdn|tiktokcdn|\.jpe?g|\.png|\.webp)/i;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const HASHTAG_RE = /#[\p{L}\p{N}_]{2,40}/gu;

export function hookFlags(text: string) {
  const t = text.trim();
  return {
    numbered: /^\s*\d+\b/.test(t) || /\b\d+\s+(ways|tips|hooks|tools|things|reasons|steps|ideas|prompts|mistakes)\b/i.test(t),
    question: /\?/.test(t),
    howTo: /\bhow to\b/i.test(t),
    negative: /\b(stop|never|don'?t|avoid|mistake|mistakes|wrong)\b/i.test(t),
    pov: /\bpov\b/i.test(t),
    beforeAfter: /\b(before|after|transformation|glow ?up)\b/i.test(t),
  };
}

export function analyzeSource(ref: string, r: StepResultLike, maxItems = 60): Analysis {
  const rows = findItems(r.output).slice(0, maxItems);
  const base: Analysis = { ref, source: r.title, why: r.why, itemCount: rows.length, topHashtags: [], metrics: [], topItems: [] };
  if (r.provider) base.provider = r.provider.slice(0, 80);
  if (r.serviceId) base.serviceId = r.serviceId.slice(0, 160);
  if (r.paidUsd) base.paidUsd = r.paidUsd.slice(0, 32);
  if (r.purchaseStatus) base.purchaseStatus = r.purchaseStatus.slice(0, 32);
  if (r.transaction !== undefined) base.transaction = r.transaction;
  if (r.retrievedAt) base.retrievedAt = r.retrievedAt.slice(0, 40);
  if (!rows.length) {
    base.raw = JSON.stringify(r.output ?? null).slice(0, 1500);
    return base;
  }

  const tagCounts = new Map<string, number>();
  const metricVals = new Map<string, number[]>();
  const items: Array<{ text: string; author?: string; url?: string; metrics: Record<string, number> }> = [];
  const hooks = { total: 0, numbered: 0, question: 0, howTo: 0, negative: 0, pov: 0, beforeAfter: 0 };

  for (const row of rows) {
    const { flat, tagLists } = flatten(row);
    let text = "";
    let caption = "";
    let author: string | undefined;
    let url: string | undefined;
    const m: Record<string, number> = {};
    for (const [path, val] of Object.entries(flat)) {
      const k = lastKey(path);
      if (typeof val === "string") {
        if (TEXT_KEYS.test(k) && val.length >= 2) {
          const t = k === "hashtagname" ? "#" + val.replace(/^#/, "") : val;
          if (t.length > text.length) text = t;
          if (CAPTION_KEYS.test(k) && val.length > caption.length) caption = val;
        } else if (!author && AUTHOR_KEYS.test(k) && val.length >= 2 && val.length <= 60) author = val;
        else if (!url && /^https?:\/\//.test(val) && /(post|video|web|^url$|link)/.test(k) && !BAD_URL.test(val)) url = val;
      } else {
        const name = metricName(k);
        if (name && Number.isFinite(val)) m[name] = Math.max(m[name] ?? 0, val);
      }
    }
    for (const [name, v] of Object.entries(m)) (metricVals.get(name) ?? metricVals.set(name, []).get(name)!).push(v);
    // hashtags: explicit lists, a hashtag-name field, and #tags written inside the text
    const tags = new Set<string>();
    for (const t of tagLists) tags.add("#" + t.replace(/^#/, "").toLowerCase());
    for (const t of (caption + " " + (text.startsWith("#") ? text : "")).match(HASHTAG_RE) ?? []) tags.add(t.toLowerCase());
    for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);

    if (caption) {
      hooks.total++;
      const f = hookFlags(caption);
      for (const key of ["numbered", "question", "howTo", "negative", "pov", "beforeAfter"] as const) if (f[key]) hooks[key]++;
    }
    items.push({ text, author, url, metrics: m });
  }

  base.topHashtags = [...tagCounts.entries()]
    .filter(([, c]) => c > 1 || rows.length <= 12 || items.every((i) => i.text.startsWith("#")))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));
  base.metrics = [...metricVals.entries()]
    .map(([name, v]) => ({ name, median: Math.round(median(v)), max: Math.max(...v), n: v.length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  const primary = ["views", "likes", "followers", "posts"].find((n) => metricVals.has(n));
  const ranked = primary ? [...items].sort((a, b) => (b.metrics[primary] ?? 0) - (a.metrics[primary] ?? 0)) : items;
  base.topItems = ranked
    .filter((i) => i.text || i.author)
    .slice(0, 3)
    .map((i) => ({
      text: (i.text || i.author || "").replace(/\s+/g, " ").slice(0, 140),
      ...(i.author && i.text ? { author: i.author } : {}),
      ...(primary && i.metrics[primary] !== undefined ? { metric: { name: primary, value: i.metrics[primary]! } } : {}),
      ...(i.url && i.url.length <= 2048 ? { url: i.url } : {}),
    }));
  if (hooks.total >= 3) base.hooks = hooks;
  if (!base.topItems.length && !base.metrics.length && !base.topHashtags.length) base.raw = JSON.stringify(r.output ?? null).slice(0, 1500);
  return base;
}

export function analyzeAll(results: StepResultLike[]): Analysis[] {
  return results.map((r, i) => analyzeSource(r.ref ?? `S${i + 1}`, r));
}

const n0 = (n: number) => n.toLocaleString("en-US");

/** A readable report built only from computed facts: used when no AI key is available or the AI fails. */
export function renderFromAnalysis(question: string, an: Analysis[]): string {
  const lines: string[] = ["## What the data shows"];
  const records = an.reduce((total, source) => total + source.itemCount, 0);
  const citedSources = an.filter((source) => source.itemCount > 0).map((source) => `[${source.ref}]`);
  lines.push(
    records
      ? `- **Answer:** The available data summarizes ${n0(records)} structured records${citedSources.length ? " " + citedSources.join(", ") : ""}. It describes the collected sample; it does not establish that the sample represents all posts.`
      : `- **Answer:** The returned data did not include structured records that can answer this question${an[0] ? ` [${an[0].ref}]` : ""}.`,
  );
  let any = false;
  for (const a of an) {
    const bits: string[] = [];
    if (a.topHashtags.length && a.topHashtags[0]!.count > 1) bits.push("most-used hashtags: " + a.topHashtags.slice(0, 5).map((t) => `${t.tag} (${n0(t.count)})`).join(", "));
    const med = a.metrics.find((m) => m.name === "views") ?? a.metrics[0];
    if (med) bits.push(`typical ${med.name}: ${n0(med.median)}${med.max === undefined ? "" : ` (best ${n0(med.max)})`} (across ${med.n} items)`);
    const top = a.topItems[0];
    if (top) bits.push(`top item: "${top.text}"${top.author ? " by " + top.author : ""}${top.metric ? ` (${n0(top.metric.value)} ${top.metric.name})` : ""}`);
    if (bits.length) {
      any = true;
      lines.push(`- **[${a.ref}] ${a.source}:** ${a.itemCount} items. ${bits.join("; ")}.`);
    } else lines.push(`- **[${a.ref}] ${a.source}:** returned data this summary cannot read without the AI writer.`);
  }
  const hookSrc = an.find((a) => a.hooks);
  if (hookSrc?.hooks) {
    const h = hookSrc.hooks;
    const pct = (x: number) => Math.round((x / h.total) * 100) + "%";
    const parts = [
      h.numbered ? `${pct(h.numbered)} start with or promise a number` : "",
      h.question ? `${pct(h.question)} ask a question` : "",
      h.howTo ? `${pct(h.howTo)} say "how to"` : "",
      h.negative ? `${pct(h.negative)} warn or say stop/never/mistake` : "",
      h.pov ? `${pct(h.pov)} use POV` : "",
      h.beforeAfter ? `${pct(h.beforeAfter)} use before/after` : "",
    ].filter(Boolean);
    if (parts.length) {
      any = true;
      lines.push(`- **Hook patterns [${hookSrc.ref}], across ${h.total} captions:** ${parts.join("; ")}.`);
    }
  }

  lines.push("", "## What to do this week");
  const h = hookSrc?.hooks;
  type HookKey = "numbered" | "question" | "howTo" | "negative" | "pov" | "beforeAfter";
  const keys: HookKey[] = ["numbered", "question", "howTo", "negative", "pov", "beforeAfter"];
  const best: HookKey | undefined = h ? [...keys].sort((x, y) => h[y] - h[x])[0] : undefined;
  const label: Record<string, string> = { numbered: "a numbered promise (for example \"5 ways to…\")", question: "a question hook", howTo: "a \"how to\" hook", negative: "a \"stop/never/mistake\" hook", pov: "a POV hook", beforeAfter: "a before/after hook" };
  lines.push(
    best && h && h[best] > 0
      ? `- Post two or three short videos using ${label[best]}, the pattern that appears most often in this data, then compare views and saves after a week.`
      : "- Pick two or three of the top items above, post your own version of each, and compare views and saves after a week.",
  );

  lines.push("", "## What this data can't tell you");
  lines.push("- It does not show why these items performed well, who your own audience is, or how your account compares. It only shows what exists in the data bought.");
  if (!any) lines.push("- The sources returned little readable data for this question, so treat this report as a prompt to try a more specific question.");
  lines.push("", `_Question: ${question}_`);
  return lines.join("\n");
}
