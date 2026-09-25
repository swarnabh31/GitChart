import { describe, expect, it } from "vitest";
import { z } from "zod";
import { graphToMermaid } from "./emitter";
import { diagramGraphSchema } from "./diagram-schema";
import { validateMermaid } from "./mermaid-validate";

const GRAPH = diagramGraphSchema.parse({
  groups: [
    { id: "gapp", label: "App Layer" },
    { id: "gunused", label: "Orphan Group" },
  ],
  nodes: [
    { id: "client", label: "Browser", shape: "circle", groupId: null, path: null },
    { id: "api", label: "API Route", shape: "box", groupId: "gapp", path: "app/api/route.ts" },
    { id: "svc", label: "Service", shape: "hexagon", groupId: "gapp", path: "src/server/service.ts" },
    { id: "cache", label: "Redis Cache", shape: "database", groupId: null, path: null },
    { id: "bus", label: "Event Bus", shape: "queue", groupId: null, path: "src/bus.ts" },
  ],
  edges: [
    { from: "client", to: "api", label: "HTTP", style: "solid", kind: "sync" },
    { from: "api", to: "svc", label: "calls", style: "solid", kind: "sync" },
    { from: "svc", to: "cache", label: "caches", style: "dashed", kind: "optional" },
    { from: "svc", to: "bus", label: "emits", style: "solid", kind: "async" },
  ],
});

describe("graphToMermaid", () => {
  it("emits a flowchart head and all nodes/edges", () => {
    const mermaid = graphToMermaid(GRAPH);
    expect(mermaid.split("\n")[0]).toBe("flowchart TB");
    expect(mermaid).toContain('subgraph gapp["App Layer"]');
    expect(mermaid).toContain('client("Browser")');
    expect(mermaid).toContain('api["API Route"]');
    expect(mermaid).toContain('svc{{"Service"}}');
    expect(mermaid).toContain('cache[/"Redis Cache"/]');
    expect(mermaid).toContain('bus[/ "Event Bus" \\ /]');
    expect(mermaid).toContain('client-->|"HTTP"|api');
    expect(mermaid).toContain('api-->|"calls"|svc');
    expect(mermaid).toContain('svc-.->|"caches"|cache');
  });

  it('double-quotes edge labels so special chars (parens, brackets, pipes) parse', () => {
    const graph = diagramGraphSchema.parse({
      groups: [],
      nodes: [
        { id: "a", label: "A", shape: "box", groupId: null, path: null },
        { id: "b", label: "B", shape: "box", groupId: null, path: null },
      ],
      edges: [
        { from: "a", to: "b", label: "flushes render queue via act()", style: "dashed", kind: "sync" },
        { from: "b", to: "a", label: "has [x] tag and | pipe", style: "solid", kind: "sync" },
      ],
    });
    const mermaid = graphToMermaid(graph);
    expect(mermaid).toContain('a-.->|"flushes render queue via act()"|b');
    expect(mermaid).toContain('b-->|"has [x] tag and | pipe"|a');
  });

  it("omits groups with no member nodes", () => {
    const mermaid = graphToMermaid(GRAPH);
    expect(mermaid).not.toContain("gunused");
  });

  it("escape-label output still passes the repo's heuristics", () => {
    const validation = validateMermaid(graphToMermaid(GRAPH));
    expect(validation.ok).toBe(true);
  });
});
