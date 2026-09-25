import { createHash } from "node:crypto";
import type { AIProvider } from "./ai/provider";
import type { RepoMetadata } from "./github";
import type { RepoDigest } from "./digest";
import { validateMermaid } from "./mermaid-validate";
import type { RateLimitResult } from "./rate-limit";
import type { ArchitectureBrief, DiagramGraph } from "./diagram-schema";
import { graphToMermaid } from "./emitter";
import { runExplainPass } from "./pipeline-explain";
import { runGraphPass } from "./pipeline-graph";
import { PipelineError } from "./error-codes";
import type { PipelineDeps, ServerEvent, DiagramComponent, DiagramResult } from "./pipeline-types";
import { PipelineStageError, STAGE_MESSAGES } from "./error-codes";

export function diagramId(owner: string, repo: string, branch: string, fingerprint: string): string {
  const hash = createHash("sha1")
    .update(`${owner}:${repo}:${branch}:${fingerprint}`)
    .digest("hex")
    .slice(0, 16);
  return `diag_${hash}`;
}

export function digestFingerprint(digest: RepoDigest): string {
  return createHash("sha1")
    .update(`${digest.totalBytes}:${digest.fileCount}:${digest.tree.length}`)
    .digest("hex")
    .slice(0, 12);
}

export function buildValidPaths(digest: RepoDigest): Set<string> {
  const validPaths = new Set<string>(digest.files.map((f) => f.path));
  for (const line of digest.tree.split("\n")) {
    const t = line.trim();
    if (t.startsWith("f ")) validPaths.add(t.slice(2));
  }
  return validPaths;
}

function explanationFromBrief(brief: ArchitectureBrief): string {
  const lines: string[] = [brief.purpose.trim()];
  for (const c of brief.components) {
    const path = c.path !== null ? `(file: ${c.path})` : "(external)";
    lines.push(`- **${c.name}** ${path} — ${c.responsibility}`);
  }
  if (brief.coverage_limits.length > 0) {
    lines.push("", "Coverage limits:");
    lines.push(...brief.coverage_limits.map((c) => `- ${c}`));
  }
  return lines.join("\n");
}

function componentsFromGraph(graph: DiagramGraph): DiagramComponent[] {
  return graph.nodes
    .filter((n) => n.path !== null)
    .map((n) => ({
      id: n.id,
      label: n.label,
      file_path: n.path as string,
      summary: n.description || "",
    }));
}

function emit(deps: PipelineDeps, event: ServerEvent): void {
  deps.onEvent?.(event);
}

function chunkText(text: string): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    let size = 120;
    const window = text.slice(i, i + 180);
    const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"));
    if (sentenceEnd > 0) size = sentenceEnd + 1;
    parts.push(text.slice(i, i + size));
    i += size;
  }
  return parts;
}

function normalizeError(err: unknown, providerName: string): Error {
  if (err instanceof PipelineError || err instanceof PipelineStageError) return err;
  const name = (err as Error)?.name;
  if (name === "AbortError" || err instanceof DOMException && err.name === "AbortError") {
    return new PipelineError("AI_ABORTED", "Generation request was interrupted.", 502);
  }
  const code = (err as { code?: string })?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (code === "AI_AUTH") return new PipelineError("AI_AUTH", `${providerName}: invalid credentials.`, 502);
  if (code === "AI_RATE_LIMITED") return new PipelineError("AI_RATE_LIMITED", `${providerName}: rate limited.`, 503);
  if (code === "AI_ABORTED") return new PipelineError("AI_ABORTED", "Generation request was interrupted.", 502);
  return new PipelineError("AI_ERROR", `${providerName} error: ${message.slice(0, 300)}`, 502);
}

export function parsePipelineError(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof PipelineError) {
    return { code: err.code, message: err.message, status: err.status };
  }
  if (err instanceof PipelineStageError) {
    return { code: err.code, message: err.message, status: err.status };
  }
  if (err instanceof Error && "code" in err && typeof (err as { code: unknown }).code === "string") {
    const code = (err as { code: string }).code;
    const statusMap: Record<string, number> = {
      INVALID_REPO_URL: 422,
      REPO_NOT_FOUND: 404,
      TOKEN_INVALID_OR_REPO_PRIVATE: 403,
      GITHUB_RATE_LIMITED: 503,
      ConfigError: 500,
      REPO_ARCHIVE_PENDING: 503,
    };
    return { code, message: err.message, status: statusMap[code] ?? 502 };
  }
  return {
    code: "INTERNAL",
    message: "Something went wrong generating this diagram.",
    status: 500,
  };
}

export async function generateDiagram(deps: PipelineDeps): Promise<DiagramResult> {
  const { meta, digest } = deps;

  const rate = await deps.checkRateLimit();
  if (!rate.allowed) {
    throw new PipelineError("RATE_LIMITED", "Too many generation requests. Try again later.", 429);
  }

  const fingerprint = digestFingerprint(digest);
  const id = diagramId(meta.owner, meta.repo, meta.default_branch, fingerprint);
  const lookupKey = `diagram:lookup:${meta.owner}:${meta.repo}:${meta.default_branch}`;

  const existingId = await deps.redis.get<string>(lookupKey);
  if (existingId) {
    const cached = await deps.redis.get<DiagramResult>(`diagram:${existingId}`);
    if (cached) {
      for (const delta of chunkText(cached.explanation)) {
        emit(deps, { type: "explanation_chunk", delta });
      }
      const result = { ...cached, cached: true };
      emit(deps, { type: "diagram_ready", payload: result });
      return result;
    }
  }

  const validPaths = buildValidPaths(digest);

  emit(deps, {
    type: "phase",
    label: "Model is drafting the architecture brief",
    detail: "Pass 1 of 2 — streaming the architecture summary",
  });

  let brief: ArchitectureBrief;
  try {
    brief = await runExplainPass({
      provider: deps.provider,
      explanationModel: deps.explanationModel,
      meta,
      digest,
      validPaths,
      signal: deps.signal,
      cb: {
        onDone: (b) => {
          emit(deps, { type: "architecture_brief", payload: b });
          for (const delta of chunkText(explanationFromBrief(b))) {
            emit(deps, { type: "explanation_chunk", delta });
          }
        },
        onError: () => {},
      },
    });
  } catch (err) {
    throw normalizeError(err, deps.provider.name);
  }

  emit(deps, {
    type: "phase",
    label: "Laying out the diagram",
    detail: "Pass 2 of 2 — converting the brief into a structured diagram",
  });

  let graph: DiagramGraph;
  try {
    graph = await runGraphPass({
      provider: deps.provider,
      diagramModel: deps.diagramModel,
      brief,
      validPaths,
      signal: deps.signal,
    });
  } catch (err) {
    throw normalizeError(err, deps.provider.name);
  }

  const rawMermaid = graphToMermaid(graph);
  const mermaidCheck = validateMermaid(rawMermaid);
  if (!mermaidCheck.ok) {
    throw new PipelineError(
      "INTERNAL",
      `Emitted Mermaid failed sanity check: ${mermaidCheck.errors.join("; ")}`,
      502
    );
  }

  const components = componentsFromGraph(graph);
  const mermaid_source = rawMermaid;

  // Explanation is the brief rendered as prose (the prose that was streamed in
  // pass 1 is the raw JSON; for the UI we show a structured walkthrough).
  let explanation = "";
  try {
    explanation = explanationFromBrief(brief);
  } catch {
    explanation = "";
  }
  if (!explanation) explanation = components.map((c) => `${c.id} ${c.summary} (${c.file_path})`).join("\n");

  const result: DiagramResult = {
    id,
    owner: meta.owner,
    repo: meta.repo,
    default_branch: meta.default_branch,
    mermaid_source,
    components,
    explanation,
    provider: deps.provider.name,
    created_at: new Date().toISOString(),
    cached: false,
  };

  await deps.redis.set(`diagram:${id}`, result, deps.ttlSeconds);
  await deps.redis.set(lookupKey, id, deps.ttlSeconds);
  await deps.redis.set(`diagram:latest:${meta.owner}:${meta.repo}`, id, deps.ttlSeconds);

  emit(deps, { type: "diagram_ready", payload: result });
  return result;
}
