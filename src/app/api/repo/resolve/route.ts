import { NextRequest } from "next/server";
import { createGitHubClient } from "@/server/github";
import { parseRepoUrl } from "@/server/github-url";
import { getGitHubConfig } from "@/server/storage/config";
import { errorResponse } from "@/server/http";
import { normalizeGithubHttpError } from "@/server/github-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  repo_url?: string;
  github_token?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return errorResponse("INVALID_JSON", "Request body must be JSON.", 400);
  }
  const url = typeof body.repo_url === "string" ? body.repo_url.trim() : "";
  if (!url) {
    return errorResponse("INVALID_REPO_URL", "repo_url is required.", 422);
  }

  let owner: string, repo: string;
  try {
    ({ owner, repo } = parseRepoUrl(url));
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return errorResponse(e?.code ?? "INVALID_REPO_URL", e?.message ?? "Invalid repository URL.", 422);
  }

  const userToken = typeof body.github_token === "string" ? body.github_token.trim() : undefined;
  const client = createGitHubClient({ userToken, config: getGitHubConfig() });
  try {
    const meta = await client.getRepoMetadata(owner, repo);
    return Response.json({
      owner: meta.owner,
      repo: meta.repo,
      default_branch: meta.default_branch,
      description: meta.description,
      language: meta.language,
      stars: meta.stargazers_count,
      forks: meta.forks_count,
      private: meta.private,
      html_url: meta.html_url,
    });
  } catch (err) {
    const mapped = normalizeGithubHttpError(err);
    return errorResponse(mapped.code, mapped.message, mapped.status);
  } finally {
    client.close();
  }
}
