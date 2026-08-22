// Real WorkerResolver: wraps the resolver-aware routeSelector and
// adapts VideoRouteCandidate → engine SelectedWorkerRoute.

import type { Capability, SelectedWorkerRoute } from "../engine/types/index.js";
import type { WorkerResolver } from "../engine/interfaces/index.js";
import {
  createRouteSelector,
  type VideoRouteSelector,
  type VideoRouteSelectorConfig,
} from "./routeSelector.js";
import { routeRequirementForCapability } from "./capabilityMap.js";

export interface ResolverWorkerResolverConfig extends VideoRouteSelectorConfig {
  defaultWorkUnit?: string;
}

export interface ResolverWorkerResolverHandle {
  resolver: WorkerResolver;
  selector: VideoRouteSelector;
  close(): Promise<void>;
}

export function createResolverWorkerResolver(
  cfg: ResolverWorkerResolverConfig,
): ResolverWorkerResolverHandle {
  const selector = createRouteSelector(cfg);
  const defaultWorkUnit = cfg.defaultWorkUnit ?? "seconds";

  const resolver: WorkerResolver = {
    async selectWorker(input) {
      const candidates = await selector.select({
        capability: input.capability,
        offering: input.offering,
        protocolRequirement: routeRequirementForCapability(input.capability),
      });
      const first = candidates[0];
      if (!first) return null;

      const route: SelectedWorkerRoute = {
        workerUrl: first.brokerUrl,
        ethAddress: first.ethAddress,
        capability: first.capability as Capability,
        offering: first.offering,
        pricePerWorkUnitWei: first.pricePerWorkUnitWei,
        workUnit: first.workUnit || defaultWorkUnit,
        protocol: first.protocol,
        job: first.job,
        session: first.session,
        workUnitEstimator: first.workUnitEstimator,
        settlementKeys: first.settlementKeys,
        ...(first.unitsPerPrice !== null ? { unitsPerPrice: first.unitsPerPrice } : {}),
        ...(first.quoteId !== null ? { quoteId: first.quoteId } : {}),
        ...(first.quoteVersion !== null ? { quoteVersion: first.quoteVersion } : {}),
        ...(first.constraintFingerprint !== null
          ? { constraintFingerprint: first.constraintFingerprint }
          : {}),
        ...(first.routeFingerprint !== null
          ? { routeFingerprint: first.routeFingerprint }
          : {}),
        ...(first.extra !== null ? { extra: { resolverExtra: first.extra } } : {}),
        ...(first.constraints !== null
          ? { constraints: { resolverConstraints: first.constraints } }
          : {}),
      };
      return route;
    },
  };

  return {
    resolver,
    selector,
    async close() {
      await selector.close?.();
    },
  };
}
