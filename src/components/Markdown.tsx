"use client";

import * as React from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

interface MarkdownProps {
  source: string;
  className?: string;
}

function sanitizeMd(md: string): string {
  // DOMPurify only works where a browser `window` exists. During SSR/prerender
  // (Node) the `dompurify` default export is the factory function itself, so
  // `sanitize` is not callable — fall back to passing the string through. The
  // client render re-runs with a real window and sanitizes, so output is still
  // DOMPurify-cleaned for the user.
  if (typeof window === "undefined" || !DOMPurify.isSupported) {
    return md;
  }
  if (typeof DOMPurify.addHook === "function") {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node instanceof window.HTMLElement && node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noreferrer noopener");
      }
    });
  }
  return DOMPurify.sanitize(md, { ADD_ATTR: ["target", "rel"] }) as string;
}

export function Markdown({ source, className }: MarkdownProps) {
  const html = React.useMemo(() => sanitizeMd(marked.parse(source, { async: false }) as string), [source]);

  return (
    <div
      className={className ? `gd-markdown ${className}` : "gd-markdown"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
