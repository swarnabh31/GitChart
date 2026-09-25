"use client";

import * as React from "react";
import { Download, FileCode2, Link2 } from "lucide-react";
import type { DiagramComponent } from "../lib/types";
import { fileUrl } from "../lib/types";
import { Markdown } from "./Markdown";
import { downloadMarkdown } from "../lib/exporters";
import { explanationToMarkdown } from "../lib/explanation-md";
import { track } from "../lib/client";
import { stripClickDirectives } from "../lib/MermaidCanvas";

interface ExplanationBlockProps {
  owner: string;
  repo: string;
  branch: string;
  explanation: string;
  components?: DiagramComponent[];
  streaming: boolean;
  mermaidSource?: string;
}

export function ExplanationBlock({
  owner,
  repo,
  branch,
  explanation,
  components,
  streaming,
  mermaidSource,
}: ExplanationBlockProps) {
  const textRef = React.useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    if (streaming && textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [explanation, streaming]);

  const list = components ?? [];

  const handleDownload = () => {
    const md = explanationToMarkdown(owner, repo, branch, explanation, list);
    const full = mermaidSource
      ? `${md}\n## Architecture diagram\n\n\`\`\`mermaid\n${stripClickDirectives(mermaidSource).trim()}\n\`\`\`\n`
      : md;
    downloadMarkdown(full, repo);
    track("explanation_exported", { repo: `${owner}/${repo}`, format: "markdown" });
  };

  return (
    <div className="gd-card">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-base font-semibold inline-flex items-center gap-2 text-ink">
          <FileCode2 className="w-4 h-4 text-accent" />
          How it works
          {streaming && <span className="gd-cursor" aria-hidden />}
        </h2>
        <div className="flex items-center gap-3">
          {explanation && (
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 text-xs text-ink-mut hover:text-ink"
            >
              <Download className="w-3 h-3" />
              Download .md
            </button>
          )}
          {explanation && (
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="text-xs text-ink-mut hover:text-ink"
              aria-expanded={!collapsed}
            >
              {collapsed ? "Expand" : "Collapse"}
            </button>
          )}
        </div>
      </div>
      {explanation ? (
        <div
          ref={textRef}
          className="gd-explanation"
          style={collapsed ? { maxHeight: 0, opacity: 0, overflow: "hidden" } : undefined}
        >
          {streaming ? (
            <div className="gd-pre">{explanation}</div>
          ) : (
            <Markdown source={explanation} />
          )}
        </div>
      ) : streaming ? (
        <div className="gd-skeleton h-24 rounded" aria-live="polite" />
      ) : (
        <p className="text-sm text-ink-mut">Streaming explanation…</p>
      )}
      {list.length > 0 && (
        <ol className="mt-4 space-y-2">
          {list.map((c) => (
            <li key={c.id} className="gd-component">
              <a
                href={fileUrl(owner, repo, branch, c.file_path)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-mono text-accent hover:underline"
              >
                <Link2 className="w-3 h-3 opacity-60" />
                {c.label}
              </a>
              <span className="text-ink-mut text-xs"> · {c.file_path}</span>
              <p className="text-sm text-ink-mut mt-1 leading-relaxed">{c.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
