import { describe, expect, it } from "vitest";
import type { AIProvider } from "./ai/provider";
import type { RepoMetadata, TreeEntry } from "./github";
import { buildDigest } from "./digest";
import { generateDiagram } from "./pipeline";
import type { RedisStore } from "./storage/redis";
import type { ServerEvent, DiagramResult } from "./pipeline-types";

const META: RepoMetadata = {
  owner: "octo",
  repo: "demo",
  full_name: "octo/demo",
  default_branch: "main",
  description: "demo app",
  language: "TypeScript",
  stargazers_count: 10,
  forks_count: 2,
  private: false,
  resolved: true,
  html_url: "https://github.com/octo/demo",
};

const TREE: TreeEntry[] = [
  { path: "app/page.tsx", type: "blob", size: 1200, mode: "100644" },
  { path: "src/api/generate.ts", type: "blob", size: 2400, mode: "100644" },
  { path: "src/db/store.ts", type: "blob", size: 900, mode: "100644" },
  { path: "README.md", type: "blob", size: 500, mode: "100644" },
];

const DIGEST = buildDigest(
  META,
  TREE,
  [
    { path: "app/page.tsx", content: "export function Page() { ... }", truncated: false },
    { path: "src/api/generate.ts", content: "export async function handler() { ... }", truncated: false },
    { path: "src/db/store.ts", content: "export class Store { ... }", truncated: false },
  ]
);

const BRIEF_JSON = JSON.stringify({
  purpose: "A small demo app with a page, an API layer, and a store.",
  components: [
    { id: "page", name: "Page", path: "app/page.tsx", responsibility: "Renders the home page", shape: "box" },
    { id: "api", name: "Generate API", path: "src/api/generate.ts", responsibility: "Handles generation requests", shape: "hexagon" },
    { id: "store", name: "Store", path: "src/db/store.ts", responsibility: "Persists state", shape: "database" },
  ],
  relationships: [
    { from: "page", to: "api", verb: "calls", kind: "sync", style: "solid" },
    { from: "api", to: "store", verb: "writes", kind: "write", style: "solid" },
  ],
  coverage_limits: [],
});

const GRAPH_JSON = JSON.stringify({
  groups: [{ id: "gapp", label: "App" }],
  nodes: [
    { id: "page", label: "Page", description: "Home page", shape: "box", groupId: null, path: "app/page.tsx" },
    { id: "api", label: "API", description: "Generates diagrams", shape: "hexagon", groupId: "gapp", path: "src/api/generate.ts" },
    { id: "store", label: "Store", description: "Persists state", shape: "database", groupId: "gapp", path: "src/db/store.ts" },
  ],
  edges: [
    { from: "page", to: "api", label: "calls", style: "solid", kind: "sync" },
    { from: "api", to: "store", label: "writes", style: "solid", kind: "write" },
  ],
});

const SCRIPTED_PROVIDER: AIProvider = {
  name: "openai",
  async *streamCompletion(params) {
    if (!params.model.startsWith("graph")) {
      const text = BRIEF_JSON;
      for (let i = 0; i < text.length; i += 12) {
        await new Promise((r) => setTimeout(r, 1));
        yield text.slice(i, i + 12);
      }
      return;
    }
    throw new Error("explain pass must stream");
  },
  async complete(params) {
    if (!params.model.startsWith("graph")) {
      throw new Error("graph pass must complete");
    }
    return "Here is the graph:\n```json\n" + GRAPH_JSON + "\n```";
  },
};

function memoryRedis(): RedisStore {
  const m = new Map<string, { v: unknown; exp: number | null }>();
  const read = (k: string): unknown | null => {
    const e = m.get(k);
    if (!e) return null;
    if (e.exp !== null && e.exp <= Date.now()) {
      m.delete(k);
      return null;
    }
    return e.v;
  };
  return {
    async get<T>(k: string) {
      return (read(k) as T | null) ?? null;
    },
    async set(k: string, v: unknown, ttl?: number) {
      m.set(k, { v, exp: typeof ttl === "number" && ttl > 0 ? Date.now() + ttl * 1000 : null });
    },
    async del(k: string) {
      m.delete(k);
    },
    async incr(k: string, ttl?: number) {
      const cur = (read(k) as number | null) ?? 0;
      const next = cur + 1;
      const prev = m.get(k);
      m.set(k, {
        v: next,
        exp: prev?.exp ?? (typeof ttl === "number" && ttl > 0 ? Date.now() + ttl * 1000 : null),
      });
      return next;
    },
    async withClient() {
      throw new Error("no live redis in this test");
    },
  };
}

describe("generateDiagram end-to-end (scripted provider)", () => {
  it("emits phases + brief + prose, renders a valid mermaid, and caches", async () => {
    const events: ServerEvent[] = [];
    const redis = memoryRedis();

    const result = await generateDiagram({
      provider: SCRIPTED_PROVIDER,
      explanationModel: "explain-1",
      diagramModel: "graph-1",
      meta: META,
      digest: DIGEST,
      checkRateLimit: async () => ({ allowed: true, remaining: 0, resetsInSeconds: 0 }),
      redis,
      ttlSeconds: 60,
      onEvent: (e) => events.push(e),
    });

    const phases = events.filter((e) => e.type === "phase");
    const chunkEvents = events.filter(
      (e): e is Extract<ServerEvent, { delta: string }> => e.type === "explanation_chunk"
    );
    const briefEvents = events.filter((e) => e.type === "architecture_brief");
    const readyEvents = events.filter(
      (e): e is Extract<ServerEvent, { payload: DiagramResult }> => e.type === "diagram_ready"
    );

    expect(phases.length).toBeGreaterThanOrEqual(2);
    expect(briefEvents.length).toBe(1);
    expect(readyEvents.length).toBe(1);
    expect(chunkEvents.length).toBeGreaterThan(0);

    const streamed = chunkEvents.map((c) => c.delta).join("");
    expect(streamed).toContain("A small demo app");
    expect(streamed).not.toContain('"components"');
    expect(streamed).not.toContain('"purpose"');

    expect(result.mermaid_source).toContain("flowchart TB");
    expect(result.mermaid_source).toContain('subgraph gapp["App"]');
    expect(result.mermaid_source).toContain('page-->|"calls"|api');
    expect(result.mermaid_source).toContain('api-->|"writes"|store');

    expect(result.components).toHaveLength(3);
    expect(result.explanation).toContain("A small demo app");
    expect(result.explanation).not.toContain('"components"');
    expect(result.cached).toBe(false);
    expect(result.id).toMatch(/^diag_/);

    const cachedValue = await redis.get<unknown>(`diagram:${result.id}`);
    expect(cachedValue).toBeTruthy();

    const second = await generateDiagram({
      provider: SCRIPTED_PROVIDER,
      explanationModel: "explain-1",
      diagramModel: "graph-1",
      meta: META,
      digest: DIGEST,
      checkRateLimit: async () => ({ allowed: true, remaining: 0, resetsInSeconds: 0 }),
      redis,
      ttlSeconds: 60,
      onEvent: () => {},
    });
    expect(second.cached).toBe(true);
    expect(second.id).toBe(result.id);
    expect(second.mermaid_source).toBe(result.mermaid_source);
  });
});
