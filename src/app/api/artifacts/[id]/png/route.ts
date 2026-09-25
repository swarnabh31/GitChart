import { NextRequest } from "next/server";
import { createR2Storage, artifactKey } from "@/server/storage/r2";
import { analyticsEmitter, repoProperties } from "@/server/analytics";
import { errorResponse, requestIdFromHeaders } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

function decodeBody(raw: Uint8Array, contentType: string, encoding: string | null): Buffer {
  if (encoding === "base64") {
    let json: { data?: string };
    try {
      json = JSON.parse(new TextDecoder().decode(raw)) as { data?: string };
    } catch {
      // raw base64 in body
      const b64 = new TextDecoder().decode(raw).trim();
      return Buffer.from(b64, "base64");
    }
    if (typeof json.data !== "string") {
      throw new Error("bad base64 payload");
    }
    return Buffer.from(json.data, "base64");
  }
  // binary (or base64 declared via content-type)
  if (contentType.includes("base64")) {
    return Buffer.from(new TextDecoder().decode(raw), "base64");
  }
  return Buffer.from(raw);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_:.]{1,128}$/.test(id)) {
    return errorResponse("INVALID_ID", "id must be alphanumeric.", 422);
  }
  const url = new URL(req.url);
  const owner = (url.searchParams.get("owner") ?? "").trim();
  const repo = (url.searchParams.get("repo") ?? "").trim();
  if (!owner || !repo) {
    return errorResponse("MISSING_OWNER_REPO", "owner and repo query params are required.", 422);
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return errorResponse("TOO_LARGE", "PNG exceeds the 8MB limit.", 413);
  }

  const raw = new Uint8Array(await req.arrayBuffer());
  const contentType = req.headers.get("content-type") ?? "";
  const encoding = req.headers.get("x-encoding");

  let buffer: Buffer;
  try {
    buffer = decodeBody(raw, contentType, encoding);
  } catch {
    return errorResponse("INVALID_BODY", "Could not decode the PNG payload.", 422);
  }
  if (buffer.byteLength > MAX_BYTES) {
    return errorResponse("TOO_LARGE", "PNG exceeds the 8MB limit.", 413);
  }

  let pngUrl: string;
  try {
    const storage = createR2Storage("public");
    const key = artifactKey(owner, repo, id);
    pngUrl = await storage.put(key, buffer, "image/png");
  } catch {
    return errorResponse("UPSTREAM_ERROR", "Could not upload the PNG to object storage.", 502);
  }

  const distinctId = owner;
  analyticsEmitter(distinctId)(
    { event: "diagram_saved", ...repoProperties(owner, repo) }
  );

  return new Response(JSON.stringify({ url: pngUrl }), {
    status: 201,
    headers: { "content-type": "application/json", "x-request-id": requestIdFromHeaders(req.headers) },
  });
}
