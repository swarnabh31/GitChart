import type { AIProvider } from "./ai/provider";
import type { RepoMetadata } from "./github";
import type { RepoDigest } from "./digest";
import type { RedisStore } from "./storage/redis";
import type { RateLimitResult } from "./rate-limit";
import type { ArchitectureBrief, DiagramGraph } from "./diagram-schema";

export interface DiagramComponent {
  id: string;
  label: string;
  file_path: string;
  summary: string;
}

export interface DiagramResult {
  id: string;
  owner: string;
  repo: string;
  default_branch: string;
  mermaid_source: string;
  components: DiagramComponent[];
  explanation: string;
  provider: string;
  created_at: string;
  cached: boolean;
  graph?: DiagramGraph;
  brief?: ArchitectureBrief;
}

export type ServerEvent =
  | { type: "phase"; label: string; detail?: string }
  | { type: "explanation_chunk"; delta: string }
  | { type: "architecture_brief"; payload: ArchitectureBrief }
  | { type: "diagram_ready"; payload: DiagramResult }
  | { type: "error"; code: string; message: string };

export interface PipelineDeps {
  provider: AIProvider;
  explanationModel: string;
  diagramModel: string;
  meta: RepoMetadata;
  digest: RepoDigest;
  checkRateLimit: () => Promise<RateLimitResult>;
  redis: RedisStore;
  ttlSeconds: number;
  signal?: AbortSignal;
  onEvent?: (event: ServerEvent) => void;
}
