// Modeled on livepeer-network-modules/video-gateway/src/engine/types/error.ts.
// WalletReserveFailed + PaymentRequired dropped (no billing in v0).

export class VideoCoreError extends Error {
  readonly code: VideoCoreErrorCode;
  readonly details?: unknown;

  constructor(code: VideoCoreErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "VideoCoreError";
    this.code = code;
    this.details = details;
  }
}

export type VideoCoreErrorCode =
  | "NotFound"
  | "NotImplemented"
  | "Unauthorized"
  | "Forbidden"
  | "BadRequest"
  | "Conflict"
  | "TooManyRequests"
  | "NoWorkersAvailable"
  | "WorkerError"
  | "StorageError"
  | "InternalError";
