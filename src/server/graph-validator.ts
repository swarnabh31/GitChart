import type { DiagramGraph } from "./diagram-schema";

export interface GraphValidation {
  ok: boolean;
  issues: string[];
}

export interface StripResult {
  graph: DiagramGraph;
  strippedPaths: string[];
}

export function validateDiagramGraph(graph: DiagramGraph, validPaths?: Set<string>): GraphValidation {
  const issues: string[] = [];
  const groupIds = new Set(graph.groups.map((g) => g.id));
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  if (new Set(graph.nodes.map((n) => n.id)).size !== graph.nodes.length) {
    issues.push("Duplicate node ids");
  }
  if (new Set(graph.groups.map((g) => g.id)).size !== graph.groups.length) {
    issues.push("Duplicate group ids");
  }

  for (const n of graph.nodes) {
    if (n.groupId !== null && !groupIds.has(n.groupId)) {
      issues.push(`Node "${n.id}" references unknown group "${n.groupId}"`);
    }
    if (n.path !== null && validPaths && !validPaths.has(n.path)) {
      issues.push(`Node "${n.id}" references unknown file path "${n.path}"`);
    }
  }

  for (const e of graph.edges) {
    if (e.from === e.to) {
      issues.push(`Self-loop edge on node "${e.from}"`);
    }
    if (!nodeIds.has(e.from)) issues.push(`Edge source "${e.from}" is not a known node`);
    if (!nodeIds.has(e.to)) issues.push(`Edge target "${e.to}" is not a known node`);
  }

  if (graph.groups.length > 0) {
    for (const g of graph.groups) {
      if (!graph.nodes.some((n) => n.groupId === g.id)) {
        issues.push(`Group "${g.id}" has no nodes`);
      }
    }
  }

  const hasExternal = graph.nodes.some((n) => n.path === null);
  if (hasExternal) {
    for (const n of graph.nodes) {
      if (n.path !== null && n.groupId === null) {
        const touch = graph.edges.some((e) => e.from === n.id || e.to === n.id);
        if (!touch) issues.push(`Node "${n.id}" is orphaned (no group, no edges)`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

export function stripUnknownPaths(graph: DiagramGraph, validPaths: Set<string>): StripResult {
  const strippedPaths: string[] = [];
  const nodes = graph.nodes.map((n) => {
    if (n.path !== null && !validPaths.has(n.path)) {
      strippedPaths.push(n.path);
      return { ...n, path: null };
    }
    return n;
  });
  return { graph: { ...graph, nodes }, strippedPaths };
}

export function onlyUnknownPathIssues(graph: DiagramGraph, validPaths: Set<string>): boolean {
  const { issues } = validateDiagramGraph(graph, validPaths);
  if (issues.length === 0) return true;
  return issues.every((i) => i.includes("unknown file path"));
}
