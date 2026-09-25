import type { RepoDigest } from "./digest";

export interface FileSignal {
  path: string;
  exports: string[];
  routes: string[];
  imports: string[];
}

const EXPORT_IDENT =
  /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
const EXPORT_LIST = /export\s*\{([^}]+)\}/g;
const PY_CLASS = /(?:^|\n)\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/g;
const PY_DEF = /(?:^|\n)\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/g;
const GO_EXPORT = /(?:^|\n)\s*func\s+(?:\([^)]*\)\s*)?([A-Z][A-Za-z0-9_]*)/g;
const GO_CONST = /(?:^|\n)\s*(?:var|const)\s+(?:\([^)]*\)\s*)?([A-Z][A-Za-z0-9_]*)\s*=/g;

const ROUTE_PATTERNS: RegExp[] = [
  /(?:app|router)\.(?:get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi,
  /@\w+(?:\.\w+)*\.(?:get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi,
  /@\w+(?:\.\w+)*\.route\(\s*["'`]([^"'`]+)["'`]/gi,
  /\w+\.(?:GET|POST|PUT|PATCH|DELETE)\(\s*["'`]([^"'`]+)["'`]/g,
];

const NEXT_ROUTE_FILE = /(?:^|\/)route\.[jt]sx?$/;
const NEXT_HANDLER =
  /export\s+(?:const|async function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

const REL_IMPORT = /(?:from|import)\s+["'`](\.\.?\/[^"'`]+)["'`]/g;

const EXT_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

function resolveImport(fromPath: string, rawImport: string, knownPaths: Set<string>): string | null {
  const dir = fromPath.split("/").slice(0, -1).join("/");
  const raw = rawImport.replace(/^\/+/, "");
  const joined = dir ? `${dir}/${raw}` : raw;
  const parts = joined.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  const base = out.join("/");
  for (const ext of EXT_CANDIDATES) {
    const candidate = base + ext;
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function collectUnique(matches: string[] | RegExpMatchArray | null, cap: number): string[] {
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const v = (typeof m === "string" ? m : m[1]).trim();
    if (!v || v.startsWith("_") || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

function extractExports(content: string, path: string): string[] {
  const lower = path.toLowerCase();
  const out: string[] = [];
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx")) {
    out.push(...collectUnique([...content.matchAll(EXPORT_IDENT)].map((m) => m[1]), 8));
    for (const list of content.matchAll(EXPORT_LIST)) {
      for (const item of list[1].split(",")) {
        const name = item.split(/\s+as\s+/).pop()?.trim().replace(/^type\s+/, "");
        if (name && !out.includes(name)) out.push(name);
      }
      if (out.length >= 12) break;
    }
  } else if (lower.endsWith(".py")) {
    out.push(...collectUnique([...content.matchAll(PY_CLASS)].map((m) => m[1]), 6));
    out.push(...collectUnique([...content.matchAll(PY_DEF)].map((m) => m[1]), 6));
  } else if (lower.endsWith(".go")) {
    out.push(...collectUnique([...content.matchAll(GO_EXPORT)].map((m) => m[1]), 8));
    out.push(...collectUnique([...content.matchAll(GO_CONST)].map((m) => m[1]), 4));
  } else if (lower.endsWith(".rs")) {
    out.push(...collectUnique([...content.matchAll(/pub\s+(?:fn|struct|enum|trait|mod)\s+([A-Z_][A-Za-z0-9_]*)/g)].map((m) => m[1]), 8));
  }
  return out.slice(0, 14);
}

function extractRoutes(content: string, path: string): string[] {
  const out: string[] = [];
  if (NEXT_ROUTE_FILE.test(path)) {
    for (const m of content.matchAll(NEXT_HANDLER)) {
      out.push(`${m[1]} (${path.split("/").slice(0, -1).join("/") || "/"})`);
    }
  }
  for (const pattern of ROUTE_PATTERNS) {
    for (const m of content.matchAll(pattern)) {
      const route = m[1];
      if (route.startsWith("/") && !out.includes(route) && !out.some((r) => r.endsWith(route))) {
        out.push(route);
      }
    }
  }
  return out.slice(0, 8);
}

export function extractArchitectureSignals(digest: RepoDigest): FileSignal[] {
  const knownPaths = new Set(digest.files.map((f) => f.path.replace(/^\//, "")));
  const signals: FileSignal[] = [];
  for (const file of digest.files) {
    const path = file.path.replace(/^\//, "");
    const imports: string[] = [];
    for (const m of file.excerpt.matchAll(REL_IMPORT)) {
      const resolved = resolveImport(path, m[1], knownPaths);
      if (resolved && resolved !== path && !imports.includes(resolved)) imports.push(resolved);
      if (imports.length >= 8) break;
    }
    signals.push({
      path,
      exports: extractExports(file.excerpt, path),
      routes: extractRoutes(file.excerpt, path),
      imports,
    });
  }
  return signals;
}

export function formatSignals(signals: FileSignal[]): string {
  const parts: string[] = [];
  for (const s of signals) {
    const bits: string[] = [];
    if (s.routes.length) bits.push(`routes: ${s.routes.join(", ")}`);
    if (s.exports.length) bits.push(`exports: ${s.exports.join(", ")}`);
    if (s.imports.length) bits.push(`imports: ${s.imports.join(", ")}`);
    if (bits.length) parts.push(`${s.path} -> ${bits.join(" | ")}`);
  }
  return parts.join("\n");
}
