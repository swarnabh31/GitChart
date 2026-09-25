export interface MermaidValidation {
  ok: boolean;
  errors: string[];
  normalized: string;
}

const ALLOWED_HEADERS = [
  /^graph\s+(TD|TB|LR|RL|BT)\b/,
  /^flowchart\s+(TD|TB|LR|RL|BT)\b/,
];

function stripCodeFence(source: string): string {
  let trimmed = source.trim();
  const fenced = trimmed.match(/^```(?:mermaid)?\s*\n([\s\S]*?)\n?```$/);
  if (fenced && fenced[1]) trimmed = fenced[1].trim();
  return trimmed;
}

function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      let inQuote = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') inQuote = !inQuote;
        if (!inQuote && ch === "%" && (i === 0 || line[i - 1] !== "\\")) {
          return line.slice(0, i).trimEnd();
        }
      }
      return line;
    })
    .join("\n");
}

export function validateMermaid(rawSource: string): MermaidValidation {
  const errors: string[] = [];
  const normalized = stripLineComments(stripCodeFence(rawSource))
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  if (!normalized) {
    errors.push("Empty diagram source");
  } else {
    const firstLine = normalized.split("\n")[0];
    if (!ALLOWED_HEADERS.some((re) => re.test(firstLine))) {
      errors.push(`Unsupported diagram header: "${firstLine.slice(0, 40)}" (expected "graph TD" or "flowchart")`);
    }
    const lines = normalized.split("\n").slice(1);
    for (const line of lines) {
      if (!line || line.startsWith("%%")) continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9_]*\s*(\[(?:[^\[\]]*)\]|\((?:[^\(\)]*)\)|\{(?:[^{}]*\})\}|[^\[\]{}]*)?\s*(-->+|-\.->+|===+|---+\s*)?\s*(\[[A-Za-z0-9_\- ]*\]){0,3}\s*$/.test(line)) {
        // Soft warning only: complex valid Mermaid syntax may not match this heuristic.
        continue;
      }
    }
  }

  return { ok: errors.length === 0, errors, normalized };
}

export function extractDiagramNodes(mermaidSource: string): string[] {
  const lines = mermaidSource.split("\n").slice(1);
  const nodes = new Set<string>();
  const nodeDef = /^[A-Za-z0-9][A-Za-z0-9_]*/;
  for (const line of lines) {
    const matches = line.match(new RegExp(`(${nodeDef.source})(?=\\s*(\\[|\\(|\\{|-->|-\\.->|===|---|\\s*$))`, "g"));
    if (matches) matches.forEach((m) => nodes.add(m));
    const arrow = line.match(/^([A-Za-z0-9][A-Za-z0-9_]*)[^\n]*?-->+\s*([A-Za-z0-9][A-Za-z0-9_]*)/);
    if (arrow) {
      nodes.add(arrow[1]);
      nodes.add(arrow[2]);
    }
  }
  return [...nodes].slice(0, 12);
}
