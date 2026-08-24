import type { LocOpenJobResult, LocSettleJobResult, LocSettlementEnvelope } from "./locClient.js";
import type { PaidJobTransport, SelectedWorkerRoute } from "../types/index.js";

export interface PaidJobRequest {
  requestId: string;
  route: SelectedWorkerRoute;
  transport: PaidJobTransport;
  estimatedUnits: number;
  maxTotalUnits?: number;
  contentType: string;
  body: Uint8Array;
  validateTerminal?: (input: {
    brokerBody: Uint8Array;
    settlement: PaidJobSettlement;
  }) => void | Promise<void>;
}

export interface PaidJobSettlement {
  brokerJobId: string;
  actualUnits: number;
  workUnit: string;
  outcome: string;
  envelope: LocSettlementEnvelope;
}

export interface PaidJobSettledResult {
  kind: "settled";
  opened: LocOpenJobResult;
  brokerStatus: number | null;
  brokerContentType: string | null;
  brokerBody: Uint8Array | null;
  settlement: PaidJobSettlement;
  accounting: LocSettleJobResult;
}

export type PaidJobUnresolvedResult =
  | { kind: "in_flight"; opened: LocOpenJobResult; brokerJobId: string }
  | { kind: "accounting_pending"; opened: LocOpenJobResult; brokerJobId: string }
  | { kind: "not_admitted"; opened: LocOpenJobResult; evidence: string }
  | { kind: "no_record"; opened: LocOpenJobResult }
  | { kind: "admitted_outcome_unknown"; opened: LocOpenJobResult; brokerJobId: string }
  | { kind: "admitted_evidence_expired"; opened: LocOpenJobResult; brokerJobId: string };

export type PaidJobResult = PaidJobSettledResult | PaidJobUnresolvedResult;

export interface PaidJobClient {
  execute(input: PaidJobRequest): Promise<PaidJobResult>;
  recover(opened: LocOpenJobResult): Promise<PaidJobUnresolvedResult | {
    kind: "settled";
    opened: LocOpenJobResult;
    settlement: PaidJobSettlement;
    accounting: LocSettleJobResult;
  }>;
}

export class PaidJobClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, options: { retryable: boolean; cause?: unknown }) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PaidJobClientError";
    this.code = code;
    this.retryable = options.retryable;
  }
}
