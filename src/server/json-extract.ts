export function extractFirstJsonObject(raw: string): string | null {
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return null;
}

export function formatZodIssues(error: { issues?: { path: PropertyKey[]; message: string }[] }): string[] {
  const issues = error.issues ?? [];
  return issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`);
}
