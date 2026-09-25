"use client";

import { Star, GitFork, Lock, GitBranch } from "lucide-react";
import { repoUrl } from "../lib/types";

interface RepoCardProps {
  owner: string;
  repo: string;
  branch: string;
  description?: string;
  language?: string;
  stars?: number;
  forks?: number;
  isPrivate?: boolean;
  provider?: string;
}

export function RepoCard({
  owner,
  repo,
  description,
  language,
  stars,
  forks,
  isPrivate,
  provider,
}: RepoCardProps) {
  return (
    <div className="gd-card">
      <a
        href={repoUrl(owner, repo)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-lg font-semibold text-ink hover:text-accent mb-1"
      >
        <GitBranch className="w-5 h-5" />
        {owner}/{repo}
        {isPrivate && <Lock className="w-4 h-4 text-ink-mut" />}
      </a>
      {description ? (
        <p className="text-sm text-ink-mut mb-3 max-w-2xl leading-relaxed line-clamp-3">{description}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-mut">
        {language && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-accent" />
            {language}
          </span>
        )}
        {typeof stars === "number" && (
          <span className="inline-flex items-center gap-1"><Star className="w-3.5 h-3.5" /> {stars.toLocaleString()}</span>
        )}
        {typeof forks === "number" && (
          <span className="inline-flex items-center gap-1"><GitFork className="w-3.5 h-3.5" /> {forks.toLocaleString()}</span>
        )}
        {provider && <span className="text-xs px-2 py-0.5 rounded bg-surface-2 text-ink-mut">{provider}</span>}
      </div>
    </div>
  );
}
