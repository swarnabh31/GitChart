import { Redis } from "@upstash/redis";
import { getRedisConfig, assertLiveStorageAllowedForTests, readEnv } from "./config";

const PLACEHOLDER_HOSTS = new Set([
  "placeholder.upstash.io",
  "placeholder",
]);

export function isRedisConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = readEnv("UPSTASH_REDIS_REST_URL", env) ?? "";
  const token = readEnv("UPSTASH_REDIS_REST_TOKEN", env) ?? "";
  if (!token) return false;
  const hostname = url.replace(/^[a-z]+:\/\//i, "").split("/")[0];
  return !PLACEHOLDER_HOSTS.has(hostname);
}

export interface RedisStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSeconds?: number): Promise<number>;
  withClient<T>(fn: (client: Redis) => Promise<T>): Promise<T>;
}

function buildClient(): Redis {
  const config = getRedisConfig();
  return new Redis({ url: config.url, token: config.token });
}

interface MemoryEntry {
  value: unknown;
  expiresAt: number | null;
}

function createMemoryStore(): RedisStore {
  const entries = new Map<string, MemoryEntry>();

  function read(key: string): unknown | null {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return null;
    }
    return entry.value;
  }

  return {
    async get<T>(key: string) {
      return (read(key) as T | null) ?? null;
    },
    async set(key, value, ttlSeconds) {
      const expiresAt =
        typeof ttlSeconds === "number" && ttlSeconds > 0
          ? Date.now() + ttlSeconds * 1000
          : null;
      entries.set(key, { value, expiresAt });
    },
    async del(key) {
      entries.delete(key);
    },
    async incr(key, ttlSeconds) {
      const current = read(key);
      const next = (typeof current === "number" ? current : 0) + 1;
      const entry = entries.get(key);
      const expiresAt =
        typeof ttlSeconds === "number" && ttlSeconds > 0
          ? entry?.expiresAt ?? Date.now() + ttlSeconds * 1000
          : entry?.expiresAt ?? null;
      entries.set(key, { value: next, expiresAt });
      return next;
    },
    async withClient<T>(_fn: (client: Redis) => Promise<T>) {
      throw new Error("withClient is only supported with a live Redis connection.");
    },
  };
}

const memoryCache: RedisStore = createMemoryStore();

export function createRedisStore(): RedisStore {
  if (!isRedisConfigured()) {
    console.warn("[redis] not configured (placeholder or missing credentials) — using in-memory store (no persistence, no cross-instance rate limiting)");
    return memoryCache;
  }
  assertLiveStorageAllowedForTests("redis");
  const client = buildClient();
  return {
    async get<T>(key: string) {
      const value = await client.get<T>(key);
      return value ?? null;
    },
    async set(key, value, ttlSeconds) {
      if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
        await client.set(key, value, { ex: ttlSeconds });
      } else {
        await client.set(key, value);
      }
    },
    async del(key) {
      await client.del(key);
    },
    async incr(key, ttlSeconds) {
      const value = await client.incr(key);
      if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
        await client.expire(key, ttlSeconds);
      }
      return value;
    },
    async withClient<T>(fn: (client: Redis) => Promise<T>) {
      return fn(client);
    },
  };
}

export function diagramKey(id: string): string {
  return `diagram:${id}`;
}

export function rateLimitKey(ip: string): string {
  return `rl:${ip}`;
}
