import { createAIProvider } from "../src/server/ai";
import { getAIProviderConfig } from "../src/server/storage/config";
import { explainSystemPrompt } from "../src/server/prompts";
import { extractFirstJsonObject } from "../src/server/json-extract";

const cfg = getAIProviderConfig();
const provider = createAIProvider();
console.log("PROVIDER:", provider.name, "MODEL:", cfg.model);

const sys = explainSystemPrompt();
console.log("\n=== SYSTEM PROMPT (first 800) ===\n" + sys.slice(0, 800));
console.log("\nsys prompt length:", sys.length);

const messages = [
  { role: "system" as const, content: sys },
  { role: "user" as const, content: "Describe the architecture of a tiny two-file TypeScript REST server: index.ts boots an express app, and routes.ts defines /ping and /health. File tree: index.ts, routes.ts, package.json, README.md." },
];

const t0 = Date.now();
let raw = "";
try {
  for await (const delta of provider.streamCompletion({ model: cfg.model, messages, temperature: 0.3 })) {
    raw += delta;
  }
} catch (e) {
  raw = "STREAMERROR: " + (e as Error).message;
}
console.log("\n=== RAW LEN:", raw.length, "in", Date.now() - t0, "ms ===");
console.log("HEAD 1200:\n" + raw.slice(0, 1200));
console.log("\nTAIL 500:\n" + raw.slice(-500));
const obj = extractFirstJsonObject(raw);
console.log("\nextractFirstJsonObject ->", obj ? `FOUND (len ${obj.length})` : "NULL");
if (obj) {
  try { const p = JSON.parse(obj); console.log("parse OK, keys:", Object.keys(p).join(",")); }
  catch (e) { console.log("parse FAIL:", (e as Error).message); }
}
