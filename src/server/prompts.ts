import type { RepoDigest } from "./digest";
import { extractArchitectureSignals, formatSignals } from "./architecture-signals";
import { architectureBriefJsonSchema, diagramGraphJsonSchema, type ArchitectureBrief } from "./diagram-schema";

const DOCTRINE = [
  "Ownership of the edge: the code that invokes a dependency owns the arrow. Importing two modules together does not mean they call each other.",
  "Do not reverse a call; do not skip an identified intermediary; do not turn alternatives into a serial pipeline; use dashed edges for optional relationships.",
].join(" ");

const EXPLAIN_RULES = [
  "Emit a single JSON object that matches this schema:",
  "```json",
  JSON.stringify(architectureBriefJsonSchema(), null, 2),
  "```",
  "Rules:",
  "- Every component cites one exact primary path from the file tree; external actors have `path: null`.",
  "- Paths must be copied verbatim from the digest. Never invent a path.",
  "Preserve major documented product capabilities alongside the principal workflow, even when their implementation was not sampled. If the README names a capability you cannot find in the excerpts, include it as a component with `path: null` and `shape: 'hexagon'` and add a short `coverage_limits` entry.",
  "A substantial application usually has 14\u201326 meaningful components. This is guidance, not a quota \u2014 do not pad the graph.",
  DOCTRINE,
  "Relationship verbs must name the data flow (reads, writes, calls, emits, resolves).",
  "Do not include a `mermaid` field. Do not output prose before or after the JSON.",
].join("\n");

export function explainSystemPrompt(): string {
  return [
    "You are a senior software architect. You receive a digest of a GitHub repository (metadata, file tree, key file excerpts, and extracted architecture signals such as routes, exports, and imports between files).",
    "Your task is to describe the RUNTIME REQUEST LIFECYCLE of this system \u2014 not the folder structure \u2014 as a structured architecture brief in JSON.",
    EXPLAIN_RULES,
  ].join("\n\n");
}

export function explainUserPrompt(digest: RepoDigest): string {
  const meta = digest.metadata;
  return [
    `Repository: ${meta.owner}/${meta.repo} (branch: ${meta.default_branch}, language: ${meta.language ?? "unknown"}, stars: ${meta.stargazers_count}, forks: ${meta.forks_count})`,
    meta.description ? `Description: ${meta.description}` : "",
    `File tree:\n${digest.tree}`,
    `Key files (${digest.files.length}):`,
    ...digest.files.map(
      (f) => `FILE ${f.path}${f.truncated ? " (truncated excerpt)" : ""}:\n${f.excerpt}`
    ),
    `Architecture signals (routes / exports / imports extracted from the excerpts above):\n${formatSignals(extractArchitectureSignals(digest)) || "(none)"}`,
    "Produce the JSON object as instructed.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const GRAPH_RULES = [
  "Emit a single JSON object that matches this schema:",
  "```json",
  JSON.stringify(diagramGraphJsonSchema(), null, 2),
  "```",
  "Rules:",
  "Use the brief's components and relationships as the source of truth. Node ids must match the brief's component ids where a component is drawn; keep the brief's shape on each node.",
  "Group nodes by RUNTIME RESPONSIBILITY (2-5 groups), never by directory. Every non-external node belongs to a group; each group has at least one node.",
  "Use `database` shape for data stores (Postgres/Redis/S3/files on disk). Use `queue` for message brokers. Use `circle` for humans/UI and external services. Use `hexagon` for capabilities that were documented but not sampled.",
  'Edges: solid for required synchronous flow, dashed for optional or asynchronous. Use kind "read"/"write" for data stores, "async" where the brief says so. Every edge carries a short verb label when provided by the brief.',
  DOCTRINE,
  "Node paths must be copied verbatim from the brief. Do not introduce new components, paths, or relationships not in the brief.",
  "Do not output prose before or after the JSON.",
].join("\n");

export function graphSystemPrompt(): string {
  return [
    "You are a diagram engineer. You receive an architecture brief (JSON) describing a runtime request lifecycle. Your only job is to lay it out as a diagram graph in JSON.",
    GRAPH_RULES,
  ].join("\n\n");
}

export function graphUserPrompt(brief: ArchitectureBrief): string {
  return `Architecture brief:\n${JSON.stringify(brief, null, 2)}\n\nLay out the diagram graph as instructed.`;
}

export function repairPrompt(issues: string[], validPathHints?: string[]): string {
  const lines = [
    "Your previous output was rejected. Fix ONLY these issues and re-emit the full JSON object:",
    ...issues.slice(0, 3).map((issue) => `- ${issue.slice(0, 160)}`),
  ];
  if (validPathHints && validPathHints.length > 0) {
    lines.push("", "Allowed file paths (pick only from this list; use `null` for external components):");
    lines.push(...validPathHints.slice(0, 30).map((p) => `- ${p}`));
  }
  return lines.join("\n");
}
