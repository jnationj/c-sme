import { getCatalog, validateCapabilityInput, type Capability, type CapabilityPrice } from "./catalog.js";

export type ResearchPlatform = "TikTok" | "Instagram";

export type ResearchGoal =
  | "video_search"
  | "profile_lookup"
  | "post_comments"
  | "video_metrics"
  | "video_details"
  | "creator_discovery"
  | "creator_posts"
  | "hashtag_discovery"
  | "hashtag_posts"
  | "trends"
  | "unsupported_product_research"
  | "unsupported_ads_research"
  | "unsupported_analytics"
  | "unsupported_audience_research"
  | "unsupported_location_or_music"
  | "unspecified";

export interface ResearchIntent {
  originalQuestion: string;
  normalizedQuestion: string;
  goal: ResearchGoal;
  topics: string[];
  platforms: ResearchPlatform[];
  excludedPlatforms: ResearchPlatform[];
  requestedCount?: number;
  dateWindowDays?: number;
  providerDateRange?: "YESTERDAY" | "THIS_WEEK" | "THIS_MONTH" | "LAST_THREE_MONTHS";
  geography?: string;
  locationCode?: string;
  targetedVideoSearch: boolean;
}

export interface ResearchClarification {
  code: "ambiguous_platform" | "missing_identifier" | "unsupported_goal" | "insufficient_detail";
  prompt: string;
  requiredInput?: string;
}

export interface PlanStep {
  capabilityId: string;
  title: string;
  provider: string;
  url: string;
  body: unknown;
  quoteAtomic: bigint;
  why: string;
  recommended?: boolean;
  platform?: ResearchPlatform;
  resultLimit?: number;
}

const STOP = new Set(
  "a an the of and or to in on for with is are was be which what who how that this those these currently right now most best working work looking gaining their they them from by at as it its do does can i me my accounts account smaller small types type ideas using use get getting more increase reach niche creators creator strategies strategy contributing views view post posts tiktok instagram sellers seller charging format formats find recent public research identify compare suggest search service available buy results result return each limit only last days day week month preparing launch brand focused focus relevant recurring hashtags patterns engagement source sources links names available metrics do not invent findings posted".split(" "),
);

const COUNTRY_CODES: Record<string, string> = {
  nigeria: "NG",
  "united states": "US",
  usa: "US",
  us: "US",
  "united kingdom": "GB",
  uk: "GB",
  canada: "CA",
  australia: "AU",
  india: "IN",
  ghana: "GH",
  kenya: "KE",
};

const PAYMENT_OPERATIONS = [
  /^\s*(?:(?:also|and|please)[,\s]+)*(?:check|review|look up|show|verify)\s+(?:my\s+)?(?:(?:previous|past|recent|latest)\s+)?(?:payment|payments|transaction|transactions|receipt|settlement|settlements)(?:\s+(?:status|history|details))?\s*[,!.?]*\s*$/i,
  /^\s*(?:(?:first|also|and|please)[,\s]+)*(?:check|review|verify)\s+(?:my\s+)?(?:(?:previous|past|recent|latest|last)\s+)?attempt\s+to avoid duplicate purchases?(?: or charges?)?\s*[,!.?]*\s*$/i,
  /^\s*(?:(?:first|also|and|please)[,\s]+)*(?:check|review|verify)\s+whether\s+(?:my\s+)?(?:(?:previous|past|recent|latest|last)\s+)?(?:payment|transaction)\s+(?:went through|was successful|succeeded|completed)\s+before\s+(?:buying|purchasing)\s*[,!.?]*\s*$/i,
];

export function researchQuestion(question: string): string {
  return question.split(/\r?\n+|(?<=[.!?])\s+/)
    .filter((sentence) => !PAYMENT_OPERATIONS.some((operation) => operation.test(sentence)))
    .join(" ")
    .trim();
}

function extractTopics(objective: string): string[] {
  const clauses = [
    ...[...objective.matchAll(/\bfocused on\s+([^.!?\n]+)/gi)].map((match) => match[1]!),
    ...[...objective.matchAll(/\b(?:about|regarding|related to)\s+([^.!?\n]+)/gi)].map((match) => match[1]!),
  ];
  const topics = new Set<string>();
  const creatorAudience = objective.match(/\b(?:for|among)\s+((?:(?:small|independent|emerging|new|micro|nano)\s+)?(?:AI\s+)?(?:content\s+)?creators?)\b/i);
  if (creatorAudience) topics.add(creatorAudience[1]!.trim());
  if (/\bhair-care\b/i.test(objective)) topics.add("hair-care");

  for (const clause of clauses) {
    for (const part of clause.split(/[,;]|\s+(?:and|or)\s+/i)) {
      const clean = part
        .replace(/\b(?:in|from|within|across)\s+(?:Nigeria|United States|USA|US|United Kingdom|UK|Canada|Australia|India|Ghana|Kenya)\b.*$/i, " ")
        .replace(/\b(?:in|from|within|across)\s+(?:[A-Z]{2}|[A-Z][\p{L}-]*(?:\s+[A-Z][\p{L}-]*){0,2})\b.*$/u, " ")
        .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
        .split(/\s+/)
        .filter((word) => (word.length > 2 || word.toLowerCase() === "ai") && !STOP.has(word.toLowerCase()))
        .join(" ")
        .trim();
      if (clean) topics.add(clean);
    }
  }
  if (topics.size) return [...topics];

  const words = objective.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((word) => (word.length > 2 || word === "ai") && !STOP.has(word));
  return words.length ? [[...new Set(words)].join(" ")] : [];
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};

function parsedNumber(value: string): number | undefined {
  return /^\d+$/.test(value) ? Number(value) : NUMBER_WORDS[value.toLowerCase()];
}

export function extractResearchIntent(question: string): ResearchIntent {
  const research = researchQuestion(question);
  const normalized = research.toLowerCase();
  const excludedPlatforms: ResearchPlatform[] = [];
  const jointlyNegated = /\b(?:do not|don't|never|avoid|exclude|without)\s+(?:(?:search|use|include)\s+)?(?:tiktok\s+(?:and|or)\s+instagram|instagram\s+(?:and|or)\s+tiktok)\b/i.test(research);
  if (jointlyNegated) excludedPlatforms.push("TikTok", "Instagram");
  for (const [platform, name] of [["TikTok", "tiktok"], ["Instagram", "instagram"]] as const) {
    if (new RegExp(`\\b(?:do not|don't|never|avoid|exclude|without)\\s+(?:(?:search|use|include)\\s+)?${name}\\b`, "i").test(research) &&
      !excludedPlatforms.includes(platform)) excludedPlatforms.push(platform);
  }
  const platforms = (["TikTok", "Instagram"] as const).filter((platform) =>
    !excludedPlatforms.includes(platform) && new RegExp(`\\b${platform}\\b`, "i").test(research),
  );
  const countMatch = normalized.match(/\b(?:up to|at most|no more than)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:relevant|recent|public)\s+)*(?:tiktok\s+)?(?:videos?|posts?|results?|items?)\b/i)
    ?? normalized.match(/\blimit(?: the request to)?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  const requestedCount = countMatch ? parsedNumber(countMatch[1]!) : undefined;
  const windowMatch = normalized.match(/\b(?:last|past|previous|within)\s+(?:the\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b/i);
  const dateWindowDays = windowMatch
    ? parsedNumber(windowMatch[1]!)
    : /\bthis week\b/i.test(normalized)
      ? 7
      : undefined;
  const providerDateRange = dateWindowDays === undefined
    ? undefined
    : dateWindowDays <= 1
      ? "YESTERDAY"
      : dateWindowDays <= 7
        ? "THIS_WEEK"
        : dateWindowDays <= 30
          ? "THIS_MONTH"
          : dateWindowDays <= 90
            ? "LAST_THREE_MONTHS"
            : undefined;
  const geoMatch = research.match(/\b(?:in|from|within|across)\s+(Nigeria|United States|USA|US|United Kingdom|UK|Canada|Australia|India|Ghana|Kenya)\b/i)
    ?? research.match(/\b(?:in|from|within|across)\s+([A-Z]{2})\b/)
    ?? research.match(/\b(?:in|from|within|across)\s+([A-Z][\p{L}-]*(?:\s+[A-Z][\p{L}-]*){0,2})/u);
  const geography = geoMatch?.[1];
  const locationCode = geography
    ? COUNTRY_CODES[geography.toLowerCase()] ?? (/^[A-Z]{2}$/i.test(geography) ? geography.toUpperCase() : undefined)
    : undefined;
  const topics = extractTopics(research);
  return {
    originalQuestion: question,
    normalizedQuestion: research.replace(/\s+/g, " ").trim(),
    goal: classifyResearchGoal(research),
    topics,
    platforms,
    excludedPlatforms,
    ...(requestedCount ? { requestedCount } : {}),
    ...(dateWindowDays ? { dateWindowDays } : {}),
    ...(providerDateRange ? { providerDateRange } : {}),
    ...(geography ? { geography } : {}),
    ...(locationCode ? { locationCode } : {}),
    targetedVideoSearch: /\bvideos?\b/i.test(research) && topics.length > 0,
  };
}

function classifyResearchGoal(question: string): ResearchGoal {
  const q = question.toLowerCase();
  if (isSpecificPostCommentAnalysis(q)) return "post_comments";
  if (/\b(?:product|shopping|shop|catalogue|catalog)\b/.test(q)) return "unsupported_product_research";
  if (/\b(?:ads?|advertisements?|sponsored content|ad library)\b/.test(q)) return "unsupported_ads_research";
  if (/\b(?:creator|account|video)\s+(?:analytics|insights|milestones|audience)\b/.test(q)) return "unsupported_analytics";
  if (/\b(?:followers?|following|audience demographics?)\b/.test(q)) return "unsupported_audience_research";
  if (/\b(?:locations?|music|sounds?)\b/.test(q) && /\b(?:search|find|discover|research|trending|popular)\b/.test(q)) {
    return "unsupported_location_or_music";
  }
  if (/\b(?:profile|account lookup|creator account)\b/.test(q)) return "profile_lookup";
  if (/\b(?:video|engagement)\s+metrics?\b|\bmetrics?\s+for\b/.test(q)) return "video_metrics";
  if (/\b(?:details?|analyze|analyse|breakdown)\b/.test(q) && /\b(?:video|post|reel)\b/.test(q)) return "video_details";
  if (/\bhashtags?\b/.test(q) && /\b(?:posts?|videos?|content)\b/.test(q)) return "hashtag_posts";
  if (/\b(?:hashtag discovery|hashtag search|discover hashtags|search hashtags|find hashtags|popular hashtags|hashtags? related to|hashtags? for)\b/.test(q)) {
    return "hashtag_discovery";
  }
  if (/\b(?:trends?|trending|emerging topics?)\b/.test(q)) return "trends";
  if (/\b(?:find|discover|search for|who are|list)\b.{0,50}\b(?:creators?|influencers?|sellers?|accounts?)\b/.test(q)) {
    return "creator_discovery";
  }
  if (/\b(?:posts?|videos?|reels?)\b/.test(q) &&
    /\b(?:from|by|posted by)\s+@?(?!(?:views?|likes?|comments?|shares?|saves?|engagement)\b)[a-z0-9._]{2,64}\b/i.test(q)) {
    return "creator_posts";
  }
  if (/\b(?:videos?|posts?|reels?|content|hooks?|formats?)\b/.test(q)) return "video_search";
  return "unspecified";
}

function hasSpecificTopic(intent: ResearchIntent): boolean {
  const generic = new Set([
    "account", "accounts", "best", "comments", "content", "creator", "creators", "data",
    "format", "formats", "hashtag", "hashtags", "hook", "hooks", "ideas", "metrics",
    "popular", "posts", "profile", "profiles", "reel", "reels", "research", "results",
    "search", "tools", "trend", "trending", "video", "videos",
  ]);
  return intent.topics.some((topic) =>
    topic.toLowerCase().split(/\s+/).some((word) => word.length > 1 && !generic.has(word)),
  );
}

function hasVideoIdentifier(question: string, platforms: ResearchPlatform[]): boolean {
  const tiktokContext = platforms.includes("TikTok") || /\btiktok\b|tiktok\.com/i.test(question);
  if (tiktokContext) return extractTikTokVideoId(question) !== undefined;

  const instagramContext = platforms.includes("Instagram") || /\binstagram\b|instagram\.com/i.test(question);
  if (instagramContext) {
    return /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/i.test(question);
  }
  return extractTikTokVideoId(question) !== undefined ||
    /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/i.test(question);
}

function isSpecificPostCommentAnalysis(question: string): boolean {
  const requestsCommentAnalysis =
    /\b(?:analyse|analyze|summari[sz]e|extract|review|identify|fetch|get|read|collect|retrieve|what (?:are )?people (?:say|saying|ask|asking))\b.{0,100}\bcomments?\b/i.test(question);
  const identifiesPost =
    /\b(?:this|that|the|provided|linked)\s+(?:(?:public|tiktok|instagram)\s+){0,2}(?:post|video|reel)\b/i.test(question) ||
    /\b(?:post|video|reel)(?:'s)?\s+comments?\b/i.test(question);
  return requestsCommentAnalysis && identifiesPost;
}

function extractTikTokVideoId(question: string): string | undefined {
  const urlId = question.match(
    /https?:\/\/(?:www\.)?tiktok\.com\/[^/\s"'<>]+\/video\/(\d{19})(?=$|[/?#\s])/i,
  )?.[1];
  if (urlId) return urlId;
  return question.match(/\btiktok\s+video\s+id\s*[:#]?\s*(\d{19})\b/i)?.[1];
}

function isTopContentRequest(question: string): boolean {
  return /\b(?:top|best|top-performing|best-performing|most popular|most successful)\b.{0,30}\b(?:content|videos?|posts?)\b/i.test(question) ||
    (/\b(hooks?|formats?)\b/i.test(question) && /\b(work|perform|effective|best|successful)\b/i.test(question));
}

/** Returns blockers before planning so unclear requests never cause catalogue or purchase activity. */
export function clarifyResearchIntent(intent: ResearchIntent): ResearchClarification[] {
  const q = intent.normalizedQuestion;
  const clarifications: ResearchClarification[] = [];
  const unsupportedPlatform = /\b(?:youtube|facebook|instagram threads|threads|snapchat|pinterest|x\.com)\b/i
    .test(q.replace(/https?:\/\/[^\s"'<>]+/g, " "));
  const unsupportedGoals = new Set<ResearchGoal>([
    "unsupported_product_research",
    "unsupported_ads_research",
    "unsupported_analytics",
    "unsupported_audience_research",
    "unsupported_location_or_music",
  ]);

  if (unsupportedPlatform) {
    clarifications.push({
      code: "unsupported_goal",
      prompt: "This planner currently supports TikTok and Instagram research only. Which supported platform would you like to use?",
      requiredInput: "supported_platform",
    });
    return clarifications;
  }
  if (unsupportedGoals.has(intent.goal)) {
    clarifications.push({
      code: "unsupported_goal",
      prompt: "This research goal is not available in the current planner. Try video or post search, profile lookup, creator discovery, comments, video metrics, or TikTok trends.",
      requiredInput: "supported_goal",
    });
    return clarifications;
  }
  if (intent.goal === "unspecified") {
    const shortRequest = q.split(/\s+/).filter(Boolean).length < 4;
    clarifications.push({
      code: shortRequest ? "insufficient_detail" : "unsupported_goal",
      prompt: shortRequest
        ? "What topic or account should I research, and what would you like to learn about it?"
        : "I could not match this request to a supported research task. Try video search, profile lookup, creator discovery, comments, video metrics, or TikTok trends.",
      requiredInput: shortRequest ? "research_goal_and_subject" : "supported_goal",
    });
    return clarifications;
  }

  if (!intent.platforms.length) {
    clarifications.push({
      code: "ambiguous_platform",
      prompt: "Which platform should I research: TikTok or Instagram?",
      requiredInput: "platform",
    });
  }

  const topContentWithoutTopic = intent.platforms.includes("TikTok") && isTopContentRequest(q);
  if (["video_search", "creator_discovery", "hashtag_discovery", "hashtag_posts"].includes(intent.goal) &&
    !hasSpecificTopic(intent) && !topContentWithoutTopic) {
    clarifications.push({
      code: "insufficient_detail",
      prompt: "What topic, keyword, or hashtag should I use for the research?",
      requiredInput: "topic_or_keyword",
    });
  }

  const handle = /@([A-Za-z0-9._]{2,64})/.test(q);
  const identifierMissing =
    (intent.goal === "profile_lookup" && !handle) ||
    (intent.goal === "creator_posts" && !handle) ||
    (intent.goal === "post_comments" && !hasVideoIdentifier(q, intent.platforms)) ||
    ((intent.goal === "video_metrics" || intent.goal === "video_details") &&
      !hasVideoIdentifier(q, intent.platforms));
  if (identifierMissing) {
    const requiredInput = intent.goal === "profile_lookup" || intent.goal === "creator_posts"
      ? "creator_handle"
      : "post_url_or_video_id";
    clarifications.push({
      code: "missing_identifier",
      requiredInput,
      prompt: requiredInput === "creator_handle"
        ? "Which public creator handle should I look up?"
        : intent.platforms.includes("TikTok")
          ? "Please provide a valid TikTok video URL with its 19-digit ID, or an explicitly labeled TikTok video ID."
          : "Please provide the public post URL or supported video ID.",
    });
  }

  if (intent.goal === "trends" && intent.platforms.includes("Instagram")) {
    clarifications.push({
      code: "unsupported_goal",
      prompt: "The current planner has a trends route for TikTok, but not Instagram. Would you like TikTok trends instead?",
      requiredInput: "supported_platform",
    });
  }
  if (intent.goal === "hashtag_posts" && intent.platforms.includes("TikTok") && !intent.platforms.includes("Instagram")) {
    clarifications.push({
      code: "unsupported_goal",
      prompt: "Hashtag-post retrieval is not currently planned for TikTok. Try TikTok trend discovery or provide an Instagram hashtag-post request.",
      requiredInput: "supported_goal",
    });
  }
  if (intent.goal === "video_search" && intent.platforms.includes("Instagram") && /\b(?:videos?|reels?)\b/i.test(q)) {
    clarifications.push({
      code: "unsupported_goal",
      prompt: "Targeted Instagram video and reel search is not currently planned. Try Instagram keyword or creator discovery instead.",
      requiredInput: "supported_goal",
    });
  }
  return clarifications;
}

export function researchLimitations(question: string): string[] {
  const intent = extractResearchIntent(question);
  const notes: string[] = [];
  if (intent.geography && !intent.locationCode) {
    notes.push(`The requested location "${intent.geography}" is not supported by the matching Buy search filters; the planner will not substitute a broader location.`);
  }
  if (intent.dateWindowDays && !intent.providerDateRange) {
    notes.push(`The requested ${intent.dateWindowDays}-day date window is outside the matching service's supported date ranges.`);
  }
  if (intent.excludedPlatforms.length === 2) {
    notes.push("TikTok and Instagram were both excluded, so no social-data purchase is recommended.");
  }
  if (!intent.platforms.length && !/\b(tiktok|short-form video|creator video|instagram|reels?|hashtags?|influencers?)\b/i.test(researchQuestion(question))) {
    notes.push("The supported catalogue services cover TikTok and Instagram; this request does not identify a supported platform.");
  }
  return notes;
}

export function keywords(q: string, max = 3): string[] {
  return extractResearchIntent(q).topics.slice(0, max);
}

type Candidate = {
  id: string;
  body: unknown;
  why: string;
  platform: ResearchPlatform;
  recommended?: boolean;
  tiered?: boolean;
  tierRequest?: number;
};

function supportsToken(price: CapabilityPrice, token: string): boolean {
  return !price.tokens || price.tokens.includes(token);
}

/**
 * Deterministic research planner adapted from cPilot. It only plans known service IDs,
 * checks current catalogue availability/schema/pricing, and never lets an LLM choose spending.
 */
export async function planSteps(question: string, maxSteps = 5, catalog?: Map<string, Capability>, token = "USDC"): Promise<PlanStep[]> {
  const intent = extractResearchIntent(question);
  if (clarifyResearchIntent(intent).length) return [];
  const caps = catalog ?? await getCatalog();
  const research = researchQuestion(question);
  const q = research.toLowerCase();
  const phrase = intent.topics.join(" ") || research.trim();
  const handle = research.match(/@([A-Za-z0-9._]{2,64})/)?.[1]?.replace(/[.,!?]+$/, "");
  const directUrl = research.match(/https?:\/\/(?:www\.)?(?:tiktok\.com|instagram\.com)\/[^\s"'<>]+/i)?.[0]?.replace(/[.,!?]+$/, "");
  const asksComments = isSpecificPostCommentAnalysis(q);
  const asksProfile = /\b(profile|creator account|account lookup)\b/i.test(q);
  const asksPosts = /\b(posts?|reels?)\b/i.test(q);
  const asksReels = /\breels?\b/i.test(q);
  const asksTrends = /\b(trend|trending|discover hashtags|hashtag discovery)\b/i.test(q);
  const asksHashtagDiscovery = /\b(?:hashtag discovery|hashtag search|hashtag trends|discover hashtags|search hashtags|find hashtags|trending hashtags|popular hashtags|hashtags? related to|hashtags? for)\b/i.test(q);
  const asksTopContent = isTopContentRequest(q);
  const asksCreators = /\b(creator discovery|discover (?:tiktok |instagram )?creators|find (?:tiktok |instagram )?creators|search for (?:tiktok |instagram )?creators|influencer discovery|find (?:tiktok |instagram )?influencers|creator profiles)\b/i.test(q);
  const asksDetails = /\b(details?|engagement metrics|video metrics)\b/i.test(q);
  const asksHashtagPosts = /\b(hashtag posts?|posts? for #|posts? under #)\b/i.test(q);
  const explicitlyTargets = intent.platforms.length > 0 || intent.excludedPlatforms.length > 0;
  const inferredTikTok = /\b(tiktok|short-form video|creator video)\b/i.test(q);
  const inferredInstagram = /\b(instagram|reels?|hashtags?|influencers?)\b/i.test(q);
  const platforms: ResearchPlatform[] = explicitlyTargets
    ? intent.platforms
    : inferredTikTok && inferredInstagram
      ? ["TikTok", "Instagram"]
      : inferredTikTok
        ? ["TikTok"]
        : inferredInstagram
          ? ["Instagram"]
          : [];
  const requested = Math.min(20, intent.requestedCount ?? 10);
  const candidates: Candidate[] = [];
  const add = (id: string, body: unknown, why: string, platform: ResearchPlatform, tiered = false, tierRequest = requested, recommended = true) =>
    candidates.push({ id, body, why, platform, tiered, tierRequest, recommended });
  const selectedTier = (id: string, tierRequest = requested) => {
    const cap = caps.get(id);
    const tiers = cap?.tiers.filter((tier) => tier.maxResults !== undefined && supportsToken(tier, token))
      .sort((a, b) => a.maxResults! - b.maxResults!);
    return tiers?.find((tier) => tier.maxResults! >= tierRequest) ?? tiers?.at(-1);
  };

  for (const platform of platforms) {
    if (platform === "TikTok") {
      const videoId = extractTikTokVideoId(research);
      if (asksComments && videoId) {
        add("monid.tiktok.apify.scraptik-tiktok-comments-scraper-api",
          { body: { listComments_awemeId: videoId, listComments_count: requested } },
          "Comments for the supplied TikTok video", platform);
      } else if (videoId && asksDetails && /\b(engagement metrics|video metrics)\b/i.test(q)) {
        add("monid.tiktok.tikhub.api-v1-tiktok-analytics-fetch-video-metrics",
          { queryParams: { item_id: videoId } }, "Available metrics for the supplied TikTok video", platform);
      } else if (directUrl && asksDetails) {
        add("monid.tiktok.apify.clockworks-tiktok-video-scraper",
          { body: { postURLs: [directUrl] } }, "Details for the supplied TikTok video URL", platform, true, 1);
      } else if (handle && asksPosts) {
        const tier = selectedTier("monid.tiktok.apify.apidojo-tiktok-profile-scraper");
        if (tier) add("monid.tiktok.apify.apidojo-tiktok-profile-scraper",
          { body: { usernames: [handle] } }, `Recent TikTok profile posts from @${handle}`, platform, true);
      } else if (handle && asksProfile) {
        add("monid.tiktok.apify.scraptik-tiktok-api",
          { body: { profile_username: handle } }, `TikTok profile for @${handle}`, platform);
      } else if (asksCreators && !handle) {
        add("monid.tiktok.tikhub.api-v1-tiktok-web-fetch-search-user",
          { queryParams: { keyword: phrase } }, `TikTok creator discovery for "${phrase}"`, platform);
      } else if (asksHashtagPosts) {
        continue;
      } else {
        if (asksTrends) {
          add("monid.tiktok.tikhub.api-v1-tiktok-ads-get-trends-hashtag-list",
            { body: { time_range: 7, limit: requested }, queryParams: {} }, "TikTok trending hashtag discovery", platform);
        }
        if (asksTopContent) {
          add("monid.tiktok.tikhub.api-v1-tiktok-ads-get-top-contents-list",
            { body: { period_end_timestamp: Math.floor(Date.now() / 86_400_000) * 86_400, limit: requested }, queryParams: {} },
            "Broader TikTok top-content sample for comparison; this catalogue service has no topic filter", platform);
        }
        if (hasSpecificTopic(intent) && (!intent.geography || intent.locationCode) &&
          !asksHashtagDiscovery && !asksCreators && !asksProfile && !asksPosts) {
          const keywords = intent.topics;
          add("monid.tiktok.apify.apidojo-tiktok-scraper", {
            body: {
              keywords,
              ...(intent.providerDateRange ? { dateRange: intent.providerDateRange } : {}),
              sortType: "DATE_POSTED",
              ...(intent.locationCode ? { location: intent.locationCode } : {}),
            },
          }, `TikTok videos matching ${intent.topics.map((topic) => `"${topic}"`).join(" or ")}`, platform, true);
        }
      }
    } else {
      if (directUrl && asksComments && /instagram\.com/i.test(directUrl)) {
        add("monid.instagram.tikhub.api-v1-instagram-v2-fetch-post-comments",
          { queryParams: { code_or_url: directUrl } }, "Comments for the supplied Instagram post URL", platform);
      } else if (directUrl && asksDetails && /instagram\.com/i.test(directUrl)) {
        add("monid.instagram.apify.apify-instagram-api-scraper",
          { body: { directUrls: [directUrl], resultsType: "details" } }, "Details for the supplied Instagram post URL", platform, true, 1);
      } else if (handle && asksPosts && asksReels) {
        add("monid.instagram.tikhub.api-v1-instagram-v2-fetch-user-reels",
          { queryParams: { username: handle } }, `Recent Instagram reels from @${handle}`, platform);
      } else if (handle && asksPosts) {
        add("monid.instagram.tikhub.api-v1-instagram-v2-fetch-user-posts",
          { queryParams: { username: handle } }, `Recent Instagram posts from @${handle}`, platform);
      } else if (handle && asksProfile) {
        add("monid.instagram.apify.apify-instagram-profile-scraper",
          { body: { usernames: [handle] } }, `Instagram profile for @${handle}`, platform, true, 1);
      } else if (asksCreators && !handle) {
        add("monid.instagram.tikhub.api-v1-instagram-v2-search-users",
          { queryParams: { keyword: phrase } }, `Instagram creator discovery for "${phrase}"`, platform);
      } else if (asksHashtagPosts) {
        const hashtag = (intent.topics[0] ?? phrase).replace(/^#/, "").replace(/\s+/g, "");
        add("monid.instagram.tikhub.api-v1-instagram-v2-fetch-hashtag-posts",
          { queryParams: { keyword: hashtag } }, `Instagram posts for #${hashtag}`, platform);
      } else if (asksHashtagDiscovery) {
        add("monid.instagram.tikhub.api-v1-instagram-v2-search-hashtags",
          { queryParams: { keyword: phrase } }, `Instagram hashtag discovery for "${phrase}"`, platform);
      } else if (asksReels || intent.targetedVideoSearch) {
        continue;
      } else if (intent.topics.length) {
        add("monid.instagram.tikhub.api-v1-instagram-v2-general-search",
          { queryParams: { keyword: phrase } }, `Instagram content search for "${phrase}"`, platform);
        const hashtag = (intent.topics[0] ?? phrase).replace(/^#/, "").replace(/\s+/g, "");
        add("monid.instagram.tikhub.api-v1-instagram-v2-fetch-hashtag-posts",
          { queryParams: { keyword: hashtag } },
          `Optional hashtag-specific sample for #${hashtag}; this is narrower than the recommended keyword search`,
          platform, false, requested, false);
      }
    }
  }

  const steps: PlanStep[] = [];
  const added = new Set<string>();
  for (const candidate of candidates) {
    if (added.has(candidate.id)) continue;
    const cap = caps.get(candidate.id);
    if (!cap?.available || cap.method !== "POST" || !cap.price || !supportsToken(cap.price, token)) continue;
    const tier = candidate.tiered ? selectedTier(candidate.id, candidate.tierRequest) : undefined;
    if (candidate.tiered && !tier) continue;
    const body = candidate.tiered && tier && candidate.body && typeof candidate.body === "object"
      ? { ...(candidate.body as Record<string, unknown>), maxResults: tier.maxResults }
      : candidate.body;
    if (validateCapabilityInput(cap, body).length) continue;
    const amount = tier?.atomic ?? cap.price.atomic;
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) continue;
    steps.push({
      capabilityId: cap.id,
      title: cap.title,
      provider: cap.provider ?? cap.id.split(".")[2] ?? "unknown",
      url: cap.url,
      body,
      quoteAtomic: BigInt(amount),
      why: candidate.why,
      recommended: candidate.recommended !== false,
      platform: candidate.platform,
      ...(tier?.maxResults !== undefined ? { resultLimit: tier.maxResults } : {}),
    });
    added.add(candidate.id);
    if (steps.length >= maxSteps) break;
  }
  return steps;
}

/** Stage 2 is intentionally absent: no account-post follow-up is purchased without a new research decision. */
export async function followUpSteps(_bought: unknown[]): Promise<PlanStep[]> {
  return [];
}
