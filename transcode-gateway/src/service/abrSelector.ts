// Modeled on livepeer-network-modules/video-gateway/src/service/abrSelector.ts.
// For v0 every API key is "prepaid" tier → "standard" encoding ladder.
// Per-customer tier negotiation is deferred to phase 2.

import type { EncodingTier, RenditionSpec } from "../engine/types/index.js";
import { expandTier, type EncodingLadder } from "../engine/config/encodingLadder.js";

export type CustomerTier = "free" | "prepaid" | "enterprise";
export type AbrPolicy = "customer-tier";

const TIER_TO_ENCODING_TIER: Record<CustomerTier, EncodingTier> = {
  free: "baseline",
  prepaid: "standard",
  enterprise: "premium",
};

export interface SelectAbrInput {
  customerTier: CustomerTier;
  policy: AbrPolicy;
  ladder?: EncodingLadder;
}

export function selectAbrLadder(input: SelectAbrInput): RenditionSpec[] {
  if (input.policy !== "customer-tier") {
    throw new Error(`unsupported ABR policy: ${input.policy}`);
  }
  const encodingTier = TIER_TO_ENCODING_TIER[input.customerTier];
  return expandTier(encodingTier, input.ladder);
}
