import type { AIProvider } from "./ai/provider";
import type { RepoMetadata } from "./github";
import type { RepoDigest } from "./digest";
import { ArchitectureBriefSchema, type ArchitectureBrief } from "./diagram-schema";
import { validateBrief } from "./brief-validator";
import { PipelineStageError } from "./error-codes";
import { extractFirstJsonObject, formatZodIssues } from "./json-extract";
import { explainSystemPrompt, explainUserPrompt, repairPrompt } from "./prompts";

export interface ExplainStreamCallbacks {
  onDebugChunk?(delta: string): void;
  onDone(brief: ArchitectureBrief): void;
  onError(err: Error): void;
}

export interface ExplainPassParams {
  provider: AIProvider;
  explanationModel: string;
  meta: RepoMetadata;
  digest: RepoDigest;
  validPaths: Set<string>;
  signal?: AbortSignal;
  cb: ExplainStreamCallbacks;
}

interface AttemptResult {
  brief?: ArchitectureBrief;
  issues: string[];
  raw: string;
}

/**
 * Resolve each component's path against the real repo tree.
 * - Exact match → keep.
 * - Suffix2 (last 2 segments) match, unambiguous → use that real path.
 * - Suffix1 (basename) match, unambiguous → use that real path.
 * - No unambiguous match → null (treat as external), never hard-fail.
 */
function resolveBriefPaths(brief: ArchitectureBrief, validPaths: Set<string>): ArchitectureBrief {
  if (validPaths.size === 0) return brief;
  const components = brief.components.map((c) => {
    if (c.path === null) return c;
    if (validPaths.has(c.path)) return c;
    const parts = c.path.split("/");
    const suffix1 = parts[parts.length - 1];
    const suffix2 = parts.length >= 2 ? parts.slice(-2).join("/") : parts[0];
    const c2 = [...validPaths].filter((p) => p.endsWith("/" + suffix2) || p === suffix2);
    if (c2.length === 1) return { ...c, path: c2[0] };
    const c1 = [...validPaths].filter((p) => p.endsWith("/" + suffix1) || p === suffix1);
    if (c1.length === 1) return { ...c, path: c1[0] };
    return { ...c, path: null };
  });
  return { ...brief, components };
}

async function attempt(params: ExplainPassParams, repair?: string): Promise<AttemptResult> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: explainSystemPrompt() },
    { role: "user", content: explainUserPrompt(params.digest) },
  ];
  if (repair) {
    messages.push({ role: "user", content: repair });
  }

  let raw = "";
  for await (const delta of params.provider.streamCompletion({
    model: params.explanationModel,
    messages,
    temperature: 0.3,
    signal: params.signal,
  })) {
    raw += delta;
    params.cb.onDebugChunk?.(delta);
  }

  if (raw.trim().length === 0) {
    return { issues: ["Model returned an empty response (provider may be throttled). Retry."], raw };
  }

  const jsonText = extractFirstJsonObject(raw);
  if (!jsonText) return { issues: ["No JSON object found in model output"], raw };

  let candidate: unknown;
  try {
    candidate = JSON.parse(jsonText);
  } catch (err) {
    return {
      issues: [`JSON parse failed: ${err instanceof Error ? err.message : "invalid JSON"}`.slice(0, 160)],
      raw,
    };
  }

  const parsed = ArchitectureBriefSchema.safeParse(candidate);
  if (!parsed.success) {
    return { issues: formatZodIssues(parsed.error).map((m) => `Schema: ${m}`), raw };
  }

  let brief: ArchitectureBrief = parsed.data;
  // Resolve slightly-off hallucinated paths to the closest real path, or null
  // them (→ external/hexagon fallback) instead of hard-failing the whole pass.
  brief = resolveBriefPaths(brief, params.validPaths);

  const validation = validateBrief(brief);
  if (!validation.ok) return { issues: validation.issues.map((i) => `Brief: ${i}`), raw };

  return { brief, issues: [], raw };
}

export async function runExplainPass(params: ExplainPassParams): Promise<ArchitectureBrief> {
  const first = await attempt(params);
  if (first.brief) {
    params.cb.onDone(first.brief);
    return first.brief;
  }

  const pathHints = params.validPaths.size > 0 ? [...params.validPaths].slice(0, 30) : undefined;
  const repairMessage = repairPrompt(
    first.issues.length > 0 ? first.issues : ["Output was not accepted."],
    pathHints
  );
  const second = await attempt(params, repairMessage);
  if (second.brief) {
    params.cb.onDone(second.brief);
    return second.brief;
  }

  const issues = second.issues.length > 0 ? [...first.issues, ...second.issues] : first.issues;
  params.cb.onError(new PipelineStageError("EXP_INVALID", issues, second.raw.slice(0, 2000)));
  throw new PipelineStageError("EXP_INVALID", issues, second.raw.slice(0, 2000));
}
