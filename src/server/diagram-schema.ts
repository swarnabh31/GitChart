import { z } from "zod";

export const EDGE_KIND = ["sync", "async", "read", "write", "return", "optional", "external"] as const;
export const NODE_SHAPE = ["box", "database", "queue", "circle", "hexagon", "document", "class"] as const;
export const EDGE_STYLE = ["solid", "dashed"] as const;

export const ArchitectureBriefSchema = z.object({
  purpose: z.string().min(1).max(1200),
  components: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        name: z.string().min(1).max(80),
        path: z.union([z.string().min(1), z.null()]),
        responsibility: z.string().min(1).max(400),
        shape: z.enum(NODE_SHAPE).default("box"),
      })
    )
    .min(1)
    .max(40),
  relationships: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        verb: z.string().min(1).max(80),
        kind: z.enum(EDGE_KIND),
        style: z.enum(EDGE_STYLE).default("solid"),
      })
    )
    .min(1)
    .max(60),
  coverage_limits: z.array(z.string()),
});

export const DiagramGroupSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
});

export const DiagramNodeSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(40),
  description: z.string().max(160).default(""),
  shape: z.enum(NODE_SHAPE).default("box"),
  groupId: z.string().min(1).max(40).nullable().default(null),
  path: z.union([z.string().min(1), z.null()]),
});

export const DiagramEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().min(1).max(40).default(""),
  style: z.enum(EDGE_STYLE).default("solid"),
  kind: z.enum(EDGE_KIND).default("sync"),
});

export const DiagramGroupLimits = { groups: 10, nodes: 34, edges: 48 } as const;

export const diagramGraphSchema = z.object({
  groups: z.array(DiagramGroupSchema).max(DiagramGroupLimits.groups),
  nodes: z.array(DiagramNodeSchema).min(2).max(DiagramGroupLimits.nodes),
  edges: z.array(DiagramEdgeSchema).min(1).max(DiagramGroupLimits.edges),
});

export type ArchitectureBrief = z.infer<typeof ArchitectureBriefSchema>;
export type DiagramGraph = z.infer<typeof diagramGraphSchema>;

export function diagramGraphJsonSchema(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return z.toJSONSchema(diagramGraphSchema as any) as Record<string, unknown>;
}

export function architectureBriefJsonSchema(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return z.toJSONSchema(ArchitectureBriefSchema as any) as Record<string, unknown>;
}
