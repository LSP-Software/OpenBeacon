export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  resetAfterMs: number;
  granted?: number;
  unavailable?: true;
};

export type WhenRedisUnavailable = { whenUnavailable: "allow" | "deny" };
