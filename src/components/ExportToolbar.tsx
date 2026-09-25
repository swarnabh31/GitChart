"use client";

import * as React from "react";
import { Download, ClipboardCopy, RefreshCw, Loader2 } from "lucide-react";
import type { DiagramResult } from "../lib/types";
import { toPng, findSvg } from "../lib/exporters";
import { track } from "../lib/client";
import { stripClickDirectives } from "../lib/MermaidCanvas";

interface ExportToolbarProps {
  diagram: DiagramResult;
  onRegenerate?: () => void;
  canvasWrapper?: React.RefObject<HTMLDivElement | null> | (() => HTMLDivElement | null);
}

export function ExportToolbar({ diagram, onRegenerate, canvasWrapper }: ExportToolbarProps) {
  const [busy, setBusy] = React.useState<"none" | "png" | "copy">("none");
  const [copied, setCopied] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    setErr(null);
  }, [diagram.id]);

  const handlePng = async () => {
    setErr(null);
    setBusy("png");
    try {
      let wrapper: HTMLDivElement | null = null;
      if (typeof canvasWrapper === "function") wrapper = canvasWrapper();
      else if (canvasWrapper) wrapper = canvasWrapper.current;
      const svg = findSvg(wrapper);
      if (!svg) throw new Error("Diagram is still rendering — try again in a moment.");
      const blob = await toPng(svg, 2);
      if (!blob) throw new Error("PNG export failed.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(diagram.repo || "diagram").replace(/[^a-zA-Z0-9._-]/g, "") || "diagram"}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      track("diagram_exported", {
        repo: `${diagram.owner}/${diagram.repo}`,
        format: "png",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "PNG export failed.");
    } finally {
      setBusy("none");
    }
  };

  const handleCopyMermaid = async () => {
    setErr(null);
    setBusy("copy");
    try {
      await navigator.clipboard.writeText(stripClickDirectives(diagram.mermaid_source));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      track("diagram_exported", {
        repo: `${diagram.owner}/${diagram.repo}`,
        format: "mermaid",
        action: "copy",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Copy failed.");
    } finally {
      setBusy("none");
    }
  };

  const handleDownloadMermaid = () => {
    const src = stripClickDirectives(diagram.mermaid_source);
    if (!src) return;
    const blob = new Blob([src], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${diagram.repo || "diagram"}.mmd`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    track("diagram_exported", {
      repo: `${diagram.owner}/${diagram.repo}`,
      format: "mermaid",
      action: "download",
    });
  };

  return (
    <div className="gd-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void handlePng()} disabled={busy !== "none"} className="gd-btn">
          {busy === "png" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Export PNG
        </button>
        <button
          type="button"
          onClick={() => void handleCopyMermaid()}
          disabled={busy !== "none"}
          className="gd-btn"
        >
          {busy === "copy" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ClipboardCopy className="w-4 h-4" />
          )}
          {copied ? "Copied!" : "Copy Mermaid"}
        </button>
        <button type="button" onClick={handleDownloadMermaid} className="gd-btn">
          <Download className="w-4 h-4" />
          .mmd file
        </button>
        {onRegenerate && (
          <button type="button" onClick={onRegenerate} className="gd-btn ghost">
            <RefreshCw className="w-4 h-4" />
            Regenerate
          </button>
        )}
      </div>
      {err && <p className="text-xs text-err mt-2">{err}</p>}
    </div>
  );
}
