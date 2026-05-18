// Modeled on livepeer-network-modules/video-gateway/src/livepeer/requestId.ts.

import { randomBytes } from "node:crypto";

export function newRequestId(): string {
  return `req_${randomBytes(8).toString("hex")}`;
}
