// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { graphToMermaid } from "./emitter";
import { diagramGraphSchema } from "./diagram-schema";

describe("real mermaid parser over generated source (regression)", () => {
  const graph = diagramGraphSchema.parse({
    groups: [{ id: "g1", label: "Group (core)" }],
    nodes: [
      { id: "test-utils", label: "Test Utilities", shape: "box", groupId: "g1", path: "src/test-utils.js" },
      { id: "render-entry", label: "Render Entry", shape: "hexagon", groupId: "g1", path: "src/render.js" },
      { id: "options-hooks", label: "Options & Hooks", shape: "box", groupId: "g1", path: null },
      { id: "core-api", label: 'Core "API"', shape: "box", groupId: null, path: "src/index.js" },
    ],
    edges: [
      { from: "test-utils", to: "render-entry", label: "flushes render queue via act()", style: "dashed", kind: "sync" },
      { from: "render-entry", to: "options-hooks", label: "has [x] tag and | pipe", style: "solid", kind: "async" },
      { from: "core-api", to: "options-hooks", label: "exports render / hydrate", style: "solid", kind: "sync" },
    ],
  });

  it("emitted source parses under the real mermaid engine", async () => {
    await expect(mermaid.parse(graphToMermaid(graph))).resolves.toBeTruthy();
  });
});
