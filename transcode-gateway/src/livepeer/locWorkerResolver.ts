import { z } from "zod";
import { LocTransportError, type LocTransport, type WorkerResolver } from "../engine/interfaces/index.js";
import { mapRouteSnapshot, routeBindingWire, routeSnapshotWire } from "./locClient.js";

// The nested snapshot is the canonical contract also returned by paid opens.
// Outer display fields are intentionally not used to construct a paid route.
const discoveryWire = z.object({
  route_snapshot: routeSnapshotWire,
  route_binding: routeBindingWire,
});

export function createLocWorkerResolver(transport: LocTransport): WorkerResolver {
  return {
    async selectWorker(input) {
      let response;
      try {
        response = await transport.request({
          method: "GET",
          path: `/v1/routes?${new URLSearchParams({ capability: input.capability, offering: input.offering })}`,
          schema: discoveryWire,
        });
      } catch (error) {
        if (error instanceof LocTransportError && error.status === 404 && error.remoteCode?.toLowerCase() === "no_route_available") return null;
        throw error;
      }
      const snapshot = response.route_snapshot;
      if (
        snapshot.capability !== input.capability || snapshot.offering !== input.offering ||
        snapshot.settlement_domain_id === `0x${"0".repeat(64)}` ||
        Object.entries(response.route_binding).some(([key, value]) => snapshot[key as keyof typeof snapshot] !== value)
      ) throw new LocTransportError("loc_response_invalid", { retryable: false });

      const route = mapRouteSnapshot(snapshot);
      if (input.capability === "video:transcode.abr") {
        if (route.protocol !== "paid-job/v1" || !route.job?.transports.includes("stream") || route.workUnit !== "video-frame-megapixel") return null;
      } else if (
        route.protocol !== "paid-session/v1" || route.workUnit !== "output_seconds" ||
        route.session?.descriptorSchema !== "rtmp-hls/v1" ||
        route.session.attachment !== "external" || route.session.metering !== "runner-reported"
      ) return null;

      return {
        workerUrl: route.brokerUrl,
        ethAddress: route.ethAddress,
        capability: input.capability,
        offering: route.offering,
        pricePerWorkUnitWei: route.pricePerWorkUnitWei,
        unitsPerPrice: route.unitsPerPrice,
        workUnit: route.workUnit,
        protocol: route.protocol,
        job: route.job,
        session: route.session,
        workUnitEstimator: route.workUnitEstimator,
        settlementKeys: route.settlementKeys,
        settlementDomainId: route.settlementDomainId,
        quoteId: route.binding.quoteId,
        quoteVersion: route.binding.quoteVersion,
        constraintFingerprint: Buffer.from(route.binding.constraintFingerprint, "hex"),
        routeFingerprint: Buffer.from(route.binding.routeFingerprint, "hex"),
        extra: { resolverExtra: route.extra },
      };
    },
  };
}
