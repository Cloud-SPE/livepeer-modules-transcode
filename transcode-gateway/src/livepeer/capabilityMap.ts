// Modeled on livepeer-network-modules/video-gateway/src/livepeer/capabilityMap.ts.

import type { Capability } from "../engine/types/index.js";
import type { RouteProtocolRequirement } from "./routeProtocol.js";

export const PROTOCOL = {
  PAID_JOB: "paid-job/v1",
  PAID_SESSION: "paid-session/v1",
} as const;

export const CAPABILITY_ROUTE_REQUIREMENTS: Record<Capability, RouteProtocolRequirement> = {
  "video:transcode.abr": {
    protocol: PROTOCOL.PAID_JOB,
    // ABR requests are JSON, not multipart. The exact unary-vs-stream
    // choice is made by the paid-job client for each exchange.
    acceptedTransports: ["unary", "stream"],
  },
  "video:live.rtmp": {
    protocol: PROTOCOL.PAID_SESSION,
    descriptorSchema: "rtmp-hls/v1",
    attachment: "external",
  },
};

export function routeRequirementForCapability(capability: Capability): RouteProtocolRequirement {
  return CAPABILITY_ROUTE_REQUIREMENTS[capability];
}
