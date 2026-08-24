import { createHash } from "node:crypto";
import { z } from "zod";
import type { PaidJobSettlement } from "../interfaces/index.js";
import type { JsonValue } from "../types/index.js";
import { ABR_WORK_UNIT, reconcileAbrUsage } from "./vodUsage.js";

export const ABR_REQUEST_SCHEMA = "video-transcode-abr/v2";
export const ABR_RESULT_SCHEMA = "video-transcode-abr-result/v2";

const artifact = z.object({ artifact_uri: z.string().min(1), upload_url: z.string().url() }).strict();
const requestWire = z.object({
  schema: z.literal(ABR_REQUEST_SCHEMA),
  workload_id: z.string().min(1),
  input: z.object({ download_url: z.string().url(), content_sha256: z.string().regex(/^[0-9a-f]{64}$/).optional() }).strict(),
  ladder: z.object({ preset: z.string().min(1) }).strict(),
  output: z.object({
    manifest: artifact,
    renditions: z.record(z.string(), z.object({ playlist: artifact, stream: artifact }).strict()),
  }).strict(),
}).strict();
const renditionWire = z.object({
  name: z.string().min(1),
  playlist_uri: z.string().min(1),
  stream_uri: z.string().min(1),
  video: z.object({
    actual_frames: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict().optional(),
  file_size_bytes: z.number().int().nonnegative(),
}).strict();
const terminalWire = z.object({
  schema: z.literal(ABR_RESULT_SCHEMA),
  workload_id: z.string().min(1),
  request_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  outcome: z.literal("succeeded"),
  manifest_uri: z.string().min(1),
  renditions: z.array(renditionWire).min(1),
  usage: z.object({ unit: z.literal(ABR_WORK_UNIT), units: z.number().int().nonnegative() }).strict(),
}).strict();
const terminalErrorWire = z.object({
  schema: z.literal(ABR_RESULT_SCHEMA),
  workload_id: z.string().min(1),
  request_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  outcome: z.literal("failed"),
  error: z.object({ code: z.string().min(1), message: z.string().min(1).max(512), retryable: z.boolean() }).strict(),
  usage: z.object({ unit: z.literal(ABR_WORK_UNIT), units: z.literal(0) }).strict(),
}).strict();

export interface AbrExchangeRequest {
  schema: typeof ABR_REQUEST_SCHEMA;
  workload_id: string;
  input: { download_url: string; content_sha256?: string };
  ladder: { preset: string };
  output: {
    manifest: { artifact_uri: string; upload_url: string };
    renditions: Record<string, {
      playlist: { artifact_uri: string; upload_url: string };
      stream: { artifact_uri: string; upload_url: string };
    }>;
  };
}

export type AbrTerminalResult = z.infer<typeof terminalWire>;

export class AbrExchangeError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable = false) {
    super(code);
    this.name = "AbrExchangeError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function encodeAbrExchangeRequest(value: AbrExchangeRequest): {
  body: Uint8Array;
  sha256: string;
  json: JsonValue;
} {
  const parsed = requestWire.safeParse(value);
  if (!parsed.success) throw new AbrExchangeError("abr_request_invalid");
  const body = Buffer.from(JSON.stringify(parsed.data), "utf8");
  return {
    body,
    sha256: createHash("sha256").update(body).digest("hex"),
    json: parsed.data as JsonValue,
  };
}

export function validateAbrTerminal(input: {
  brokerBody: Uint8Array;
  settlement: PaidJobSettlement;
  workloadId: string;
  requestSha256: string;
  maximumUnits: number;
}): AbrTerminalResult {
  const candidate = terminalJsonFromSse(input.brokerBody);
  const failed = terminalErrorWire.safeParse(candidate);
  if (failed.success) {
    if (
      failed.data.workload_id !== input.workloadId ||
      failed.data.request_sha256 !== input.requestSha256
    ) throw new AbrExchangeError("abr_terminal_identity_mismatch");
    throw new AbrExchangeError(failed.data.error.code, failed.data.error.retryable);
  }
  const result = terminalWire.safeParse(candidate);
  if (!result.success) throw new AbrExchangeError("abr_terminal_invalid");
  if (
    result.data.workload_id !== input.workloadId ||
    result.data.request_sha256 !== input.requestSha256 ||
    result.data.usage.units !== input.settlement.actualUnits ||
    result.data.usage.unit !== input.settlement.workUnit
  ) throw new AbrExchangeError("abr_terminal_identity_mismatch");
  reconcileAbrUsage({
    renditions: result.data.renditions.map((rendition) => ({
      name: rendition.name,
      ...(rendition.video === undefined
        ? {}
        : {
            video: {
              actualFrames: rendition.video.actual_frames,
              width: rendition.video.width,
              height: rendition.video.height,
            },
          }),
    })),
    signedUnit: input.settlement.workUnit,
    signedUnits: input.settlement.actualUnits,
    maximumUnits: input.maximumUnits,
  });
  return result.data;
}

function terminalJsonFromSse(body: Uint8Array): unknown {
  const text = Buffer.from(body).toString("utf8");
  let terminal: unknown;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data.length === 0) continue;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (
        parsed !== null && typeof parsed === "object" &&
        (parsed as { schema?: unknown }).schema === ABR_RESULT_SCHEMA
      ) terminal = parsed;
    } catch {
      throw new AbrExchangeError("abr_sse_invalid");
    }
  }
  if (terminal === undefined) throw new AbrExchangeError("abr_terminal_missing");
  return terminal;
}
