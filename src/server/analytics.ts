import { getPostHogConfig } from "./storage/config";

export interface AnalyticsEvent {
  event: string;
  distinctId?: string;
  properties?: Record<string, unknown>;
}

export type AnalyticsEmitter = (properties: Record<string, unknown>) => void;

export function analyticsEmitter(
  distinctId: string,
  env: NodeJS.ProcessEnv = process.env
): AnalyticsEmitter {
  const config = getPostHogConfig(env);
  if (!config.publicKey) {
    return () => {};
  }
  return (properties) => {
    const payload = {
      distinct_id: distinctId,
      event: properties.event,
      properties: {
        ...(properties as Record<string, unknown>),
        $lib: "posthog-node",
      },
    };
    const host = config.host.replace(/\/$/, "");
    // Fire-and-forget; must never break the request or log secrets.
    void fetch(`${host}/capture/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.publicKey}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  };
}

export function repoProperties(owner: string, repo: string) {
  return { owner, repo, full_name: `${owner}/${repo}` };
}
