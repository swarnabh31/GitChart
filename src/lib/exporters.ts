export function toPng(svgEl: SVGElement, scale = 2): Promise<Blob | null> {
  const rect = svgEl.getBoundingClientRect();
  let vbW = 0;
  let vbH = 0;
  const vbAttr = svgEl.getAttribute("viewBox");
  if (vbAttr) {
    const parts = vbAttr.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      vbW = parts[2];
      vbH = parts[3];
    }
  } else if (typeof (svgEl as SVGGraphicsElement).getBBox === "function") {
    const bb = (svgEl as SVGGraphicsElement).getBBox();
    vbW = bb.width;
    vbH = bb.height;
  }
  const width = Math.max(1, Math.round(vbW || rect.width || 800));
  const height = Math.max(1, Math.round(vbH || rect.height || 600));
  const clone = svgEl.cloneNode(true) as SVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const src = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(src)}`;
  return new Promise<Blob | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b), "image/png");
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function copySvgText(svgEl: SVGElement): Promise<void> {
  const src = new XMLSerializer().serializeToString(svgEl);
  return navigator.clipboard.writeText(src).catch(() => {});
}

export function downloadMermaid(source: string, name: string): void {
  downloadText(source, name, "mmd");
}

export function downloadMarkdown(source: string, name: string): void {
  downloadText(source, name, "md");
}

function downloadText(source: string, name: string, ext: string): void {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "") || "diagram";
  const blob = new Blob([source], { type: `text/${ext === "md" ? "markdown" : "plain"};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safe}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export function findSvg(el: HTMLElement | null): SVGElement | null {
  if (!el) return null;
  return el.querySelector<SVGElement>("svg");
}
