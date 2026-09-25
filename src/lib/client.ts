import type { DiagramResult } from "./types";

export type ClientPhase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "explanation"; text: string }
  | { kind: "ready"; diagram: DiagramResult }
  | { kind: "error"; code: string; message: string; retryAfter?: number };

export interface GenerateArgs {
  repoUrl: string;
  githubToken?: string;
  model?: string;
  signal?: AbortSignal;
  onPhase?: (phase: ClientPhase) => void;
  onPhaseProgress?: (label: string, detail?: string) => void;
  onExplanationDelta?: (delta: string, total: string) => void;
}

export type NetworkError = { code: string; message: string; retryAfter?: number };

export async function generateDiagram(
  args: GenerateArgs
): Promise<{ diagram?: DiagramResult; error?: NetworkError; cancelled?: boolean }> {
  args.onPhase?.({ kind: "submitting" });

  let res: Response;
  try {
    res = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo_url: args.repoUrl,
        github_token: args.githubToken || undefined,
        model: args.model || undefined,
      }),
      signal: args.signal,
    });
  } catch (err) {
    if (args.signal?.aborted) {
      return { cancelled: true };
    }
    const message = err instanceof Error ? err.message : "Network error";
    args.onPhase?.({ kind: "error", code: "NETWORK", message });
    return { error: { code: "NETWORK", message } };
  }

  if (!res.ok) {
    const retryHeader = res.headers.get("retry-after");
    const retryAfter = retryHeader ? Number(retryHeader) : undefined;
    let code = "HTTP";
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // body was not JSON
    }
    if (res.status === 429) {
      message =
        typeof retryAfter === "number"
          ? `Too many requests. Retry in ~${retryAfter}s.`
          : "Too many requests.";
    }
    args.onPhase?.({ kind: "error", code, message, retryAfter });
    return { error: { code, message, retryAfter } };
  }

  if (!res.body) {
    args.onPhase?.({ kind: "error", code: "NO_BODY", message: "Server sent no stream body." });
    return { error: { code: "NO_BODY", message: "Server sent no stream body." } };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let explanationText = "";
  let diagram: DiagramResult | undefined;
  let sawError: NetworkError | null = null;

  while (true) {
    if (args.signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        // stream already gone
      }
      return { cancelled: true };
    }
    let done = false;
    let chunk: Uint8Array | undefined;
    try {
      const next = await reader.read();
      done = next.done;
      chunk = next.value;
    } catch {
      if (args.signal?.aborted) {
        return { cancelled: true };
      }
      args.onPhase?.({ kind: "error", code: "STREAM", message: "Connection dropped mid-stream." });
      return { error: { code: "STREAM", message: "Connection dropped mid-stream." } };
    }
    if (done) break;
    buf += decoder.decode(chunk as Uint8Array, { stream: true });

    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const lines = frame.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];
      for (const raw of lines) {
        if (raw.startsWith("event:")) {
          eventName = raw.slice(6).trim();
        } else if (raw.startsWith("data:")) {
          dataLines.push(raw.slice(5).trim());
        }
      }
      if (dataLines.length === 0) continue;
      const payloadText = dataLines.join("\n");
      let payload: unknown;
      try {
        payload = JSON.parse(payloadText);
      } catch {
        continue;
      }

      if (eventName === "phase") {
        const p = payload as { label?: string; detail?: string };
        if (typeof p.label === "string") {
          args.onPhaseProgress?.(p.label, typeof p.detail === "string" ? p.detail : undefined);
        }
      } else if (eventName === "explanation_chunk") {
        const p = payload as { delta?: string };
        if (typeof p.delta === "string") {
          explanationText += p.delta;
          args.onExplanationDelta?.(p.delta, explanationText);
          args.onPhase?.({ kind: "explanation", text: explanationText });
        }
      } else if (eventName === "diagram_ready") {
        diagram = payload as DiagramResult;
        args.onPhase?.({ kind: "ready", diagram });
      } else if (eventName === "error") {
        const p = payload as { code?: string; message?: string };
        sawError = {
          code: p?.code ?? "ERROR",
          message: p?.message ?? "Unknown error",
        };
      }
    }
  }

  if (sawError) {
    args.onPhase?.({ kind: "error", ...sawError });
    return { error: sawError };
  }

  if (!diagram) {
    args.onPhase?.({
      kind: "error",
      code: "NO_DIAGRAM",
      message: "Stream ended without a diagram.",
    });
    return { error: { code: "NO_DIAGRAM", message: "Stream ended without a diagram." } };
  }
  return { diagram };
}

export async function loadCachedDiagram(
  owner: string,
  repo: string
): Promise<DiagramResult | null> {
  try {
    const res = await fetch(
      `/api/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/diagram`
    );
    if (!res.ok) return null;
    const body = (await res.json()) as DiagramResult;
    return body;
  } catch {
    return null;
  }
}

export type ModelInfo = {
  id: string;
  family?: string;
  parameter_size?: string;
  quantization_level?: string;
  size?: number;
};

export async function fetchModels(): Promise<{ models: ModelInfo[]; available: boolean }> {
  try {
    const res = await fetch("/api/models");
    if (!res.ok) return { models: [], available: false };
    return (await res.json()) as { models: ModelInfo[]; available: boolean };
  } catch {
    return { models: [], available: false };
  }
}

export type ResolvedRepo = {
  owner: string;
  repo: string;
  default_branch: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  private: boolean;
  html_url: string;
};

export async function resolveRepo(
  repoUrl: string,
  token?: string
): Promise<{ repo: ResolvedRepo } | { error: NetworkError }> {
  let res: Response;
  try {
    res = await fetch("/api/repo/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo_url: repoUrl, github_token: token || undefined }),
    });
  } catch {
    return { error: { code: "NETWORK", message: "Network error resolving repo." } };
  }
  if (!res.ok) {
    let code = "HTTP";
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // ignore
    }
    return { error: { code, message } };
  }
  const data = (await res.json()) as ResolvedRepo;
  return { repo: data };
}

export async function uploadPng(
  id: string,
  owner: string,
  repo: string,
  png: Blob
): Promise<{ url: string } | { error: NetworkError }> {
  try {
    const url = `/api/artifacts/${encodeURIComponent(id)}/png?owner=${encodeURIComponent(
      owner
    )}&repo=${encodeURIComponent(repo)}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: png,
    });
    if (!res.ok) {
      let code = "HTTP";
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        if (body?.error?.code) code = body.error.code;
        if (body?.error?.message) message = body.error.message;
      } catch {
        // ignore
      }
      return { error: { code, message } };
    }
    const body = (await res.json()) as { url: string };
    return { url: body.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { error: { code: "NETWORK", message } };
  }
}

export function distinctId(): string {
  if (typeof window === "undefined") return "anon";
  const existing = window.localStorage.getItem("gd_id");
  if (existing) return existing;
  const value = `anon_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  window.localStorage.setItem("gd_id", value);
  return value;
}

export function track(event: string, properties: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const di = distinctId();
  void fetch("/phx9a/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, distinct_id: di, properties }),
  }).catch(() => {
    // fire and forget
  });
}
