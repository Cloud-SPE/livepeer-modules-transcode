import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  LocClient,
  LocOpenSessionResult,
  LocSettlementEnvelope,
  PaidSessionBalance,
  PaidSessionClient,
  PaidSessionControl,
  PaidSessionEndRequest,
  PaidSessionGrant,
  PaidSessionOpenRequest,
  PaidSessionRefillRequest,
} from "../engine/interfaces/index.js";
import { PaidSessionClientError } from "../engine/interfaces/index.js";
import { LocTransportError } from "../engine/interfaces/index.js";
import type { JsonValue } from "../engine/types/index.js";
import { HEADER } from "./headers.js";
import { routeBindingFor } from "./locClient.js";
import { classifyV2Failure } from "./v2Outcome.js";
import type { CallerProofIdentity } from "./callerProof.js";

const PROTOCOL = "paid-session/v1";
const safeFailureCode = /^[a-z][a-z0-9_]{0,63}$/;
const outputStateWire = z.enum(["waiting", "producing", "stalled"]);
const grantWire = z.object({
  id: z.string().min(1),
  operations: z.array(z.string().min(1)).min(1),
  secret: z.string().min(1),
  expires_at: z.string().min(1),
  max_uses: z.number().int().positive().optional(),
}).strict();
const balanceWire = z.object({
  claimed_units: z.number().int().nonnegative(),
  debited_units: z.number().int().nonnegative(),
  unit: z.string().min(1),
  authorization_id: z.string().min(1),
  authorization_max_units: z.number().int().positive(),
  authorization_cap_remaining_units: z.number().int().nonnegative(),
  authorization_reserved_value_wei: z.string().regex(/^(0|[1-9][0-9]*)$/),
  cumulative_billed_value_wei: z.string().regex(/^(0|[1-9][0-9]*)$/),
  account_available_value_wei: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
  account_version: z.number().int().nonnegative().optional(),
  runway_units: z.number().int().nonnegative().optional(),
  runway_seconds_estimate: z.number().int().nonnegative().optional(),
  status: z.enum(["ok", "low", "exhausted"]),
  will_refuse_next_refill: z.boolean(),
}).strict();
const controlWire = z.object({
  status_url: z.string().url(),
  topup_url: z.string().url(),
  end_url: z.string().url(),
  events_ws: z.string().url(),
}).strict();
const openWire = z.object({
  session_id: z.string().min(1),
  work_id: z.string().min(1),
  state: z.string().min(1),
  runtime: z.object({
    schema: z.string().min(1),
    public: z.json(),
    grants: z.array(grantWire).optional(),
  }).strict(),
  lease: z.object({ expires_at: z.string().min(1) }).strict(),
  control: controlWire,
  credential: z.string().min(1),
  balance: balanceWire,
}).strict();
const capacityOpenWire = z.object({
  session_id: z.string().min(1),
  gateway_session_id: z.string().min(1),
  work_id: z.string().min(1),
  settlement_url: z.string().url(),
}).passthrough();
const streamKeyWire = z.object({
  request_id: z.string().min(1),
  stream_key: z.string().min(1).max(512),
  expires_at: z.string().min(1),
}).strict();
const statusWire = z.object({
  session_id: z.string().min(1),
  gateway_session_id: z.string().min(1),
  work_id: z.string().min(1),
  authorization_id: z.string().min(1),
  state: z.string().min(1),
  runtime: z.object({ schema: z.string().min(1), public: z.json() }).strict(),
  usage: z.object({ unit: z.string().min(1), claimed_total: z.number().int().nonnegative() }).strict(),
  lease: z.object({ expires_at: z.string().min(1) }).strict(),
  balance: balanceWire,
  started_at: z.string().min(1),
  rotation: z.unknown().optional(),
  ended_at: z.string().optional(),
  close_reason: z.string().optional(),
  output_state: z.enum(["unknown", "waiting", "producing", "stalled"]).optional().default("unknown"),
  output_state_since: z.string().min(1).optional(),
  last_failure_code: z.string().regex(safeFailureCode).optional(),
}).strict();
const topupWire = z.object({
  session_id: z.string().min(1),
  work_id: z.string().min(1),
  lease: z.object({ expires_at: z.string().min(1) }).strict(),
  balance: balanceWire,
}).strict();
const endWire = z.object({
  session_id: z.string().min(1),
  work_id: z.string().min(1),
  state: z.string().min(1),
  close_reason: z.string(),
  ended_at: z.string().min(1),
}).strict();
const settlementLookupWire = z.object({
  session_id: z.string().min(1),
  gateway_session_id: z.string().min(1),
  work_id: z.string().min(1),
  authorization_id: z.string().min(1),
  predecessor_work_id: z.string(),
  rotation_generation: z.number().int().nonnegative(),
  state: z.string().min(1),
  unit: z.string().min(1),
  claimed_units: z.number().int().nonnegative(),
  debited_units: z.number().int().nonnegative(),
  settlement_seq: z.number().int().positive(),
  settlement: z.string().optional(),
}).passthrough();
const envelopeWire = z.object({
  payload: z.record(z.string(), z.json()),
  signature: z.object({
    algorithm: z.literal("secp256k1"),
    canonicalization: z.literal("jcs"),
    value: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  }).strict(),
}).strict();
const controlEventWire = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.usage.tick"), body: z.object({
    sequence: z.number().int().positive(),
    unit: z.string().min(1),
    claimed_total: z.number().int().nonnegative(),
    debited_units: z.number().int().nonnegative(),
  }).strict() }).strict(),
  z.object({ type: z.literal("session.balance"), body: balanceWire }).strict(),
  z.object({ type: z.literal("session.output.health"), body: z.object({
    output_state: outputStateWire,
    output_state_since: z.string().refine(validTimestamp),
    last_failure_code: z.string().regex(safeFailureCode).optional(),
  }).strict() }).strict(),
  z.object({ type: z.literal("session.ended"), body: z.object({
    state: z.string().min(1), close_reason: z.string().min(1),
  }).strict() }).strict(),
  z.object({ type: z.literal("session.rebound"), body: z.object({
    rotation_generation: z.number().int().positive(),
    predecessor_work_id: z.string().min(1),
    work_id: z.string().min(1),
  }).strict() }).strict(),
]);

export interface PaidSessionClientOptions {
  fetch?: typeof globalThis.fetch;
  caller: CallerProofIdentity;
}

export function createPaidSessionClient(
  loc: LocClient,
  options: PaidSessionClientOptions,
): PaidSessionClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    async open(input) {
      validateOpen(input);
      const routeBinding = routeBindingFor(input.route);
      const prepared = await loc.prepareSession({
        requestId: input.requestId,
        capability: input.route.capability,
        offering: input.route.offering,
        descriptorSchema: input.descriptorSchema,
        routeBinding,
      });
      const brokerOpenBody = JSON.stringify({
        gateway_session_id: prepared.gatewaySessionId,
        session_params: input.sessionParams,
      });
      if (prepared.brokerUrl !== input.route.workerUrl) throw invalidEvidence();
      const opened = await loc.openSession({
        requestId: input.requestId,
        capability: input.route.capability,
        offering: input.route.offering,
        descriptorSchema: input.descriptorSchema,
        sessionParams: input.sessionParams,
        estimatedRunwayUnits: input.estimatedRunwayUnits,
        maxTotalUnits: input.maxTotalUnits,
        routeBinding,
        gatewaySessionId: prepared.gatewaySessionId,
        preparationToken: prepared.preparationToken,
        workloadRequestDigest: createHash("sha256").update(brokerOpenBody).digest("hex"),
        callerPublicKey: options.caller.publicKey,
      });
      const response = await fetchImpl(`${opened.brokerUrl.replace(/\/$/, "")}/v1/session`, {
        method: "POST",
        headers: brokerOpenHeaders(opened, options.caller),
        body: brokerOpenBody,
      });
      if (response.status === 503 && response.headers.get(HEADER.ERROR) === "capacity_exhausted") {
        await settleCapacityOpen(loc, opened, prepared.gatewaySessionId, response);
        throw new PaidSessionClientError("capacity_exhausted", { retryable: true });
      }
      const value = await parseResponse(response, openWire);
      if (
        value.work_id !== opened.workId ||
        value.runtime.schema !== input.descriptorSchema ||
        value.balance.unit !== opened.routeSnapshot.workUnit
      ) throw invalidEvidence();
      return {
        opened,
        gatewaySessionId: prepared.gatewaySessionId,
        brokerSessionId: value.session_id,
        workId: value.work_id,
        state: value.state,
        credential: value.credential,
        runtimeSchema: value.runtime.schema,
        runtimePublic: value.runtime.public as JsonValue,
        grants: (value.runtime.grants ?? []).map(mapGrant),
        leaseExpiresAt: value.lease.expires_at,
        balance: mapBalance(value.balance),
        control: mapControl(value.control),
      };
    },

    async issueStreamKey(input) {
      if (
        input.requestId.length === 0 ||
        !input.grant.operations.includes("stream-key-issue") ||
        input.grant.secret.length === 0 ||
        !validRunnerUrl(input.keyIssueUrl)
      ) throw invalidRequest();
      const value = await jsonRequest(fetchImpl, input.keyIssueUrl, {
        method: "POST",
        headers: new Headers({
          Authorization: `Bearer ${input.grant.secret}`,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          request_id: input.requestId,
          audience: input.audience,
        }),
      }, streamKeyWire);
      if (value.request_id !== input.requestId || !validTimestamp(value.expires_at)) {
        throw invalidEvidence();
      }
      return {
        requestId: value.request_id,
        streamKey: value.stream_key,
        expiresAt: value.expires_at,
      };
    },

    async status(input) {
      const value = await jsonRequest(
        fetchImpl,
        brokerControlUrl(input.opened, input.brokerSessionId, ""),
        { headers: authHeaders(input.credential) },
        statusWire,
      );
      if (
        value.session_id !== input.brokerSessionId ||
        value.work_id !== input.workId ||
        value.authorization_id !== value.work_id ||
        value.balance.authorization_id !== value.authorization_id ||
        value.runtime.schema !== controlDescriptor(input.opened) ||
        value.usage.unit !== controlWorkUnit(input.opened) ||
        value.balance.unit !== controlWorkUnit(input.opened) ||
        (value.output_state_since !== undefined && !validTimestamp(value.output_state_since))
      ) throw invalidEvidence();
      return {
        brokerSessionId: value.session_id,
        gatewaySessionId: value.gateway_session_id,
        workId: value.work_id,
        state: value.state,
        runtimeSchema: value.runtime.schema,
        runtimePublic: value.runtime.public as JsonValue,
        claimedUnits: value.usage.claimed_total,
        workUnit: value.usage.unit,
        leaseExpiresAt: value.lease.expires_at,
        balance: mapBalance(value.balance),
        closeReason: value.close_reason ?? null,
        outputState: value.output_state,
        outputStateSince: value.output_state_since ?? null,
        lastFailureCode: value.last_failure_code ?? null,
      };
    },

    async refill(input) {
      validateRefill(input);
      let refill;
      try {
        refill = await loc.refillSession({
          operationId: input.opened.operationId,
          requestId: input.requestId,
          ...(input.observedConsumedUnits === undefined ? {} : { observedConsumedUnits: input.observedConsumedUnits }),
          maxTotalUnits: input.maxTotalUnits,
          workloadRequestDigest: createHash("sha256").update("{}").digest("hex"),
        });
      } catch (error) {
        if (error instanceof LocTransportError) {
          throw new PaidSessionClientError(error.remoteCode ?? error.code, {
            retryable: error.retryable,
            cause: error,
          });
        }
        throw error;
      }
      const headers = authHeaders(input.credential);
      headers.set(HEADER.AUTHORIZATION, refill.spendAuthorization);
      headers.set(HEADER.CALLER_PROOF, options.caller.signAuthorization(refill.spendAuthorization));
      headers.set(HEADER.REQUEST_ID, refill.requestId);
      headers.set("Content-Type", "application/json");
      if (refill.paymentEnvelope) headers.set(HEADER.PAYMENT, refill.paymentEnvelope);
      const value = await jsonRequest(
        fetchImpl,
        brokerControlUrl(input.opened, input.brokerSessionId, "/topup"),
        { method: "POST", headers, body: "{}" },
        topupWire,
      );
      if (
        value.session_id !== input.brokerSessionId ||
        value.work_id !== refill.workId ||
        value.balance.unit !== controlWorkUnit(input.opened)
      ) throw invalidEvidence();
      return {
        loc: refill,
        brokerSessionId: value.session_id,
        workId: value.work_id,
        leaseExpiresAt: value.lease.expires_at,
        balance: mapBalance(value.balance),
      };
    },

    async end(input) {
      validateEnd(input);
      const response = await fetchImpl(
        brokerControlUrl(input.opened, input.brokerSessionId, "/end"),
        {
          method: "POST",
          headers: new Headers({ ...Object.fromEntries(authHeaders(input.credential)), "Content-Type": "application/json" }),
          body: JSON.stringify({ reason: input.reason }),
        },
      );
      const body = await parseResponse(response, endWire);
      if (body.session_id !== input.brokerSessionId) throw invalidEvidence();
      const lookup = await settlementLookup(
        fetchImpl,
        input.opened,
        input.gatewaySessionId,
        response.headers.get(HEADER.SETTLEMENT),
      );
      if (
        lookup.wire.session_id !== input.brokerSessionId ||
        lookup.wire.gateway_session_id !== input.gatewaySessionId ||
        lookup.wire.work_id !== body.work_id ||
        lookup.wire.authorization_id !== lookup.wire.work_id ||
        lookup.wire.unit !== controlWorkUnit(input.opened) ||
        lookup.wire.claimed_units !== lookup.wire.debited_units ||
        lookup.wire.state !== "closed"
      ) throw invalidEvidence();
      const payload = lookup.envelope.payload;
      const actualUnits = safeUnits(payload.actual_units);
      const outcome = requiredString(payload.outcome);
      if (
        outcome === "DEBIT_FAILED" ||
        requiredString(payload.gateway_session_id) !== input.gatewaySessionId ||
        requiredString(payload.session_id) !== input.brokerSessionId ||
        requiredString(payload.work_id) !== lookup.wire.work_id ||
        requiredString(payload.authorization_id) !== lookup.wire.authorization_id ||
        requiredString(payload.settlement_domain_id) !== controlSettlementDomain(input.opened) ||
        requiredString(payload.work_unit_name) !== lookup.wire.unit ||
        actualUnits !== lookup.wire.claimed_units ||
        safeUnits(payload.claimed_units) !== actualUnits ||
        safeUnits(payload.debited_units) !== actualUnits ||
        safeUnits(payload.settlement_seq) !== lookup.wire.settlement_seq
      ) {
        throw new PaidSessionClientError(
          outcome === "DEBIT_FAILED" ? "paid_session_debit_failed" : "paid_session_settlement_identity_mismatch",
          { retryable: false },
        );
      }
      let accounting;
      try {
        accounting = await loc.closeSession({
          operationId: input.opened.operationId,
          actualUnits,
          outcome,
          settlement: lookup.envelope,
        });
      } catch (error) {
        if (error instanceof LocTransportError) {
          throw new PaidSessionClientError(error.remoteCode ?? error.code, {
            retryable: error.retryable,
            cause: error,
          });
        }
        throw error;
      }
      if (accounting.workId !== lookup.wire.work_id) throw invalidEvidence();
      return {
        brokerSessionId: body.session_id,
        workId: body.work_id,
        state: body.state,
        closeReason: body.close_reason,
        settlementSequence: lookup.wire.settlement_seq,
        actualUnits,
        outcome,
        envelope: lookup.envelope,
        accounting,
      };
    },
  };
}

export function parsePaidSessionControlEvent(value: unknown) {
  const frame = controlEventWire.safeParse(value);
  if (!frame.success) throw invalidEvidence();
  switch (frame.data.type) {
    case "session.usage.tick":
      return {
        type: frame.data.type,
        sequence: frame.data.body.sequence,
        unit: frame.data.body.unit,
        claimedTotal: frame.data.body.claimed_total,
        debitedUnits: frame.data.body.debited_units,
      } as const;
    case "session.balance":
      return { type: frame.data.type, balance: mapBalance(frame.data.body) } as const;
    case "session.output.health":
      return {
        type: frame.data.type,
        outputState: frame.data.body.output_state,
        outputStateSince: frame.data.body.output_state_since,
        lastFailureCode: frame.data.body.last_failure_code ?? null,
      } as const;
    case "session.ended":
      return { type: frame.data.type, state: frame.data.body.state, closeReason: frame.data.body.close_reason } as const;
    case "session.rebound":
      return {
        type: frame.data.type,
        rotationGeneration: frame.data.body.rotation_generation,
        predecessorWorkId: frame.data.body.predecessor_work_id,
        workId: frame.data.body.work_id,
      } as const;
  }
}

async function settleCapacityOpen(
  loc: LocClient,
  opened: LocOpenSessionResult,
  gatewaySessionId: string,
  response: Response,
): Promise<void> {
  let body: z.infer<typeof capacityOpenWire>;
  try {
    body = capacityOpenWire.parse(await response.json());
  } catch (cause) {
    throw new PaidSessionClientError("paid_session_response_invalid", { retryable: false, cause });
  }
  const encoded = response.headers.get(HEADER.SETTLEMENT);
  if (!encoded) throw invalidEvidence();
  const envelope = decodeEnvelope(encoded);
  const payload = envelope.payload;
  const outcome = requiredString(payload.outcome);
  if (
    body.gateway_session_id !== gatewaySessionId ||
    body.work_id !== opened.workId ||
    requiredString(payload.gateway_session_id) !== gatewaySessionId ||
    requiredString(payload.session_id) !== body.session_id ||
    requiredString(payload.work_id) !== opened.workId ||
    requiredString(payload.authorization_id) !== opened.workId ||
    requiredString(payload.settlement_domain_id) !== opened.routeSnapshot.settlementDomainId ||
    requiredString(payload.work_unit_name) !== opened.routeSnapshot.workUnit ||
    safeUnits(payload.actual_units) !== 0 ||
    safeUnits(payload.claimed_units) !== 0 ||
    safeUnits(payload.debited_units) !== 0
  ) throw invalidEvidence();
  try {
    const accounting = await loc.closeSession({
      operationId: opened.operationId,
      actualUnits: 0,
      outcome,
      settlement: envelope,
    });
    if (accounting.workId !== opened.workId || accounting.actualUnits !== 0) throw invalidEvidence();
  } catch (error) {
    if (error instanceof LocTransportError) {
      throw new PaidSessionClientError(error.remoteCode ?? error.code, {
        retryable: error.retryable,
        cause: error,
      });
    }
    throw error;
  }
}

async function settlementLookup(
  fetchImpl: typeof globalThis.fetch,
  opened: { brokerUrl: string },
  gatewaySessionId: string,
  header: string | null,
) {
  const response = await fetchImpl(
    `${opened.brokerUrl.replace(/\/$/, "")}/v1/settlement/${encodeURIComponent(gatewaySessionId)}`,
  );
  const wire = await parseResponse(response, settlementLookupWire);
  const encoded = response.headers.get(HEADER.SETTLEMENT) ?? header ?? wire.settlement;
  if (!encoded) throw invalidEvidence();
  return { wire, envelope: decodeEnvelope(encoded) };
}

function brokerOpenHeaders(opened: LocOpenSessionResult, caller: CallerProofIdentity): Headers {
  const headers = new Headers({
    [HEADER.CAPABILITY]: opened.routeSnapshot.capability,
    [HEADER.OFFERING]: opened.routeSnapshot.offering,
    [HEADER.AUTHORIZATION]: opened.spendAuthorization,
    [HEADER.CALLER_PROOF]: caller.signAuthorization(opened.spendAuthorization),
    [HEADER.PROTOCOL]: PROTOCOL,
    [HEADER.REQUEST_ID]: opened.requestId,
    "Content-Type": "application/json",
  });
  if (opened.paymentEnvelope) headers.set(HEADER.PAYMENT, opened.paymentEnvelope);
  return headers;
}

function authHeaders(credential: string): Headers {
  if (credential.length === 0) throw invalidRequest();
  return new Headers({ Authorization: `Bearer ${credential}` });
}

function brokerControlUrl(opened: { brokerUrl: string }, id: string, suffix: string): string {
  if (id.length === 0) throw invalidRequest();
  return `${opened.brokerUrl.replace(/\/$/, "")}/v1/session/${encodeURIComponent(id)}${suffix}`;
}

function controlDescriptor(opened: PaidSessionRefillRequest["opened"]): string {
  return "descriptorSchema" in opened ? opened.descriptorSchema : opened.session.descriptorSchema;
}

function controlWorkUnit(opened: PaidSessionRefillRequest["opened"]): string {
  return "workUnit" in opened ? opened.workUnit : opened.routeSnapshot.workUnit;
}

function controlSettlementDomain(opened: PaidSessionRefillRequest["opened"]): string {
  return "settlementDomainId" in opened
    ? opened.settlementDomainId
    : opened.routeSnapshot.settlementDomainId;
}

async function jsonRequest<T extends z.ZodType>(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  schema: T,
): Promise<z.infer<T>> {
  return parseResponse(await fetchImpl(url, init), schema);
}

async function parseResponse<T extends z.ZodType>(response: Response, schema: T): Promise<z.infer<T>> {
  if (!response.ok) {
    const code = response.headers.get(HEADER.ERROR) ?? "paid_session_broker_refused";
    throw new PaidSessionClientError(code, {
      retryable: classifyV2Failure(code, response.status).retryable,
    });
  }
  try {
    return schema.parse(await response.json());
  } catch (cause) {
    throw new PaidSessionClientError("paid_session_response_invalid", { retryable: false, cause });
  }
}

function decodeEnvelope(encoded: string): LocSettlementEnvelope {
  try {
    return envelopeWire.parse(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))) as LocSettlementEnvelope;
  } catch (cause) {
    throw new PaidSessionClientError("paid_session_settlement_invalid", { retryable: false, cause });
  }
}

function mapGrant(value: z.infer<typeof grantWire>): PaidSessionGrant {
  return {
    id: value.id,
    operations: value.operations,
    secret: value.secret,
    expiresAt: value.expires_at,
    ...(value.max_uses === undefined ? {} : { maxUses: value.max_uses }),
  };
}

function mapBalance(value: z.infer<typeof balanceWire>): PaidSessionBalance {
  return {
    claimedUnits: value.claimed_units,
    debitedUnits: value.debited_units,
    unit: value.unit,
    authorizationId: value.authorization_id,
    authorizationMaxUnits: value.authorization_max_units,
    authorizationCapRemainingUnits: value.authorization_cap_remaining_units,
    authorizationReservedValueWei: value.authorization_reserved_value_wei,
    cumulativeBilledValueWei: value.cumulative_billed_value_wei,
    accountAvailableValueWei: value.account_available_value_wei ?? null,
    accountVersion: value.account_version ?? null,
    runwayUnits: value.runway_units ?? null,
    runwaySecondsEstimate: value.runway_seconds_estimate ?? null,
    status: value.status,
    willRefuseNextRefill: value.will_refuse_next_refill,
  };
}

function mapControl(value: z.infer<typeof controlWire>): PaidSessionControl {
  return {
    statusUrl: value.status_url,
    topupUrl: value.topup_url,
    endUrl: value.end_url,
    eventsWs: value.events_ws,
  };
}

function validateOpen(input: PaidSessionOpenRequest): void {
  if (
    input.route.protocol !== PROTOCOL ||
    input.route.session?.descriptorSchema !== input.descriptorSchema ||
    input.requestId.length === 0 ||
    !Number.isSafeInteger(input.estimatedRunwayUnits) ||
    input.estimatedRunwayUnits < 1 ||
    !Number.isSafeInteger(input.maxTotalUnits) ||
    input.maxTotalUnits < input.estimatedRunwayUnits
  ) throw invalidRequest();
}

function validRunnerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function validTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function validateRefill(input: PaidSessionRefillRequest): void {
  if (
    input.requestId.length === 0 ||
    !Number.isSafeInteger(input.maxTotalUnits) ||
    input.maxTotalUnits < 1
  ) throw invalidRequest();
}

function validateEnd(input: PaidSessionEndRequest): void {
  if (
    input.gatewaySessionId.length === 0 ||
    input.brokerSessionId.length === 0 ||
    input.credential.length === 0 ||
    input.reason.length === 0
  ) throw invalidRequest();
}

function safeUnits(value: unknown): number {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw invalidEvidence();
  return parsed;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw invalidEvidence();
  return value;
}

function invalidRequest(): PaidSessionClientError {
  return new PaidSessionClientError("paid_session_request_invalid", { retryable: false });
}

function invalidEvidence(): PaidSessionClientError {
  return new PaidSessionClientError("paid_session_evidence_invalid", { retryable: false });
}
