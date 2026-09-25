"use client";

import * as React from "react";
import type { DiagramResult } from "../lib/types";
import { MermaidCanvas } from "../lib/MermaidCanvas";
import { RepoCard } from "../components/RepoCard";
import { ExplanationBlock } from "../components/ExplanationBlock";
import { ExportToolbar } from "../components/ExportToolbar";

export interface RepoMeta {
  description?: string;
  language?: string;
  stars?: number;
  forks?: number;
  isPrivate?: boolean;
}

interface DiagramViewerProps {
  diagram: DiagramResult;
  meta?: RepoMeta;
  onRegenerate?: () => void;
}

export function DiagramViewer({ diagram, meta, onRegenerate }: DiagramViewerProps) {
  const canvasWrapperRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <div className="space-y-4">
      <RepoCard
        owner={diagram.owner}
        repo={diagram.repo}
        branch={diagram.default_branch}
        description={meta?.description}
        language={meta?.language}
        stars={meta?.stars}
        forks={meta?.forks}
        isPrivate={meta?.isPrivate}
        provider={diagram.provider}
      />

      <div className="gd-card">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-base font-semibold text-ink">Architecture</h2>
          <span className="text-xs text-ink-mut">Scroll to zoom · drag to pan</span>
        </div>
        <MermaidCanvas mermaidSource={diagram.mermaid_source} wrapperRef={canvasWrapperRef} />
      </div>

      <ExplanationBlock
        owner={diagram.owner}
        repo={diagram.repo}
        branch={diagram.default_branch}
        explanation={diagram.explanation}
        components={diagram.components}
        streaming={false}
        mermaidSource={diagram.mermaid_source}
      />

      <div className="gd-card">
        <ExportToolbar
          diagram={diagram}
          canvasWrapper={canvasWrapperRef}
          onRegenerate={onRegenerate}
        />
      </div>
    </div>
  );
}
