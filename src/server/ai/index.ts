import { createOpenAIProvider } from "./openai";
import type { AIProvider } from "./provider";
import { getAIProviderConfig } from "../storage/config";

export * from "./provider";
export { createOpenAIProvider } from "./openai";

export function createAIProvider(
  env: NodeJS.ProcessEnv = process.env
): AIProvider {
  const config = getAIProviderConfig(env);
  return createOpenAIProvider(config, config.provider);
}
