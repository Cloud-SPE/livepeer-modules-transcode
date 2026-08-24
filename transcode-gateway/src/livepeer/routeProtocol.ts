import type {
  LivepeerProtocol,
  PaidJobAxes,
  PaidJobTransport,
  PaidSessionAxes,
  SettlementKey,
  WorkUnitEstimator,
} from "../engine/types/index.js";
import type { JsonValue } from "./routeSelector.js";

export interface RouteProtocolDeclaration {
  protocol: LivepeerProtocol;
  job: PaidJobAxes | null;
  session: PaidSessionAxes | null;
}

export interface RouteProtocolRequirement {
  protocol: LivepeerProtocol;
  acceptedTransports?: PaidJobTransport[];
  descriptorSchema?: string;
  attachment?: PaidSessionAxes["attachment"];
}

const JOB_TRANSPORTS = new Set<PaidJobTransport>(["unary", "stream", "multipart"]);

export function parseRouteProtocolDeclaration(
  typedProtocol: string,
  extra: JsonValue | null,
): RouteProtocolDeclaration | null {
  if (typedProtocol !== "paid-job/v1" && typedProtocol !== "paid-session/v1") return null;
  const root = asObject(extra);
  if (!root) return null;
  if (root.protocol !== undefined && root.protocol !== typedProtocol) return null;

  if (typedProtocol === "paid-job/v1") {
    if (root.session !== undefined) return null;
    const job = parseJobAxes(root.job);
    return job ? { protocol: typedProtocol, job, session: null } : null;
  }

  if (root.job !== undefined) return null;
  const session = parseSessionAxes(root.session);
  return session ? { protocol: typedProtocol, job: null, session } : null;
}

export function routeSatisfiesRequirement(
  declaration: RouteProtocolDeclaration,
  requirement: RouteProtocolRequirement,
): boolean {
  if (declaration.protocol !== requirement.protocol) return false;
  if (requirement.protocol === "paid-job/v1") {
    if (!declaration.job) return false;
    const accepted = requirement.acceptedTransports;
    return !accepted || accepted.some((transport) => declaration.job!.transports.includes(transport));
  }
  if (!declaration.session) return false;
  if (
    requirement.descriptorSchema !== undefined &&
    declaration.session.descriptorSchema !== requirement.descriptorSchema
  ) {
    return false;
  }
  if (
    requirement.attachment !== undefined &&
    declaration.session.attachment !== requirement.attachment
  ) {
    return false;
  }
  return true;
}

export function parseWorkUnitEstimator(value: unknown): WorkUnitEstimator | null {
  const raw = asUnknownObject(value);
  if (!raw) return null;
  const id = nonEmptyString(raw.id);
  const rounding = nonEmptyString(raw.rounding);
  const exactness = nonEmptyString(raw.exactness);
  if (!id || !rounding || !exactness) return null;
  const packageName = optionalNonEmptyString(raw.package);
  const fixtures = optionalNonEmptyString(raw.fixtures);
  if (packageName === false || fixtures === false) return null;
  return {
    id,
    rounding,
    exactness,
    ...(packageName ? { package: packageName } : {}),
    ...(fixtures ? { fixtures } : {}),
  };
}

export function parseSettlementKeys(value: unknown): SettlementKey[] | null {
  if (!Array.isArray(value)) return null;
  const keys: SettlementKey[] = [];
  for (const item of value) {
    const raw = asUnknownObject(item);
    if (!raw) return null;
    const publicKey = nonEmptyString(raw.publicKey ?? raw.public_key);
    const notBefore = nonEmptyString(raw.notBefore ?? raw.not_before);
    const expiresAt = nonEmptyString(raw.expiresAt ?? raw.expires_at);
    const introduced = canonicalUint64(
      raw.introducedInPublicationSeq ?? raw.introduced_in_publication_seq,
    );
    if (!publicKey || !notBefore || !expiresAt || introduced === null) return null;
    keys.push({ publicKey, notBefore, expiresAt, introducedInPublicationSeq: introduced });
  }
  return keys;
}

function canonicalUint64(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  return BigInt(value) <= 18_446_744_073_709_551_615n ? value : null;
}

function parseJobAxes(value: unknown): PaidJobAxes | null {
  const raw = asUnknownObject(value);
  if (!raw || !Array.isArray(raw.transports) || raw.transports.length === 0) return null;
  const transports: PaidJobTransport[] = [];
  for (const value of raw.transports) {
    if (typeof value !== "string" || !JOB_TRANSPORTS.has(value as PaidJobTransport)) return null;
    const transport = value as PaidJobTransport;
    if (transports.includes(transport)) return null;
    transports.push(transport);
  }
  return { transports };
}

function parseSessionAxes(value: unknown): PaidSessionAxes | null {
  const raw = asUnknownObject(value);
  if (!raw) return null;
  const descriptorSchema = nonEmptyString(raw.descriptor_schema);
  const metering = raw.metering;
  if (
    !descriptorSchema ||
    (metering !== "runner-reported" && metering !== "broker-observed")
  ) {
    return null;
  }
  const attachment = raw.attachment ?? "external";
  if (attachment !== "external" && attachment !== "inband-ws") return null;
  if (metering === "broker-observed" && attachment !== "inband-ws") return null;
  const refill = raw.refill ?? "extensible";
  if (refill !== "extensible" && refill !== "bounded") return null;
  const declaredMaxRotations = positiveSafeInteger(raw.max_rotations ?? 3, true);
  if (declaredMaxRotations === null) return null;
  const maxRotations = declaredMaxRotations === 0 ? 3 : declaredMaxRotations;
  const heartbeat = parseHeartbeat(raw.heartbeat);
  const lease = parseLease(raw.lease);
  if (!heartbeat || !lease) return null;
  const toleranceBandPct = optionalNonNegativeNumber(raw.tolerance_band_pct);
  const runwayIncrementUnits = optionalPositiveSafeInteger(raw.runway_increment_units);
  const sessionParamsSchema = optionalObject(raw.session_params_schema);
  if (
    toleranceBandPct === false ||
    runwayIncrementUnits === false ||
    sessionParamsSchema === false
  ) {
    return null;
  }
  return {
    descriptorSchema,
    attachment,
    metering,
    maxRotations,
    refill,
    heartbeat,
    lease,
    ...(toleranceBandPct !== undefined ? { toleranceBandPct } : {}),
    ...(runwayIncrementUnits !== undefined ? { runwayIncrementUnits } : {}),
    ...(sessionParamsSchema !== undefined ? { sessionParamsSchema } : {}),
  };
}

function parseHeartbeat(value: unknown): PaidSessionAxes["heartbeat"] | null {
  if (value === undefined) return { intervalSeconds: 10, missedThreshold: 3 };
  const raw = asUnknownObject(value);
  if (!raw) return null;
  const intervalSeconds = optionalPositiveSafeInteger(raw.interval_seconds);
  const missedThreshold = optionalPositiveSafeInteger(raw.missed_threshold);
  if (intervalSeconds === false || missedThreshold === false) return null;
  return {
    intervalSeconds: intervalSeconds ?? 10,
    missedThreshold: missedThreshold ?? 3,
  };
}

function parseLease(value: unknown): PaidSessionAxes["lease"] | null {
  if (value === undefined) return { policy: "funding-tracking" };
  const raw = asUnknownObject(value);
  if (!raw) return null;
  const policy = raw.policy ?? "funding-tracking";
  if (policy !== "funding-tracking" && policy !== "fixed") return null;
  const maxSeconds = optionalPositiveSafeInteger(raw.max_seconds);
  if (maxSeconds === false) return null;
  return { policy, ...(maxSeconds !== undefined ? { maxSeconds } : {}) };
}

function asObject(value: JsonValue | null): Record<string, JsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asUnknownObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalNonEmptyString(value: unknown): string | undefined | false {
  if (value === undefined || value === "") return undefined;
  return nonEmptyString(value) ?? false;
}

function positiveSafeInteger(value: unknown, allowZero = false): number | null {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (allowZero ? Number(parsed) < 0 : Number(parsed) < 1)) return null;
  return Number(parsed);
}

function optionalPositiveSafeInteger(value: unknown): number | undefined | false {
  if (value === undefined) return undefined;
  return positiveSafeInteger(value) ?? false;
}

function optionalNonNegativeNumber(value: unknown): number | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : false;
}

function optionalObject(value: unknown): Record<string, unknown> | undefined | false {
  if (value === undefined) return undefined;
  return asUnknownObject(value) ?? false;
}
