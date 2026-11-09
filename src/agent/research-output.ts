const RESEARCH_FIELDS = new Set([
  "id", "userid", "username", "uniqueid", "handle", "title", "desc", "description", "text", "caption",
  "hashtag", "hashtags", "awemeid", "playcount", "viewcount", "views", "likecount", "likes",
  "commentcount", "comments", "sharecount", "followers", "followercount", "followingcount",
  "items", "results", "list", "data", "videos", "posts", "reels", "contents", "users", "profile",
]);

function containsProviderError(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsProviderError);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    const name = key.toLowerCase();
    if (name === "error" && child != null && child !== false && child !== "") return true;
    if (name === "success" && child === false) return true;
    if (name === "status" && typeof child === "string" && /^(error|failed)$/i.test(child)) return true;
    return containsProviderError(child);
  });
}

function hasResearchField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasResearchField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (RESEARCH_FIELDS.has(normalized)) {
      if (Array.isArray(child) || (child !== null && typeof child === "object")) return hasResearchField(child);
      return typeof child === "string"
        ? child.trim().length > 0
        : typeof child === "number" || typeof child === "boolean";
    }
    return hasResearchField(child);
  });
}

/** Rejects successful-looking but empty/error Buy responses as report evidence. */
export function isUsableResearchOutput(value: unknown): boolean {
  return !!value && typeof value === "object" && !containsProviderError(value) && hasResearchField(value);
}
