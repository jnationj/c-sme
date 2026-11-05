import Anthropic from "@anthropic-ai/sdk";
import { analyzeAll, renderFromAnalysis, type Analysis } from "./analyze.js";

export interface StepResult {
  title: string;
  why: string;
  output: unknown;
  /** Citation label shown in the report and in the "What was bought" list, e.g. "S1". */
  ref?: string;
}

/** Computed facts per source (see analyze.ts). Exported for tests. */
export function facts(results: StepResult[]): Analysis[] {
  return analyzeAll(results);
}

const SYSTEM = `You write short, honest market-research reports for a small online seller or creator in Nigeria.
Rules:
- Use ONLY the facts provided. Never invent numbers, creators, hashtags or trends. Do not do your own arithmetic: quote the computed numbers as given.
- Cite the source of every claim with its label in square brackets, like [S1] or [S2].
- Plain, simple English. Short sentences. No hype.
- If the data is thin, off-topic or not about Nigeria, say that plainly instead of stretching it.
- Output exactly three sections with these headings:
## What the data shows
(3 to 5 bullets, each ending with its [S#] citation)
## What to do this week
(1 to 3 concrete actions the owner can take, based on the facts)
## What this data can't tell you
(2 to 3 bullets: what is NOT answered, for example why posts performed, the owner's own audience, local Nigerian behaviour if the data is not from Nigeria)`;

function userPrompt(question: string, an: Analysis[]): string {
  return `Owner's question: "${question}"

Facts computed from data bought from paid sources (JSON):
${JSON.stringify(an).slice(0, 20000)}`;
}

/** DeepSeek exposes an OpenAI-compatible chat API. Only the question and the computed facts are sent. */
async function deepseek(question: string, an: Analysis[]): Promise<string> {
  const res = await fetch(`${process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      max_tokens: 900,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(question, an) },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`deepseek HTTP ${res.status}`);
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (j.choices?.[0]?.message?.content ?? "").trim();
}

/** The AI must have followed the format and cited at least one source; otherwise we use the computed fallback. */
export function looksValid(text: string, an: Analysis[]): boolean {
  if (!/##\s*What the data shows/i.test(text) || !/##\s*What this data can'?t tell you/i.test(text)) return false;
  const cited = [...text.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]!);
  const known = new Set(an.map((a) => a.ref));
  return cited.length > 0 && cited.every((c) => known.has(c));
}

export async function writeReport(question: string, results: StepResult[]): Promise<{ text: string; by: "deepseek" | "claude" | "fallback" }> {
  const an = analyzeAll(results);
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const text = await deepseek(question, an);
      if (text && looksValid(text, an)) return { text, by: "deepseek" };
      if (text) console.warn("DeepSeek report did not follow the required format; using the computed fallback.");
    } catch (e) {
      console.warn("DeepSeek report failed:", (e as Error).message);
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const msg = await client.messages.create({
        model: "claude-sonnet-5-5",
        max_tokens: 900,
        system: SYSTEM,
        messages: [{ role: "user", content: userPrompt(question, an) }],
      });
      const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
      if (text && looksValid(text, an)) return { text, by: "claude" };
    } catch (e) {
      console.warn("LLM report failed, using fallback:", (e as Error).message);
    }
  }
  return { text: renderFromAnalysis(question, an), by: "fallback" };
}
