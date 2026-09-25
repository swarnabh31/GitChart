import {
  GitHubAuthError,
  GitHubNotFoundError,
  GitHubRateLimitError,
} from "./github-errors";

export interface MappedError {
  code: string;
  message: string;
  status: number;
}

const ERROR_STATUS: Record<string, number> = {
  TOKEN_INVALID_OR_REPO_PRIVATE: 403,
  REPO_NOT_FOUND: 404,
  GITHUB_RATE_LIMITED: 503,
  INVALID_REPO_URL: 422,
  ConfigError: 500,
  TestSafetyError: 500,
};

export function normalizeGithubHttpError(err: unknown): MappedError {
  if (err instanceof GitHubNotFoundError) {
    return { code: "REPO_NOT_FOUND", message: err.message, status: 404 };
  }
  if (err instanceof GitHubAuthError) {
    return { code: "TOKEN_INVALID_OR_REPO_PRIVATE", message: err.message, status: 403 };
  }
  if (err instanceof GitHubRateLimitError) {
    return { code: "GITHUB_RATE_LIMITED", message: err.message, status: 503 };
  }
  if (err instanceof Error && "code" in err && typeof (err as { code: unknown }).code === "string") {
    const code = (err as { code: string }).code;
    return { code, message: err.message, status: ERROR_STATUS[code] ?? 502 };
  }
  return {
    code: "GITHUB_UPSTREAM_ERROR",
    message: "Could not reach GitHub for this repository.",
    status: 502,
  };
}
