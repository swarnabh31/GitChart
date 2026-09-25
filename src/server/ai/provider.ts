export interface AIProvider {
  readonly name: "openai" | "openrouter" | "ollama";
  streamCompletion(params: {
    model: string;
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncIterable<string>;
  complete(params: {
    model: string;
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<string>;
}

export class AIProviderError extends Error {
  code: string;
  constructor(message: string, code = "AI_PROVIDER_ERROR") {
    super(message);
    this.code = code;
  }
}
