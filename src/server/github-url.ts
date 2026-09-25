export class InvalidRepoUrlError extends Error {
  code = "INVALID_REPO_URL";
  constructor(url: string) {
    super(`Not a valid GitHub repository URL: ${url}`);
  }
}

export interface ParsedRepoUrl {
  owner: string;
  repo: string;
  host: string;
}

const GITHUB_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "gist.github.com",
]);

export function parseRepoUrl(url: string): ParsedRepoUrl {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new InvalidRepoUrlError(url);
  }
  if (!GITHUB_HOSTS.has(parsed.hostname)) {
    throw new InvalidRepoUrlError(url);
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new InvalidRepoUrlError(url);
  }
  const [owner, repo] = segments;
  if (
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}[a-zA-Z0-9])?$/.test(owner) ||
    !/^[a-zA-Z0-9_.-]+$/.test(repo)
  ) {
    throw new InvalidRepoUrlError(url);
  }
  return { owner, repo: repo.replace(/\.git$/, ""), host: "github.com" };
}

export function repoBlobUrl(
  owner: string,
  repo: string,
  branch: string,
  path: string
): string {
  const cleanPath = path.replace(/^\//, "").replace(/[^a-zA-Z0-9._/-]/g, encodeURI);
  return `https://github.com/${owner}/${repo}/blob/${branch}/${cleanPath}`;
}
