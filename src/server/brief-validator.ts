import type { ArchitectureBrief } from "./diagram-schema";

export type BriefValidation =
  | { ok: true; brief: ArchitectureBrief }
  | { ok: false; issues: string[] };

export function validateBrief(brief: ArchitectureBrief): BriefValidation {
  const issues: string[] = [];

  const ids = new Set<string>();
  for (const c of brief.components) {
    if (ids.has(c.id)) issues.push(`Duplicate component id: "${c.id}"`);
    ids.add(c.id);
  }

  for (const r of brief.relationships) {
    if (!ids.has(r.from)) issues.push(`Relationship "${r.from}" -> "${r.to}" references unknown component "${r.from}"`);
    if (!ids.has(r.to)) issues.push(`Relationship "${r.from}" -> "${r.to}" references unknown component "${r.to}"`);
  }

  if (!brief.components.some((c) => c.path !== null)) {
    issues.push("At least one component must reference a real file path (all-external diagrams are not allowed)");
  }
  if (brief.relationships.length === 0) {
    issues.push("At least one relationship is required");
  }

  return issues.length === 0 ? { ok: true, brief } : { ok: false, issues };
}
