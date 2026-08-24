import type { z } from "zod";

export type LocTransportErrorCode =
  | "loc_request_invalid"
  | "loc_timeout"
  | "loc_unavailable"
  | "loc_http_error"
  | "loc_response_invalid";

export class LocTransportError extends Error {
  readonly code: LocTransportErrorCode;
  readonly status?: number;
  readonly remoteCode?: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;

  constructor(
    code: LocTransportErrorCode,
    options: {
      status?: number;
      remoteCode?: string;
      retryable: boolean;
      retryAfterSeconds?: number;
    },
  ) {
    const status = options.status === undefined ? "" : ` (${options.status})`;
    const remote = options.remoteCode === undefined ? "" : `: ${options.remoteCode}`;
    super(`LOC request failed${status}${remote}`);
    this.name = "LocTransportError";
    this.code = code;
    this.status = options.status;
    this.remoteCode = options.remoteCode;
    this.retryable = options.retryable;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export interface LocRequest<T> {
  method: "GET" | "POST";
  path: string;
  schema: z.ZodType<T>;
  body?: unknown;
  idempotencyKey?: string;
}

export interface LocTransport {
  request<T>(value: LocRequest<T>): Promise<T>;
}
