import type { DiagramGraph } from "./diagram-schema";

type Shape = DiagramGraph["nodes"][number]["shape"];

function escapeLabel(label: string): string {
  return label.replace(/[\n\r\t]+/g, " ").replace(/"/g, "'").trim();
}

const SHAPE_RENDER: Record<Shape, (id: string, label: string) => string> = {
  box: (id, l) => `${id}[${JSON.stringify(l)}]`,
  database: (id, l) => `${id}[/${JSON.stringify(l)}/]`,
  queue: (id, l) => `${id}[/ ${JSON.stringify(l)} \\ /]`,
  circle: (id, l) => `${id}(${JSON.stringify(l)})`,
  hexagon: (id, l) => `${id}{{${JSON.stringify(l)}}}`,
  document: (id, l) => `${id}>${JSON.stringify(l)}]`,
  class: (id, l) => `${id}[${JSON.stringify(l)}]`,
};

function renderNode(id: string, label: string, shape: Shape): string {
  return SHAPE_RENDER[shape](id, escapeLabel(label));
}

export function graphToMermaid(g: DiagramGraph): string {
  const out: string[] = ["flowchart TB"];
  const usedGroupIds = new Set<string>();
  for (const n of g.nodes) {
    if (n.groupId) usedGroupIds.add(n.groupId);
  }
  for (const grp of g.groups) {
    if (!usedGroupIds.has(grp.id)) continue;
    out.push(`  subgraph ${grp.id}["${escapeLabel(grp.label)}"]`);
    for (const n of g.nodes) {
      if (n.groupId === grp.id) out.push(`    ${renderNode(n.id, n.label, n.shape)}`);
    }
    out.push("  end");
  }
  for (const n of g.nodes) {
    if (!n.groupId) out.push(`  ${renderNode(n.id, n.label, n.shape)}`);
  }
  const arrow = (style: "solid" | "dashed") => (style === "dashed" ? "-.->" : "-->");
  for (const e of g.edges) {
    const label = e.label ? `|${JSON.stringify(escapeLabel(e.label))}|` : "";
    out.push(`  ${e.from}${arrow(e.style)}${label}${e.to}`);
  }
  return out.join("\n");
}
