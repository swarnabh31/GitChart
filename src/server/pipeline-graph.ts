import type { AIProvider } from "./ai/provider";
import { diagramGraphSchema, type ArchitectureBrief, type DiagramGraph } from "./diagram-schema";
import { PipelineStageError } from "./error-codes";
import { extractFirstJsonObject, formatZodIssues } from "./json-extract";
import {
  onlyUnknownPathIssues,
  stripUnknownPaths,
  validateDiagramGraph,
} from "./graph-validator";
import { graphSystemPrompt, graphUserPrompt, repairPrompt } from "./prompts";

export interface GraphPassParams {
  provider: AIProvider;
  diagramModel: string;
  brief: ArchitectureBrief;
  validPaths: Set<string>;
  signal?: AbortSignal;
  onAttempt?: (attempt: number, issues: string[]) => void;
}

const MAX_ATTEMPTS = 3;

interface ParseOutcome {
  graph?: DiagramGraph;
  issues: string[];
  raw: string;
}

function evaluate(graph: DiagramGraph, validPaths: Set<string>): string[] {
  return validateDiagramGraph(graph, validPaths).issues;
}

function parseRaw(raw: string): ParseOutcome {
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

  const parsed = diagramGraphSchema.safeParse(candidate);
  if (!parsed.success) {
    return { issues: formatZodIssues(parsed.error), raw };
  }
  return { graph: parsed.data, issues: [], raw };
}

async function runAttempt(params: GraphPassParams, repair?: string): Promise<ParseOutcome> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: graphSystemPrompt() },
    { role: "user", content: graphUserPrompt(params.brief) },
  ];
  if (repair) messages.push({ role: "user", content: repair });

  const raw = await params.provider.complete({
    model: params.diagramModel,
    messages,
    temperature: 0.2,
    signal: params.signal,
  });

  return parseRaw(raw);
}

export async function runGraphPass(params: GraphPassParams): Promise<DiagramGraph> {
  let lastIssues: string[] = [];
  let lastRaw = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const repair =
      attempt === 1
        ? undefined
        : repairPrompt(
            lastIssues.length > 0
              ? lastIssues
              : ["The previous graph was not accepted. Re-emit the full JSON object."]
          );

    const outcome = await runAttempt(params, repair);
    lastRaw = outcome.raw;

    if (!outcome.graph) {
      lastIssues = outcome.issues;
      params.onAttempt?.(attempt, lastIssues);
      continue;
    }

    const issues = evaluate(outcome.graph, params.validPaths);
    params.onAttempt?.(attempt, issues);

    if (issues.length === 0) {
      return outcome.graph;
    }

    if (
      params.validPaths.size > 0 &&
      issues.length > 0 &&
      onlyUnknownPathIssues(outcome.graph, params.validPaths)
    ) {
      const { graph: fixed, strippedPaths } = stripUnknownPaths(outcome.graph, params.validPaths);
      const revalidated = evaluate(fixed, params.validPaths);
      if (revalidated.length === 0) {
        params.onAttempt?.(attempt, [
          `Stripped ${strippedPaths.length} unknown path(s) without re-prompting`,
        ]);
        return fixed;
      }
      lastIssues = revalidated;
      continue;
    }

    lastIssues = issues;
  }

  throw new PipelineStageError("GRAPH_INVALID", lastIssues, lastRaw.slice(0, 4000));
}
