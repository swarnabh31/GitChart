# GitChart

Turn any GitHub repository URL into an AI-generated architecture diagram — in seconds, with no signup.

Paste a repo URL → an AI pipeline reads the codebase and produces a Mermaid architecture diagram and a plain-language explanation of how the components talk to each other.

## Mission & Objective

**Mission:** make onboarding to unfamiliar codebases fast. Reading a new GitHub repo (public or private) today means manually mapping files, modules, and data flows before you can understand or contribute. GitChart collapses that to a single URL.

**Objective (success metric):** a developer can go from "what is this repo?" to "here is where X lives" in under a minute of reading.

### What it does
1. **Repository input** — accepts any `https://github.com/owner/repo` URL (trailing `/tree/...` paths are tolerated and stripped).
2. **AI codebase analysis** — the server builds a size-capped digest (file tree + key file excerpts), sends it to an AI model, and receives a valid Mermaid `graph TD` diagram plus per-component summaries. The Mermaid output is statically validated before it's accepted.
3. **Streamed explanation** — the explanation streams to the browser (SSE) while the diagram is being generated, so you see understanding build up in real time.
4. **Portable export** — download a crisp PNG, copy the raw Mermaid, or download a `.mmd` file — for embedding in docs, PRs, or ADRs.
6. **Smart caching** — successful results are cached in Redis (default 24h TTL). Revisiting the same repo returns the cached diagram with no new AI cost; a "Regenerate" button forces a fresh run.

### Target users
- Developers onboarding to unfamiliar repos (internships, OSS contributions, hiring screens).
- Tech leads reviewing external or private repos.

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Diagram engine | Mermaid.js 12 (rendered client-side, sanitized with DOMPurify) |
| AI providers | OpenAI, OpenRouter, or Ollama (local) — switched via `AI_PROVIDER` |
| Cache / rate limiting | Upstash Redis |
| Artifact storage | Cloudflare R2 (PNG exports) |
| Analytics | PostHog (optional) |
| Package manager | Bun |

## Architecture (high level)

```
Browser (React UI)
  ├─ POST /api/generate      → SSE stream: explanation_chunk* → diagram_ready
  ├─ PUT  /api/artifacts/:id/png  → upload client-rendered PNG to R2
  └─ POST /phx9a/capture     → PostHog proxy (analytics)

Server (route handlers)
  validate URL → rate limit (Redis) → resolve repo (GitHub API)
  → build digest → AI call (streamed) → validate Mermaid → cache in Redis
```

Stateless server — all hot state lives in Redis (diagrams, rate limits) and R2 (PNG artifacts). Scales horizontally by adding containers.

## How to Use the Application

### 1. Run it locally

Requires [Bun](https://bun.sh) 1.x and Node v24.

```bash
bun install
cp .env.example .env    # then fill in the values you need
bun run dev             # or: bun run dev:win (Windows)
```

Open http://localhost:3000.

Other scripts:

```bash
bun run build        # production build
bun run start        # serve the production build
bun run typecheck    # tsc --noEmit
bun run test         # vitest
bun run lint         # eslint
```

### 2. Configure (`.env`)

Copy `.env.example` to `.env`. What you need depends on which AI provider you use:

| You want | Minimum env vars |
|---|---|
| **Ollama (fully local, free)** | `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, + Redis & R2 values below |
| **OpenAI** | `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`, + Redis & R2 values below |
| **OpenRouter** | `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, + Redis & R2 values below |

"Redis & R2 values" = `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BASE_URL`.

GitHub tokens for the *server's own* GitHub API quota (`GITHUB_PAT`) are optional but strongly recommended to avoid secondary-rate-limiting; a per-request user token is all that's needed for private repos.

### 3. Generate a diagram

1. Go to http://localhost:3000.
2. Paste a repository URL (or click one of the examples: `vercel/next.js`, `react/react`, `oven-sh/bun`).
3. *(Private repo only)* expand **"Private repo? Add a GitHub token"** and paste a PAT (`ghp_…`). The token is used only for that request and is never stored.
4. *(Optional, Ollama only)* pick a local model from the **Local model** dropdown — the list is fetched live from your Ollama server.
5. Hit **Generate diagram**. The explanation streams in under the form; when the diagram is ready it renders inline with:
   - **Repo card** — description, language, stars, forks (best-effort).
    - **Mermaid diagram** — rendered client-side and sanitized with DOMPurify.
   - **Component list** — each component's summary with a link to its file.
   - **Export toolbar** — *Download PNG*, *Copy Mermaid*, *Download .mmd*, *Regenerate*.
6. **Generate another** (top-left of the result view) takes you back to the form.

### 4. API (if you want to script it)

| Route | Method | Purpose |
|---|---|---|
| `/api/generate` | POST | Full generation pipeline. SSE stream: `explanation_chunk` → `diagram_ready` (or `error`). |
| `/api/repo/resolve` | POST | Resolve repo metadata (name, branch, stars, …). |
| `/api/repo/[owner]/[repo]/diagram` | GET | Fetch a cached diagram by owner/repo. |
| `/api/artifacts/[id]/png` | PUT | Upload a client-rendered PNG (≤ 8MB) to R2; returns a stable share URL. |
| `/phx9a/capture` | POST | PostHog analytics proxy. |

Errors are structured: `{ "error": { "code", "message" } }` with `422` (invalid input), `404` (repo/diagram missing), `403` (private/invalid token), `429` (rate limited, with `Retry-After`).

## Limitations & Known Issues

### Product limitations (by design, v1)
- **GitHub only** — no GitLab, Bitbucket, or self-hosted Git servers.
- **Public repos only without a token** — private repos require a per-request PAT.
- **No accounts or saved collections** — diagrams are cached server-side (24h) but not tied to users; there is no dashboard or history page.
- **Single-repo scope** — no monorepo sub-scoping, no multi-repo diff views.
- **Diagram depth** — the AI is asked for 5–12 architectural components; very large or very complex codebases get an overview-level diagram, not an exhaustive one.
- **AI accuracy is not guaranteed** — component summaries are AI-generated; always verify via the file links in the component list.
- **Client-side PNG export** — PNGs are rendered in the browser (no server-side rasterizer), so quality depends on your browser.
- **No i18n** — the UI ships in English only.

### Runtime / environment
- **Live backends required for full functionality** — Redis (cache + rate limiting) and R2 (PNG upload) must be reachable; generation itself works if the AI provider is up, but PNG uploads and cache hits need real storage.
- **Rate limits apply** — per-IP generation is limited (default 10 / hour via `GENERATION_RATE_LIMIT_*`), plus GitHub API secondary rate limits if the server runs without a `GITHUB_PAT`.
- **Ollama provider is experimental** — small/local models may produce weaker diagrams or occasionally invalid Mermaid (the validator rejects those; retry with a bigger model).
- **Caching caveat** — a cached diagram reflects the repo state at first generation; use *Regenerate* to refresh after code changes.

### Current build status
- ✅ Compiles clean: `tsc --noEmit` and `next build` both pass.
- ✅ All 5 API routes + landing page implemented.
- ⏳ Unit tests (Vitest) and ESLint flat config are scaffolded as scripts but test/lint coverage is still pending.
- ⏳ Dockerfile for the `output: "standalone"` build is planned but not yet committed.
- ⏳ Full runtime verification against live OpenAI/Redis/R2 credentials was the step in progress when testing paused.

## Project Layout

```
src/
  app/                  # Next.js App Router
    page.tsx            # landing: URL input, token, model picker, streaming UI
    api/generate/       # POST — SSE generation pipeline
    api/repo/           # POST /resolve, GET /[owner]/[repo]/diagram
    api/artifacts/      # PUT /[id]/png → R2
    phx9a/capture/      # PostHog proxy
  components/           # DiagramViewer, MermaidCanvas, ExportToolbar, …
  lib/                  # client API, types, exporters (PNG/mermaid)
  server/               # pipeline, github client, digest, mermaid validation
    ai/                 # provider interface + implementations
    storage/            # config, redis, r2
docs/                   # PRD, architecture, API spec, data model, ADRs
```

## Security Notes

- User GitHub tokens are carried in memory for a single request and **never** written to logs, Redis, or R2.
- All AI output is sanitized (DOMPurify) before rendering.
- Secrets live exclusively in environment variables, accessed only through `src/server/storage/config.ts`.
- Tests that could touch live R2/Redis fail fast unless `ALLOW_LIVE_STORAGE_IN_TESTS=1`.
