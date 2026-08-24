import type { Resolution, WorkUnitEstimator } from "../types/index.js";

export const ABR_WORK_UNIT = "video-frame-megapixel";
export const ABR_ESTIMATOR_ID = "abr-output-frame-megapixels/v1";
export const ABR_ESTIMATOR_ROUNDING = "ceil-total";
export const ABR_ESTIMATOR_EXACTNESS = "ceiling";
export const FUNDING_FRAME_SLACK_SECONDS = 2;

const DIMENSIONS: Record<Resolution, { width: number; height: number }> = {
  "240p": { width: 426, height: 240 },
  "360p": { width: 640, height: 360 },
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "2160p": { width: 3840, height: 2160 },
};

export interface AbrFundingTarget {
  resolution: Resolution;
  frameRate?: number;
}

export interface AbrFundingEstimate {
  estimatedUnits: number;
  maxTotalUnits: number;
  estimatedFramesByTarget: number[];
  maximumFramesByTarget: number[];
}

export interface AbrDeliveredVideo {
  actualFrames: number;
  width: number;
  height: number;
}

export interface AbrDeliveredRendition {
  name: string;
  video?: AbrDeliveredVideo;
}

export interface AbrUsageReconciliation {
  observedUnits: number;
  signedUnits: number;
  maximumUnits: number;
  deltaUnits: number;
}

export class AbrUsageError extends Error {
  readonly code:
    | "abr_estimator_unsupported"
    | "abr_funding_input_invalid"
    | "abr_usage_input_invalid"
    | "abr_usage_exceeds_funding"
    | "abr_usage_claim_mismatch";

  constructor(code: AbrUsageError["code"]) {
    super(code);
    this.name = "AbrUsageError";
    this.code = code;
  }
}

export function estimateAbrFunding(input: {
  durationSeconds: number;
  sourceFrameRate: number;
  targets: AbrFundingTarget[];
  estimator: WorkUnitEstimator | null;
}): AbrFundingEstimate {
  requireEstimator(input.estimator);
  if (
    !finitePositive(input.durationSeconds) ||
    !finitePositive(input.sourceFrameRate) ||
    input.targets.length === 0
  ) throw new AbrUsageError("abr_funding_input_invalid");

  const estimatedFramesByTarget: number[] = [];
  const maximumFramesByTarget: number[] = [];
  const estimated: AbrDeliveredRendition[] = [];
  const maximum: AbrDeliveredRendition[] = [];
  for (const [index, target] of input.targets.entries()) {
    const dimensions = DIMENSIONS[target.resolution];
    const frameRate = target.frameRate ?? input.sourceFrameRate;
    if (!dimensions || !finitePositive(frameRate)) {
      throw new AbrUsageError("abr_funding_input_invalid");
    }
    const estimatedFrames = Math.ceil(input.durationSeconds * frameRate);
    const maximumFrames = estimatedFrames + Math.ceil(frameRate * FUNDING_FRAME_SLACK_SECONDS);
    if (!Number.isSafeInteger(estimatedFrames) || !Number.isSafeInteger(maximumFrames)) {
      throw new AbrUsageError("abr_funding_input_invalid");
    }
    estimatedFramesByTarget.push(estimatedFrames);
    maximumFramesByTarget.push(maximumFrames);
    estimated.push({ name: `estimate-${index}`, video: { actualFrames: estimatedFrames, ...dimensions } });
    maximum.push({ name: `maximum-${index}`, video: { actualFrames: maximumFrames, ...dimensions } });
  }
  return {
    estimatedUnits: calculateAbrFrameMegapixelUnits(estimated),
    maxTotalUnits: calculateAbrFrameMegapixelUnits(maximum),
    estimatedFramesByTarget,
    maximumFramesByTarget,
  };
}

export function calculateAbrFrameMegapixelUnits(renditions: AbrDeliveredRendition[]): number {
  let pixels = 0n;
  for (const rendition of renditions) {
    if (rendition.video === undefined) continue;
    const { actualFrames, width, height } = rendition.video;
    if (
      !Number.isSafeInteger(actualFrames) || actualFrames < 1 ||
      !Number.isSafeInteger(width) || width < 1 ||
      !Number.isSafeInteger(height) || height < 1
    ) throw new AbrUsageError("abr_usage_input_invalid");
    pixels += BigInt(actualFrames) * BigInt(width) * BigInt(height);
  }
  const units = (pixels + 999_999n) / 1_000_000n;
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AbrUsageError("abr_usage_input_invalid");
  }
  return Number(units);
}

export function reconcileAbrUsage(input: {
  renditions: AbrDeliveredRendition[];
  signedUnit: string;
  signedUnits: number;
  maximumUnits: number;
}): AbrUsageReconciliation {
  if (
    input.signedUnit !== ABR_WORK_UNIT ||
    !Number.isSafeInteger(input.signedUnits) || input.signedUnits < 0 ||
    !Number.isSafeInteger(input.maximumUnits) || input.maximumUnits < 1
  ) throw new AbrUsageError("abr_usage_input_invalid");
  const observedUnits = calculateAbrFrameMegapixelUnits(input.renditions);
  const result = {
    observedUnits,
    signedUnits: input.signedUnits,
    maximumUnits: input.maximumUnits,
    deltaUnits: input.signedUnits - observedUnits,
  };
  if (input.signedUnits > input.maximumUnits) {
    throw new AbrUsageError("abr_usage_exceeds_funding");
  }
  // Both sides implement the same integer formula over terminal metadata, so
  // the safe tolerance is exactly zero units. Nonzero drift is evidence that
  // the body and signed broker claim describe different delivered work.
  if (result.deltaUnits !== 0) {
    throw new AbrUsageError("abr_usage_claim_mismatch");
  }
  return result;
}

function requireEstimator(estimator: WorkUnitEstimator | null): void {
  if (
    estimator?.id !== ABR_ESTIMATOR_ID ||
    estimator.rounding !== ABR_ESTIMATOR_ROUNDING ||
    estimator.exactness !== ABR_ESTIMATOR_EXACTNESS
  ) throw new AbrUsageError("abr_estimator_unsupported");
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
