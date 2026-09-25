"use client";

import * as React from "react";
import mermaid from "mermaid";
import DOMPurify from "dompurify";

interface MermaidCanvasProps {
  mermaidSource: string;
  wrapperRef?: React.Ref<HTMLDivElement>;
}

type View = { scale: number; x: number; y: number; scaleMin: number; scaleMax: number };

function isDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

function createHiddenRenderTarget(width: number): HTMLDivElement {
  const target = document.createElement("div");
  target.setAttribute("aria-hidden", "true");
  target.style.position = "absolute";
  target.style.visibility = "hidden";
  target.style.pointerEvents = "none";
  target.style.overflow = "hidden";
  target.style.left = "0";
  target.style.top = "0";
  target.style.zIndex = "-1";
  target.style.width = `${Math.max(width, 1)}px`;
  document.body.append(target);
  return target;
}

function svgSize(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) return { w: vb.width, h: vb.height };
  const rect = svg.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return { w: rect.width, h: rect.height };
  const w = Number(svg.getAttribute("width")) || 0;
  const h = Number(svg.getAttribute("height")) || 0;
  return w > 0 && h > 0 ? { w, h } : { w: 800, h: 600 };
}

/**
 * mermaid's flowchart natively binds any `click <id> "<url>"` directive to a
 * `window.open` handler (even at securityLevel "antiscript"), re-attached via the
 * render result's bindFunctions. We no longer support node→source navigation, and
 * some cached diagrams still carry these directives — strip them before rendering.
 */
export function stripClickDirectives(source: string): string {
  return source.split("\n").filter((line) => !/^\s*click\s/.test(line)).join("\n");
}

export function MermaidCanvas({ mermaidSource, wrapperRef }: MermaidCanvasProps) {
  const [svg, setSvg] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [zoomPct, setZoomPct] = React.useState<number | null>(null);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<View | null>(null);
  const interactedRef = React.useRef(false);
  const dragRef = React.useRef({ px: 0, py: 0, x: 0, y: 0, active: false });

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setNonce((n) => n + 1);
    mq.addEventListener?.("change", listener);
    return () => mq.removeEventListener?.("change", listener);
  }, []);

  const apply = React.useCallback(() => {
    const inner = innerRef.current;
    const container = containerRef.current;
    const view = viewRef.current;
    if (!inner) return;
    const cw = container ? container.clientWidth : 0;
    const ch = container ? container.clientHeight : 0;
    const doc = inner.querySelector<SVGSVGElement>("svg")
      ? svgSize(inner.querySelector<SVGSVGElement>("svg") as SVGSVGElement)
      : { w: cw, h: ch };
    const s = view ? view.scale : 1;
    inner.style.width = `${Math.max(doc.w * s, 1)}px`;
    inner.style.height = `${Math.max(doc.h * s, 1)}px`;
    inner.style.transform = `translate3d(${view ? view.x : 0}px, ${view ? view.y : 0}px, 0)`;
    if (view) setZoomPct(Math.round((view.scale / view.scaleMin) * 100));
  }, []);

  const fit = React.useCallback(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    const svgEl = inner?.querySelector<SVGSVGElement>("svg");
    if (!container || !svgEl) return;
    const pad = 24;
    const cw = container.clientWidth - pad * 2;
    const ch = container.clientHeight - pad * 2;
    const { w, h } = svgSize(svgEl);
    const scaleAt100 = Math.min(cw / w, ch / h);
    const view: View = {
      scale: Math.max(scaleAt100, 0.05),
      x: 0,
      y: 0,
      scaleMin: Math.max(scaleAt100, 0.05),
      scaleMax: 4,
    };
    view.x = (container.clientWidth - w * view.scale) / 2;
    view.y = (container.clientHeight - h * view.scale) / 2;
    viewRef.current = view;
    interactedRef.current = false;
    if (inner) inner.style.transformOrigin = "0 0";
    apply();
  }, [apply]);

  const zoomBy = React.useCallback(
    (factor: number, anchorX?: number, anchorY?: number) => {
      const container = containerRef.current;
      const view = viewRef.current;
      if (!container || !view) return;
      const ax = anchorX ?? container.clientWidth / 2;
      const ay = anchorY ?? container.clientHeight / 2;
      const next = Math.min(Math.max(view.scale * factor, view.scaleMin / 4), view.scaleMax);
      const ratio = next / view.scale;
      view.x = ax - ratio * (ax - view.x);
      view.y = ay - ratio * (ay - view.y);
      view.scale = next;
      interactedRef.current = true;
      apply();
    },
    [apply]
  );

  React.useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "antiscript",
      suppressErrorRendering: true,
      theme: isDark() ? "dark" : "default",
      htmlLabels: false,
      layout: "elk",
      look: "classic",
      flowchart: { curve: "basis", wrappingWidth: 200, nodeSpacing: 50, rankSpacing: 50, padding: 15 },
    });
    setSvg("");
    setError(null);
    const renderSource = stripClickDirectives(mermaidSource);
    const target = createHiddenRenderTarget(containerRef.current?.clientWidth ?? Math.max(window.innerWidth, 800));
    try {
      mermaid.render(nextId("gd"), renderSource, target)
        .then((result) => {
          if (cancelled) return;
          const raw = typeof result.svg === "string" ? result.svg : JSON.stringify(result.svg);
          const clean = DOMPurify.sanitize(raw, {
            USE_PROFILES: { html: true, svg: true, svgFilters: true },
            FORBID_TAGS: ["script"],
          });
          if (!clean) {
            setError(`Rendered SVG was empty after sanitize (raw length ${raw.length}).`);
            setSvg("");
            return;
          }
          setSvg(clean);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setSvg("");
          const name = e && typeof (e as { name?: unknown }).name === "string" ? (e as { name: string }).name : "";
          const msg = e instanceof Error ? e.message : String(e);
          setError(name ? `${name}: ${msg}` : msg);
        })
        .finally(() => target.remove());
    } catch (e) {
      target.remove();
      if (!cancelled) {
        setSvg("");
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    return () => {
      cancelled = true;
      target.remove();
    };
  }, [mermaidSource, nonce]);

  React.useEffect(() => {
    if (!svg) return;
    const inner = innerRef.current;
    if (inner) {
      inner.innerHTML = svg;
    }
    const raf = requestAnimationFrame(() => fit());
    const ro = new ResizeObserver(() => {
      const container = containerRef.current;
      const svgEl = innerRef.current?.querySelector<SVGSVGElement>("svg");
      if (!container || !svgEl) return;
      if (!interactedRef.current) {
        fit();
        return;
      }
      const view = viewRef.current;
      const { w, h } = svgSize(svgEl);
      if (view) {
        view.scaleMin = Math.max(
          Math.min((container.clientWidth - 48) / w, (container.clientHeight - 48) / h),
          0.05
        );
        view.scale = Math.max(view.scaleMin, Math.min(view.scale, view.scaleMax));
        apply();
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [svg, fit, apply]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const strength = event.ctrlKey ? 0.005 : 0.0015;
      zoomBy(Math.exp(-event.deltaY * strength), event.clientX - rect.left, event.clientY - rect.top);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [svg, zoomBy]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !svg) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const view = viewRef.current;
      dragRef.current = {
        px: event.clientX,
        py: event.clientY,
        x: view?.x ?? 0,
        y: view?.y ?? 0,
        active: true,
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active) return;
      const dx = event.clientX - drag.px;
      const dy = event.clientY - drag.py;
      if (Math.hypot(dx, dy) < 1) return;
      const view = viewRef.current;
      if (!view) return;
      view.x = drag.x + dx;
      view.y = drag.y + dy;
      interactedRef.current = true;
      apply();
    };
    const onPointerEnd = () => {
      dragRef.current.active = false;
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerEnd);
    container.addEventListener("pointercancel", onPointerEnd);
    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerEnd);
      container.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [svg, apply]);

  const zoomLabel = zoomPct === null ? "Fit" : `${zoomPct}%`;

  if (error) {
    return (
      <div role="alert" className="rounded-md border border-line bg-surface p-4">
        <div className="font-medium text-err mb-1 text-sm">Mermaid render error</div>
        <pre className="text-xs text-ink-mut whitespace-pre-wrap max-h-48 overflow-auto font-mono">{error}</pre>
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="mt-3 text-xs px-3 py-1.5 rounded border border-line hover:bg-surface-2"
        >
          Retry render
        </button>
      </div>
    );
  }

  return (
    <div className="gd-vp-wrap" ref={wrapperRef}>
      <div
        ref={containerRef}
        className="gd-vp relative overflow-hidden cursor-grab active:cursor-grabbing touch-none select-none user-select-none"
      >
        {svg ? (
          <div ref={innerRef} className="gd-vp-inner absolute left-0 top-0 will-change-transform" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="gd-skeleton gd-vp-skel" aria-live="polite" />
        )}
      </div>

      <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-md border border-line bg-surface/95 px-1 py-1 shadow-sm">
        <button type="button" aria-label="Zoom out" className="gd-vp-btn" onClick={() => zoomBy(1 / 1.25)}>
          &minus;
        </button>
        <span className="min-w-10 select-none text-center text-[11px] tabular-nums text-ink-mut" aria-live="polite">
          {zoomLabel}
        </span>
        <button type="button" aria-label="Zoom in" className="gd-vp-btn" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <button type="button" aria-label="Fit to view" className="gd-vp-btn" onClick={() => fit()}>
          Fit
        </button>
      </div>
    </div>
  );
}
