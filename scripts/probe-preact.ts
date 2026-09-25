import { createGitHubClient } from "../src/server/github";
import { buildRepoDigest } from "../src/server/digest-flow";
import { resolveDigestBudget } from "../src/server/digest";
import { createAIProvider } from "../src/server/ai";
import { getAIProviderConfig, getGitHubConfig } from "../src/server/storage/config";
import { explainSystemPrompt, explainUserPrompt } from "../src/server/prompts";
import { extractFirstJsonObject } from "../src/server/json-extract";

const cfg = getAIProviderConfig();
const provider = createAIProvider();
const client = createGitHubClient({ config: getGitHubConfig() });

const meta = await client.getRepoMetadata("preactjs", "preact");
const tree = await client.getTree("preactjs", "preact", meta.default_branch);
const digest = await buildRepoDigest(client, meta, tree, resolveDigestBudget(cfg.model));
client?.close?.();

console.log("digest files:", digest.files.length, " tree lines:", digest.tree.split("\n").length);
const user = explainUserPrompt(digest);
console.log("user prompt bytes:", user.length, " system prompt bytes:", explainSystemPrompt().length);

const messages = [
  { role: "system" as const, content: explainSystemPrompt() },
  { role: "user" as const, content: user },
];

let raw = "";
const t0 = Date.now();
try {
  for await (const d of provider.streamCompletion({ model: cfg.model, messages, temperature: 0.3 })) raw += d;
} catch (e) {
  raw += "\n[STREAM ERROR: " + (e as Error).message + "]";
}
console.log("\nRAW LEN:", raw.length, "in", (Date.now() - t0) / 1000, "s");
console.log("\n--- TAIL 400 ---\n" + raw.slice(-400));
const obj = extractFirstJsonObject(raw);
console.log("\nextract:", obj ? `FOUND len ${obj.length}` : "NULL");
if (obj) {
  try {
    const p = JSON.parse(obj);
    console.log("parse OK. components:", p.components?.length, " relationships:", p.relationships?.length);
    console.log("purpose:", p.purpose);
  } catch (e) {
    console.log("PARSE FAIL:", (e as Error).message.slice(0, 200));
  }
}
