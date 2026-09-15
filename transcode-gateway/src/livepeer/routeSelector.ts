// Modeled on livepeer-network-modules/video-gateway/src/livepeer/routeSelector.ts.
// Edits per docs/exec-plans/active/0004-wire-layer-port.md §3.1:
//   - Drop the static-LIVEPEER_BROKER_URL fallback branch entirely (resolver-only per core-beliefs §2).
//   - Drop cfg.brokerUrl from VideoRouteSelectorConfig.

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

import type { IncomingHttpHeaders } from "node:http";
import type {
  LivepeerProtocol,
  PaidJobAxes,
  PaidSessionAxes,
  SettlementKey,
  WorkUnitEstimator,
} from "../engine/types/index.js";
import {
  RouteHealthTracker,
  type RouteHealthMetrics,
  type RouteHealthSnapshot,
  type RouteOutcome,
} from "./routeHealth.js";
import {
  compareCandidates,
  isSubset,
  mergeJsonObjects,
  mergeSelectorValue,
  parseBigIntHeader,
  parseOpaqueBytes,
  parseJsonHeader,
  parseOptionalUint64,
  parseOpaqueJson,
  safeBigInt,
} from "./routeSelectorHelpers.js";
import {
  parseRouteProtocolDeclaration,
  parseSettlementKeys,
  parseWorkUnitEstimator,
  routeSatisfiesRequirement,
  type RouteProtocolRequirement,
} from "./routeProtocol.js";

const RESOLVER_PROTO_FILES = [
  "livepeer/registry/v1/types.proto",
  "livepeer/registry/v1/resolver.proto",
];

export const SELECTOR_HEADER = {
  EXTRA: "livepeer-selector-extra",
  CONSTRAINTS: "livepeer-selector-constraints",
  MAX_PRICE_WEI: "livepeer-selector-max-price-wei",
} as const;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface VideoRouteCandidate {
  brokerUrl: string;
  ethAddress: string;
  capability: string;
  offering: string;
  pricePerWorkUnitWei: string;
  workUnit: string;
  protocol: LivepeerProtocol;
  job: PaidJobAxes | null;
  session: PaidSessionAxes | null;
  workUnitEstimator: WorkUnitEstimator | null;
  settlementKeys: SettlementKey[];
  settlementDomainId: string | null;
  quoteId: string | null;
  quoteVersion: string | null;
  constraintFingerprint: Uint8Array | null;
  routeFingerprint: Uint8Array | null;
  unitsPerPrice: string | null;
  extra: JsonValue | null;
  constraints: JsonValue | null;
}

export interface VideoRouteSelectorConfig {
  resolverSocket: string;
  resolverProtoRoot: string;
  resolverSnapshotTtlMs: number;
  routeFailureThreshold: number;
  routeCooldownMs: number;
}

export interface VideoRouteSelector {
  select(input: {
    capability: string;
    offering: string;
    headers?: IncomingHttpHeaders;
    preferredExtra?: JsonValue | null;
    requiredConstraints?: JsonValue | null;
    maxPricePerUnitWei?: bigint | null;
    protocolRequirement?: RouteProtocolRequirement;
    supportFilter?: (candidate: VideoRouteCandidate) => boolean;
  }): Promise<VideoRouteCandidate[]>;
  inspect(): Promise<VideoRouteCandidate[]>;
  suppressBroker(brokerUrl: string): Promise<void>;
  unsuppressBroker(brokerUrl: string): Promise<void>;
  suppressedBrokers(): Promise<string[]>;
  recordOutcome(candidate: VideoRouteCandidate, outcome: RouteOutcome, reason?: string): Promise<void>;
  inspectHealth(): Promise<RouteHealthSnapshot[]>;
  inspectMetrics(): Promise<RouteHealthMetrics>;
  close?(): Promise<void>;
}

interface ResolverClient extends grpc.Client {
  selectMany(
    req: SelectRequest,
    cb: (err: grpc.ServiceError | null, resp: { routes: SelectedRoute[] }) => void,
  ): void;
  listKnown(
    req: Record<string, never>,
    cb: (err: grpc.ServiceError | null, resp: { entries: KnownEntry[] }) => void,
  ): void;
  resolveByAddress(
    req: ResolveByAddressRequest,
    cb: (err: grpc.ServiceError | null, resp: ResolveResult) => void,
  ): void;
}

interface ResolverProto {
  livepeer: { registry: { v1: { Resolver: grpc.ServiceClientConstructor } } };
}

interface KnownEntry {
  ethAddress: string;
}

interface ResolveByAddressRequest {
  ethAddress: string;
  allowLegacyFallback: boolean;
  allowUnsigned: boolean;
  forceRefresh: boolean;
}

interface ResolveResult {
  nodes: ResolverNode[];
}

interface SelectRequest {
  capability: string;
  offering: string;
  tier: string;
  minWeight: number;
}

interface SelectedRoute {
  workerUrl: string;
  ethAddress: string;
  capability: string;
  offering: string;
  pricePerWorkUnitWei: string;
  workUnit: string;
  extraJson?: Buffer | Uint8Array | string;
  constraintsJson?: Buffer | Uint8Array | string;
  quoteId?: string;
  quoteVersion?: number | string;
  constraintFingerprint?: Buffer | Uint8Array | string;
  routeFingerprint?: Buffer | Uint8Array | string;
  unitsPerPrice?: number | string;
  protocol?: string;
  settlementKeys?: unknown[];
  workUnitEstimator?: unknown;
  settlementDomainId?: string;
}

interface ResolverNode {
  url: string;
  operatorAddress: string;
  enabled: boolean;
  extraJson?: Buffer | Uint8Array | string;
  capabilities: ResolverCapability[];
}

interface ResolverCapability {
  name: string;
  workUnit: string;
  workUnitEstimator?: unknown;
  extraJson?: Buffer | Uint8Array | string;
  offerings: ResolverOffering[];
}

interface ResolverOffering {
  id: string;
  pricePerWorkUnitWei: string;
  constraintsJson?: Buffer | Uint8Array | string;
}

interface CachedSnapshot {
  expiresAt: number;
  candidates: VideoRouteCandidate[];
}

export function createRouteSelector(cfg: VideoRouteSelectorConfig): VideoRouteSelector {
  const suppressed = new Set<string>();
  const health = new RouteHealthTracker({
    failureThreshold: Math.max(1, cfg.routeFailureThreshold),
    cooldownMs: Math.max(1_000, cfg.routeCooldownMs),
  });

  const client = newResolverClient(cfg.resolverSocket, cfg.resolverProtoRoot);
  const selectCache = new Map<string, CachedSnapshot>();
  let inspectCache: CachedSnapshot | null = null;

  return {
    async select(input) {
      const snapshot = await loadSelectSnapshot(client, cfg, selectCache, input.capability, input.offering);

      const preferredExtra = mergeSelectorValue(
        parseJsonHeader(input.headers?.[SELECTOR_HEADER.EXTRA]),
        input.preferredExtra ?? null,
      );
      const requiredConstraints = mergeSelectorValue(
        parseJsonHeader(input.headers?.[SELECTOR_HEADER.CONSTRAINTS]),
        input.requiredConstraints ?? null,
      );
      const maxPricePerUnitWei =
        input.maxPricePerUnitWei ??
        parseBigIntHeader(input.headers?.[SELECTOR_HEADER.MAX_PRICE_WEI]);

      const matches = snapshot.candidates.filter((candidate) => {
        if (suppressed.has(candidate.brokerUrl)) return false;
        if (candidate.capability !== input.capability) return false;
        if (candidate.offering !== input.offering) return false;
        if (
          input.protocolRequirement &&
          !routeSatisfiesRequirement(candidate, input.protocolRequirement)
        ) {
          return false;
        }
        if (
          maxPricePerUnitWei !== null &&
          safeBigInt(candidate.pricePerWorkUnitWei) > maxPricePerUnitWei
        ) {
          return false;
        }
        if (requiredConstraints !== null && !isSubset(candidate.constraints, requiredConstraints)) {
          return false;
        }
        if (input.supportFilter && !input.supportFilter(candidate)) return false;
        return true;
      });

      matches.sort((a, b) => compareCandidates(a, b, preferredExtra));
      return health.rankCandidates(matches);
    },

    async inspect() {
      const snapshot = await loadSnapshot(client, cfg, inspectCache);
      inspectCache = snapshot;
      return snapshot.candidates;
    },

    async suppressBroker(brokerUrl) {
      suppressed.add(brokerUrl);
    },
    async unsuppressBroker(brokerUrl) {
      suppressed.delete(brokerUrl);
    },
    async suppressedBrokers() {
      return [...suppressed.values()].sort();
    },
    async recordOutcome(candidate, outcome, reason) {
      health.record(candidate, outcome, reason);
    },
    async inspectHealth() {
      return health.inspect();
    },
    async inspectMetrics() {
      return health.inspectMetrics();
    },
    async close() {
      client.close();
    },
  };
}

function newResolverClient(socketPath: string, protoRoot: string): ResolverClient {
  const def = protoLoader.loadSync(RESOLVER_PROTO_FILES, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [protoRoot],
  });
  const proto = grpc.loadPackageDefinition(def) as unknown as ResolverProto;
  const ClientCtor = proto.livepeer.registry.v1.Resolver;
  return new ClientCtor(`unix:${socketPath}`, grpc.credentials.createInsecure()) as unknown as ResolverClient;
}

async function loadSnapshot(
  client: ResolverClient,
  cfg: VideoRouteSelectorConfig,
  cached: CachedSnapshot | null,
): Promise<CachedSnapshot> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached;

  const known = await new Promise<KnownEntry[]>((resolve, reject) => {
    client.listKnown({}, (err, resp) => (err ? reject(err) : resolve(resp.entries ?? [])));
  });

  const resolved = await Promise.all(
    known.map(
      (entry) =>
        new Promise<ResolveResult>((resolve, reject) => {
          client.resolveByAddress(
            {
              ethAddress: entry.ethAddress,
              allowLegacyFallback: true,
              allowUnsigned: false,
              forceRefresh: false,
            },
            (err, resp) => (err ? reject(err) : resolve(resp)),
          );
        }),
    ),
  );

  return {
    expiresAt: now + cfg.resolverSnapshotTtlMs,
    candidates: resolved.flatMap(flattenResolveResult),
  };
}

async function loadSelectSnapshot(
  client: ResolverClient,
  cfg: VideoRouteSelectorConfig,
  cached: Map<string, CachedSnapshot>,
  capability: string,
  offering: string,
): Promise<CachedSnapshot> {
  const key = `${capability}\n${offering}`;
  const now = Date.now();
  const existing = cached.get(key);
  if (existing && existing.expiresAt > now) return existing;

  const routes = await new Promise<SelectedRoute[]>((resolve, reject) => {
    client.selectMany(
      {
        capability,
        offering,
        tier: "",
        minWeight: 0,
      },
      (err, resp) => (err ? reject(err) : resolve(resp.routes ?? [])),
    );
  });

  const snapshot = {
    expiresAt: now + cfg.resolverSnapshotTtlMs,
    candidates: routes.flatMap((route) => {
      const candidate = flattenSelectedRoute(route);
      return candidate ? [candidate] : [];
    }),
  };
  cached.set(key, snapshot);
  return snapshot;
}

function flattenResolveResult(resolved: ResolveResult): VideoRouteCandidate[] {
  const out: VideoRouteCandidate[] = [];
  for (const node of resolved.nodes ?? []) {
    if (!node.enabled || !node.url) continue;
    const nodeExtra = parseOpaqueJson(node.extraJson);
    for (const capability of node.capabilities ?? []) {
      const mergedExtra = mergeJsonObjects(nodeExtra, parseOpaqueJson(capability.extraJson));
      const protocol = protocolFromExtra(mergedExtra);
      const declaration = parseRouteProtocolDeclaration(protocol, mergedExtra);
      if (!declaration) continue;
      const estimator = parseOptionalEstimator(capability.workUnitEstimator);
      if (estimator === false) continue;
      for (const offering of capability.offerings ?? []) {
        out.push({
          brokerUrl: node.url,
          ethAddress: node.operatorAddress,
          capability: capability.name,
          offering: offering.id,
          pricePerWorkUnitWei: offering.pricePerWorkUnitWei ?? "0",
          workUnit: capability.workUnit ?? "seconds",
          protocol: declaration.protocol,
          job: declaration.job,
          session: declaration.session,
          workUnitEstimator: estimator,
          // ResolveByAddress is an inspection surface; delegated keys are
          // available on the dispatch-safe Select/SelectMany result.
          settlementKeys: [],
          settlementDomainId: null,
          quoteId: null,
          quoteVersion: null,
          constraintFingerprint: null,
          routeFingerprint: null,
          unitsPerPrice: null,
          extra: mergedExtra,
          constraints: parseOpaqueJson(offering.constraintsJson),
        });
      }
    }
  }
  return out;
}

function flattenSelectedRoute(route: SelectedRoute): VideoRouteCandidate | null {
  const extra = parseOpaqueJson(route.extraJson);
  const declaration = parseRouteProtocolDeclaration(route.protocol ?? "", extra);
  if (!declaration) return null;
  const estimator = parseOptionalEstimator(route.workUnitEstimator);
  if (estimator === false) return null;
  const settlementKeys = parseSettlementKeys(route.settlementKeys ?? []);
  const settlementDomainId = parseSettlementDomainId(route.settlementDomainId);
  if (!settlementKeys || settlementKeys.length === 0 || !settlementDomainId) return null;
  return {
    brokerUrl: route.workerUrl,
    ethAddress: route.ethAddress,
    capability: route.capability,
    offering: route.offering,
    pricePerWorkUnitWei: route.pricePerWorkUnitWei ?? "0",
    workUnit: route.workUnit ?? "seconds",
    protocol: declaration.protocol,
    job: declaration.job,
    session: declaration.session,
    workUnitEstimator: estimator,
    settlementKeys,
    settlementDomainId,
    quoteId: route.quoteId ?? null,
    quoteVersion: parseOptionalUint64(route.quoteVersion),
    constraintFingerprint: parseOpaqueBytes(route.constraintFingerprint),
    routeFingerprint: parseOpaqueBytes(route.routeFingerprint),
    unitsPerPrice: parseOptionalUint64(route.unitsPerPrice),
    extra,
    constraints: parseOpaqueJson(route.constraintsJson),
  };
}

function parseSettlementDomainId(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0{64}$/.test(value)
    ? value
    : null;
}

function protocolFromExtra(extra: JsonValue | null): string {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return "";
  return typeof extra.protocol === "string" ? extra.protocol : "";
}

function parseOptionalEstimator(value: unknown): WorkUnitEstimator | null | false {
  if (value === null || value === undefined) return null;
  const parsed = parseWorkUnitEstimator(value);
  return parsed ?? false;
}
