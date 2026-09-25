import { describe, expect, it, vi } from "vitest";
import type { AIProvider } from "./ai/provider";
import type { RepoDigest } from "./digest";
import type { RepoMetadata } from "./github-errors";
import { runExplainPass, type ExplainStreamCallbacks } from "./pipeline-explain";
import { runGraphPass } from "./pipeline-graph";
import { PipelineStageError } from "./error-codes";
import { parsePipelineError } from "./pipeline";

const META: RepoMetadata = {
  owner: "octo",
  repo: "widget-app",
  full_name: "octo/widget-app",
  default_branch: "main",
  description: "A demo app",
  language: "TypeScript",
  stargazers_count: 10,
  forks_count: 2,
  private: false,
  resolved: true,
  html_url: "https://github.com/octo/widget-app",
};

const DIGEST: RepoDigest = {
  metadata: META,
  tree: "README.md\nsrc\n  index.ts",
  files: [
    { path: "src/index.ts", excerpt: "export function run() {}", truncated: false },
    { path: "app/api/route.ts", excerpt: "export const api = 1", truncated: false },
  ],
  totalBytes: 100,
  fileCount: 2,
};

const VALID_BRIEF_JSON = {
  purpose: "A small API service",
  components: [
    { id: "api", name: "API", path: "app/api/route.ts", responsibility: "Handles HTTP", shape: "box" },
    { id: "run", name: "Core", path: "src/index.ts", responsibility: "Core logic", shape: "box" },
  ],
  relationships: [{ from: "api", to: "run", verb: "calls", kind: "sync", style: "solid" }],
  coverage_limits: [],
};

const VALID_GRAPH_JSON = {
  groups: [{ id: "g1", label: "Runtime" }],
  nodes: [
    { id: "api", label: "API", description: "", shape: "box", groupId: "g1", path: "app/api/route.ts" },
    { id: "run", label: "Core", description: "", shape: "box", groupId: "g1", path: "src/index.ts" },
  ],
  edges: [{ from: "api", to: "run", label: "calls", style: "solid", kind: "sync" }],
};

function makeBriefProvider(payload: unknown) {
  return {
    name: "ollama",
    streamCompletion: async function* () {
      yield JSON.stringify(payload);
    },
    complete: async () => "",
  } as unknown as AIProvider;
}

function makeGraphProvider(payload: unknown) {
  return {
    name: "ollama",
    streamCompletion: async function* () {},
    complete: async () => JSON.stringify(payload),
  } as unknown as AIProvider;
}

function noopCallbacks(): ExplainStreamCallbacks {
  return {
    onDone: vi.fn(),
    onError: vi.fn(),
  };
}

function emptyValidPaths(): Set<string> {
  return new Set();
}

describe("runExplainPass", () => {
  it("returns a brief when the first attempt is valid", async () => {
    const cb = noopCallbacks();
    const brief = await runExplainPass({
      provider: makeBriefProvider(VALID_BRIEF_JSON),
      explanationModel: "m",
      meta: META,
      digest: DIGEST,
      validPaths: emptyValidPaths(),
      cb,
    });
    expect(brief.purpose).toBe(VALID_BRIEF_JSON.purpose);
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it("flags all-external briefs and retries then fails with EXP_INVALID", async () => {
    const providers: AIProvider[] = [];
    const allExternal = {
      ...VALID_BRIEF_JSON,
      components: VALID_BRIEF_JSON.components.map((c) => ({ ...c, path: null })),
    };
    // Both attempts return an all-external brief -> validateBrief rejects -> retry -> fail.
    const alwaysBad = makeBriefProvider(allExternal);
    const cb = noopCallbacks();
    await expect(
      runExplainPass({
        provider: alwaysBad,
        explanationModel: "m",
        meta: META,
        digest: DIGEST,
        validPaths: emptyValidPaths(),
        cb,
      })
    ).rejects.toThrow(PipelineStageError);
    expect(cb.onError).toHaveBeenCalled();
  });

  it("throws EXP_INVALID when there is no JSON at all", async () => {
    const provider = {
      name: "ollama",
      streamCompletion: async function* () {
        yield "no json here";
      },
      complete: async () => "",
    } as unknown as AIProvider;
    const cb = noopCallbacks();
    let caught: unknown;
    try {
      await runExplainPass({
        provider,
        explanationModel: "m",
        meta: META,
        digest: DIGEST,
        validPaths: emptyValidPaths(),
        cb,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PipelineStageError);
    expect((caught as PipelineStageError).code).toBe("EXP_INVALID");
  });

  it("resolves slightly-off hallucinated paths instead of failing (FastAPI docs case)", async () => {
    // Model hallucinates an extra `en/` folder prefix that does not exist.
    const hallucinated = {
      ...VALID_BRIEF_JSON,
      components: [
        { id: "api", name: "API", path: "docs/en/docs/tutorial/response-model.md", responsibility: "x", shape: "box" },
        { id: "run", name: "Core", path: "src/index.ts", responsibility: "Core logic", shape: "box" },
      ],
    };
    const cb = noopCallbacks();
    const brief = await runExplainPass({
      provider: makeBriefProvider(hallucinated),
      explanationModel: "m",
      meta: META,
      digest: DIGEST,
      validPaths: new Set(["docs/tutorial/response-model.md", "src/index.ts"]),
      cb,
    });
    const api = brief.components.find((c) => c.id === "api");
    expect(api?.path).toBe("docs/tutorial/response-model.md");
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it("nulls paths with no unambiguous real match (still passes if another path resolves)", async () => {
    const brief = {
      ...VALID_BRIEF_JSON,
      components: [
        { id: "api", name: "API", path: "totally/unknown/thing.md", responsibility: "x", shape: "box" },
        { id: "run", name: "Core", path: "src/index.ts", responsibility: "Core logic", shape: "box" },
      ],
    };
    await expect(
      runExplainPass({
        provider: makeBriefProvider(brief),
        explanationModel: "m",
        meta: META,
        digest: DIGEST,
        validPaths: new Set(["src/index.ts"]),
        cb: noopCallbacks(),
      })
    ).resolves.toBeTruthy();
  });

  it("succeeds on repair when the first attempt is schema-invalid", async () => {
    // Provider that returns a schema-invalid brief then a valid one.
    let calls = 0;
    const provider = {
      name: "ollama",
      streamCompletion: async function* () {
        calls += 1;
        if (calls === 1) {
          yield JSON.stringify({ purpose: "", components: [] }); // invalid: empty purpose + no components
        } else {
          yield JSON.stringify(VALID_BRIEF_JSON);
        }
      },
      complete: async () => "",
    } as unknown as AIProvider;
    const brief = await runExplainPass({
      provider,
      explanationModel: "m",
      meta: META,
      digest: DIGEST,
      validPaths: emptyValidPaths(),
      cb: noopCallbacks(),
    });
    expect(brief.components).toHaveLength(2);
    expect(calls).toBe(2);
  });
});

describe("runGraphPass", () => {
  it("returns a graph when the first attempt is valid", async () => {
    const validPaths = new Set(["app/api/route.ts", "src/index.ts"]);
    const graph = await runGraphPass({
      provider: makeGraphProvider(VALID_GRAPH_JSON),
      diagramModel: "m",
      brief: JSON.parse(JSON.stringify(VALID_BRIEF_JSON)),
      validPaths,
    });
    expect(graph.nodes).toHaveLength(2);
  });

  it("throws GRAPH_INVALID when the graph is structurally invalid after 3 attempts", async () => {
    const provider = makeGraphProvider({ groups: [], nodes: [], edges: [] });
    let attempts = 0;
    await expect(
      runGraphPass({
        provider,
        diagramModel: "m",
        brief: JSON.parse(JSON.stringify(VALID_BRIEF_JSON)),
        validPaths: emptyValidPaths(),
        onAttempt: () => {
          attempts += 1;
        },
      })
    ).rejects.toThrow(PipelineStageError);
    expect(attempts).toBe(3);
  });

  it("strips unknown paths without re-prompting when that is the only issue", async () => {
    const graphWithUnknownPath = {
      ...VALID_GRAPH_JSON,
      nodes: [
        { id: "api", label: "API", description: "", shape: "box", groupId: "g1", path: "DOES_NOT_EXIST.ts" },
        { id: "run", label: "Core", description: "", shape: "box", groupId: "g1", path: "src/index.ts" },
      ],
    };
    const provider = makeGraphProvider(graphWithUnknownPath);
    const validPaths = new Set(["src/index.ts"]);
    let maxAttempt = 0;
    const graph = await runGraphPass({
      provider,
      diagramModel: "m",
      brief: JSON.parse(JSON.stringify(VALID_BRIEF_JSON)),
      validPaths,
      onAttempt: (n) => {
        maxAttempt = Math.max(maxAttempt, n);
      },
    });
    const api = graph.nodes.find((n) => n.id === "api");
    expect(api?.path).toBeNull();
    expect(maxAttempt).toBe(1);
  });
});

describe("parsePipelineError", () => {
  it("maps PipelineStageError to its code and 502", () => {
    const err = new PipelineStageError("GRAPH_INVALID", ["bad node"]);
    const mapped = parsePipelineError(err);
    expect(mapped.code).toBe("GRAPH_INVALID");
    expect(mapped.status).toBe(502);
  });

  it("returns a generic INTERNAL fallback for unknown errors", () => {
    const mapped = parsePipelineError(new Error("boom"));
    expect(mapped.code).toBe("INTERNAL");
  });
});
