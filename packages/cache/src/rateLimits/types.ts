export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  resetAfterMs: number;
  unavailable?: true;
};

export type WhenRedisUnavailable = { whenUnavailable: "allow" | "deny" };
