import type { RepoMetadata, TreeEntry } from "./github";

export interface RepoDigest {
  metadata: RepoMetadata;
  tree: string;
  files: { path: string; excerpt: string; truncated: boolean }[];
  totalBytes: number;
  fileCount: number;
}

const DIGEST_TREE_MAX_BYTES = 12_000;

export interface DigestBudget {
  total: number;
  excerpt: number;
  maxFiles: number;
}

export const LARGE_BUDGET: DigestBudget = { total: 48_000, excerpt: 18_000, maxFiles: 12 };
export const MEDIUM_BUDGET: DigestBudget = { total: 24_000, excerpt: 9_000, maxFiles: 8 };
export const SMALL_BUDGET: DigestBudget = { total: 24_000, excerpt: 9_000, maxFiles: 8 };

export function modelParameterSize(model: string | undefined): number | null {
  if (!model) return null;
  const m = model.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function resolveDigestBudget(model: string | undefined): DigestBudget {
  const size = modelParameterSize(model);
  if (size === null) return LARGE_BUDGET;
  if (size <= 14) return SMALL_BUDGET;
  if (size <= 32) return MEDIUM_BUDGET;
  return LARGE_BUDGET;
}

export const DEFAULT_SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp",
  ".cs", ".php", ".swift", ".scala", ".sh", ".sql",
]);

function isSourceFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return DEFAULT_SOURCE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function isSkippedPath(path: string): boolean {
  const parts = path.split("/");
  return parts.some(
    (p) =>
      p === "node_modules" || p === "vendor" || p === "dist" || p === "build" ||
      p === "coverage" || p === ".next" || p === "__pycache__" || p === ".git"
  );
}

const ROLE_FILE_RE =
  /controller|service|provider|pipeline|engine|orchestrat|workflow|agent|graph|scheduler|worker|consumer|producer|processor|handler|router|repositor(y|ies)|model|schema|client|api/i;
const AI_FILE_RE =
  /retriev|inference|llm|rag|embed|query|index(er|ing)|tokeniz|prompt|tool(s)?|memory|context|chunk|vector/i;

const MANIFEST_BASENAMES = new Set([
  "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "setup.py",
  "Pipfile", "requirements.txt", "Gemfile", "pom.xml", "build.gradle",
  "build.gradle.kts", "composer.json", "mix.exs", "CMakeLists.txt",
  "Dockerfile", "Makefile",
]);

const CORE_DIR_NAMES = new Set([
  "lib", "src", "core", "app", "pages", "server", "backend", "api",
  "internal", "pkg", "modules",
]);

const MONOREPO_PACKAGE_DIRS = new Set([
  "app", "server", "api", "web", "core", "backend", "packages", "src",
  "frontend", "ui", "service", "services", "functions", "worker",
]);

function isManifest(path: string): boolean {
  const lower = path.toLowerCase();
  const base = path.split("/").pop() ?? "";
  if (MANIFEST_BASENAMES.has(base)) return true;
  return /\.csproj$|\.sln$/.test(lower);
}

function isUnderDir(path: string, dirs: string): boolean {
  const lower = path.toLowerCase();
  return dirs.split("|").some((d) => new RegExp(`(^|/)${d}/`).test(lower));
}

export function scoreFile(path: string, sizeBytes: number, tree: TreeEntry[]): number {
  const lower = path.toLowerCase();
  const base = path.split("/").pop() ?? "";

  let score = 0;
  if (/^(main|app)\./.test(base)) score += 40;
  if (/^(route\.ts|\+server\.ts|page\.tsx)$/.test(base) && isUnderDir(lower, "app|pages")) score += 35;
  if (isManifest(path) || /^readme/i.test(base)) {
    if (isManifest(path)) score += 15;
    if (/^readme/i.test(base)) score += 10;
  } else {
    if (ROLE_FILE_RE.test(base)) score += 25;
    if (AI_FILE_RE.test(base)) score += 20;
  }
  const parentDir = path.split("/").slice(-2, -1)[0] ?? "";
  if (CORE_DIR_NAMES.has(parentDir.toLowerCase())) score += 5;

  if (/(^|\/)tests?\/|\.spec\.|\.test\.|(^|\/)__tests__|(^|\/)e2e\/|\.fixtures\./.test(lower)) score -= 60;
  const segments = lower.split("/");
  for (const seg of segments) {
    if (
      seg === "scripts" || seg === "tooling" || seg === "dev" || seg === ".github" ||
      seg === ".husky" || seg === "bin" || seg === "vendor" || seg === "third_party"
    ) {
      score -= 70;
    }
  }
  if (/healthz|readyz|livez|health_check/.test(base)) score -= 80;
  if (/\.d\.ts$|\.min\.js$|\.min\.css$|\.map$|\.lock$/.test(lower)) score -= 90;
  const TELEMETRY_DIRS = new Set([
    "analytics", "telemetry", "instrument", "posthog", "sentry",
    "mixpanel", "segment", "amplitude", "datadog", "new_relic",
  ]);
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (TELEMETRY_DIRS.has(seg) || seg === "logger" || seg === "logging") score -= 55;
  }
  if (sizeBytes < 250) score -= 40;
  if (sizeBytes > 200_000) score -= 30;

  const monorepo =
    base === "package.json" && path !== "package.json" &&
    tree.filter(
      (e) => e.type === "blob" && (e.path.split("/").pop() ?? "").toLowerCase() === "package.json" && e.path.split("/").length <= 3
    ).length >= 2;
  if (monorepo) {
    const lastSeg = parentDir.split("/").pop() ?? "";
    if (MONOREPO_PACKAGE_DIRS.has(lastSeg.toLowerCase())) score += 30;
  }

  return Math.max(-100, Math.min(100, score));
}

const DIR_SLOTS = 2;

export function selectDigestFiles(
  tree: TreeEntry[],
  budget: DigestBudget = LARGE_BUDGET
): { path: string; size: number }[] {
  const blobs = tree
    .filter((entry) => entry.type === "blob" && !isSkippedPath(entry.path) && (isSourceFile(entry.path) || isManifest(entry.path) || /^readme/i.test(entry.path.split("/").pop() ?? "")))
    .map((entry) => ({ path: entry.path, size: entry.size }))
    .sort((a, b) => {
      const sa = scoreFile(a.path, a.size, tree);
      const sb = scoreFile(b.path, b.size, tree);
      if (sa !== sb) return sb - sa;
      return a.path.localeCompare(b.path);
    });

  const dirTop = new Set<string>();
  {
    const seen = new Set<string>();
    for (const b of blobs) {
      const d = b.path.includes("/") ? b.path.slice(0, b.path.lastIndexOf("/")) : "(root)";
      if (!seen.has(d)) {
        seen.add(d);
        dirTop.add(b.path);
      }
    }
  }

  const scoreMap = new Map(blobs.map((b) => [b.path, scoreFile(b.path, b.size, tree)]));
  const positive = blobs.filter((b) => (scoreMap.get(b.path) ?? 0) >= 0);
  const pool = positive.length >= 3 ? positive : blobs;

  const selected: { path: string; size: number }[] = [];
  const dirCounts = new Map<string, number>();
  let used = 0;
  for (const file of pool) {
    if (selected.length >= budget.maxFiles) break;
    const parentDir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "(root)";
    const inDir = dirCounts.get(parentDir) ?? 0;
    if (inDir >= DIR_SLOTS && !dirTop.has(file.path)) continue;
    const capped = Math.min(file.size, budget.excerpt);
    if (used + capped > budget.total && selected.length > 0) continue;
    if (used + capped > budget.total) break;
    selected.push({ path: file.path, size: file.size });
    dirCounts.set(parentDir, inDir + 1);
    used += capped;
  }
  return selected;
}

function formatTree(tree: TreeEntry[], budget: number = DIGEST_TREE_MAX_BYTES): string {
  const lines: string[] = [];
  let used = 0;
  for (const entry of tree) {
    const line = `${entry.type === "tree" ? "d" : "f"} ${entry.path}`;
    if (used + line.length > budget) {
      lines.push("... (truncated)");
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

export function buildDigest(
  metadata: RepoMetadata,
  tree: TreeEntry[],
  fileExcerpts: { path: string; content: string; truncated: boolean }[]
): RepoDigest {
  return {
    metadata,
    tree: formatTree(tree.filter((e) => !isSkippedPath(e.path))),
    files: fileExcerpts.map((f) => ({
      path: f.path,
      excerpt: f.content,
      truncated: f.truncated,
    })),
    totalBytes: fileExcerpts.reduce((sum, f) => sum + f.content.length, 0) +
      formatTree(tree).length,
    fileCount: fileExcerpts.length,
  };
}
