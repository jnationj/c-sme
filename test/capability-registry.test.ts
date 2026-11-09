import { describe, expect, it } from "vitest";
import {
  AUDITED_AVAILABLE_CAPABILITIES,
  AUDITED_CATALOG_SNAPSHOT,
  AUDITED_UNAVAILABLE_CAPABILITIES,
  getAuditedCapability,
} from "../src/agent/capability-registry.js";

describe("audited capability registry snapshot", () => {
  it("keeps the available catalogue inventory offline and separate from authoritative live pricing", () => {
    expect(AUDITED_CATALOG_SNAPSHOT).toMatchObject({
      authoritative: false,
      availableSocialCapabilityCount: 65,
      additionalUnavailableCapabilityCount: 2,
      outputSchemasPublished: false,
    });
    expect(AUDITED_AVAILABLE_CAPABILITIES).toHaveLength(65);
    expect(new Set(AUDITED_AVAILABLE_CAPABILITIES.map((entry) => entry.id)).size).toBe(65);
    expect(AUDITED_AVAILABLE_CAPABILITIES.every((entry) => entry.availability === "available")).toBe(true);
    expect(AUDITED_AVAILABLE_CAPABILITIES.every((entry) => entry.method === "POST")).toBe(true);
    expect(AUDITED_AVAILABLE_CAPABILITIES.every((entry) => entry.path.startsWith("/v1/social/"))).toBe(true);
  });

  it("separates the 18 existing planner routes from catalogue-only capabilities", () => {
    expect(AUDITED_AVAILABLE_CAPABILITIES.filter((entry) => entry.plannerSupport === "existing_planner_route")).toHaveLength(18);
    expect(AUDITED_AVAILABLE_CAPABILITIES.filter((entry) => entry.plannerSupport === "catalogue_only")).toHaveLength(47);
    expect(getAuditedCapability("monid.tiktok.apify.apidojo-tiktok-scraper")?.plannerSupport).toBe("existing_planner_route");
    expect(getAuditedCapability("monid.instagram.apify.apify-instagram-search-scraper")?.plannerSupport).toBe("catalogue_only");
  });

  it("records the two unavailable additions outside the 65-capability usable registry", () => {
    expect(AUDITED_UNAVAILABLE_CAPABILITIES.map((entry) => entry.id)).toEqual([
      "monid.instagram.apify.apify-instagram-hashtag-scraper",
      "monid.instagram.apify.apify-instagram-post-scraper",
    ]);
    expect(AUDITED_UNAVAILABLE_CAPABILITIES.every((entry) => entry.availability === "unavailable")).toBe(true);
    expect(AUDITED_UNAVAILABLE_CAPABILITIES.every((entry) => !getAuditedCapability(entry.id))).toBe(true);
  });

  it("preserves input field type/requiredness and actual price tiers without output schemas", () => {
    const profileCapability = getAuditedCapability("monid.instagram.apify.apify-instagram-profile-scraper")!;
    expect(profileCapability.inputSchema).toContainEqual({ path: "body.usernames", type: "array", required: true });
    expect(profileCapability.pricing.map((price) => [price.usd, price.maxResults])).toEqual([
      ["0.0062", 1],
      ["0.019", 5],
      ["0.035", 10],
    ]);
    expect(profileCapability.pricing[0]?.tokens).toEqual(["USDC", "USDT", "USAT"]);
    expect("outputSchema" in profileCapability).toBe(false);
  });
});
