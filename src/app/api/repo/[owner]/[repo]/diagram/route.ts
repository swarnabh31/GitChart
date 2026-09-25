import { NextRequest } from "next/server";
import { createRedisStore, diagramKey } from "@/server/storage/redis";
import type { DiagramResult } from "@/server/pipeline-types";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ owner: string; repo: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { owner, repo } = await params;
  const lookupKey = `diagram:latest:${owner}:${repo}`;
  let existingId: string | null;
  try {
    const redis = createRedisStore();
    existingId = await redis.get<string>(lookupKey);
    if (!existingId) {
      return Response.json(
        { error: { code: "NO_DIAGRAM", message: "No diagram available for this repository branch." } },
        { status: 404 }
      );
    }
    const cached = await redis.get<DiagramResult>(diagramKey(existingId));
    if (!cached) {
      return Response.json(
        { error: { code: "NO_DIAGRAM", message: "No diagram available for this repository branch." } },
        { status: 404 }
      );
    }
    return new Response(JSON.stringify(cached), {
      status: 200,
      headers: { "content-type": "application/json", "x-diagram-id": cached.id },
    });
  } catch {
    return errorResponse("GITHUB_UPSTREAM_ERROR", "Could not fetch the cached diagram.", 502);
  }
}
