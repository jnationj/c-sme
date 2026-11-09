import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildReportDashboard } from "../src/agent/report-dashboard.js";
import type { Analysis } from "../src/agent/analyze.js";

const toolsFixture: Analysis = {
  ref: "S1",
  source: "TikTok search",
  why: "Example presentation fixture",
  itemCount: 10,
  topHashtags: [
    { tag: "#tools", count: 5 },
    { tag: "#diytools", count: 3 },
    { tag: "#diy", count: 3 },
  ],
  metrics: [
    { name: "views", median: 3_332_458, max: 19_847_036, n: 10 },
    { name: "saves", median: 10_490, n: 10 },
  ],
  topItems: [],
};

const fixtureReport = [
  "## What the data shows",
  "- **Answer:** The supplied sample concerns physical tools and DIY, not AI video software. [S1]",
  "## What to do this week",
  "- Search specifically for AI video software.",
  "## What this data can't tell you",
  "- It does not show audience geography or retention.",
].join("\n");

describe("structured report dashboard", () => {
  it("preserves the question and supplied aggregate figures without inventing evidence", () => {
    const dashboard = buildReportDashboard("tools trending", fixtureReport, [toolsFixture]);
    expect(dashboard.originalQuestion).toBe("tools trending");
    expect(dashboard.executiveAnswer).toContain("physical tools and DIY");
    expect(dashboard.verdict.kind).toBe("available");
    expect(dashboard.quality).toEqual({ recordsAnalyzed: 10, sourceCount: 1 });
    expect(dashboard.sources[0]?.metrics).toEqual([
      { name: "views", median: 3_332_458, max: 19_847_036, sampleSize: 10 },
      { name: "saves", median: 10_490, sampleSize: 10 },
    ]);
    expect(dashboard.sources[0]?.hashtags).toEqual([
      { tag: "#tools", count: 5 },
      { tag: "#diytools", count: 3 },
      { tag: "#diy", count: 3 },
    ]);
    expect(dashboard.sources[0]?.topItems).toEqual([]);
    expect(dashboard.sources[0]).not.toHaveProperty("raw");
    expect(dashboard.provenanceNote).toMatch(/not verified/i);
  });

  it("keeps actual source metadata and references while rejecting unsafe links", () => {
    const source: Analysis = {
      ...toolsFixture,
      provider: "Apify",
      serviceId: "real-service-id",
      paidUsd: "0.009",
      purchaseStatus: "settled",
      transaction: "0x" + "a".repeat(64),
      retrievedAt: "2026-02-01T12:00:00.000Z",
      topItems: [
        { text: "<img src=x onerror=alert(1)>", author: "creator", url: "javascript:alert(1)", metric: { name: "views", value: 40 } },
        { text: "Valid record", url: "https://example.com/post/1" },
      ],
    };
    const dashboard = buildReportDashboard("question", fixtureReport, [source]);
    expect(dashboard.sources[0]).toMatchObject({
      ref: "S1",
      provider: "Apify",
      serviceId: "real-service-id",
      purchase: { amountUsd: "0.009", status: "settled", transaction: "0x" + "a".repeat(64) },
    });
    expect(dashboard.sources[0]?.topItems[0]).not.toHaveProperty("url");
    expect(dashboard.sources[0]?.topItems[1]?.url).toBe("https://example.com/post/1");
    expect(dashboard.narrative.actions).toContain("Search specifically");
    expect(dashboard.narrative.findings).toContain("[S1]");
  });

  it("does not turn absent metrics or evidence into zero-valued charts", () => {
    const empty: Analysis = { ref: "S2", source: "Service", why: "", itemCount: 0, topHashtags: [], metrics: [], topItems: [] };
    const dashboard = buildReportDashboard("question", "No report data", [empty]);
    expect(dashboard.verdict.kind).toBe("limited");
    expect(dashboard.quality.recordsAnalyzed).toBe(0);
    expect(dashboard.sources[0]?.metrics).toEqual([]);
    expect(dashboard.sources[0]?.hashtags).toEqual([]);
    expect(dashboard.sources[0]?.topItems).toEqual([]);
  });

  it("uses safe text-only DOM rendering and has responsive chart and evidence layouts", () => {
    const app = readFileSync("src/web/app.js", "utf8");
    const css = readFileSync("src/web/styles.css", "utf8");
    const formatSource = app.match(/function numberText\(value\) \{[\s\S]*?\n  \}/)?.[0];
    expect(formatSource).toBeDefined();
    const numberText = runInNewContext(`(${formatSource})`) as (value: unknown) => string;
    expect(numberText(3_332_458)).toBe("3,332,458");
    expect(numberText(undefined)).toBe("Unavailable");
    expect(app).toContain("n.textContent = attrs[k]");
    expect(app).not.toMatch(/\.innerHTML\s*=/);
    expect(app).toContain("item.url && /^(https?:\\/\\/)/i.test(item.url)");
    expect(css).toContain(".dashboard-kpis { display: grid");
    expect(css).toContain(".evidence-grid { display: grid");
    expect(css).toContain("@media (max-width: 560px)");
  });
});
