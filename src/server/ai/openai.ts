import OpenAI from "openai";
import type { AIProvider } from "./provider";
import { AIProviderError } from "./provider";
import type { AIProviderConfig } from "../storage/config";

interface Chunk {
  choices?: { delta?: { content?: string | null } }[];
}

export function createOpenAIProvider(
  config: AIProviderConfig,
  name: "openai" | "openrouter" | "ollama" = config.provider
): AIProvider {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });

  async function* stream(params: {
    model: string;
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncIterable<string> {
    let stream;
    try {
      stream = await client.chat.completions.create(
        {
          model: params.model,
          messages: params.messages,
          stream: true,
          temperature: params.temperature ?? 0.4,
          ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
        },
        { signal: params.signal }
      );
    } catch (err) {
      throw aiError(name, err);
    }
    for await (const chunk of stream as AsyncIterable<Chunk>) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async function complete(params: {
    model: string;
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    try {
      const res = await client.chat.completions.create(
        {
          model: params.model,
          messages: params.messages,
          temperature: params.temperature ?? 0.4,
          ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
        },
        { signal: params.signal }
      );
      return res.choices[0]?.message?.content ?? "";
    } catch (err) {
      throw aiError(name, err);
    }
  }

  return { name, streamCompletion: stream, complete };
}

function aiError(providerName: string, err: unknown): AIProviderError {
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === "AbortError") {
    return new AIProviderError(`${providerName} request aborted`, "AI_ABORTED");
  }
  if (status === 401 || status === 403) {
    return new AIProviderError(`${providerName}: invalid credentials`, "AI_AUTH");
  }
  if (status === 429) {
    return new AIProviderError(`${providerName}: rate limited`, "AI_RATE_LIMITED");
  }
  return new AIProviderError(`${providerName}: ${message.slice(0, 500)}`);
}
