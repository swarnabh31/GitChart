export class GitHubAuthError extends Error {
  code = "TOKEN_INVALID_OR_REPO_PRIVATE";
  constructor(message?: string) {
    super(message ?? "Token is invalid, or the repository is private.");
  }
}

export class GitHubRateLimitError extends Error {
  code = "GITHUB_RATE_LIMITED";
  constructor(message?: string) {
    super(message ?? "GitHub API rate limit exceeded.");
  }
}

export class GitHubNotFoundError extends Error {
  code = "REPO_NOT_FOUND";
  constructor() {
    super("Repository not found.");
  }
}

export class GitHubArchivePendingError extends Error {
  code = "REPO_ARCHIVE_PENDING";
  constructor(message?: string) {
    super(message ?? "GitHub is still preparing this archive. Please try again in a few seconds.");
  }
}

export interface RepoMetadata {
  owner: string;
  repo: string;
  full_name: string;
  default_branch: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  private: boolean;
  resolved: boolean;
  html_url: string;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  size: number;
  mode: string;
}
