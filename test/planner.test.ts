import { describe, expect, it } from "vitest";
import catalogSchemaFixture from "./fixtures/buy-catalog-input-schemas.json" with { type: "json" };
import type { Capability, JsonSchema } from "../src/agent/catalog.js";
import { clarifyResearchIntent, extractResearchIntent, planSteps, researchQuestion } from "../src/agent/planner.js";

const capturedSchemas = catalogSchemaFixture.capabilities as Record<string, JsonSchema>;

function capability(id: string): Capability {
  return {
    id,
    title: id,
    method: "POST",
    url: `https://gateway.usebuy.ai/v1/${id}`,
    platform: "TikTok",
    available: true,
    provider: id.split(".")[2],
    inputSchema: capturedSchemas[id] ?? {},
    price: { usd: "0.01", atomic: "10000", tokens: ["USDC"] },
    tiers: [{ usd: "0.01", atomic: "10000", maxResults: 10, tokens: ["USDC"] }],
  };
}

describe("research planner", () => {
  const syntheticQuestions = {
    complete: "What hooks and formats work best for AI creators on TikTok?",
    ambiguousPlatform: "What tools are trending?",
    missingProfile: "Look up the TikTok profile",
    missingTopic: "Find TikTok videos",
    unsupportedGoal: "Find TikTok Shop products",
  };

  it("extracts user intent without treating payment-status instructions as research", () => {
    const q = "Find TikTok videos about hair-care in Nigeria from the last 7 days. Also check my latest payment status.";
    expect(researchQuestion(q)).toBe("Find TikTok videos about hair-care in Nigeria from the last 7 days.");
    expect(extractResearchIntent(q)).toMatchObject({
      topics: ["hair-care"],
      platforms: ["TikTok"],
      dateWindowDays: 7,
      providerDateRange: "THIS_WEEK",
      geography: "Nigeria",
      locationCode: "NG",
    });
  });

  it("preserves the original question separately from the normalized research intent", () => {
    const originalQuestion = `  ${syntheticQuestions.complete}  `;
    const intent = extractResearchIntent(originalQuestion);
    expect(intent.originalQuestion).toBe(originalQuestion);
    expect(intent.normalizedQuestion).toBe(syntheticQuestions.complete);
    expect(intent).toMatchObject({
      goal: "video_search",
      platforms: ["TikTok"],
      topics: ["AI creators"],
    });
    expect(clarifyResearchIntent(intent)).toEqual([]);
  });

  it("recognizes plural trend requests as trends research", () => {
    const intent = extractResearchIntent("another question about TikTok trends");
    expect(intent.goal).toBe("trends");
    expect(intent.platforms).toEqual(["TikTok"]);
    expect(clarifyResearchIntent(intent)).toEqual([]);
  });

  it("returns structured clarification for ambiguous platform, missing identifiers and insufficient detail", async () => {
    const ambiguous = clarifyResearchIntent(extractResearchIntent(syntheticQuestions.ambiguousPlatform));
    expect(ambiguous).toContainEqual(expect.objectContaining({ code: "ambiguous_platform", requiredInput: "platform" }));

    const missingIdentifier = clarifyResearchIntent(extractResearchIntent(syntheticQuestions.missingProfile));
    expect(missingIdentifier).toContainEqual(expect.objectContaining({
      code: "missing_identifier",
      requiredInput: "creator_handle",
    }));

    const incomplete = clarifyResearchIntent(extractResearchIntent(syntheticQuestions.missingTopic));
    expect(incomplete).toContainEqual(expect.objectContaining({
      code: "insufficient_detail",
      requiredInput: "topic_or_keyword",
    }));

    const syntheticCapability = capability("monid.tiktok.apify.apidojo-tiktok-scraper");
    const planned = await planSteps(syntheticQuestions.ambiguousPlatform, 5, new Map([[syntheticCapability.id, syntheticCapability]]));
    expect(planned).toEqual([]);
  });

  it("reports recognized goals outside current planner coverage without planning them", () => {
    const result = clarifyResearchIntent(extractResearchIntent(syntheticQuestions.unsupportedGoal));
    expect(result).toContainEqual(expect.objectContaining({
      code: "unsupported_goal",
      requiredInput: "supported_goal",
    }));
  });

  it("pairs topical TikTok search with complementary top-content data for broad strategy questions", async () => {
    const topical = "monid.tiktok.apify.apidojo-tiktok-scraper";
    const topContent = "monid.tiktok.tikhub.api-v1-tiktok-ads-get-top-contents-list";
    const caps = new Map([topical, topContent].map((id) => [id, capability(id)]));
    const result = await planSteps("What hooks and formats work best for AI creators on TikTok?", 5, caps, "USDC");
    expect(result.map((step) => step.capabilityId)).toEqual([topContent, topical]);
    expect(new Set(result.map((step) => step.capabilityId)).size).toBe(result.length);
    expect(result.every((step) => step.why.length > 10)).toBe(true);
    expect(result[0]?.why).toMatch(/no topic filter/i);
    expect(result[1]?.recommended).toBe(true);
  });

  it("plans the exact broad request without asking for a video identifier", async () => {
    const question = "Find popular TikTok videos about AI video generation, AI photo editing and AI content creation. Compare views, likes, comments and shares. Identify the most successful video formats and opening hooks.";
    const topical = "monid.tiktok.apify.apidojo-tiktok-scraper";
    const topContent = "monid.tiktok.tikhub.api-v1-tiktok-ads-get-top-contents-list";
    const intent = extractResearchIntent(question);

    expect(intent.goal).toBe("video_search");
    expect(intent.topics).toEqual(["AI video generation", "AI photo editing", "AI content creation"]);
    expect(clarifyResearchIntent(intent)).toEqual([]);

    const result = await planSteps(question, 5, new Map([
      [topical, capability(topical)],
      [topContent, capability(topContent)],
    ]), "USDC");
    expect(result.map((step) => step.capabilityId)).toEqual([topContent, topical]);
    expect(result[0]?.why).toMatch(/no topic filter/i);
    expect(result[1]?.body).toMatchObject({
      body: {
        keywords: ["AI video generation", "AI photo editing", "AI content creation"],
        sortType: "DATE_POSTED",
      },
      maxResults: 10,
    });
  });

  it.each([
    ["Find TikTok videos about AI video generation.", "AI video generation"],
    ["Find popular TikTok videos about AI photo editing.", "AI photo editing"],
  ])("routes broad topic search to the captured TikTok scraper: %s", async (question, keyword) => {
    const id = "monid.tiktok.apify.apidojo-tiktok-scraper";
    const intent = extractResearchIntent(question);
    expect(intent.goal).toBe("video_search");
    expect(clarifyResearchIntent(intent)).toEqual([]);

    const result = await planSteps(question, 5, new Map([[id, capability(id)]]), "USDC");
    expect(result.map((step) => step.capabilityId)).toContain(id);
    expect(result.find((step) => step.capabilityId === id)?.body).toMatchObject({
      body: { keywords: [keyword] },
      maxResults: 10,
    });
  });

  it("maps a broad this-week request to the scraper's captured date range", async () => {
    const id = "monid.tiktok.apify.apidojo-tiktok-scraper";
    const question = "Find TikTok videos about AI tools posted this week.";
    const intent = extractResearchIntent(question);
    expect(intent.goal).toBe("video_search");
    expect(clarifyResearchIntent(intent)).toEqual([]);

    const result = await planSteps(question, 5, new Map([[id, capability(id)]]), "USDC");
    expect(result.find((step) => step.capabilityId === id)?.body).toMatchObject({
      body: { keywords: ["AI tools"], dateRange: "THIS_WEEK" },
    });
  });

  it("treats comments in an engagement metric list as broad video search", async () => {
    const question = "Compare AI content creation videos on TikTok by views, likes, comments and shares.";
    const id = "monid.tiktok.apify.apidojo-tiktok-scraper";
    const intent = extractResearchIntent(question);
    expect(intent.goal).toBe("video_search");
    expect(clarifyResearchIntent(intent)).toEqual([]);

    const result = await planSteps(question, 5, new Map([[id, capability(id)]]), "USDC");
    expect(result.map((step) => step.capabilityId)).toEqual([id]);
  });

  it("requires a source identifier for actual comment-thread analysis and routes a supplied URL", async () => {
    const question = "Summarise what people are saying in the comments on this TikTok video.";
    const intent = extractResearchIntent(question);
    expect(intent.goal).toBe("post_comments");
    expect(clarifyResearchIntent(intent)).toContainEqual(expect.objectContaining({
      code: "missing_identifier",
      requiredInput: "post_url_or_video_id",
    }));

    const commentsId = "monid.tiktok.apify.scraptik-tiktok-comments-scraper-api";
    const result = await planSteps(
      `${question} https://www.tiktok.com/@maker/video/1234567890123456789`,
      5,
      new Map([[commentsId, capability(commentsId)]]),
      "USDC",
    );
    expect(result.map((step) => step.capabilityId)).toEqual([commentsId]);
    expect(result[0]?.body).toMatchObject({
      body: { listComments_awemeId: "1234567890123456789" },
    });
  });

  it.each([
    "Fetch comments on this TikTok post.",
    "Retrieve comments on this TikTok post.",
    "Get comments on this TikTok post.",
    "Read comments on this TikTok post.",
    "Collect comments on this TikTok post.",
  ])("requires an identifier for explicit comment retrieval: %s", (question) => {
    const intent = extractResearchIntent(question);
    expect(intent.goal).toBe("post_comments");
    expect(clarifyResearchIntent(intent)).toContainEqual(expect.objectContaining({
      code: "missing_identifier",
      requiredInput: "post_url_or_video_id",
    }));
  });

  it.each([
    "Find the most popular TikTok videos about AI video generation.",
    "Find the most successful TikTok videos about AI video generation.",
    "Find the best-performing TikTok videos about AI video generation.",
    "Find the top-performing TikTok content about AI video generation.",
  ])("adds the unfiltered top-content route for top-content intent: %s", async (question) => {
    const topContent = "monid.tiktok.tikhub.api-v1-tiktok-ads-get-top-contents-list";
    const topical = "monid.tiktok.apify.apidojo-tiktok-scraper";
    const result = await planSteps(question, 5, new Map([
      [topContent, capability(topContent)],
      [topical, capability(topical)],
    ]), "USDC");

    expect(result.map((step) => step.capabilityId)).toEqual([topContent, topical]);
    expect(result[0]?.why).toMatch(/no topic filter/i);
    expect(result[0]?.body).not.toHaveProperty("body.keywords");
  });

  it("keeps top-content-only requests purchasable without adding a generic topical search", async () => {
    const id = "monid.tiktok.tikhub.api-v1-tiktok-ads-get-top-contents-list";
    const intent = extractResearchIntent("Find the most popular TikTok videos.");
    expect(clarifyResearchIntent(intent)).toEqual([]);

    const result = await planSteps(intent.normalizedQuestion, 5, new Map([[id, capability(id)]]), "USDC");
    expect(result.map((step) => step.capabilityId)).toEqual([id]);
    expect(result[0]?.why).toMatch(/no topic filter/i);
  });

  it("routes a valid TikTok video URL to the video-metrics capability", async () => {
    const id = "monid.tiktok.tikhub.api-v1-tiktok-analytics-fetch-video-metrics";
    const question = "Get video metrics for this TikTok video: https://www.tiktok.com/@maker/video/1234567890123456789";
    const intent = extractResearchIntent(question);
    expect(intent.goal).toBe("video_metrics");
    expect(clarifyResearchIntent(intent)).toEqual([]);

    const result = await planSteps(question, 5, new Map([[id, capability(id)]]), "USDC");
    expect(result.map((step) => step.capabilityId)).toEqual([id]);
    expect(result[0]?.body).toEqual({ queryParams: { item_id: "1234567890123456789" } });
  });

  it("routes an explicitly labeled supported TikTok video ID consistently", async () => {
    const id = "monid.tiktok.tikhub.api-v1-tiktok-analytics-fetch-video-metrics";
    const question = "Get video metrics for TikTok video ID: 1234567890123456789";
    const intent = extractResearchIntent(question);
    expect(intent.goal).toBe("video_metrics");
    expect(clarifyResearchIntent(intent)).toEqual([]);

    const result = await planSteps(question, 5, new Map([[id, capability(id)]]), "USDC");
    expect(result.map((step) => step.capabilityId)).toEqual([id]);
    expect(result[0]?.body).toEqual({ queryParams: { item_id: "1234567890123456789" } });
  });

  it("does not accept an arbitrary short number as a TikTok video ID", () => {
    const intent = extractResearchIntent("Get video metrics for TikTok video ID: 12345");
    expect(clarifyResearchIntent(intent)).toContainEqual(expect.objectContaining({
      code: "missing_identifier",
      requiredInput: "post_url_or_video_id",
    }));
  });

  it.each([
    [
      "Get video metrics for this TikTok video: https://www.tiktok.com/@maker/video/12345",
      "malformed TikTok URL with short video ID",
    ],
    [
      "Get video metrics for this TikTok video: https://www.youtube.com/watch?v=1234567890123456789",
      "unrelated-platform URL in TikTok metrics request",
    ],
    [
      "Get video metrics for TikTok; unrelated number 1234567890123456789",
      "arbitrary unlabeled 19-digit number",
    ],
  ])("clarifies instead of routing when the TikTok metrics identifier is invalid: %s", async (question) => {
    const intent = extractResearchIntent(question);
    const clarifications = clarifyResearchIntent(intent);
    expect(intent.goal).toBe("video_metrics");
    expect(clarifications).toContainEqual(expect.objectContaining({
      code: "missing_identifier",
      requiredInput: "post_url_or_video_id",
      prompt: expect.stringMatching(/valid TikTok video URL|explicitly labeled TikTok video ID/i),
    }));
    await expect(planSteps(question, 5, new Map(), "USDC")).resolves.toEqual([]);
  });

  it("preserves Instagram general keyword search and its captured request schema", async () => {
    const id = "monid.instagram.tikhub.api-v1-instagram-v2-general-search";
    const question = "Find Instagram content about sustainable fashion.";
    const intent = extractResearchIntent(question);
    expect(intent.goal).toBe("video_search");
    expect(clarifyResearchIntent(intent)).toEqual([]);

    const result = await planSteps(question, 5, new Map([[id, capability(id)]]), "USDC");
    expect(result.map((step) => step.capabilityId)).toEqual([id]);
    expect(result[0]?.body).toEqual({ queryParams: { keyword: "sustainable fashion" } });
  });

  it.each([
    [
      "Find Instagram posts about Ankara fashion and styling.",
      "video_search",
      [
        "monid.instagram.tikhub.api-v1-instagram-v2-general-search",
        "monid.instagram.tikhub.api-v1-instagram-v2-fetch-hashtag-posts",
      ],
    ],
    [
      "Find popular Instagram hashtags related to fashion.",
      "hashtag_discovery",
      ["monid.instagram.tikhub.api-v1-instagram-v2-search-hashtags"],
    ],
    [
      "What hooks and formats work best for small AI content creators on TikTok?",
      "video_search",
      [
        "monid.tiktok.tikhub.api-v1-tiktok-ads-get-top-contents-list",
        "monid.tiktok.apify.apidojo-tiktok-scraper",
      ],
    ],
    [
      "Which AI video tools are trending on TikTok this week?",
      "trends",
      ["monid.tiktok.tikhub.api-v1-tiktok-ads-get-trends-hashtag-list"],
    ],
  ])("maps Try One prompt to supported planner sources: %s", async (question, goal, expectedIds) => {
    expect(question.length).toBeLessThanOrEqual(500);
    const intent = extractResearchIntent(question);
    expect(intent.goal).toBe(goal);
    expect(clarifyResearchIntent(intent)).toEqual([]);
    const capabilities = new Map(expectedIds.map((id) => [id, capability(id)]));

    const result = await planSteps(question, 5, capabilities, "USDC");
    expect(result.map((step) => step.capabilityId)).toEqual(expectedIds);
  });

  it("does not recommend a service that is missing or unavailable", async () => {
    const id = "monid.tiktok.tikhub.api-v1-tiktok-ads-get-trends-hashtag-list";
    const unavailable = capability(id);
    unavailable.available = false;
    const result = await planSteps("What TikTok trends are popular this week?", 5, new Map([[id, unavailable]]), "USDC");
    expect(result).toEqual([]);
  });
});
