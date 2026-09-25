import { createGitHubClient } from "../src/server/github";
import { buildRepoDigest } from "../src/server/digest-flow";
import { resolveDigestBudget } from "../src/server/digest";
import { createAIProvider } from "../src/server/ai";
import { getAIProviderConfig, getGitHubConfig } from "../src/server/storage/config";
import { runExplainPass } from "../src/server/pipeline-explain";
import { buildValidPaths } from "../src/server/pipeline";
import { writeFileSync, appendFileSync } from "node:fs";

const cfg = getAIProviderConfig();
const provider = createAIProvider();
const client = createGitHubClient({ config: getGitHubConfig() });

const meta = await client.getRepoMetadata("preactjs", "preact");
const tree = await client.getTree("preactjs", "preact", meta.default_branch);
const digest = await buildRepoDigest(client, meta, tree, resolveDigestBudget(cfg.model));
client?.close?.();

const validPaths = buildValidPaths(digest);
const debug = { buf: "" };
const t0 = Date.now();
try {
  const brief = await runExplainPass({
    provider,
    explanationModel: cfg.model,
    meta,
    digest,
    validPaths,
    signal: new AbortController().signal,
    cb: {
      onDebugChunk: (d) => { debug.buf += d; },
      onDone: () => {},
      onError: (e) => console.log("onError:", e.message),
    },
  });
  console.log("OK components:", brief.components.length, "in", (Date.now() - t0) / 1000, "s");
  console.log("total streamed bytes (both attempts if any):", debug.buf.length);
} catch (e) {
  console.log("FAIL after", (Date.now() - t0) / 1000, "s:", (e as Error).message);
  console.log("streamed bytes:", debug.buf.length);
  const tail = debug.buf.slice(-500);
  console.log("TAIL:\n" + tail);
  const hasJson = debug.buf.includes('"components"');
  console.log('contains "components":', hasJson);
  const head = debug.buf.slice(0, 300);
  console.log("HEAD:\n" + head);
  appendFileSync(process.env.TEMP! + "\\explain-raw.txt", debug.buf, { encoding: "utf8" });
  console.log("raw saved to TEMP\\explain-raw.txt");
}
