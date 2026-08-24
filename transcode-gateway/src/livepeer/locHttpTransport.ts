import { z } from "zod";
import {
  LocTransportError,
  type LocRequest,
  type LocTransport,
} from "../engine/interfaces/index.js";

const MAX_RESPONSE_CHARS = 1_048_576;
const REMOTE_CODE = /^[A-Za-z0-9_.:-]{1,128}$/;
const RETRYABLE_REMOTE_CODES = new Set([
  "idempotency_in_progress",
  "idempotency_outcome_unknown",
  "daemon_unavailable",
]);

const errorEnvelope = z.object({
  error: z
    .object({
      code: z.string().optional(),
    })
    .optional(),
  detail: z.union([z.string(), z.object({ code: z.string().optional() })]).optional(),
});

export interface LocHttpTransportOptions {
  baseUrl: string;
  apiKey: string;
  clientId: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null || !/^[0-9]+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function remoteCode(body: unknown): string | undefined {
  const parsed = errorEnvelope.safeParse(body);
  if (!parsed.success) return undefined;
  const detail = parsed.data.detail;
  const candidate =
    parsed.data.error?.code ??
    (typeof detail === "string" ? detail : detail?.code);
  return candidate !== undefined && REMOTE_CODE.test(candidate)
    ? candidate
    : undefined;
}

function isRetryable(status: number, code: string | undefined): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500 ||
    (code !== undefined && RETRYABLE_REMOTE_CODES.has(code.toLowerCase()))
  );
}

function safeJson(text: string): unknown {
  if (text.length > MAX_RESPONSE_CHARS) {
    throw new LocTransportError("loc_response_invalid", { retryable: false });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LocTransportError("loc_response_invalid", { retryable: false });
  }
}

function requestUrl(baseUrl: URL, path: string): URL {
  if (!path.startsWith("/v1/") || path.includes("\\") || path.includes("//")) {
    throw new LocTransportError("loc_request_invalid", { retryable: false });
  }
  const url = new URL(path, baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new LocTransportError("loc_request_invalid", { retryable: false });
  }
  return url;
}

function validateRequest<T>(value: LocRequest<T>): void {
  if (value.method === "POST") {
    if (
      value.idempotencyKey === undefined ||
      value.idempotencyKey.length === 0 ||
      value.idempotencyKey.length > 255 ||
      !/^[\x21-\x7e]+$/.test(value.idempotencyKey)
    ) {
      throw new LocTransportError("loc_request_invalid", { retryable: false });
    }
  } else if (value.body !== undefined || value.idempotencyKey !== undefined) {
    throw new LocTransportError("loc_request_invalid", { retryable: false });
  }
}

export function createLocHttpTransport(
  options: LocHttpTransportOptions,
): LocTransport {
  const baseUrl = new URL(options.baseUrl);
  if (
    (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
    baseUrl.username !== "" ||
    baseUrl.password !== "" ||
    baseUrl.pathname !== "/" ||
    baseUrl.search !== "" ||
    baseUrl.hash !== ""
  ) {
    throw new Error("LOC URL must use HTTP or HTTPS");
  }
  if (
    options.apiKey.length === 0 ||
    options.clientId.length === 0 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1
  ) {
    throw new Error("LOC HTTP transport options are invalid");
  }
  const fetchImpl = options.fetch ?? fetch;

  return {
    async request<T>(value: LocRequest<T>): Promise<T> {
      validateRequest(value);
      const url = requestUrl(baseUrl, value.path);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      let body: string | undefined;
      try {
        body = value.body === undefined ? undefined : JSON.stringify(value.body);
      } catch {
        clearTimeout(timeout);
        throw new LocTransportError("loc_request_invalid", { retryable: false });
      }

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: value.method,
          headers: {
            "X-API-Key": options.apiKey,
            "Livepeer-Open-Clearinghouse-SDK": options.clientId,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(value.idempotencyKey === undefined
              ? {}
              : { "Idempotency-Key": value.idempotencyKey }),
          },
          ...(body === undefined ? {} : { body }),
          signal: controller.signal,
          redirect: "error",
        });
      } catch {
        throw new LocTransportError(
          controller.signal.aborted ? "loc_timeout" : "loc_unavailable",
          { retryable: true },
        );
      } finally {
        clearTimeout(timeout);
      }

      const text = await response.text().catch(() => "");
      if (!response.ok) {
        let parsed: unknown;
        try {
          parsed = safeJson(text);
        } catch {
          parsed = undefined;
        }
        const code = remoteCode(parsed);
        throw new LocTransportError("loc_http_error", {
          status: response.status,
          remoteCode: code,
          retryable: isRetryable(response.status, code),
          retryAfterSeconds: retryAfterSeconds(response),
        });
      }

      const parsed = safeJson(text);
      const result = value.schema.safeParse(parsed);
      if (!result.success) {
        throw new LocTransportError("loc_response_invalid", {
          status: response.status,
          retryable: false,
        });
      }
      return result.data;
    },
  };
}
