/** Mirrors server-side `DiagramResult` (src/server/pipeline.ts). Wire shape is snake_case. */
export type DiagramComponent = {
  id: string;
  label: string;
  file_path: string;
  summary: string;
};

export type DiagramResult = {
  id: string;
  owner: string;
  repo: string;
  default_branch: string;
  mermaid_source: string;
  components: DiagramComponent[];
  explanation: string;
  provider: string;
  created_at: string;
  cached: boolean;
};

function cleanPath(path: string): string {
  if (!path) return "";
  return path.replace(/^\//, "").replace(/[^a-zA-Z0-9._/-]/g, (c) => encodeURI(c));
}

export function fileUrl(owner: string, repo: string, branch: string, file: string): string {
  return `https://github.com/${owner}/${repo}/blob/${branch}/${cleanPath(file)}`;
}

export function rawUrl(owner: string, repo: string, branch: string, file: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath(file)}`;
}

export function repoUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

export function parseRepoUrlLocal(
  url: string
): { owner: string; repo: string } | { error: string } {
  try {
    const parsed = new URL(url.trim());
    if (!/github\.com$/i.test(parsed.hostname)) {
      return { error: "Only GitHub URLs are supported." };
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      return { error: "URL must look like https://github.com/owner/repo." };
    }
    const [owner, repo] = segments;
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}[a-zA-Z0-9])?$/.test(owner)) {
      return { error: "Owner name is invalid." };
    }
    const cleaned = repo.replace(/\.git$/, "");
    if (!/^[a-zA-Z0-9_.-]+$/.test(cleaned)) {
      return { error: "Repo name is invalid." };
    }
    return { owner, repo: cleaned };
  } catch {
    return { error: "URL is malformed." };
  }
}
