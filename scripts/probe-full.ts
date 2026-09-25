import { createGitHubClient } from "../src/server/github";
import { buildRepoDigest } from "../src/server/digest-flow";
import { resolveDigestBudget } from "../src/server/digest";
import { createAIProvider } from "../src/server/ai";
import { getAIProviderConfig, getGitHubConfig } from "../src/server/storage/config";
import { buildValidPaths } from "../src/server/pipeline";
import { runExplainPass } from "../src/server/pipeline-explain";
import { runGraphPass } from "../src/server/pipeline-graph";
import { graphToMermaid } from "../src/server/emitter";
import { validateMermaid } from "../src/server/mermaid-validate";

const cfg = getAIProviderConfig();
const provider = createAIProvider();
const client = createGitHubClient({ config: getGitHubConfig() });

const meta = await client.getRepoMetadata("preactjs", "preact");
const tree = await client.getTree("preactjs", "preact", meta.default_branch);
const digest = await buildRepoDigest(client, meta, tree, resolveDigestBudget(cfg.model));
client?.close?.();
const validPaths = buildValidPaths(digest);
console.log("validPaths:", validPaths.size);

const t0 = Date.now();
try {
  const brief = await runExplainPass({
    provider,
    explanationModel: cfg.model,
    meta, digest, validPaths,
    signal: new AbortController().signal,
    cb: { onDone: () => {}, onError: () => {} },
  });
  const t1 = Date.now();
  console.log("PASS1 OK: components", brief.components.length, "relationships", brief.relationships.length, "in", (t1 - t0) / 1000, "s");

  const graph = await runGraphPass({
    provider,
    diagramModel: cfg.model,
    brief, validPaths,
    signal: new AbortController().signal,
  });
  const t2 = Date.now();
  console.log("PASS2 OK: groups", graph.groups.length, "nodes", graph.nodes.length, "edges", graph.edges.length, "in", (t2 - t1) / 1000, "s");

  const mermaid = graphToMermaid(graph);
  const check = validateMermaid(mermaid);
  console.log("mermaid bytes:", mermaid.length, "validate:", check.ok ? "OK" : `FAIL: ${check.errors.join("; ")}`);
  console.log("TOTAL:", (t2 - t0) / 1000, "s");
  console.log("\n--- MERMAID (first 1500 chars) ---\n" + mermaid.slice(0, 1500));
} catch (e) {
  console.log("FAIL after", (Date.now() - t0) / 1000, "s:", (e as Error).message);
}
