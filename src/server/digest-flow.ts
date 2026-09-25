import type { GitHubClient, RepoMetadata, TreeEntry } from "./github";
import { buildDigest, selectDigestFiles, type DigestBudget, LARGE_BUDGET } from "./digest";
import type { RepoDigest } from "./digest";

function capToExcerpt(
  content: string,
  truncated: boolean,
  excerptBytes: number
): { content: string; truncated: boolean } {
  if (content.length <= excerptBytes) return { content, truncated };
  return { content: content.slice(0, excerptBytes), truncated: true };
}

export async function buildRepoDigest(
  client: GitHubClient,
  meta: RepoMetadata,
  tree: TreeEntry[],
  budget: DigestBudget = LARGE_BUDGET
): Promise<RepoDigest> {
  const selected = selectDigestFiles(tree, budget);
  const excerpts: { path: string; content: string; truncated: boolean }[] = [];
  for (let i = 0; i < selected.length; i += 5) {
    const batch = selected.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (file) => {
        const content = await client
          .getFileContent(meta.owner, meta.repo, meta.default_branch, file.path)
          .catch(() => null);
        if (!content) return null;
        const capped = capToExcerpt(content.content, content.truncated, budget.excerpt);
        return { path: file.path, content: capped.content, truncated: capped.truncated };
      })
    );
    for (const r of results) if (r) excerpts.push(r);
  }
  return buildDigest(meta, tree, excerpts);
}
