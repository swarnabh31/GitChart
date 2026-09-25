"use client";

import * as React from "react";
import { GitBranch, Link2, Loader2, Sparkles, KeyRound, AlertTriangle, Check, X } from "lucide-react";
import { generateDiagram, fetchModels, resolveRepo, track, type ModelInfo } from "../lib/client";
import { parseRepoUrlLocal, type DiagramResult } from "../lib/types";
import { DiagramViewer, type RepoMeta } from "../components/DiagramViewer";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "streaming"; explanation: string }
    | { kind: "ready"; diagram: DiagramResult; meta?: RepoMeta }
    | { kind: "error"; message: string; retryable: boolean };

const EXAMPLES = ["vercel/next.js", "react/react", "oven-sh/bun"];

export default function Home() {
  const [url, setUrl] = React.useState("");
  const [token, setToken] = React.useState("");
  const [showToken, setShowToken] = React.useState(false);
  const [state, setState] = React.useState<State>({ kind: "idle" });
  const abortRef = React.useRef<AbortController | null>(null);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<ModelInfo[]>([]);
  const [ollamaAvailable, setOllamaAvailable] = React.useState<boolean | null>(null);
  const [selectedModel, setSelectedModel] = React.useState<string>("");
  const lastInputRef = React.useRef<{ url: string; token: string; model: string } | null>(null);
  type ProgressStep = { label: string; detail?: string };
  const [progress, setProgress] = React.useState<{ steps: ProgressStep[]; startedAt: number } | null>(null);
  const [now, setNow] = React.useState(0);

  React.useEffect(() => {
    track("page_view", { page: "home" });
    void fetchModels().then(({ models: list, available }) => {
      setOllamaAvailable(available);
      setModels(list);
      if (list.length > 0) setSelectedModel((prev) => prev || list[0].id);
    });
  }, []);

  const run = async (urlValue: string, tokenValue: string, modelValue: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "submitting" });
    const startedAt = Date.now();
    setProgress({ steps: [], startedAt });
    const result = await generateDiagram({
      repoUrl: urlValue,
      githubToken: tokenValue || undefined,
      model: modelValue || undefined,
      signal: controller.signal,
      onPhaseProgress: (label, detail) =>
        setProgress((p) => (p ? { ...p, steps: [...p.steps, { label, detail }] } : { steps: [{ label, detail }], startedAt })),
      onExplanationDelta: (_delta, total) => setState({ kind: "streaming", explanation: total }),
    });
    setProgress(null);
    if (result.cancelled) {
      setState({ kind: "idle" });
      return;
    }
    if (result.diagram) {
      track("diagram_completed", { repo: `${result.diagram.owner}/${result.diagram.repo}`, cached: result.diagram.cached });
      const meta = await resolveRepo(urlValue, tokenValue || undefined);
      const viewerMeta: RepoMeta | undefined = "repo" in meta
        ? {
            description: meta.repo.description || undefined,
            language: meta.repo.language || undefined,
            stars: meta.repo.stars,
            forks: meta.repo.forks,
            isPrivate: meta.repo.private,
          }
        : undefined;
      setState({ kind: "ready", diagram: result.diagram, meta: viewerMeta });
    } else if (result.error) {
      const retryable = ["GITHUB_RATE_LIMITED", "AI_RATE_LIMITED", "AI_ERROR", "GITHUB_UPSTREAM_ERROR", "NETWORK"].includes(result.error.code);
      setState({ kind: "error", message: result.error.message, retryable });
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseRepoUrlLocal(url);
    if ("error" in parsed) {
      setFieldError(parsed.error);
      return;
    }
    setFieldError(null);
    abortRef.current?.abort();
    lastInputRef.current = { url: url.trim(), token, model: selectedModel };
    void run(url.trim(), token, selectedModel);
  };

  const regenerate = () => {
    const input = lastInputRef.current;
    if (!input) {
      setState({ kind: "idle" });
      return;
    }
    abortRef.current?.abort();
    void run(input.url, input.token, input.model);
  };

  const busy = state.kind === "submitting" || state.kind === "streaming";

  React.useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  if (state.kind === "ready") {
    return (
      <main className="gd-container">
        <div className="mb-4 flex items-center justify-between gap-2">
          <a href="/" className="text-sm text-ink-mut hover:text-ink inline-flex items-center gap-1">
            <GitBranch className="w-4 h-4" /> Generate another
          </a>
        </div>
        <DiagramViewer diagram={state.diagram} meta={state.meta} onRegenerate={regenerate} />
      </main>
    );
  }

  const elapsed = progress
    ? Math.max(0, Math.floor(((now > progress.startedAt ? now : progress.startedAt) - progress.startedAt) / 1000))
    : 0;
  const fmtElapsed = (s: number) =>
    s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <main className="gd-container">
      <section className="max-w-xl mx-auto text-center">
        <div className="mx-auto mb-5 w-11 h-11 rounded-xl bg-accent-soft flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-accent" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Turn a GitHub repo into a live architecture diagram
        </h1>
        <p className="mt-3 text-ink-mut leading-relaxed">
          Paste a repository URL. You get a Mermaid diagram of its key components, a
          streamed explanation of how they talk to each other.
        </p>
      </section>

      <form onSubmit={submit} className="max-w-xl mx-auto mt-8 space-y-3" noValidate>
        <div>
          <label htmlFor="repo" className="gd-label">
            GitHub repository
          </label>
          <div className="relative">
            <Link2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-mut pointer-events-none" />
            <input
              id="repo"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://github.com/vercel/next.js"
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              className="gd-input pl-9"
              required
            />
          </div>
        </div>

        {fieldError && (
          <p className="text-xs text-err inline-flex items-center gap-1" role="alert">
            <AlertTriangle className="w-3.5 h-3.5" /> {fieldError}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={busy}
              onClick={() => setUrl(`https://github.com/${ex}`)}
              className="text-xs px-2.5 py-1 rounded-md border border-line text-ink-mut hover:text-ink hover:bg-surface-2 disabled:opacity-60"
            >
              {ex}
            </button>
          ))}
        </div>

        {ollamaAvailable !== null && ollamaAvailable && models.length > 0 && (
          <div>
            <label htmlFor="model" className="gd-label">
              Local model (Ollama)
            </label>
            <select
              id="model"
              value={selectedModel}
              disabled={busy}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="gd-input"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}{m.parameter_size ? ` (${m.parameter_size})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <button
              type="button"
              onClick={() => setShowToken((s) => !s)}
              className="gd-label inline-flex items-center gap-1.5"
              aria-expanded={showToken}
            >
              <KeyRound className="w-3.5 h-3.5" />
              Private repo? Add a GitHub token (optional)
            </button>
          </div>
          {showToken && (
            <input
              type="password"
              autoComplete="off"
              placeholder="ghp_… or github_pat_…"
              value={token}
              disabled={busy}
              onChange={(e) => setToken(e.target.value)}
              className="gd-input"
            />
          )}
        </div>

        <button type="submit" disabled={busy} className="gd-btn primary w-full justify-center py-2.5">
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {busy ? "Generating…" : "Generate diagram"}
        </button>
        <p className="text-xs text-ink-mut text-center">
          Your token is only used to read this repo and never stored.
        </p>
      </form>

      {busy && progress && (
        <div className="max-w-xl mx-auto mt-6 gd-card">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              {state.kind === "streaming" ? "Streaming the explanation…" : "Working on your diagram…"}
            </div>
            <span className="text-xs font-mono text-ink-mut tabular-nums" aria-live="off">
              {fmtElapsed(elapsed)}
            </span>
          </div>
          <ol className="space-y-2.5 mb-3" aria-live="polite">
            {(() => {
              const steps =
                state.kind === "streaming"
                  ? [...progress.steps, { label: "Writing the explanation", detail: undefined }]
                  : progress.steps;
              return steps.map((step, i) => {
                const active = i === steps.length - 1;
                const done = !active;
                return (
                  <li key={`${step.label}-${i}`} className="flex items-start gap-2.5 text-sm">
                    {done ? (
                      <Check className="w-4 h-4 text-ok mt-0.5 shrink-0" />
                    ) : (
                      <span className="w-4 h-4 mt-0.5 shrink-0 rounded-full border border-accent grid place-items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                      </span>
                    )}
                    <span className={done ? "text-ink-mut" : "text-ink"}>
                      {step.label}
                      {step.detail && !active && (
                        <span className="block text-xs text-ink-mut opacity-80">{step.detail}</span>
                      )}
                    </span>
                  </li>
                );
              });
            })()}
          </ol>
          {state.kind === "streaming" && state.explanation && (
            <div className="gd-explanation max-h-48" aria-live="polite">
              {state.explanation}
            </div>
          )}
          <div className="text-xs text-ink-mut bg-surface-2 rounded-md px-3 py-2 leading-relaxed">
            Local models can take several minutes on large repos — they read the whole
            digest before writing the first token. You can leave this tab open.
          </div>
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="mt-3 gd-btn ghost text-xs inline-flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </div>
      )}

      {state.kind === "error" && (
        <div className="max-w-xl mx-auto mt-6" role="alert">
          <div className="gd-card border-err/40">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-err mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">{state.message}</p>
                {state.retryable && (
                  <button
                    type="button"
                    onClick={() => setState({ kind: "idle" })}
                    className="mt-2 gd-btn text-xs"
                  >
                    <Check className="w-3.5 h-3.5" /> Try again
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="max-w-xl mx-auto mt-12 grid sm:grid-cols-3 gap-3">
        {[
          { t: "Mermaid output", d: "A flowchart of 5–12 architectural components." },
          { t: "Jump to code", d: "Each node links to the file that backs it." },
          { t: "PNG & source", d: "Export a crisp PNG or copy the raw Mermaid." },
        ].map((f) => (
          <div key={f.t} className="gd-card text-sm">
            <div className="font-medium mb-1">{f.t}</div>
            <div className="text-ink-mut leading-relaxed">{f.d}</div>
          </div>
        ))}
      </section>
    </main>
  );
}
