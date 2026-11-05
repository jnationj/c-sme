/** Sliding-window rate limiter, in memory. Enough to stop one visitor from draining an LLM or test-fund budget. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(readonly limit: number, readonly windowMs: number) {}

  /** Records a hit and returns true if it is within the limit. */
  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.sweep(now); // bound memory
    return true;
  }

  private sweep(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [k, v] of this.hits) if (!v.some((t) => t > cutoff)) this.hits.delete(k);
  }
}

/**
 * The caller's address behind a proxy. We take the LAST X-Forwarded-For entry: that is the one our own proxy appended,
 * while earlier entries can be forged by the visitor to dodge the limit. Falls back to X-Real-IP, then a shared bucket.
 */
export function clientIp(h: (name: string) => string | undefined): string {
  const parts = h("x-forwarded-for")?.split(",").map((x) => x.trim()).filter(Boolean);
  const xff = parts?.[parts.length - 1];
  return xff || h("x-real-ip")?.trim() || "unknown";
}
