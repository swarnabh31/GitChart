export const STAGE_MESSAGES = {
  EXP_INVALID: "The first model pass returned an unparseable architecture summary.",
  GRAPH_INVALID: "The diagram model produced an invalid graph after retries.",
} as const;

export type StageCode = keyof typeof STAGE_MESSAGES;

export class PipelineError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
    this.status = status;
  }
}

export class PipelineStageError extends Error {
  readonly code: StageCode;
  readonly status = 502;
  readonly issues: string[];
  readonly lastRaw?: string;

  constructor(code: StageCode, issues: string[] = [], lastRaw?: string) {
    super([STAGE_MESSAGES[code], ...issues.slice(0, 3).map((i) => i.slice(0, 120))].join(" "));
    this.name = "PipelineStageError";
    this.code = code;
    this.issues = issues;
    this.lastRaw = lastRaw;
  }
}
