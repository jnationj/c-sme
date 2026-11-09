import { afterEach, describe, expect, it, vi } from "vitest";
import catalogSchemaFixture from "./fixtures/buy-catalog-input-schemas.json" with { type: "json" };
import { getCatalog, validateCapabilityInput, type Capability, type JsonSchema } from "../src/agent/catalog.js";

afterEach(() => vi.unstubAllGlobals());

const schemas = catalogSchemaFixture.capabilities as Record<string, JsonSchema>;

const capability = (id: string, inputSchema: JsonSchema | undefined): Capability => {
  if (inputSchema === undefined) throw new Error(`Missing schema fixture for ${id}`);
  return {
    id,
    title: id,
    method: "POST",
    url: "https://gateway.usebuy.ai/v1/test",
    platform: "test",
    available: true,
    inputSchema,
    tiers: [],
  };
};

describe("Buy catalogue", () => {
  it("accepts only Buy-gateway services and preserves real provider and token prices", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      capabilities: [
        {
          id: "service-one",
          title: "Video search",
          method: "POST",
          url: "https://gateway.usebuy.ai/v1/services/search",
          platform: "TikTok",
          available: true,
          agent: { provider: "apify" },
          price: { usd: "0.01", atomic: "10000", tokens: ["USDC"] },
          inputSchema: { type: "object" },
        },
        {
          id: "direct-provider",
          title: "Not a Buy endpoint",
          method: "POST",
          url: "https://api.provider.example/search",
          platform: "TikTok",
          available: true,
          price: { usd: "0.01", atomic: "10000" },
        },
      ],
    }), { status: 200 })));

    const catalog = await getCatalog(true);
    expect(catalog.size).toBe(1);
    expect(catalog.get("service-one")).toMatchObject({
      url: "https://gateway.usebuy.ai/v1/services/search",
      provider: "apify",
      price: { usd: "0.01", atomic: "10000", tokens: ["USDC"] },
    });
    expect(catalog.has("direct-provider")).toBe(false);
  });

  it("surfaces catalogue failures instead of substituting a fixture or fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(getCatalog(true)).rejects.toThrow("catalog fetch failed: HTTP 503");
  });

  it("preserves complete captured schemas from the live catalogue response", async () => {
    expect(Object.keys(schemas)).toEqual([
      "monid.instagram.tikhub.api-v1-instagram-v2-general-search",
      "monid.instagram.tikhub.api-v1-instagram-v2-search-hashtags",
      "monid.instagram.tikhub.api-v1-instagram-v2-fetch-hashtag-posts",
      "monid.tiktok.apify.apidojo-tiktok-scraper",
      "monid.tiktok.tikhub.api-v1-tiktok-ads-get-trends-hashtag-list",
      "monid.tiktok.tikhub.api-v1-tiktok-analytics-fetch-video-metrics",
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      capabilities: Object.entries(schemas).map(([id, inputSchema]) => ({
        id,
        title: "Captured schema",
        method: "POST",
        url: "https://gateway.usebuy.ai/v1/test",
        platform: "test",
        available: true,
        inputSchema,
      })),
    }), { status: 200 })));

    const catalog = await getCatalog(true);
    for (const [id, inputSchema] of Object.entries(schemas)) {
      expect(catalog.get(id)?.inputSchema).toEqual(inputSchema);
    }
  });
});

describe("captured Buy input schemas", () => {
  const validInputs: Record<string, unknown> = {
    "monid.instagram.tikhub.api-v1-instagram-v2-general-search": { queryParams: { keyword: "celo" } },
    "monid.instagram.tikhub.api-v1-instagram-v2-search-hashtags": { queryParams: { keyword: "celo" } },
    "monid.instagram.tikhub.api-v1-instagram-v2-fetch-hashtag-posts": { queryParams: { keyword: "celo" } },
    "monid.tiktok.apify.apidojo-tiktok-scraper": { body: {}, maxResults: 5 },
    "monid.tiktok.tikhub.api-v1-tiktok-ads-get-trends-hashtag-list": { body: {}, queryParams: {} },
    "monid.tiktok.tikhub.api-v1-tiktok-analytics-fetch-video-metrics": { queryParams: { item_id: "video-123" } },
  };

  for (const [id, input] of Object.entries(validInputs)) {
    it(`accepts a valid payload for ${id}`, () => {
      expect(validateCapabilityInput(capability(id, schemas[id]), input)).toEqual([]);
    });
  }

  it("enforces required fields recursively", () => {
    const errors = validateCapabilityInput(
      capability("instagram-search", schemas["monid.instagram.tikhub.api-v1-instagram-v2-general-search"]),
      { queryParams: {} },
    );
    expect(errors).toContain("input.queryParams.keyword is required");

    const apifyErrors = validateCapabilityInput(
      capability("apify", schemas["monid.tiktok.apify.apidojo-tiktok-scraper"]),
      { body: {} },
    );
    expect(apifyErrors).toContain("input.maxResults is required");

    const trendsErrors = validateCapabilityInput(
      capability("trends", schemas["monid.tiktok.tikhub.api-v1-tiktok-ads-get-trends-hashtag-list"]),
      { body: {} },
    );
    expect(trendsErrors).toContain("input.queryParams is required");

    const videoErrors = validateCapabilityInput(
      capability("video-metrics", schemas["monid.tiktok.tikhub.api-v1-tiktok-analytics-fetch-video-metrics"]),
      { queryParams: {} },
    );
    expect(videoErrors).toContain("input.queryParams.item_id is required");
  });

  it("rejects unknown fields at closed object levels", () => {
    const instagramErrors = validateCapabilityInput(
      capability("instagram-search", schemas["monid.instagram.tikhub.api-v1-instagram-v2-general-search"]),
      { queryParams: { keyword: "celo", extra: true }, topLevelExtra: true },
    );
    expect(instagramErrors).toContain("input.queryParams.extra is not allowed");
    expect(instagramErrors).toContain("input.topLevelExtra is not allowed");

    const trendsErrors = validateCapabilityInput(
      capability("trends", schemas["monid.tiktok.tikhub.api-v1-tiktok-ads-get-trends-hashtag-list"]),
      { body: { extra: true }, queryParams: { extra: true } },
    );
    expect(trendsErrors).toContain("input.body.extra is not allowed");
    expect(trendsErrors).toContain("input.queryParams.extra is not allowed");

    const apifyErrors = validateCapabilityInput(
      capability("apify", schemas["monid.tiktok.apify.apidojo-tiktok-scraper"]),
      { body: { extra: true }, maxResults: 1 },
    );
    expect(apifyErrors).toContain("input.body.extra is not allowed");
  });

  it("rejects incorrect primitive types with useful paths", () => {
    const instagramErrors = validateCapabilityInput(
      capability("instagram-search", schemas["monid.instagram.tikhub.api-v1-instagram-v2-general-search"]),
      { queryParams: { keyword: 42 } },
    );
    expect(instagramErrors).toContain("input.queryParams.keyword must be string");

    const apifyErrors = validateCapabilityInput(
      capability("apify", schemas["monid.tiktok.apify.apidojo-tiktok-scraper"]),
      { body: { includeSearchKeywords: "yes" }, maxResults: 5 },
    );
    expect(apifyErrors).toContain("input.body.includeSearchKeywords must be boolean");
  });

  it("enforces documented enum constraints without adding undocumented ones", () => {
    const apify = capability("apify", schemas["monid.tiktok.apify.apidojo-tiktok-scraper"]);
    expect(validateCapabilityInput(apify, { body: { dateRange: "TODAY" }, maxResults: 3 })).toEqual([
      "input.body.dateRange is not an allowed value",
      "input.maxResults is not an allowed value",
    ]);
    expect(validateCapabilityInput(apify, { body: { dateRange: "THIS_WEEK", location: "NG", sortType: "MOST_LIKED" }, maxResults: 10 })).toEqual([]);

    const hashtags = capability("hashtag-posts", schemas["monid.instagram.tikhub.api-v1-instagram-v2-fetch-hashtag-posts"]);
    expect(validateCapabilityInput(hashtags, { queryParams: { keyword: "celo", feed_type: "any documented-by-caller value" } })).toEqual([]);
  });

  it("accepts optional fields and does not apply schema defaults to the caller payload", () => {
    const payload = {
      body: { industry_id: 10000000000 },
      queryParams: {},
    };
    const original = JSON.stringify(payload);
    const trends = capability("trends", schemas["monid.tiktok.tikhub.api-v1-tiktok-ads-get-trends-hashtag-list"]);
    expect(validateCapabilityInput(trends, payload)).toEqual([]);
    expect(JSON.stringify(payload)).toBe(original);

    const hashtagPosts = capability("hashtag-posts", schemas["monid.instagram.tikhub.api-v1-instagram-v2-fetch-hashtag-posts"]);
    expect(validateCapabilityInput(hashtagPosts, {
      queryParams: { keyword: "celo", pagination_token: "next", feed_type: "recent" },
    })).toEqual([]);
  });

  it("does not invent item constraints for captured arrays without items schemas", () => {
    const apify = capability("apify", schemas["monid.tiktok.apify.apidojo-tiktok-scraper"]);
    expect(validateCapabilityInput(apify, {
      body: { keywords: [null, 7, { value: true }], startUrls: [false, []] },
      maxResults: 1,
    })).toEqual([]);
  });
});

describe("JSON Schema combinators", () => {
  it("supports synthetic anyOf nullable unions", () => {
    const nullableString = capability("synthetic-nullable", {
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(validateCapabilityInput(nullableString, "text")).toEqual([]);
    expect(validateCapabilityInput(nullableString, null)).toEqual([]);
    expect(validateCapabilityInput(nullableString, 42)).toContain("input must match at least one allowed schema");
  });

  it("fails safely for unimplemented schema keywords", () => {
    const unsupported = capability("unsupported", { type: "string", unevaluatedProperties: false });
    expect(validateCapabilityInput(unsupported, "value")).toContain(
      'input schema uses unsupported keyword "unevaluatedProperties"',
    );
  });

  it("supports synthetic numeric, string, and array constraints", () => {
    const constrained = capability("synthetic-constraints", {
      type: "object",
      additionalProperties: false,
      properties: {
        count: { type: "number", minimum: 2, exclusiveMaximum: 10, multipleOf: 2 },
        label: { type: "string", minLength: 2, maxLength: 5, pattern: "^[a-z]+$" },
        tags: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string" } },
      },
    });
    expect(validateCapabilityInput(constrained, {
      count: 4,
      label: "celo",
      tags: ["one", "two"],
    })).toEqual([]);
    expect(validateCapabilityInput(constrained, {
      count: 3,
      label: "1",
      tags: ["same", "same", 7],
    })).toEqual([
      "input.count is not a multiple of the catalogue constraint",
      "input.label is too short",
      "input.label does not match the catalogue pattern",
      "input.tags has too many items",
      "input.tags must contain unique items",
      "input.tags[2] must be string",
    ]);
  });

  it("supports synthetic boolean schemas", () => {
    const rejected = capability("synthetic-false", false);
    expect(validateCapabilityInput(rejected, {})).toContain("input is not allowed by the catalogue schema");
    expect(validateCapabilityInput(capability("synthetic-true", true), {})).toEqual([]);
  });
});
