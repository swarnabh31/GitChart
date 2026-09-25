import type { GitHubConfig } from "./storage/config";
import {
  GitHubAuthError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  type RepoMetadata,
  type TreeEntry,
} from "./github-errors";
import {
  codeloadTarballUrl,
  downloadRepoArchive,
  type RepoBundle,
} from "./codeload";

export { GitHubAuthError, GitHubRateLimitError, GitHubNotFoundError };
export type { RepoMetadata, TreeEntry } from "./github-errors";

const DEFAULT_BASE_URL = "https://api.github.com";
const EXCERPT_MAX_BYTES = 128 * 1024;

interface GitHubClientOpts {
  baseUrl?: string;
  userToken?: string;
  config?: GitHubConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface GitHubClient {
  getRepoMetadata(owner: string, repo: string): Promise<RepoMetadata>;
  getTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]>;
  getFileContent(
    owner: string,
    repo: string,
    branch: string,
    path: string
  ): Promise<{ content: string; truncated: boolean } | null>;
  close(): void;
}

function pickPat(config: GitHubConfig, count: number): string | undefined {
  if (config.patPool.length === 0) return undefined;
  return config.patPool[count % config.patPool.length];
}

interface RawBundleCache {
  owner: string;
  repo: string;
  branch: string;
  bundle: RepoBundle;
  tree: TreeEntry[] | null;
}

export function createGitHubClient(opts: GitHubClientOpts = {}): GitHubClient {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const config =
    opts.config ?? { defaultPat: undefined, patPool: [], appId: undefined, clientId: undefined };
  let calls = 0;

  let bundle: RawBundleCache | null = null;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    calls += 1;
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    if (opts.userToken) {
      headers.set("Authorization", `Bearer ${opts.userToken}`);
    } else {
      const pat = pickPat(config, calls);
      if (pat) headers.set("Authorization", `Bearer ${pat}`);
    }
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw new Error(`GitHub request timed out: ${path}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 || res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const retryAfter = res.headers.get("retry-after");
      if (remaining === "0" || retryAfter) {
        throw new GitHubRateLimitError();
      }
    }
    return res;
  }

  async function loadBundle(owner: string, repo: string, branch: string): Promise<RawBundleCache> {
    if (bundle && bundle.owner === owner && bundle.repo === repo && bundle.branch === branch) {
      return bundle;
    }
    const isFallbackBranch = branch === "main" || branch === "master" || branch === "";
    let raw: RepoBundle;
    try {
      raw = await downloadRepoArchive(codeloadTarballUrl(owner, repo, branch), { fetchImpl });
    } catch (err) {
      if ((err as Error).message === "repo_not_found") {
        if (!isFallbackBranch) throw new GitHubNotFoundError();
        try {
          raw = await downloadRepoArchive(codeloadTarballUrl(owner, repo, "HEAD"), { fetchImpl });
        } catch (err2) {
          if ((err2 as Error).message === "repo_not_found") throw new GitHubNotFoundError();
          throw err2;
        }
      } else {
        throw err;
      }
    }
    const next: RawBundleCache = { owner, repo, branch, bundle: raw, tree: null };
    bundle = next;
    return next;
  }

  function buildTree(cache: RawBundleCache): TreeEntry[] {
    const seenDirs = new Set<string>();
    const tree: TreeEntry[] = [];
    for (const dir of cache.bundle.dirs) {
      if (!seenDirs.has(dir)) {
        seenDirs.add(dir);
        tree.push({ path: dir, type: "tree", size: 0, mode: "40755" });
      }
      const segs = dir.split("/");
      for (let i = 1; i < segs.length; i += 1) {
        const parent = segs.slice(0, i).join("/");
        if (!seenDirs.has(parent)) {
          seenDirs.add(parent);
          tree.push({ path: parent, type: "tree", size: 0, mode: "40755" });
        }
      }
    }
    for (const [path, entry] of cache.bundle.files) {
      const segs = path.split("/");
      for (let i = 1; i < segs.length; i += 1) {
        const parent = segs.slice(0, i).join("/");
        if (!seenDirs.has(parent)) {
          seenDirs.add(parent);
          tree.push({ path: parent, type: "tree", size: 0, mode: "40755" });
        }
      }
      tree.push({ path, type: "blob", size: entry.content.length, mode: entry.mode || "100644" });
    }
    tree.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return tree;
  }

  return {
    async getRepoMetadata(owner, repo) {
      const fallback: RepoMetadata = {
        owner,
        repo,
        full_name: `${owner}/${repo}`,
        default_branch: "main",
        description: null,
        language: null,
        stargazers_count: 0,
        forks_count: 0,
        private: false,
        resolved: false,
        html_url: `https://github.com/${owner}/${repo}`,
      };
      let res: Response;
      try {
        res = await request(`/repos/${owner}/${repo}`);
      } catch (err) {
        if (err instanceof GitHubRateLimitError) return fallback;
        throw err;
      }
      if (res.status === 404) {
        throw new GitHubNotFoundError();
      }
      if (!res.ok) {
        return fallback;
      }
      let data: Record<string, unknown>;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        return fallback;
      }
      return {
        owner,
        repo,
        full_name: (data.full_name as string) ?? fallback.full_name,
        default_branch: (data.default_branch as string) ?? "main",
        description: (data.description as string) ?? null,
        language: (data.language as string) ?? null,
        stargazers_count: (data.stargazers_count as number) ?? 0,
        forks_count: (data.forks_count as number) ?? 0,
        private: (data.private as boolean) ?? false,
        resolved: true,
        html_url: (data.html_url as string) ?? fallback.html_url,
      };
    },

    async getTree(owner, repo, branch) {
      const cache = await loadBundle(owner, repo, branch);
      if (!cache.tree) {
        cache.tree = buildTree(cache);
      }
      return cache.tree;
    },

    async getFileContent(owner, repo, branch, path) {
      const cache = await loadBundle(owner, repo, branch);
      const clean = path.replace(/^\/+/, "");
      const entry = cache.bundle.files.get(clean);
      if (!entry) return null;
      const byteLen = entry.content.length;
      let truncated = false;
      let text: string;
      if (byteLen > EXCERPT_MAX_BYTES) {
        truncated = true;
        text = new TextDecoder().decode(entry.content.subarray(0, EXCERPT_MAX_BYTES));
      } else {
        text = new TextDecoder().decode(entry.content);
      }
      return { content: text, truncated };
    },

    close() {
      calls = 0;
      bundle = null;
    },
  };
}
