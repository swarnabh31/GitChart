import { gunzipSync } from "node:zlib";
import { GitHubArchivePendingError } from "./github-errors";
import { InvalidRepoUrlError } from "./github-url";

export interface RepoBundle {
  files: Map<string, { mode: string; content: Uint8Array }>;
  dirs: string[];
  totalBytes: number;
  fileCount: number;
}

const MAX_GZ_BYTES = 128 * 1024 * 1024;
const MAX_RAW_BYTES = 768 * 1024 * 1024;
const MAX_FILES = 20000;
const MAX_PENDING_ATTEMPTS = 5;

export function codeloadTarballUrl(owner: string, repo: string, ref: string): string {
  const o = owner.replace(/[^\w.+-]/g, "");
  const r = repo.replace(/[^\w.+-]/g, "");
  const b = ref.replace(/[^\w./+-]/g, "");
  if (!o || !r || !b) {
    throw new InvalidRepoUrlError(`${owner}/${repo}@${ref}`);
  }
  return `https://codeload.github.com/${o}/${r}/tar.gz/${b}`;
}

function readUInt32BE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] << 24) |
    (buf[offset + 1] << 16) |
    (buf[offset + 2] << 8) |
    buf[offset + 3]
  );
}

function readOctal(buf: Uint8Array, start: number, len: number): number {
  let value = 0;
  for (let i = 0; i < len; i += 1) {
    const c = buf[start + i];
    if (c === 0 || c === 0x20) break;
    const digit = c & 0x0f;
    if (digit > 7) break;
    value = value * 8 + digit;
  }
  return value;
}

function readString(buf: Uint8Array, start: number, len: number): string {
  let end = start;
  const stop = Math.min(buf.length, start + len);
  while (end < stop && buf[end] !== 0) end += 1;
  return new TextDecoder().decode(buf.subarray(start, end));
}

export function parseTar(raw: Uint8Array): RepoBundle {
  const files = new Map<string, { mode: string; content: Uint8Array }>();
  const dirs = new Set<string>();
  let totalBytes = 0;
  let longName = "";
  let off = 0;
  let filesSeen = 0;

  while (off + 512 <= raw.length) {
    let allZero = true;
    for (let z = 0; z < 512 && allZero; z += 1) {
      if (raw[off + z] !== 0) allZero = false;
    }
    if (allZero) break;
    const name = readString(raw, off, 100);
    const modeStr = readString(raw, off + 100, 8).trim();
    const size = readOctal(raw, off + 124, 12);
    const type = raw[off + 156] === 0 ? "0" : String.fromCharCode(raw[off + 156]);
    const prefix = raw[off + 345] !== 0 ? readString(raw, off + 345, 155) : "";
    const chunk = Math.ceil(size / 512) * 512;

    if (name === "" && size === 0 && type === "0" && prefix === "") {
      break;
    }

    const base = prefix ? `${prefix}/${name}` : name;
    const path = longName ? longName : base;
    longName = "";
    const dataStart = off + 512;

    if (type === "5") {
      let dirPath = path.replace(/\.$/, "");
      if (!dirPath.endsWith("/")) dirPath += "/";
      dirs.add(dirPath);
    } else if (type === "0" || type === "") {
      if (filesSeen >= MAX_FILES) throw new Error("tarball exceeds file cap");
      filesSeen += 1;
      let content: Uint8Array;
      if (size > 0) {
        if (dataStart + size > raw.length) throw new Error("truncated tarball");
        content = raw.slice(dataStart, dataStart + size);
        totalBytes += size;
      } else {
        content = new Uint8Array(0);
      }
      files.set(path, { mode: modeStr || "644", content });
    } else if (type === "L") {
      longName = readString(raw, dataStart, size).replace(/\0/g, "");
    }

    off = dataStart + chunk;
  }

  const rawFiles = [...files.entries()].map(([path, meta]) => ({ path, meta }));

  const firstSegments = new Set<string>();
  for (const f of rawFiles) {
    const seg = f.path.split("/")[0];
    if (seg) firstSegments.add(seg);
  }
  for (const d of dirs) {
    const seg = d.replace(/\/$/, "").split("/")[0];
    if (seg) firstSegments.add(seg);
  }

  let root = "";
  if (firstSegments.size === 1) {
    root = [...firstSegments][0];
  }

  const stripPrefix = (p: string): string => {
    if (!root) return p.replace(/^\/+/, "");
    if (p === root) return "";
    if (p.startsWith(`${root}/`)) return p.slice(root.length).replace(/^\/+/, "");
    return p.replace(/^\/+/, "");
  };

  const normalizedFiles = new Map<string, { mode: string; content: Uint8Array }>();
  for (const { path, meta } of rawFiles) {
    if (meta.content.length === 0) continue;
    const p = stripPrefix(path);
    if (!p) continue;
    normalizedFiles.set(p, meta);
  }

  const normalizedDirs = new Set<string>();
  for (const d of dirs) {
    const p = stripPrefix(d.replace(/\/$/, ""));
    if (p) normalizedDirs.add(p);
  }

  return {
    files: normalizedFiles,
    dirs: [...normalizedDirs].sort(),
    totalBytes,
    fileCount: normalizedFiles.size,
  };
}

export async function downloadRepoArchive(
  url: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<RepoBundle> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  let pending = false;
  let lastFailure: unknown = null;

  for (let attempt = 0; attempt < MAX_PENDING_ATTEMPTS; attempt += 1) {
    if (opts.signal?.aborted) throw new Error("aborted");
    if (attempt > 0) {
      const delayMs = Math.round(800 * Math.pow(3, attempt - 1));
      try {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } catch {
        throw new Error("aborted");
      }
    }

    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: "follow", signal: opts.signal });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      lastFailure = err;
      continue;
    }

    if (res.status === 202) {
      pending = true;
      lastFailure = new GitHubArchivePendingError();
      continue;
    }
    if (res.status === 404) {
      throw new Error("repo_not_found");
    }
    if (!res.ok) {
      throw new Error(`Codeload request status ${res.status}`);
    }

    try {
      return await readAndParse(res);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      lastFailure = err;
      continue;
    }
  }

  if (pending) throw new GitHubArchivePendingError();
  if (lastFailure instanceof Error) throw lastFailure;
  throw new Error(`Codeload request failed: ${url}`);
}

async function readAndParse(res: Response): Promise<RepoBundle> {
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  let isGzip = ct.includes("gzip") || ct.includes("x-gzip");
  let buf: Uint8Array;
  try {
    buf = new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new Error("failed to read archive body");
  }
  if (buf.length === 0) throw new Error("empty archive");
  if (buf.length > MAX_GZ_BYTES) throw new Error("archive too large");

  isGzip = isGzip || (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b);

  let raw: Uint8Array;
  if (isGzip) {
    try {
      raw = gunzipSync(Buffer.from(buf)) as unknown as Uint8Array;
    } catch {
      raw = buf;
    }
  } else {
    raw = buf;
  }

  if (raw.length > MAX_RAW_BYTES) throw new Error("extracted archive too large");
  return parseTar(raw);
}
