import { describe, expect, it } from "vitest";
import { analyzeAll, analyzeSource, findItems, hookFlags, renderFromAnalysis } from "../src/agent/analyze.js";
import { looksValid } from "../src/agent/report.js";
import { Ledger } from "../src/ledger/ledger.js";

// Shapes modelled on what the providers returned in our test runs.
const trends = {
  BaseResp: { StatusCode: 0 },
  items: [
    { hashtagID: "1", hashtagName: "halloweekend", publishCnt: 350970, rankIndex: 1, vv: 900000, topCreators: [{ handleName: "x" }] },
    { hashtagID: "2", hashtagName: "saturween", publishCnt: 142399, rankIndex: 2, vv: 165449287 },
    { hashtagID: "3", hashtagName: "november1st", publishCnt: 19026, rankIndex: 3 },
  ],
};

const videos = [
  { id: "1", title: "7 hooks to use for AI videos #aitools #fyp", views: 12000, likes: 900, comments: 30, shares: 10, channel: { username: "abc", followers: 5400 }, postPage: "https://www.tiktok.com/@abc/video/1" },
  { id: "2", title: "How to make AI videos in 5 minutes #aitools", views: 45000, likes: 3000, comments: 120, shares: 80, channel: { username: "def", followers: 20000 }, postPage: "https://www.tiktok.com/@def/video/2" },
  { id: "3", title: "Stop making this AI video mistake?", views: 800, likes: 40, comments: 2, shares: 0, channel: { username: "ghi", followers: 300 } },
  { id: "4", title: "POV: you found the best AI tool #aitools", views: 5000, likes: 400, comments: 10, shares: 5, channel: { username: "jkl", followers: 900 } },
];

const instaUsers = { status: "ok", users: [{ position: 0, user: { username: "herfit.ng", full_name: "ANKARA RTW/BASIC TOPS IN LAGOS", follower_count: 12000, profile_pic_url: "https://x.fbcdn.net/a.jpg" } }] };

describe("findItems", () => {
  it("finds the first array of objects wherever the provider put it", () => {
    expect(findItems(trends)).toHaveLength(3);
    expect(findItems(videos)).toHaveLength(4);
    expect(findItems(instaUsers)).toHaveLength(1);
    expect(findItems({ a: 1, b: [1, 2, 3] })).toEqual([]);
    expect(findItems(null)).toEqual([]);
  });
});

describe("hookFlags", () => {
  it("recognises common hook patterns", () => {
    expect(hookFlags("7 hooks to use").numbered).toBe(true);
    expect(hookFlags("Do you make this mistake?").question).toBe(true);
    expect(hookFlags("How to grow fast").howTo).toBe(true);
    expect(hookFlags("Stop doing this").negative).toBe(true);
    expect(hookFlags("POV: you start today").pov).toBe(true);
    expect(hookFlags("Before and after glow up").beforeAfter).toBe(true);
    expect(hookFlags("plain caption")).toEqual({ numbered: false, question: false, howTo: false, negative: false, pov: false, beforeAfter: false });
  });
});

describe("analyzeSource", () => {
  it("ranks trending hashtags by size and keeps their post counts", () => {
    const a = analyzeSource("S1", { title: "Trends", why: "w", output: trends });
    expect(a.itemCount).toBe(3);
    // ranked by video views where available: #saturween (165M views) outranks #halloweekend (900k)
    expect(a.topItems[0]).toMatchObject({ text: "#saturween", metric: { name: "views", value: 165449287 } });
    expect(a.metrics.map((m) => m.name)).toContain("posts");
  });

  it("computes hashtag counts, medians, top items and hook patterns from videos", () => {
    const a = analyzeSource("S2", { title: "Videos", why: "w", output: videos });
    expect(a.topHashtags[0]).toEqual({ tag: "#aitools", count: 3 });
    const views = a.metrics.find((m) => m.name === "views")!;
    expect(views.max).toBe(45000);
    expect(views.median).toBe(8500); // (5000 + 12000) / 2
    expect(a.topItems[0]).toMatchObject({ author: "def", metric: { name: "views", value: 45000 }, url: "https://www.tiktok.com/@def/video/2" });
    expect(a.hooks).toMatchObject({ total: 4, numbered: 1, question: 1, howTo: 1, negative: 1, pov: 1 });
  });

  it("never picks an image or avatar link as a post link", () => {
    const a = analyzeSource("S3", { title: "IG", why: "w", output: instaUsers });
    expect(a.topItems[0]?.url).toBeUndefined();
    expect(a.topItems[0]).toMatchObject({ text: "ANKARA RTW/BASIC TOPS IN LAGOS", author: "herfit.ng" });
    expect(a.hooks).toBeUndefined(); // account names are not captions, so no hook analysis
  });

  it("keeps a trimmed raw snippet when nothing can be mined", () => {
    const a = analyzeSource("S4", { title: "Odd", why: "w", output: { weird: { nested: "x" } } });
    expect(a.itemCount).toBe(0);
    expect(a.raw).toContain("weird");
  });
});

describe("renderFromAnalysis (the no-AI report)", () => {
  const an = analyzeAll([
    { title: "Trends", why: "w", output: trends },
    { title: "Videos", why: "w", output: videos },
  ]);
  const text = renderFromAnalysis("hooks for AI creators", an);

  it("has the three required sections and cites sources", () => {
    expect(text).toMatch(/## What the data shows/);
    expect(text).toMatch(/## What to do this week/);
    expect(text).toMatch(/## What this data can't tell you/);
    expect(text).toContain("[S1]");
    expect(text).toContain("[S2]");
  });
  it("reports the computed numbers and the most common hook", () => {
    expect(text).toContain("45,000");
    expect(text).toContain("#aitools (3)");
    expect(text).toMatch(/Hook patterns \[S2\]/);
  });
  it("does not call one-off trending hashtags 'most used'", () => {
    const only = renderFromAnalysis("q", analyzeAll([{ title: "Trends", why: "w", output: trends }]));
    expect(only).not.toMatch(/most-used hashtags/);
  });
});

describe("looksValid (AI output must follow the format and only cite real sources)", () => {
  const an = analyzeAll([{ title: "T", why: "w", output: videos }]);
  const good = "## What the data shows\n- Fact [S1]\n## What to do this week\n- Act\n## What this data can't tell you\n- Gaps";
  it("accepts a well-formed, correctly cited report", () => expect(looksValid(good, an)).toBe(true));
  it("rejects a missing section", () => expect(looksValid("## What the data shows\n- x [S1]", an)).toBe(false));
  it("rejects citations to sources that do not exist", () => expect(looksValid(good.replace("[S1]", "[S9]"), an)).toBe(false));
  it("rejects a report with no citations", () => expect(looksValid(good.replace(" [S1]", ""), an)).toBe(false));
});

describe("Ledger raw outputs", () => {
  it("stores and returns what was bought, so reports can be re-analysed without paying again", () => {
    const l = new Ledger();
    l.saveRaw("p1", 0, "Videos", videos);
    l.saveRaw("p1", 1, "Trends", trends);
    const raw = l.getRaw("p1");
    expect(raw.map((r) => r.idx)).toEqual([0, 1]);
    expect(findItems(raw[0]!.output)).toHaveLength(4);
    expect(l.getRaw("nope")).toEqual([]);
  });
});
