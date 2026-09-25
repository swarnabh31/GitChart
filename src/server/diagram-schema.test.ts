import { describe, expect, it } from "vitest";
import {
  ArchitectureBriefSchema,
  architectureBriefJsonSchema,
  diagramGraphJsonSchema,
  diagramGraphSchema,
} from "./diagram-schema";

const VALID_GRAPH = {
  groups: [{ id: "g1", label: "Request Runtime" }],
  nodes: [
    { id: "a", label: "API", description: "", shape: "box", groupId: "g1", path: "app/api/route.ts" },
    { id: "b", label: "DB", description: "", shape: "database", groupId: null, path: null },
  ],
  edges: [{ from: "a", to: "b", label: "reads", style: "solid", kind: "read" }],
};

describe("diagramGraphSchema", () => {
  it("accepts a minimal valid graph", () => {
    const res = diagramGraphSchema.safeParse(VALID_GRAPH);
    expect(res.success).toBe(true);
  });

  it("requires at least 2 nodes", () => {
    const res = diagramGraphSchema.safeParse({
      ...VALID_GRAPH,
      nodes: VALID_GRAPH.nodes.slice(0, 1),
    });
    expect(res.success).toBe(false);
  });

  it("requires at least 1 edge", () => {
    const res = diagramGraphSchema.safeParse({ ...VALID_GRAPH, edges: [] });
    expect(res.success).toBe(false);
  });

  it("enforces the group count limit", () => {
    const res = diagramGraphSchema.safeParse({
      ...VALID_GRAPH,
      groups: Array.from({ length: 11 }, (_, i) => ({ id: `g${i}`, label: "G" + i })),
    });
    expect(res.success).toBe(false);
  });

  it("rejects unknown edge kinds", () => {
    const res = diagramGraphSchema.safeParse({
      ...VALID_GRAPH,
      edges: [{ from: "a", to: "b", label: "x", style: "solid", kind: "teleport" }],
    });
    expect(res.success).toBe(false);
  });

  it("emits a JSON schema with the expected top-level keys", () => {
    const json = diagramGraphJsonSchema();
    expect(json).toHaveProperty("properties");
  });
});

describe("ArchitectureBriefSchema", () => {
  const VALID_BRIEF = {
    purpose: "A small API service",
    components: [
      { id: "api", name: "API", path: "app/api/route.ts", responsibility: "Handles HTTP", shape: "box" },
      { id: "db", name: "Database", path: null, responsibility: "Stores rows", shape: "database" },
    ],
    relationships: [{ from: "api", to: "db", verb: "reads", kind: "read", style: "solid" }],
    coverage_limits: [],
  };

  it("accepts a minimal valid brief", () => {
    const res = ArchitectureBriefSchema.safeParse(VALID_BRIEF);
    expect(res.success).toBe(true);
  });

  it("tolerates all-external paths at the schema level (semantic rule lives in brief-validator)", () => {
    const res = ArchitectureBriefSchema.safeParse({
      ...VALID_BRIEF,
      components: VALID_BRIEF.components.map((c) => ({ ...c, path: null })),
    });
    expect(res.success).toBe(true);
  });

  it("emits a JSON schema", () => {
    expect(architectureBriefJsonSchema()).toHaveProperty("properties");
  });
});
