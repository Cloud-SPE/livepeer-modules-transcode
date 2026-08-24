import type { ProbeResult } from "../types/index.js";

export interface SourceProbe {
  probe(inputUrl: string): Promise<ProbeResult>;
}

export class SourceProbeError extends Error {
  readonly code: "source_probe_invalid" | "source_probe_timeout" | "source_probe_failed";
  readonly retryable: boolean;

  constructor(code: SourceProbeError["code"], retryable: boolean) {
    super(code);
    this.name = "SourceProbeError";
    this.code = code;
    this.retryable = retryable;
  }
}
