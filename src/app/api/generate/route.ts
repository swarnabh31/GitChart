import { NextRequest } from "next/server";
import { createGitHubClient } from "@/server/github";
import { buildRepoDigest } from "@/server/digest-flow";
import { resolveDigestBudget } from "@/server/digest";
import { createAIProvider } from "@/server/ai";
import { checkRateLimit } from "@/server/rate-limit";
import { generateDiagram, parsePipelineError } from "@/server/pipeline";
import { createRedisStore } from "@/server/storage/redis";
import {
  getAIProviderConfig,
  getDiagramTtlSeconds,
  getGitHubConfig,
  getRateLimitConfig,
} from "@/server/storage/config";
import { parseRepoUrl } from "@/server/github-url";
import { clientIp, errorResponse, requestIdFromHeaders } from "@/server/http";
import { analyticsEmitter, repoProperties } from "@/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  repo_url?: string;
  github_token?: string;
  model?: string;
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

class SseController {
  private enq!: (chunk: Uint8Array) => void;
  private closed = false;
  bind(fn: (chunk: Uint8Array) => void) {
    this.enq = fn;
  }
  push(chunk: Uint8Array) {
    if (!this.closed) this.enq(chunk);
  }
  close() {
    this.closed = true;
  }
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return errorResponse("INVALID_JSON", "Request body must be JSON.", 400);
  }
  const url = typeof body.repo_url === "string" ? body.repo_url.trim() : "";
  if (!url) return errorResponse("INVALID_REPO_URL", "repo_url is required.", 422);

  let owner: string, repo: string;
  try {
    ({ owner, repo } = parseRepoUrl(url));
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return errorResponse(e?.code ?? "INVALID_REPO_URL", e?.message ?? "Invalid repository URL.", 422);
  }

  const requestId = requestIdFromHeaders(req.headers);
  const ip = clientIp(req.headers);
  const userToken = typeof body.github_token === "string" ? body.github_token.trim() : undefined;
  const requestedModel = typeof body.model === "string" ? body.model.trim() : undefined;
  const aiConfig = getAIProviderConfig();
  const model = requestedModel || aiConfig.model;
  const rateConfig = getRateLimitConfig();
  const ttl = getDiagramTtlSeconds();

  const redis = createRedisStore();

  // Pre-stream rate limit check: reject with 429 before any work.
  const rate = await checkRateLimit(redis, ip, rateConfig);
  if (!rate.allowed) {
    return errorResponse("RATE_LIMITED", "Too many generation requests. Try again later.", 429);
  }

  const githubConfig = getGitHubConfig();

  const emitAnalytics = analyticsEmitter(ip);
  emitAnalytics({
    event: "generation_started",
    ...repoProperties(owner, repo),
    request_id: requestId,
  });

  const ctl = new SseController();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctl.bind((chunk) => controller.enqueue(chunk));
      void (async () => {
        let client: ReturnType<typeof createGitHubClient> | null = null;
        try {
          ctl.push(sse("phase", { label: "Resolving repository", detail: "Fetching repo metadata from GitHub" }));
          client = createGitHubClient({ userToken, config: githubConfig });
          const meta = await client.getRepoMetadata(owner, repo);
          if (req.signal.aborted) throw new Error("aborted");

          ctl.push(sse("phase", { label: `Reading ${meta.owner}/${meta.repo}`, detail: `Fetching file tree from branch "${meta.default_branch}"` }));
          const tree = await client.getTree(owner, repo, meta.default_branch);
          if (req.signal.aborted) throw new Error("aborted");

          ctl.push(sse("phase", { label: "Assembling repo digest", detail: "Selecting key files and excerpts for the model" }));
          const digest = await buildRepoDigest(client, meta, tree, resolveDigestBudget(model));
          if (req.signal.aborted) throw new Error("aborted");

          const provider = createAIProvider();
          await generateDiagram({
            provider,
            explanationModel: model,
            diagramModel: model,
            meta,
            digest,
            checkRateLimit: async () => ({ allowed: true, remaining: 0, resetsInSeconds: 0 }),
            redis,
            ttlSeconds: ttl,
            signal: req.signal,
            onEvent: (event) => {
              if (event.type === "explanation_chunk") {
                ctl.push(sse("explanation_chunk", { delta: event.delta }));
              } else if (event.type === "architecture_brief") {
                ctl.push(sse("architecture_brief", event.payload));
              } else if (event.type === "diagram_ready") {
                ctl.push(sse("diagram_ready", event.payload));
                emitAnalytics({
                  event: "generation_completed",
                  ...repoProperties(owner, repo),
                  cached: event.payload.cached,
                  request_id: requestId,
                });
              } else if (event.type === "error") {
                ctl.push(sse("error", { code: event.code, message: event.message }));
              } else if (event.type === "phase") {
                ctl.push(sse("phase", { label: event.label, detail: event.detail }));
              }
            },
          });
        } catch (err) {
          const e = err as { code?: string; message?: string };
          if (e?.code) {
            ctl.push(sse("error", { code: e.code, message: e.message ?? "Could not read repository contents." }));
          } else {
            const mapped = parsePipelineError(err);
            ctl.push(sse("error", { code: mapped.code, message: mapped.message }));
          }
        } finally {
          client?.close();
          ctl.close();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      })();
    },
    cancel() {
      ctl.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-request-id": requestId,
    },
  });
}
