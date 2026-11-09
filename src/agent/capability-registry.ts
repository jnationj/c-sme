export type RegistryProvider = "apify" | "tikhub" | "mrscraper";
export type RegistryInputType = "object" | "array" | "string" | "integer" | "number" | "boolean" | "unspecified";
export type PlannerSupport = "existing_planner_route" | "catalogue_only";

export interface InputFieldSnapshot {
  path: string;
  type: RegistryInputType;
  required: boolean;
}

export interface RegistryPriceSnapshot {
  usd: string;
  tokens: readonly ["USDC", "USDT", "USAT"];
  model: "per_call" | "max_results";
  maxResults?: number;
}

export interface AuditedCapability {
  id: string;
  provider: RegistryProvider;
  method: "POST";
  path: string;
  availability: "available" | "unavailable";
  plannerSupport: PlannerSupport;
  pricing: readonly RegistryPriceSnapshot[];
  inputSchema: readonly InputFieldSnapshot[];
}

function capability(
  id: string,
  provider: RegistryProvider,
  path: string,
  priceSnapshot: string,
  inputSnapshot: string,
  plannerSupport: PlannerSupport,
  availability: AuditedCapability["availability"] = "available",
): AuditedCapability {
  const pricing = priceSnapshot.split("|").map((entry): RegistryPriceSnapshot => {
    const [model, tier, usd] = entry.split(":");
    if ((model !== "per_call" && model !== "max_results") || !usd || (model === "max_results" && !tier)) {
      throw new Error(`Invalid audited price snapshot for ${id}`);
    }
    return {
      usd,
      tokens: ["USDC", "USDT", "USAT"],
      model,
      ...(model === "max_results" ? { maxResults: Number(tier) } : {}),
    };
  });
  const inputSchema = inputSnapshot.split(",").map((entry): InputFieldSnapshot => {
    const match = /^([A-Za-z0-9_.]+):(object|array|string|integer|number|boolean|unspecified)([!?])$/.exec(entry);
    if (!match) throw new Error(`Invalid audited input snapshot for ${id}`);
    return {
      path: match[1]!,
      type: match[2] as RegistryInputType,
      required: match[3] === "!",
    };
  });
  return { id, provider, method: "POST", path, availability, plannerSupport, pricing, inputSchema };
}

/**
 * Public GET catalogue snapshot captured 2026-11-09.
 * This offline reference is not authoritative for current availability or prices.
 * The audited social catalogue published no output schemas or response metadata.
 */
export const AUDITED_CATALOG_SNAPSHOT = Object.freeze({
  source: "https://gateway.usebuy.ai/v1/catalog",
  capturedOn: "2026-11-09",
  authoritative: false,
  availableSocialCapabilityCount: 65,
  additionalUnavailableCapabilityCount: 2,
  outputSchemasPublished: false,
});

export const AUDITED_AVAILABLE_CAPABILITIES = [
  capability("instagram.profile", "tikhub", "/v1/social/instagram/profile", "per_call::0.005", "username:string!", "catalogue_only"),
  capability("monid.instagram.apify.apify-instagram-api-scraper", "apify", "/v1/social/instagram/tools/apify-apify-instagram-api-scraper", "max_results:1:0.02", "body:object!,body.directUrls:array?,body.resultsType:string?,body.onlyPostsNewerThan:string?,body.search:string?,body.searchType:string?,body.addParentData:boolean?,maxResults:integer!", "existing_planner_route"),
  capability("monid.instagram.apify.apify-instagram-profile-scraper", "apify", "/v1/social/instagram/tools/apify-apify-instagram-profile-scraper", "max_results:1:0.0062|max_results:5:0.019|max_results:10:0.035", "body:object!,body.usernames:array!,body.includeAboutSection:boolean?,maxResults:integer!", "existing_planner_route"),
  capability("monid.instagram.apify.apify-instagram-search-scraper", "apify", "/v1/social/instagram/tools/apify-apify-instagram-search-scraper", "max_results:1:0.006|max_results:5:0.018|max_results:10:0.033", "body:object!,body.search:string!,body.searchType:string?,body.enhanceUserSearchWithFacebookPage:boolean?,body.liveSearch:boolean?,maxResults:integer!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-fetch-comment-replies", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-fetch-comment-replies", "per_call::0.005", "queryParams:object!,queryParams.min_id:string?,queryParams.media_id:string!,queryParams.comment_id:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-fetch-location-posts", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-fetch-location-posts", "per_call::0.005", "queryParams:object!,queryParams.tab:string?,queryParams.end_cursor:string?,queryParams.location_id:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-fetch-post-by-url", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-fetch-post-by-url", "per_call::0.005", "queryParams:object!,queryParams.post_url:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-fetch-related-profiles", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-fetch-related-profiles", "per_call::0.005", "queryParams:object!,queryParams.user_id:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-fetch-search", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-fetch-search", "per_call::0.005", "queryParams:object!,queryParams.select:string?,queryParams.query:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-fetch-user-about-info", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-fetch-user-about-info", "per_call::0.005", "queryParams:object!,queryParams.user_id:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-fetch-user-info-by-username", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-fetch-user-info-by-username", "per_call::0.005", "queryParams:object!,queryParams.username:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-fetch-user-info-by-username-v3", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-fetch-user-info-by-username-v3", "per_call::0.005", "queryParams:object!,queryParams.username:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-fetch-user-posts", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-fetch-user-posts", "per_call::0.005", "queryParams:object!,queryParams.user_id:string!,queryParams.count:integer?,queryParams.max_id:string?", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-fetch-user-posts-v2", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-fetch-user-posts-v2", "per_call::0.005", "queryParams:object!,queryParams.user_id:string!,queryParams.end_cursor:string?,queryParams.count:integer?", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-fetch-user-reels", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-fetch-user-reels", "per_call::0.005", "queryParams:object!,queryParams.user_id:string!,queryParams.count:integer?,queryParams.max_id:string?", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v1-user-id-to-username", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v1-user-id-to-username", "per_call::0.005", "queryParams:object!,queryParams.user_id:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-fetch-comment-replies", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-fetch-comment-replies", "per_call::0.007", "queryParams:object!,queryParams.pagination_token:string?,queryParams.comment_id:string!,queryParams.code_or_url:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-fetch-hashtag-posts", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-fetch-hashtag-posts", "per_call::0.007", "queryParams:object!,queryParams.pagination_token:string?,queryParams.keyword:string!,queryParams.feed_type:string?", "existing_planner_route"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-fetch-location-posts", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-fetch-location-posts", "per_call::0.007", "queryParams:object!,queryParams.pagination_token:string?,queryParams.location_id:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-fetch-post-comments", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-fetch-post-comments", "per_call::0.007", "queryParams:object!,queryParams.pagination_token:string?,queryParams.sort_by:string?,queryParams.code_or_url:string!", "existing_planner_route"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-fetch-similar-users", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-fetch-similar-users", "per_call::0.007", "queryParams:object!,queryParams.user_id:string?,queryParams.username:string?", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-fetch-user-followers", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-fetch-user-followers", "per_call::0.007", "queryParams:object!,queryParams.pagination_token:string?,queryParams.user_id:string?,queryParams.username:string?", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-fetch-user-following", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-fetch-user-following", "per_call::0.007", "queryParams:object!,queryParams.pagination_token:string?,queryParams.user_id:string?,queryParams.username:string?", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-fetch-user-info", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-fetch-user-info", "per_call::0.007", "queryParams:object!,queryParams.user_id:string?,queryParams.username:string?", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-fetch-user-posts", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-fetch-user-posts", "per_call::0.007", "queryParams:object!,queryParams.pagination_token:string?,queryParams.user_id:string?,queryParams.username:string?", "existing_planner_route"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-fetch-user-reels", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-fetch-user-reels", "per_call::0.007", "queryParams:object!,queryParams.pagination_token:string?,queryParams.user_id:string?,queryParams.username:string?", "existing_planner_route"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-fetch-user-tagged-posts", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-fetch-user-tagged-posts", "per_call::0.007", "queryParams:object!,queryParams.pagination_token:string?,queryParams.user_id:string?,queryParams.username:string?", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-general-search", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-general-search", "per_call::0.007", "queryParams:object!,queryParams.pagination_token:string?,queryParams.keyword:string!", "existing_planner_route"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-search-hashtags", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-search-hashtags", "per_call::0.007", "queryParams:object!,queryParams.keyword:string!", "existing_planner_route"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-search-locations", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-search-locations", "per_call::0.007", "queryParams:object!,queryParams.keyword:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-search-music", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-search-music", "per_call::0.007", "queryParams:object!,queryParams.keyword:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-search-reels", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-search-reels", "per_call::0.007", "queryParams:object!,queryParams.pagination_token:string?,queryParams.keyword:string!", "catalogue_only"),
  capability("monid.instagram.tikhub.api-v1-instagram-v2-search-users", "tikhub", "/v1/social/instagram/tools/tikhub-api-v1-instagram-v2-search-users", "per_call::0.007", "queryParams:object!,queryParams.keyword:string!", "existing_planner_route"),
  capability("tiktok.profile", "tikhub", "/v1/social/tiktok/profile", "per_call::0.005", "username:string!", "catalogue_only"),
  capability("monid.tiktok.apify.apidojo-tiktok-profile-scraper", "apify", "/v1/social/tiktok/tools/apify-apidojo-tiktok-profile-scraper", "max_results:1:0.0036|max_results:5:0.006|max_results:10:0.009", "body:object!,body.startUrls:array?,body.usernames:array?,body.until:string?,body.since:string?,maxResults:integer!", "existing_planner_route"),
  capability("monid.tiktok.apify.apidojo-tiktok-scraper", "apify", "/v1/social/tiktok/tools/apify-apidojo-tiktok-scraper", "max_results:1:0.0036|max_results:5:0.006|max_results:10:0.009", "body:object!,body.startUrls:array?,body.keywords:array?,body.dateRange:string?,body.location:string?,body.sortType:string?,body.includeSearchKeywords:boolean?,maxResults:integer!", "existing_planner_route"),
  capability("monid.tiktok.apify.clockworks-tiktok-video-scraper", "apify", "/v1/social/tiktok/tools/apify-clockworks-tiktok-video-scraper", "max_results:1:0.005|max_results:5:0.013|max_results:10:0.023", "body:object!,body.postURLs:array!,body.shouldDownloadVideos:boolean?,body.shouldDownloadCovers:boolean?,body.downloadSubtitlesOptions:string?,body.shouldDownloadSlideshowImages:boolean?,body.videoKvStoreIdOrName:string?,maxResults:integer!", "existing_planner_route"),
  capability("monid.tiktok.apify.scraptik-tiktok-api", "apify", "/v1/social/tiktok/tools/apify-scraptik-tiktok-api", "per_call::0.007", "body:object!,body.profile_username:string?,body.profile_userId:string?,body.profile_secUserId:string?,body.profile_region:string?,body.usernameToId_username:string?,body.followers_userId:string?,body.followers_secUserId:string?,body.followers_count:integer?,body.followers_maxTime:integer?,body.following_userId:string?,body.following_secUserId:string?,body.following_count:integer?,body.following_maxTime:integer?,body.post_awemeId:string?,body.post_region:string?,body.userPosts_userId:string?,body.userPosts_secUserId:string?,body.userPosts_count:integer?,body.userPosts_region:string?,body.userPosts_maxCursor:string?,body.music_id:string?,body.musicPosts_musicId:string?,body.musicPosts_count:integer?,body.musicPosts_cursor:integer?,body.challengePosts_cid:string?,body.challengePosts_count:integer?,body.challengePosts_cursor:integer?,body.commentReplies_commentId:string?,body.commentReplies_awemeId:string?,body.commentReplies_count:integer?,body.commentReplies_cursor:integer?,body.listComments_awemeId:string?,body.listComments_count:integer?,body.listComments_cursor:integer?,body.userLikes_userId:string?,body.userLikes_count:integer?,body.userLikes_maxCursor:string?,body.searchUsers_keyword:string?,body.searchUsers_count:integer?,body.searchUsers_cursor:integer?,body.searchPosts_keyword:string?,body.searchPosts_count:integer?,body.searchPosts_offset:integer?,body.searchPosts_region:string?,body.searchPosts_publishTime:integer?,body.searchPosts_sortType:integer?,body.searchSounds_keyword:string?,body.searchSounds_count:integer?,body.searchSounds_cursor:integer?,body.searchSounds_region:string?,body.searchSounds_useFilters:boolean?,body.searchSounds_filterBy:integer?,body.searchSounds_sortType:integer?,body.searchHashtags_keyword:string?,body.searchHashtags_count:integer?,body.searchHashtags_region:string?,body.searchHashtags_cursor:integer?,body.searchLives_keyword:string?,body.searchLives_count:integer?,body.searchLives_offset:integer?,body.videoWithoutWatermark_awemeId:string?", "existing_planner_route"),
  capability("monid.tiktok.apify.scraptik-tiktok-comments-scraper-api", "apify", "/v1/social/tiktok/tools/apify-scraptik-tiktok-comments-scraper-api", "per_call::0.007", "body:object!,body.listComments_awemeId:string?,body.listComments_count:integer?,body.listComments_cursor:integer?,body.commentReplies_commentId:string?,body.commentReplies_awemeId:string?,body.commentReplies_count:integer?,body.commentReplies_cursor:integer?", "existing_planner_route"),
  capability("monid.tiktok.mrscraper.tiktok-catalog", "mrscraper", "/v1/social/tiktok/tools/mrscraper-tiktok-catalog", "per_call::0.075", "body:object!,body.url:string!", "catalogue_only"),
  capability("monid.tiktok.mrscraper.tiktok-hashtag", "mrscraper", "/v1/social/tiktok/tools/mrscraper-tiktok-hashtag", "per_call::0.023", "body:object!,body.tag:string!", "catalogue_only"),
  capability("monid.tiktok.mrscraper.tiktok-product", "mrscraper", "/v1/social/tiktok/tools/mrscraper-tiktok-product", "per_call::0.027", "body:object!,body.url:string!,body.render:boolean?", "catalogue_only"),
  capability("monid.tiktok.mrscraper.tiktok-video", "mrscraper", "/v1/social/tiktok/tools/mrscraper-tiktok-video", "per_call::0.023", "body:object!,body.url:string!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-ads-get-top-contents-list", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-ads-get-top-contents-list", "per_call::0.005", "body:object!,body.country_code:string?,body.period_dimension:integer?,body.period_end_timestamp:integer!,body.organic_only:boolean?,body.limit:integer?,body.page:integer?,body.content_label_ids:string?,body.order_by_metric:integer?,queryParams:object!", "existing_planner_route"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-ads-get-trends-hashtag-detail", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-ads-get-trends-hashtag-detail", "per_call::0.005", "body:object!,body.country_code:string?,body.hashtag_id:string!,body.time_range:integer?,queryParams:object!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-ads-get-trends-hashtag-list", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-ads-get-trends-hashtag-list", "per_call::0.005", "body:object!,body.country_code:string?,body.industry_id:integer?,body.time_range:integer?,body.limit:integer?,body.page:integer?,queryParams:object!", "existing_planner_route"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-ads-search-ads", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-ads-search-ads", "per_call::0.005", "body:object!,body.ad_format:unspecified?,body.period:integer?,body.like:unspecified?,body.industry:string?,body.objective:unspecified?,body.search_id:string?,body.duration:unspecified?,body.country_code:string?,body.limit:integer?,body.order_by:string?,body.page:integer?,body.ad_language:unspecified?,body.keyword:string?,body.pattern_label:unspecified?,queryParams:object!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-analytics-fetch-comment-keywords", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-analytics-fetch-comment-keywords", "per_call::0.005", "queryParams:object!,queryParams.item_id:string!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-analytics-fetch-creator-info-and-milestones", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-analytics-fetch-creator-info-and-milestones", "per_call::0.005", "queryParams:object!,queryParams.user_id:string!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-analytics-fetch-video-metrics", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-analytics-fetch-video-metrics", "per_call::0.005", "queryParams:object!,queryParams.item_id:string!", "existing_planner_route"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-app-v3-fetch-user-follower-list", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-app-v3-fetch-user-follower-list", "per_call::0.005", "queryParams:object!,queryParams.user_id:string?,queryParams.sec_user_id:string?,queryParams.count:integer?,queryParams.page_token:string?,queryParams.min_time:integer?", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-app-v3-open-tiktok-app-to-keyword-search", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-app-v3-open-tiktok-app-to-keyword-search", "per_call::0.005", "queryParams:object!,queryParams.keyword:string!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-creator-get-account-insights-overview", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-creator-get-account-insights-overview", "per_call::0.005", "body:object!,body.start_date:string?,queryParams:object!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-creator-get-creator-account-info", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-creator-get-creator-account-info", "per_call::0.005", "body:object!,queryParams:object!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-creator-get-product-related-videos", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-creator-get-product-related-videos", "per_call::0.005", "body:object!,body.item_id:string!,body.product_id:string!,body.start_date:string?,queryParams:object!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-creator-get-video-analytics-summary", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-creator-get-video-analytics-summary", "per_call::0.005", "body:object!,queryParams:object!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-creator-get-video-audience-stats", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-creator-get-video-audience-stats", "per_call::0.005", "body:object!,body.item_id:string!,body.start_date:string?,queryParams:object!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-creator-get-video-detailed-stats", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-creator-get-video-detailed-stats", "per_call::0.005", "body:object!,body.item_id:string!,body.start_date:string?,queryParams:object!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-creator-get-video-list-analytics", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-creator-get-video-list-analytics", "per_call::0.005", "body:object!,body.rules:string?,body.page:integer?,body.start_date:string?,queryParams:object!", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-shop-web-fetch-search-products-list-v2", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-shop-web-fetch-search-products-list-v2", "per_call::0.005", "queryParams:object!,queryParams.offset:integer?,queryParams.page_token:string?,queryParams.search_word:string!,queryParams.region:string?", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-web-fetch-explore-post", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-web-fetch-explore-post", "per_call::0.005", "queryParams:object!,queryParams.categoryType:string?,queryParams.count:integer?", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-web-fetch-search-live", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-web-fetch-search-live", "per_call::0.005", "queryParams:object!,queryParams.offset:integer?,queryParams.count:integer?,queryParams.keyword:string!,queryParams.search_id:string?", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-web-fetch-search-user", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-web-fetch-search-user", "per_call::0.005", "queryParams:object!,queryParams.cursor:integer?,queryParams.keyword:string!,queryParams.search_id:string?", "existing_planner_route"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-web-fetch-user-fans", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-web-fetch-user-fans", "per_call::0.005", "queryParams:object!,queryParams.secUid:string!,queryParams.maxCursor:integer?,queryParams.count:integer?,queryParams.minCursor:integer?", "catalogue_only"),
  capability("monid.tiktok.tikhub.api-v1-tiktok-web-fetch-user-follow", "tikhub", "/v1/social/tiktok/tools/tikhub-api-v1-tiktok-web-fetch-user-follow", "per_call::0.005", "queryParams:object!,queryParams.secUid:string!,queryParams.maxCursor:integer?,queryParams.count:integer?,queryParams.minCursor:integer?", "catalogue_only"),
] as const satisfies readonly AuditedCapability[];

export const AUDITED_UNAVAILABLE_CAPABILITIES = [
  capability("monid.instagram.apify.apify-instagram-hashtag-scraper", "apify", "/v1/social/instagram/tools/apify-apify-instagram-hashtag-scraper", "per_call::0.0068", "body:object!,body.hashtags:array!,body.keywordSearch:boolean?,body.resultsType:string?,body.resultsLimit:integer?", "catalogue_only", "unavailable"),
  capability("monid.instagram.apify.apify-instagram-post-scraper", "apify", "/v1/social/instagram/tools/apify-apify-instagram-post-scraper", "per_call::0.005", "body:object!,body.username:array!,body.resultsLimit:integer?,body.skipPinnedPosts:boolean?,body.onlyPostsNewerThan:string?,body.dataDetailLevel:string?", "catalogue_only", "unavailable"),
] as const satisfies readonly AuditedCapability[];

const availableById = new Map<string, AuditedCapability>(
  AUDITED_AVAILABLE_CAPABILITIES.map((entry) => [entry.id, entry]),
);

export function getAuditedCapability(id: string): AuditedCapability | undefined {
  return availableById.get(id);
}
