import Anthropic from "@anthropic-ai/sdk";

export interface StepResult {
  title: string;
  why: string;
  output: unknown;
}

const PICK = ["hashtagName", "desc", "description", "title", "nickname", "handleName", "unique_id", "uniqueId", "username", "full_name", "publishCnt", "playCount", "play_count", "diggCount", "like_count", "follower_count", "followerCount", "caption"];

/** Find the first array of objects in a JSON tree and keep a few readable fields per item. */
function highlights(output: unknown, maxItems = 6): Array<Record<string, unknown>> {
  const seen = new Set<unknown>();
  const walk = (v: any, depth: number): any[] | undefined => {
    if (!v || typeof v !== "object" || depth > 6 || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v) && v.length && typeof v[0] === "object") return v;
    for (const k of Object.keys(v)) {
      const r = walk(v[k], depth + 1);
      if (r) return r;
    }
  };
  const arr = walk(output, 0) ?? [];
  return arr.slice(0, maxItems).map((item) => {
    const flat: Record<string, unknown> = {};
    const stack: any[] = [item];
    let n = 0;
    while (stack.length && n < 400) {
      const o = stack.shift();
      n++;
      if (!o || typeof o !== "object") continue;
      for (const [k, val] of Object.entries(o)) {
        if (PICK.includes(k) && typeof val !== "object" && !(k in flat)) flat[k] = typeof val === "string" ? val.slice(0, 140) : val;
        else if (val && typeof val === "object" && !Array.isArray(val)) stack.push(val);
      }
    }
    return flat;
  });
}

export function facts(results: StepResult[]) {
  return results.map((r) => ({ source: r.title, why: r.why, items: highlights(r.output) }));
}

/** Plain-language report. Uses Claude when ANTHROPIC_API_KEY is set; otherwise a deterministic fallback. */
export async function writeReport(question: string, results: StepResult[]): Promise<{ text: string; by: "claude" | "fallback" }> {
  const data = facts(results);
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const msg = await client.messages.create({
        model: "claude-sonnet-5-5",
        max_tokens: 900,
        messages: [
          {
            role: "user",
            content: `You write short, honest research reports for a small business owner in Nigeria. Question: "${question}"\n\nData bought from paid sources (JSON; may be thin or partly irrelevant):\n${JSON.stringify(data).slice(0, 12000)}\n\nWrite 5-8 plain sentences or bullets: what the data shows, one concrete next action, and an explicit note of anything the data does NOT answer. Never invent numbers or creators not present in the data.`,
          },
        ],
      });
      const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
      if (text) return { text, by: "claude" };
    } catch (e) {
      console.warn("LLM report failed, using fallback:", (e as Error).message);
    }
  }
  const lines = [`Question: ${question}`, ""];
  for (const d of data) {
    lines.push(`• ${d.source} (${d.why})`);
    if (!d.items.length) lines.push("   - no readable items returned");
    for (const it of d.items) lines.push("   - " + Object.entries(it).map(([k, v]) => `${k}: ${v}`).join(" · "));
  }
  lines.push("", "(Plain data summary. Set ANTHROPIC_API_KEY for a written analysis.)");
  return { text: lines.join("\n"), by: "fallback" };
}
