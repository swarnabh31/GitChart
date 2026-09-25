import { NextResponse } from "next/server";
import { getAIProviderConfig, getOllamaBaseUrl } from "@/server/storage/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OllamaTag {
  name: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface ModelInfo {
  id: string;
  family?: string;
  parameter_size?: string;
  quantization_level?: string;
  size?: number;
}

export async function GET() {
  try {
    const providerConfig = getAIProviderConfig();
    if (providerConfig.provider !== "ollama") {
      return NextResponse.json({ models: [], available: false, provider: providerConfig.provider }, { status: 200 });
    }
    const base = getOllamaBaseUrl();
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return NextResponse.json({ models: [], available: false }, { status: 200 });
    }
    const body = (await res.json()) as { models?: OllamaTag[] };
    const models: ModelInfo[] = (body.models ?? []).map((m) => ({
      id: m.name,
      family: m.details?.family,
      parameter_size: m.details?.parameter_size,
      quantization_level: m.details?.quantization_level,
      size: m.size,
    }));
    return NextResponse.json({ models, available: true });
  } catch {
    return NextResponse.json({ models: [], available: false }, { status: 200 });
  }
}
