import type { RedisStore } from "./storage/redis";
import { rateLimitKey } from "./storage/redis";
import type { RateLimitConfig } from "./storage/config";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetsInSeconds: number;
}

export function checkRateLimit(
  store: RedisStore,
  ip: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const key = rateLimitKey(ip);
  return store.incr(key, config.windowSeconds).then((count) => {
    const remaining = Math.max(0, config.max - count);
    const allowed = count <= config.max;
    return {
      allowed,
      remaining,
      resetsInSeconds: allowed ? 0 : config.windowSeconds,
    };
  });
}
