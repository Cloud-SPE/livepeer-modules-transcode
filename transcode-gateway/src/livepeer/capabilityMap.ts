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

export const MODE = {
  RTMP_INGRESS_HLS_EGRESS: "rtmp-ingress-hls-egress@v0",
  HTTP_REQRESP: "http-reqresp@v0",
  HTTP_STREAM: "http-stream@v0",
} as const;

export type Mode = (typeof MODE)[keyof typeof MODE];

export const CAPABILITY_MODES: Record<Capability, Mode> = {
  "video:transcode.abr": MODE.HTTP_REQRESP,
  "video:live.rtmp": MODE.RTMP_INGRESS_HLS_EGRESS,
};

export function modeForCapability(cap: Capability): Mode {
  return CAPABILITY_MODES[cap];
}
