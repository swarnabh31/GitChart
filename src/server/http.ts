import { randomUUID } from "node:crypto";

export function requestIdFromHeaders(headers: Headers): string {
  const existing = headers.get("x-request-id");
  if (existing && /^[a-zA-Z0-9._-]{1,64}$/.test(existing)) return existing;
  return `req_${randomUUID().slice(0, 12)}`;
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "local";
}

export function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "content-type": "application/json" } }
  );
}
