export class ConfigError extends Error {
  constructor(varName: string) {
    super(`Missing required environment variable: ${varName}`);
    this.name = "ConfigError";
  }
}

export class TestSafetyError extends Error {
  constructor(service: string) {
    super(
      `Refusing to use live ${service} storage in tests. Set ALLOW_LIVE_STORAGE_IN_TESTS=1 to override.`
    );
    this.name = "TestSafetyError";
  }
}

function isTestEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV === "test" ||
    !!env.VITEST ||
    !!env.CI_TEST_MODE
  );
}

export function readEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readRequiredEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const value = readEnv(name, env);
  if (value === undefined) {
    throw new ConfigError(name);
  }
  return value;
}

export function assertLiveStorageAllowedForTests(
  service: "r2" | "redis" | "posthog",
  env: NodeJS.ProcessEnv = process.env
): void {
  if (isTestEnvironment(env) && readEnv("ALLOW_LIVE_STORAGE_IN_TESTS", env) !== "1") {
    throw new TestSafetyError(service);
  }
}

export interface GitHubConfig {
  defaultPat: string | undefined;
  patPool: string[];
  appId: string | undefined;
  clientId: string | undefined;
}

export function getGitHubConfig(env: NodeJS.ProcessEnv = process.env): GitHubConfig {
  const defaultPat = readEnv("GITHUB_PAT", env);
  const rawPool = readEnv("GITHUB_PATS", env);
  const patPool = rawPool
    ? rawPool.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    : [];
  if (defaultPat && !patPool.includes(defaultPat)) {
    patPool.push(defaultPat);
  }
  return {
    defaultPat,
    patPool,
    appId: readEnv("GITHUB_APP_ID", env),
    clientId: readEnv("GITHUB_CLIENT_ID", env),
  };
}

export interface AIProviderConfig {
  provider: "openai" | "openrouter" | "ollama";
  model: string;
  explanationModel: string;
  diagramModel: string;
  apiKey: string;
  baseUrl: string | undefined;
}

export function getOllamaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base = (readEnv("OLLAMA_BASE_URL", env) ?? "http://localhost:11434").replace(/\/$/, "");
  return base;
}

export function getAIProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): AIProviderConfig {
  const provider = (readEnv("AI_PROVIDER", env) ?? "openai").toLowerCase();
  if (provider !== "openai" && provider !== "openrouter" && provider !== "ollama") {
    throw new ConfigError("AI_PROVIDER (must be 'openai', 'openrouter', or 'ollama')");
  }
  let baseModel: string;
  let apiKey: string;
  let baseUrl: string | undefined;
  if (provider === "openai") {
    baseModel = readRequiredEnv("OPENAI_MODEL", env);
    apiKey = readRequiredEnv("OPENAI_API_KEY", env);
  } else if (provider === "ollama") {
    baseModel = readEnv("OLLAMA_MODEL", env) ?? "qwen3.8:27b";
    apiKey = "ollama";
    baseUrl = `${getOllamaBaseUrl(env)}/v1`;
  } else {
    baseModel = readRequiredEnv("OPENROUTER_MODEL", env);
    apiKey = readRequiredEnv("OPENROUTER_API_KEY", env);
    baseUrl = "https://openrouter.ai/api/v1";
  }
  return {
    provider,
    model: baseModel,
    explanationModel: readEnv("AI_EXPLANATION_MODEL", env) ?? baseModel,
    diagramModel: readEnv("AI_DIAGRAM_MODEL", env) ?? baseModel,
    apiKey,
    baseUrl,
  };
}

export interface RateLimitConfig {
  max: number;
  windowSeconds: number;
}

export const DEFAULT_DIAGRAM_TTL_SECONDS = 60 * 60 * 24;

export function getDiagramTtlSeconds(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = readEnv("DIAGRAM_CACHE_TTL_SECONDS", env);
  if (raw === undefined) return DEFAULT_DIAGRAM_TTL_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new ConfigError("DIAGRAM_CACHE_TTL_SECONDS (must be a non-negative number)");
  }
  return Math.floor(n);
}

export function getRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env
): RateLimitConfig {
  const max = Number(readEnv("GENERATION_RATE_LIMIT_MAX", env) ?? "10");
  const windowSeconds = Number(
    readEnv("GENERATION_RATE_LIMIT_WINDOW_SECONDS", env) ?? "3600"
  );
  if (!Number.isFinite(max) || max <= 0) {
    throw new ConfigError("GENERATION_RATE_LIMIT_MAX (must be a positive number)");
  }
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new ConfigError("GENERATION_RATE_LIMIT_WINDOW_SECONDS (must be a positive number)");
  }
  return { max, windowSeconds };
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBucket: string;
  privateBucket: string;
  publicBaseUrl: string;
  endpoint: string;
}

export function getR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
  return {
    accountId: readRequiredEnv("R2_ACCOUNT_ID", env),
    accessKeyId: readRequiredEnv("R2_ACCESS_KEY_ID", env),
    secretAccessKey: readRequiredEnv("R2_SECRET_ACCESS_KEY", env),
    publicBucket: readRequiredEnv("R2_PUBLIC_BUCKET", env),
    privateBucket: readRequiredEnv("R2_PRIVATE_BUCKET", env),
    publicBaseUrl:
      readEnv("R2_PUBLIC_BASE_URL", env) ??
      `https://${readRequiredEnv("R2_PUBLIC_BUCKET", env)}.r2.cloudflarestorage.com`,
    endpoint: `https://${readRequiredEnv("R2_ACCOUNT_ID", env)}.r2.cloudflarestorage.com`,
  };
}

export interface RedisConfig {
  url: string;
  token: string;
}

export function getRedisConfig(
  env: NodeJS.ProcessEnv = process.env
): RedisConfig {
  return {
    url: readRequiredEnv("UPSTASH_REDIS_REST_URL", env),
    token: readRequiredEnv("UPSTASH_REDIS_REST_TOKEN", env),
  };
}

export interface PostHogConfig {
  personalApiKey: string | undefined;
  projectId: string | undefined;
  host: string;
  publicKey: string | undefined;
}

export function getPostHogConfig(
  env: NodeJS.ProcessEnv = process.env
): PostHogConfig {
  return {
    personalApiKey: readEnv("POSTHOG_PERSONAL_API_KEY", env),
    projectId: readEnv("POSTHOG_PROJECT_ID", env),
    host: readEnv("POSTHOG_HOST", env) ?? "https://us.posthog.com",
    publicKey: readEnv("NEXT_PUBLIC_POSTHOG_KEY", env),
  };
}

export function assertCoreConfig(env: NodeJS.ProcessEnv = process.env): void {
  getAIProviderConfig(env);
  getR2Config(env);
  getRedisConfig(env);
  getRateLimitConfig(env);
}
