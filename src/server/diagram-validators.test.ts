import { describe, expect, it } from "vitest";
import { validateBrief } from "./brief-validator";
import { diagramGraphSchema, type ArchitectureBrief } from "./diagram-schema";
import { onlyUnknownPathIssues, stripUnknownPaths, validateDiagramGraph } from "./graph-validator";

const BASE_GRAPH = diagramGraphSchema.parse({
  groups: [{ id: "g1", label: "Core" }],
  nodes: [
    { id: "a", label: "A", shape: "box", groupId: "g1", path: "a.ts" },
    { id: "b", label: "B", shape: "box", groupId: "g1", path: "b.ts" },
  ],
  edges: [{ from: "a", to: "b", label: "x", style: "solid", kind: "sync" }],
});

describe("validateBrief", () => {
  const brief: ArchitectureBrief = {
    purpose: "p",
    components: [
      { id: "a", name: "A", path: "a.ts", responsibility: "r", shape: "box" },
      { id: "b", name: "B", path: null, responsibility: "r", shape: "circle" },
    ],
    relationships: [{ from: "a", to: "b", verb: "calls", kind: "sync", style: "solid" }],
    coverage_limits: [],
  };

  it("accepts a well-formed brief", () => {
    expect(validateBrief(brief).ok).toBe(true);
  });

  it("flags duplicate component ids", () => {
    const bad: ArchitectureBrief = {
      ...brief,
      components: [brief.components[0], { ...brief.components[1], id: "a" }],
    };
    const res = validateBrief(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.some((i) => i.includes("Duplicate"))).toBe(true);
  });

  it("flags relationships to unknown components", () => {
    const bad: ArchitectureBrief = {
      ...brief,
      relationships: [{ ...brief.relationships[0], to: "ghost" }],
    };
    const res = validateBrief(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.some((i) => i.includes("ghost"))).toBe(true);
  });

  it("rejects all-external briefs", () => {
    const bad: ArchitectureBrief = {
      ...brief,
      components: brief.components.map((c) => ({ ...c, path: null })),
    };
    const res = validateBrief(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.some((i) => i.includes("real file"))).toBe(true);
  });
});

describe("validateDiagramGraph", () => {
  it("accepts a coherent graph", () => {
    expect(validateDiagramGraph(BASE_GRAPH, new Set(["a.ts", "b.ts"])).ok).toBe(true);
  });

  it("flags self-loops", () => {
    const bad: typeof BASE_GRAPH = {
      ...BASE_GRAPH,
      edges: [{ from: "a", to: "a", label: "x", style: "solid", kind: "sync" }],
    };
    const res = validateDiagramGraph(bad);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.includes("Self-loop"))).toBe(true);
  });

  it("flags dangling edge endpoints", () => {
    const bad: typeof BASE_GRAPH = {
      ...BASE_GRAPH,
      edges: [{ from: "a", to: "zzz", label: "x", style: "solid", kind: "sync" }],
    };
    const res = validateDiagramGraph(bad);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.includes("zzz"))).toBe(true);
  });

  it("flags empty groups", () => {
    const bad = {
      ...BASE_GRAPH,
      groups: [{ id: "g1", label: "Core" }, { id: "g2", label: "Empty" }],
    };
    const res = validateDiagramGraph(bad);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.includes('Group "g2"'))).toBe(true);
  });

  it("flags unknown file paths", () => {
    const bad = { ...BASE_GRAPH, nodes: [{ ...BASE_GRAPH.nodes[0], path: "nope.ts" }, BASE_GRAPH.nodes[1]] };
    const res = validateDiagramGraph(bad, new Set(["a.ts", "b.ts"]));
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.includes("nope.ts"))).toBe(true);
  });
});

describe("stripUnknownPaths", () => {
  it("nulls out only the unknown paths and reports them", () => {
    const bad = { ...BASE_GRAPH, nodes: [{ ...BASE_GRAPH.nodes[0], path: "nope.ts" }, BASE_GRAPH.nodes[1]] };
    const valid = new Set(["a.ts", "b.ts"]);
    const { graph, strippedPaths } = stripUnknownPaths(bad, valid);
    expect(strippedPaths).toEqual(["nope.ts"]);
    expect(graph.nodes[0].path).toBeNull();
    expect(graph.nodes[1].path).toBe("b.ts");
    expect(onlyUnknownPathIssues(bad, valid)).toBe(true);
  });

  it("is not applied when other issue classes are present", () => {
    const bad: typeof BASE_GRAPH = {
      ...BASE_GRAPH,
      nodes: [{ ...BASE_GRAPH.nodes[0], path: "nope.ts" }, BASE_GRAPH.nodes[1]],
      edges: [{ from: "a", to: "a", label: "x", style: "solid", kind: "sync" }],
    };
    const valid = new Set(["a.ts", "b.ts"]);
    expect(onlyUnknownPathIssues(bad, valid)).toBe(false);
  });
});
