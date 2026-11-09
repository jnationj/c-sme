import type { Analysis } from "./analyze.js";

export interface DashboardSource {
  ref: string;
  title: string;
  provider?: string;
  serviceId?: string;
  recordsAnalyzed: number;
  purchase?: {
    amountUsd: string;
    status: string;
    transaction?: string;
    retrievedAt?: string;
  };
  metrics: Array<{ name: string; median: number; max?: number; sampleSize: number }>;
  hashtags: Array<{ tag: string; count: number }>;
  topItems: Array<{
    text: string;
    author?: string;
    url?: string;
    metric?: { name: string; value: number };
  }>;
  hooks?: NonNullable<Analysis["hooks"]>;
}

export interface ReportDashboard {
  originalQuestion: string;
  executiveAnswer: string;
  verdict: { label: string; detail: string; kind: "available" | "limited" };
  quality: { recordsAnalyzed: number; sourceCount: number };
  sources: DashboardSource[];
  narrative: {
    findings: string;
    actions: string;
    limitations: string;
  };
  limitations: string[];
  provenanceNote: string;
}

const cleanText = (value: unknown, limit: number): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit) : "";

const cleanBlock = (value: string): string =>
  value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\r/g, "").slice(0, 4000).trim();

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function reportSections(report: string): ReportDashboard["narrative"] {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const line of report.replace(/\r/g, "").split("\n")) {
    const heading = /^##\s+(.+)$/.exec(line.trim());
    if (heading) {
      current = heading[1]!.trim().toLowerCase();
      sections.set(current, []);
    } else if (current) {
      sections.get(current)!.push(line);
    }
  }
  const take = (key: string) => cleanBlock((sections.get(key) ?? []).join("\n"));
  return {
    findings: take("what the data shows"),
    actions: take("what to do this week"),
    limitations: take("what this data can't tell you"),
  };
}

function answerFrom(report: string, recordsAnalyzed: number): string {
  const findings = reportSections(report).findings;
  const explicit = findings.split(/\r?\n/).map((line) => line.trim()).find((line) => /^[-*]\s+\*\*Answer:\*\*/i.test(line));
  if (explicit) return cleanText(explicit.replace(/^[-*]\s+/, "").replace(/\*\*/g, ""), 700);
  const firstFinding = findings.split(/\r?\n/).map((line) => line.trim()).find((line) => /^[-*]\s+/.test(line));
  if (firstFinding) return cleanText(firstFinding.replace(/^[-*]\s+/, "").replace(/\*\*/g, ""), 700);
  return recordsAnalyzed
    ? `${recordsAnalyzed} structured records were summarized. See the findings and source evidence below.`
    : "The collected data did not include structured records that this report can summarize.";
}

function dashboardSource(source: Analysis): DashboardSource | undefined {
  if (!/^S\d{1,3}$/.test(source.ref)) return undefined;
  const metrics = source.metrics
    .filter((metric) => ["views", "likes", "comments", "shares", "saves", "followers", "posts"].includes(metric.name))
    .filter((metric) =>
      Number.isFinite(metric.median) &&
      metric.median >= 0 &&
      Number.isFinite(metric.n) &&
      metric.n >= 0 &&
      (metric.max === undefined || (Number.isFinite(metric.max) && metric.max >= 0)),
    )
    .slice(0, 5)
    .map((metric) => ({
      name: metric.name,
      median: metric.median,
      ...(metric.max === undefined ? {} : { max: metric.max }),
      sampleSize: metric.n,
    }));
  const purchase = source.purchaseStatus || source.paidUsd || source.transaction || source.retrievedAt
    ? {
        amountUsd: cleanText(source.paidUsd, 32),
        status: cleanText(source.purchaseStatus, 32),
        ...(typeof source.transaction === "string" && /^0x[0-9a-f]{64}$/i.test(source.transaction)
          ? { transaction: source.transaction }
          : {}),
        ...(source.retrievedAt && Number.isFinite(Date.parse(source.retrievedAt))
          ? { retrievedAt: new Date(source.retrievedAt).toISOString() }
          : {}),
      }
    : undefined;
  return {
    ref: source.ref,
    title: cleanText(source.source, 120),
    ...(source.provider ? { provider: cleanText(source.provider, 80) } : {}),
    ...(source.serviceId ? { serviceId: cleanText(source.serviceId, 160) } : {}),
    recordsAnalyzed: Number.isFinite(source.itemCount) ? Math.max(0, Math.min(60, Math.floor(source.itemCount))) : 0,
    ...(purchase ? { purchase } : {}),
    metrics,
    hashtags: source.topHashtags
      .filter((tag) => typeof tag.count === "number" && Number.isFinite(tag.count) && tag.count >= 0)
      .slice(0, 8)
      .map((tag) => ({ tag: cleanText(tag.tag, 44), count: Math.floor(tag.count) })),
    topItems: source.topItems.slice(0, 3).map((item) => ({
      text: cleanText(item.text, 140),
      ...(item.author ? { author: cleanText(item.author, 60) } : {}),
      ...(safeUrl(item.url) ? { url: safeUrl(item.url) } : {}),
      ...(item.metric && Number.isFinite(item.metric.value) && item.metric.value >= 0
        ? { metric: { name: cleanText(item.metric.name, 24), value: item.metric.value } }
        : {}),
    })),
    ...(source.hooks && source.hooks.total >= 3 && Number.isFinite(source.hooks.total)
      ? { hooks: source.hooks }
      : {}),
  };
}

export function buildReportDashboard(originalQuestion: string, report: string, analysis: Analysis[]): ReportDashboard {
  const sources = analysis.slice(0, 10).map(dashboardSource).filter((source): source is DashboardSource => source !== undefined);
  const recordsAnalyzed = sources.reduce((sum, source) => sum + source.recordsAnalyzed, 0);
  const narrative = reportSections(report);
  const enoughStructure = recordsAnalyzed > 0;
  return {
    originalQuestion: cleanText(originalQuestion, 500),
    executiveAnswer: answerFrom(report, recordsAnalyzed),
    verdict: enoughStructure
      ? {
          label: "Structured evidence available",
          detail: `${recordsAnalyzed} records were summarized across ${sources.length} source${sources.length === 1 ? "" : "s"}. Relevance to the question is described in the report, not scored by this dashboard.`,
          kind: "available",
        }
      : {
          label: "Limited structured evidence",
          detail: "No structured records were available for the dashboard to summarize. Do not treat this report as a complete answer.",
          kind: "limited",
        },
    quality: { recordsAnalyzed, sourceCount: sources.length },
    sources,
    narrative,
    limitations: [
      "Audience demographics are not included in the computed report data.",
      "Geographic coverage is not included in the computed report data.",
      "Watch time and audience retention are not included in the computed report data.",
      "Record counts are capped at 60 analyzed items per source.",
    ],
    provenanceNote: sources.some((source) => source.purchase)
      ? "Purchase details are recorded where supplied by the completed purchase flow. A separate Buy retrieval ID is not available in this report."
      : "Research source not verified from the report data available.",
  };
}
