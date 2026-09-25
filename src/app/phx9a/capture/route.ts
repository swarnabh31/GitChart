import { NextRequest } from "next/server";
import { getPostHogConfig } from "@/server/storage/config";
import { requestIdFromHeaders } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CaptureEvent {
  event: string;
  distinct_id?: string;
  properties?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const requestId = requestIdFromHeaders(req.headers);
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be JSON." } }, { status: 400 });
  }
  let events: CaptureEvent[];
  if (Array.isArray(parsed)) {
    events = parsed as CaptureEvent[];
  } else if (parsed && typeof parsed === "object" && typeof (parsed as CaptureEvent).event === "string") {
    events = [parsed as CaptureEvent];
  } else {
    return Response.json(
      { error: { code: "INVALID_PAYLOAD", message: "Events array or object with an event required." } },
      { status: 422 }
    );
  }
  if (events.length === 0) {
    return Response.json({ status: "empty" }, { status: 200, headers: { "content-type": "application/json", "x-request-id": requestId } });
  }

  const config = getPostHogConfig();
  if (!config.personalApiKey || !config.projectId) {
    return Response.json({ status: "disabled", message: "PostHog analytics not configured." }, {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": requestId },
    });
  }

  const mapped = events.map((e) => ({
    ...e,
    properties: {
      ...(e.properties ?? {}),
      $lib: "posthog-node",
      $user_agent: req.headers.get("user-agent") as string,
    },
  }));

  try {
    const host = config.host.replace(/\/$/, "");
    const upstream = await fetch(`${host}/capture/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.personalApiKey}`,
      },
      body: JSON.stringify({
        api_key: config.projectId,
        events: mapped,
      }),
    });
    const status = upstream.status;
    const text = await upstream.text().catch(() => "");
    return new Response(
      status >= 200 && status < 300 ? JSON.stringify({ status: "ok" }) : JSON.stringify({ error: { code: "UPSTREAM_ERROR", message: text.slice(0, 300) } }),
      {
        status: status >= 200 && status < 300 ? 200 : 502,
        headers: { "content-type": "application/json", "x-request-id": requestId },
      }
    );
  } catch {
    return Response.json({ error: { code: "UPSTREAM_ERROR", message: "Could not reach PostHog." } }, { status: 502 });
  }
}
